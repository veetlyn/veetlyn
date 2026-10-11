import { describe, expect, it } from "vitest";

import { rateField } from "./services-team-settings-form";

describe("rateField", () => {
  it("converts a percent to basis points", () => {
    expect(rateField("2.5")).toEqual({ input: "2.5", problem: null, bps: 250 });
  });

  it("rejects empty and invalid input with a message", () => {
    expect(rateField("")).toEqual({ input: "", problem: "Enter a percent, like 20 or 2.5.", bps: null });
    expect(rateField("101")).toEqual({
      input: "101",
      problem: "Use a number from 0 to 100, with at most two decimals.",
      bps: null,
    });
  });
});
