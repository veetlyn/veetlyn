import { findStorePolicyInfo } from "@jendal-workspace/db/repositories/stores";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

export const storeInfoRoute = new Hono<AppEnv>()
  .get("/api/store", (c) => {
    const store = c.get("store");
    if (!store) return c.json({ error: "not_a_store_host" }, 404);
    return c.json({ storeId: store.id, slug: store.slug, name: store.name });
  })
  .get("/api/store/policy-info", async (c) => {
    const store = c.get("store");
    if (!store) return c.json({ error: "not_a_store_host" }, 404);
    const info = await findStorePolicyInfo(c.get("db"), store.id);
    if (!info) return c.json({ error: "store_not_found" }, 404);
    return c.json({
      slug: store.slug,
      name: store.name,
      supportEmail: info.supportEmail,
      createdAt: info.createdAt.toISOString(),
    });
  });
