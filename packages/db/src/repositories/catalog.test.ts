import type { TenantContext } from "@jendal-workspace/core";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProduct,
  seedServicesTeam,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { products } from "../schema/catalog";
import {
  countDigitalProducts,
  countSellableDigitalProducts,
  deleteImages,
  deleteVariants,
  getProduct,
  insertImages,
  insertProduct,
  insertVariants,
  listImages,
  listProducts,
  listPublishedDigitalProducts,
  listVariants,
  lockProduct,
  setProductStatus,
  updateProduct,
  updateVariantPrice,
} from "./catalog";
import { setServicesTeamStoreEnabled } from "./services-teams";

async function makeStore(db: ReturnType<typeof createTestDb>): Promise<TenantContext> {
  const { organizationId } = await seedOrganization(db);
  const store = await seedStore(db, { organizationId, slug: `shop-${crypto.randomUUID().slice(0, 8)}` });
  return {
    storeId: store.id,
    organizationId,
    slug: store.slug,
    paypalMerchantId: null,
    channel: "admin",
    environment: "sandbox",
  };
}

function otherTenant(tenant: TenantContext): TenantContext {
  return { ...tenant, storeId: "other-store" };
}

describe.skipIf(!hasTestDatabase)("catalog repositories", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  describe("products", () => {
    it("inserts a product and reads it back, scoped to the store", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });

      expect(await getProduct(db, tenant, product.id)).toMatchObject({
        id: product.id,
        title: "Lamp",
        status: "draft",
        chargeTax: true,
        requiresShipping: true,
      });
      expect(await getProduct(db, otherTenant(tenant), product.id)).toBeNull();
    });

    it("locks a product only for its own store", async () => {
      const tenant = await makeStore(db);
      const other = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });

      await db.transaction(async (tx) => {
        expect(await lockProduct(tx, tenant, product.id)).toBe(product.id);
      });
      expect(await lockProduct(db, other, product.id)).toBeNull();
      expect(await lockProduct(db, tenant, crypto.randomUUID())).toBeNull();
    });

    it("lists only the store's own products", async () => {
      const tenant = await makeStore(db);
      await insertProduct(db, tenant, { title: "A" });
      await insertProduct(db, tenant, { title: "B" });

      const rows = await listProducts(db, tenant);
      expect(rows.map((row) => row.title).sort()).toEqual(["A", "B"]);
      expect(await listProducts(db, otherTenant(tenant))).toEqual([]);
    });

    it("updates the fields it is given", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });

      const updated = await updateProduct(db, tenant, product.id, { title: "Big lamp", chargeTax: false });
      expect(updated).toMatchObject({ title: "Big lamp", chargeTax: false });
    });

    it("publishes with a timestamp and unpublishes back to draft", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });

      const published = await setProductStatus(db, tenant, product.id, "published");
      expect(published?.status).toBe("published");
      expect(published?.publishedAt).toBeInstanceOf(Date);

      const unpublished = await setProductStatus(db, tenant, product.id, "draft");
      expect(unpublished?.status).toBe("draft");
    });
  });

  describe("variants", () => {
    it("replaces a product's variants", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });
      await insertVariants(db, tenant, product.id, [
        { options: [{ name: "Color", value: "Red" }], sku: "LAMP-RED", priceMinor: 4200, stock: 3 },
      ]);

      await deleteVariants(db, tenant, product.id);
      await insertVariants(db, tenant, product.id, [{ options: [], sku: "LAMP-1", priceMinor: 4500, stock: 5 }]);

      const variants = await listVariants(db, tenant, product.id);
      expect(variants).toHaveLength(1);
      expect(variants[0]).toMatchObject({ sku: "LAMP-1", priceMinor: 4500, stock: 5 });
    });

    it("updates a variant's price, scoped to the store", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });
      const [variant] = await insertVariants(db, tenant, product.id, [
        { options: [], sku: "", priceMinor: 100, stock: 0 },
      ]);

      await updateVariantPrice(db, tenant, variant!.id, 4500);
      expect((await listVariants(db, tenant, product.id))[0]).toMatchObject({ priceMinor: 4500 });

      // Another store's tenant cannot touch this variant.
      await updateVariantPrice(db, otherTenant(tenant), variant!.id, 1);
      expect((await listVariants(db, tenant, product.id))[0]).toMatchObject({ priceMinor: 4500 });
    });

    it("enforces one SKU per store, case-insensitively, but allows it in another store", async () => {
      const tenant = await makeStore(db);
      const other = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });
      const otherProduct = await insertProduct(db, other, { title: "Lamp" });
      await insertVariants(db, tenant, product.id, [{ options: [], sku: "LAMP-1", priceMinor: 1, stock: 0 }]);

      // Drizzle wraps the postgres error; the 23505 code and constraint name live on the cause.
      const failure = await insertVariants(db, tenant, product.id, [
        { options: [], sku: "lamp-1", priceMinor: 1, stock: 0 },
      ]).catch((error: unknown) => error);
      expect(failure).toMatchObject({ cause: { code: "23505", constraint_name: "uq_variants_store_sku" } });

      const [otherVariant] = await insertVariants(db, other, otherProduct.id, [
        { options: [], sku: "lamp-1", priceMinor: 1, stock: 0 },
      ]);
      expect(otherVariant?.sku).toBe("lamp-1");
    });

    it("refuses out-of-range prices and stock, and an unknown product status", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });

      const badPrice = await insertVariants(db, tenant, product.id, [
        { options: [], sku: "", priceMinor: 100_000_000, stock: 0 },
      ]).catch((error: unknown) => error);
      expect(badPrice).toMatchObject({ cause: { code: "23514", constraint_name: "variants_price_check" } });

      const badStock = await insertVariants(db, tenant, product.id, [
        { options: [], sku: "", priceMinor: 100, stock: -1 },
      ]).catch((error: unknown) => error);
      expect(badStock).toMatchObject({ cause: { code: "23514", constraint_name: "variants_stock_check" } });

      const badStatus = await db
        .insert(products)
        .values({ storeId: tenant.storeId, title: "Lamp", status: "archived" })
        .catch((error: unknown) => error);
      expect(badStatus).toMatchObject({ cause: { code: "23514", constraint_name: "products_status_check" } });
    });
  });

  describe("digital products", () => {
    it("insertProduct stores the kind and listPublishedDigitalProducts returns title, description and price", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, {
        kind: "digital",
        title: "Icon pack",
        description: "120 icons.",
        brand: "",
        category: "",
        chargeTax: true,
        requiresShipping: false,
        channel3ProductId: null,
      });
      expect(product.kind).toBe("digital");
      await insertVariants(db, tenant, product.id, [
        { options: [], sku: "", priceMinor: 1900, stock: 0 },
      ]);
      await setProductStatus(db, tenant, product.id, "published");

      const listed = await listPublishedDigitalProducts(db, tenant.storeId);
      expect(listed).toEqual([
        { id: product.id, title: "Icon pack", description: "120 icons.", priceMinor: 1900 },
      ]);
      expect(await countDigitalProducts(db, tenant.storeId)).toBe(1);
    });

    it("ignores drafts and physical products", async () => {
      const tenant = await makeStore(db);
      const draft = await insertProduct(db, tenant, { kind: "digital", title: "Draft pack" });
      await insertVariants(db, tenant, draft.id, [{ options: [], sku: "", priceMinor: 900, stock: 0 }]);
      const physical = await insertProduct(db, tenant, { title: "Lamp" });
      await insertVariants(db, tenant, physical.id, [{ options: [], sku: "", priceMinor: 4200, stock: 3 }]);
      await setProductStatus(db, tenant, physical.id, "published");

      expect(await listPublishedDigitalProducts(db, tenant.storeId)).toEqual([]);
      expect(await countDigitalProducts(db, tenant.storeId)).toBe(1);
    });

    it("counts published digital products as sellable only while the store is on", async () => {
      const { organizationId } = await seedOrganization(db);
      const seller = await seedServicesTeam(db, { organizationId, slug: "maker" });
      await seedProduct(db, { storeId: seller.id, kind: "digital", status: "published", priceMinor: 1900 });
      await seedProduct(db, { storeId: seller.id, kind: "digital", status: "published", priceMinor: 900 });
      await seedProduct(db, { storeId: seller.id, kind: "digital" });

      expect(await countSellableDigitalProducts(db, seller.id)).toBe(0);
      await setServicesTeamStoreEnabled(db, seller.id, true);
      expect(await countSellableDigitalProducts(db, seller.id)).toBe(2);
    });
  });

  describe("images", () => {
    it("replaces a product's images and keeps their order", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });
      await insertImages(db, tenant, product.id, [
        { imageKey: `stores/${tenant.storeId}/images/a.png`, alt: "front" },
        { imageKey: `stores/${tenant.storeId}/images/b.png`, alt: "" },
      ]);

      await deleteImages(db, tenant, product.id);
      await insertImages(db, tenant, product.id, [
        { imageKey: `stores/${tenant.storeId}/images/c.png`, alt: "back" },
        { imageKey: `stores/${tenant.storeId}/images/d.png`, alt: "side" },
      ]);

      const images = await listImages(db, tenant, product.id);
      expect(images.map((image) => [image.alt, image.position])).toEqual([
        ["back", 0],
        ["side", 1],
      ]);
    });
  });
});
