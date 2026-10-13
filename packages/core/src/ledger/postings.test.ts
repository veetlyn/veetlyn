import { describe, expect, it } from "vitest";

import { randomInt, seededRandom } from "../testing/random";
import {
  chargebackTransfer,
  completionTransfer,
  managementFeeCreditTransfer,
  orderFeesTransfer,
  orderPaidTransfer,
  orderRefundedTransfer,
  paymentCapturedTransfer,
  paymentFeesTransfer,
  paymentRefundedTransfer,
  payoutFeeRecoveredTransfer,
  payoutFeesTransfer,
  payoutReleasedTransfer,
  payoutRequestedTransfer,
  payoutSucceededTransfer,
  penaltyAfterCompletionTransfer,
  refundConfirmedTransfer,
  refundFeesTransfer,
  refundRequestedTransfer,
  splitServicesRefund,
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
    expect(payoutSucceededTransfer({ ...payout, sentMinor: 72_250 }).entries).toEqual([
      { account: "owed:f1:reserved", currency: "USD", amountMinor: -72_250 },
      { account: "paid_out:f1", currency: "USD", amountMinor: 72_250 },
    ]);
    expect(payoutReleasedTransfer({ ...payout, amountMinor: 72_250 }).entries).toEqual([
      { account: "owed:f1:reserved", currency: "USD", amountMinor: -72_250 },
      { account: "owed:f1:available", currency: "USD", amountMinor: 72_250 },
    ]);
  });

  it("charges a payout's PayPal fee to the team, or posts nothing for a zero fee", () => {
    expect(payoutFeesTransfer({ currency: "USD", payoutRequestId: "po1", feeMinor: 25 })).toEqual({
      kind: "payout_fees",
      reference: "payout_fees:po1",
      projectId: null,
      entries: [
        { account: "team_revenue", currency: "USD", amountMinor: -25 },
        { account: "paypal_fees", currency: "USD", amountMinor: 25 },
      ],
    });
    expect(payoutFeesTransfer({ currency: "USD", payoutRequestId: "po1", feeMinor: 0 })).toBeNull();
  });

  it("recovers the member's share of a payout fee from their reserved earnings, or posts nothing for zero", () => {
    expect(payoutFeeRecoveredTransfer({ ...payout, amountMinor: 25 })).toEqual({
      kind: "payout_fee_recovered",
      reference: "payout_fee_recovered:po1",
      projectId: null,
      entries: [
        { account: "owed:f1:reserved", currency: "USD", amountMinor: -25 },
        { account: "team_revenue", currency: "USD", amountMinor: 25 },
      ],
    });
    expect(payoutFeeRecoveredTransfer({ ...payout, amountMinor: 0 })).toBeNull();
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
  const currency = (): "USD" | "EUR" => (random() < 0.5 ? "USD" : "EUR");

  const builders = {
    paymentCaptured: () =>
      paymentCapturedTransfer({ currency: currency(), projectId: "p1", paymentId: "x", quotePartMinor: amount(), managementFeeMinor: maybeZero() }),
    managementFeeCredit: () =>
      managementFeeCreditTransfer({ currency: currency(), projectId: "p1", amendmentId: "x", creditMinor: amount() }),
    completion: () =>
      completionTransfer({ currency: currency(), projectId: "p1", freelancerId: "f1", finalPriceMinor: amount(), teamCutBps: bps() }),
    refundRequested: () =>
      refundRequestedTransfer({ currency: currency(), projectId: "p1", refundId: "x", quotePartMinor: amount(), managementFeeMinor: maybeZero() }),
    refundConfirmed: () => refundConfirmedTransfer({ currency: currency(), projectId: "p1", refundId: "x", amountMinor: amount() }),
    paymentRefunded: () =>
      paymentRefundedTransfer({
        currency: currency(),
        projectId: "p1",
        refundKey: "refund:x",
        fromClientHeldMinor: maybeZero(),
        fromTeamRevenueMinor: amount(),
      }),
    payoutRequested: () => payoutRequestedTransfer({ ...payout, currency: currency(), amountMinor: amount() }),
    payoutSucceeded: () => payoutSucceededTransfer({ ...payout, currency: currency(), sentMinor: amount() }),
    payoutReleased: () => payoutReleasedTransfer({ ...payout, currency: currency(), amountMinor: amount() }),
    payoutFees: () => {
      const transfer = payoutFeesTransfer({ currency: currency(), payoutRequestId: "po1", feeMinor: amount() });
      if (!transfer) throw new Error("A non-zero payout fee has a transfer.");
      return transfer;
    },
    payoutFeeRecovered: () => {
      const transfer = payoutFeeRecoveredTransfer({ ...payout, currency: currency(), amountMinor: amount() });
      if (!transfer) throw new Error("A non-zero recovered fee has a transfer.");
      return transfer;
    },
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
  } satisfies Record<string, () => LedgerTransferDraft>;

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

describe("paymentFeesTransfer", () => {
  it("charges PayPal's fee and Payleor's fee to the team's revenue", () => {
    expect(
      paymentFeesTransfer({ currency: "USD", projectId: "p1", paymentId: "pay1", paypalFeeMinor: 498, platformFeeMinor: 120 }),
    ).toEqual({
      kind: "payment_fees",
      reference: "payment_fees:pay1",
      projectId: "p1",
      entries: [
        { account: "team_revenue", currency: "USD", amountMinor: -618 },
        { account: "paypal_fees", currency: "USD", amountMinor: 498 },
        { account: "payleor_fees", currency: "USD", amountMinor: 120 },
      ],
    });
  });

  it("leaves out a fee of zero, and returns null when there is no fee at all", () => {
    expect(
      paymentFeesTransfer({ currency: "USD", projectId: "p1", paymentId: "pay1", paypalFeeMinor: 498, platformFeeMinor: 0 })?.entries,
    ).toEqual([
      { account: "team_revenue", currency: "USD", amountMinor: -498 },
      { account: "paypal_fees", currency: "USD", amountMinor: 498 },
    ]);
    expect(paymentFeesTransfer({ currency: "USD", projectId: "p1", paymentId: "pay1", paypalFeeMinor: 0, platformFeeMinor: 0 })).toBeNull();
  });
});

describe("order postings", () => {
  it("books a paid order as team revenue", () => {
    const t = orderPaidTransfer({ currency: "USD", orderId: "o1", amountMinor: 1900 });
    expect(t).toMatchObject({ kind: "order_paid", reference: "order_paid:o1", projectId: null });
    expect(t.entries).toEqual(
      expect.arrayContaining([
        { account: "paypal_clearing", currency: "USD", amountMinor: -1900 },
        { account: "team_revenue", currency: "USD", amountMinor: 1900 },
      ]),
    );
  });
  it("books the fees out of team revenue, or nothing when both are zero", () => {
    const t = orderFeesTransfer({ currency: "USD", orderId: "o1", paypalFeeMinor: 115, platformFeeMinor: 19 });
    expect(t?.reference).toBe("order_fees:o1");
    expect(t?.entries).toEqual(
      expect.arrayContaining([
        { account: "team_revenue", currency: "USD", amountMinor: -134 },
        { account: "paypal_fees", currency: "USD", amountMinor: 115 },
        { account: "payleor_fees", currency: "USD", amountMinor: 19 },
      ]),
    );
    expect(orderFeesTransfer({ currency: "USD", orderId: "o1", paypalFeeMinor: 0, platformFeeMinor: 0 })).toBeNull();
  });
  it("books a refund back to PayPal, keyed by the refund", () => {
    const t = orderRefundedTransfer({ currency: "USD", orderId: "o1", refundKey: "refund:R1", amountMinor: 500 });
    expect(t).toMatchObject({ kind: "order_refunded", reference: "order_refunded:refund:R1", projectId: null });
    expect(t.entries).toEqual(
      expect.arrayContaining([
        { account: "team_revenue", currency: "USD", amountMinor: -500 },
        { account: "paypal_clearing", currency: "USD", amountMinor: 500 },
      ]),
    );
  });
});

describe("refund postings", () => {
  const cases = [
    {
      name: "returned fees go back to team revenue (the sandbox's $5.00 refund)",
      transfer: refundFeesTransfer({ currency: "USD", projectId: null, refundId: "R1", paypalFeeMinor: 19, platformFeeMinor: 5 }),
      expected: {
        kind: "refund_fees",
        reference: "refund_fees:R1",
        projectId: null,
        entries: [
          { account: "paypal_fees", currency: "USD", amountMinor: -19 },
          { account: "team_revenue", currency: "USD", amountMinor: 24 },
          { account: "payleor_fees", currency: "USD", amountMinor: -5 },
        ],
      },
    },
    {
      name: "a platform fee PayPal kept is left out",
      transfer: refundFeesTransfer({ currency: "USD", projectId: "p1", refundId: "R2", paypalFeeMinor: 19, platformFeeMinor: 0 }),
      expected: {
        kind: "refund_fees",
        reference: "refund_fees:R2",
        projectId: "p1",
        entries: [
          { account: "paypal_fees", currency: "USD", amountMinor: -19 },
          { account: "team_revenue", currency: "USD", amountMinor: 19 },
        ],
      },
    },
    {
      name: "no fee returned posts nothing",
      transfer: refundFeesTransfer({ currency: "USD", projectId: null, refundId: "R3", paypalFeeMinor: 0, platformFeeMinor: 0 }),
      expected: null,
    },
    {
      name: "moves the client-money part from client_held and the rest from team revenue to PayPal clearing",
      transfer: paymentRefundedTransfer({ ...base, refundKey: "refund:R4", fromClientHeldMinor: 300, fromTeamRevenueMinor: 200 }),
      expected: {
        kind: "payment_refunded",
        reference: "payment_refunded:refund:R4",
        projectId: "p1",
        entries: [
          { account: "client_held:p1", currency: "USD", amountMinor: -300 },
          { account: "paypal_clearing", currency: "USD", amountMinor: 500 },
          { account: "team_revenue", currency: "USD", amountMinor: -200 },
        ],
      },
    },
    {
      name: "moves a refund taken wholly from team revenue to PayPal clearing",
      transfer: paymentRefundedTransfer({ ...base, refundKey: "reversal:C1", fromClientHeldMinor: 0, fromTeamRevenueMinor: 500 }),
      expected: {
        kind: "payment_refunded",
        reference: "payment_refunded:reversal:C1",
        projectId: "p1",
        entries: [
          { account: "paypal_clearing", currency: "USD", amountMinor: 500 },
          { account: "team_revenue", currency: "USD", amountMinor: -500 },
        ],
      },
    },
  ];
  it.each(cases)("$name", ({ transfer, expected }) => {
    expect(transfer).toEqual(expected);
  });
});

describe("splitServicesRefund", () => {
  it.each([
    { name: "client money covers it all", amountMinor: 500, clientHeldMinor: 800, expected: { fromClientHeldMinor: 500, fromTeamRevenueMinor: 0 } },
    { name: "client money covers part", amountMinor: 500, clientHeldMinor: 300, expected: { fromClientHeldMinor: 300, fromTeamRevenueMinor: 200 } },
    { name: "no client money left", amountMinor: 500, clientHeldMinor: 0, expected: { fromClientHeldMinor: 0, fromTeamRevenueMinor: 500 } },
  ])("$name", ({ amountMinor, clientHeldMinor, expected }) => {
    expect(splitServicesRefund({ amountMinor, clientHeldMinor })).toEqual(expected);
  });
});
