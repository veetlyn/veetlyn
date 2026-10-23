import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProduct,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  seedStore,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { fileUpload } from "@jendal-workspace/db/schema/files";
import { and, eq } from "drizzle-orm";
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
  const callerFor = (
    userId: string | null,
    catalog: CatalogServices = createTestCatalogServices(),
    files = createFakeFileStore(),
  ) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog,
      files,
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
    expect(fetched.variants[0]).toMatchObject({ sku: "LAMP-1", priceMinor: 4200, stock: 5 });

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

  it("updates a published product, keeps it publishable, and reports unknown products as NOT_FOUND", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });
    await caller.catalog.publish({ storeSlug: "lamp-shop", id: created.product.id });

    const updated = await caller.catalog.update({
      storeSlug: "lamp-shop",
      id: created.product.id,
      ...productInput,
      title: "Floor lamp",
      variants: [{ options: [], sku: "FLOOR-1", priceMinor: 9900, stock: 2 }],
    });
    expect(updated.product).toMatchObject({ title: "Floor lamp", status: "published" });

    await expect(
      caller.catalog.update({
        storeSlug: "lamp-shop",
        id: created.product.id,
        ...productInput,
        variants: [{ options: [], sku: "FLOOR-1", priceMinor: 0, stock: 2 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Set a price above zero before publishing." });
    const stored = await caller.catalog.get({ storeSlug: "lamp-shop", id: created.product.id });
    expect(stored.product.title).toBe("Floor lamp");
    expect(stored.variants).toHaveLength(1);
    expect(stored.variants[0]).toMatchObject({ sku: "FLOOR-1", priceMinor: 9900 });

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

  describe("digital products", () => {
    const draft = { title: "Icon pack", description: "120 icons.", priceMinor: 1900 };

    async function servicesSeller(slug = "team") {
      const { userId, teamId, organizationId } = await seedServicesTeamWithAdmin(db, { slug });
      return { userId, teamId, organizationId, slug };
    }

    async function uploadAndAttach(
      caller: ReturnType<typeof callerFor>,
      files: ReturnType<typeof createFakeFileStore>,
      slug: string,
      productId: string,
      fileName: string,
      sizeBytes: number,
    ) {
      const started = await caller.catalog.fileUploadStart({ storeSlug: slug, productId, fileName, sizeBytes });
      const key = new URL(started.url).pathname.slice(1);
      files.put(key, sizeBytes);
      await caller.catalog.fileAttach({ storeSlug: slug, productId, uploadId: started.uploadId });
      return key;
    }

    it("creates, updates, lists and publishes a digital product", async () => {
      const { userId, slug } = await servicesSeller();
      const files = createFakeFileStore();
      const caller = callerFor(userId, createTestCatalogServices(), files);

      const created = await caller.catalog.digitalCreate({ storeSlug: slug, ...draft });
      expect(created).toMatchObject({ title: "Icon pack", status: "draft", priceMinor: 1900, fileName: null });

      const updated = await caller.catalog.digitalUpdate({
        storeSlug: slug,
        id: created.id,
        ...draft,
        description: "140 icons.",
        priceMinor: 2400,
      });
      expect(updated).toMatchObject({ description: "140 icons.", priceMinor: 2400 });

      const list = await caller.catalog.digitalList({ storeSlug: slug });
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: created.id, status: "draft", priceMinor: 2400, fileName: null });

      await expect(caller.catalog.publish({ storeSlug: slug, id: created.id })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Add the file buyers download before publishing.",
      });

      const key = await uploadAndAttach(caller, files, slug, created.id, "icons.zip", 1234);
      expect(files.puts[0]).toMatchObject({ key, sizeBytes: 1234 });

      const detail = await caller.catalog.digitalGet({ storeSlug: slug, id: created.id });
      expect(detail.fileName).toBe("icons.zip");

      const published = await caller.catalog.publish({ storeSlug: slug, id: created.id });
      expect(published.product.status).toBe("published");
    });

    it("lets a services-team admin whose workspace role is member manage products", async () => {
      const { organizationId, teamId, slug } = await servicesSeller();
      const adminId = await seedServicesTeamMember(db, { organizationId, teamId, role: "admin" });
      const created = await callerFor(adminId).catalog.digitalCreate({ storeSlug: slug, ...draft });
      expect(created).toMatchObject({ title: "Icon pack", status: "draft" });
    });

    it("refuses product management to services-team members without manage_settings", async () => {
      const { userId, organizationId, teamId, slug } = await servicesSeller();
      const files = createFakeFileStore();
      const owner = callerFor(userId, createTestCatalogServices(), files);
      const created = await owner.catalog.digitalCreate({ storeSlug: slug, ...draft });
      await uploadAndAttach(owner, files, slug, created.id, "icons.zip", 1234);

      for (const role of ["manager", "freelancer"] as const) {
        const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role, name: role });
        const caller = callerFor(memberId);
        const forbidden = { code: "FORBIDDEN", message: "Only an admin can manage products." };
        await expect(caller.catalog.digitalCreate({ storeSlug: slug, ...draft })).rejects.toMatchObject(forbidden);
        await expect(caller.catalog.digitalList({ storeSlug: slug })).rejects.toMatchObject(forbidden);
        await expect(caller.catalog.publish({ storeSlug: slug, id: created.id })).rejects.toMatchObject(forbidden);
      }

      await owner.catalog.publish({ storeSlug: slug, id: created.id });
      const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
      await expect(callerFor(freelancerId).catalog.unpublish({ storeSlug: slug, id: created.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("reports a services team as missing to outsiders", async () => {
      const { organizationId, slug } = await servicesSeller();
      const outsider = await seedOrganization(db);
      // In the workspace, but with no role in the services team.
      const sameWorkspaceStranger = await addMember(db, { organizationId, role: "member" });
      for (const userId of [outsider.userId, sameWorkspaceStranger]) {
        await expect(callerFor(userId).catalog.digitalCreate({ storeSlug: slug, ...draft })).rejects.toMatchObject({
          code: "NOT_FOUND",
          message: "Store not found.",
        });
      }
    });

    it("keeps a published product publishable when it is edited", async () => {
      const { userId, slug } = await servicesSeller();
      const files = createFakeFileStore();
      const caller = callerFor(userId, createTestCatalogServices(), files);
      const created = await caller.catalog.digitalCreate({ storeSlug: slug, ...draft });
      await uploadAndAttach(caller, files, slug, created.id, "icons.zip", 1234);
      await caller.catalog.publish({ storeSlug: slug, id: created.id });

      await expect(
        caller.catalog.digitalUpdate({ storeSlug: slug, id: created.id, ...draft, priceMinor: 0 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Set a price above zero before publishing." });
      const detail = await caller.catalog.digitalGet({ storeSlug: slug, id: created.id });
      expect(detail).toMatchObject({ status: "published", priceMinor: 1900, title: "Icon pack" });
    });

    it("refuses a digital create on a store team", async () => {
      const { userId } = await ownerWithStore();
      await expect(
        callerFor(userId).catalog.digitalCreate({ storeSlug: "lamp-shop", ...draft }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("refuses the physical catalog procedures on a services team", async () => {
      const { userId, slug } = await servicesSeller();
      const caller = callerFor(userId);
      await expect(caller.catalog.list({ storeSlug: slug })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "Physical products are managed from a store.",
      });
      await expect(
        caller.catalog.create({
          storeSlug: slug,
          title: "Lamp",
          description: "",
          brand: "",
          category: "",
          chargeTax: true,
          requiresShipping: true,
          variants: [],
          images: [],
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("reads a physical product as missing through the digital procedures", async () => {
      const { userId, teamId, slug } = await servicesSeller();
      const physical = await seedProduct(db, { storeId: teamId, kind: "physical" });
      await expect(
        callerFor(userId).catalog.digitalGet({ storeSlug: slug, id: physical.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("replaces the file: the old row and object are deleted", async () => {
      const { userId, slug } = await servicesSeller();
      const files = createFakeFileStore();
      const caller = callerFor(userId, createTestCatalogServices(), files);
      const created = await caller.catalog.digitalCreate({ storeSlug: slug, ...draft });

      const keyA = await uploadAndAttach(caller, files, slug, created.id, "icons-a.zip", 100);
      await uploadAndAttach(caller, files, slug, created.id, "icons-b.zip", 200);

      expect(files.deletes).toContainEqual([keyA]);
      const detail = await caller.catalog.digitalGet({ storeSlug: slug, id: created.id });
      expect(detail.fileName).toBe("icons-b.zip");
      const remaining = await db
        .select({ fileName: fileUpload.fileName })
        .from(fileUpload)
        .where(and(eq(fileUpload.productId, created.id), eq(fileUpload.purpose, "product")));
      expect(remaining).toEqual([{ fileName: "icons-b.zip" }]);
    });

    it("validates: empty title and a bad price are refused before anything is written", async () => {
      const { userId, slug } = await servicesSeller();
      const caller = callerFor(userId);

      await expect(caller.catalog.digitalCreate({ storeSlug: slug, ...draft, title: " " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Add a title.",
      });
      await expect(caller.catalog.digitalCreate({ storeSlug: slug, ...draft, priceMinor: -5 })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(await caller.catalog.digitalList({ storeSlug: slug })).toEqual([]);
    });
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
