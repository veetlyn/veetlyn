import {
  SkuTakenError,
  SourceError,
  buildProductPrefill,
  createFakeImageDownloader,
  createFakeImageStore,
  createFakeProductSource,
  type ProductDraft,
  type SourceProduct,
  type TenantContext,
} from "@jendal-workspace/core";
import { createTestDb, hasTestDatabase, seedOrganization, seedStore, truncateAll } from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestCatalogServices } from "../testing/catalog";
import { CatalogValidationError } from "./errors";
import {
  createProduct,
  getMarketPrice,
  getProductDetail,
  listProductSummaries,
  prefillFromMatch,
  prefillFromPhoto,
  prefillFromUrl,
  publishProduct,
  unpublishProduct,
  updateProduct,
} from "./service";

const db = createTestDb();

async function makeTenant(): Promise<TenantContext> {
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

function draft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    title: "Desk lamp",
    description: "",
    brand: "",
    category: "",
    chargeTax: true,
    requiresShipping: true,
    variants: [{ options: [], sku: "LAMP-1", priceMinor: 4200, stock: 5 }],
    images: [],
    ...overrides,
  };
}

function sourceProduct(overrides: Partial<SourceProduct> = {}): SourceProduct {
  return {
    id: "c3-1",
    title: "Trail Runner",
    description: "A shoe.",
    brands: ["Acme"],
    images: [],
    category: null,
    variantOptions: [],
    offers: [],
    ...overrides,
  };
}

