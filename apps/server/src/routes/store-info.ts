import { Hono } from "hono";

import type { AppEnv } from "../app-env";

export const storeInfoRoute = new Hono<AppEnv>().get("/api/store", (c) => {
  const store = c.get("store");
  if (!store) return c.json({ error: "not_a_store_host" }, 404);
  return c.json({ storeId: store.id, slug: store.slug, name: store.name });
});
