import type { ProductKind, TenantContext, VariantOption } from "@jendal-workspace/core";
import { and, asc, count, eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import type { Database } from "../index";
import { productImages, products, productVariants } from "../schema/catalog";

export type ProductRow = typeof products.$inferSelect;
export type VariantRow = typeof productVariants.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;

export type ProductFields = {
  kind: ProductKind;
  title: string;
  description: string;
  brand: string;
  category: string;
  chargeTax: boolean;
  requiresShipping: boolean;
  channel3ProductId: string | null;
};

export type NewVariant = { options: VariantOption[]; sku: string; priceMinor: number; stock: number };
export type NewImage = { imageKey: string; alt: string };

export async function insertProduct(
  db: Database,
  tenant: TenantContext,
  fields: Pick<ProductFields, "title"> & Partial<ProductFields>,
): Promise<ProductRow> {
  const [row] = await db
    .insert(products)
    .values({ storeId: tenant.storeId, ...fields })
    .returning();
  if (!row) throw new Error("Insert into products returned no row");
  return row;
}

export async function getProduct(db: Database, tenant: TenantContext, id: string): Promise<ProductRow | null> {
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.storeId, tenant.storeId)))
    .limit(1);
  return row ?? null;
}

// Holds the product row until the transaction ends so changes to its files happen one at a time.
export async function lockProduct(tx: DbExecutor, tenant: TenantContext, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), eq(products.storeId, tenant.storeId)))
    .limit(1)
    .for("update");
  return row?.id ?? null;
}

export async function listProducts(db: Database, tenant: TenantContext): Promise<ProductRow[]> {
  return db.select().from(products).where(eq(products.storeId, tenant.storeId)).orderBy(products.createdAt);
}

export async function updateProduct(
  db: Database,
  tenant: TenantContext,
  id: string,
  fields: Partial<ProductFields>,
): Promise<ProductRow | null> {
  const [row] = await db
    .update(products)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.storeId, tenant.storeId)))
    .returning();
  return row ?? null;
}

export async function setProductStatus(
  db: Database,
  tenant: TenantContext,
  id: string,
  status: "draft" | "published",
): Promise<ProductRow | null> {
  const [row] = await db
    .update(products)
    .set({ status, ...(status === "published" ? { publishedAt: new Date() } : {}), updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.storeId, tenant.storeId)))
    .returning();
  return row ?? null;
}

export async function listVariants(db: Database, tenant: TenantContext, productId: string): Promise<VariantRow[]> {
  return db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.storeId, tenant.storeId)))
    .orderBy(productVariants.createdAt);
}

export async function insertVariants(
  db: Database,
  tenant: TenantContext,
  productId: string,
  variants: NewVariant[],
): Promise<VariantRow[]> {
  if (variants.length === 0) return [];
  return db
    .insert(productVariants)
    .values(
      variants.map((variant) => ({
        storeId: tenant.storeId,
        productId,
        options: variant.options,
        sku: variant.sku.trim() || null,
        priceMinor: variant.priceMinor,
        stock: variant.stock,
      })),
    )
    .returning();
}

export async function deleteVariants(db: Database, tenant: TenantContext, productId: string): Promise<void> {
  await db
    .delete(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.storeId, tenant.storeId)));
}

// Stock never goes below zero; an oversell clamps to 0 (platform spec §6.1).
export async function updateVariantStock(
  db: Database,
  tenant: TenantContext,
  variantId: string,
  delta: number,
): Promise<VariantRow | null> {
  const [row] = await db
    .update(productVariants)
    .set({ stock: sql`greatest(0, ${productVariants.stock} + ${delta})`, updatedAt: new Date() })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, tenant.storeId)))
    .returning();
  return row ?? null;
}

// A digital product's one hidden variant holds the price; it is updated in place.
export async function updateVariantPrice(
  db: DbExecutor,
  tenant: TenantContext,
  variantId: string,
  priceMinor: number,
): Promise<void> {
  await db
    .update(productVariants)
    .set({ priceMinor, updatedAt: new Date() })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, tenant.storeId)));
}

export async function listImages(db: Database, tenant: TenantContext, productId: string): Promise<ProductImageRow[]> {
  return db
    .select()
    .from(productImages)
    .where(and(eq(productImages.productId, productId), eq(productImages.storeId, tenant.storeId)))
    .orderBy(productImages.position);
}

export async function insertImages(
  db: Database,
  tenant: TenantContext,
  productId: string,
  images: NewImage[],
): Promise<ProductImageRow[]> {
  if (images.length === 0) return [];
  return db
    .insert(productImages)
    .values(
      images.map((image, position) => ({
        storeId: tenant.storeId,
        productId,
        imageKey: image.imageKey,
        alt: image.alt,
        position,
      })),
    )
    .returning();
}

export async function deleteImages(db: Database, tenant: TenantContext, productId: string): Promise<void> {
  await db
    .delete(productImages)
    .where(and(eq(productImages.productId, productId), eq(productImages.storeId, tenant.storeId)));
}

// Run 4a: digital products are sold from the seller page; a digital product has exactly one variant.
// These run outside a TenantContext (the seller page and its router only have a store id), so they take
// the store id directly.
export type SellerProductRow = { id: string; title: string; description: string; priceMinor: number };

export async function listPublishedDigitalProducts(db: DbExecutor, storeId: string): Promise<SellerProductRow[]> {
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      description: products.description,
      priceMinor: productVariants.priceMinor,
    })
    .from(products)
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(eq(products.storeId, storeId), eq(products.kind, "digital"), eq(products.status, "published")))
    .orderBy(asc(products.createdAt), asc(productVariants.createdAt));
  // One row per variant; digital products have one, but a hand-edited row set still yields one card.
  const byId = new Map<string, SellerProductRow>();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()];
}

export async function countPublishedDigitalProducts(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.kind, "digital"), eq(products.status, "published")));
  return row?.count ?? 0;
}

export async function countDigitalProducts(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.kind, "digital")));
  return row?.count ?? 0;
}
