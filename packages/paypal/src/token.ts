import { type JsonBody, storedTokenSchema } from "./schemas";

// The subset of Workers KV this adapter uses; a real KVNamespace satisfies it.
export interface JsonKv {
  get(key: string, type: "json"): Promise<JsonBody | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export type PayPalToken = { accessToken: string; expiresAt: number };

export interface PayPalTokenCache {
  get(): Promise<PayPalToken | null>;
  set(token: PayPalToken): Promise<void>;
  clear(): Promise<void>;
}

// Default for tests and one-off scripts: Worker isolates share no memory, so the Worker passes the KV adapter.
export function createMemoryTokenCache(): PayPalTokenCache {
  let token: PayPalToken | null = null;
  return {
    async get() {
      return token;
    },
    async set(next) {
      token = next;
    },
    async clear() {
      token = null;
    },
  };
}

// Refetch margin, same as the ruleshub snippet (Fact 8).
const EXPIRY_SKEW_MS = 60_000;
// KV rejects expirationTtl values below 60 seconds; a shorter-lived token is simply not stored.
const KV_MIN_TTL_SECONDS = 60;

export function createKvTokenCache(
  kv: JsonKv,
  key: string,
  options: { now?: () => number } = {},
): PayPalTokenCache {
  const now = options.now ?? (() => Date.now());
  return {
    async get() {
      const parsed = storedTokenSchema.safeParse(await kv.get(key, "json"));
      return parsed.success ? parsed.data : null;
    },
    async set(token) {
      const ttlSeconds = Math.floor((token.expiresAt - EXPIRY_SKEW_MS - now()) / 1000);
      if (ttlSeconds < KV_MIN_TTL_SECONDS) return;
      await kv.put(key, JSON.stringify(token), { expirationTtl: ttlSeconds });
    },
    async clear() {
      await kv.delete(key);
    },
  };
}
