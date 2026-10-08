import { attachmentDisposition } from "@jendal-workspace/core";
import { describe, expect, it, vi } from "vitest";

import { type SizedBucket, createR2FileStore } from "./file-store";

const CREDENTIALS = JSON.stringify({
  endpoint: "http://localhost:3000/cdn-cgi/local/r2/s3",
  bucketName: "files",
  region: "auto",
  accessKeyId: "AKID",
  secretAccessKey: "secret",
});

function fakeBucket(objects: Record<string, number> = {}): SizedBucket {
  return {
    async head(key) {
      const size = objects[key];
      return size === undefined ? null : { size };
    },
  };
}

function signedHeaders(url: URL) {
  return (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
}

describe("createR2FileStore", () => {
  describe("presignPut", () => {
    it("signs a PUT to the object with its content type and length", async () => {
      const store = createR2FileStore(fakeBucket(), CREDENTIALS);
      const { url, headers } = await store.presignPut({
        key: "stores/s1/files/f1",
        contentType: "application/zip",
        sizeBytes: 1234,
        expiresInSeconds: 900,
      });
      const parsed = new URL(url);
      expect(`${parsed.origin}${parsed.pathname}`).toBe("http://localhost:3000/cdn-cgi/local/r2/s3/files/stores/s1/files/f1");
      expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
      expect(parsed.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
      expect(signedHeaders(parsed)).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
      expect(headers).toEqual({ "content-type": "application/zip" });
    });

    it("binds the signature to the length and the type", async () => {
      vi.useFakeTimers({ now: new Date("2026-01-02T03:04:05Z"), toFake: ["Date"] });
      try {
        const store = createR2FileStore(fakeBucket(), CREDENTIALS);
        const input = { key: "k", contentType: "application/zip", sizeBytes: 1, expiresInSeconds: 900 };
        const signature = async (overrides: Partial<typeof input>) =>
          new URL((await store.presignPut({ ...input, ...overrides })).url).searchParams.get("X-Amz-Signature");
        const base = await signature({});
        expect(await signature({})).toBe(base);
        expect(await signature({ sizeBytes: 2 })).not.toBe(base);
        expect(await signature({ contentType: "application/pdf" })).not.toBe(base);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("presignGet", () => {
    it("signs a GET that downloads as an attachment", async () => {
      const store = createR2FileStore(fakeBucket(), CREDENTIALS);
      const url = new URL(await store.presignGet({ key: "stores/s1/files/f1", fileName: "Ünïcode pack.zip", expiresInSeconds: 300 }));
      expect(`${url.origin}${url.pathname}`).toBe("http://localhost:3000/cdn-cgi/local/r2/s3/files/stores/s1/files/f1");
      expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
      expect(url.searchParams.get("response-content-disposition")).toBe(attachmentDisposition("Ünïcode pack.zip"));
      expect(url.searchParams.has("response-content-type")).toBe(false);
      expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    });

    it("serves SVG files as octet-stream so they never render inline", async () => {
      const store = createR2FileStore(fakeBucket(), CREDENTIALS);
      const url = new URL(await store.presignGet({ key: "k", fileName: "logo.SVG", expiresInSeconds: 300 }));
      expect(url.searchParams.get("response-content-type")).toBe("application/octet-stream");
      expect(url.searchParams.get("response-content-disposition")).toBe(attachmentDisposition("logo.SVG"));
    });
  });

  it("encodes each key segment", async () => {
    const store = createR2FileStore(fakeBucket(), CREDENTIALS);
    const url = new URL(await store.presignGet({ key: "stores/my store/fïle #1.zip", fileName: "a.zip", expiresInSeconds: 60 }));
    expect(url.pathname).toBe("/cdn-cgi/local/r2/s3/files/stores/my%20store/f%C3%AFle%20%231.zip");
  });

  describe("head", () => {
    it("returns the object size", async () => {
      const store = createR2FileStore(fakeBucket({ "stores/s1/files/f1": 42 }), CREDENTIALS);
      expect(await store.head("stores/s1/files/f1")).toEqual({ sizeBytes: 42 });
    });

    it("returns null for a missing object", async () => {
      const store = createR2FileStore(fakeBucket(), CREDENTIALS);
      expect(await store.head("missing")).toBeNull();
    });
  });

  it.each([
    ["missing fields", JSON.stringify({ endpoint: "http://localhost:3000", bucketName: "files" })],
    ["not JSON", "not json"],
  ])("rejects presigning with bad credentials (%s) but keeps head working", async (_case, credentials) => {
    const store = createR2FileStore(fakeBucket({ k: 7 }), credentials);
    await expect(
      store.presignPut({ key: "k", contentType: "application/zip", sizeBytes: 1, expiresInSeconds: 900 }),
    ).rejects.toThrow(/S3 credentials/);
    await expect(store.presignGet({ key: "k", fileName: "a.zip", expiresInSeconds: 300 })).rejects.toThrow(
      /S3 credentials/,
    );
    expect(await store.head("k")).toEqual({ sizeBytes: 7 });
  });
});
