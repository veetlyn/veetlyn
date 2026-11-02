import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import { dispute } from "@jendal-workspace/db/schema/operating-model";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedPayment,
  seedProject,
  seedServicesTeam,
  seedServicesTeamMember,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("money", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const callerFor = (userId: string) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

  // Walk Crew's Baobab project with a deposit and a balance, and another team's payment beside it.
  async function setup() {
    const { userId: adminId, organizationId } = await seedOrganization(db);
    const crew = await seedServicesTeam(db, { organizationId, slug: "walk-crew", status: "active" });
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId: crew.id, role: "freelancer" });
    const projectId = await seedProject(db, { teamId: crew.id, title: "Baobab", clientName: "Lina Haddad" });
    await seedPayment(db, { projectId, teamId: crew.id, kind: "deposit", amountMinor: 30_000, capturedAt: new Date("2026-10-20T10:00:00Z") });
    await seedPayment(db, { projectId, teamId: crew.id, kind: "balance", amountMinor: 45_000, capturedAt: new Date("2026-10-24T10:00:00Z") });
    const other = await seedOrganization(db);
    const rival = await seedServicesTeam(db, { organizationId: other.organizationId, slug: "rival", status: "active" });
    const rivalProject = await seedProject(db, { teamId: rival.id, title: "Elsewhere" });
    await seedPayment(db, { projectId: rivalProject, teamId: rival.id, amountMinor: 99_000 });
    return { adminId, freelancer, teamId: crew.id, projectId, rivalTeamId: rival.id };
  }

  it("lists the team's own payments newest first for an admin, with the project and its client", async () => {
    const { adminId } = await setup();
    const payments = await callerFor(adminId).money.payments({ teamSlug: "walk-crew" });
    expect(payments.map((p) => [p.kind, p.amountMinor, p.projectTitle, p.clientName])).toEqual([
      ["balance", 45_000, "Baobab", "Lina Haddad"],
      ["deposit", 30_000, "Baobab", "Lina Haddad"],
    ]);
  });

  it("lists the team's own PayPal cases open first, for an admin", async () => {
    const { adminId, teamId, projectId, rivalTeamId } = await setup();
    await db.insert(dispute).values([
      { teamId, projectId, paypalDisputeId: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "resolved_seller", amountMinor: 30_000, currency: "USD", openedAt: new Date("2026-10-26T00:00:00Z"), resolvedAt: new Date("2026-10-28T00:00:00Z") },
      { teamId, projectId, paypalDisputeId: "PP-D-2", reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", status: "waiting_for_seller", amountMinor: 45_000, currency: "USD", openedAt: new Date("2026-10-25T00:00:00Z") },
      { teamId: rivalTeamId, paypalDisputeId: "PP-D-3", reason: "UNAUTHORISED", status: "open", openedAt: new Date("2026-10-27T00:00:00Z") },
    ]);
    const cases = await callerFor(adminId).money.cases({ teamSlug: "walk-crew" });
    expect(cases.map((c) => [c.paypalDisputeId, c.open, c.projectTitle])).toEqual([
      ["PP-D-2", true, "Baobab"],
      ["PP-D-1", false, "Baobab"],
    ]);
  });

  it("refuses payments and cases to a freelancer", async () => {
    const { freelancer } = await setup();
    await expect(callerFor(freelancer).money.payments({ teamSlug: "walk-crew" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerFor(freelancer).money.cases({ teamSlug: "walk-crew" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
