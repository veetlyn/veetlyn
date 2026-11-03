import { createTestAuth, signUpVerified } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import {
  addMember,
  addTeamMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { team } from "@jendal-workspace/db/schema/organization";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("store router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("lists every store of the organizations an owner belongs to", async () => {
    const { userId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    const acme = await seedStore(db, { organizationId, slug: "acme", name: "Acme" });

    await expect(callerFor(userId).store.listMine()).resolves.toEqual([
      { id: organizationId, name: "Acme Inc", role: "owner", canCreateStores: true, stores: [acme] },
    ]);
  });

  it("lists only the team stores of other members", async () => {
    const { organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    const acme = await seedStore(db, { organizationId, slug: "acme" });
    await seedStore(db, { organizationId, slug: "beta" });
    const staffId = await addMember(db, { organizationId, role: "member" });
    await addTeamMember(db, { teamId: acme.id, userId: staffId });

    await expect(callerFor(staffId).store.listMine()).resolves.toEqual([
      { id: organizationId, name: "Acme Inc", role: "member", canCreateStores: false, stores: [acme] },
    ]);
  });

  it("rejects anonymous callers", async () => {
    await expect(callerFor(null).store.listMine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns a store and the caller's role to owners, whatever the slug's case", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const acme = await seedStore(db, { organizationId, slug: "acme" });

    await expect(callerFor(userId).store.get({ storeSlug: " ACME " })).resolves.toEqual({ ...acme, role: "owner" });
  });

  it("returns a store to members of its team", async () => {
    const { organizationId } = await seedOrganization(db);
    const acme = await seedStore(db, { organizationId, slug: "acme" });
    const staffId = await addMember(db, { organizationId, role: "member" });
    await addTeamMember(db, { teamId: acme.id, userId: staffId });

    await expect(callerFor(staffId).store.get({ storeSlug: "acme" })).resolves.toEqual({ ...acme, role: "member" });
  });

  it("reports a store as not found to members outside its team", async () => {
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });
    const staffId = await addMember(db, { organizationId, role: "member" });

    await expect(callerFor(staffId).store.get({ storeSlug: "acme" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Store not found.",
    });
  });

  it("reports another merchant's store as not found", async () => {
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });
    const outsider = await seedOrganization(db);

    await expect(callerFor(outsider.userId).store.get({ storeSlug: "acme" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Store not found.",
    });
  });
});

describe.skipIf(!hasTestDatabase)("store creation", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function signedInCaller(email = "ada@example.com") {
    const { headers } = await signUpVerified(auth, db, email);
    const session = await auth.api.getSession({ headers });
    return appRouter.createCaller({
      db,
      session,
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers,
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });
  }

  it("reports an address as available, taken or invalid", async () => {
    const caller = await signedInCaller();
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "taken-shop" });

    await expect(caller.store.checkSlug({ slug: " Acme " })).resolves.toEqual({ status: "available", slug: "acme" });
    await expect(caller.store.checkSlug({ slug: "taken-shop" })).resolves.toEqual({ status: "taken", slug: "taken-shop" });
    await expect(caller.store.checkSlug({ slug: "login" })).resolves.toEqual({ status: "invalid", reason: "reserved" });
    await expect(caller.store.checkSlug({ slug: "a_b" })).resolves.toEqual({ status: "invalid", reason: "format" });
  });

  it("gives each new store a workspace of its own, named after it", async () => {
    const caller = await signedInCaller();

    await expect(caller.store.create({ name: "Acme", slug: "acme" })).resolves.toEqual({ slug: "acme" });
    await expect(caller.store.create({ name: "Beta", slug: "beta" })).resolves.toEqual({ slug: "beta" });

    const organizations = await caller.store.listMine();
    expect(organizations.map((o) => [o.name, o.role, o.stores.map((s) => s.slug)]).sort()).toEqual([
      ["Acme", "owner", ["acme"]],
      ["Beta", "owner", ["beta"]],
    ]);
  });

  it("creates the store as a store product with the merchant's email for support", async () => {
    const caller = await signedInCaller("owner@acme.test");

    await caller.store.create({ name: "Acme", slug: "acme" });

    const [row] = await db.select().from(team).where(eq(team.slug, "acme"));
    expect(row).toMatchObject({ product: "store", supportEmail: "owner@acme.test" });
  });

  it("reports a taken address and reuses an empty workspace on retry", async () => {
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });
    const caller = await signedInCaller();

    await expect(caller.store.create({ name: "Acme", slug: "acme" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This store address is already taken.",
    });
    await expect(caller.store.create({ name: "Acme", slug: "acme-shop" })).resolves.toEqual({ slug: "acme-shop" });

    const organizations = await caller.store.listMine();
    expect(organizations).toHaveLength(1);
    expect(organizations[0]?.stores.map((s) => s.slug)).toEqual(["acme-shop"]);
  });

  it("puts the next store in a workspace left empty by a failed creation", async () => {
    const { headers } = await signUpVerified(auth, db, "retry@example.com");
    const empty = await auth.api.createOrganization({ body: { name: "Acme", slug: "org-empty" }, headers });
    const caller = appRouter.createCaller({
      db, session: await auth.api.getSession({ headers }), environment: "sandbox", platformName: "Platform", auth, headers,
      catalog: createTestCatalogServices(), files: createFakeFileStore(),
    });
    await caller.store.create({ name: "Acme", slug: "acme-retry" });
    const [row] = await db.select().from(team).where(eq(team.slug, "acme-retry"));
    expect(row?.organizationId).toBe(empty?.id);
  });

  it("holds a Starter store's workspace to 2 accounts", async () => {
    const caller = await signedInCaller("owner@acme.test");
    await caller.store.create({ name: "Acme", slug: "acme" });
    const [row] = await db.select().from(team).where(eq(team.slug, "acme"));
    const organizationId = row?.organizationId ?? "";
    const staff = await signUpVerified(auth, db, "staff@acme.test");
    const extra = await signUpVerified(auth, db, "extra@acme.test");

    await auth.api.addMember({ body: { userId: staff.userId, organizationId, role: "member" } });
    await expect(auth.api.addMember({ body: { userId: extra.userId, organizationId, role: "member" } })).rejects.toMatchObject({
      body: { code: "PLAN_LIMIT", message: "This workspace's plan includes 2 accounts. Change the plan on the Billing page to add more." },
    });
  });

  it("rejects an invalid address before creating anything", async () => {
    const caller = await signedInCaller();

    await expect(caller.store.create({ name: "Acme", slug: "login" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This store address is reserved.",
    });
    await expect(caller.store.listMine()).resolves.toEqual([]);
  });

  it("rejects anonymous callers", async () => {
    const caller = appRouter.createCaller({
      db,
      session: null,
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

    await expect(caller.store.create({ name: "Acme", slug: "acme" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
