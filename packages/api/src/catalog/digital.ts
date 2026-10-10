import {
  checkUploadFile,
  digitalPublishProblems,
  validateDigitalProductDraft,
  type DigitalProductDraft,
  type FileStore,
  type TenantContext,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  getProduct,
  insertProduct,
  insertVariants,
  listProducts,
  listVariants,
  lockProduct,
  updateProduct as updateProductRecord,
  updateVariantPrice,
} from "@jendal-workspace/db/repositories/catalog";
import {
  deleteOtherAttachedProductFiles,
  findAttachedProductFile,
  findFileUpload,
  insertFileUpload,
  lockProductFileUploadForAttach,
  markFileUploadAttached,
} from "@jendal-workspace/db/repositories/files";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";

import { CatalogValidationError } from "./errors";

export type DigitalProductDetail = {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published";
  priceMinor: number;
  fileName: string | null;
};

export class DigitalProductMissing extends Error {
  constructor() {
    super("Product not found.");
    this.name = "DigitalProductMissing";
  }
}

export class UploadLimitedError extends Error {
  constructor() {
    super("Too many uploads. Wait a few minutes and try again.");
    this.name = "UploadLimitedError";
  }
}

async function requireDigitalProduct(db: Database, tenant: TenantContext, productId: string) {
  const product = await getProduct(db, tenant, productId);
  if (!product || product.kind !== "digital") throw new DigitalProductMissing();
  return product;
}

export async function createDigitalProduct(
  db: Database,
  tenant: TenantContext,
  input: DigitalProductDraft,
): Promise<DigitalProductDetail> {
  const problems = validateDigitalProductDraft(input);
  if (problems.length > 0) throw new CatalogValidationError(problems);
  const product = await insertProduct(db, tenant, {
    kind: "digital",
    title: input.title.trim(),
    description: input.description,
    brand: "",
    category: "",
    chargeTax: true,
    requiresShipping: false,
    channel3ProductId: null,
  });
  await insertVariants(db, tenant, product.id, [
    { options: [], sku: "", priceMinor: input.priceMinor, stock: 0 },
  ]);
  return getDigitalProduct(db, tenant, product.id);
}

export async function updateDigitalProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
  input: DigitalProductDraft,
): Promise<DigitalProductDetail> {
  const problems = validateDigitalProductDraft(input);
  if (problems.length > 0) throw new CatalogValidationError(problems);
  const product = await requireDigitalProduct(db, tenant, productId);
  // A published product must stay buyable, so an edit may not take it below the publish bar.
  if (product.status === "published") {
    const hasFile = (await findAttachedProductFile(db, productId)) !== null;
    const publishProblems = digitalPublishProblems(
      { title: input.title, description: input.description, priceMinor: input.priceMinor },
      hasFile,
    );
    if (publishProblems.length > 0) throw new CatalogValidationError(publishProblems);
  }
  await updateProductRecord(db, tenant, productId, {
    title: input.title.trim(),
    description: input.description,
    brand: product.brand,
    category: product.category,
    chargeTax: product.chargeTax,
    requiresShipping: product.requiresShipping,
    channel3ProductId: product.channel3ProductId,
  });
  const [variant] = await listVariants(db, tenant, productId);
  if (variant) {
    await updateVariantPrice(db, tenant, variant.id, input.priceMinor);
  } else {
    await insertVariants(db, tenant, productId, [{ options: [], sku: "", priceMinor: input.priceMinor, stock: 0 }]);
  }
  return getDigitalProduct(db, tenant, productId);
}

export async function getDigitalProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
): Promise<DigitalProductDetail> {
  const product = await requireDigitalProduct(db, tenant, productId);
  const [variants, file] = await Promise.all([
    listVariants(db, tenant, productId),
    findAttachedProductFile(db, productId),
  ]);
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    status: product.status as "draft" | "published",
    priceMinor: variants[0]?.priceMinor ?? 0,
    fileName: file?.fileName ?? null,
  };
}

