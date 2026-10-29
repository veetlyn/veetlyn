import { buildInChild } from "@alchemy.run/frontend-frameworks/vinext/source";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { fileURLToPath, URL } from "node:url";

// Use the same Cloudflare compiler and cache plugin as Website.Vinext,
// without provisioning resources or loading deployment credentials.
const rootDir = fileURLToPath(new URL("../../../apps/web/", import.meta.url));
process.chdir(rootDir);
await Effect.runPromise(buildInChild({
  rootDir,
  main: "worker/index.ts",
  compatibilityDate: "2026-05-12",
  compatibilityFlags: ["nodejs_compat"],
  viteEnvironments: { entry: "rsc", children: ["ssr"] },
}).pipe(Effect.provide(NodeServices.layer)));
console.log("Cloudflare web release build passed");
