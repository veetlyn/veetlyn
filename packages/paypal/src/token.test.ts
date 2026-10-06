import { describe, expect, it } from "vitest";

import { createKvTokenCache, createMemoryTokenCache, type JsonKv, type PayPalToken } from "./index";

function fakeKv() {
  const entries = new Map<string, { value: string; expirationTtl?: number }>();
  const kv: JsonKv = {
    async get(key) {
      const entry = entries.get(key);
      return entry ? JSON.parse(entry.value) : null;
    },
    async put(key, value, options) {
      entries.set(key, { value, expirationTtl: options?.expirationTtl });
    },
  };
  return { kv, entries };
}

describe("createMemoryTokenCache", () => {
  it("stores and returns the token", async () => {
    const cache = createMemoryTokenCache();
    expect(await cache.get()).toBeNull();
    const token: PayPalToken = { accessToken: "t", expiresAt: 123 };
    await cache.set(token);
    expect(await cache.get()).toEqual(token);
  });
});

describe("createKvTokenCache", () => {
  it("stores the token with a TTL that ends 60 seconds before expiry", async () => {
    const { kv, entries } = fakeKv();
    const now = 1_000_000;
    const cache = createKvTokenCache(kv, "paypal:oauth:sandbox:client", { now: () => now });

    await cache.set({ accessToken: "token-1", expiresAt: now + 3_600_000 });

    expect(entries.get("paypal:oauth:sandbox:client")?.expirationTtl).toBe(3540);
    await expect(cache.get()).resolves.toEqual({ accessToken: "token-1", expiresAt: now + 3_600_000 });
  });

  it("does not store tokens that expire within 60 seconds (KV's minimum TTL)", async () => {
    const { kv, entries } = fakeKv();
    const now = 1_000_000;
    const cache = createKvTokenCache(kv, "k", { now: () => now });

    await cache.set({ accessToken: "short", expiresAt: now + 100_000 });

    expect(entries.size).toBe(0);
  });

  it("ignores values that are not stored tokens", async () => {
    const { kv, entries } = fakeKv();
    entries.set("k", { value: JSON.stringify({ nope: true }) });
    const cache = createKvTokenCache(kv, "k", { now: () => 0 });

    await expect(cache.get()).resolves.toBeNull();
  });
});
