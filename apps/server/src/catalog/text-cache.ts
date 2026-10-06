import type { TextCache } from "@jendal-workspace/core";

// The subset of KVNamespace this adapter uses; a real KVNamespace satisfies it.
// Kept separate from tenant/kv-store-cache.ts so the shared JsonKv interface does not change.
export interface TextKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function createKvTextCache(kv: TextKv): TextCache {
  return {
    get: (key) => kv.get(key),
    put: (key, value, ttlSeconds) => kv.put(key, value, { expirationTtl: ttlSeconds }),
  };
}
