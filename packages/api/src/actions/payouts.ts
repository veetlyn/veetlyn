import {
  ANY_AMOUNT_MINOR,
  canServicesTeam,
  PAYDAYS,
  parseMajorAmount,
  PAYOUT_RULE_SCOPES,
  PAYOUTS_WEB_MAX_ROWS,
  type ServicesTeamAction,
  type ServicesTeamRecord,
} from "@jendal-workspace/core";
import { findServicesTeamById } from "@jendal-workspace/db/repositories/services-teams";
import { z } from "zod";

import type { PayPalServices } from "../context";
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
import { cancelPayoutsWebExport, exportPayoutsWeb, importPayoutsWeb } from "../use-cases/payouts-web";
import type { Actor } from "./actors";
import { defineAction } from "./define";
import { ActionError } from "./errors";
import type { ActionDeps, Scope } from "./perform";
import { teamActorOf } from "./team-actor";

const SETTINGS_ONLY = "Only an admin can change the team settings.";
const PAYOUTS_ONLY = "Only an admin can approve payouts.";

const requestIdInput = z.object({ requestId: z.string().trim().min(1).max(100) });
// A log of PayPal's 5000-payout maximum stays well under this.
const MAX_PAYOUTS_WEB_LOG_CHARS = 2_000_000;

const amountInput = z.string().trim().min(1).max(32);
const scopeInput = z.enum(PAYOUT_RULE_SCOPES);
// Keeps rule amounts inside their columns: the minimum payout is an integer column.
const MAX_RULE_AMOUNT_MINOR = 100_000_000;

function minorOf(amount: string): number {
  const minor = parseMajorAmount(amount);
  if (minor === null) throw new ActionError("invalid", "Enter an amount like 25.00.");
  if (minor > MAX_RULE_AMOUNT_MINOR) throw new ActionError("invalid", "Enter an amount up to 1,000,000.00.");
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

type TeamContext = { deps: ActionDeps; actor: Actor; scope: Scope };

// The role decides; the team row is loaded only for a caller allowed to act on it.
async function teamFor(
  context: TeamContext,
  action: ServicesTeamAction,
  refusal: string,
): Promise<{ team: ServicesTeamRecord; userId: string }> {
  const actor = teamActorOf(context);
  if (!canServicesTeam(actor.role, action)) throw new ActionError("forbidden", refusal);
  const team = await findServicesTeamById(context.deps.db, actor.teamId);
  if (!team) throw new ActionError("not_found", "Team not found.");
  return { team, userId: actor.actorId };
}

function requirePayPal(paypal: PayPalServices | undefined): PayPalServices {
  if (!paypal) throw new ActionError("precondition_failed", "PayPal is not configured on this server.");
  return paypal;
}

function userIdOf(actor: Actor): string {
  if (actor.kind !== "user") throw new ActionError("internal", "A signed-in action ran without a user.");
  return actor.userId;
}

const member = [{ grant: "member" }] as const;
const signedIn = [{ grant: "signed_in" }] as const;
const teamScope = () => ({});

export const payoutCredentialsGet = defineAction({
  name: "payout.credentials.get",
  kind: "query",
  summary: "Show whether automatic payouts are connected for the team and to which PayPal account; never the secret.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  run: async (context) => {
    const { team } = await teamFor(context, "manage_settings", SETTINGS_ONLY);
    return getPayoutCredentialsView(context.deps.db, team.id);
  },
});

export const payoutConnectStart = defineAction({
  name: "payout.connect.start",
  kind: "action",
  summary: "Start connecting the team's PayPal account for automatic payouts; an admin finishes it in PayPal.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "never",
  run: async (context) => {
    const { team, userId } = await teamFor(context, "manage_settings", SETTINGS_ONLY);
    requirePayoutServices(context.deps.payouts);
    return startPayoutConnect({ db: context.deps.db, paypal: requirePayPal(context.deps.paypal) }, { team, userId });
  },
});

