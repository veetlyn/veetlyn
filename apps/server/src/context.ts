import type { CallRuntime } from "@jendal-workspace/api/agent/runtime";
import { createAgentServices } from "@jendal-workspace/api/agent/services";
import { getAgentByName } from "agents";

import type { CallAgent } from "./agent/call-agent";
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
  getPolarClient,
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

// SAFETY: CALL_AGENT is declared in packages/infra/alchemy.run.ts for the CallAgent class this Worker exports
// (index.ts); infra declares it untyped so its type check does not compile the Worker's sources.
const callAgents = ENV.CALL_AGENT as DurableObjectNamespace<CallAgent>;

// Turns run in the call's own Agent, so a call takes one turn at a time wherever its requests land.
const calls: CallRuntime | undefined = agent && {
  dailyTurns: agent.dailyTurns,
  run: async (turn) => (await getAgentByName<Env, CallAgent>(callAgents, turn.callId)).runTurn(turn),
};

export async function createContext(
  c: HonoContext<AppEnv>,
  environment: TenantEnvironment,
  executionCtx: ExecutionContext,
): Promise<ApiContext> {
  const auth = c.get("auth");
  const headers = c.req.raw.headers;
  const session = await auth.api.getSession({ headers });
  const polar = getPolarClient();
  return {
    db: c.get("db"),
    session,
    environment,
    platformName: ENV.PLATFORM_NAME,
    auth,
    headers,
    paypal: getPayPalServices(),
    billing: polar ? { polar, dashOrigin: ENV.BETTER_AUTH_URL } : undefined,
    catalog,
    files,
    onTeamStatusChanged: invalidateStoreLookup,
    email: getEmailServices(executionCtx),
    payouts: await getPayoutServices(),
    calls,
    onActionLogError: logActionLogError,
  };
}
