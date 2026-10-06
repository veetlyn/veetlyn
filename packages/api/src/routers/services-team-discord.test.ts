import { createTestAuth } from "@jendal-workspace/auth/testing";
import { consumeDiscordLinkCode } from "@jendal-workspace/db/repositories/discord";
import { addServicesTeamMember } from "@jendal-workspace/db/repositories/services-teams";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("servicesTeam.createDiscordLinkCode", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const caller = (userId: string) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
    });

  it("creates a one-time code tied to the team, valid for 15 minutes", async () => {
    const { userId, organizationId } = await seedOrganization(db); // owner → admin of every services team
    const team = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    const created = await caller(userId).servicesTeam.createDiscordLinkCode({ teamSlug: "acme-studio" });

    expect(created.code).toMatch(/^[0-9a-f]{12}$/);
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(created.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    await expect(consumeDiscordLinkCode(db, created.code)).resolves.toBe(team.id);
  });

  it("refuses a freelancer, and stays quiet about the team for a stranger", async () => {
    const { organizationId } = await seedOrganization(db);
    const team = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const freelancer = await addMember(db, { organizationId, role: "member", name: "Bea" });
    await addServicesTeamMember(db, { teamId: team.id, userId: freelancer, role: "freelancer" });
    const stranger = await seedUser(db, "Stranger");

    await expect(
      caller(freelancer).servicesTeam.createDiscordLinkCode({ teamSlug: "acme-studio" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only an admin can link the Discord server.",
    });
    await expect(caller(stranger).servicesTeam.createDiscordLinkCode({ teamSlug: "acme-studio" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
