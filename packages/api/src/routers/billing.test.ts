import { createTestAuth } from "@jendal-workspace/auth/testing";
import { BILLING_PRODUCTS, createFakeFileStore } from "@jendal-workspace/core";
import { applySubscriptionSnapshot, ensureBillingAccount, getBillingAccount } from "@jendal-workspace/db/repositories/billing";
import { addMember, createTestDb, hasTestDatabase, seedOrganization, truncateAll } from "@jendal-workspace/db/testing/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPolarClient, type PolarClient } from "../billing/polar";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

type Subscription = Awaited<ReturnType<PolarClient["subscriptions"]["get"]>>;
type Checkout = Awaited<ReturnType<PolarClient["checkouts"]["get"]>>;
type Product = Awaited<ReturnType<PolarClient["products"]["get"]>>;

// The sandbox catalog as the sync leaves it: one product per key, at its price.
const PRODUCTS = BILLING_PRODUCTS.map((p) =>
  fromPartial<Product>({
    id: `prod_${p.key}`,
    metadata: { plan_key: p.key },
    recurring_interval: p.interval === "yearly" ? "year" : "month",
    prices: [fromPartial({ is_archived: false, amount_type: "fixed", price_currency: "usd", price_amount: p.chargeCents })],
  }),
);

async function* items<T>(list: T[]) {
  yield* list;
}

