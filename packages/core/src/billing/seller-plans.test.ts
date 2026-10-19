import { describe, expect, it } from "vitest";

import { getSellerPlan, NETWORK_FEE_BPS, SELLER_PLANS, sellerPlanFor } from "./seller-plans";

describe("seller plans", () => {
  it("lists the published prices and fees", () => {
    expect(SELLER_PLANS.map((p) => [p.id, p.audience, p.priceCents.monthly, p.priceCents.yearly, p.feeBps])).toEqual([
      ["solo", "freelancer", 1900, 1600, 100],
      ["team", "team", 5900, 4900, 50],
      ["agency", "team", 19900, 16600, 25],
    ]);
    expect(NETWORK_FEE_BPS).toBe(500);
  });

  it("raises the limits on higher plans", () => {
    expect(SELLER_PLANS.map((p) => [p.id, p.members, p.storageGb, p.aiDraftsPerMonth])).toEqual([
      ["solo", 1, 5, 50],
      ["team", 10, 50, 300],
      ["agency", 50, 500, 1500],
    ]);
    expect(
      SELLER_PLANS.map((p) => [p.id, p.customDomain, p.hideBadge, p.payoutAgent, p.publicApi, p.prioritySupport]),
    ).toEqual([
      ["solo", false, false, false, false, false],
      ["team", true, true, false, true, false],
      ["agency", true, true, true, true, true],
    ]);
  });

  it("puts a solo seller on Solo and a team on Team until billing ships", () => {
    expect(sellerPlanFor({ id: "team-1", solo: true })).toBe(getSellerPlan("solo"));
    expect(sellerPlanFor({ id: "team-1", solo: false })).toBe(getSellerPlan("team"));
    expect(sellerPlanFor({ id: "team-1" })).toBe(getSellerPlan("team"));
  });

  it("rejects an unknown plan id", () => {
    // @ts-expect-error an id outside SellerPlanId reaches the runtime check
    expect(() => getSellerPlan("gold")).toThrow(/Unknown seller plan/);
  });
});
