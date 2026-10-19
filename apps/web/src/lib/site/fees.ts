import {
  type BillingInterval,
  bundleQuote,
  getPlan,
  getSellerPlan,
  NETWORK_FEE_BPS,
  type PlanId,
  platformFeeMinor,
  type SellerPlanId,
} from "@jendal-workspace/core";

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

export function bundleMonthly(services: SellerPlanId, store: PlanId, interval: BillingInterval) {
  const q = bundleQuote(getSellerPlan(services), getPlan(store), interval);
  return { totalCents: q.totalCents, halved: q.discountedProduct, feeBps: q.feeBps };
}
