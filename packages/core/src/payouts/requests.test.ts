import { describe, expect, it } from "vitest";

import { payoutAmountProblem, payoutBatchOutcome, payoutItemOutcome } from "./requests";

describe("payoutAmountProblem", () => {
  it.each([
    { amountMinor: 100, availableMinor: 100, problem: null },
    { amountMinor: 2_000_000, availableMinor: 5_000_000, problem: null },
    { amountMinor: 99, availableMinor: 10_000, problem: "Enter at least 1.00." },
    { amountMinor: 0, availableMinor: 0, problem: "Enter at least 1.00." },
    { amountMinor: 10_001, availableMinor: 10_000, problem: "You can request up to 100.00." },
    { amountMinor: 3_000_000, availableMinor: 123_456, problem: "You can request up to 1,234.56." },
    { amountMinor: 2_000_001, availableMinor: 5_000_000, problem: "PayPal pays at most 20,000.00 at a time." },
  ])("$amountMinor of $availableMinor available: $problem", ({ amountMinor, availableMinor, problem }) => {
    expect(payoutAmountProblem({ amountMinor, availableMinor })).toBe(problem);
  });
});

describe("payoutItemOutcome", () => {
  it.each([
    { status: "SUCCESS", outcome: "succeeded" },
    { status: "FAILED", outcome: "failed" },
    { status: "RETURNED", outcome: "failed" },
    { status: "BLOCKED", outcome: "failed" },
    { status: "REFUNDED", outcome: "failed" },
    { status: "REVERSED", outcome: "failed" },
    { status: "PENDING", outcome: "pending" },
    { status: "ONHOLD", outcome: "pending" },
    { status: "UNCLAIMED", outcome: "pending" },
    { status: "SOMETHING_NEW", outcome: "pending" },
    { status: undefined, outcome: "pending" },
  ])("$status is $outcome", ({ status, outcome }) => {
    expect(payoutItemOutcome(status)).toBe(outcome);
  });
});

describe("payoutBatchOutcome", () => {
  it.each([
    { batchStatus: "DENIED", outcome: "failed" },
    { batchStatus: "CANCELED", outcome: "failed" },
    { batchStatus: "PENDING", outcome: "pending" },
    { batchStatus: "PROCESSING", outcome: "pending" },
    { batchStatus: "SUCCESS", outcome: "pending" },
  ])("$batchStatus is $outcome", ({ batchStatus, outcome }) => {
    expect(payoutBatchOutcome(batchStatus)).toBe(outcome);
  });
});
