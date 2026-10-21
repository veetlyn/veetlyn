import { createFakeFileStore } from "@jendal-workspace/core";
import { servicesDepartment, servicesOffering } from "@jendal-workspace/db/schema/services-catalog";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesOffering,
  seedServicesTeam,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { offeringSearch } from "./offerings";
import { perform } from "./perform";

describe.skipIf(!hasTestDatabase)("offering.search", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const search = (input: { query: string; budgetMinor?: number; deadlineDays?: number }) =>
    perform(
      {
        deps: { db, files: createFakeFileStore(), auth: { options: { secret: "test-secret-that-is-at-least-32-characters" } } },
        actor: { kind: "anonymous" },
        surface: "mcp",
        request: { requestId: crypto.randomUUID(), ip: null },
      },
      offeringSearch,
      input,
    );

  async function team(slug: string, status: "active" | "suspended" | "draft" = "active") {
    const { organizationId } = await seedOrganization(db);
    return (await seedServicesTeam(db, { organizationId, slug, name: slug, status })).id;
  }

  // Each hidden row is a way another seller's opt-out, a pause or a suspension could leak into an AI's results.
  it("finds only active, listed offerings in listed departments of active teams", async () => {
    const crew = await team("walk-crew");
    const listed = await seedServicesOffering(db, { teamId: crew, name: "Logo refresh" });
    const other = await team("other-studio");
    const unlisted = await seedServicesOffering(db, { teamId: other, name: "Logo sprint" });
    await db.update(servicesOffering).set({ listed: false }).where(eq(servicesOffering.id, unlisted));
    const [hidden] = await db.insert(servicesDepartment).values({ teamId: other, name: "Brand", listed: false }).returning();
    await seedServicesOffering(db, { teamId: other, name: "Logo system", departmentId: hidden?.id });
    await seedServicesOffering(db, { teamId: other, name: "Logo paused", active: false });
    await seedServicesOffering(db, { teamId: await team("banned", "suspended"), name: "Logo cheap" });
    await seedServicesOffering(db, { teamId: await team("draft-team", "draft"), name: "Logo draft" });

    const results = await search({ query: "a logo for my bakery" });
    expect(results).toEqual([expect.objectContaining({ id: listed, name: "Logo refresh", sellerSlug: "walk-crew", currency: "USD" })]);
  });

  it("keeps offerings within the budget and the days asked for", async () => {
    const crew = await team("walk-crew");
    // The seeded offering costs 100–400 and takes 2–5 days.
    await seedServicesOffering(db, { teamId: crew, name: "Logo refresh" });
    expect(await search({ query: "logo", budgetMinor: 9_999 })).toEqual([]);
    expect(await search({ query: "logo", deadlineDays: 1 })).toEqual([]);
    expect(await search({ query: "logo", budgetMinor: 10_000, deadlineDays: 2 })).toHaveLength(1);
  });
});
