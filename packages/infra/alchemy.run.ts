import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import "varlock/auto-load";

import { deployedHosts, parseDeployedStage, storeSlugsFrom } from "./deploy-hosts.ts";
import { localPorts, parseLocalStage, stageUrls, tunnelSettings } from "./dev-hosts.ts";

// Optional public settings; the web app treats "" as not set.
const optionalString = (name: string) => Config.String(name).pipe(Config.withDefault(""));

// JENDAL_LOCAL_STAGE is set by the `dev` and `dev:preprod` scripts, JENDAL_DEPLOY_STAGE by the deploy scripts.
const localStage = parseLocalStage(process.env.JENDAL_LOCAL_STAGE);
const deployStage = parseDeployedStage(process.env.JENDAL_DEPLOY_STAGE);
if (!localStage && !deployStage) {
  throw new Error("Run a local stage (pnpm dev) or deploy with pnpm deploy:staging or pnpm deploy:production.");
}
const ports = localPorts(localStage ?? "dev");
const localUrls = localStage ? stageUrls(localStage, tunnelSettings(process.env)) : undefined;
const hosts = deployStage ? deployedHosts(deployStage, storeSlugsFrom(process.env.STAGING_STORE_SLUGS)) : undefined;
// The empty fallbacks are unreachable after the check above.
const platformDomain = localUrls ? localUrls.platformDomain : (hosts?.platformDomain ?? "");
const storeDomain = localUrls ? localUrls.storeDomain : (hosts?.storeDomain ?? "");
const dashOrigin = localUrls ? localUrls.dash : (hosts?.dashOrigin ?? "");

function postgresOrigin(connectionUri: string) {
  const url = new URL(connectionUri);
  return {
    scheme: "postgres" as const,
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: Redacted.make(decodeURIComponent(url.password)),
  };
}

// alchemy dev does not use the Hyperdrive service: the Worker connects to the dev origin itself, so local
// stages use a local database instead of a deployed one.
function devDatabaseOrigin() {
  const url = process.env.DEV_DATABASE_URL;
  if (!url) throw new Error("Set DEV_DATABASE_URL in packages/infra/.env to run a local stage.");
  return { ...postgresOrigin(url), sslmode: "disable" as const };
}

export const Database = Effect.gen(function* () {
  const origin = postgresOrigin(Redacted.value(yield* Config.Redacted("DATABASE_URL")));
  return yield* Cloudflare.Hyperdrive.Connection("Database", {
    origin,
    // Reads must see writes immediately (spec §2.1).
    caching: { disabled: true },
    dev: localStage ? devDatabaseOrigin() : undefined,
  });
});

export const StoreCache = Cloudflare.KV.Namespace("StoreCache");

export const PayPalWebhookQueue = Cloudflare.Queues.Queue("PayPalWebhooks");

export const ProductImages = Cloudflare.R2.Bucket("ProductImages");

// The platform site and the dashboard (apps/web/src/lib/platform-url.ts).
const platformOrigins = localUrls ? [localUrls.platform, localUrls.dash] : (hosts?.fileOrigins ?? []);

// Private files (delivery files now, digital products later). Browsers upload and download them through
// presigned URLs, so the bucket allows PUT and GET from our hosts. alchemy dev's local S3 endpoint ignores CORS.
export const Files = Cloudflare.R2.Bucket("Files", {
  cors: [
    {
      allowedMethods: ["PUT", "GET", "HEAD"],
      allowedOrigins: platformOrigins,
      allowedHeaders: ["content-type"],
      maxAgeSeconds: 3600,
    },
  ],
});

const observability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true },
  traces: { enabled: true },
};

