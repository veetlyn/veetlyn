import { describe, expect, it } from "vitest";

import { MAX_PRICE_MINOR } from "./product";
import {
  digitalPublishProblems,
  validateDigitalProductDraft,
  type DigitalProductDraft,
} from "./digital-product";

const good: DigitalProductDraft = { title: "Icon pack", description: "120 icons.", priceMinor: 1900 };

describe("validateDigitalProductDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateDigitalProductDraft(good)).toEqual([]);
  });
  it("accepts a free product at the draft stage", () => {
    expect(validateDigitalProductDraft({ ...good, priceMinor: 0 })).toEqual([]);
  });
  it("refuses an empty or long title", () => {
    expect(validateDigitalProductDraft({ ...good, title: "  " })).toEqual([
      { field: "title", message: "Add a title." },
    ]);
    expect(validateDigitalProductDraft({ ...good, title: "x".repeat(201) })).toEqual([
      { field: "title", message: "Keep the title under 200 characters." },
    ]);
  });
  it("refuses a long description", () => {
    expect(validateDigitalProductDraft({ ...good, description: "x".repeat(5001) })).toEqual([
      { field: "description", message: "Keep the description under 5,000 characters." },
    ]);
  });
  it("refuses a negative, fractional or huge price", () => {
    for (const priceMinor of [-1, 1.5, MAX_PRICE_MINOR + 1]) {
      expect(validateDigitalProductDraft({ ...good, priceMinor })).toEqual([
        { field: "price", message: "Enter a valid price." },
      ]);
    }
  });
});

describe("digitalPublishProblems", () => {
  it("runs the draft rules first", () => {
    expect(digitalPublishProblems({ ...good, title: "" }, true)[0]?.field).toBe("title");
  });
  it("refuses a free product", () => {
    expect(digitalPublishProblems({ ...good, priceMinor: 0 }, true)).toEqual([
      { field: "price", message: "Set a price above zero before publishing." },
    ]);
  });
  it("refuses a product without its file", () => {
    expect(digitalPublishProblems(good, false)).toEqual([
      { field: "file", message: "Add the file buyers download before publishing." },
    ]);
  });
  it("accepts a priced product with its file", () => {
    expect(digitalPublishProblems(good, true)).toEqual([]);
  });
});
