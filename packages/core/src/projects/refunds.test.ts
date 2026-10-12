import { describe, expect, it } from "vitest";

import { splitProjectRefund } from "./refunds";

const topUp = { paymentId: "top-up", refundableMinor: 50_000 };
const deposit = { paymentId: "deposit", refundableMinor: 60_000 };

describe("splitProjectRefund", () => {
  it.each([
    { name: "the newest payment covers it", amountMinor: 16_000, payments: [topUp, deposit], parts: [{ paymentId: "top-up", amountMinor: 16_000 }] },
    {
      name: "the rest comes from the next payment",
      amountMinor: 66_000,
      payments: [topUp, deposit],
      parts: [
        { paymentId: "top-up", amountMinor: 50_000 },
        { paymentId: "deposit", amountMinor: 16_000 },
      ],
    },
    {
      name: "exactly everything refundable",
      amountMinor: 110_000,
      payments: [topUp, deposit],
      parts: [
        { paymentId: "top-up", amountMinor: 50_000 },
        { paymentId: "deposit", amountMinor: 60_000 },
      ],
    },
    {
      name: "a payment with nothing left is skipped",
      amountMinor: 10_000,
      payments: [{ paymentId: "spent", refundableMinor: 0 }, deposit],
      parts: [{ paymentId: "deposit", amountMinor: 10_000 }],
    },
    { name: "more than the payments hold", amountMinor: 110_001, payments: [topUp, deposit], parts: null },
    { name: "no payments", amountMinor: 1, payments: [], parts: null },
  ])("$name", ({ amountMinor, payments, parts }) => {
    expect(splitProjectRefund({ amountMinor, payments })).toEqual(parts);
  });
});
