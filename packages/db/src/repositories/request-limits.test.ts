import { afterAll, beforeEach, describe, expect, it } from "vitest";

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
    const results = await Promise.all(Array.from({ length: 5 }, () => hitRequestLimit(db, { ...limit, now: 1_000 })));
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await hitRequestLimit(db, { ...limit, key: "pay-start:p2", now: 1_000 })).toBe(true);
  });
});
