import { presetRules } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { payoutRulesFormValues, payoutRulesInput, type PayoutRulesFormValues } from "./payout-rules-form";

const manual = payoutRulesFormValues({ ...presetRules("manual"), trustedMemberIds: [] });

describe("payoutRulesFormValues and payoutRulesInput", () => {
  it("turns the manual preset into a save with every optional rule off", () => {
    expect(payoutRulesInput(manual)).toEqual({
      input: {
        autoApproveUpTo: null,
        autoApproveScope: "requests",
        trustedScope: "requests",
        trustedMemberIds: [],
        secondApproverAbove: null,
        secondApproverScope: "both",
        payCompletedProjects: false,
        holdDays: 0,
        payday: "immediate",
        paydayWeekday: null,
        paydayMonthDay: null,
        balanceFloor: null,
        minimumPayout: "1.00",
      },
    });
  });

  it("shows the automatic preset's unlimited amount as any amount, and saves it back as any", () => {
    const values = payoutRulesFormValues({ ...presetRules("automatic"), trustedMemberIds: ["ada"] });
    expect(values).toMatchObject({ autoApprove: "any", autoApproveUpTo: "", trustedMemberIds: ["ada"] });
    expect(payoutRulesInput({ ...values, payday: "weekly", paydayWeekday: "5" })).toMatchObject({
      input: { autoApproveUpTo: "any", payCompletedProjects: true, paydayWeekday: 5, paydayMonthDay: null },
    });
  });

  it("keeps amounts as typed", () => {
    const values = payoutRulesFormValues({ ...presetRules("rules"), trustedMemberIds: [], balanceFloorMinor: 50_000 });
    expect(values).toMatchObject({ autoApprove: "up_to", autoApproveUpTo: "100.00", balanceFloor: "500.00" });
    expect(payoutRulesInput(values)).toMatchObject({ input: { autoApproveUpTo: "100.00", balanceFloor: "500.00" } });
  });

  it.each<[string, Partial<PayoutRulesFormValues>, string]>([
    ["an empty auto-approve amount", { autoApprove: "up_to", autoApproveUpTo: "" }, "Enter an amount like 25.00."],
    ["an amount with three decimals", { balanceFloor: "12.345" }, "Enter an amount like 25.00."],
    ["no minimum payout", { minimumPayout: " " }, "Enter an amount like 25.00."],
    ["hold days that are not a whole number", { holdDays: "2.5" }, "Hold payouts for 0 to 90 days."],
  ])("refuses %s", (_name, change, problem) => {
    expect(payoutRulesInput({ ...manual, ...change })).toEqual({ problem });
  });
});
