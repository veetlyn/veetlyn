import { createMiddleware } from "hono/factory";

// Before auth initialization: direct API-host requests cannot bypass the marketing UI.
export function productionAuthGate(publicAccess: string) {
  return createMiddleware(async (c, next) => {
    if (publicAccess === "waitlist") {
      c.header("Cache-Control", "no-store");
      return c.json({ error: "launch_pending", message: "Accounts open at launch. Join the waitlist on our website." }, 403);
    }
    await next();
  });
}
