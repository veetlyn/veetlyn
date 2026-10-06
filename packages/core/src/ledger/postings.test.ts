import { describe, expect, it } from "vitest";

import { randomInt, seededRandom } from "../testing/random";
import {
  chargebackTransfer,
  completionTransfer,
  managementFeeCreditTransfer,
  paymentCapturedTransfer,
  payoutReleasedTransfer,
  payoutRequestedTransfer,
  payoutSucceededTransfer,
  penaltyAfterCompletionTransfer,
  refundConfirmedTransfer,
  refundRequestedTransfer,
} from "./postings";
import { isBalanced, type LedgerTransferDraft, transferSums } from "./transfers";

const base = { currency: "USD", projectId: "p1" } as const;
const payout = { currency: "USD", payoutRequestId: "po1", freelancerId: "f1" } as const;

describe("services spec §6.3 postings for the §5.3 example", () => {
  it("posts the $600 deposit to client money and team revenue", () => {
    expect(paymentCapturedTransfer({ ...base, paymentId: "pay1", quotePartMinor: 50_000, managementFeeMinor: 10_000 })).toEqual({
      kind: "payment_captured",
      reference: "payment_captured:pay1",
      projectId: "p1",
      entries: [
        { account: "paypal_clearing", currency: "USD", amountMinor: -60_000 },
        { account: "client_held:p1", currency: "USD", amountMinor: 50_000 },
        { account: "team_revenue", currency: "USD", amountMinor: 10_000 },
      ],
    });
  });

  it("splits the $850 final price into the team cut and the freelancer's earnings", () => {
    expect(completionTransfer({ ...base, freelancerId: "f1", finalPriceMinor: 85_000, teamCutBps: 1_500 }).entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -85_000 },
      { account: "team_revenue", currency: "USD", amountMinor: 12_750 },
      { account: "owed:f1:available", currency: "USD", amountMinor: 72_250 },
    ]);
  });

  it("moves the $30 fee credit of a decrease back to client money (§5.5)", () => {
    expect(managementFeeCreditTransfer({ ...base, amendmentId: "am1", creditMinor: 3_000 })).toEqual({
      kind: "management_fee_credit",
      reference: "management_fee_credit:am1",
      projectId: "p1",
      entries: [
        { account: "team_revenue", currency: "USD", amountMinor: -3_000 },
        { account: "client_held:p1", currency: "USD", amountMinor: 3_000 },
      ],
    });
  });

  it("refunds in two steps: requested, then confirmed by PayPal", () => {
    expect(refundRequestedTransfer({ ...base, refundId: "r1", quotePartMinor: 10_000, managementFeeMinor: 1_000 }).entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -10_000 },
      { account: "client_refunds", currency: "USD", amountMinor: 11_000 },
      { account: "team_revenue", currency: "USD", amountMinor: -1_000 },
    ]);
    expect(refundConfirmedTransfer({ ...base, refundId: "r1", amountMinor: 11_000 }).entries).toEqual([
      { account: "client_refunds", currency: "USD", amountMinor: -11_000 },
      { account: "paypal_clearing", currency: "USD", amountMinor: 11_000 },
    ]);
  });

  it("reserves, pays out and releases earnings", () => {
    expect(payoutRequestedTransfer({ ...payout, amountMinor: 72_250 }).entries).toEqual([
      { account: "owed:f1:available", currency: "USD", amountMinor: -72_250 },
      { account: "owed:f1:reserved", currency: "USD", amountMinor: 72_250 },
    ]);
    expect(payoutSucceededTransfer({ ...payout, amountMinor: 72_250 }).entries).toEqual([
      { account: "owed:f1:reserved", currency: "USD", amountMinor: -72_250 },
      { account: "paid_out:f1", currency: "USD", amountMinor: 72_250 },
    ]);
    expect(payoutReleasedTransfer({ ...payout, amountMinor: 72_250 }).entries).toEqual([
      { account: "owed:f1:reserved", currency: "USD", amountMinor: -72_250 },
      { account: "owed:f1:available", currency: "USD", amountMinor: 72_250 },
    ]);
  });

  it("moves a penalty after completion to the team or to client refunds", () => {
    const penalty = { ...base, caseId: "c1", freelancerId: "f1", amountMinor: 5_000 };
    expect(penaltyAfterCompletionTransfer({ ...penalty, destination: "team_revenue" }).entries).toEqual([
      { account: "owed:f1:available", currency: "USD", amountMinor: -5_000 },
      { account: "team_revenue", currency: "USD", amountMinor: 5_000 },
    ]);
    expect(penaltyAfterCompletionTransfer({ ...penalty, destination: "client_refunds" }).entries).toEqual([
      { account: "owed:f1:available", currency: "USD", amountMinor: -5_000 },
      { account: "client_refunds", currency: "USD", amountMinor: 5_000 },
    ]);
  });

  it("reverses a capture on a chargeback, or charges the team after completion", () => {
    const chargeback = { ...base, chargebackId: "cb1", quotePartMinor: 50_000, managementFeeMinor: 10_000 };
    expect(chargebackTransfer({ ...chargeback, projectCompleted: false }).entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -50_000 },
      { account: "paypal_clearing", currency: "USD", amountMinor: 60_000 },
      { account: "team_revenue", currency: "USD", amountMinor: -10_000 },
    ]);
    expect(chargebackTransfer({ ...chargeback, projectCompleted: true }).entries).toEqual([
      { account: "team_revenue", currency: "USD", amountMinor: -60_000 },
      { account: "paypal_clearing", currency: "USD", amountMinor: 60_000 },
    ]);
  });
});

