import { pingDatabase } from "@jendal-workspace/db/health";

import { publicProcedure, router } from "../index";
import { catalogRouter } from "./catalog";
import { checkoutRouter } from "./checkout";
import { connectedAppsRouter } from "./connected-apps";
import { orderRouter } from "./order";
import { paymentRouter } from "./payment";
import { payoutDestinationRouter } from "./payout-destination";
import { payoutsRouter } from "./payouts";
import { paypalRouter } from "./paypal";
import { projectRouter } from "./project";
import { rulesRouter } from "./rules";
import { sellerRouter } from "./seller";
import { servicesCatalogRouter } from "./services-catalog";
import { servicesTeamRouter } from "./services-team";
import { storeRouter } from "./store";

export const appRouter = router({
  healthCheck: publicProcedure.query(async ({ ctx }) => {
    await pingDatabase(ctx.db);
    return "OK";
  }),
  catalog: catalogRouter,
  checkout: checkoutRouter,
  connectedApps: connectedAppsRouter,
  order: orderRouter,
  payment: paymentRouter,
  payoutDestination: payoutDestinationRouter,
  payouts: payoutsRouter,
  paypal: paypalRouter,
  project: projectRouter,
  rules: rulesRouter,
  seller: sellerRouter,
  servicesCatalog: servicesCatalogRouter,
  servicesTeam: servicesTeamRouter,
  store: storeRouter,
});
export type AppRouter = typeof appRouter;
