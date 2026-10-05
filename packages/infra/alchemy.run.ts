import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import "varlock/auto-load";

import { localPorts, parseLocalStage, stageUrls, tunnelSettings } from "./dev-hosts.ts";

// Set only by the `dev` and `dev:preprod` scripts, so deployed stages keep their env values.
const localStage = parseLocalStage(process.env.JENDAL_LOCAL_STAGE);
const ports = localPorts(localStage ?? "dev");
const localUrls = localStage ? stageUrls(localStage, tunnelSettings(process.env)) : undefined;
const platformDomain = localUrls ? localUrls.platformDomain : Config.String("PLATFORM_DOMAIN");
const storeDomain = localUrls
  ? localUrls.platformDomain
  : Config.NonEmptyString("STORE_DOMAIN").pipe(Config.orElse(() => Config.String("PLATFORM_DOMAIN")));

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

// alchemy dev does not use the Hyperdrive service: the Worker connects to the dev origin itself, and
// workerd only trusts public CAs, so it cannot reach Aiven (private CA). Local stages use a local database.
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

const observability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true },
  traces: { enabled: true },
};

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  observability,
  env: {
    HYPERDRIVE: Database,
    STORE_CACHE: StoreCache,
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: localUrls ? localUrls.admin : Config.String("BETTER_AUTH_URL"),
    PLATFORM_DOMAIN: platformDomain,
    STORE_DOMAIN: storeDomain,
    PAYPAL_ENVIRONMENT: Config.String("PAYPAL_ENVIRONMENT"),
    PAYPAL_CLIENT_ID: Config.String("PAYPAL_CLIENT_ID"),
    PAYPAL_CLIENT_SECRET: Config.Redacted("PAYPAL_CLIENT_SECRET"),
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
  env: {
    SERVER: server,
    PLATFORM_DOMAIN: platformDomain,
    STORE_DOMAIN: storeDomain,
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
    const web = yield* Web;

    return {
      web: web.url,
      server: serverWorker.url,
    };
  }),
);
