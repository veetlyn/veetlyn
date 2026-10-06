import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@jendal-workspace/api/routers/index";
import type { TenantEnvironment } from "@jendal-workspace/core";
import { createStoreDirectory } from "@jendal-workspace/db/repositories/stores";
import { initLogger } from "evlog";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog } from "evlog/hono";
import { Hono } from "hono";

import type { AppEnv } from "./app-env";
import { createContext } from "./context";
import { ENV } from "./env.server";
import { createPayPalOnboardingRoute } from "./routes/paypal-onboarding";
import { storeInfoRoute } from "./routes/store-info";
import { createAuth, getDb, getPayPalServices } from "./services";
import { createKvStoreCache } from "./tenant/kv-store-cache";
import { tenantMiddleware } from "./tenant/middleware";

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
  })(c, next),
);

app.route("/api/paypal/onboarding/return", createPayPalOnboardingRoute(getPayPalServices()));

app.route("/", storeInfoRoute);

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
