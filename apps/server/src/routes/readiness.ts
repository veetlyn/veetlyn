import { Hono } from "hono";

// A real query, not lazy client construction, determines readiness. The caller
// owns the connection lifecycle; failures never expose connection details.
export function createReadinessRoute(probe: () => Promise<void>) {
  return new Hono().get("/health/ready", async (c) => {
    try {
      await probe();
      c.header("Cache-Control", "no-store");
      return c.json({ ready: true });
    } catch {
      c.header("Cache-Control", "no-store");
      return c.json({ ready: false }, 503);
    }
  });
}
