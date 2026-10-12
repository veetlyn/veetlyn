import { describe, expect, it } from "vitest";

import { estimatePayoutFeeMinor } from "./fees";

describe("estimatePayoutFeeMinor", () => {
  it.each([
    { currency: "USD", amountMinor: 2_500, senderCountry: "US", receiverCountry: "US", fee: 25 },
    { currency: "EUR", amountMinor: 2_500, senderCountry: "US", receiverCountry: "US", fee: 22 },
    { currency: "USD", amountMinor: 2_500, senderCountry: "SN", receiverCountry: "US", fee: 50 },
    { currency: "USD", amountMinor: 1_001, senderCountry: "US", receiverCountry: "FR", fee: 21 },
    { currency: "USD", amountMinor: 2_500, senderCountry: "US", receiverCountry: null, fee: 50 },
    { currency: "USD", amountMinor: 2_500, senderCountry: null, receiverCountry: "US", fee: 50 },
    { currency: "USD", amountMinor: 100_000, senderCountry: "SN", receiverCountry: "SN", fee: 2_000 },
    { currency: "EUR", amountMinor: 100_000, senderCountry: "FR", receiverCountry: "DE", fee: 1_600 },
  ] as const)(
    "$amountMinor $currency from $senderCountry to $receiverCountry: $fee",
    ({ fee, ...input }) => {
      expect(estimatePayoutFeeMinor(input)).toBe(fee);
    },
  );
});