export const payoutConnectComplete = defineAction({
  name: "payout.connect.complete",
  kind: "action",
  summary: "Finish connecting the team's PayPal account for automatic payouts with the code PayPal returned.",
  input: z.object({
    attemptId: z.string().trim().min(1).max(100),
    authCode: z.string().trim().min(1).max(4000),
    sharedId: z.string().trim().min(1).max(500),
  }),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "never",
  run: async (context, input) => {
    const { team, userId } = await teamFor(context, "manage_settings", SETTINGS_ONLY);
    return completePayoutConnect(
      {
        db: context.deps.db,
        payouts: requirePayoutServices(context.deps.payouts),
        paypal: requirePayPal(context.deps.paypal),
      },
      { team, userId, attemptId: input.attemptId, authCode: input.authCode, sharedId: input.sharedId },
    );
  },
});

export const payoutCredentialsRemove = defineAction({
  name: "payout.credentials.remove",
  kind: "action",
  summary: "Disconnect automatic payouts from the team's PayPal account; approved payouts then wait for export.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "never",
  run: async (context) => {
    const { team } = await teamFor(context, "manage_settings", SETTINGS_ONLY);
    await removeTeamPayoutCredentials(context.deps.db, team.id);
    return { removed: true };
  },
});

export const payoutRulesGet = defineAction({
  name: "payout.rules.get",
  kind: "query",
  summary: "Show the team's payout rules: auto-approval, second approver, hold days, payday, floor and minimum.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  run: async (context) => {
    const { team } = await teamFor(context, "manage_settings", SETTINGS_ONLY);
    return getTeamPayoutRules(context.deps.db, team);
  },
});

