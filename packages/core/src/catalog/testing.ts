import type { ImageDownloader, ProductImageStore, StoredImage, TextCache } from "./images";
import { SourceError, type ProductSource } from "./source";

export function createFakeProductSource(overrides: Partial<ProductSource> = {}): ProductSource & { calls: string[] } {
  const calls: string[] = [];
  const notFound = async (): Promise<never> => {
    throw new SourceError("not_found", "No match found");
  };
  return {
    calls,
    lookupByUrl: async (url) => {
      calls.push(`lookupByUrl:${url}`);
      return overrides.lookupByUrl ? overrides.lookupByUrl(url) : notFound();
    },
    searchByImage: async (input) => {
      calls.push("searchByImage");
      return overrides.searchByImage ? overrides.searchByImage(input) : [];
    },
    getProduct: async (id) => {
      calls.push(`getProduct:${id}`);
      return overrides.getProduct ? overrides.getProduct(id) : notFound();
    },
    similarProducts: async (input) => {
      calls.push(`similarProducts:${input.productId}`);
      return overrides.similarProducts ? overrides.similarProducts(input) : [];
    },
    searchProducts: async (input) => {
      calls.push(`searchProducts:${input.query}`);
      return overrides.searchProducts ? overrides.searchProducts(input) : [];
    },
  };
}

export function createFakeImageStore(): ProductImageStore & { objects: Map<string, StoredImage> } {
  const objects = new Map<string, StoredImage>();
  return {
    objects,
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async has(key) {
      return objects.has(key);
    },
  };
}

// A virtual clock so TTL behavior can be tested without waiting.
export function createFakeTextCache(): TextCache & { advanceTime(ms: number): void } {
  let now = 0;
  const entries = new Map<string, { value: string; expiresAt: number }>();
  return {
    advanceTime(ms) {
      now += ms;
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(key);
      }
    },
    async get(key) {
      return entries.get(key)?.value ?? null;
    },
    async put(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
    },
  };
}

export function createFakeImageDownloader(
  results: Record<string, StoredImage | null> = {},
): ImageDownloader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async download(url) {
      calls.push(url);
      if (url in results) return results[url] ?? null;
      return { bytes: new Uint8Array([1, 2, 3]).buffer, contentType: "image/png" };
    },
  };
}
