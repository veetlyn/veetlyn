import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { requireAction, servicesTeamProcedure } from "../services-team-procedure";
import {
  getPayoutCredentialsView,
  removeTeamPayoutCredentials,
  requirePayoutServices,
  saveTeamPayoutCredentialsChecked,
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

export const payoutsRouter = router({
  // The secret is never returned; the admin recognises the app by the end of its client ID.
  credentials: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    return getPayoutCredentialsView(ctx.db, ctx.servicesTeam.id);
  }),

  saveCredentials: servicesTeamProcedure
    .input(z.object({ clientId: z.string().trim().min(1).max(500), clientSecret: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
      const payouts = requirePayoutServices(ctx.payouts);
      return saveTeamPayoutCredentialsChecked(
        { db: ctx.db, payouts },
        { team: ctx.servicesTeam, clientId: input.clientId, clientSecret: input.clientSecret },
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
