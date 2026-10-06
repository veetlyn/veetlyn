import type { WebEnv } from "@jendal-workspace/infra/alchemy.run";
import { initWorkersLogger, withEvlog } from "evlog/workers";
import handler from "vinext/server/fetch-handler";

import { shouldForwardToApi } from "../src/lib/host-routing";

initWorkersLogger({ env: { service: "jendal-web" } });

export default withEvlog<WebEnv>(async (request, env, ctx, log) => {
  // The original request keeps its host, so the api resolves the same store and cookies stay first-party.
  if (shouldForwardToApi(new URL(request.url))) {
    log.set({ forwardedTo: "api" });
    return env.SERVER.fetch(request);
  }
  return handler.fetch(request, env, ctx);
});
