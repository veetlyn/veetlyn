import { describe, expect, it } from "vitest";

import { getSellerPlan, SELLER_PLANS, sellerPlanFor } from "./seller-plans";

describe("seller plans", () => {
  it("lists the approved prices and fees (pricing proposal §1)", () => {
    expect(SELLER_PLANS.map((p) => [p.id, p.audience, p.priceCents.monthly, p.priceCents.yearly, p.feeBps])).toEqual([
      ["solo", "freelancer", 900, 700, 200],
      ["pro", "freelancer", 2400, 1800, 100],
      ["premium", "freelancer", 5900, 4500, 50],
      ["team", "team", 3900, 2900, 100],
      ["studio", "team", 9900, 7500, 50],
      ["agency", "team", 24900, 18900, 25],
    ]);
  });

  it("raises the limits on higher plans", () => {
    expect(SELLER_PLANS.map((p) => [p.id, p.members, p.storageGb, p.aiDraftsPerMonth])).toEqual([
      ["solo", 1, 2, 20],
      ["pro", 1, 20, 100],
      ["premium", 1, 100, 300],
      ["team", 5, 50, 200],
      ["studio", 15, 200, 500],
      ["agency", 50, 500, 1500],
    ]);
    expect(
      SELLER_PLANS.map((p) => [p.id, p.customDomain, p.hideBadge, p.payoutAgent, p.publicApi, p.prioritySupport]),
    ).toEqual([
      ["solo", false, false, false, false, false],
      ["pro", true, true, false, false, false],
      ["premium", true, true, false, false, true],
      ["team", true, true, false, false, false],
      ["studio", true, true, true, true, false],
      ["agency", true, true, true, true, true],
    ]);
  });

  it("puts a solo seller on Solo and a team on Team until billing ships", () => {
    expect(sellerPlanFor({ id: "team-1", solo: true })).toBe(getSellerPlan("solo"));
    expect(sellerPlanFor({ id: "team-1", solo: false })).toBe(getSellerPlan("team"));
    expect(sellerPlanFor({ id: "team-1" })).toBe(getSellerPlan("team"));
  });

  it("rejects an unknown plan id", () => {
    expect(() => getSellerPlan("gold" as never)).toThrow(/Unknown seller plan/);
  });
});
