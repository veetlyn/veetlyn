import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { delivery } from "../schema/projects";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "../testing/db";
import { countOpenWebRequests, listProjectDeliveries } from "./projects";

describe.skipIf(!hasTestDatabase)("countOpenWebRequests", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("counts only the email's web requests in open statuses, for that team", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const { teamId: otherTeamId } = await seedServicesTeamWithAdmin(db, { slug: "other" });
    const email = "asker@example.com";

    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "quoting" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "in_progress" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "completed" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "cancelled" });
    await seedProject(db, { teamId, clientEmail: email, source: "admin", status: "quoting" });
    await seedProject(db, { teamId, clientEmail: "other@example.com", source: "web", status: "quoting" });
    await seedProject(db, { teamId: otherTeamId, clientEmail: email, source: "web", status: "quoting" });

    await expect(countOpenWebRequests(db, { teamId, clientEmail: email })).resolves.toBe(2);
  });
});

describe.skipIf(!hasTestDatabase)("project deliveries", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("lists a project's deliveries oldest first, ignoring other projects", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const otherProjectId = await seedProject(db, { teamId, title: "Other" });
    await db.insert(delivery).values([
      { id: "d2", projectId, teamId, submittedById: userId, note: "second", createdAt: new Date("2026-01-02T00:00:00Z") },
      {
        id: "d1",
        projectId,
        teamId,
        note: "first",
        status: "changes_requested",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      { id: "d3", projectId: otherProjectId, teamId, note: "elsewhere" },
    ]);

    expect((await listProjectDeliveries(db, projectId)).map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("keeps one submitted delivery per project, after any number of change requests", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    await db.insert(delivery).values({ projectId, teamId, status: "changes_requested" });
    await db.insert(delivery).values({ projectId, teamId });

    // Drizzle wraps the postgres error; the 23505 code and constraint name live on the cause.
    const failure = await db
      .insert(delivery)
      .values({ projectId, teamId })
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ cause: { code: "23505", constraint_name: "delivery_open_idx" } });
    expect(await listProjectDeliveries(db, projectId)).toHaveLength(2);
  });
});