// A request makes many database round trips one after another. At the edge near a visitor far from the
// database, each one crossed an ocean (8 s for a dashboard page); placed next to the database, they take
// milliseconds and only the request itself travels. Local stages run on this machine.
function databasePlacement() {
  const url = process.env.DATABASE_URL;
  if (!deployStage || !url) return undefined;
  const origin = postgresOrigin(url);
  return { host: `${origin.host}:${origin.port}` };
}

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  observability,
  placement: databasePlacement(),
  domain: hosts?.api.domain,
  // Runs the maintenance sweeps in apps/server/src/maintenance.ts.
  crons: ["*/10 * * * *"],
  env: {
    HYPERDRIVE: Database,
    STORE_CACHE: StoreCache,
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: dashOrigin,
    DEPLOY_STAGE: deployStage ?? localStage ?? "dev",
    PLATFORM_DOMAIN: platformDomain,
    STORE_DOMAIN: storeDomain,
    PAYPAL_ENVIRONMENT: Config.String("PAYPAL_ENVIRONMENT"),
    PAYPAL_CLIENT_ID: Config.String("PAYPAL_CLIENT_ID"),
    PAYPAL_CLIENT_SECRET: Config.Redacted("PAYPAL_CLIENT_SECRET"),
    PAYPAL_PARTNER_ID: Config.String("PAYPAL_PARTNER_ID").pipe(Config.withDefault("")),
    PAYPAL_ATTRIBUTION_ID: Config.String("PAYPAL_ATTRIBUTION_ID").pipe(Config.withDefault("")),
    PAYPAL_WEBHOOK_ID: Config.String("PAYPAL_WEBHOOK_ID").pipe(Config.withDefault("")),
    PAYPAL_WEBHOOKS: PayPalWebhookQueue,
    DISCORD_CLIENT_ID: Config.String("DISCORD_CLIENT_ID"),
    DISCORD_CLIENT_SECRET: Config.Redacted("DISCORD_CLIENT_SECRET"),
    DISCORD_APP_ID: Config.String("DISCORD_APP_ID"),
    DISCORD_PUBLIC_KEY: Config.String("DISCORD_PUBLIC_KEY"),
    DISCORD_BOT_TOKEN: Config.Redacted("DISCORD_BOT_TOKEN"),
    RESEND_API_KEY: Config.Redacted("RESEND_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
    EMAIL_DOMAIN: Config.String("EMAIL_DOMAIN").pipe(Config.withDefault("payleor.com")),
    EMAIL_REPLY_TO: Config.String("EMAIL_REPLY_TO").pipe(Config.withDefault("support@payleor.com")),
    PRODUCT_IMAGES: ProductImages,
    FILES: Files,
    FILES_S3: Cloudflare.R2.S3Credentials(Files, { access: "read-write" }),
    CHANNEL3_API_KEY: Config.Redacted("CHANNEL3_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
    PAYOUT_CREDENTIALS_KEY: Config.Redacted("PAYOUT_CREDENTIALS_KEY").pipe(Config.withDefault(Redacted.make(""))),
  },
  dev: {
    port: ports.api,
    // Fail instead of drifting to the next port, which may belong to the other stage.
    strictPort: true,
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

// Website.Vinext provisions VINEXT_KV_CACHE and CF_VERSION_METADATA itself; do not bind them.
export class Web extends Cloudflare.Website.Vinext<Web>()("web", {
  rootDir: "../../apps/web",
  memo: {
    lockfile: true,
    // The web build bundles these workspace packages.
    include: ["**/*", "../../packages/core/src/**", "../../packages/ui/src/**"],
  },
  observability,
  // Website.Vinext turns Workers Cache on, which cached signed-in API answers forwarded through this Worker and
  // served them to other callers. Nothing here is meant to be shared; static files have their own caching.
  cache: { enabled: false },
  // Rendering a page calls the api Worker several times in a row, so it runs beside the api Worker and the
  // database; static files are still served from the edge.
  placement: databasePlacement(),
  domain: hosts?.web.domain,
  routes: hosts?.web.routes,
  env: {
    SERVER: server,
    PAYPAL_ENVIRONMENT: Config.String("PAYPAL_ENVIRONMENT"),
    PLATFORM_DOMAIN: platformDomain,
    STORE_DOMAIN: storeDomain,
    SANDBOX_BUYER_EMAIL: optionalString("SANDBOX_BUYER_EMAIL"),
    SANDBOX_BUYER_PASSWORD: optionalString("SANDBOX_BUYER_PASSWORD"),
    SANDBOX_CARD_NUMBER: optionalString("SANDBOX_CARD_NUMBER"),
    SANDBOX_CARD_EXPIRY: optionalString("SANDBOX_CARD_EXPIRY"),
    SANDBOX_CARD_CVV: optionalString("SANDBOX_CARD_CVV"),
    DEMO_STORE_SLUG: optionalString("DEMO_STORE_SLUG"),
  },
  dev: {
    port: ports.web,
  },
}) {}

export type WebEnv = Cloudflare.InferEnv<typeof Web>;

export default Alchemy.Stack(
  "jendal-workspace",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const serverWorker = yield* server;
    const webhookQueue = yield* PayPalWebhookQueue;
    // One consumer: the api Worker's queue() handler. maxRetries is above the handler's own limit (5), so the
    // handler always records the final outcome itself.
    yield* Cloudflare.Queues.Consumer("PayPalWebhooksConsumer", {
      queueId: webhookQueue.queueId,
      scriptName: serverWorker.workerName,
      settings: { batchSize: 10, maxRetries: 10, maxWaitTimeMs: 1000, retryDelay: 30 },
    });
    if (deployStage === "production") {
      // Seller sites: the web Worker's *.payleor.app route needs a proxied record to receive requests.
      yield* Cloudflare.DNS.Record("StoreWildcard", {
        zoneId: yield* Config.String("CLOUDFLARE_STORE_ZONE_ID"),
        name: "*.payleor.app",
        type: "AAAA",
        content: "100::",
        proxied: true,
        comment: "Seller sites, served by the web Worker's route",
      });
    }
    const web = yield* Web;

    return {
      web: web.url,
      server: serverWorker.url,
    };
  }),
);
