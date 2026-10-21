import { describe, expect, it } from "vitest";

import {
  balanceDue,
  depositDue,
  finalPriceMinor,
  freelancerEarningsMinor,
  managementFeeMinor,
  paidAfterRefunds,
  platformFeeMinor,
  teamCutMinor,
} from "./pricing";
import { daysLate, penaltyMinor } from "./penalty";

const FEE_BPS = 1_000;
const CUT_BPS = 1_500;
const FIVE_PERCENT_A_DAY = { ratePerDayBps: 500, capBps: 3_500 };

describe("services spec §5.3 worked example", () => {
  // Quote $1,000, management fee 10%, team cut 15%, delivered 3 days late under 5% per day.
  const quote = 100_000;

  it("charges a $600 deposit", () => {
    expect(depositDue(quote, FEE_BPS)).toEqual({ quotePartMinor: 50_000, managementFeeMinor: 10_000, totalMinor: 60_000 });
  });

  it("computes a $150 penalty and an $850 final price", () => {
    const penalty = penaltyMinor({ quoteMinor: quote, daysLate: 3, rule: FIVE_PERCENT_A_DAY });
    expect(penalty).toBe(15_000);
    expect(finalPriceMinor(quote, penalty)).toBe(85_000);
  });

  it("asks for a $350 balance", () => {
    expect(
      balanceDue({
        quoteMinor: quote,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 85_000,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toEqual({
      dueMinor: 35_000,
      quotePartMinor: 35_000,
      managementFeePartMinor: 0,
      refundMinor: 0,
      refundQuoteMinor: 0,
      refundManagementFeeMinor: 0,
    });
  });

  it("gives the team $127.50 and the freelancer $722.50", () => {
    expect(teamCutMinor(85_000, CUT_BPS)).toBe(12_750);
    expect(freelancerEarningsMinor(85_000, CUT_BPS)).toBe(72_250);
    expect(teamCutMinor(85_000, CUT_BPS) + managementFeeMinor(quote, FEE_BPS)).toBe(22_750);
  });

  it("takes the platform's 1% Team fee: $6 on $600 and $3.50 on $350", () => {
    expect(platformFeeMinor(60_000, 100)).toBe(600);
    expect(platformFeeMinor(35_000, 100)).toBe(350);
  });
});

describe("platformFeeMinor", () => {
  it.each([
    [1, 100, 0], // 0.01 rounds down: no fee on the order
    [50, 100, 1], // 0.5 rounds up
    [149, 100, 1],
    [150, 100, 2], // 1.5 rounds up
    [60_000, 25, 150],
    [60_000, 200, 1_200],
  ])("charges %i at %i bps → %i", (payment, bps, fee) => {
    expect(platformFeeMinor(payment, bps)).toBe(fee);
  });

  it("rejects zero, negative and fractional payments, and rates outside 0–10000 bps", () => {
    expect(() => platformFeeMinor(0, 100)).toThrow(RangeError);
    expect(() => platformFeeMinor(-100, 100)).toThrow(RangeError);
    expect(() => platformFeeMinor(10.5, 100)).toThrow(RangeError);
    expect(() => platformFeeMinor(100, 10_001)).toThrow(RangeError);
  });
});

describe("rates", () => {
  it("rounds the management fee and team cut half-up once", () => {
    expect(managementFeeMinor(12_345, FEE_BPS)).toBe(1_235); // 1234.5
    expect(teamCutMinor(333, CUT_BPS)).toBe(50); // 49.95
    expect(freelancerEarningsMinor(333, CUT_BPS)).toBe(283);
  });

  it("rejects rates outside 0–10000 bps", () => {
    expect(() => managementFeeMinor(100, 10_001)).toThrow(RangeError);
    expect(() => teamCutMinor(100, -1)).toThrow(RangeError);
  });

  it("splits an odd quote's deposit half-up", () => {
    expect(depositDue(1_001, FEE_BPS)).toEqual({ quotePartMinor: 501, managementFeeMinor: 100, totalMinor: 601 });
    expect(() => depositDue(0, FEE_BPS)).toThrow(RangeError);
  });
});

describe("penalties", () => {
  it("counts a started day as a day late", () => {
    const deadline = new Date("2026-10-10T12:00:00Z");
    expect(daysLate(deadline, new Date("2026-10-10T11:00:00Z"))).toBe(0);
    expect(daysLate(deadline, deadline)).toBe(0);
    expect(daysLate(deadline, new Date("2026-10-10T12:00:01Z"))).toBe(1);
    expect(daysLate(deadline, new Date("2026-10-13T12:00:00Z"))).toBe(3);
  });

  it("caps the penalty", () => {
    expect(penaltyMinor({ quoteMinor: 100_000, daysLate: 7, rule: FIVE_PERCENT_A_DAY })).toBe(35_000);
    expect(penaltyMinor({ quoteMinor: 100_000, daysLate: 30, rule: FIVE_PERCENT_A_DAY })).toBe(35_000);
    expect(penaltyMinor({ quoteMinor: 100_000, daysLate: 0, rule: FIVE_PERCENT_A_DAY })).toBe(0);
  });

  it("never takes the final price below zero", () => {
    const penalty = penaltyMinor({ quoteMinor: 100_000, daysLate: 30, rule: { ratePerDayBps: 500, capBps: 10_000 } });
    expect(penalty).toBe(100_000);
    expect(finalPriceMinor(100_000, penalty)).toBe(0);
    expect(finalPriceMinor(100_000, 150_000)).toBe(0);
  });
});

describe("balanceDue", () => {
  it("refunds the difference when the final price is below what was paid toward the quote (§5.3)", () => {
    // 12 days late at 5% a day with no cap below 100%: penalty $600, final price $400, $500 already paid.
    const penalty = penaltyMinor({ quoteMinor: 100_000, daysLate: 12, rule: { ratePerDayBps: 500, capBps: 10_000 } });
    expect(
      balanceDue({
        quoteMinor: 100_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: finalPriceMinor(100_000, penalty),
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toEqual({
      dueMinor: 0,
      quotePartMinor: 0,
      managementFeePartMinor: 0,
      refundMinor: 10_000,
      refundQuoteMinor: 10_000,
      refundManagementFeeMinor: 0,
    });
  });

  it("asks for management fee still due as its own line", () => {
    expect(
      balanceDue({
        quoteMinor: 100_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 100_000,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 9_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toMatchObject({ dueMinor: 51_000, quotePartMinor: 50_000, managementFeePartMinor: 1_000 });
  });

  it("refunds management fee kept above the fee on the current quote", () => {
    expect(
      balanceDue({
        quoteMinor: 70_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 0,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toEqual({
      dueMinor: 0,
      quotePartMinor: 0,
      managementFeePartMinor: 0,
      refundMinor: 53_000,
      refundQuoteMinor: 50_000,
      refundManagementFeeMinor: 3_000,
    });
  });
});

describe("paidAfterRefunds", () => {
  // A $600 deposit ($500 quote part, $100 fee) on an open project.
  const deposit = { paidQuoteMinor: 50_000, paidManagementFeeMinor: 10_000, managementFeeCreditedMinor: 0 };

  it.each([
    {
      case: "a refund taken from client_held lowers the quote part",
      input: { ...deposit, refundedFromClientHeldMinor: 20_000, refundedFromTeamRevenueMinor: 0 },
      paid: { paidQuoteMinor: 30_000, paidManagementFeeMinor: 10_000, managementFeeCreditedMinor: 0 },
    },
    {
      case: "a refund beyond client_held lowers the fee too",
      input: { ...deposit, refundedFromClientHeldMinor: 50_000, refundedFromTeamRevenueMinor: 10_000 },
      paid: { paidQuoteMinor: 0, paidManagementFeeMinor: 0, managementFeeCreditedMinor: 0 },
    },
    {
      // A $40 fee credit sat in client_held; the refund took $520 from it, $20 of it the credit.
      case: "a refund that drew the credited fee moves that credit back to the fee",
      input: {
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 4_000,
        refundedFromClientHeldMinor: 52_000,
        refundedFromTeamRevenueMinor: 0,
      },
      paid: { paidQuoteMinor: 0, paidManagementFeeMinor: 8_000, managementFeeCreditedMinor: 2_000 },
    },
  ])("$case", ({ input, paid }) => {
    expect(paidAfterRefunds(input)).toEqual(paid);
  });
});
