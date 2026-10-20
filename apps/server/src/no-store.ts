import type { MiddlewareHandler } from "hono";

// Answers carry account data, and Cloudflare would otherwise serve a cached answer to the next caller of the same
// URL. A route that is safe to share (catalog images) sets its own Cache-Control, which is kept.
export const noStoreByDefault: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "private, no-store");
};
