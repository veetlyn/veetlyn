import type { Context as ApiContext } from "@jendal-workspace/api/context";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Context as HonoContext } from "hono";

import type { AppEnv } from "./app-env";

export async function createContext(c: HonoContext<AppEnv>, environment: TenantEnvironment): Promise<ApiContext> {
  const auth = c.get("auth");
  const headers = c.req.raw.headers;
  const session = await auth.api.getSession({ headers });
  return { db: c.get("db"), session, environment, auth, headers };
}
