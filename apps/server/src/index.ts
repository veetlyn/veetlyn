import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@jendal-workspace/api/routers/index";
import { createProjectPayouts, sendDuePayouts } from "@jendal-workspace/api/use-cases/payout-sweeps";
import { processPayPalWebhookEvent } from "@jendal-workspace/api/use-cases/paypal-webhooks";
import type { TenantEnvironment } from "@jendal-workspace/core";
import {
  findWebhookEvent,
  finishWebhookEvent,
  noteWebhookAttempt,
} from "@jendal-workspace/db/repositories/paypal-webhooks";
import { createStoreDirectory } from "@jendal-workspace/db/repositories/stores";
import { initLogger } from "evlog";
import { createAuthMiddleware } from "evlog/better-auth";
import { evlog } from "evlog/hono";
import { Hono } from "hono";

import type { AppEnv } from "./app-env";
import { createContext } from "./context";
import { discordRoute } from "./discord/route";
import { ENV } from "./env.server";
import { runMaintenance } from "./maintenance";
import { BRIDGE_PATH, bridgeResponse, createMcpRoute, widgetOriginsFor } from "./mcp/route";
import { noStoreByDefault } from "./no-store";
import { handlePayPalWebhookBatch } from "./paypal-webhook-queue";
import { settleSentPayouts } from "./payouts";
import { createCatalogImagesRoute } from "./routes/catalog-images";
import { createPayPalOnboardingRoute } from "./routes/paypal-onboarding";
import { createPayPalWebhookRoute } from "./routes/paypal-webhooks";
import { storeInfoRoute } from "./routes/store-info";
import {
  createAuth,
  createFileStore,
  getDb,
  getEmailServices,
  getPayoutServices,
  getPayPalServices,
  logActionLogError,
} from "./services";
import { createKvStoreCache } from "./tenant/kv-store-cache";
import { tenantMiddleware } from "./tenant/middleware";
import { trpcErrorContext } from "./trpc-error-log";

initLogger({
  env: { service: "jendal-api", environment: ENV.DEPLOY_STAGE },
});

const environment: TenantEnvironment = ENV.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";

const domains = { platformDomain: ENV.PLATFORM_DOMAIN, storeDomain: ENV.STORE_DOMAIN || ENV.PLATFORM_DOMAIN };

const app = new Hono<AppEnv>();

app.use(evlog());
app.use(noStoreByDefault);

app.use("*", async (c, next) => {
  const db = getDb();
  const auth = createAuth(db, c.executionCtx);
  c.set("db", db);
  c.set("auth", auth);
  const identifyUser = createAuthMiddleware(auth, {
    exclude: ["/api/auth/**"],
    maskEmail: true,
  });
  try {
    await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
    await next();
  } finally {
    c.executionCtx.waitUntil(db.$client.end());
  }
});

app.use(
  "/api/store/*",
  tenantMiddleware({ domains, environment }, (c) => ({
    directory: createStoreDirectory(c.get("db")),
    cache: createKvStoreCache(ENV.STORE_CACHE),
  })),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

// OAuth discovery for AI clients connecting the plugin: the protected resource on this host, and the
// authorization server's metadata with the issuer path appended (RFC 8414), forwarded here by the web Worker.
app.on(
  ["GET", "HEAD"],
  [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/*",
    "/.well-known/oauth-authorization-server/*",
    "/.well-known/openid-configuration/*",
  ],
  (c) => c.get("auth").handler(c.req.raw),
);

const mcpFiles = createFileStore();
const widgetOrigins = widgetOriginsFor({ authUrl: ENV.BETTER_AUTH_URL, storeDomain: domains.storeDomain });

app.get(BRIDGE_PATH, () => bridgeResponse());

app.all("/mcp", (c) => {
  const email = getEmailServices(c.executionCtx);
  return createMcpRoute(
    {
      actions: {
        db: c.get("db"),
        files: mcpFiles,
        auth: c.get("auth"),
        paypal: getPayPalServices(),
        email,
        onLogError: logActionLogError,
      },
      auth: c.get("auth"),
      log: c.get("log"),
      storeOrigin: email.storeOrigin,
    },
    { authUrl: ENV.BETTER_AUTH_URL, origins: widgetOrigins },
  )(c.req.raw);
});

app.use("/trpc/*", (c, next) =>
  trpcServer({
    endpoint: "/trpc",
    router: appRouter,
    createContext: () => createContext(c, environment, c.executionCtx),
    onError: ({ error, path }) => {
      const context = trpcErrorContext(error, path);
      if (context) c.get("log").error(context.error, context.fields);
    },
  })(c, next),
);

app.route("/api/paypal/onboarding/return", createPayPalOnboardingRoute(getPayPalServices()));

// The URL registered on the partner app (R1c plan, fact 1); api.payleor.com reaches this Worker directly.
app.route(
  "/webhooks/paypal",
  createPayPalWebhookRoute({
    paypal: getPayPalServices(),
    webhookId: ENV.PAYPAL_WEBHOOK_ID,
    enqueue: (eventId, options) => ENV.PAYPAL_WEBHOOKS.send({ eventId }, options).then(() => undefined),
  }),
);

app.route("/", discordRoute);
app.route("/", storeInfoRoute);
app.route("/", createCatalogImagesRoute(ENV.PRODUCT_IMAGES));

app.get("/", (c) => {
  return c.text("OK");
});

export default {
  fetch: app.fetch,
  async queue(batch, _env, ctx) {
    const db = getDb();
    const paypal = getPayPalServices();
    try {
      await handlePayPalWebhookBatch(batch.messages, {
        find: (eventId) => findWebhookEvent(db, eventId),
        process: (event) => {
          if (!paypal) throw new Error("PayPal is not configured on this server");
          return processPayPalWebhookEvent({ db, paypal, email: getEmailServices(ctx) }, event);
        },
        finish: (eventId, outcome) => finishWebhookEvent(db, eventId, outcome),
        noteAttempt: (eventId, error) => noteWebhookAttempt(db, eventId, error),
      });
    } finally {
      ctx.waitUntil(db.$client.end());
    }
  },
  async scheduled(_controller, _env, ctx) {
    const db = getDb();
    const payouts = await getPayoutServices();
    try {
      await runMaintenance({
        db,
        enqueueWebhookEvents: (eventIds) =>
          ENV.PAYPAL_WEBHOOKS.sendBatch(eventIds.map((eventId) => ({ body: { eventId } }))).then(() => undefined),
        files: createFileStore(),
        // Project payouts are created even without payout services; approved ones then wait.
        createProjectPayouts: () => createProjectPayouts({ db, payouts }, { now: new Date() }),
        sendPayouts: payouts ? () => sendDuePayouts({ db, payouts }, { now: new Date() }) : undefined,
        settlePayouts: payouts ? () => settleSentPayouts({ db, payouts }) : undefined,
      });
    } finally {
      ctx.waitUntil(db.$client.end());
    }
  },
} satisfies ExportedHandler<Env>;
