import { describe, expect, it } from "vitest";

import { createKvTextCache, type TextKv } from "./text-cache";

function fakeKv(): TextKv & { entries: Map<string, { value: string; ttl?: number }> } {
  const entries = new Map<string, { value: string; ttl?: number }>();
  return {
    entries,
    async get(key) {
      return entries.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      entries.set(key, { value, ttl: options?.expirationTtl });
    },
  };
}

describe("createKvTextCache", () => {
  it("round-trips strings and passes the TTL through as expirationTtl", async () => {
    const kv = fakeKv();
    const cache = createKvTextCache(kv);

    expect(await cache.get("k")).toBeNull();
    await cache.put("k", "v", 3600);

    expect(await cache.get("k")).toBe("v");
    expect(kv.entries.get("k")?.ttl).toBe(3600);
  });
});
