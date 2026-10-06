import { describe, expect, it } from "vitest";

import { amendmentEffect } from "./amendments";
import { balanceDue, depositDue, managementFeeMinor } from "./pricing";

const FEE_BPS = 1_000;

describe("services spec §5.5 worked examples", () => {
  it("asks for a $240 top-up on a +$400 increase and adds $200 to the balance", () => {
    expect(amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 140_000, managementFeeBps: FEE_BPS })).toEqual({
      kind: "increase",
      deltaMinor: 40_000,
      topUp: { quotePartMinor: 20_000, managementFeeMinor: 4_000, totalMinor: 24_000 },
      addedToBalanceMinor: 20_000,
    });
  });

  it("credits $30 of management fee and $150 of deposit on a −$300 decrease", () => {
    expect(amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 70_000, managementFeeBps: FEE_BPS })).toEqual({
      kind: "decrease",
      deltaMinor: -30_000,
      managementFeeCreditMinor: 3_000,
      depositCreditMinor: 15_000,
    });
  });

  it("takes both credits off the balance payment after a decrease", () => {
    // $1,000 quote, $600 deposit paid, −$300 accepted: $700 + $70 − $600 = $170, which is $350 − $150 − $30.
    expect(
      balanceDue({
        quoteMinor: 70_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 70_000,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 3_000,
      }),
    ).toMatchObject({ dueMinor: 17_000, quotePartMinor: 17_000, managementFeePartMinor: 0, refundMinor: 0 });
  });

  it("adds the other half of an increase to the balance payment", () => {
    // $600 deposit and $240 top-up paid on a $1,400 quote: $1,400 + $140 − $840 = $700 = $500 + $200.
    expect(
      balanceDue({
        quoteMinor: 140_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 140_000,
        paidQuoteMinor: 70_000,
        paidManagementFeeMinor: 14_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toMatchObject({ dueMinor: 70_000, quotePartMinor: 70_000, managementFeePartMinor: 0 });
  });

  it("refunds credits above what is still due", () => {
    // −$800 on a $1,000 quote with $600 paid: $200 + $20 − $600 → $380 refunded, all from the quote part.
    const effect = amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 20_000, managementFeeBps: FEE_BPS });
    expect(effect).toMatchObject({ kind: "decrease", managementFeeCreditMinor: 8_000 });
    expect(
      balanceDue({
        quoteMinor: 20_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 20_000,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 8_000,
      }),
    ).toMatchObject({ dueMinor: 0, refundMinor: 38_000, refundQuoteMinor: 38_000, refundManagementFeeMinor: 0 });
  });
});

describe("amendmentEffect", () => {
  it("reports no money movement when the total does not change", () => {
    expect(amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 100_000, managementFeeBps: FEE_BPS })).toEqual({
      kind: "unchanged",
      deltaMinor: 0,
    });
  });

  it("refuses to remove the whole quote", () => {
    expect(() => amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 0, managementFeeBps: FEE_BPS })).toThrow(
      RangeError,
    );
  });

  it("keeps deposit plus top-ups equal to the deposit on the current quote, whatever the rounding", () => {
    const versions = [1_001, 1_004, 1_333, 2_777, 9_999];
    let paidQuote = depositDue(versions[0] ?? 0, FEE_BPS).quotePartMinor;
    let paidFee = depositDue(versions[0] ?? 0, FEE_BPS).managementFeeMinor;
    for (let i = 1; i < versions.length; i++) {
      const effect = amendmentEffect({
        previousQuoteMinor: versions[i - 1] ?? 0,
        newQuoteMinor: versions[i] ?? 0,
        managementFeeBps: FEE_BPS,
      });
      if (effect.kind !== "increase") throw new Error("expected an increase");
      paidQuote += effect.topUp.quotePartMinor;
      paidFee += effect.topUp.managementFeeMinor;
    }
    expect(paidQuote).toBe(depositDue(9_999, FEE_BPS).quotePartMinor);
    expect(paidFee).toBe(managementFeeMinor(9_999, FEE_BPS));
  });
});
