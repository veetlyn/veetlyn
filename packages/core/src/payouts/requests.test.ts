import { describe, expect, it } from "vitest";

import { payoutAmountProblem, payoutReceivedProblem } from "./requests";

describe("payoutAmountProblem", () => {
  it.each([
    { amountMinor: 100, availableMinor: 100, problem: null },
    { amountMinor: 3_000_000, availableMinor: 5_000_000, problem: null },
    { amountMinor: 99, availableMinor: 10_000, problem: "Enter at least 1.00." },
    { amountMinor: 0, availableMinor: 0, problem: "Enter at least 1.00." },
    { amountMinor: 10_001, availableMinor: 10_000, problem: "You can request up to 100.00." },
    { amountMinor: 3_000_000, availableMinor: 123_456, problem: "You can request up to 1,234.56." },
  ])("$amountMinor of $availableMinor available: $problem", ({ amountMinor, availableMinor, problem }) => {
    expect(payoutAmountProblem({ amountMinor, availableMinor })).toBe(problem);
  });
});

describe("payoutReceivedProblem", () => {
  it.each([
    { receivedMinor: 0, amountMinor: 2_500, problem: "Enter the amount the member received." },
    { receivedMinor: 2_500, amountMinor: 2_500, problem: null },
    { receivedMinor: 2_501, amountMinor: 2_500, problem: "Enter at most 25.00, the amount requested." },
    { receivedMinor: 2_327, amountMinor: 2_500, problem: null },
  ])("$receivedMinor received of $amountMinor: $problem", ({ receivedMinor, amountMinor, problem }) => {
    expect(payoutReceivedProblem({ receivedMinor, amountMinor })).toBe(problem);
  });
});
