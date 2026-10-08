import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { relations } from "../relations";
import { createTestDb, hasTestDatabase, truncateAll } from "../testing/db";
import { hitRequestLimit } from "./request-limits";

describe.skipIf(!hasTestDatabase)("hitRequestLimit", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const limit = { key: "pay-start:p1", windowMs: 60_000, max: 2 };

  it("allows max hits per window, then refuses until the window ends", async () => {
    expect(await hitRequestLimit(db, { ...limit, now: 1_000 })).toBe(true);
    expect(await hitRequestLimit(db, { ...limit, now: 2_000 })).toBe(true);
    expect(await hitRequestLimit(db, { ...limit, now: 3_000 })).toBe(false);
    expect(await hitRequestLimit(db, { ...limit, now: 60_999 })).toBe(false);
    expect(await hitRequestLimit(db, { ...limit, now: 61_000 })).toBe(true);
  });

  it("counts keys separately and holds under concurrent hits", async () => {
    // The shared test pool has one connection, so the hits need their own pool to really run in parallel.
    const client = postgres(process.env.TEST_DATABASE_URL ?? "", { max: 5, fetch_types: false });
    try {
      const parallel = drizzle({ client, relations });
      const results = await Promise.all(Array.from({ length: 5 }, () => hitRequestLimit(parallel, { ...limit, now: 1_000 })));
      expect(results.filter(Boolean)).toHaveLength(2);
    } finally {
      await client.end();
    }
    expect(await hitRequestLimit(db, { ...limit, key: "pay-start:p2", now: 1_000 })).toBe(true);
  });
});
