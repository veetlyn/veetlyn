/// <reference types="@cloudflare/workers-types" />
// For Cloudflare Workers, env is accessed via cloudflare:workers module
// Types are defined in ../cloudflare-env.d.ts (part of this tsconfig's default include) from the alchemy.run.ts bindings
export { env as ENV } from "cloudflare:workers";
