import {
  getPlan,
  getSellerPlan,
  formatOrderFee,
  formatPlanPrice,
  NETWORK_FEE_BPS,
  type PlanId,
  PLANS,
  platformFeeMinor,
  SELLER_PLANS,
  type SellerPlanId,
} from "@jendal-workspace/core";

const allFees = [...SELLER_PLANS.map((p) => p.feeBps), ...PLANS.map((p) => p.orderFeeBps)];

// The figures the site's summaries quote ("plans from $12 a month, 0.25 to 2% per payment or order"), read from
// the plans so a price change in core changes every page.
export const PRICE_FACTS = {
  from: formatPlanPrice(Math.min(...SELLER_PLANS.map((p) => p.priceCents.monthly), ...PLANS.map((p) => p.priceCents.monthly))),
  minFee: formatOrderFee(Math.min(...allFees)),
  maxFee: formatOrderFee(Math.max(...allFees)),
  network: formatOrderFee(NETWORK_FEE_BPS),
} as const;

export type SaleSource = "own" | "network";

export type Sale =
  | { kind: "services"; planId: SellerPlanId; amountMinor: number; source: SaleSource }
  | { kind: "store"; planId: PlanId; amountMinor: number; source: SaleSource };

export type SaleFees = { feeBps: number; feeMinor: number; networkMinor: number; totalMinor: number };

// What Payleor takes on one sale, with the same rounding the ledger uses. The network fee applies to a services
// client's first project only; store orders never carry it until that is decided.
export function saleFees(sale: Sale): SaleFees {
  const feeBps = sale.kind === "services" ? getSellerPlan(sale.planId).feeBps : getPlan(sale.planId).orderFeeBps;
  if (sale.amountMinor <= 0) return { feeBps, feeMinor: 0, networkMinor: 0, totalMinor: 0 };
  const feeMinor = platformFeeMinor(sale.amountMinor, feeBps);
  const networkMinor =
    sale.kind === "services" && sale.source === "network" ? platformFeeMinor(sale.amountMinor, NETWORK_FEE_BPS) : 0;
  return { feeBps, feeMinor, networkMinor, totalMinor: feeMinor + networkMinor };
}

// Every plan as a schema.org Offer: the monthly price and the fee it charges, for the pricing page's structured data.
export function pricingOffers() {
  const offer = (name: string, priceCents: number, fee: string) => ({
    "@type": "Offer" as const,
    name,
    price: (priceCents / 100).toFixed(2),
    priceCurrency: "USD",
    description: `A month, ${fee}`,
  });
  return [
    ...SELLER_PLANS.map((p) => offer(p.name, p.priceCents.monthly, `${formatOrderFee(p.feeBps)} on each client payment`)),
    ...PLANS.map((p) => offer(p.name, p.priceCents.monthly, `${formatOrderFee(p.orderFeeBps)} on each order`)),
  ];
}
