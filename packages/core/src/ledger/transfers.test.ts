import { describe, expect, it } from "vitest";

import {
  assertBalanced,
  assertUniqueReferences,
  balanceDeltas,
  isBalanced,
  LedgerError,
  type LedgerTransferDraft,
  transferFromMoves,
} from "./transfers";

const transfer = (entries: LedgerTransferDraft["entries"], reference = "t1"): LedgerTransferDraft => ({
  kind: "payment_captured",
  reference,
  projectId: "p1",
  entries,
});

describe("ledger transfers", () => {
  it("accepts transfers that sum to zero in every currency", () => {
    expect(
      isBalanced(
        transfer([
          { account: "paypal_clearing", currency: "USD", amountMinor: -600 },
          { account: "client_held:p1", currency: "USD", amountMinor: 500 },
          { account: "team_revenue", currency: "USD", amountMinor: 100 },
        ]),
      ),
    ).toBe(true);
  });

  it("rejects unbalanced, one-sided, zero, fractional and unknown-account transfers", () => {
    const cases: LedgerTransferDraft["entries"][] = [
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: -600 },
        { account: "client_held:p1", currency: "USD", amountMinor: 500 },
      ],
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: -600 },
        { account: "client_held:p1", currency: "EUR", amountMinor: 600 },
      ],
      [{ account: "paypal_clearing", currency: "USD", amountMinor: 0 }],
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: 0 },
        { account: "client_held:p1", currency: "USD", amountMinor: 0 },
      ],
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: -0.5 },
        { account: "client_held:p1", currency: "USD", amountMinor: 0.5 },
      ],
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: -1 },
        // @ts-expect-error an account outside the ledger's account names must not balance
        { account: "cash", currency: "USD", amountMinor: 1 },
      ],
    ];
    for (const entries of cases) {
      expect(isBalanced(transfer(entries))).toBe(false);
      expect(() => assertBalanced(transfer(entries))).toThrow(LedgerError);
    }
  });

  it("merges moves per account and drops zero amounts", () => {
    expect(
      transferFromMoves({
        kind: "payment_captured",
        reference: "payment_captured:pay1",
        projectId: "p1",
        currency: "USD",
        moves: [
          { from: "paypal_clearing", to: "client_held:p1", amountMinor: 500 },
          { from: "paypal_clearing", to: "team_revenue", amountMinor: 0 },
        ],
      }).entries,
    ).toEqual([
      { account: "paypal_clearing", currency: "USD", amountMinor: -500 },
      { account: "client_held:p1", currency: "USD", amountMinor: 500 },
    ]);
  });

  it("refuses a transfer with nothing to move or a negative move", () => {
    const base = { kind: "payment_captured", reference: "r", projectId: "p1", currency: "USD" } as const;
    expect(() =>
      transferFromMoves({ ...base, moves: [{ from: "paypal_clearing", to: "team_revenue", amountMinor: 0 }] }),
    ).toThrow("needs a non-zero amount");
    expect(() =>
      transferFromMoves({ ...base, moves: [{ from: "paypal_clearing", to: "team_revenue", amountMinor: -1 }] }),
    ).toThrow(RangeError);
  });

  it("sums deltas per account in a fixed lock order", () => {
    const first = transfer(
      [
        { account: "team_revenue", currency: "USD", amountMinor: 100 },
        { account: "paypal_clearing", currency: "USD", amountMinor: -100 },
      ],
      "a",
    );
    const second = transfer(
      [
        { account: "client_held:p1", currency: "USD", amountMinor: 50 },
        { account: "team_revenue", currency: "USD", amountMinor: -50 },
      ],
      "b",
    );
    expect(balanceDeltas([first, second])).toEqual([
      { account: "client_held:p1", currency: "USD", deltaMinor: 50 },
      { account: "paypal_clearing", currency: "USD", deltaMinor: -100 },
      { account: "team_revenue", currency: "USD", deltaMinor: 50 },
    ]);
  });

  it("rejects a reference used twice in one batch", () => {
    const entries = [
      { account: "paypal_clearing", currency: "USD", amountMinor: -1 },
      { account: "team_revenue", currency: "USD", amountMinor: 1 },
    ] as const;
    expect(() => assertUniqueReferences([transfer(entries, "same"), transfer(entries, "same")])).toThrow(
      expect.objectContaining({ code: "duplicate_reference" }),
    );
  });
});
