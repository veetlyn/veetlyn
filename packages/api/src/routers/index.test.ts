import { createTestDb, hasTestDatabase } from "@jendal-workspace/db/testing/db";
import { afterAll, describe, expect, it } from "vitest";

import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("healthCheck", () => {
  const db = createTestDb();
  afterAll(() => db.$client.end());

  it("answers OK once the database responds", async () => {
    const caller = appRouter.createCaller({ db, session: null, environment: "sandbox" });

    await expect(caller.healthCheck()).resolves.toBe("OK");
  });
});
