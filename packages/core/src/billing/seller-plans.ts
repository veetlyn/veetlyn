import type { BillingInterval } from "./plans";

export type SellerAudience = "freelancer" | "team";
export type SellerPlanId = "solo" | "pro" | "premium" | "team" | "studio" | "agency";

export type SellerPlan = {
  id: SellerPlanId;
  name: string;
  audience: SellerAudience;
  // US cents per month. The yearly price is billed once a year as 12 times this amount.
  priceCents: Record<BillingInterval, number>;
  // Payleor's fee on each client payment and store order in basis points, taken as PayPal platform_fees.
  feeBps: number;
  members: number;
  storageGb: number;
  aiDraftsPerMonth: number;
  customDomain: boolean;
  hideBadge: boolean;
  payoutAgent: boolean;
  publicApi: boolean;
  prioritySupport: boolean;
};

export const SELLER_PLANS: readonly SellerPlan[] = [
  {
    id: "solo",
    name: "Solo",
    audience: "freelancer",
    priceCents: { monthly: 900, yearly: 700 },
    feeBps: 200,
    members: 1,
    storageGb: 2,
    aiDraftsPerMonth: 20,
    customDomain: false,
    hideBadge: false,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: false,
  },
  {
    id: "pro",
    name: "Pro",
    audience: "freelancer",
    priceCents: { monthly: 2400, yearly: 1800 },
    feeBps: 100,
    members: 1,
    storageGb: 20,
    aiDraftsPerMonth: 100,
    customDomain: true,
    hideBadge: true,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: false,
  },
  {
    id: "premium",
    name: "Premium",
    audience: "freelancer",
    priceCents: { monthly: 5900, yearly: 4500 },
    feeBps: 50,
    members: 1,
    storageGb: 100,
    aiDraftsPerMonth: 300,
    customDomain: true,
    hideBadge: true,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: true,
  },
  {
    id: "team",
    name: "Team",
    audience: "team",
    priceCents: { monthly: 3900, yearly: 2900 },
    feeBps: 100,
    members: 5,
    storageGb: 50,
    aiDraftsPerMonth: 200,
    customDomain: true,
    hideBadge: true,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: false,
  },
  {
    id: "studio",
    name: "Studio",
    audience: "team",
    priceCents: { monthly: 9900, yearly: 7500 },
    feeBps: 50,
    members: 15,
    storageGb: 200,
    aiDraftsPerMonth: 500,
    customDomain: true,
    hideBadge: true,
    payoutAgent: true,
    publicApi: true,
    prioritySupport: false,
  },
  {
    id: "agency",
    name: "Agency",
    audience: "team",
    priceCents: { monthly: 24900, yearly: 18900 },
    feeBps: 25,
    members: 50,
    storageGb: 500,
    aiDraftsPerMonth: 1500,
    customDomain: true,
    hideBadge: true,
    payoutAgent: true,
    publicApi: true,
    prioritySupport: true,
  },
];

export function getSellerPlan(id: SellerPlanId): SellerPlan {
  const plan = SELLER_PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown seller plan: ${id}`);
  return plan;
}

// Until billing ships (pricing proposal §6), every services team is on Team. Sellers who work alone
// move to Solo once the "Just me" setting exists.
export function sellerPlanFor(_team: { id: string }): SellerPlan {
  return getSellerPlan("team");
}
