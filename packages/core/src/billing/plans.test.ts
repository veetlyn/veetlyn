import { describe, expect, it } from "vitest";

import { formatOrderFee, formatPlanPrice, getPlan, PLANS, planFor, TRIAL_DAYS } from "./plans";

describe("plans", () => {
  it("lists Starter, Grow and Scale with the prices and fees of parent spec §6.7", () => {
    expect(PLANS.map((p) => [p.id, p.priceCents.monthly, p.priceCents.yearly, p.orderFeeBps])).toEqual([
      ["starter", 1200, 900, 200],
      ["grow", 3900, 2900, 100],
      ["scale", 12900, 9900, 50],
    ]);
  });

  it("raises the limits on higher plans", () => {
    expect(PLANS.map((p) => [p.staffSeats, p.customDomain, p.adminAgent, p.disputeAgent])).toEqual([
      [2, false, false, false],
      [5, true, true, true],
      [15, true, true, true],
    ]);
  });

  it("has a 14-day trial", () => {
    expect(TRIAL_DAYS).toBe(14);
  });

  it("puts every store on Starter until billing ships", () => {
    expect(planFor({ id: "store-1" })).toBe(getPlan("starter"));
  });

  it("formats fees and prices for display", () => {
    expect(formatOrderFee(200)).toBe("2%");
    expect(formatOrderFee(50)).toBe("0.5%");
    expect(formatPlanPrice(1200)).toBe("$12");
    expect(formatPlanPrice(108_00)).toBe("$108");
    expect(formatPlanPrice(1250)).toBe("$12.50");
  });
});