describe("every posting builder balances (property-style, 500 random cases each)", () => {
  const random = seededRandom(20261006);
  const amount = () => randomInt(random, 1, 100_000_000);
  const maybeZero = () => (random() < 0.2 ? 0 : amount());
  const bps = () => randomInt(random, 0, 10_000);
  const currency = () => (random() < 0.5 ? "USD" : "EUR") as "USD" | "EUR";

  const builders: Record<string, () => LedgerTransferDraft> = {
    paymentCaptured: () =>
      paymentCapturedTransfer({ currency: currency(), projectId: "p1", paymentId: "x", quotePartMinor: amount(), managementFeeMinor: maybeZero() }),
    managementFeeCredit: () =>
      managementFeeCreditTransfer({ currency: currency(), projectId: "p1", amendmentId: "x", creditMinor: amount() }),
    completion: () =>
      completionTransfer({ currency: currency(), projectId: "p1", freelancerId: "f1", finalPriceMinor: amount(), teamCutBps: bps() }),
    refundRequested: () =>
      refundRequestedTransfer({ currency: currency(), projectId: "p1", refundId: "x", quotePartMinor: amount(), managementFeeMinor: maybeZero() }),
    refundConfirmed: () => refundConfirmedTransfer({ currency: currency(), projectId: "p1", refundId: "x", amountMinor: amount() }),
    payoutRequested: () => payoutRequestedTransfer({ ...payout, currency: currency(), amountMinor: amount() }),
    payoutSucceeded: () => payoutSucceededTransfer({ ...payout, currency: currency(), amountMinor: amount() }),
    payoutReleased: () => payoutReleasedTransfer({ ...payout, currency: currency(), amountMinor: amount() }),
    penaltyAfterCompletion: () =>
      penaltyAfterCompletionTransfer({
        currency: currency(),
        projectId: "p1",
        caseId: "x",
        freelancerId: "f1",
        amountMinor: amount(),
        destination: random() < 0.5 ? "team_revenue" : "client_refunds",
      }),
    chargeback: () =>
      chargebackTransfer({
        currency: currency(),
        projectId: "p1",
        chargebackId: "x",
        quotePartMinor: amount(),
        managementFeeMinor: maybeZero(),
        projectCompleted: random() < 0.5,
      }),
  };

  for (const [name, build] of Object.entries(builders)) {
    it(name, () => {
      for (let i = 0; i < 500; i++) {
        const transfer = build();
        expect(isBalanced(transfer)).toBe(true);
        for (const sum of transferSums(transfer).values()) expect(sum).toBe(0);
      }
    });
  }

  it("completion keeps team cut + earnings equal to the final price", () => {
    for (let i = 0; i < 500; i++) {
      const finalPriceMinor = amount();
      const transfer = completionTransfer({ ...base, freelancerId: "f1", finalPriceMinor, teamCutBps: bps() });
      expect(transfer.entries.find((e) => e.account === "client_held:p1")?.amountMinor).toBe(-finalPriceMinor);
    }
  });
});
