import { canServicesTeam } from "@jendal-workspace/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { downloadOrderFile, getOrderPage, listOrders, sendNewOrderLink } from "../use-cases/orders";

const linkInput = z.object({ token: z.string().min(20).max(100), slug: z.string().min(1).max(63) });

// Sellers design §5.2: the buyer's order page, reached by a grant token, and the seller admin's orders list.
export const orderRouter = router({
  get: publicProcedure.input(linkInput).query(({ ctx, input }) => getOrderPage(ctx.db, input)),

  download: publicProcedure
    .input(linkInput)
    .mutation(({ ctx, input }) => downloadOrderFile({ db: ctx.db, files: ctx.files }, input)),

  sendNewLink: publicProcedure
    .input(linkInput)
    .mutation(({ ctx, input }) => sendNewOrderLink({ db: ctx.db, email: ctx.email }, input)),

  list: servicesTeamProcedure.query(({ ctx }) => {
    if (!canServicesTeam(ctx.servicesTeamRole, "manage_settings")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only an admin can see orders." });
    }
    return listOrders(ctx.db, ctx.servicesTeam.id);
  }),
});
