import {
  addMember,
  addTeamMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

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

describe.skipIf(!hasTestDatabase)("store router", () => {
  const db = createTestDb();
  const callerFor = (userId: string | null) =>
    appRouter.createCaller({ db, session: userId ? makeSession(userId) : null, environment: "sandbox" });

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

    await expect(callerFor(staffId).store.get({ storeSlug: "acme" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports another merchant's store as not found", async () => {
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });
    const outsider = await seedOrganization(db);

    await expect(callerFor(outsider.userId).store.get({ storeSlug: "acme" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
