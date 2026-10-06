import { describe, expect, it } from "vitest";

import { bpsToPercent, percentToBps } from "./rates";

describe("percentToBps", () => {
  it("reads whole and decimal percentages", () => {
    expect(percentToBps("15")).toBe(1500);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("12.25")).toBe(1225);
    expect(percentToBps("0.05")).toBe(5);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("100")).toBe(10_000);
  });

  it("accepts spaces, a percent sign and a decimal comma", () => {
    expect(percentToBps(" 15 ")).toBe(1500);
    expect(percentToBps("15%")).toBe(1500);
    expect(percentToBps("12,5 %")).toBe(1250);
  });

  it("rejects empty, negative, oversized and over-precise values", () => {
    for (const input of ["", "abc", "-1", "100.01", "250", "12.255", "1e2", ".5"]) {
      expect(percentToBps(input)).toBeNull();
    }
  });
});

describe("bpsToPercent", () => {
  it("drops trailing zeros", () => {
    expect(bpsToPercent(1500)).toBe("15");
    expect(bpsToPercent(1250)).toBe("12.5");
    expect(bpsToPercent(1225)).toBe("12.25");
    expect(bpsToPercent(5)).toBe("0.05");
    expect(bpsToPercent(0)).toBe("0");
  });

  it("round-trips with percentToBps", () => {
    for (const bps of [0, 1, 10, 99, 150, 1500, 3333, 10_000]) {
      expect(percentToBps(bpsToPercent(bps))).toBe(bps);
    }
  });
});
