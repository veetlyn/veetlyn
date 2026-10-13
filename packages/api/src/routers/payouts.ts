import { ANY_AMOUNT_MINOR, PAYDAYS, parseMajorAmount, PAYOUT_RULE_SCOPES } from "@jendal-workspace/core";
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
import { applyPayoutRulesPreset, getTeamPayoutRules, saveTeamPayoutRules } from "../use-cases/payout-rules";
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

const amountInput = z.string().trim().min(1).max(32);
const scopeInput = z.enum(PAYOUT_RULE_SCOPES);

function minorOf(amount: string): number {
  const minor = parseMajorAmount(amount);
  if (minor === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an amount like 25.00." });
  return minor;
}

const minorOrNull = (amount: string | null) => (amount === null ? null : minorOf(amount));

// Amounts are major-unit strings in the team's currency ("25.00"); null turns the rule off. "any" auto-approves
// every amount.
const rulesInput = z.object({
  autoApproveUpTo: z.union([z.literal("any"), amountInput]).nullable(),
  autoApproveScope: scopeInput,
  trustedScope: scopeInput,
  trustedMemberIds: z.array(z.string().trim().min(1).max(100)).max(100),
  secondApproverAbove: amountInput.nullable(),
  secondApproverScope: scopeInput,
  payCompletedProjects: z.boolean(),
  holdDays: z.number().int(),
  payday: z.enum(PAYDAYS),
  paydayWeekday: z.number().int().nullable(),
  paydayMonthDay: z.number().int().nullable(),
  balanceFloor: amountInput.nullable(),
  minimumPayout: amountInput,
});

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
        {
          team: ctx.servicesTeam,
          userId: ctx.session.user.id,
          attemptId: input.attemptId,
          authCode: input.authCode,
          sharedId: input.sharedId,
        },
      );
    }),

  removeCredentials: servicesTeamProcedure.mutation(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    await removeTeamPayoutCredentials(ctx.db, ctx.servicesTeam.id);
    return { removed: true };
  }),

  rules: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    return getTeamPayoutRules(ctx.db, ctx.servicesTeam);
  }),

  saveRules: servicesTeamProcedure.input(rulesInput).mutation(async ({ ctx, input }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    return saveTeamPayoutRules(ctx.db, {
      team: ctx.servicesTeam,
      userId: ctx.session.user.id,
      rules: {
        autoApproveUpToMinor: input.autoApproveUpTo === "any" ? ANY_AMOUNT_MINOR : minorOrNull(input.autoApproveUpTo),
        autoApproveScope: input.autoApproveScope,
        trustedScope: input.trustedScope,
        trustedMemberIds: input.trustedMemberIds,
        secondApproverAboveMinor: minorOrNull(input.secondApproverAbove),
        secondApproverScope: input.secondApproverScope,
        payCompletedProjects: input.payCompletedProjects,
        holdDays: input.holdDays,
        payday: input.payday,
        paydayWeekday: input.paydayWeekday,
        paydayMonthDay: input.paydayMonthDay,
        balanceFloorMinor: minorOrNull(input.balanceFloor),
        minimumPayoutMinor: minorOf(input.minimumPayout),
      },
    });
  }),

  applyRulesPreset: servicesTeamProcedure
    .input(z.object({ preset: z.enum(["manual", "rules", "automatic"]) }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
      return applyPayoutRulesPreset(ctx.db, { team: ctx.servicesTeam, preset: input.preset });
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
