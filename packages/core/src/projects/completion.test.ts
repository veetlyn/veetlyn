import { describe, expect, it } from "vitest";

import { completionPostings, completionRefundId } from "./completion";
import { balanceDue } from "./pricing";

const base = { currency: "USD", projectId: "p1", freelancerId: "f1", teamCutBps: 1_500 } as const;

const paidInFull = balanceDue({
  quoteMinor: 100_000,
  managementFeeBps: 1_000,
  finalPriceMinor: 100_000,
  paidQuoteMinor: 100_000,
  paidManagementFeeMinor: 10_000,
  managementFeeCreditedMinor: 0,
});

describe("completionPostings", () => {
  it("splits the final price into the team cut and the freelancer's earnings (§5.3: $1,000 → $150 and $850)", () => {
    const { transfers, refundMinor } = completionPostings({ ...base, finalPriceMinor: 100_000, balance: paidInFull });
    expect(refundMinor).toBe(0);
    expect(transfers.map((t) => t.reference)).toEqual(["completion:p1"]);
    expect(transfers[0]?.entries).toEqual(
      expect.arrayContaining([
        { account: "client_held:p1", currency: "USD", amountMinor: -100_000 },
        { account: "team_revenue", currency: "USD", amountMinor: 15_000 },
        { account: "owed:f1:available", currency: "USD", amountMinor: 85_000 },
      ]),
    );
  });

  it("gives the whole final price to the freelancer when the team takes no cut", () => {
    const { transfers } = completionPostings({ ...base, teamCutBps: 0, finalPriceMinor: 100_000, balance: paidInFull });
    expect(transfers[0]?.entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -100_000 },
      { account: "owed:f1:available", currency: "USD", amountMinor: 100_000 },
    ]);
  });

  it("gives the whole final price to the team when its cut is 100%", () => {
    const { transfers } = completionPostings({ ...base, teamCutBps: 10_000, finalPriceMinor: 100_000, balance: paidInFull });
    expect(transfers[0]?.entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -100_000 },
      { account: "team_revenue", currency: "USD", amountMinor: 100_000 },
    ]);
  });

  it("takes a confirmed late refund from the freelancer's earnings, keeping the team cut on the full price", () => {
    // $1,000 price, $100 late refund confirmed: the client pays $900; the team keeps $150 and the freelancer gets $750.
    const { transfers } = completionPostings({ ...base, finalPriceMinor: 90_000, memberBearsMinor: 10_000, balance: paidInFull });
    expect(transfers[0]?.entries).toEqual(
      expect.arrayContaining([
        { account: "client_held:p1", currency: "USD", amountMinor: -90_000 },
        { account: "team_revenue", currency: "USD", amountMinor: 15_000 },
        { account: "owed:f1:available", currency: "USD", amountMinor: 75_000 },
      ]),
    );
  });

  it("takes the part of a late refund the freelancer's earnings cannot cover from the team cut", () => {
    // $1,000 price with a 90% team cut and a $200 late refund: the freelancer's $100 goes, and the team keeps $800.
    const { transfers } = completionPostings({ ...base, teamCutBps: 9_000, finalPriceMinor: 80_000, memberBearsMinor: 20_000, balance: paidInFull });
    expect(transfers[0]?.entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -80_000 },
      { account: "team_revenue", currency: "USD", amountMinor: 80_000 },
    ]);
  });

  it("adds a refund when a decrease left the client overpaid", () => {
    // $1,000 quote, $600 deposit paid, decreased by $700 → quote $300, fee credit $70, refund $270.
    const balance = balanceDue({
      quoteMinor: 30_000,
      managementFeeBps: 1_000,
      finalPriceMinor: 30_000,
      paidQuoteMinor: 50_000,
      paidManagementFeeMinor: 10_000,
      managementFeeCreditedMinor: 7_000,
    });
    const { transfers, refundMinor } = completionPostings({ ...base, finalPriceMinor: 30_000, balance });
    expect(refundMinor).toBe(27_000);
    expect(transfers.map((t) => t.reference)).toEqual(["completion:p1", `refund_requested:${completionRefundId("p1")}`]);
    expect(transfers[1]?.entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -27_000 },
      { account: "client_refunds", currency: "USD", amountMinor: 27_000 },
    ]);
  });

  it("refunds management fee from team_revenue when the fee kept exceeds the fee on the final quote", () => {
    // $1,000 quote, $600 deposit paid, decreased to $300 with no fee credit yet: the fee due is $30 of the $100
    // kept, so the $270 refund is $200 of quote and $70 of fee.
    const balance = balanceDue({
      quoteMinor: 30_000,
      managementFeeBps: 1_000,
      finalPriceMinor: 30_000,
      paidQuoteMinor: 50_000,
      paidManagementFeeMinor: 10_000,
      managementFeeCreditedMinor: 0,
    });
    expect(balance).toMatchObject({ refundMinor: 27_000, refundQuoteMinor: 20_000, refundManagementFeeMinor: 7_000 });
    const { transfers, refundMinor } = completionPostings({ ...base, finalPriceMinor: 30_000, balance });
    expect(refundMinor).toBe(27_000);
    expect(transfers[1]?.reference).toBe("refund_requested:completion-p1");
    expect(transfers[1]?.entries).toEqual(
      expect.arrayContaining([
        { account: "client_held:p1", currency: "USD", amountMinor: -20_000 },
        { account: "team_revenue", currency: "USD", amountMinor: -7_000 },
        { account: "client_refunds", currency: "USD", amountMinor: 27_000 },
      ]),
    );
    expect(transfers[1]?.entries).toHaveLength(3);
  });

  it("posts nothing to complete a project whose final price is zero", () => {
    const balance = balanceDue({
      quoteMinor: 0,
      managementFeeBps: 0,
      finalPriceMinor: 0,
      paidQuoteMinor: 0,
      paidManagementFeeMinor: 0,
      managementFeeCreditedMinor: 0,
    });
    expect(completionPostings({ ...base, finalPriceMinor: 0, balance })).toEqual({ transfers: [], refundMinor: 0 });
  });
});
