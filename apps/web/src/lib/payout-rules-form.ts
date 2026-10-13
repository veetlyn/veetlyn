import { ANY_AMOUNT_MINOR, type Payday, type PayoutRuleScope, type PayoutRules } from "@jendal-workspace/core";

import { minorToPriceInput, parsePriceInput } from "./money";

export type AutoApproveMode = "off" | "up_to" | "any";

// What the rules form edits: amounts and days as typed, an empty optional amount meaning the rule is off.
export type PayoutRulesFormValues = {
  autoApprove: AutoApproveMode;
  autoApproveUpTo: string;
  autoApproveScope: PayoutRuleScope;
  trustedScope: PayoutRuleScope;
  trustedMemberIds: string[];
  secondApproverAbove: string;
  secondApproverScope: PayoutRuleScope;
  payCompletedProjects: boolean;
  holdDays: string;
  payday: Payday;
  paydayWeekday: string;
  paydayMonthDay: string;
  balanceFloor: string;
  minimumPayout: string;
};

// The saveRules input without the team slug.
export type PayoutRulesInput = {
  autoApproveUpTo: string | null;
  autoApproveScope: PayoutRuleScope;
  trustedScope: PayoutRuleScope;
  trustedMemberIds: string[];
  secondApproverAbove: string | null;
  secondApproverScope: PayoutRuleScope;
  payCompletedProjects: boolean;
  holdDays: number;
  payday: Payday;
  paydayWeekday: number | null;
  paydayMonthDay: number | null;
  balanceFloor: string | null;
  minimumPayout: string;
};

const AMOUNT_PROBLEM = "Enter an amount like 25.00.";

const amountText = (minor: number | null) => (minor === null ? "" : minorToPriceInput(minor));

export function payoutRulesFormValues(rules: Omit<PayoutRules, "preset">): PayoutRulesFormValues {
  const any = rules.autoApproveUpToMinor === ANY_AMOUNT_MINOR;
  return {
    autoApprove: rules.autoApproveUpToMinor === null ? "off" : any ? "any" : "up_to",
    autoApproveUpTo: any ? "" : amountText(rules.autoApproveUpToMinor),
    autoApproveScope: rules.autoApproveScope,
    trustedScope: rules.trustedScope,
    trustedMemberIds: [...rules.trustedMemberIds],
    secondApproverAbove: amountText(rules.secondApproverAboveMinor),
    secondApproverScope: rules.secondApproverScope,
    payCompletedProjects: rules.payCompletedProjects,
    holdDays: String(rules.holdDays),
    payday: rules.payday,
    paydayWeekday: String(rules.paydayWeekday ?? 1),
    paydayMonthDay: String(rules.paydayMonthDay ?? 1),
    balanceFloor: amountText(rules.balanceFloorMinor),
    minimumPayout: minorToPriceInput(rules.minimumPayoutMinor),
  };
}

function amountOrNull(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return parsePriceInput(trimmed) === null ? undefined : trimmed;
}

// Only the shape is checked here; the server applies the rules' own limits and gives their messages.
export function payoutRulesInput(values: PayoutRulesFormValues): { input: PayoutRulesInput } | { problem: string } {
  const autoApproveUpTo =
    values.autoApprove === "off" ? null : values.autoApprove === "any" ? "any" : amountOrNull(values.autoApproveUpTo);
  const secondApproverAbove = amountOrNull(values.secondApproverAbove);
  const balanceFloor = amountOrNull(values.balanceFloor);
  const minimumPayout = amountOrNull(values.minimumPayout);
  if (
    autoApproveUpTo === undefined ||
    (values.autoApprove === "up_to" && autoApproveUpTo === null) ||
    secondApproverAbove === undefined ||
    balanceFloor === undefined ||
    !minimumPayout
  ) {
    return { problem: AMOUNT_PROBLEM };
  }
  const holdDays = Number(values.holdDays.trim());
  if (values.holdDays.trim() === "" || !Number.isInteger(holdDays)) return { problem: "Hold payouts for 0 to 90 days." };
  return {
    input: {
      autoApproveUpTo,
      autoApproveScope: values.autoApproveScope,
      trustedScope: values.trustedScope,
      trustedMemberIds: values.trustedMemberIds,
      secondApproverAbove,
      secondApproverScope: values.secondApproverScope,
      payCompletedProjects: values.payCompletedProjects,
      holdDays,
      payday: values.payday,
      paydayWeekday: values.payday === "weekly" ? Number(values.paydayWeekday) : null,
      paydayMonthDay: values.payday === "monthly" ? Number(values.paydayMonthDay) : null,
      balanceFloor,
      minimumPayout,
    },
  };
}
