import { bundleQuote } from "./bundles";
import { type BillingInterval, getPlan, type Plan, type PlanId } from "./plans";
import { getSellerPlan, type SellerPlan, type SellerPlanId } from "./seller-plans";

// Billing design (platform/plans/2026-11-02-billing-polar.md §4): one pure answer to "what may this workspace do,
// and at what fee", from its billing account and the time. Every fee and limit check reads it.

// Days a workspace keeps selling after its trial ends without checkout, or after a renewal fails.
export const GRACE_DAYS = 2;
const DAY_MS = 86_400_000;
const BYTES_PER_GB = 1_000_000_000;

export type PolarSubscriptionStatus = "incomplete" | "incomplete_expired" | "trialing" | "active" | "past_due" | "canceled" | "unpaid";

export type BillingSubscription = {
  status: PolarSubscriptionStatus;
  pastDueAt: Date | null;
  cancelAtPeriodEnd: boolean;
  endsAt: Date | null;
};

export type BillingAccountSnapshot = {
  servicesTier: SellerPlanId | null;
  storeTier: PlanId | null;
  interval: BillingInterval;
  trialEndsAt: Date;
  // Null until the first checkout; then Polar's subscription as last received.
  subscription: BillingSubscription | null;
};

export type BillingState = "trial" | "active" | "grace" | "lapsed";

export type PlanLimits = {
  members: number;
  servicesTeams: number;
  stores: number;
  staffSeats: number;
  storageBytes: number;
  aiDraftsPerMonth: number;
  payoutAgent: boolean;
  hideBadge: boolean;
  customDomain: boolean;
  publicApi: boolean;
};

export type Entitlements = {
  state: BillingState;
  // New client payments and store orders; paid work, deliveries and refunds continue whatever the state.
  canSell: boolean;
  graceEndsAt: Date | null;
  services: SellerPlan | null;
  store: Plan | null;
  // Basis points on each client payment and store order; null when the workspace has no plan for that product.
  servicesFeeBps: number | null;
  storeFeeBps: number | null;
  limits: PlanLimits;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

type StateResult = { state: BillingState; graceEndsAt: Date | null };

function stateOf(account: BillingAccountSnapshot, now: Date): StateResult {
  const sub = account.subscription;
  const graceAfter = (start: Date): StateResult => {
    const end = addDays(start, GRACE_DAYS);
    return now < end ? { state: "grace", graceEndsAt: end } : { state: "lapsed", graceEndsAt: null };
  };
  const live = (s: BillingSubscription) => !s.cancelAtPeriodEnd || !s.endsAt || now < s.endsAt;

  if (!sub || sub.status === "incomplete" || sub.status === "incomplete_expired") {
    if (now < account.trialEndsAt) return { state: "trial", graceEndsAt: null };
    return graceAfter(account.trialEndsAt);
  }
  switch (sub.status) {
    case "active":
    case "trialing":
      return live(sub) ? { state: "active", graceEndsAt: null } : { state: "lapsed", graceEndsAt: null };
    case "past_due":
      return sub.pastDueAt ? graceAfter(sub.pastDueAt) : { state: "lapsed", graceEndsAt: null };
    case "canceled":
      return sub.endsAt && now < sub.endsAt ? { state: "active", graceEndsAt: null } : { state: "lapsed", graceEndsAt: null };
    case "unpaid":
      return { state: "lapsed", graceEndsAt: null };
  }
}

function limitsOf(services: SellerPlan | null, store: Plan | null): PlanLimits {
  return {
    members: services?.members ?? 0,
    servicesTeams: services?.servicesTeams ?? 0,
    stores: store ? 1 : 0,
    staffSeats: store?.staffSeats ?? 0,
    storageBytes: Math.max(services?.storageGb ?? 0, store?.storageGb ?? 0) * BYTES_PER_GB,
    aiDraftsPerMonth: services?.aiDraftsPerMonth ?? 0,
    payoutAgent: services?.payoutAgent ?? false,
    hideBadge: (services?.hideBadge ?? false) || (store?.hideBadge ?? false),
    customDomain: (services?.customDomain ?? false) || (store?.customDomain ?? false),
    publicApi: services?.publicApi ?? false,
  };
}

export function entitlementsFor(account: BillingAccountSnapshot, now: Date): Entitlements {
  const services = account.servicesTier ? getSellerPlan(account.servicesTier) : null;
  const store = account.storeTier ? getPlan(account.storeTier) : null;
  const { state, graceEndsAt } = stateOf(account, now);
  const bundleFee = services && store ? bundleQuote(services, store, account.interval).feeBps : null;
  return {
    state,
    canSell: state !== "lapsed",
    graceEndsAt,
    services,
    store,
    servicesFeeBps: services ? (bundleFee ?? services.feeBps) : null,
    storeFeeBps: store ? (bundleFee ?? store.orderFeeBps) : null,
    limits: limitsOf(services, store),
  };
}
