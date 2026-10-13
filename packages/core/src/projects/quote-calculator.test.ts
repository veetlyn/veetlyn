import { describe, expect, it } from "vitest";

import { quoteForMemberTarget } from "./quote-calculator";

const team = {
  teamCutBps: 1_500,
  managementFeeBps: 1_000,
  platformFeeBps: 100,
  currency: "USD" as const,
  senderCountry: "US",
  receiverCountry: "US",
};

describe("quoteForMemberTarget", () => {
  // bpsOf rounds half up. Quote 1000.00: cut 150.00, earnings 850.00, US flat payout fee 0.25 → 849.75.
  // Quote 999.99: cut round(149.9985) = 150.00, earnings 849.99 → 849.74, one cent short. So 1000.00 is the smallest.
  // Client pays 1000.00 + 100.00; checkout fee ceil(1100.00 × 3.49%) + 0.49 = 38.39 + 0.49 = 38.88; Payleor's fee 1% = 11.00;
  // team keeps 150.00 + 100.00 − 38.88 − 11.00 = 200.12.
  it("finds the smallest quote that leaves the member at least the target after the payout fee", () => {
    expect(quoteForMemberTarget({ ...team, targetNetMinor: 84_975 })).toEqual({
      quoteMinor: 100_000,
      clientPaysMinor: 110_000,
      checkoutFeeMinor: 3_888,
      platformFeeMinor: 1_100,
      teamKeepsMinor: 20_012,
      payoutFeeMinor: 25,
      memberReceivesMinor: 84_975,
    });
  });

  it("goes one cent up when the exact quote falls a cent short", () => {
    // Target 849.76 needs earnings 850.01: quote 1000.01 has cut round(150.0015) = 150.00 → earnings 850.01.
    expect(quoteForMemberTarget({ ...team, targetNetMinor: 84_976 }).quoteMinor).toBe(100_001);
  });

  it.each([0, -1, 1.5])("refuses a target of %s", (target) => {
    expect(() => quoteForMemberTarget({ ...team, targetNetMinor: target })).toThrow("Enter what the member should receive.");
  });
});
