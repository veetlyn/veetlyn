import { describe, expect, it } from "vitest";

import {
  balanceHold,
  decidePayout,
  nextPaydayAt,
  payoutRulesProblem,
  presetRules,
  retryDelayMs,
  type PayoutRules,
} from "./rules";

const base: PayoutRules = { ...presetRules("manual"), trustedMemberIds: [] };
const now = new Date("2026-10-14T10:00:00Z"); // a Wednesday
const facts = { amountMinor: 5_000, source: "member" as const, memberId: "ada", approverIds: [], balanceMinor: null, now };

describe("decidePayout", () => {
  it.each([
    ["manual: one admin", base, facts, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["below the team minimum", { ...base, minimumPayoutMinor: 10_000 }, facts, { kind: "refused", reason: "Payouts start at $100.00 for this team." }],
    ["auto-approve up to the amount", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "requests" }, facts, { kind: "approved", sendAfter: now }],
    ["auto-approve scope excludes project payouts", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "requests" }, { ...facts, source: "project" }, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["trusted member", { ...base, trustedMemberIds: ["ada"], trustedScope: "both" }, facts, { kind: "approved", sendAfter: now }],
    ["second approver wins over auto-approve", { ...base, autoApproveUpToMinor: 10_000, autoApproveScope: "both", secondApproverAboveMinor: 4_000, secondApproverScope: "both" }, facts, { kind: "needs_approval", approvalsNeeded: 2 }],
    ["one of two approvals", { ...base, secondApproverAboveMinor: 4_000, secondApproverScope: "requests" }, { ...facts, approverIds: ["bea"] }, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["the member's own approval does not count", { ...base, secondApproverAboveMinor: 4_000, secondApproverScope: "requests" }, { ...facts, approverIds: ["ada", "bea"] }, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["two distinct admins", { ...base, secondApproverAboveMinor: 4_000, secondApproverScope: "requests" }, { ...facts, approverIds: ["bea", "cy"] }, { kind: "approved", sendAfter: now }],
    ["floor blocks auto-approval", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "both", balanceFloorMinor: 50_000 }, { ...facts, balanceMinor: 54_000 }, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["floor allows auto-approval", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "both", balanceFloorMinor: 50_000 }, { ...facts, balanceMinor: 55_000 }, { kind: "approved", sendAfter: now }],
    ["unreadable balance blocks auto-approval under a floor", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "both", balanceFloorMinor: 1 }, facts, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["approved waits for the weekly payday", { ...base, payday: "weekly", paydayWeekday: 5 }, { ...facts, approverIds: ["bea"] }, { kind: "approved", sendAfter: new Date("2026-10-16T00:00:00Z") }],
  ] as const)("%s", (_name, rules, input, expected) => {
    expect(decidePayout(rules, input)).toEqual(expected);
  });
});

describe("nextPaydayAt", () => {
  it.each([
    ["immediate", { payday: "immediate" }, now],
    ["weekly, today", { payday: "weekly", paydayWeekday: 3 }, now],
    ["weekly, later this week", { payday: "weekly", paydayWeekday: 5 }, new Date("2026-10-16T00:00:00Z")],
    ["weekly, next week", { payday: "weekly", paydayWeekday: 1 }, new Date("2026-10-19T00:00:00Z")],
    ["monthly, today", { payday: "monthly", paydayMonthDay: 14 }, now],
    ["monthly, later this month", { payday: "monthly", paydayMonthDay: 28 }, new Date("2026-10-28T00:00:00Z")],
    ["monthly, next month", { payday: "monthly", paydayMonthDay: 1 }, new Date("2026-11-01T00:00:00Z")],
  ] as const)("%s", (_name, rules, expected) => {
    expect(nextPaydayAt({ ...base, ...rules }, now)).toEqual(expected);
  });
});

describe("retryDelayMs", () => {
  it.each([
    [0, 15 * 60_000],
    [1, 3_600_000],
    [2, 6 * 3_600_000],
    [3, 24 * 3_600_000],
    [9, 24 * 3_600_000],
  ])("after %i waits", (count, ms) => {
    expect(retryDelayMs(count)).toBe(ms);
  });
});

describe("balanceHold", () => {
  it.each([
    ["no floor, enough", { ...base }, 10_000, 20_000, null],
    ["no floor, too low", { ...base }, 30_000, 20_000, "The team's PayPal balance is too low. Add funds, then retry."],
    ["under the floor", { ...base, balanceFloorMinor: 15_000 }, 10_000, 20_000, "Waiting until the team's PayPal balance stays above $150.00."],
    ["floor, unreadable", { ...base, balanceFloorMinor: 15_000 }, 10_000, null, "Turn on automatic payouts again so we can read your PayPal balance."],
    ["no floor, unreadable", { ...base }, 10_000, null, null],
  ] as const)("%s", (_name, rules, amount, balance, expected) => {
    expect(balanceHold(rules, { amountMinor: amount, balanceMinor: balance, currency: "USD" })).toBe(expected);
  });
});

describe("payoutRulesProblem", () => {
  it.each([
    ["presets are valid", presetRules("automatic"), 1, null],
    ["minimum under PayPal's", { ...base, minimumPayoutMinor: 99 }, 1, "The minimum payout is at least $1.00."],
    ["auto-approve above the second approver amount", { ...base, autoApproveUpToMinor: 10_000, autoApproveScope: "both", secondApproverAboveMinor: 5_000, secondApproverScope: "requests" }, 2, "Auto-approve at most the second-approver amount."],
    ["second approver with one admin", { ...base, secondApproverAboveMinor: 5_000 }, 1, "Add a second admin before requiring two approvals."],
    ["hold days out of range", { ...base, holdDays: 91 }, 1, "Hold payouts for 0 to 90 days."],
    ["weekly without a weekday", { ...base, payday: "weekly", paydayWeekday: null }, 1, "Choose the payday."],
    ["monthly day 29", { ...base, payday: "monthly", paydayMonthDay: 29 }, 1, "Choose a payday from the 1st to the 28th."],
  ] as const)("%s", (_name, rules, adminCount, expected) => {
    expect(payoutRulesProblem({ ...base, ...rules, trustedMemberIds: [] }, { adminCount, currency: "USD" })).toBe(expected);
  });
});
