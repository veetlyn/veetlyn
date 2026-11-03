import { BILLING_PRODUCTS } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { type CatalogProduct, planCatalogChanges, type PolarSubscriptionLike, subscriptionSnapshot } from "./polar";

function subscription(overrides: Partial<PolarSubscriptionLike> = {}): PolarSubscriptionLike {
  return {
    id: "sub_1",
    status: "past_due",
    customer_id: "cus_1",
    product_id: "prod_1",
    past_due_at: "2026-11-10T00:00:00Z",
    current_period_end: "2026-12-10T00:00:00Z",
    cancel_at_period_end: false,
    ends_at: null,
    modified_at: "2026-11-10T00:00:05Z",
    created_at: "2026-10-10T00:00:00Z",
    metadata: {},
    customer: { external_id: "org_1" },
    product: { metadata: { plan_key: "team:grow:monthly" } },
    ...overrides,
  };
}

describe("subscriptionSnapshot", () => {
  it("reads the workspace from the customer's external id and the plans from the product key", () => {
    expect(subscriptionSnapshot(subscription())).toEqual({
      organizationId: "org_1",
      servicesTier: "team",
      storeTier: "grow",
      interval: "monthly",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      productId: "prod_1",
      status: "past_due",
      pastDueAt: new Date("2026-11-10T00:00:00Z"),
      currentPeriodEnd: new Date("2026-12-10T00:00:00Z"),
      cancelAtPeriodEnd: false,
      endsAt: null,
      modifiedAt: new Date("2026-11-10T00:00:05Z"),
    });
  });

  it("ignores subscriptions that are not a workspace's plan", () => {
    expect(subscriptionSnapshot(subscription({ customer: { external_id: null } }))).toBeNull();
    expect(subscriptionSnapshot(subscription({ product: { metadata: {} } }))).toBeNull();
    expect(subscriptionSnapshot(subscription({ product: { metadata: { plan_key: "gold:-:monthly" } } }))).toBeNull();
  });
});

describe("planCatalogChanges", () => {
  const solo = BILLING_PRODUCTS.find((p) => p.key === "solo:-:monthly");
  if (!solo) throw new Error("no solo product");
  const live = (id: string, key: string | null, priceCents: number | null, recurringInterval = "month"): CatalogProduct => ({
    id,
    key,
    isArchived: false,
    recurringInterval,
    priceCents,
  });

  it("creates every product on an empty catalog", () => {
    const changes = planCatalogChanges([], BILLING_PRODUCTS);
    expect(changes).toHaveLength(30);
    expect(changes.every((c) => c.kind === "create")).toBe(true);
  });

  it("keeps a product at the right price, replaces one whose price changed, and archives what is not wanted", () => {
    const changes = planCatalogChanges(
      [live("p1", "solo:-:monthly", 1900), live("p2", "team:-:monthly", 4900), live("p3", "gold:-:monthly", 1), live("p4", null, 5)],
      BILLING_PRODUCTS.filter((p) => p.key === "solo:-:monthly" || p.key === "team:-:monthly"),
    );
    expect(changes).toEqual([
      { kind: "replace", product: expect.objectContaining({ key: "team:-:monthly", chargeCents: 5900 }), archiveId: "p2", fromCents: 4900 },
      { kind: "archive", id: "p3", key: "gold:-:monthly" },
    ]);
  });

  it("archives duplicates of a product that is already right", () => {
    expect(planCatalogChanges([live("p1", "solo:-:monthly", 1900), live("p2", "solo:-:monthly", 1900)], [solo])).toEqual([
      { kind: "archive", id: "p2", key: "solo:-:monthly" },
    ]);
  });
});
