import type { TeamProduct } from "./team-product";

export type StoreStatus = "draft" | "active" | "suspended";

// A store or a services team (one slug namespace, one storefront host); `id` is the team ID.
export type StoreRecord = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  status: StoreStatus;
  product: TeamProduct;
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

// Sellers design §3.3: the public host shows only published sellers; members preview drafts in the admin.
export function isStorePublic(store: StoreRecord): boolean {
  return store.status === "active";
}
