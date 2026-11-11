import { ANY_AMOUNT_MINOR, type PayoutRules, type PayoutRuleScope } from "@jendal-workspace/core";

import { formatMinor, parsePriceInput } from "@/lib/money";
import type { PayoutRulesFormValues, PayoutRulesInput } from "@/lib/payout-rules-form";

// Plain-language consequences of the rules form, so an admin can predict who approves, what is sent, when and within
// which limits before saving. Mirrors decidePayout/balanceHold in core; it never decides anything itself.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SCOPE_TEXT = {
  requests: "member requests",
  automatic: "automatic project payouts",
  both: "member requests and automatic project payouts",
} satisfies Record<PayoutRuleScope, string>;

// How approved payouts leave the team: sent by the platform only when automatic payouts (PayPal credentials) are on.
export type SendingMode = "automatic" | "export" | "unknown";

export type RulesSummary = {
  approval: string[];
  automatic: string[];
  sending: string[];
  limits: string[];
};

function amount(text: string, currency: string): string | null {
  const minor = parsePriceInput(text);
  return minor === null ? null : formatMinor(minor, currency);
}

function names(ids: readonly string[], nameOf: (id: string) => string | undefined): string {
  const list = ids.map((id) => nameOf(id) ?? "a former member");
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

export function rulesSummary(
  values: PayoutRulesFormValues,
  context: {
    currency: string;
    sending: SendingMode;
    nameOf: (id: string) => string | undefined;
  },
): RulesSummary {
  const { currency } = context;
  const approval: string[] = [];
  const autoUpTo = values.autoApprove === "up_to" ? amount(values.autoApproveUpTo, currency) : null;
  const trusted = values.trustedMemberIds;
  const secondAbove = values.secondApproverAbove.trim() === "" ? null : amount(values.secondApproverAbove, currency);
  const floor = values.balanceFloor.trim() === "" ? null : amount(values.balanceFloor, currency);

  if (values.autoApprove === "off" && trusted.length === 0) {
    approval.push("An admin approves every payout.");
  } else {
    if (values.autoApprove === "any") {
      approval.push(`All ${SCOPE_TEXT[values.autoApproveScope]} are approved without an admin, at any amount.`);
    } else if (values.autoApprove === "up_to") {
      approval.push(
        `${capitalize(SCOPE_TEXT[values.autoApproveScope])} up to ${autoUpTo ?? "the amount you enter"} are approved without an admin.`,
      );
    }
    if (trusted.length > 0) {
      approval.push(
        `${capitalize(SCOPE_TEXT[values.trustedScope])} for ${names(trusted, context.nameOf)} are approved without an admin.`,
      );
    }
    approval.push("Everything else waits for an admin.");
  }
  if (values.secondApproverAbove.trim() !== "") {
    approval.push(
      `${capitalize(SCOPE_TEXT[values.secondApproverScope])} above ${secondAbove ?? "the amount you enter"} need two admins, even when a rule above would approve them. Payouts to the same member over 7 days count together.`,
    );
  }
  if (floor !== null && (values.autoApprove !== "off" || trusted.length > 0)) {
    approval.push(`Nothing is approved without an admin while it would leave the PayPal balance below ${floor}.`);
  }

  const automatic: string[] = [];
  if (values.payCompletedProjects) {
    const days = Number(values.holdDays.trim());
    const wait =
      values.holdDays.trim() === "" || !Number.isInteger(days)
        ? "after the wait you set"
        : days === 0
          ? "as soon as it completes"
          : `${days} ${days === 1 ? "day" : "days"} after it completes`;
    automatic.push(`Each completed project pays out its members' earnings ${wait}, through the approval rules above.`);
  } else {
    automatic.push("Completed projects don't pay out on their own. Members request their earnings.");
  }

  const sending: string[] = [];
  if (context.sending === "export") {
    sending.push("Automatic payouts are off, so approved payouts wait until an admin exports them for PayPal.");
  } else {
    const when =
      values.payday === "weekly"
        ? `every ${WEEKDAYS[Number(values.paydayWeekday)] ?? "week"} at 00:00 UTC`
        : values.payday === "monthly"
          ? `on day ${values.paydayMonthDay} of each month at 00:00 UTC`
          : "right away";
    sending.push(`Approved payouts are sent ${when}.`);
  }
  if (floor !== null) sending.push(`A payout isn't sent while it would leave the PayPal balance below ${floor}.`);

  const minimum = amount(values.minimumPayout, currency);
  const limits = [minimum ? `Payouts start at ${minimum}.` : "Enter a minimum payout."];

  return { approval, automatic, sending, limits };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const covers = (scope: PayoutRuleScope) =>
  new Set<"member" | "project">(
    scope === "both" ? ["member", "project"] : scope === "requests" ? ["member"] : ["project"],
  );

const widens = (before: PayoutRuleScope, after: PayoutRuleScope) =>
  [...covers(after)].some((source) => !covers(before).has(source));

type SavedRules = Omit<PayoutRules, "preset">;

// The saveRules input as rules in minor units, the way the server stores it ("any" is the largest safe amount).
export function inputRules(input: PayoutRulesInput): SavedRules {
  const minor = (text: string | null) => (text === null ? null : parsePriceInput(text));
  return {
    ...input,
    autoApproveUpToMinor: input.autoApproveUpTo === "any" ? ANY_AMOUNT_MINOR : minor(input.autoApproveUpTo),
    secondApproverAboveMinor: minor(input.secondApproverAbove),
    balanceFloorMinor: minor(input.balanceFloor),
    minimumPayoutMinor: parsePriceInput(input.minimumPayout) ?? 0,
  };
}

// Each change that lets more money be approved or sent without an admin, compared to the saved rules.
// Saving these asks for confirmation first.
export function unattendedExpansions(saved: SavedRules, next: SavedRules, currency: string): string[] {
  const changes: string[] = [];
  const money = (minor: number) => (minor === ANY_AMOUNT_MINOR ? "any amount" : formatMinor(minor, currency));

  if (next.autoApproveUpToMinor !== null) {
    if (saved.autoApproveUpToMinor === null) {
      changes.push(`Auto-approve turns on, up to ${money(next.autoApproveUpToMinor)}.`);
    } else if (next.autoApproveUpToMinor > saved.autoApproveUpToMinor) {
      changes.push(`Auto-approve rises to ${money(next.autoApproveUpToMinor)}.`);
    } else if (widens(saved.autoApproveScope, next.autoApproveScope)) {
      changes.push(`Auto-approve now covers ${SCOPE_TEXT[next.autoApproveScope]}.`);
    }
  }
  const added = next.trustedMemberIds.filter((id) => !saved.trustedMemberIds.includes(id));
  if (added.length > 0) {
    changes.push(`${added.length} ${added.length === 1 ? "member becomes" : "members become"} trusted.`);
  } else if (next.trustedMemberIds.length > 0 && widens(saved.trustedScope, next.trustedScope)) {
    changes.push(`Trusted members now cover ${SCOPE_TEXT[next.trustedScope]}.`);
  }
  if (saved.secondApproverAboveMinor !== null) {
    if (next.secondApproverAboveMinor === null) changes.push("A second admin is no longer required.");
    else if (next.secondApproverAboveMinor > saved.secondApproverAboveMinor) {
      changes.push(`A second admin is needed only above ${money(next.secondApproverAboveMinor)}.`);
    }
  }
  if (next.payCompletedProjects && !saved.payCompletedProjects) {
    changes.push("Completed projects start paying out on their own, from now on.");
  } else if (next.payCompletedProjects && next.holdDays < saved.holdDays) {
    changes.push(`Completed projects pay out after ${next.holdDays} days instead of ${saved.holdDays}.`);
  }
  if (saved.balanceFloorMinor !== null) {
    if (next.balanceFloorMinor === null) changes.push("The PayPal balance floor is removed.");
    else if (next.balanceFloorMinor < saved.balanceFloorMinor) {
      changes.push(`The PayPal balance floor drops to ${money(next.balanceFloorMinor)}.`);
    }
  }
  return changes;
}
