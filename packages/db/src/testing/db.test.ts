import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { member } from "../schema/organization";
import { createTestDb, hasTestDatabase, seedOrganization, truncateAll } from "./db";

describe.skipIf(!hasTestDatabase)("test database", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("seeds an organization with an owner", async () => {
    const { organizationId, userId } = await seedOrganization(db);
    const rows = await db.select().from(member);

    expect(rows).toEqual([expect.objectContaining({ organizationId, userId, role: "owner" })]);
  });
});
