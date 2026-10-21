import type { BillingInterval } from "./plans";

export type SellerAudience = "freelancer" | "team";
export type SellerPlanId = "solo" | "team" | "agency";

export type SellerPlan = {
  id: SellerPlanId;
  name: string;
  audience: SellerAudience;
  // US cents per month. The yearly price is billed once a year as 12 times this amount.
  priceCents: Record<BillingInterval, number>;
  // The platform's fee on each client payment and store order in basis points, taken as PayPal platform_fees.
  feeBps: number;
  members: number;
  storageGb: number;
  aiDraftsPerMonth: number;
  customDomain: boolean;
  hideBadge: boolean;
  payoutAgent: boolean;
  publicApi: boolean;
  prioritySupport: boolean;
  highlights: readonly string[];
};

// Charged once, on the first project with a client who found the seller through an AI agent.
export const NETWORK_FEE_BPS = 500;

export const SELLER_PLANS: readonly SellerPlan[] = [
  {
    id: "solo",
    name: "Solo",
    audience: "freelancer",
    priceCents: { monthly: 1900, yearly: 1600 },
    feeBps: 100,
    members: 1,
    storageGb: 5,
    aiDraftsPerMonth: 50,
    customDomain: false,
    hideBadge: false,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: false,
    highlights: ["1 person", "Your own seller page", "Client pay pages and deliveries", "Listed in the seller network"],
  },
  {
    id: "team",
    name: "Team",
    audience: "team",
    priceCents: { monthly: 5900, yearly: 4900 },
    feeBps: 50,
    members: 10,
    storageGb: 50,
    aiDraftsPerMonth: 300,
    customDomain: true,
    hideBadge: true,
    payoutAgent: false,
    publicApi: true,
    prioritySupport: false,
    highlights: ["Up to 10 members", "Member payouts by approval or by rule", "Your own domain", "Discord and the public API"],
  },
  {
    id: "agency",
    name: "Agency",
    audience: "team",
    priceCents: { monthly: 19900, yearly: 16600 },
    feeBps: 25,
    members: 50,
    storageGb: 500,
    aiDraftsPerMonth: 1500,
    customDomain: true,
    hideBadge: true,
    payoutAgent: true,
    publicApi: true,
    prioritySupport: true,
    highlights: ["Up to 50 members", "Automatic payouts and a second approver", "Several services teams", "Priority support"],
  },
];

export function getSellerPlan(id: SellerPlanId): SellerPlan {
  const plan = SELLER_PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown seller plan: ${id}`);
  return plan;
}

// Until billing ships the plan follows the seller's shape: a solo seller is on Solo,
// a team on Team. Run 8 replaces this with the plan the seller subscribed to.
export function sellerPlanFor(team: { id: string; solo?: boolean }): SellerPlan {
  return getSellerPlan(team.solo ? "solo" : "team");
}
