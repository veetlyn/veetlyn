import { presetRules } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { payoutRulesFormValues, payoutRulesInput } from "@/lib/payout-rules-form";

import { inputRules, rulesSummary, unattendedExpansions } from "./rules-summary";

const noTrusted: string[] = [];
const manual = { ...presetRules("manual"), trustedMemberIds: noTrusted };
const context = { currency: "USD", sending: "automatic" as const, nameOf: (id: string) => ({ ada: "Ada" })[id] };

describe("rulesSummary", () => {
  it("says an admin approves everything on the manual preset", () => {
    const summary = rulesSummary(payoutRulesFormValues(manual), context);
    expect(summary.approval).toEqual(["An admin approves every payout."]);
    expect(summary.automatic[0]).toMatch(/don't pay out on their own/);
    expect(summary.sending).toEqual(["Approved payouts are sent right away."]);
    expect(summary.limits).toEqual(["Payouts start at $1.00."]);
  });

  it("names trusted members, the auto-approve limit and the second admin separately", () => {
    const values = {
      ...payoutRulesFormValues({ ...presetRules("rules"), trustedMemberIds: ["ada"] }),
      secondApproverAbove: "500",
    };
    const { approval } = rulesSummary(values, context);
    expect(approval).toContain("Member requests up to $100.00 are approved without an admin.");
    expect(approval).toContain("Member requests for Ada are approved without an admin.");
    expect(approval.some((line) => line.includes("above $500.00 need two admins"))).toBe(true);
  });

  it("says approved payouts wait for an export when automatic payouts are off", () => {
    const summary = rulesSummary(payoutRulesFormValues(manual), { ...context, sending: "export" });
    expect(summary.sending[0]).toMatch(/wait until an admin exports them/);
  });

  it("describes a weekly payday and the hold for completed projects", () => {
    const values = { ...payoutRulesFormValues(manual), payday: "weekly" as const, paydayWeekday: "1" };
    const auto = { ...payoutRulesFormValues({ ...presetRules("automatic"), trustedMemberIds: [] }), holdDays: "3" };
    expect(rulesSummary(values, context).sending[0]).toBe("Approved payouts are sent every Monday at 00:00 UTC.");
    expect(rulesSummary(auto, context).automatic[0]).toMatch(/3 days after it completes/);
  });
});

describe("unattendedExpansions", () => {
  const next = (change: Partial<ReturnType<typeof payoutRulesFormValues>>) => {
    const result = payoutRulesInput({ ...payoutRulesFormValues(manual), ...change });
    if ("problem" in result) throw new Error(result.problem);
    return inputRules(result.input);
  };

  it("finds nothing when no more money can move without an admin", () => {
    expect(unattendedExpansions(manual, next({}), "USD")).toEqual([]);
    expect(unattendedExpansions(manual, next({ minimumPayout: "20.00" }), "USD")).toEqual([]);
  });

  it("flags auto-approve, new trusted members and paying completed projects", () => {
    const changes = unattendedExpansions(
      manual,
      next({ autoApprove: "up_to", autoApproveUpTo: "50", trustedMemberIds: ["ada"], payCompletedProjects: true }),
      "USD",
    );
    expect(changes).toEqual([
      "Auto-approve turns on, up to $50.00.",
      "1 member becomes trusted.",
      "Completed projects start paying out on their own, from now on.",
    ]);
  });

  it("flags removing the second admin or the balance floor", () => {
    const saved = { ...manual, secondApproverAboveMinor: 50_000, balanceFloorMinor: 10_000 };
    expect(unattendedExpansions(saved, next({}), "USD")).toEqual([
      "A second admin is no longer required.",
      "The PayPal balance floor is removed.",
    ]);
  });
});
