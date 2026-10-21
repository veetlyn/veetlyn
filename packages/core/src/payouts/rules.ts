import { formatMoney, type MoneyCurrency } from "../money/money";
import { MIN_PAYOUT_MINOR } from "./requests";

export const PAYOUT_RULE_SCOPES = ["requests", "automatic", "both"] as const;
export type PayoutRuleScope = (typeof PAYOUT_RULE_SCOPES)[number];
export const PAYOUT_RULE_PRESETS = ["manual", "rules", "automatic", "custom"] as const;
export type PayoutRulePreset = (typeof PAYOUT_RULE_PRESETS)[number];
export const PAYDAYS = ["immediate", "weekly", "monthly"] as const;
export type Payday = (typeof PAYDAYS)[number];
export type PayoutSource = "member" | "project";

export type PayoutRules = {
  preset: PayoutRulePreset;
  autoApproveUpToMinor: number | null;
  autoApproveScope: PayoutRuleScope;
  trustedScope: PayoutRuleScope;
  trustedMemberIds: readonly string[];
  secondApproverAboveMinor: number | null;
  secondApproverScope: PayoutRuleScope;
  payCompletedProjects: boolean;
  holdDays: number;
  payday: Payday;
  paydayWeekday: number | null;
  paydayMonthDay: number | null;
  balanceFloorMinor: number | null;
  minimumPayoutMinor: number;
};

export type PayoutRuleSettings = Omit<PayoutRules, "trustedMemberIds">;

const OFF: PayoutRuleSettings = {
  preset: "manual",
  autoApproveUpToMinor: null,
  autoApproveScope: "requests",
  trustedScope: "requests",
  secondApproverAboveMinor: null,
  secondApproverScope: "both",
  payCompletedProjects: false,
  holdDays: 0,
  payday: "immediate",
  paydayWeekday: null,
  paydayMonthDay: null,
  balanceFloorMinor: null,
  minimumPayoutMinor: MIN_PAYOUT_MINOR,
};

// "Any amount" is stored as the largest safe integer, so the automatic preset auto-approves every automatic payout.
export const ANY_AMOUNT_MINOR = Number.MAX_SAFE_INTEGER;

export function presetRules(preset: Exclude<PayoutRulePreset, "custom">): PayoutRuleSettings {
  if (preset === "rules") return { ...OFF, preset, autoApproveUpToMinor: 10_000, autoApproveScope: "requests" };
  if (preset === "automatic") {
    return {
      ...OFF,
      preset,
      payCompletedProjects: true,
      autoApproveUpToMinor: ANY_AMOUNT_MINOR,
      autoApproveScope: "automatic",
    };
  }
  return OFF;
}

const DAY_MS = 86_400_000;
const RETRY_DELAYS_MS = [15 * 60_000, 3_600_000, 6 * 3_600_000] as const;

export function retryDelayMs(waitCount: number): number {
  return RETRY_DELAYS_MS[waitCount] ?? DAY_MS;
}

