import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedStore,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestCatalogServices, type CatalogServices } from "../testing/catalog";
import type { Context } from "../context";
import { appRouter } from "./index";

type SessionValue = NonNullable<Context["session"]>;

function makeSession(userId: string): SessionValue {
  const now = new Date();
  return {
    session: {
      id: "session-1",
      token: "token-1",
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Someone",
      email: `${userId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const productInput = {
  title: "Desk lamp",
  description: "",
  brand: "",
  category: "",
  chargeTax: true,
  requiresShipping: true,
  variants: [{ options: [], sku: "LAMP-1", priceMinor: 4200, stock: 5 }],
  images: [],
};

describe.skipIf(!hasTestDatabase)("catalog router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null, catalog: CatalogServices = createTestCatalogServices()) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog,
      files: createFakeFileStore(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  // An owner opens every store of their organization (core canOpenStore); the session is fabricated,
  // so tests never touch the auth flows.
  async function ownerWithStore(slug = "lamp-shop") {
    const { organizationId } = await seedOrganization(db);
    const userId = await addMember(db, { organizationId, role: "owner" });
    await seedStore(db, { organizationId, slug });
    return { userId, organizationId };
  }

  it("creates, reads and lists products inside the caller's store", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);

    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });
    expect(created.product).toMatchObject({ title: "Desk lamp", status: "draft" });

    const fetched = await caller.catalog.get({ storeSlug: "lamp-shop", id: created.product.id });
    expect(fetched.variants[0]).toMatchObject({ sku: "LAMP-1", priceMinor: 4200 });

    const list = await caller.catalog.list({ storeSlug: "Lamp-Shop" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Desk lamp", variantCount: 1, priceLow: 4200 });
  });

  it("rejects anonymous callers", async () => {
    await expect(callerFor(null).catalog.list({ storeSlug: "lamp-shop" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("hides another merchant's store", async () => {
    const { userId } = await ownerWithStore();
    const stranger = await seedUser(db, "Stranger");

    await expect(callerFor(stranger).catalog.list({ storeSlug: "lamp-shop" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Store not found.",
    });
    await callerFor(userId).catalog.create({ storeSlug: "lamp-shop", ...productInput });
    expect(await callerFor(userId).catalog.list({ storeSlug: "lamp-shop" })).toHaveLength(1);
  });

  it("maps a duplicate SKU to CONFLICT", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });

    await expect(caller.catalog.create({ storeSlug: "lamp-shop", ...productInput })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That SKU is already in use in this store.",
    });
  });

  it("maps validation failures to BAD_REQUEST with the first problem message", async () => {
    const { userId } = await ownerWithStore();

    await expect(
      callerFor(userId).catalog.create({ storeSlug: "lamp-shop", ...productInput, title: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Add a title." });
  });

  it("publishes only a priced product and unpublishes it", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });

    const published = await caller.catalog.publish({ storeSlug: "lamp-shop", id: created.product.id });
    expect(published.product.status).toBe("published");

    const unpublished = await caller.catalog.unpublish({ storeSlug: "lamp-shop", id: created.product.id });
    expect(unpublished.product.status).toBe("draft");

    const free = await caller.catalog.create({
      storeSlug: "lamp-shop",
      ...productInput,
      variants: [{ options: [], sku: "FREE", priceMinor: 0, stock: 1 }],
    });
    await expect(caller.catalog.publish({ storeSlug: "lamp-shop", id: free.product.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Set a price above zero before publishing.",
    });
  });

  it("updates a product and reports unknown products as NOT_FOUND", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });

    const updated = await caller.catalog.update({
      storeSlug: "lamp-shop",
      id: created.product.id,
      ...productInput,
      title: "Floor lamp",
      variants: [{ options: [], sku: "FLOOR-1", priceMinor: 9900, stock: 2 }],
    });
    expect(updated.product.title).toBe("Floor lamp");

    await expect(
      caller.catalog.get({ storeSlug: "lamp-shop", id: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers unavailable for Channel3 lookups when the source is not configured", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId, createTestCatalogServices({ source: null }));

    expect(await caller.catalog.lookupFromUrl({ storeSlug: "lamp-shop", url: "https://shop.example.com/p/1" })).toEqual(
      { status: "unavailable" },
    );
    expect(
      await caller.catalog.lookupFromPhoto({ storeSlug: "lamp-shop", base64Image: "aGk=" }),
    ).toEqual({ status: "unavailable" });
  });

  it("returns a market price result for the store's own product only", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });

    const report = await caller.catalog.marketPrice({ storeSlug: "lamp-shop", productId: created.product.id });
    expect(report.status).toBe("no_offers");

    await expect(
      caller.catalog.marketPrice({ storeSlug: "lamp-shop", productId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
