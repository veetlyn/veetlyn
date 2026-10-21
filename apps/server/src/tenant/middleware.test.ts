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
  product: "store",
  paypalMerchantId: null,
};
const closed: StoreRecord = { ...acme, id: "store-2", slug: "closed", status: "suspended" };
const draft: StoreRecord = { ...acme, id: "store-3", slug: "draft", status: "draft" };
const studio: StoreRecord = { ...acme, id: "team-4", slug: "studio", name: "Studio", product: "services" };

const SAME: HostDomains = { platformDomain: "platform.test", storeDomain: "platform.test" };
const SPLIT: HostDomains = { platformDomain: "platform.test", storeDomain: "stores.test" };

function buildApp(domains: HostDomains = SAME) {
  const directoryCalls: string[] = [];
  const directory: StoreDirectory = {
    async findById(id) {
      directoryCalls.push(`id:${id}`);
      return [acme, closed, draft, studio].find((s) => s.id === id) ?? null;
    },
    async findBySlug(slug) {
      directoryCalls.push(`slug:${slug}`);
      return [acme, closed, draft, studio].find((s) => s.slug === slug) ?? null;
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

    const response = await app.request("https://acme.platform.test/api/store");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ storeId: "store-1", slug: "acme", name: "Acme", product: "store" });
  });

  it("resolves an active services team with its product", async () => {
    const { app } = buildApp();

    const response = await app.request("https://studio.platform.test/api/store");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ storeId: "team-4", slug: "studio", name: "Studio", product: "services" });
  });

  it("returns 404 for the dropped path-based store URLs", async () => {
    const { app } = buildApp();

    const response = await app.request("https://store.platform.test/acme/api/store");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "store_not_found" });
  });

  it("resolves stores on a separate store domain only", async () => {
    const { app } = buildApp(SPLIT);

    const onStoreDomain = await app.request("https://acme.stores.test/api/store");
    const onPlatformDomain = await app.request("https://acme.platform.test/api/store");

    expect(await onStoreDomain.json()).toEqual({ storeId: "store-1", slug: "acme", name: "Acme", product: "store" });
    expect(onPlatformDomain.status).toBe(404);
  });

  it("resolves active custom domains", async () => {
    const { app } = buildApp();

    const response = await app.request("https://shop.acme.com/");

    expect(await response.json()).toEqual({ target: "custom-domain", store: "acme" });
  });

  it("passes platform hosts through without a tenant", async () => {
    const { app, directoryCalls } = buildApp();

    const response = await app.request("https://api.platform.test/anything");

    expect(await response.json()).toEqual({ target: "platform", store: null });
    expect(directoryCalls).toEqual([]);
  });

  it("returns 404 for unknown, unpublished, suspended and invalid store hosts", async () => {
    const { app } = buildApp();

    for (const url of [
      "https://ghost.platform.test/",
      "https://draft.platform.test/",
      "https://closed.platform.test/",
      "https://docs.platform.test/",
    ]) {
      const response = await app.request(url);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "store_not_found" });
    }
  });

  it("serves repeat lookups from the cache", async () => {
    const { app, directoryCalls } = buildApp();

    await app.request("https://acme.platform.test/");
    await app.request("https://acme.platform.test/");

    expect(directoryCalls).toEqual(["slug:acme"]);
  });

  it("reports that platform hosts have no store info", async () => {
    const { app } = buildApp();

    const response = await app.request("https://api.platform.test/api/store");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_a_store_host" });
  });
});
