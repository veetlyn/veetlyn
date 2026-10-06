import { pingDatabase } from "@jendal-workspace/db/health";

import { publicProcedure, router } from "../index";
import { paypalRouter } from "./paypal";
import { servicesTeamRouter } from "./services-team";
import { storeRouter } from "./store";

export const appRouter = router({
  healthCheck: publicProcedure.query(async ({ ctx }) => {
    await pingDatabase(ctx.db);
    return "OK";
  }),
  paypal: paypalRouter,
  servicesTeam: servicesTeamRouter,
  store: storeRouter,
});
export type AppRouter = typeof appRouter;
