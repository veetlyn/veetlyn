import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    DATABASE_URL: Config.Redacted("DATABASE_URL"),
    CORS_ORIGIN: Config.String("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
  },
  dev: {
    port: 3000,
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
        NEXT_PUBLIC_SERVER_URL: serverWorker.url.as<string>(),
      },
      dev: {
        command: "pnpm run dev:bare",
        url: "http://localhost:3001",
      },
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
    };
  }),
);
