import { pingDatabase } from "@jendal-workspace/db/health";

import { publicProcedure, router } from "../index";
import { catalogRouter } from "./catalog";
import { paymentRouter } from "./payment";
import { payoutDestinationRouter } from "./payout-destination";
import { paypalRouter } from "./paypal";
import { projectRouter } from "./project";
import { servicesCatalogRouter } from "./services-catalog";
import { servicesTeamRouter } from "./services-team";
import { storeRouter } from "./store";

export const appRouter = router({
  healthCheck: publicProcedure.query(async ({ ctx }) => {
    await pingDatabase(ctx.db);
    return "OK";
  }),
  catalog: catalogRouter,
  payment: paymentRouter,
  payoutDestination: payoutDestinationRouter,
  paypal: paypalRouter,
  project: projectRouter,
  servicesCatalog: servicesCatalogRouter,
  servicesTeam: servicesTeamRouter,
  store: storeRouter,
});
export type AppRouter = typeof appRouter;
