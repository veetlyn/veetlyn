import { describe, expect, it } from "vitest";

import { type BillingAccountSnapshot, entitlementsFor } from "./entitlements";

const DAY = 86_400_000;
const now = new Date("2026-11-10T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

function account(overrides: Partial<BillingAccountSnapshot> = {}): BillingAccountSnapshot {
  return { servicesTier: "team", storeTier: null, interval: "monthly", trialEndsAt: at(5), subscription: null, ...overrides };
}
const subscription = (overrides: Partial<NonNullable<BillingAccountSnapshot["subscription"]>> = {}) => ({
  status: "active" as const,
  pastDueAt: null,
  cancelAtPeriodEnd: false,
  endsAt: null,
  ...overrides,
});

describe("billing state", () => {
  it.each([
    ["in the trial", account(), "trial", true, null],
    ["in the 2 days after a trial without checkout", account({ trialEndsAt: at(-1) }), "grace", true, at(1)],
    ["once those 2 days are over", account({ trialEndsAt: at(-2) }), "lapsed", false, null],
    ["subscribed", account({ trialEndsAt: at(-30), subscription: subscription() }), "active", true, null],
    ["in a Polar trial", account({ subscription: subscription({ status: "trialing" }) }), "active", true, null],
    [
      "canceled at period end, period still running",
      account({ trialEndsAt: at(-30), subscription: subscription({ cancelAtPeriodEnd: true, endsAt: at(3) }) }),
      "active",
      true,
      null,
    ],
    [
      "canceled at period end, period over",
      account({ trialEndsAt: at(-30), subscription: subscription({ cancelAtPeriodEnd: true, endsAt: at(-1) }) }),
      "lapsed",
      false,
      null,
    ],
    [
      "past due within 2 days",
      account({ trialEndsAt: at(-30), subscription: subscription({ status: "past_due", pastDueAt: at(-1.5) }) }),
      "grace",
      true,
      at(0.5),
    ],
    [
      "past due beyond 2 days",
      account({ trialEndsAt: at(-30), subscription: subscription({ status: "past_due", pastDueAt: at(-2) }) }),
      "lapsed",
      false,
      null,
    ],
    ["revoked", account({ trialEndsAt: at(-30), subscription: subscription({ status: "canceled", endsAt: at(-1) }) }), "lapsed", false, null],
    ["unpaid", account({ trialEndsAt: at(-30), subscription: subscription({ status: "unpaid" }) }), "lapsed", false, null],
    ["paused", account({ subscription: subscription({ status: "paused" }) }), "lapsed", false, null],
    // A subscription replaces the trial: an unfinished first checkout does not keep the trial alive past its end.
    ["checkout incomplete after the trial", account({ trialEndsAt: at(-3), subscription: subscription({ status: "incomplete" }) }), "lapsed", false, null],
  ])("%s", (_name, snapshot, state, canSell, graceEndsAt) => {
    const result = entitlementsFor(snapshot, now);
    expect({ state: result.state, canSell: result.canSell, graceEndsAt: result.graceEndsAt }).toEqual({ state, canSell, graceEndsAt });
  });
});

describe("fees", () => {
  it("charges each product its own plan's fee", () => {
    expect(entitlementsFor(account({ servicesTier: "solo" }), now)).toMatchObject({ servicesFeeBps: 100, storeFeeBps: null });
    expect(entitlementsFor(account({ servicesTier: null, storeTier: "grow" }), now)).toMatchObject({ servicesFeeBps: null, storeFeeBps: 100 });
  });

  it("charges every payment and order the lower fee in a bundle", () => {
    expect(entitlementsFor(account({ servicesTier: "solo", storeTier: "scale" }), now)).toMatchObject({ servicesFeeBps: 50, storeFeeBps: 50 });
  });
});

describe("limits", () => {
  it("takes services limits from the services plan and gives none for a missing product", () => {
    expect(entitlementsFor(account({ servicesTier: "agency" }), now).limits).toEqual({
      members: 50,
      servicesTeams: 5,
      stores: 0,
      staffSeats: 0,
      storageBytes: 500_000_000_000,
      aiDraftsPerMonth: 1500,
      payoutAgent: true,
      hideBadge: true,
      customDomain: true,
      publicApi: true,
    });
  });

  it("combines a bundle's limits: one store, the larger storage, either plan's badge and domain", () => {
    expect(entitlementsFor(account({ servicesTier: "solo", storeTier: "grow" }), now).limits).toMatchObject({
      members: 1,
      servicesTeams: 1,
      stores: 1,
      staffSeats: 5,
      storageBytes: 50_000_000_000,
      hideBadge: true,
      customDomain: true,
      payoutAgent: false,
    });
  });
});