function applies(scope: PayoutRuleScope, source: PayoutSource): boolean {
  return scope === "both" || (scope === "requests" ? source === "member" : source === "project");
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Payday is a UTC calendar day; on the payday itself a payout goes at once.
export function nextPaydayAt(rules: PayoutRuleSettings, now: Date): Date {
  const today = startOfUtcDay(now);
  if (rules.payday === "weekly" && rules.paydayWeekday !== null) {
    const ahead = (rules.paydayWeekday - today.getUTCDay() + 7) % 7;
    return ahead === 0 ? now : new Date(today.getTime() + ahead * DAY_MS);
  }
  if (rules.payday === "monthly" && rules.paydayMonthDay !== null) {
    const day = rules.paydayMonthDay;
    if (today.getUTCDate() === day) return now;
    const month = today.getUTCDate() < day ? today.getUTCMonth() : today.getUTCMonth() + 1;
    return new Date(Date.UTC(today.getUTCFullYear(), month, day));
  }
  return now;
}

export type PayoutFacts = {
  amountMinor: number;
  source: PayoutSource;
  memberId: string;
  approverIds: readonly string[];
  balanceMinor: number | null;
  now: Date;
};

export type PayoutDecision =
  | { kind: "refused"; reason: string }
  | { kind: "needs_approval"; approvalsNeeded: number }
  | { kind: "approved"; sendAfter: Date };

export function decidePayout(rules: PayoutRules, facts: PayoutFacts, currency: MoneyCurrency = "USD"): PayoutDecision {
  if (facts.amountMinor < rules.minimumPayoutMinor) {
    const minimum = formatMoney({ currency, minor: rules.minimumPayoutMinor });
    return { kind: "refused", reason: `Payouts start at ${minimum} for this team.` };
  }
  const required =
    rules.secondApproverAboveMinor !== null &&
    applies(rules.secondApproverScope, facts.source) &&
    facts.amountMinor > rules.secondApproverAboveMinor
      ? 2
      : 1;
  const approvals = new Set(facts.approverIds.filter((id) => id !== facts.memberId)).size;
  const floorAllows =
    rules.balanceFloorMinor === null ||
    (facts.balanceMinor !== null && facts.balanceMinor - facts.amountMinor >= rules.balanceFloorMinor);
  const autoApproved =
    required === 1 &&
    floorAllows &&
    ((rules.autoApproveUpToMinor !== null &&
      applies(rules.autoApproveScope, facts.source) &&
      facts.amountMinor <= rules.autoApproveUpToMinor) ||
      (applies(rules.trustedScope, facts.source) && rules.trustedMemberIds.includes(facts.memberId)));
  if (!autoApproved && approvals < required) return { kind: "needs_approval", approvalsNeeded: required - approvals };
  return { kind: "approved", sendAfter: nextPaydayAt(rules, facts.now) };
}

// Checked before every send, after approval.
export function balanceHold(
  rules: PayoutRuleSettings,
  input: { amountMinor: number; balanceMinor: number | null; currency: MoneyCurrency },
): string | null {
  if (input.balanceMinor === null) {
    return rules.balanceFloorMinor === null
      ? null
      : "Turn on automatic payouts again so we can read your PayPal balance.";
  }
  if (input.balanceMinor < input.amountMinor) return "The team's PayPal balance is too low. Add funds, then retry.";
  if (rules.balanceFloorMinor !== null && input.balanceMinor - input.amountMinor < rules.balanceFloorMinor) {
    const floor = formatMoney({ currency: input.currency, minor: rules.balanceFloorMinor });
    return `Waiting until the team's PayPal balance stays above ${floor}.`;
  }
  return null;
}

export function payoutRulesProblem(
  rules: PayoutRules,
  context: { adminCount: number; currency: MoneyCurrency },
): string | null {
  if (rules.minimumPayoutMinor < MIN_PAYOUT_MINOR) {
    return `The minimum payout is at least ${formatMoney({ currency: context.currency, minor: MIN_PAYOUT_MINOR })}.`;
  }
  if (!Number.isInteger(rules.holdDays) || rules.holdDays < 0 || rules.holdDays > 90) return "Hold payouts for 0 to 90 days.";
  if (rules.payday === "weekly" && (rules.paydayWeekday === null || rules.paydayWeekday < 0 || rules.paydayWeekday > 6)) {
    return "Choose the payday.";
  }
  if (rules.payday === "monthly") {
    if (rules.paydayMonthDay === null) return "Choose the payday.";
    if (rules.paydayMonthDay < 1 || rules.paydayMonthDay > 28) return "Choose a payday from the 1st to the 28th.";
  }
  if (rules.secondApproverAboveMinor !== null) {
    if (context.adminCount < 2) return "Add a second admin before requiring two approvals.";
    const overlaps = (["member", "project"] as const).some(
      (source) => applies(rules.autoApproveScope, source) && applies(rules.secondApproverScope, source),
    );
    if (overlaps && rules.autoApproveUpToMinor !== null && rules.autoApproveUpToMinor > rules.secondApproverAboveMinor) {
      return "Auto-approve at most the second-approver amount.";
    }
  }
  if (rules.balanceFloorMinor !== null && rules.balanceFloorMinor < 0) return "The balance floor cannot be negative.";
  return null;
}
