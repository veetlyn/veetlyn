import { describe, expect, it } from "vitest";

import { captureReviewReason } from "./review";

const usd = (value = "1.00") => ({ currency_code: "USD", value });
const eur = (value = "1.00") => ({ currency_code: "EUR", value });

describe("captureReviewReason", () => {
  it.each([
    { name: "fees in the capture currency", breakdown: { paypal_fee: usd(), platform_fees: [{ amount: usd() }] }, expected: null },
    { name: "no fee at all", breakdown: { platform_fees: [] }, expected: null },
    {
      name: "a receivable in the capture currency",
      breakdown: { paypal_fee: usd(), platform_fees: [], receivable_amount: usd("98.00") },
      expected: null,
    },
    {
      name: "funds converted into the seller's currency",
      breakdown: { paypal_fee: usd(), platform_fees: [{ amount: eur() }], receivable_amount: eur("90.00") },
      expected: "converted_receivable",
    },
    { name: "PayPal's fee in another currency", breakdown: { paypal_fee: eur(), platform_fees: [] }, expected: "fee_currency" },
    { name: "the platform's fee in another currency", breakdown: { paypal_fee: usd(), platform_fees: [{ amount: eur() }] }, expected: "fee_currency" },
  ])("$name", ({ breakdown, expected }) => {
    expect(captureReviewReason(breakdown, "USD")).toBe(expected);
  });
});