describe.skipIf(!hasTestDatabase)("billing router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  let polar: PolarClient;

  const callerFor = (userId: string, configured = true) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
      billing: configured ? { polar, dashOrigin: "http://dash.localhost:3001" } : undefined,
    });

  beforeEach(async () => {
    await truncateAll(db);
    polar = createPolarClient({ accessToken: "test-token", server: "sandbox" });
    vi.spyOn(polar.products, "iterList").mockImplementation(() => items(PRODUCTS));
    vi.spyOn(polar.subscriptions, "iterList").mockImplementation(() => items<Subscription>([]));
    vi.spyOn(polar.checkouts, "iterList").mockImplementation(() => items<Checkout>([]));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => db.$client.end());

  async function workspace() {
    const { userId, organizationId } = await seedOrganization(db);
    await ensureBillingAccount(db, { organizationId, product: "services", solo: false, now: new Date() });
    return { userId, organizationId };
  }

  function remote(organizationId: string, key: string): Subscription {
    return fromPartial<Subscription>({
      id: "sub_1", status: "active", customer_id: "cus_1", product_id: `prod_${key}`,
      current_period_end: "2026-12-10T00:00:00Z", cancel_at_period_end: false, ends_at: null,
      modified_at: "2026-11-10T00:00:00Z", created_at: "2026-11-01T00:00:00Z", metadata: {},
      customer: { external_id: organizationId }, product: { metadata: { plan_key: key } }, pending_update: null,
    });
  }

  async function subscribe(organizationId: string, key: string) {
    await applySubscriptionSnapshot(db, {
      organizationId, servicesTier: "team", storeTier: null, interval: "monthly", customerId: "cus_1",
      subscriptionId: "sub_1", productId: `prod_${key}`, status: "active", pastDueAt: null, currentPeriodEnd: null,
      cancelAtPeriodEnd: false, endsAt: null, modifiedAt: new Date("2026-11-01T00:00:00Z"),
    });
    vi.spyOn(polar.subscriptions, "get").mockResolvedValue(remote(organizationId, key));
  }

  it("lets only workspace owners and admins see or change billing, and says when Polar is not set up", async () => {
    const { userId, organizationId } = await workspace();
    const memberId = await addMember(db, { organizationId, role: "member" });
    await expect(callerFor(memberId).billing.get({ organizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerFor(userId).billing.get({ organizationId })).resolves.toMatchObject({
      choice: { servicesTier: "team", storeTier: null, interval: "monthly" },
      entitlements: { state: "trial", canSell: true },
      subscribed: false,
    });
    const choice = { organizationId, servicesTier: "team", storeTier: null, interval: "monthly" } as const;
    await expect(callerFor(userId, false).billing.startCheckout(choice)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("opens a checkout for the chosen plan only, reuses an open one, and refuses a workspace that already subscribed", async () => {
    const { userId, organizationId } = await workspace();
    const create = vi.spyOn(polar.checkouts, "create").mockResolvedValue(fromPartial<Checkout>({ url: "https://polar.test/new" }));
    const choice = { organizationId, servicesTier: "team", storeTier: "grow", interval: "yearly" } as const;

    await expect(callerFor(userId).billing.startCheckout(choice)).resolves.toEqual({ url: "https://polar.test/new" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      products: ["prod_team:grow:yearly"],
      external_customer_id: organizationId,
      allow_trial: false,
      success_url: `http://dash.localhost:3001/w/${organizationId}/billing?checkout={CHECKOUT_ID}`,
    }));

    // Polar ignores the workspace in this listing (no customer exists yet), so another workspace's checkout comes too.
    // A checkout offers one plan and cannot be switched, so only one for the same plan is reused.
    const open = fromPartial<Checkout>({
      id: "co_open", status: "open", expires_at: "2999-01-01T00:00:00Z", external_customer_id: organizationId,
      product_id: "prod_team:grow:yearly", url: "https://polar.test/open",
    });
    const otherPlan = fromPartial<Checkout>({
      id: "co_plan", status: "open", expires_at: "2999-01-01T00:00:00Z", external_customer_id: organizationId, product_id: "prod_solo:-:monthly",
    });
    const others = fromPartial<Checkout>({
      id: "co_other", status: "open", expires_at: "2999-01-01T00:00:00Z", external_customer_id: "another", product_id: "prod_team:grow:yearly",
    });
    const list = vi.spyOn(polar.checkouts, "iterList").mockImplementation(() => items([others, otherPlan, open]));
    const update = vi.spyOn(polar.checkouts, "update");
    await expect(callerFor(userId).billing.startCheckout(choice)).resolves.toEqual({ url: "https://polar.test/open" });
    expect(update).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ status: ["open", "confirmed"], limit: 100 });
    expect(create).toHaveBeenCalledTimes(1);

    // Polar is asked too: the checkout's webhook may not have arrived yet.
    vi.spyOn(polar.subscriptions, "iterList").mockImplementation(() => items([remote(organizationId, "team:-:monthly")]));
    await expect(callerFor(userId).billing.startCheckout(choice)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each([
    ["an upgrade applies now", "team:grow:monthly", { servicesTier: "agency", storeTier: "grow", interval: "monthly" }, "prorate"],
    ["monthly to yearly applies now", "team:-:monthly", { servicesTier: "team", storeTier: null, interval: "yearly" }, "prorate"],
    ["a lower plan waits for renewal", "agency:-:monthly", { servicesTier: "team", storeTier: null, interval: "monthly" }, "next_period"],
    ["dropping the store waits for renewal", "team:grow:monthly", { servicesTier: "team", storeTier: null, interval: "monthly" }, "next_period"],
    ["yearly to monthly waits for renewal", "team:-:yearly", { servicesTier: "team", storeTier: null, interval: "monthly" }, "next_period"],
    ["a mixed change waits for renewal", "agency:starter:monthly", { servicesTier: "solo", storeTier: "scale", interval: "monthly" }, "next_period"],
  ] as const)("changes plan: %s", async (_name, from, to, timing) => {
    const { userId, organizationId } = await workspace();
    await subscribe(organizationId, from);
    const update = vi.spyOn(polar.subscriptions, "update").mockResolvedValue(remote(organizationId, from));
    await expect(callerFor(userId).billing.changePlan({ organizationId, ...to })).resolves.toMatchObject({ timing });
    expect(update).toHaveBeenCalledWith("sub_1", {
      product_id: `prod_${to.servicesTier ?? "-"}:${to.storeTier ?? "-"}:${to.interval}`,
      proration_behavior: timing,
    });
    // The local row changes only from the webhook.
    expect((await getBillingAccount(db, organizationId))?.polarProductId).toBe(`prod_${from}`);
  });

  it("sends a workspace whose subscription ended back to checkout instead of a plan change", async () => {
    const { userId, organizationId } = await workspace();
    await subscribe(organizationId, "team:-:monthly");
    await applySubscriptionSnapshot(db, {
      organizationId, servicesTier: "team", storeTier: null, interval: "monthly", customerId: "cus_1", subscriptionId: "sub_1",
      productId: "prod_team:-:monthly", status: "canceled", pastDueAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: true,
      endsAt: new Date("2026-11-02T00:00:00Z"), modifiedAt: new Date("2026-11-02T00:00:00Z"),
    });
    await expect(callerFor(userId).billing.get({ organizationId })).resolves.toMatchObject({ subscribed: false, entitlements: { state: "lapsed" } });
    const update = vi.spyOn(polar.subscriptions, "update");
    await expect(
      callerFor(userId).billing.changePlan({ organizationId, servicesTier: "agency", storeTier: null, interval: "monthly" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "This subscription has ended. Choose a plan to subscribe again." });
    expect(update).not.toHaveBeenCalled();
    const create = vi.spyOn(polar.checkouts, "create").mockResolvedValue(fromPartial<Checkout>({ url: "https://polar.test/again" }));
    await expect(
      callerFor(userId).billing.startCheckout({ organizationId, servicesTier: "team", storeTier: null, interval: "monthly" }),
    ).resolves.toEqual({ url: "https://polar.test/again" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("answers a Polar failure with a plain message, never Polar's own text", async () => {
    const { userId, organizationId } = await workspace();
    vi.spyOn(polar.checkouts, "create").mockRejectedValue(new Error("Polar API returned an error: 422 - product_id not available"));
    await expect(
      callerFor(userId).billing.startCheckout({ organizationId, servicesTier: "team", storeTier: null, interval: "monthly" }),
    ).rejects.toMatchObject({ code: "BAD_GATEWAY", message: "Billing is unavailable right now. Try again in a moment." });
  });

  it("refuses a change to the current plan", async () => {
    const { userId, organizationId } = await workspace();
    await subscribe(organizationId, "team:-:monthly");
    const update = vi.spyOn(polar.subscriptions, "update");
    await expect(
      callerFor(userId).billing.changePlan({ organizationId, servicesTier: "team", storeTier: null, interval: "monthly" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(update).not.toHaveBeenCalled();
  });

  it("applies a finished checkout on return, and refuses another workspace's checkout", async () => {
    const { userId, organizationId } = await workspace();
    vi.spyOn(polar.checkouts, "get").mockResolvedValue(
      fromPartial<Checkout>({ external_customer_id: organizationId, status: "succeeded", subscription_id: "sub_1" }),
    );
    vi.spyOn(polar.subscriptions, "get").mockResolvedValue(remote(organizationId, "agency:scale:yearly"));
    await expect(callerFor(userId).billing.syncCheckout({ organizationId, checkoutId: "co_1" })).resolves.toEqual({ applied: true });
    expect(await getBillingAccount(db, organizationId)).toMatchObject({ servicesTier: "agency", storeTier: "scale", interval: "yearly" });

    const other = await workspace();
    await expect(callerFor(other.userId).billing.syncCheckout({ organizationId: other.organizationId, checkoutId: "co_1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