describe.skipIf(!hasTestDatabase)("catalog service", () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  describe("createProduct", () => {
    it("stores the product with its variants", async () => {
      const tenant = await makeTenant();
      const detail = await createProduct(db, tenant, createTestCatalogServices(), draft());

      expect(detail.product).toMatchObject({ title: "Desk lamp", status: "draft" });
      expect(detail.variants).toHaveLength(1);
      expect(detail.variants[0]).toMatchObject({ sku: "LAMP-1", priceMinor: 4200, stock: 5 });
    });

    it("rejects an invalid draft with the core problems", async () => {
      const tenant = await makeTenant();
      await expect(
        createProduct(db, tenant, createTestCatalogServices(), draft({ title: "" })),
      ).rejects.toThrow(CatalogValidationError);
    });

    it("maps a duplicate SKU to SkuTakenError", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      await createProduct(db, tenant, services, draft());

      await expect(createProduct(db, tenant, services, draft())).rejects.toBeInstanceOf(SkuTakenError);
    });

    it("keeps uploaded image keys and downloads source-URL images into the image store", async () => {
      const tenant = await makeTenant();
      const images = createFakeImageStore();
      const services = createTestCatalogServices({ images });
      const detail = await createProduct(
        db,
        tenant,
        services,
        draft({
          images: [
            { imageKey: `stores/${tenant.storeId}/images/uploaded.png`, alt: "mine" },
            { sourceUrl: "https://cdn.example.com/found.jpg", alt: "found" },
          ],
        }),
      );

      expect(detail.images.map((image) => [image.imageKey, image.alt])).toEqual([
        [`stores/${tenant.storeId}/images/uploaded.png`, "mine"],
        [expect.stringMatching(new RegExp(`^stores/${tenant.storeId}/images/[0-9a-f-]{36}\\.png$`)), "found"],
      ]);
      expect(images.objects.size).toBe(1);
    });

    it("drops an image whose download fails instead of failing the save", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices({
        imageDownloader: createFakeImageDownloader({ "https://cdn.example.com/broken.jpg": null }),
      });
      const detail = await createProduct(
        db,
        tenant,
        services,
        draft({ images: [{ sourceUrl: "https://cdn.example.com/broken.jpg", alt: "" }] }),
      );

      expect(detail.images).toEqual([]);
    });

    it("refuses an image key that belongs to another store", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const detail = await createProduct(
        db,
        tenant,
        services,
        draft({ images: [{ imageKey: "stores/someone-else/images/a.png", alt: "" }] }),
      );

      expect(detail.images).toEqual([]);
    });
  });

  describe("updateProduct", () => {
    it("replaces fields, variants and images", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const created = await createProduct(db, tenant, services, draft());

      const updated = await updateProduct(db, tenant, created.product.id, services, {
        ...draft({ title: "Floor lamp", variants: [{ options: [], sku: "FLOOR-1", priceMinor: 9900, stock: 2 }] }),
        channel3ProductId: "c3-9",
      });

      expect(updated?.product).toMatchObject({ title: "Floor lamp", channel3ProductId: "c3-9" });
      expect(updated?.variants[0]).toMatchObject({ sku: "FLOOR-1", priceMinor: 9900 });
    });

    it("returns null for a product outside the store", async () => {
      const tenant = await makeTenant();
      const created = await createProduct(db, tenant, createTestCatalogServices(), draft());
      const stranger = { ...tenant, storeId: "other-store" };

      expect(await updateProduct(db, stranger, created.product.id, createTestCatalogServices(), draft())).toBeNull();
    });
  });

  describe("publish and unpublish", () => {
    it("refuses to publish without a priced variant", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const created = await createProduct(
        db,
        tenant,
        services,
        draft({ variants: [{ options: [], sku: "", priceMinor: 0, stock: 1 }] }),
      );

      await expect(publishProduct(db, tenant, created.product.id, services)).rejects.toThrow(CatalogValidationError);
    });

    it("publishes a valid product and unpublishes it again", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const created = await createProduct(db, tenant, services, draft());

      const published = await publishProduct(db, tenant, created.product.id, services);
      expect(published?.product.status).toBe("published");

      const unpublished = await unpublishProduct(db, tenant, created.product.id);
      expect(unpublished?.product.status).toBe("draft");
    });
  });

  describe("listProductSummaries", () => {
    it("summarizes price range, stock and image", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      await createProduct(
        db,
        tenant,
        services,
        draft({
          images: [{ imageKey: `stores/${tenant.storeId}/images/a.png`, alt: "" }],
          variants: [
            { options: [], sku: "A", priceMinor: 100, stock: 2 },
            { options: [], sku: "B", priceMinor: 300, stock: 4 },
          ],
        }),
      );

      const [summary] = await listProductSummaries(db, tenant);
      expect(summary).toMatchObject({
        title: "Desk lamp",
        status: "draft",
        variantCount: 2,
        priceLow: 100,
        priceHigh: 300,
        totalStock: 6,
        imageKey: `stores/${tenant.storeId}/images/a.png`,
      });
    });
  });

  describe("prefillFromUrl", () => {
    it("maps the looked-up product into a prefill with search alternatives", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({
          lookupByUrl: async () => sourceProduct(),
          searchProducts: async () => [sourceProduct(), sourceProduct({ id: "c3-2", title: "Trail Runner 2" })],
        }),
      });

      const result = await prefillFromUrl(services, "https://shop.example.com/product/1");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.prefill).toEqual(buildProductPrefill(sourceProduct()));
      expect(result.alternatives).toEqual([
        { productId: "c3-2", title: "Trail Runner 2", brand: "Acme", imageUrl: null },
      ]);
    });

    it("answers no_match when the source finds nothing", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({
          lookupByUrl: async () => {
            throw new SourceError("not_found", "No match");
          },
        }),
      });

      expect(await prefillFromUrl(services, "https://example.com")).toEqual({ status: "no_match" });
    });

    it("answers unavailable when the source fails or is not configured", async () => {
      const failing = createTestCatalogServices({
        source: createFakeProductSource({
          lookupByUrl: async () => {
            throw new SourceError("unavailable", "Channel3 answered 500");
          },
        }),
      });
      expect(await prefillFromUrl(failing, "https://example.com")).toEqual({ status: "unavailable" });

      const unconfigured = createTestCatalogServices({ source: null });
      expect(await prefillFromUrl(unconfigured, "https://example.com")).toEqual({ status: "unavailable" });
    });

    it("still answers ok when the alternatives search fails", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({
          lookupByUrl: async () => sourceProduct(),
          searchProducts: async () => {
            throw new SourceError("unavailable", "boom");
          },
        }),
      });

      const result = await prefillFromUrl(services, "https://example.com/p/1");
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.alternatives).toEqual([]);
    });
  });

  describe("prefillFromPhoto and prefillFromMatch", () => {
    it("lists photo matches as compact choices", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({
          searchByImage: async () => [sourceProduct()],
        }),
      });

      expect(await prefillFromPhoto(services, "aGk=")).toEqual({
        status: "ok",
        matches: [{ productId: "c3-1", title: "Trail Runner", brand: "Acme", imageUrl: null }],
      });
    });

    it("answers no_match for an empty photo result", async () => {
      expect(await prefillFromPhoto(createTestCatalogServices(), "aGk=")).toEqual({ status: "no_match" });
    });

    it("builds a prefill from a chosen match", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({ getProduct: async () => sourceProduct() }),
      });

      const result = await prefillFromMatch(services, "c3-1");
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.prefill.channel3ProductId).toBe("c3-1");
    });
  });

  describe("getMarketPrice", () => {
    async function linkedProduct(services = createTestCatalogServices()) {
      const tenant = await makeTenant();
      const created = await createProduct(db, tenant, services, {
        ...draft(),
        channel3ProductId: "c3-1",
      });
      return { tenant, created };
    }

    it("summarizes similar-product offers and caches them per store and product", async () => {
      const source = createFakeProductSource({
        similarProducts: async () => [
          sourceProduct({
            offers: [
              { retailer: "a.com", price: 10, currency: "USD", inStock: true },
              { retailer: "b.com", price: 30, currency: "USD", inStock: true },
            ],
          }),
        ],
      });
      const services = createTestCatalogServices({ source });
      const { tenant, created } = await linkedProduct(services);

      const first = await getMarketPrice(db, tenant, services, created.product.id, false);
      expect(first).toMatchObject({ status: "ok", low: 1000, median: 2000, high: 3000, offerCount: 2 });

      const second = await getMarketPrice(db, tenant, services, created.product.id, false);
      expect(second).toEqual(first);
      expect(source.calls.filter((call) => call.startsWith("similarProducts"))).toHaveLength(1);
    });

    it("lets one explicit refresh bypass the cache, then enforces the hourly cap", async () => {
      const source = createFakeProductSource({ similarProducts: async () => [] });
      const services = createTestCatalogServices({ source });
      const { tenant, created } = await linkedProduct(services);

      await getMarketPrice(db, tenant, services, created.product.id, false);
      await getMarketPrice(db, tenant, services, created.product.id, true);
      expect(source.calls.filter((call) => call.startsWith("similarProducts"))).toHaveLength(2);

      await getMarketPrice(db, tenant, services, created.product.id, true);
      expect(source.calls.filter((call) => call.startsWith("similarProducts"))).toHaveLength(2);
    });

    it("falls back to a text search when the product has no Channel3 ID", async () => {
      const source = createFakeProductSource({
        searchProducts: async () => [
          sourceProduct({ offers: [{ retailer: "a.com", price: 12, currency: "USD", inStock: true }] }),
        ],
      });
      const services = createTestCatalogServices({ source });
      const tenant = await makeTenant();
      const created = await createProduct(db, tenant, services, { ...draft(), brand: "Acme" });

      const report = await getMarketPrice(db, tenant, services, created.product.id, false);
      expect(report).toMatchObject({ status: "ok", low: 1200 });
      expect(source.calls.some((call) => call.startsWith("searchProducts:Acme Desk lamp"))).toBe(true);
    });

    it("answers unavailable when the source is not configured, without hitting the cache", async () => {
      const services = createTestCatalogServices({ source: null });
      const { tenant, created } = await linkedProduct(services);

      expect(await getMarketPrice(db, tenant, services, created.product.id, false)).toEqual({ status: "unavailable" });
    });

    it("answers no_offers when nothing is priced", async () => {
      const services = createTestCatalogServices({ source: createFakeProductSource() });
      const { tenant, created } = await linkedProduct(services);

      expect(await getMarketPrice(db, tenant, services, created.product.id, false)).toMatchObject({
        status: "no_offers",
      });
    });

    it("returns null for a product outside the store", async () => {
      const services = createTestCatalogServices();
      const { tenant, created } = await linkedProduct(services);

      expect(await getMarketPrice(db, { ...tenant, storeId: "other-store" }, services, created.product.id, false)).toBeNull();
    });
  });

  describe("getProductDetail", () => {
    it("returns the product with variants and images", async () => {
      const tenant = await makeTenant();
      const created = await createProduct(db, tenant, createTestCatalogServices(), draft());

      const detail = await getProductDetail(db, tenant, created.product.id);
      expect(detail?.variants).toHaveLength(1);
      expect(await getProductDetail(db, { ...tenant, storeId: "other-store" }, created.product.id)).toBeNull();
    });
  });
});
