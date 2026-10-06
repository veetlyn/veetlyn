import { MAX_IMAGE_BYTES, canOpenStore, imageExtensionFor, newProductImageKey } from "@jendal-workspace/core";
import { findStoreAccess } from "@jendal-workspace/db/repositories/stores";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

const ROUTE_PREFIX = "/api/catalog/images/";

// Image uploads are multipart (tRPC inputs are JSON); the tRPC catalog router stores the keys
// this route returns. Downloads are public: the UUID in the key is the capability.
export function createCatalogImagesRoute(bucket: R2Bucket) {
  return new Hono<AppEnv>()
    .post("/api/catalog/images", async (c) => {
      const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const storeSlug = (c.req.query("storeSlug") ?? "").toLowerCase();
      const access = await findStoreAccess(c.get("db"), { slug: storeSlug, userId: session.user.id });
      if (!access || !canOpenStore(access)) return c.json({ error: "store_not_found" }, 404);

      const body = await c.req.parseBody();
      const file = body["file"];
      if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
      const extension = imageExtensionFor(file.type);
      if (!extension) return c.json({ error: "unsupported_type" }, 400);
      if (file.size > MAX_IMAGE_BYTES) return c.json({ error: "file_too_large" }, 400);

      const key = newProductImageKey(access.store.id, extension);
      await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      return c.json({ key });
    })
    .get("/api/catalog/images/*", async (c) => {
      const key = c.req.path.slice(ROUTE_PREFIX.length);
      if (!key.startsWith("stores/")) return c.json({ error: "not_found" }, 404);
      const object = await bucket.get(key);
      if (!object) return c.json({ error: "not_found" }, 404);
      const bytes = await object.arrayBuffer();
      return c.body(bytes, 200, {
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      });
    });
}
