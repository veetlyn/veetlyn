import type { Auth } from "@jendal-workspace/auth";
import { MAX_IMAGE_BYTES } from "@jendal-workspace/core";
import { createTestDb, hasTestDatabase, seedOrganization, seedStore, addMember, truncateAll } from "@jendal-workspace/db/testing/db";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { AppEnv } from "../app-env";
import { createCatalogImagesRoute } from "./catalog-images";

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
  };
  return { bucket: fromPartial<R2Bucket>(bucket), objects };
}

function fakeAuth(userId: string | null): Auth {
  return fromPartial<Auth>({
    api: {
      // getSession is generic over its options; the routes only await the session it resolves to.
      getSession: fromAny(async () => (userId ? { user: { id: userId } } : null)),
    },
  });
}

function uploadRequest(storeSlug: string, file?: File) {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request(`http://localhost/api/catalog/images?storeSlug=${storeSlug}`, { method: "POST", body: form });
}

function pngFile(size = 4, type = "image/png") {
  return new File([new Uint8Array(size)], "photo.png", { type });
}

describe.skipIf(!hasTestDatabase)("catalog image routes", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function appFor(userId: string | null) {
    const { bucket, objects } = fakeBucket();
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("auth", fakeAuth(userId));
      await next();
    });
    app.route("/", createCatalogImagesRoute(bucket));
    return { app, objects };
  }

  async function ownerOfStore(slug = "lamp-shop") {
    const { organizationId } = await seedOrganization(db);
    const userId = await addMember(db, { organizationId, role: "owner" });
    const store = await seedStore(db, { organizationId, slug });
    return { userId, store };
  }

  it("uploads an image for a store the caller can open and serves it back", async () => {
    const { userId, store } = await ownerOfStore();
    const { app } = appFor(userId);

    const response = await app.request(uploadRequest("lamp-shop", pngFile()));
    expect(response.status).toBe(200);
    const { key } = z.object({ key: z.string() }).parse(await response.json());
    expect(key).toMatch(new RegExp(`^stores/${store.id}/images/[0-9a-f-]{36}\\.png$`));

    const served = await app.request(`http://localhost/api/catalog/images/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
  });

  it("rejects anonymous uploads", async () => {
    const { app } = appFor(null);
    const response = await app.request(uploadRequest("lamp-shop", pngFile()));
    expect(response.status).toBe(401);
  });

  it("rejects uploads for stores the caller cannot open", async () => {
    await ownerOfStore();
    const { app } = appFor("someone-else");
    const response = await app.request(uploadRequest("lamp-shop", pngFile()));
    expect(response.status).toBe(404);
  });

  it("rejects missing, unsupported and oversized files", async () => {
    const { userId } = await ownerOfStore();
    const { app } = appFor(userId);

    expect((await app.request(uploadRequest("lamp-shop"))).status).toBe(400);
    expect((await app.request(uploadRequest("lamp-shop", pngFile(4, "image/svg+xml")))).status).toBe(400);
    expect((await app.request(uploadRequest("lamp-shop", pngFile(MAX_IMAGE_BYTES + 1)))).status).toBe(400);
  });

  it("answers 404 for unknown keys and refuses keys outside the image prefix", async () => {
    const { app } = appFor(null);
    expect((await app.request("http://localhost/api/catalog/images/stores/s1/images/missing.png")).status).toBe(404);
    expect((await app.request("http://localhost/api/catalog/images/other/key.png")).status).toBe(404);
  });
});
