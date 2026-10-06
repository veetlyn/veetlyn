import { describe, expect, it } from "vitest";

import { formatMinor, parsePriceInput } from "./money";

describe("formatMinor", () => {
  it("formats minor units in the given currency", () => {
    expect(formatMinor(4200, "USD")).toBe("$42.00");
    expect(formatMinor(0, "USD")).toBe("$0.00");
    expect(formatMinor(99, "USD")).toBe("$0.99");
  });
});

describe("parsePriceInput", () => {
  it("parses major units into minor units", () => {
    expect(parsePriceInput("42")).toBe(4200);
    expect(parsePriceInput("42.5")).toBe(4250);
    expect(parsePriceInput("42.55")).toBe(4255);
    expect(parsePriceInput(" 0.99 ")).toBe(99);
  });

  it("rejects non-prices without floating-point surprises", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
    expect(parsePriceInput("-1")).toBeNull();
    expect(parsePriceInput("1.999")).toBeNull();
    expect(parsePriceInput("1,5")).toBeNull();
  });
});
