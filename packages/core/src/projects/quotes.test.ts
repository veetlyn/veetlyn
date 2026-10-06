import { describe, expect, it } from "vitest";

import { depositDue } from "./pricing";
import {
  amendmentProblemMessage,
  amendQuoteItems,
  paymentLines,
  type QuoteItem,
  quoteItemsProblem,
  quoteItemsProblemMessage,
  quoteTotalMinor,
} from "./quotes";

const design = { description: "Design", amountMinor: 40_000, extraDays: 0 };
const build = { description: "Build", amountMinor: 60_000, extraDays: 0 };
const base: QuoteItem[] = [
  { id: "i1", ...design },
  { id: "i2", ...build },
];

describe("quote items", () => {
  it("totals the lines", () => {
    expect(quoteTotalMinor(base)).toBe(100_000);
  });

  it("accepts valid lines and names the first problem otherwise", () => {
    expect(quoteItemsProblem([design])).toBeNull();
    expect(quoteItemsProblem([])).toBe("empty");
    expect(quoteItemsProblem(Array.from({ length: 21 }, () => design))).toBe("too_many");
    expect(quoteItemsProblem([{ ...design, description: "  " }])).toBe("description");
    expect(quoteItemsProblem([{ ...design, amountMinor: 0 }])).toBe("amount");
    expect(quoteItemsProblem([{ ...design, amountMinor: 10.5 }])).toBe("amount");
    expect(quoteItemsProblem([{ ...design, extraDays: -1 }])).toBe("extra_days");
    expect(quoteItemsProblem([{ ...design, amountMinor: 100_000_000_000 }, design])).toBe("total");
  });

  it("explains problems in plain words", () => {
    expect(quoteItemsProblemMessage("empty")).toBe("A quote needs at least one line.");
    expect(amendmentProblemMessage("empty")).toBe("An amendment cannot remove every line. Cancel the project instead.");
    expect(amendmentProblemMessage("no_change")).toBe("Add or remove at least one line.");
  });
});

describe("amendQuoteItems", () => {
  it("adds lines and extends the deadline by their extra days (§5.5 +$400)", () => {
    const result = amendQuoteItems(base, { add: [{ description: " Blog ", amountMinor: 40_000, extraDays: 3 }], removeItemIds: [] });
    expect(result).toEqual({
      ok: true,
      items: [design, build, { description: "Blog", amountMinor: 40_000, extraDays: 3 }],
      extraDays: 3,
    });
    if (result.ok) expect(quoteTotalMinor(result.items)).toBe(140_000);
  });

  it("removes lines without shortening the deadline", () => {
    expect(amendQuoteItems(base, { add: [], removeItemIds: ["i1"] })).toEqual({ ok: true, items: [build], extraDays: 0 });
  });

  it("rejects empty, unknown, repeated and whole-quote removals", () => {
    expect(amendQuoteItems(base, { add: [], removeItemIds: [] })).toEqual({ ok: false, problem: "no_change" });
    expect(amendQuoteItems(base, { add: [], removeItemIds: ["nope"] })).toEqual({ ok: false, problem: "unknown_item" });
    expect(amendQuoteItems(base, { add: [], removeItemIds: ["i1", "i1"] })).toEqual({ ok: false, problem: "unknown_item" });
    expect(amendQuoteItems(base, { add: [], removeItemIds: ["i1", "i2"] })).toEqual({ ok: false, problem: "empty" });
  });
});

describe("paymentLines", () => {
  it("shows the §5.3 deposit as two lines", () => {
    expect(paymentLines("deposit", depositDue(100_000, 1_000), 1_000)).toEqual([
      { kind: "deposit", label: "Deposit (50% of the quote)", amountMinor: 50_000 },
      { kind: "management_fee", label: "Management fee (10%)", amountMinor: 10_000 },
    ]);
  });

  it("labels top-ups and leaves out zero lines", () => {
    expect(paymentLines("top_up", { quotePartMinor: 20_000, managementFeeMinor: 0, totalMinor: 20_000 }, 1_250)).toEqual([
      { kind: "top_up", label: "Top-up (50% of the increase)", amountMinor: 20_000 },
    ]);
    expect(paymentLines("deposit", { quotePartMinor: 1, managementFeeMinor: 1, totalMinor: 2 }, 1_250)[1]?.label).toBe(
      "Management fee (12.5%)",
    );
  });
});
