import { describe, expect, it } from "vitest";

import { deliveryTimingLabel, managementFeeLabel, paidSummary } from "./project-money";

const deposit = {
  status: "captured",
  amountMinor: 38_400,
  refundedMinor: 0,
  lines: [
    { kind: "deposit", amountMinor: 32_000 },
    { kind: "management_fee", amountMinor: 6_400 },
  ],
};
const balance = { status: "captured", amountMinor: 32_000, refundedMinor: 0, lines: [{ kind: "balance", amountMinor: 32_000 }] };

describe("paidSummary", () => {
  it("adds the receipts and the fee lines inside them", () => {
    // $320 deposit + $64 fee + $320 balance: the client paid $704 for $640 of work.
    expect(paidSummary([deposit, balance])).toEqual({ paidMinor: 70_400, feePaidMinor: 6_400, refundedMinor: 0, pendingMinor: 0 });
  });

  it("keeps waiting payments out of the paid total", () => {
    expect(paidSummary([deposit, { ...balance, status: "pending" }])).toMatchObject({ paidMinor: 38_400, pendingMinor: 32_000 });
  });

  it("reports refunds beside the captured total", () => {
    expect(paidSummary([{ ...deposit, status: "refunded", refundedMinor: 0 }])).toMatchObject({ paidMinor: 38_400, refundedMinor: 38_400 });
    expect(paidSummary([{ ...balance, refundedMinor: 5_000 }])).toMatchObject({ paidMinor: 32_000, refundedMinor: 5_000 });
  });
});

describe("labels", () => {
  it("names the fee's basis from the project's rate", () => {
    expect(managementFeeLabel(1_000)).toBe("Management fee (10% of the quote)");
    expect(managementFeeLabel(1_250)).toBe("Management fee (12.5% of the quote)");
  });

  it("says what starts the delivery clock", () => {
    expect(deliveryTimingLabel(10, 5_000)).toBe("10 days after the deposit");
    expect(deliveryTimingLabel(1, 10_000)).toBe("1 day after the upfront payment");
  });
});
