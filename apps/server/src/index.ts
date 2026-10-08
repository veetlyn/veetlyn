import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@jendal-workspace/api/routers/index";
import { processPayPalWebhookEvent } from "@jendal-workspace/api/use-cases/paypal-webhooks";
import type { TenantEnvironment } from "@jendal-workspace/core";
import {
  findWebhookEvent,
  finishWebhookEvent,
  noteWebhookAttempt,
} from "@jendal-workspace/db/repositories/paypal-webhooks";
import { createStoreDirectory } from "@jendal-workspace/db/repositories/stores";
import { initLogger } from "evlog";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog } from "evlog/hono";
import { Hono } from "hono";

import type { AppEnv } from "./app-env";
import { createContext } from "./context";
import { discordRoute } from "./discord/route";
import { ENV } from "./env.server";
import { runMaintenance } from "./maintenance";
import { handlePayPalWebhookBatch } from "./paypal-webhook-queue";
import { createCatalogImagesRoute } from "./routes/catalog-images";
import { createPayPalOnboardingRoute } from "./routes/paypal-onboarding";
import { createPayPalWebhookRoute } from "./routes/paypal-webhooks";
import { storeInfoRoute } from "./routes/store-info";
import { createAuth, createFileStore, getDb, getPayPalServices } from "./services";
import { createKvStoreCache } from "./tenant/kv-store-cache";
import { tenantMiddleware } from "./tenant/middleware";
import { trpcErrorContext } from "./trpc-error-log";

initLogger({
  env: { service: "jendal-api" },
});

const environment: TenantEnvironment = ENV.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";

const domains = { platformDomain: ENV.PLATFORM_DOMAIN, storeDomain: ENV.STORE_DOMAIN || ENV.PLATFORM_DOMAIN };

const app = new Hono<AppEnv>();

app.use(evlog());

app.use("*", async (c, next) => {
  const db = getDb();
  const auth = createAuth(db, c.executionCtx);
  c.set("db", db);
  c.set("auth", auth);
  const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
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

app.use("/trpc/*", (c, next) =>
  trpcServer({
    endpoint: "/trpc",
    router: appRouter,
    createContext: () => createContext(c, environment),
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
    enqueue: (eventId, options) => ENV.PAYPAL_WEBHOOKS.send({ eventId }, options),
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
          return processPayPalWebhookEvent({ db, paypal }, event);
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
    try {
      await runMaintenance({
        db,
        enqueueWebhookEvents: (eventIds) =>
          ENV.PAYPAL_WEBHOOKS.sendBatch(eventIds.map((eventId) => ({ body: { eventId } }))).then(() => undefined),
        files: createFileStore(),
      });
    } finally {
      ctx.waitUntil(db.$client.end());
    }
  },
} satisfies ExportedHandler<Env>;
