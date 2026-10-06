import { describe, expect, it } from "vitest";

import { rateField } from "./services-team-settings-form";

describe("rateField", () => {
  it("accepts percents and converts them to basis points", () => {
    expect(rateField("20")).toEqual({ input: "20", problem: null, bps: 2000 });
    expect(rateField("2.5")).toEqual({ input: "2.5", problem: null, bps: 250 });
    expect(rateField("2,5").bps).toBe(250);
    expect(rateField("20 %").bps).toBe(2000);
  });

  it("rejects empty input and out-of-range or over-precise values, with a message", () => {
    expect(rateField("")).toEqual({ input: "", problem: "Enter a percent, like 20 or 2.5.", bps: null });
    for (const bad of ["101", "1.234", "abc"]) {
      expect(rateField(bad).problem).toBe("Use a number from 0 to 100, with at most two decimals.");
      expect(rateField(bad).bps).toBeNull();
    }
  });
});
