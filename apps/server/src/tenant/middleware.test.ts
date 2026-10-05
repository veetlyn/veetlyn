import type { HostDomains, StoreDirectory, StoreLookupCache, StoreRecord } from "@jendal-workspace/core";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../app-env";
import { storeInfoRoute } from "../routes/store-info";
import { tenantMiddleware } from "./middleware";

const acme: StoreRecord = {
  id: "store-1",
  organizationId: "org-1",
  slug: "acme",
  name: "Acme",
  status: "active",
  paypalMerchantId: null,
};
const closed: StoreRecord = { ...acme, id: "store-2", slug: "closed", status: "suspended" };

const SAME: HostDomains = { platformDomain: "payleor.app", storeDomain: "payleor.app" };
const SPLIT: HostDomains = { platformDomain: "payleor.app", storeDomain: "payleor.site" };

function buildApp(domains: HostDomains = SAME) {
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

  const app = new Hono<AppEnv>();
  app.use(evlog());
  app.use(tenantMiddleware({ domains, environment: "sandbox" }, () => ({ directory, cache })));
  app.route("/", storeInfoRoute);
  app.get("*", (c) => c.json({ target: c.get("target").kind, store: c.get("tenant")?.slug ?? null }));

  return { app, directoryCalls };
}

describe("tenantMiddleware", () => {
  it("resolves a store subdomain and exposes it to routes", async () => {
    const { app } = buildApp();

    const response = await app.request("https://acme.payleor.app/api/store");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ storeId: "store-1", slug: "acme", name: "Acme" });
  });

  it("returns 404 for the dropped path-based store URLs", async () => {
    const { app } = buildApp();

    const response = await app.request("https://store.payleor.app/acme/api/store");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "store_not_found" });
  });

  it("resolves stores on a separate store domain only", async () => {
    const { app } = buildApp(SPLIT);

    const onStoreDomain = await app.request("https://acme.payleor.site/api/store");
    const onPlatformDomain = await app.request("https://acme.payleor.app/api/store");

    expect(await onStoreDomain.json()).toEqual({ storeId: "store-1", slug: "acme", name: "Acme" });
    expect(onPlatformDomain.status).toBe(404);
  });

  it("resolves active custom domains", async () => {
    const { app } = buildApp();

    const response = await app.request("https://shop.acme.com/");

    expect(await response.json()).toEqual({ target: "custom-domain", store: "acme" });
  });

  it("passes platform hosts through without a tenant", async () => {
    const { app, directoryCalls } = buildApp();

    const response = await app.request("https://api.payleor.app/anything");

    expect(await response.json()).toEqual({ target: "platform", store: null });
    expect(directoryCalls).toEqual([]);
  });

  it("returns 404 for unknown, suspended and invalid store hosts", async () => {
    const { app } = buildApp();

    for (const url of ["https://ghost.payleor.app/", "https://closed.payleor.app/", "https://docs.payleor.app/"]) {
      const response = await app.request(url);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "store_not_found" });
    }
  });

  it("serves repeat lookups from the cache", async () => {
    const { app, directoryCalls } = buildApp();

    await app.request("https://acme.payleor.app/");
    await app.request("https://acme.payleor.app/");

    expect(directoryCalls).toEqual(["slug:acme"]);
  });

  it("reports that platform hosts have no store info", async () => {
    const { app } = buildApp();

    const response = await app.request("https://api.payleor.app/api/store");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_a_store_host" });
  });
});
