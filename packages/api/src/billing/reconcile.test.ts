import { applySubscriptionSnapshot, ensureBillingAccount, getBillingAccount } from "@jendal-workspace/db/repositories/billing";
import { createTestDb, hasTestDatabase, seedOrganization, truncateAll } from "@jendal-workspace/db/testing/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPolarClient, type PolarClient } from "./polar";
import { reconcileBilling } from "./reconcile";

describe.skipIf(!hasTestDatabase)("billing reconciliation", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => db.$client.end());

  it("recovers missed updates, refuses cross-workspace responses, and continues past a provider failure", async () => {
    const organizations = await Promise.all([seedOrganization(db), seedOrganization(db), seedOrganization(db)]);
    const ids = organizations.map((o) => o.organizationId).sort();
    for (const id of ids) {
      await ensureBillingAccount(db, { organizationId: id, product: "services", solo: true, now: new Date("2026-11-01T00:00:00Z") });
      await applySubscriptionSnapshot(db, {
        organizationId: id, servicesTier: "solo", storeTier: null, interval: "monthly",
        customerId: `cus_${id}`, subscriptionId: `sub_${id}`, productId: "prod_old", status: "active",
        pastDueAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, endsAt: null,
        modifiedAt: new Date("2026-11-01T00:00:00Z"),
      });
    }
    const polar = createPolarClient({ accessToken: "test-token", server: "sandbox" });
    vi.spyOn(polar.subscriptions, "get").mockImplementation(async (subscriptionId) => {
      if (subscriptionId === `sub_${ids[0]}`) throw new Error("Provider unavailable");
      const id = subscriptionId.slice(4);
      return fromPartial<Awaited<ReturnType<PolarClient["subscriptions"]["get"]>>>({
        id: subscriptionId, customer_id: `cus_${id}`, product_id: "prod_new", status: "active",
        current_period_end: "2026-12-10T00:00:00Z", cancel_at_period_end: false, ends_at: null,
        modified_at: "2026-11-10T00:00:00Z", created_at: "2026-11-01T00:00:00Z", metadata: {},
        customer: { external_id: id === ids[1] ? "another-workspace" : id },
        product: { metadata: { plan_key: "agency:scale:monthly" } },
      });
    });
    expect(await reconcileBilling(db, polar, new Date("2026-11-11T00:00:00Z"))).toEqual({ checked: 3, applied: 1, failed: 2 });
    for (const id of ids.slice(0, 2)) expect((await getBillingAccount(db, id))?.servicesTier).toBe("solo");
    expect(await getBillingAccount(db, ids[2]!)).toMatchObject({ servicesTier: "agency", storeTier: "scale" });
  });
});
