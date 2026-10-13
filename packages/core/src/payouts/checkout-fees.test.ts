import { describe, expect, it } from "vitest";

import { estimateCheckoutFeeMinor } from "./checkout-fees";

describe("estimateCheckoutFeeMinor", () => {
  it.each([
    ["USD domestic", { currency: "USD", amountMinor: 10_000, international: false }, 398], // 349 + 49
    ["USD international", { currency: "USD", amountMinor: 10_000, international: true }, 548],
    ["EUR domestic rounds up", { currency: "EUR", amountMinor: 1_001, international: false }, 74], // ceil(34.93)+39
  ] as const)("%s", (_n, input, fee) => expect(estimateCheckoutFeeMinor(input)).toBe(fee));
});
