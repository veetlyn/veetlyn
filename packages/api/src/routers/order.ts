import { canServicesTeam } from "@jendal-workspace/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { downloadOrderFile, getOrderPage, listOrders, sendNewOrderLink } from "../use-cases/orders";

const tokenInput = z.object({ token: z.string().min(20).max(100) });

// Sellers design §5.2: the buyer's order page, reached by a grant token, and the seller admin's orders list.
export const orderRouter = router({
  get: publicProcedure.input(tokenInput).query(({ ctx, input }) => getOrderPage(ctx.db, input.token)),

  download: publicProcedure
    .input(tokenInput)
    .mutation(({ ctx, input }) => downloadOrderFile({ db: ctx.db, files: ctx.files }, input.token)),

  sendNewLink: publicProcedure
    .input(tokenInput)
    .mutation(({ ctx, input }) => sendNewOrderLink({ db: ctx.db, email: ctx.email }, input.token)),

  list: servicesTeamProcedure.query(({ ctx }) => {
    if (!canServicesTeam(ctx.servicesTeamRole, "manage_settings")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only an admin can see orders." });
    }
    return listOrders(ctx.db, ctx.servicesTeam.id);
  }),
});
