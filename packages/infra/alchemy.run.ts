import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

import { localPorts, parseLocalStage, stageUrls, tunnelSettings } from "./dev-hosts.ts";

// Set only by the `dev` and `dev:preprod` scripts, so deployed stages keep their own Worker URLs.
const localStage = parseLocalStage(process.env.JENDAL_LOCAL_STAGE);
const ports = localPorts(localStage ?? "dev");
const localUrls = localStage ? stageUrls(localStage, tunnelSettings(process.env)) : undefined;

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    DATABASE_URL: Config.Redacted("DATABASE_URL"),
    CORS_ORIGIN: localUrls ? localUrls.web : Config.String("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: localUrls ? localUrls.api : Cloudflare.Worker.URL,
  },
  dev: {
    port: ports.api,
    // Fail instead of drifting to the next port, which may belong to the other stage.
    strictPort: true,
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "jendal-workspace",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const serverWorker = yield* server;
    const webWorker = yield* Cloudflare.Website.StaticSite("web", {
      cwd: "../../apps/web",
      command: "pnpm run build:cloudflare",
      // Rebuild shared workspace dependencies until Alchemy has a workspace-aware default memo.
      memo: false,
      outdir: ".open-next/assets",
      main: "../../apps/web/.open-next/worker.js",
      bundle: true,
      compatibility: {
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      env: {
        IMAGES: Cloudflare.Images.Images(),
        NEXT_PUBLIC_SERVER_URL: localUrls ? localUrls.api : serverWorker.url.as<string>(),
      },
      dev: {
        command: `pnpm exec next dev --port ${ports.web}`,
        url: `http://localhost:${ports.web}`,
      },
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
    };
  }),
);
