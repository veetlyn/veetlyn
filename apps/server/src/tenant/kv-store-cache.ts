import type { StoreLookupCache } from "@jendal-workspace/core";
import { z } from "zod";

// The subset of KVNamespace this adapter uses; a real KVNamespace satisfies it.
export interface JsonKv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

const cachedStoreSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "suspended"]),
  paypalMerchantId: z.string().nullable(),
});

const KEY_PREFIX = "store:";
// KV rejects expirationTtl values below 60 seconds. Short enough that a rename shows up quickly.
const DEFAULT_TTL_SECONDS = 300;

export function createKvStoreCache(kv: JsonKv, ttlSeconds = DEFAULT_TTL_SECONDS): StoreLookupCache {
  return {
    async get(key) {
      const parsed = cachedStoreSchema.safeParse(await kv.get(`${KEY_PREFIX}${key}`, "json"));
      return parsed.success ? parsed.data : null;
    },
    async put(key, store) {
      await kv.put(`${KEY_PREFIX}${key}`, JSON.stringify(store), { expirationTtl: ttlSeconds });
    },
    async delete(key) {
      await kv.delete(`${KEY_PREFIX}${key}`);
    },
  };
}
