import { describe, expect, it } from "vitest";

import { depositDue } from "./pricing";
import {
  amendmentProblemMessage,
  checkoutItems,
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

describe("checkoutItems", () => {
  const base = { title: "Logo refresh", currency: "USD" as const, managementFeeBps: 1_000 };
  const quoteItems = [
    { description: "Logo mark", amountMinor: 15_000 },
    { description: "Wordmark", amountMinor: 5_000 },
  ];

  it("lists the quote's own lines when the whole price is paid up front", () => {
    const lines = paymentLines("deposit", depositDue(20_000, 1_000, 10_000), 1_000, 10_000);
    expect(checkoutItems({ ...base, kind: "deposit", lines, quoteItems, quoteMinor: 20_000, upfrontBps: 10_000 })).toEqual([
      { name: "Logo mark", amountMinor: 15_000 },
      { name: "Wordmark", amountMinor: 5_000 },
      { name: "Project management fee", description: "10% of the quote", amountMinor: 2_000 },
    ]);
  });

  it("names a part payment after the project with the quote total beside it", () => {
    const lines = paymentLines("deposit", depositDue(20_000, 1_000), 1_000);
    expect(checkoutItems({ ...base, kind: "deposit", lines, quoteItems, quoteMinor: 20_000, upfrontBps: 5_000 })[0]).toEqual({
      name: "Logo refresh: 50% deposit",
      description: "Quote total $200.00",
      amountMinor: 10_000,
    });
  });
});

describe("paymentLines", () => {
  it("shows the §5.3 deposit as two lines", () => {
    expect(paymentLines("deposit", depositDue(100_000, 1_000), 1_000)).toEqual([
      { kind: "deposit", label: "Deposit (50% of the quote)", amountMinor: 50_000 },
      { kind: "management_fee", label: "Management fee (10%)", amountMinor: 10_000 },
    ]);
  });

  it("names the deposit by the share the rules took up front", () => {
    expect(paymentLines("deposit", depositDue(20_000, 1_000, 10_000), 1_000, 10_000)[0]?.label).toBe("Full payment upfront");
    expect(paymentLines("deposit", depositDue(100_000, 1_000, 3_000), 1_000, 3_000)[0]?.label).toBe("Deposit (30% of the quote)");
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
