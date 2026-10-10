import type { StoreRecord } from "@jendal-workspace/core";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesOffering,
  seedServicesTeam,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../app-env";
import { storeInfoRoute } from "./store-info";

describe.skipIf(!hasTestDatabase)("store info routes", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function appFor(store: StoreRecord | null) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("store", store);
      await next();
    });
    app.route("/", storeInfoRoute);
    return app;
  }

  async function activeStudio() {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, {
      organizationId,
      slug: "acme-studio",
      name: "Acme Studio",
      status: "active",
    });
    return studio;
  }

  it("returns the store's product", async () => {
    const studio = await activeStudio();

    const response = await appFor(studio).request(
      "https://acme-studio.payleor.app/api/store",
    );

    expect(await response.json()).toEqual({
      storeId: studio.id,
      slug: "acme-studio",
      name: "Acme Studio",
      product: "services",
    });
  });

  it("returns the product with the policy info", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, {
      organizationId,
      slug: "acme",
      name: "Acme",
    });

    const response = await appFor(store).request(
      "https://acme.payleor.app/api/store/policy-info",
    );

    expect(await response.json()).toEqual({
      slug: "acme",
      name: "Acme",
      product: "store",
      supportEmail: null,
      createdAt: expect.any(String),
    });
  });

  it("returns the seller page of the resolved team", async () => {
    const studio = await activeStudio();
    await seedServicesOffering(db, { teamId: studio.id, name: "Logo design" });
    await seedServicesOffering(db, {
      teamId: studio.id,
      name: "Hidden",
      active: false,
    });

    const response = await appFor(studio).request(
      "https://acme-studio.payleor.app/api/store/page",
    );

    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      name: string;
      product: string;
      bio: string;
      currency: string;
      supportEmail: string | null;
      departments: unknown[];
      offerings: { name: string }[];
    };
    expect(page).toMatchObject({
      name: "Acme Studio",
      slug: "acme-studio",
      product: "services",
      status: "active",
      bio: "",
      currency: "USD",
      supportEmail: null,
      departments: [],
      products: [],
    });
    expect(page.offerings.map((o) => o.name)).toEqual(["Logo design"]);
  });

  it("reports that platform hosts have no seller page", async () => {
    const response = await appFor(null).request(
      "https://api.payleor.app/api/store/page",
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_a_store_host" });
  });

  it("answers store_not_found when the resolved team no longer exists", async () => {
    const studio = await activeStudio();
    await truncateAll(db);

    const response = await appFor(studio).request(
      "https://acme-studio.payleor.app/api/store/page",
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "store_not_found" });
  });
});
