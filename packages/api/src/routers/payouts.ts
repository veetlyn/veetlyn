import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { PayPalServices } from "../context";
import { protectedProcedure, router } from "../index";
import { requireAction, servicesTeamProcedure } from "../services-team-procedure";
import {
  completePayoutConnect,
  getPayoutCredentialsView,
  removeTeamPayoutCredentials,
  requirePayoutServices,
  startPayoutConnect,
} from "../use-cases/payout-credentials";
import {
  approvePayoutRequest,
  getMemberPayouts,
  listTeamPayouts,
  refreshPayout,
  rejectPayoutRequest,
  requestPayout,
  retryPayout,
} from "../use-cases/payouts";

const SETTINGS_ONLY = "Only an admin can change the team settings.";
const PAYOUTS_ONLY = "Only an admin can approve payouts.";

const requestIdInput = z.object({ requestId: z.string().trim().min(1).max(100) });

function requirePayPal(paypal: PayPalServices | undefined): PayPalServices {
  if (!paypal) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PayPal is not configured on this server." });
  return paypal;
}

export const payoutsRouter = router({
  // The client ID and secret are never returned.
  credentials: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    return getPayoutCredentialsView(ctx.db, ctx.servicesTeam.id);
  }),

  connectStart: servicesTeamProcedure.mutation(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    requirePayoutServices(ctx.payouts);
    return startPayoutConnect(
      { db: ctx.db, paypal: requirePayPal(ctx.paypal) },
      { team: ctx.servicesTeam, userId: ctx.session.user.id },
    );
  }),

  connectComplete: servicesTeamProcedure
    .input(
      z.object({
        attemptId: z.string().trim().min(1).max(100),
        authCode: z.string().trim().min(1).max(4000),
        sharedId: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
      return completePayoutConnect(
        { db: ctx.db, payouts: requirePayoutServices(ctx.payouts), paypal: requirePayPal(ctx.paypal) },
        { team: ctx.servicesTeam, attemptId: input.attemptId, authCode: input.authCode, sharedId: input.sharedId },
      );
    }),

  removeCredentials: servicesTeamProcedure.mutation(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    await removeTeamPayoutCredentials(ctx.db, ctx.servicesTeam.id);
    return { removed: true };
  }),

  // Any signed-in user may ask; the amount is checked against the caller's own earnings in the team.
  request: protectedProcedure
    .input(z.object({ teamSlug: z.string().trim().toLowerCase().min(1), amount: z.string().trim().min(1).max(32) }))
    .mutation(async ({ ctx, input }) =>
      requestPayout(ctx.db, { userId: ctx.session.user.id, teamSlug: input.teamSlug, amount: input.amount }),
    ),

  mine: protectedProcedure.query(async ({ ctx }) => getMemberPayouts(ctx.db, ctx.session.user.id)),

  list: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
    return listTeamPayouts(ctx.db, ctx.servicesTeam.id);
  }),

  reject: servicesTeamProcedure.input(requestIdInput).mutation(async ({ ctx, input }) => {
    requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
    return rejectPayoutRequest(ctx.db, {
      teamId: ctx.servicesTeam.id,
      requestId: input.requestId,
      deciderId: ctx.session.user.id,
    });
  }),

  approve: servicesTeamProcedure.input(requestIdInput).mutation(async ({ ctx, input }) => {
    requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
    const payouts = requirePayoutServices(ctx.payouts);
    return approvePayoutRequest(
      { db: ctx.db, payouts },
      { team: ctx.servicesTeam, requestId: input.requestId, deciderId: ctx.session.user.id },
    );
  }),

  retry: servicesTeamProcedure.input(requestIdInput).mutation(async ({ ctx, input }) => {
    requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
    const payouts = requirePayoutServices(ctx.payouts);
    return retryPayout({ db: ctx.db, payouts }, { team: ctx.servicesTeam, requestId: input.requestId });
  }),

  refresh: servicesTeamProcedure.input(requestIdInput).mutation(async ({ ctx, input }) => {
    requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
    const payouts = requirePayoutServices(ctx.payouts);
    return refreshPayout({ db: ctx.db, payouts }, { teamId: ctx.servicesTeam.id, requestId: input.requestId });
  }),
});
