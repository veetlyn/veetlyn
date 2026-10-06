export type StoreStatus = "draft" | "active" | "suspended";

// A store is a Better Auth team; `id` is the team ID.
export type StoreRecord = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  status: StoreStatus;
  paypalMerchantId: string | null;
};

export interface StoreDirectory {
  findById(id: string): Promise<StoreRecord | null>;
  findBySlug(slug: string): Promise<StoreRecord | null>;
  findByHostname(hostname: string): Promise<StoreRecord | null>;
}

// Entries expire, but a slug, domain or status change must also delete the affected keys (W1-B, W1-C).
export interface StoreLookupCache {
  get(key: string): Promise<StoreRecord | null>;
  put(key: string, store: StoreRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

export function isStoreReachable(store: StoreRecord): boolean {
  return store.status !== "suspended";
}
