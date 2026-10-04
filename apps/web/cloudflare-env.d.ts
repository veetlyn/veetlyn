import type { WebEnv } from "@jendal-workspace/infra/alchemy.run";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    export interface Env extends WebEnv {}
  }
}
