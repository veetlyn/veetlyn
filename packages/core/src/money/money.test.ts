import { describe, expect, it } from "vitest";

import { addMoney, bpsOf, formatMoney, MAX_AMOUNT_MINOR, money, parseMajorAmount, subtractMoney } from "./money";

describe("money", () => {
  it("holds whole minor units only", () => {
    expect(money("USD", 1050)).toEqual({ currency: "USD", minor: 1050 });
    expect(() => money("USD", 10.5)).toThrow(RangeError);
    expect(() => money("EUR", Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it("adds and subtracts within one currency", () => {
    expect(addMoney(money("USD", 600), money("USD", 400))).toEqual(money("USD", 1000));
    expect(subtractMoney(money("EUR", 600), money("EUR", 800))).toEqual(money("EUR", -200));
    expect(() => addMoney(money("USD", 1), money("EUR", 1))).toThrow("Currency mismatch: USD and EUR");
  });

  it.each([
    [100_000, 1_000, 10_000],
    [85_000, 1_500, 12_750],
    [101, 50, 1], // 0.505 rounds up
    [99, 50, 0], // 0.495 rounds down
    [1_001, 5_000, 501], // 500.5 rounds up
    [MAX_AMOUNT_MINOR, 10_000, MAX_AMOUNT_MINOR],
  ])("takes %i × %i bps half-up = %i", (minor, bps, expected) => {
    expect(bpsOf(minor, bps)).toBe(expected);
  });

  it("refuses negative amounts in rate math", () => {
    expect(() => bpsOf(-1, 100)).toThrow(RangeError);
    expect(() => bpsOf(100, -1)).toThrow(RangeError);
  });

  it("formats USD and EUR", () => {
    expect(formatMoney(money("USD", 100_000))).toBe("$1,000.00");
    expect(formatMoney(money("USD", 72_250))).toBe("$722.50");
    expect(formatMoney(money("EUR", 310))).toBe("€3.10");
    expect(formatMoney(money("USD", -15_000))).toBe("-$150.00");
  });

  it.each([
    ["1000", 100_000],
    ["1,000.50", 100_050],
    [" 12.5 ", 1_250],
    ["0.01", 1],
  ])("parses %j as %i minor units", (input, expected) => {
    expect(parseMajorAmount(input)).toBe(expected);
  });

  it.each(["", "0", "0.00", "-5", "1.234", "abc", "1e3", "10000000000"])("rejects %j", (input) => {
    expect(parseMajorAmount(input)).toBeNull();
  });
});
