import { describe, expect, it } from "vitest";

import { cacheKeyFor, lookupForTarget, resolveStore } from "./resolve";
import type { StoreDirectory, StoreLookupCache, StoreRecord } from "./store";

const acme: StoreRecord = {
  id: "store-1",
  organizationId: "org-1",
  slug: "acme",
  name: "Acme",
  status: "active",
  paypalMerchantId: null,
};

function fakeDirectory(stores: StoreRecord[], domains: Record<string, string> = {}) {
  const calls: string[] = [];
  const directory: StoreDirectory = {
    async findById(id) {
      calls.push(`id:${id}`);
      return stores.find((s) => s.id === id) ?? null;
    },
    async findBySlug(slug) {
      calls.push(`slug:${slug}`);
      return stores.find((s) => s.slug === slug) ?? null;
    },
    async findByHostname(hostname) {
      calls.push(`host:${hostname}`);
      const storeId = domains[hostname];
      return stores.find((s) => s.id === storeId) ?? null;
    },
  };
  return { directory, calls };
}

function fakeCache() {
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
  return { cache, entries };
}

describe("lookupForTarget", () => {
  it("looks up store targets by slug", () => {
    expect(lookupForTarget({ kind: "store", slug: "acme" })).toEqual({ by: "slug", slug: "acme" });
  });

  it("prefers the Cloudflare for SaaS host metadata store id for custom domains", () => {
    expect(lookupForTarget({ kind: "custom-domain", hostname: "shop.example.com" }, "store-1")).toEqual({
      by: "id",
      id: "store-1",
    });
  });

  it("falls back to the hostname for custom domains without metadata", () => {
    expect(lookupForTarget({ kind: "custom-domain", hostname: "shop.example.com" })).toEqual({
      by: "hostname",
      hostname: "shop.example.com",
    });
  });

  it("returns null for platform and unknown targets", () => {
    expect(lookupForTarget({ kind: "platform", app: "api" })).toBeNull();
    expect(lookupForTarget({ kind: "unknown" })).toBeNull();
  });
});

describe("cacheKeyFor", () => {
  it("builds a distinct key per lookup type", () => {
    expect(cacheKeyFor({ by: "id", id: "s1" })).toBe("id:s1");
    expect(cacheKeyFor({ by: "slug", slug: "acme" })).toBe("slug:acme");
    expect(cacheKeyFor({ by: "hostname", hostname: "shop.example.com" })).toBe("host:shop.example.com");
  });
});

describe("resolveStore", () => {
  it("reads the directory on a cache miss and writes the result to the cache", async () => {
    const { directory, calls } = fakeDirectory([acme]);
    const { cache, entries } = fakeCache();

    await expect(resolveStore({ by: "slug", slug: "acme" }, { directory, cache })).resolves.toEqual(acme);
    expect(calls).toEqual(["slug:acme"]);
    expect(entries.get("slug:acme")).toEqual(acme);
  });

  it("serves a cached store without reading the directory", async () => {
    const { directory, calls } = fakeDirectory([acme]);
    const { cache, entries } = fakeCache();
    entries.set("slug:acme", acme);

    await expect(resolveStore({ by: "slug", slug: "acme" }, { directory, cache })).resolves.toEqual(acme);
    expect(calls).toEqual([]);
  });

  it("resolves custom domains through the directory", async () => {
    const { directory } = fakeDirectory([acme], { "shop.example.com": "store-1" });
    const { cache } = fakeCache();

    await expect(
      resolveStore({ by: "hostname", hostname: "shop.example.com" }, { directory, cache }),
    ).resolves.toEqual(acme);
  });

  it("returns null and caches nothing when no store matches", async () => {
    const { directory } = fakeDirectory([]);
    const { cache, entries } = fakeCache();

    await expect(resolveStore({ by: "slug", slug: "ghost" }, { directory, cache })).resolves.toBeNull();
    expect(entries.size).toBe(0);
  });
});
