import { createAgentServices } from "@jendal-workspace/api/agent/services";
import type { Context as ApiContext } from "@jendal-workspace/api/context";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Context as HonoContext, ExecutionContext } from "hono";

import type { AppEnv } from "./app-env";
import { ENV } from "./env.server";
import {
  createCatalogServices,
  createFileStore,
  getEmailServices,
  getPayoutServices,
  getPayPalServices,
  invalidateStoreLookup,
  logActionLogError,
} from "./services";

// Stateless adapters over the ENV bindings, so one instance per isolate is enough.
const catalog = createCatalogServices();
const files = createFileStore();
const agent = createAgentServices({
  apiKey: ENV.AGENT_API_KEY,
  baseUrl: ENV.AGENT_BASE_URL,
  model: ENV.AGENT_MODEL,
  dailyTurns: ENV.AGENT_DAILY_TURNS,
});

export async function createContext(
  c: HonoContext<AppEnv>,
  environment: TenantEnvironment,
  executionCtx: ExecutionContext,
): Promise<ApiContext> {
  const auth = c.get("auth");
  const headers = c.req.raw.headers;
  const session = await auth.api.getSession({ headers });
  return {
    db: c.get("db"),
    session,
    environment,
    platformName: ENV.PLATFORM_NAME,
    auth,
    headers,
    paypal: getPayPalServices(),
    catalog,
    files,
    onTeamStatusChanged: invalidateStoreLookup,
    email: getEmailServices(executionCtx),
    payouts: await getPayoutServices(),
    agent,
    onActionLogError: logActionLogError,
  };
}
