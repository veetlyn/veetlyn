import { domainRedirect } from "../src/lib/domain-redirect";
import { releaseDescriptor } from "@jendal-workspace/core/release";
import type { WebEnv } from "@jendal-workspace/infra/alchemy.run";
import { initWorkersLogger, withEvlog } from "evlog/workers";
import handler from "vinext/server/fetch-handler";

import { shouldForwardToApi } from "../src/lib/host-routing";

initWorkersLogger({ env: { service: "jendal-web" } });

export default withEvlog<WebEnv>(async (request, env, ctx, log) => {
  if (new URL(request.url).pathname === "/.well-known/release") return Response.json(releaseDescriptor("web", env), { headers: { "Cache-Control": "no-store" } });
  const redirect = domainRedirect(request, { platformDomain: env.PLATFORM_DOMAIN, storeDomain: env.STORE_DOMAIN });
  if (redirect) return redirect;
  // The original request keeps its host, so the api resolves the same store and cookies stay first-party.
  if (shouldForwardToApi(new URL(request.url))) {
    log.set({ forwardedTo: "api" });
    return env.SERVER.fetch(request);
  }
  return handler.fetch(request, env, ctx);
});
