import type { PayPalServices } from "@jendal-workspace/api/context";
import { createAuth as createConfiguredAuth } from "@jendal-workspace/auth";
import type { TenantEnvironment } from "@jendal-workspace/core";
import { type Database, createDb } from "@jendal-workspace/db";
import { createSmtpMailer } from "@jendal-workspace/email";
import { createKvTokenCache, createPayPalClient } from "@jendal-workspace/paypal";
import type { ExecutionContext } from "hono";

import { logEmailError } from "./email-log";
import { ENV } from "./env.server";
import { createKvStoreCache } from "./tenant/kv-store-cache";

export function getDb(): Database {
  return createDb({ DATABASE_URL: ENV.HYPERDRIVE.connectionString });
}

export function createAuth(database: Database, executionCtx: ExecutionContext) {
  return createConfiguredAuth(ENV, database, {
    mailer: createSmtpMailer(ENV),
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    onEmailError: logEmailError,
  });
}

export function getPayPalServices(): PayPalServices | undefined {
  if (!ENV.PAYPAL_PARTNER_ID || !ENV.PAYPAL_ATTRIBUTION_ID) return undefined;
  const environment: TenantEnvironment = ENV.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";
  return {
    client: createPayPalClient({
      clientId: ENV.PAYPAL_CLIENT_ID,
      clientSecret: ENV.PAYPAL_CLIENT_SECRET,
      environment,
      partnerAttributionId: ENV.PAYPAL_ATTRIBUTION_ID,
      // OAuth tokens ride the shared store-cache KV; dev emulates KV in memory.
      tokenCache: createKvTokenCache(ENV.STORE_CACHE, `paypal-token:${environment}`),
    }),
    partnerId: ENV.PAYPAL_PARTNER_ID,
    // BETTER_AUTH_URL is the admin origin (apps/server/.env.schema).
    returnUrl: `${ENV.BETTER_AUTH_URL}/api/paypal/onboarding/return`,
    // team.paypal_merchant_id changed: drop the cached storefront lookups (cacheKeyFor in
    // packages/core/src/tenancy/resolve.ts). host: entries cannot be enumerated; they expire
    // within the 300-second TTL.
    onTeamMerchantChanged: async (team) => {
      const cache = createKvStoreCache(ENV.STORE_CACHE);
      await cache.delete(`id:${team.id}`);
      await cache.delete(`slug:${team.slug}`);
    },
  };
}
