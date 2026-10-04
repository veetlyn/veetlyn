import type { StoreDirectory, StoreLookupCache, StoreRecord } from "./store";
import type { RequestTarget } from "./target";

export type StoreLookup =
  | { by: "id"; id: string }
  | { by: "slug"; slug: string }
  | { by: "hostname"; hostname: string };

export function lookupForTarget(target: RequestTarget, hostMetadataStoreId?: string): StoreLookup | null {
  switch (target.kind) {
    case "store":
      return { by: "slug", slug: target.slug };
    case "custom-domain":
      return hostMetadataStoreId
        ? { by: "id", id: hostMetadataStoreId }
        : { by: "hostname", hostname: target.hostname };
    case "platform":
    case "unknown":
      return null;
  }
}

export function cacheKeyFor(lookup: StoreLookup): string {
  switch (lookup.by) {
    case "id":
      return `id:${lookup.id}`;
    case "slug":
      return `slug:${lookup.slug}`;
    case "hostname":
      return `host:${lookup.hostname}`;
  }
}

function findInDirectory(lookup: StoreLookup, directory: StoreDirectory): Promise<StoreRecord | null> {
  switch (lookup.by) {
    case "id":
      return directory.findById(lookup.id);
    case "slug":
      return directory.findBySlug(lookup.slug);
    case "hostname":
      return directory.findByHostname(lookup.hostname);
  }
}

export async function resolveStore(
  lookup: StoreLookup,
  deps: { directory: StoreDirectory; cache: StoreLookupCache },
): Promise<StoreRecord | null> {
  const key = cacheKeyFor(lookup);
  const cached = await deps.cache.get(key);
  if (cached) return cached;

  const store = await findInDirectory(lookup, deps.directory);
  if (store) await deps.cache.put(key, store);
  return store;
}
