import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, HIDDEN_CONTACT } from "@jendal-workspace/core";
import { memberDepartment } from "@jendal-workspace/db/schema/conversations";
import { project } from "@jendal-workspace/db/schema/projects";
import { servicesDepartment } from "@jendal-workspace/db/schema/services-catalog";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProject,
  seedServicesOffering,
  seedServicesTeam,
  seedServicesTeamMember,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("open requests board", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const callerFor = (userId: string) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

  async function setup() {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const team = await seedServicesTeam(db, { organizationId, slug: "walk-crew", status: "active" });
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, team.id));
    const [design] = await db.insert(servicesDepartment).values({ teamId: team.id, name: "Design" }).returning();
    if (!design) throw new Error("no department");
    const designer = await seedServicesTeamMember(db, { organizationId, teamId: team.id, role: "freelancer" });
    await db.insert(memberDepartment).values({ teamId: team.id, userId: designer, departmentId: design.id });
    const editor = await seedServicesTeamMember(db, { organizationId, teamId: team.id, role: "freelancer" });
    const logo = await seedServicesOffering(db, { teamId: team.id, departmentId: design.id });
    const request = async (title: string, createdAt: Date) => {
      const id = await seedProject(db, { teamId: team.id, title, source: "web", clientEmail: "ann@example.com", clientName: "Ann Lee" });
      await db
        .update(project)
        .set({ offeringId: logo, createdAt, brief: "Logo please, reach me at ann@example.com" })
        .where(eq(project.id, id));
      return id;
    };
    const older = await request("Older logo", new Date("2026-10-19T10:00:00Z"));
    const newer = await request("Newer logo", new Date("2026-10-20T10:00:00Z"));
    return { ownerId, designer, editor, older, newer };
  }

  it("shows a department's freelancer its requests newest first, masked, with the 48-hour window", async () => {
    const { designer, older, newer } = await setup();
    const board = await callerFor(designer).project.openRequests({ teamSlug: "walk-crew" });
    expect(board.map((r) => r.id)).toEqual([newer, older]);
    expect(board[0]).toMatchObject({
      departmentName: "Design",
      brief: `Logo please, reach me at ${HIDDEN_CONTACT}`,
      respondBy: new Date("2026-10-22T10:00:00Z"),
    });
  });

  it("keeps the requests and the client's addresses from freelancers outside the audience", async () => {
    const { designer, editor, ownerId, newer } = await setup();
    expect(await callerFor(editor).project.openRequests({ teamSlug: "walk-crew" })).toEqual([]);
    await expect(callerFor(editor).project.get({ teamSlug: "walk-crew", projectId: newer })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const asDesigner = await callerFor(designer).project.get({ teamSlug: "walk-crew", projectId: newer });
    expect(asDesigner.contacts).toEqual([]);
    expect(asDesigner.project.brief).toBe(`Logo please, reach me at ${HIDDEN_CONTACT}`);
    const asOwner = await callerFor(ownerId).project.get({ teamSlug: "walk-crew", projectId: newer });
    expect(asOwner.contacts).toHaveLength(1);
    expect(asOwner.project.brief).toBe("Logo please, reach me at ann@example.com");
    const named = (list: { id: string; clientName: string | null }[]) => list.find((p) => p.id === newer)?.clientName;
    expect(named(await callerFor(designer).project.list({ teamSlug: "walk-crew" }))).toBe("Client");
    expect(named(await callerFor(ownerId).project.list({ teamSlug: "walk-crew" }))).toBe("Ann Lee");
  });
});
