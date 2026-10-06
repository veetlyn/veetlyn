import type { ProductImageStore } from "@jendal-workspace/core";

export function createR2ImageStore(bucket: R2Bucket): ProductImageStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        bytes: await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      };
    },
    async has(key) {
      return (await bucket.head(key)) !== null;
    },
  };
}
