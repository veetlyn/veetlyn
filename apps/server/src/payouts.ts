import type { PayoutServices } from "@jendal-workspace/api/context";
import { type PayoutDeps, settlePayout } from "@jendal-workspace/api/use-cases/payouts";
import { hashToken, type TenantEnvironment } from "@jendal-workspace/core";
import { listSentPayoutRequests } from "@jendal-workspace/db/repositories/payout-requests";
import {
  createKvTokenCache,
  createPayPalClient,
  type FetchLike,
  type JsonKv,
  type PayPalTokenCache,
} from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";

import { errorNote } from "./paypal-webhook-queue";

export const PAYOUT_SETTLE_DELAY_MS = 60_000;
export const PAYOUT_SETTLE_BATCH = 50;

type TeamApp = { teamId: string; clientId: string; clientSecret: string };

// The key carries a digest of the client id and secret: verifying newly pasted credentials must fetch a token with
// them, never reuse one the team's earlier credentials obtained.
export async function teamTokenCacheKey(environment: TenantEnvironment, app: TeamApp): Promise<string> {
  const digest = await hashToken(`${app.clientId}:${app.clientSecret}`);
  return `paypal-token:${environment}:team:${app.teamId}:${digest}`;
}

function createTeamTokenCache(kv: JsonKv, environment: TenantEnvironment, app: TeamApp): PayPalTokenCache {
  let cache: Promise<PayPalTokenCache> | undefined;
  const resolve = () => {
    cache ??= teamTokenCacheKey(environment, app).then((key) => createKvTokenCache(kv, key));
    return cache;
  };
  return {
    get: async () => (await resolve()).get(),
    set: async (token) => (await resolve()).set(token),
    clear: async () => (await resolve()).clear(),
  };
}

// Team clients carry no partner attribution id: they are the team's own calls with its own REST app.
export function createPayoutServices(input: {
  secretKey: CryptoKey;
  environment: TenantEnvironment;
  tokenKv: JsonKv;
  fetch?: FetchLike;
}): PayoutServices {
  return {
    secretKey: input.secretKey,
    keyId: "v1",
    clientFor(app) {
      return createPayPalClient({
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        environment: input.environment,
        fetch: input.fetch,
        tokenCache: createTeamTokenCache(input.tokenKv, input.environment, app),
      });
    },
  };
}

// Payout webhooks go to each team's own REST app, so payouts PayPal is working on are settled by reading their batch.
// One request failing (no credentials, PayPal down) is logged and the others still settle.
export async function settleSentPayouts(
  deps: PayoutDeps & { now?: () => Date },
): Promise<{ checked: number; settled: number }> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const requests = await listSentPayoutRequests(deps.db, {
    sentBefore: new Date(now - PAYOUT_SETTLE_DELAY_MS),
    limit: PAYOUT_SETTLE_BATCH,
  });
  let settled = 0;
  for (const request of requests) {
    try {
      const result = await settlePayout(deps, request);
      if (result.status !== "sent") settled++;
    } catch (error) {
      log.error({
        action: "maintenance.payouts.settle",
        payoutRequest: { id: request.id },
        team: { id: request.teamId },
        error: { code: error instanceof TRPCError ? error.code : undefined, note: errorNote(error) },
      });
    }
  }
  return { checked: requests.length, settled };
}
