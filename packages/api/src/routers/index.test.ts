import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import { createTestDb, hasTestDatabase } from "@jendal-workspace/db/testing/db";
import { afterAll, describe, expect, it } from "vitest";

import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("healthCheck", () => {
  const db = createTestDb();
  afterAll(() => db.$client.end());

  it("answers OK once the database responds", async () => {
    const { auth } = createTestAuth(db);
    const caller = appRouter.createCaller({
      db,
      session: null,
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

    await expect(caller.healthCheck()).resolves.toBe("OK");
  });
});