export async function listDigitalProducts(db: Database, tenant: TenantContext): Promise<DigitalProductDetail[]> {
  const rows = (await listProducts(db, tenant)).filter((product) => product.kind === "digital");
  // One query per product is fine at admin scale (the same choice listProductSummaries makes).
  return Promise.all(rows.map((product) => getDigitalProduct(db, tenant, product.id)));
}

// Sellers design §5.1: the browser uploads straight to the bucket; the row records what was announced.
export async function startProductFileUpload(
  db: Database,
  files: FileStore,
  tenant: TenantContext,
  userId: string,
  input: { productId: string; fileName: string; sizeBytes: number },
): Promise<{ uploadId: string; url: string; headers: Record<string, string> }> {
  await requireDigitalProduct(db, tenant, input.productId);
  const checked = checkUploadFile({ name: input.fileName, sizeBytes: input.sizeBytes });
  if (!checked.ok) throw new CatalogValidationError([{ field: "file", message: checked.problem }]);
  const allowed = await hitRequestLimit(db, { key: `product-upload:${userId}`, max: 20, windowMs: 600_000 });
  if (!allowed) throw new UploadLimitedError();
  const uploadId = crypto.randomUUID();
  const key = `products/${tenant.storeId}/${input.productId}/${uploadId}`;
  await insertFileUpload(db, {
    id: uploadId,
    teamId: tenant.storeId,
    productId: input.productId,
    purpose: "product",
    r2Key: key,
    fileName: checked.fileName,
    contentType: checked.contentType,
    sizeBytes: input.sizeBytes,
    createdById: userId,
  });
  const { url, headers } = await files.presignPut({
    key,
    contentType: checked.contentType,
    sizeBytes: input.sizeBytes,
    expiresInSeconds: 900,
  });
  return { uploadId, url, headers };
}

// The bucket is asked before the transaction so no row lock waits on the network; replacing deletes the old file.
export async function attachProductFile(
  db: Database,
  files: FileStore,
  tenant: TenantContext,
  input: { productId: string; uploadId: string },
): Promise<{ fileName: string }> {
  await requireDigitalProduct(db, tenant, input.productId);
  const upload = await findFileUpload(db, input.uploadId);
  if (!upload || upload.teamId !== tenant.storeId || upload.productId !== input.productId || upload.purpose !== "product") {
    throw new CatalogValidationError([{ field: "file", message: "This file cannot be used for this product." }]);
  }
  const stored = await files.head(upload.r2Key);
  if (!stored || stored.sizeBytes !== upload.sizeBytes) {
    throw new CatalogValidationError([{ field: "file", message: "The file did not finish uploading." }]);
  }
  const replacedKeys = await db.transaction(async (tx) => {
    // The product lock serializes concurrent attaches, so exactly one attached file survives.
    if (!(await lockProduct(tx, tenant, input.productId))) throw new DigitalProductMissing();
    const locked = await lockProductFileUploadForAttach(tx, {
      id: input.uploadId,
      teamId: tenant.storeId,
      productId: input.productId,
      purpose: "product",
    });
    if (!locked) throw new CatalogValidationError([{ field: "file", message: "This file cannot be used for this product." }]);
    await markFileUploadAttached(tx, locked.id);
    return deleteOtherAttachedProductFiles(tx, { productId: input.productId, keepId: locked.id });
  });
  if (replacedKeys.length > 0) {
    try {
      await files.delete(replacedKeys);
    } catch {
      // The sweep or a later cleanup gets it; the product already points at the new file.
    }
  }
  return { fileName: upload.fileName };
}

// publishProduct in service.ts asks here first: null means the product is not digital
// (the caller takes the physical path).
export async function digitalPublishProblemsFor(
  db: Database,
  tenant: TenantContext,
  productId: string,
): Promise<{ field: string; message: string }[] | null> {
  const product = await getProduct(db, tenant, productId);
  if (!product || product.kind !== "digital") return null;
  const [variants, file] = await Promise.all([
    listVariants(db, tenant, productId),
    findAttachedProductFile(db, productId),
  ]);
  return digitalPublishProblems(
    { title: product.title, description: product.description, priceMinor: variants[0]?.priceMinor ?? 0 },
    file !== null,
  );
}
