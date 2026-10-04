import type { Context as ApiContext } from "@jendal-workspace/api/context";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Context as HonoContext } from "hono";

import type { AppEnv } from "./app-env";

export async function createContext(c: HonoContext<AppEnv>, environment: TenantEnvironment): Promise<ApiContext> {
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  return { db: c.get("db"), session, environment };
}
