import { describe, expect, it } from "vitest";

import { createR2ImageStore } from "./image-store";

function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  const bucket = {
    async put(key: string, bytes: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType ?? "application/octet-stream" });
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        httpMetadata: { contentType: object.contentType },
        arrayBuffer: async () => object.bytes,
      };
    },
    async head(key: string) {
      return objects.has(key) ? { key } : null;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

describe("createR2ImageStore", () => {
  it("stores bytes with their content type and reads them back", async () => {
    const { bucket } = fakeBucket();
    const store = createR2ImageStore(bucket);
    const bytes = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;

    await store.put("stores/s1/images/a.png", bytes, "image/png");

    expect(await store.has("stores/s1/images/a.png")).toBe(true);
    expect(await store.has("stores/s1/images/missing.png")).toBe(false);
    const stored = await store.get("stores/s1/images/a.png");
    expect(stored?.contentType).toBe("image/png");
    expect(new Uint8Array(stored!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get("stores/s1/images/missing.png")).toBeNull();
  });
});
