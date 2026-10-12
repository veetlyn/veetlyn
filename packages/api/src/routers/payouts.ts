import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { requireAction, servicesTeamProcedure } from "../services-team-procedure";
import {
  getMemberPayouts,
  listTeamPayouts,
  markPayoutPaid,
  rejectPayoutRequest,
  requestPayout,
} from "../use-cases/payouts";

const PAYOUTS_ONLY = "Only an admin can approve payouts.";

const requestIdInput = z.object({ requestId: z.string().trim().min(1).max(100) });

export const payoutsRouter = router({
  // Any signed-in user may ask; the amount is checked against the caller's own earnings in the team.
  request: protectedProcedure
    .input(z.object({ teamSlug: z.string().trim().toLowerCase().min(1), amount: z.string().trim().min(1).max(32) }))
    .mutation(async ({ ctx, input }) =>
      requestPayout(ctx.db, { userId: ctx.session.user.id, teamSlug: input.teamSlug, amount: input.amount }),
    ),

  mine: protectedProcedure.query(async ({ ctx }) => getMemberPayouts(ctx.db, ctx.session.user.id)),

  list: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
    return listTeamPayouts(ctx.db, { teamId: ctx.servicesTeam.id, environment: ctx.environment });
  }),

  reject: servicesTeamProcedure.input(requestIdInput).mutation(async ({ ctx, input }) => {
    requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
    return rejectPayoutRequest(ctx.db, {
      teamId: ctx.servicesTeam.id,
      requestId: input.requestId,
      deciderId: ctx.session.user.id,
    });
  }),

  // An empty field in the form means "not given".
  markPaid: servicesTeamProcedure
    .input(
      requestIdInput.extend({
        received: z.string().trim().max(32).optional(),
        paypalTransactionId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9]{1,40}$/, "Enter the transaction ID as PayPal shows it, letters and digits only.")
          .or(z.literal(""))
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
      return markPayoutPaid(ctx.db, {
        teamId: ctx.servicesTeam.id,
        requestId: input.requestId,
        deciderId: ctx.session.user.id,
        received: input.received || null,
        paypalTransactionId: input.paypalTransactionId || null,
      });
    }),
});
