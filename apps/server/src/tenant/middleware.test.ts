import type { StoreDirectory, StoreLookupCache, StoreRecord } from "@jendal-workspace/core";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../app-env";
import { storeInfoRoute } from "../routes/store-info";
import { routingPathFor, tenantMiddleware } from "./middleware";

const acme: StoreRecord = {
  id: "store-1",
  organizationId: "org-1",
  slug: "acme",
  name: "Acme",
  status: "active",
  paypalMerchantId: null,
};
const closed: StoreRecord = { ...acme, id: "store-2", slug: "closed", status: "suspended" };

function buildApp() {
  const directoryCalls: string[] = [];
  const directory: StoreDirectory = {
    async findById(id) {
      directoryCalls.push(`id:${id}`);
      return [acme, closed].find((s) => s.id === id) ?? null;
    },
    async findBySlug(slug) {
      directoryCalls.push(`slug:${slug}`);
      return [acme, closed].find((s) => s.slug === slug) ?? null;
    },
    async findByHostname(hostname) {
      directoryCalls.push(`host:${hostname}`);
      return hostname === "shop.acme.com" ? acme : null;
    },
  };
  const entries = new Map<string, StoreRecord>();
  const cache: StoreLookupCache = {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async put(key, store) {
      entries.set(key, store);
    },
    async delete(key) {
      entries.delete(key);
    },
  };

  const app = new Hono<AppEnv>({ getPath: (request) => routingPathFor(request, "jendal.app") });
  app.use(evlog());
  app.use(tenantMiddleware({ platformDomain: "jendal.app", environment: "sandbox" }, () => ({ directory, cache })));
  app.route("/", storeInfoRoute);
  app.get("*", (c) => c.json({ target: c.get("target").kind, store: c.get("tenant")?.slug ?? null }));

  return { app, directoryCalls };
}

describe("tenantMiddleware", () => {
  it("resolves a store subdomain and exposes it to routes", async () => {
    const { app } = buildApp();

    const response = await app.request("https://acme.jendal.app/api/store");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ storeId: "store-1", slug: "acme", name: "Acme" });
  });

  it("resolves path-based store URLs", async () => {
    const { app } = buildApp();

    const response = await app.request("https://store.jendal.app/acme/products");

    expect(await response.json()).toEqual({ target: "store", store: "acme" });
  });

  it("routes path-based store URLs without their base path", async () => {
    const { app } = buildApp();

    const response = await app.request("https://store.jendal.app/acme/api/store");

    expect(await response.json()).toEqual({ storeId: "store-1", slug: "acme", name: "Acme" });
  });

  it("resolves active custom domains", async () => {
    const { app } = buildApp();

    const response = await app.request("https://shop.acme.com/");

    expect(await response.json()).toEqual({ target: "custom-domain", store: "acme" });
  });

  it("passes platform hosts through without a tenant", async () => {
    const { app, directoryCalls } = buildApp();

    const response = await app.request("https://api.jendal.app/anything");

    expect(await response.json()).toEqual({ target: "platform", store: null });
    expect(directoryCalls).toEqual([]);
  });

  it("returns 404 for unknown, suspended and invalid store hosts", async () => {
    const { app } = buildApp();

    for (const url of ["https://ghost.jendal.app/", "https://closed.jendal.app/", "https://docs.jendal.app/"]) {
      const response = await app.request(url);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "store_not_found" });
    }
  });

  it("serves repeat lookups from the cache", async () => {
    const { app, directoryCalls } = buildApp();

    await app.request("https://acme.jendal.app/");
    await app.request("https://acme.jendal.app/");

    expect(directoryCalls).toEqual(["slug:acme"]);
  });

  it("reports that platform hosts have no store info", async () => {
    const { app } = buildApp();

    const response = await app.request("https://api.jendal.app/api/store");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_a_store_host" });
  });
});
