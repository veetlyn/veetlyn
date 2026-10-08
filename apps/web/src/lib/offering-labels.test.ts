import { describe, expect, it } from "vitest";

import { daysLabel, priceLabel } from "./offering-labels";

describe("priceLabel", () => {
  it("shows one price when the range is fixed", () => {
    expect(priceLabel({ priceMinMinor: 4200, priceMaxMinor: 4200 }, "USD")).toBe("$42.00");
  });

  it("shows a range otherwise", () => {
    expect(priceLabel({ priceMinMinor: 4200, priceMaxMinor: 9900 }, "USD")).toBe("$42.00 – $99.00");
  });
});

describe("daysLabel", () => {
  it("uses the singular for one day", () => {
    expect(daysLabel({ daysMin: 1, daysMax: 1 })).toBe("1 day");
  });

  it("shows a fixed day count", () => {
    expect(daysLabel({ daysMin: 5, daysMax: 5 })).toBe("5 days");
  });

  it("shows a range of days", () => {
    expect(daysLabel({ daysMin: 1, daysMax: 3 })).toBe("1–3 days");
  });
});
