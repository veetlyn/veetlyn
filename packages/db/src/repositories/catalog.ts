import type { TenantContext, VariantOption } from "@jendal-workspace/core";
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../index";
import { productImages, products, productVariants } from "../schema/catalog";

export type ProductRow = typeof products.$inferSelect;
export type VariantRow = typeof productVariants.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;

export type ProductFields = {
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
