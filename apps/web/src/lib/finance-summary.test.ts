import { describe, expect, it } from "vitest";

import { type FinancePayment, type FinancePayout, financeSummary } from "./finance-summary";

const basePayment: FinancePayment = { status: "captured", amountMinor: 10_000, paypalFeeMinor: 400, refundedMinor: 0, currency: "USD" };
const basePayout: FinancePayout = { status: "succeeded", amountMinor: 5_000, sentMinor: 4_900, currency: "USD" };
const payment = (over: Partial<FinancePayment>): FinancePayment => ({ ...basePayment, ...over });
const payout = (over: Partial<FinancePayout>): FinancePayout => ({ ...basePayout, ...over });

describe("financeSummary", () => {
  it("reconciles money in: received minus PayPal fees and refunds", () => {
    const [usd] = financeSummary(
      [payment({}), payment({ amountMinor: 20_000, paypalFeeMinor: 700, refundedMinor: 3_000 }), payment({ status: "pending", amountMinor: 9_000, paypalFeeMinor: null })],
      [],
      [],
    );
    expect(usd).toMatchObject({ currency: "USD", receivedMinor: 30_000, feesMinor: 1_100, refundedMinor: 3_000, netMinor: 25_900, pendingInMinor: 9_000, feesUnreported: 0 });
  });

  it("counts captured payments whose fee PayPal has not reported, instead of guessing it", () => {
    const [usd] = financeSummary([payment({ paypalFeeMinor: null })], [], []);
    expect(usd).toMatchObject({ feesMinor: 0, feesUnreported: 1 });
  });

  it("counts only succeeded payouts as paid out, by the amount sent", () => {
    const [usd] = financeSummary(
      [],
      [payout({}), payout({ status: "requested", amountMinor: 2_000, sentMinor: null }), payout({ status: "sending", amountMinor: 1_000, sentMinor: 980 }), payout({ status: "failed", sentMinor: null })],
      [],
    );
    expect(usd).toMatchObject({ paidOutMinor: 4_900, inFlightMinor: 1_000, awaitingApprovalMinor: 2_000, awaitingApprovalCount: 1 });
  });

  it("keeps currencies apart and counts open disputes per currency", () => {
    const summary = financeSummary(
      [payment({}), payment({ currency: "EUR", amountMinor: 5_000, paypalFeeMinor: 200 })],
      [],
      [{ open: true, amountMinor: 1_500, currency: "EUR" }, { open: false, amountMinor: 900, currency: "EUR" }],
    );
    expect(summary.map((s) => s.currency)).toEqual(["USD", "EUR"]);
    expect(summary[1]).toMatchObject({ receivedMinor: 5_000, openDisputes: 1, disputedMinor: 1_500 });
  });
});