export const payoutRulesSave = defineAction({
  name: "payout.rules.save",
  kind: "action",
  summary: "Save the team's payout rules; amounts are in the team's currency and null turns a rule off.",
  input: rulesInput,
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "confirm",
  run: async (context, input) => {
    const { team, userId } = await teamFor(context, "manage_settings", SETTINGS_ONLY);
    return saveTeamPayoutRules(context.deps.db, {
      team,
      userId,
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
  },
});

export const payoutRulesPreset = defineAction({
  name: "payout.rules.preset",
  kind: "action",
  summary: "Replace the team's payout rules with a preset: manual approval, rules, or automatic payouts.",
  input: z.object({ preset: z.enum(["manual", "rules", "automatic"]) }),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "confirm",
  run: async (context, input) => {
    const { team } = await teamFor(context, "manage_settings", SETTINGS_ONLY);
    return applyPayoutRulesPreset(context.deps.db, { team, preset: input.preset });
  },
});

// Any signed-in user may ask; the amount is checked against the caller's own earnings in the team.
export const payoutRequest = defineAction({
  name: "payout.request",
  kind: "action",
  summary: "Ask a team to pay out part of the caller's own released earnings in that team.",
  input: z.object({ teamSlug: z.string().trim().toLowerCase().min(1), amount: z.string().trim().min(1).max(32) }),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: signedIn,
  agent: "confirm",
  run: (context, input) =>
    requestPayout(
      { db: context.deps.db, payouts: context.deps.payouts, now: context.deps.now },
      { userId: userIdOf(context.actor), teamSlug: input.teamSlug, amount: input.amount },
    ),
});

export const payoutMine = defineAction({
  name: "payout.mine",
  kind: "query",
  summary: "List the caller's own earnings and payouts across every team they work in.",
  // Callers pass no input at all.
  input: z.object({}).default({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: signedIn,
  run: (context) => getMemberPayouts(context.deps.db, userIdOf(context.actor)),
});

export const payoutList = defineAction({
  name: "payout.list",
  kind: "query",
  summary: "List the team's payout requests with their state, the rules that decided them and the team balance.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  run: async (context) => {
    const { team } = await teamFor(context, "approve_payouts", PAYOUTS_ONLY);
    return listTeamPayouts({ db: context.deps.db, now: context.deps.now }, team);
  },
});

export const payoutReject = defineAction({
  name: "payout.reject",
  kind: "action",
  summary: "Reject a member's payout request; nothing is sent and the earnings stay with the member.",
  input: requestIdInput,
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "confirm",
  run: async (context, input) => {
    const { team, userId } = await teamFor(context, "approve_payouts", PAYOUTS_ONLY);
    return rejectPayoutRequest(context.deps.db, { teamId: team.id, requestId: input.requestId, deciderId: userId });
  },
});

export const payoutApprove = defineAction({
  name: "payout.approve",
  kind: "action",
  summary: "Approve a member's payout request; it is sent through PayPal once every approval it needs is in.",
  input: requestIdInput,
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "confirm",
  run: async (context, input) => {
    const { team, userId } = await teamFor(context, "approve_payouts", PAYOUTS_ONLY);
    return approvePayoutRequest(
      { db: context.deps.db, payouts: requirePayoutServices(context.deps.payouts), now: context.deps.now },
      { team, requestId: input.requestId, deciderId: userId },
    );
  },
});

export const payoutRetry = defineAction({
  name: "payout.retry",
  kind: "action",
  summary: "Send an approved payout again after PayPal failed or held it.",
  input: requestIdInput,
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "confirm",
  run: async (context, input) => {
    const { team } = await teamFor(context, "approve_payouts", PAYOUTS_ONLY);
    return retryPayout(
      { db: context.deps.db, payouts: requirePayoutServices(context.deps.payouts), now: context.deps.now },
      { team, requestId: input.requestId },
    );
  },
});

export const payoutRefresh = defineAction({
  name: "payout.refresh",
  kind: "action",
  summary: "Ask PayPal for a sent payout's latest status and record it.",
  input: requestIdInput,
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  run: async (context, input) => {
    const { team } = await teamFor(context, "approve_payouts", PAYOUTS_ONLY);
    return refreshPayout(
      { db: context.deps.db, payouts: requirePayoutServices(context.deps.payouts) },
      { teamId: team.id, requestId: input.requestId },
    );
  },
});

export const payoutWebExport = defineAction({
  name: "payout.web.export",
  kind: "action",
  summary: "Export approved payouts as a Payouts Web file for an admin to upload to PayPal.",
  input: z.object({
    requestIds: z.array(z.string().trim().min(1).max(100)).min(1).max(PAYOUTS_WEB_MAX_ROWS),
  }),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "confirm",
  run: async (context, input) => {
    const { team } = await teamFor(context, "approve_payouts", PAYOUTS_ONLY);
    return exportPayoutsWeb(
      { db: context.deps.db, platformName: context.deps.platformName, now: context.deps.now },
      { team, requestIds: input.requestIds },
    );
  },
});

// The text of the payout's CSV log downloaded from PayPal.
export const payoutWebImport = defineAction({
  name: "payout.web.import",
  kind: "action",
  summary: "Record the results of a Payouts Web upload from the CSV log PayPal returned.",
  input: z.object({ csv: z.string().min(1).max(MAX_PAYOUTS_WEB_LOG_CHARS) }),
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "never",
  run: async (context, input) => {
    const { team } = await teamFor(context, "approve_payouts", PAYOUTS_ONLY);
    return importPayoutsWeb(context.deps.db, { teamId: team.id, csv: input.csv });
  },
});

export const payoutWebCancel = defineAction({
  name: "payout.web.cancel",
  kind: "action",
  summary: "Take an exported payout back out of its Payouts Web file before it was uploaded.",
  input: requestIdInput,
  output: null,
  surfaces: ["web"],
  scope: teamScope,
  allow: member,
  agent: "confirm",
  run: async (context, input) => {
    const { team } = await teamFor(context, "approve_payouts", PAYOUTS_ONLY);
    return cancelPayoutsWebExport(context.deps.db, { teamId: team.id, requestId: input.requestId });
  },
});

export const PAYOUT_ACTIONS = [
  payoutCredentialsGet,
  payoutConnectStart,
  payoutConnectComplete,
  payoutCredentialsRemove,
  payoutRulesGet,
  payoutRulesSave,
  payoutRulesPreset,
  payoutRequest,
  payoutMine,
  payoutList,
  payoutReject,
  payoutApprove,
  payoutRetry,
  payoutRefresh,
  payoutWebExport,
  payoutWebImport,
  payoutWebCancel,
];
