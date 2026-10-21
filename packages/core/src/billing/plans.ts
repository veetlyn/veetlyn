import type { StoreRecord } from "../tenancy/store";

export type PlanId = "starter" | "grow" | "scale";
export type BillingInterval = "monthly" | "yearly";

export type Plan = {
  id: PlanId;
  name: string;
  // US cents per month. The yearly price is billed once a year as 12 times this amount.
  priceCents: Record<BillingInterval, number>;
  // The platform's fee on each order in basis points (100 = 1%), taken through PayPal's partner fee.
  orderFeeBps: number;
  staffSeats: number;
  customDomain: boolean;
  adminAgent: boolean;
  disputeAgent: boolean;
  highlights: readonly string[];
};

export const TRIAL_DAYS = 14;

export const PLANS: readonly Plan[] = [
  {
    id: "starter",
    name: "Starter",
    priceCents: { monthly: 1200, yearly: 900 },
    orderFeeBps: 200,
    staffSeats: 2,
    customDomain: false,
    adminAgent: false,
    disputeAgent: false,
    highlights: [
      "Storefront",
      "ChatGPT and Claude plugins",
      "AI shopper protocols",
      "Shopping agent",
      "2 staff accounts",
      "AI credits",
    ],
  },
  {
    id: "grow",
    name: "Grow",
    priceCents: { monthly: 3900, yearly: 2900 },
    orderFeeBps: 100,
    staffSeats: 5,
    customDomain: true,
    adminAgent: true,
    disputeAgent: true,
    highlights: ["Everything in Starter", "Custom domain", "Admin agent", "Dispute agent", "5 staff accounts", "More AI credits"],
  },
  {
    id: "scale",
    name: "Scale",
    priceCents: { monthly: 12900, yearly: 9900 },
    orderFeeBps: 50,
    staffSeats: 15,
    customDomain: true,
    adminAgent: true,
    disputeAgent: true,
    highlights: ["Everything in Grow", "15 staff accounts", "Priority support", "The most AI credits"],
  },
];

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

// Until billing ships (parent spec §6.7, Nov 2–8), every store is on Starter and the trial is not enforced.
export function planFor(_store: Pick<StoreRecord, "id">): Plan {
  return getPlan("starter");
}

export function formatOrderFee(bps: number): string {
  return `${bps / 100}%`;
}

export function formatPlanPrice(cents: number): string {
  return `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;
}
