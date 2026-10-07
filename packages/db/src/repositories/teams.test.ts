import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  addTeamMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedStore,
  seedUser,
  truncateAll,
} from "../testing/db";
import { findTeamAccess, findTeamById, findTeamSlug } from "./teams";

describe.skipIf(!hasTestDatabase)("team repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("finds a team by id with the caller's organization role", async () => {
    const { userId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    const store = await seedStore(db, { organizationId, slug: "acme" });

    const access = await findTeamAccess(db, { teamId: store.id, userId });

    expect(access).toEqual({ team: store, product: "store", role: "owner", isTeamMember: false });
  });

  it("returns a services team's product next to the team record", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "studio" });

    const access = await findTeamAccess(db, { teamId: studio.id, userId });

    expect(access).toMatchObject({ team: { id: studio.id, slug: "studio" }, product: "services", role: "owner" });
    expect(access?.team).not.toHaveProperty("product");
  });

  it("marks organization membership without team membership", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const staffId = await addMember(db, { organizationId, role: "member" });

    const beforeJoin = await findTeamAccess(db, { teamId: store.id, userId: staffId });
    expect(beforeJoin).toMatchObject({ role: "member", isTeamMember: false });

    await addTeamMember(db, { teamId: store.id, userId: staffId });
    const afterJoin = await findTeamAccess(db, { teamId: store.id, userId: staffId });
    expect(afterJoin?.isTeamMember).toBe(true);
  });

  it("returns null for a user outside the organization and for a missing team", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const outsiderId = await seedUser(db, "Outsider");

    expect(await findTeamAccess(db, { teamId: store.id, userId: outsiderId })).toBeNull();
    expect(await findTeamAccess(db, { teamId: "missing", userId: outsiderId })).toBeNull();
  });

  it("finds a team by id and a slug by team id", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });

    expect(await findTeamById(db, store.id)).toEqual(store);
    expect(await findTeamById(db, "missing")).toBeNull();
    expect(await findTeamSlug(db, store.id)).toBe("acme");
    expect(await findTeamSlug(db, "missing")).toBeNull();
  });
});
