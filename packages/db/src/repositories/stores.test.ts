import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { products } from "../schema/catalog";
import { member, team } from "../schema/organization";
import { storeDomains } from "../schema/stores";
import {
  addMember,
  addTeamMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedStore,
  truncateAll,
} from "../testing/db";
import {
  countPublishedProducts,
  createStoreDirectory,
  findStoreAccess,
  findStorePolicyInfo,
  findTeamAccess,
  isStoreSlugTaken,
  listOrganizationsWithStores,
  setTeamStatus,
} from "./stores";

describe.skipIf(!hasTestDatabase)("store repository", () => {
  const db = createTestDb();
  const directory = createStoreDirectory(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("finds a store by id and by slug", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme", name: "Acme" });

    expect(store).toEqual({
      id: expect.any(String),
      organizationId,
      slug: "acme",
      name: "Acme",
      status: "draft",
      product: "store",
      paypalMerchantId: null,
    });
    await expect(directory.findById(store.id)).resolves.toEqual(store);
    await expect(directory.findBySlug("acme")).resolves.toEqual(store);
  });

  it("returns null for unknown stores", async () => {
    await expect(directory.findBySlug("ghost")).resolves.toBeNull();
    await expect(directory.findById("missing")).resolves.toBeNull();
    await expect(directory.findByHostname("nowhere.example.com")).resolves.toBeNull();
  });

  it("finds stores by custom hostname only when the domain is active", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    await db.insert(storeDomains).values([
      { storeId: store.id, hostname: "shop.acme.com", status: "active" },
      { storeId: store.id, hostname: "pending.acme.com", status: "pending" },
    ]);

    await expect(directory.findByHostname("shop.acme.com")).resolves.toEqual(store);
    await expect(directory.findByHostname("pending.acme.com")).resolves.toBeNull();
  });

  it("reports whether a slug is taken", async () => {
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });

    await expect(isStoreSlugTaken(db, "acme")).resolves.toBe(true);
    await expect(isStoreSlugTaken(db, "other")).resolves.toBe(false);
  });

  it("returns the role and team membership of users who belong to the store's organization", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const staffId = await addMember(db, { organizationId, role: "member" });
    await addTeamMember(db, { teamId: store.id, userId: staffId });

    await expect(findStoreAccess(db, { slug: "acme", userId: ownerId })).resolves.toEqual({
      store,
      role: "owner",
      isTeamMember: false,
    });
    await expect(findStoreAccess(db, { slug: "acme", userId: staffId })).resolves.toEqual({
      store,
      role: "member",
      isTeamMember: true,
    });
  });

  it("returns no access for users outside the organization and for unknown slugs", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });
    const outsider = await seedOrganization(db);

    await expect(findStoreAccess(db, { slug: "acme", userId: outsider.userId })).resolves.toBeNull();
    await expect(findStoreAccess(db, { slug: "ghost", userId })).resolves.toBeNull();
  });

  it("resolves team access for services teams and stores alike, and none for outsiders", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const acme = await seedStore(db, { organizationId, slug: "acme" });
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const outsider = await seedOrganization(db);

    await expect(findTeamAccess(db, { slug: "acme-studio", userId })).resolves.toEqual({
      store: studio,
      role: "owner",
      isTeamMember: false,
    });
    await expect(findTeamAccess(db, { slug: "acme", userId })).resolves.toEqual({
      store: acme,
      role: "owner",
      isTeamMember: false,
    });
    await expect(findTeamAccess(db, { slug: "acme-studio", userId: outsider.userId })).resolves.toBeNull();
    await expect(findTeamAccess(db, { slug: "ghost", userId })).resolves.toBeNull();
  });

  it("lists every organization of the user by name, with its stores by name and team membership", async () => {
    const first = await seedOrganization(db, { name: "First" });
    const beta = await seedStore(db, { organizationId: first.organizationId, slug: "beta" });
    const acme = await seedStore(db, { organizationId: first.organizationId, slug: "acme" });
    const empty = await seedOrganization(db, { name: "Empty" });
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: empty.organizationId,
      userId: first.userId,
      role: "member",
      createdAt: new Date(),
    });
    await addTeamMember(db, { teamId: beta.id, userId: first.userId });
    const other = await seedOrganization(db, { name: "Other" });
    await seedStore(db, { organizationId: other.organizationId, slug: "other" });

    const result = await listOrganizationsWithStores(db, first.userId);

    expect(result).toEqual([
      { organization: { id: empty.organizationId, name: "Empty" }, role: "member", stores: [] },
      {
        organization: { id: first.organizationId, name: "First" },
        role: "owner",
        stores: [
          { store: acme, isTeamMember: false },
          { store: beta, isTeamMember: true },
        ],
      },
    ]);
  });

  it("returns the support email and creation date used by the store policies", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    await db.update(team).set({ supportEmail: "help@acme.test" }).where(eq(team.id, store.id));

    await expect(findStorePolicyInfo(db, store.id)).resolves.toEqual({
      supportEmail: "help@acme.test",
      createdAt: expect.any(Date),
    });
    await expect(findStorePolicyInfo(db, "missing")).resolves.toBeNull();
  });

  it("resolves services teams on the storefront host, but leaves them out of store access and lists", async () => {
    const { userId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    const acme = await seedStore(db, { organizationId, slug: "acme", name: "Acme" });
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await expect(directory.findById(studio.id)).resolves.toEqual(studio);
    await expect(directory.findBySlug("acme-studio")).resolves.toEqual(studio);
    await expect(directory.findBySlug("acme")).resolves.toEqual(acme);
    await expect(findStoreAccess(db, { slug: "acme-studio", userId })).resolves.toBeNull();
    await expect(listOrganizationsWithStores(db, userId)).resolves.toEqual([
      {
        organization: { id: organizationId, name: "Acme Inc" },
        role: "owner",
        stores: [{ store: acme, isTeamMember: false }],
      },
    ]);
    await expect(isStoreSlugTaken(db, "acme-studio")).resolves.toBe(true);
  });

  it("keeps an organization that has only services teams in the store list, with no stores", async () => {
    const { userId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await expect(listOrganizationsWithStores(db, userId)).resolves.toEqual([
      { organization: { id: organizationId, name: "Acme Inc" }, role: "owner", stores: [] },
    ]);
  });

  it("publishes and unpublishes a team, returning its slug", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const readStatus = async () =>
      (await db.select({ status: team.status }).from(team).where(eq(team.id, studio.id)))[0]?.status;

    await expect(setTeamStatus(db, { teamId: studio.id, status: "active" })).resolves.toEqual({ slug: "acme-studio" });
    await expect(readStatus()).resolves.toBe("active");
    await expect(setTeamStatus(db, { teamId: studio.id, status: "draft" })).resolves.toEqual({ slug: "acme-studio" });
    await expect(readStatus()).resolves.toBe("draft");
  });

  it("leaves a suspended team suspended, and ignores unknown teams", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme", status: "suspended" });

    await expect(setTeamStatus(db, { teamId: store.id, status: "active" })).resolves.toBeNull();
    const [row] = await db.select({ status: team.status }).from(team).where(eq(team.id, store.id));
    expect(row?.status).toBe("suspended");
    await expect(setTeamStatus(db, { teamId: "missing", status: "active" })).resolves.toBeNull();
  });

  it("counts only the store's published products", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const other = await seedStore(db, { organizationId, slug: "other" });
    await db.insert(products).values([
      { storeId: store.id, title: "A", status: "published" },
      { storeId: store.id, title: "B", status: "published" },
      { storeId: store.id, title: "C", status: "draft" },
      { storeId: other.id, title: "D", status: "published" },
    ]);

    await expect(countPublishedProducts(db, store.id)).resolves.toBe(2);
    await expect(countPublishedProducts(db, "missing")).resolves.toBe(0);
  });

  it("gives new stores the store product", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });

    const [row] = await db.select({ product: team.product }).from(team).where(eq(team.id, store.id));
    expect(row?.product).toBe("store");
  });
});
