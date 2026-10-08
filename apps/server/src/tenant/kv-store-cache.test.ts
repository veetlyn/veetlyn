import type { StoreRecord } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { createKvStoreCache, type JsonKv } from "./kv-store-cache";

const acme: StoreRecord = {
  id: "store-1",
  organizationId: "org-1",
  slug: "acme",
  name: "Acme",
  status: "active",
  product: "store",
  paypalMerchantId: null,
};

function fakeKv() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const kv: JsonKv = {
    async get(key) {
      const raw = values.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async put(key, value, options) {
      values.set(key, value);
      ttls.set(key, options?.expirationTtl);
    },
    async delete(key) {
      values.delete(key);
    },
  };
  return { kv, values, ttls };
}

describe("createKvStoreCache", () => {
  it("stores records as JSON under a prefixed key with a TTL", async () => {
    const { kv, values, ttls } = fakeKv();
    const cache = createKvStoreCache(kv, 120);

    await cache.put("slug:acme", acme);

    expect(JSON.parse(values.get("store:slug:acme") ?? "null")).toEqual(acme);
    expect(ttls.get("store:slug:acme")).toBe(120);
    await expect(cache.get("slug:acme")).resolves.toEqual(acme);
  });

  it("returns null on a miss", async () => {
    const { kv } = fakeKv();
    await expect(createKvStoreCache(kv).get("slug:ghost")).resolves.toBeNull();
  });

  it("treats a malformed cached value as a miss", async () => {
    const { kv, values } = fakeKv();
    values.set("store:slug:acme", JSON.stringify({ id: "store-1" }));

    await expect(createKvStoreCache(kv).get("slug:acme")).resolves.toBeNull();
  });

  it("deletes a cached record", async () => {
    const { kv, values } = fakeKv();
    const cache = createKvStoreCache(kv);
    await cache.put("slug:acme", acme);

    await cache.delete("slug:acme");

    expect(values.has("store:slug:acme")).toBe(false);
    await expect(cache.get("slug:acme")).resolves.toBeNull();
  });
});
