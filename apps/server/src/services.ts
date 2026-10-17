import type { CatalogServices } from "@jendal-workspace/api/catalog/service";
import { databaseErrorFields } from "@jendal-workspace/api/use-cases/payments";
import type { EmailServices, PayoutServices, PayPalServices } from "@jendal-workspace/api/context";
import { createAuth as createConfiguredAuth } from "@jendal-workspace/auth";
import { createChannel3Client } from "@jendal-workspace/channel3";
import { errorName, type FileStore, importSecretKey, type TenantEnvironment } from "@jendal-workspace/core";
import { type Database, createDb } from "@jendal-workspace/db";
import { createMailer } from "@jendal-workspace/email";
import { createKvTokenCache, createPayPalClient } from "@jendal-workspace/paypal";
import { log } from "evlog";
import type { ExecutionContext } from "hono";

import { createHttpImageDownloader } from "./catalog/image-downloader";
import { createR2ImageStore } from "./catalog/image-store";
import { createKvTextCache } from "./catalog/text-cache";
import { logEmailError } from "./email-log";
import { ENV } from "./env.server";
import { createR2FileStore } from "./files/file-store";
import { createPayoutServices } from "./payouts";
import { siteOriginFor, storeOriginFor } from "./store-origin";
import { createKvStoreCache } from "./tenant/kv-store-cache";

export function getDb(): Database {
  return createDb({ DATABASE_URL: ENV.HYPERDRIVE.connectionString });
}

export function createAuth(database: Database, executionCtx: ExecutionContext) {
  return createConfiguredAuth(ENV, database, {
    mailer: createMailer(ENV),
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    onEmailError: logEmailError,
  });
}

// A mailer per request, as in createAuth; links in emails point at the site and dash origins derived from
// BETTER_AUTH_URL (http://dash.localhost:3001 in dev, https://dash.payleor.com in production).
export function getEmailServices(executionCtx: { waitUntil(promise: Promise<unknown>): void }): EmailServices {
  const dashOrigin = ENV.BETTER_AUTH_URL;
  return {
    mailer: createMailer(ENV),
    siteOrigin: siteOriginFor(dashOrigin),
    dashOrigin,
    storeOrigin: storeOriginFor({ storeDomain: ENV.STORE_DOMAIN || ENV.PLATFORM_DOMAIN, dashOrigin }),
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    onError: logEmailError,
  };
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
    sdk: { clientId: ENV.PAYPAL_CLIENT_ID, partnerAttributionId: ENV.PAYPAL_ATTRIBUTION_ID, environment },
    onTeamMerchantChanged: invalidateStoreLookup,
  };
}

let payoutServices: Promise<PayoutServices | undefined> | undefined;

// The key is imported once per isolate. An unreadable key is logged and leaves payouts off rather than failing every
// request that builds a context.
export function getPayoutServices(): Promise<PayoutServices | undefined> {
  payoutServices ??= loadPayoutServices();
  return payoutServices;
}

async function loadPayoutServices(): Promise<PayoutServices | undefined> {
  if (!ENV.PAYOUT_CREDENTIALS_KEY) return undefined;
  let secretKey: CryptoKey;
  try {
    secretKey = await importSecretKey(ENV.PAYOUT_CREDENTIALS_KEY);
  } catch (error) {
    log.error({ action: "payouts.key", error: { name: errorName(error), note: "PAYOUT_CREDENTIALS_KEY is unreadable." } });
    return undefined;
  }
  const environment: TenantEnvironment = ENV.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";
  return createPayoutServices({ secretKey, environment, tokenKv: ENV.STORE_CACHE });
}

// Postgres messages can quote the row's values (the caller's IP), so only the error's name and code are logged.
export function logActionLogError(cause: unknown): void {
  log.error({ action: "action_log.insert", error: databaseErrorFields(cause) });
}

// A change to team.paypal_merchant_id or team.status must drop the cached storefront lookups (cacheKeyFor in
// packages/core/src/tenancy/resolve.ts). host: entries cannot be enumerated; they expire within the 300-second TTL.
export async function invalidateStoreLookup(team: { id: string; slug: string }): Promise<void> {
  const cache = createKvStoreCache(ENV.STORE_CACHE);
  await cache.delete(`id:${team.id}`);
  await cache.delete(`slug:${team.slug}`);
}

// `source` is null while CHANNEL3_API_KEY is empty, so the tRPC procedures answer "unavailable"
// instead of failing.
export function createCatalogServices(): CatalogServices {
  const apiKey = ENV.CHANNEL3_API_KEY;
  return {
    source: apiKey ? createChannel3Client({ apiKey }) : null,
    images: createR2ImageStore(ENV.PRODUCT_IMAGES),
    imageDownloader: createHttpImageDownloader(),
    textCache: createKvTextCache(ENV.STORE_CACHE),
    // Store currency lands with the store settings workstream; everything is USD until then.
    currency: "USD",
  };
}

export function createFileStore(): FileStore {
  return createR2FileStore(ENV.FILES, ENV.FILES_S3);
}
