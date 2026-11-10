import { verifyOAuthQueryParams } from "@jendal-workspace/auth";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

const MAX_QUERY = 4_096;

// What the consent page may show: the client, the host tokens return to and the scopes, taken only from an
// authorization query this server signed and that has not expired. A hand-made consent link with another return host
// or fewer scopes than the real request is refused instead of displayed.
export function createOAuthConsentRoute(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/api/oauth/consent-view", async (c) => {
    const auth = c.get("auth");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "sign_in" }, 401);
    const query = c.req.query("q") ?? "";
    const secret = auth.options.secret;
    if (!secret || query.length === 0 || query.length > MAX_QUERY || !(await verifyOAuthQueryParams(query, secret))) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const params = new URLSearchParams(query);
    return c.json({
      clientId: params.get("client_id") ?? "",
      redirectUri: params.get("redirect_uri") ?? "",
      scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
    });
  });
  return app;
}
