import { bundleQuote } from "./bundles";
import { type BillingInterval, getPlan, PLANS, type PlanId } from "./plans";
import { getSellerPlan, SELLER_PLANS, type SellerPlanId } from "./seller-plans";

// Billing design §3: one Polar product per plan choice and interval. The key goes in the product's metadata, so the
// catalog sync finds its products and a webhook maps a subscription back to plans without asking Polar.

export type PlanChoice = { servicesTier: SellerPlanId | null; storeTier: PlanId | null; interval: BillingInterval };

export type BillingProduct = PlanChoice & {
  key: string;
  name: string;
  // What Polar charges each period: a month, or a whole year.
  chargeCents: number;
};

const NONE = "-";
const INTERVALS: readonly BillingInterval[] = ["monthly", "yearly"];

export function polarProductKey(choice: PlanChoice): string {
  return `${choice.servicesTier ?? NONE}:${choice.storeTier ?? NONE}:${choice.interval}`;
}

export function parsePolarProductKey(key: string): PlanChoice | null {
  const [services, store, interval, ...rest] = key.split(":");
  if (rest.length > 0 || !services || !store || !interval) return null;
  const servicesTier = services === NONE ? null : SELLER_PLANS.find((p) => p.id === services)?.id;
  const storeTier = store === NONE ? null : PLANS.find((p) => p.id === store)?.id;
  const knownInterval = INTERVALS.find((i) => i === interval);
  if (servicesTier === undefined || storeTier === undefined || !knownInterval) return null;
  if (servicesTier === null && storeTier === null) return null;
  return { servicesTier, storeTier, interval: knownInterval };
}

function monthlyCents(choice: PlanChoice): number {
  const services = choice.servicesTier ? getSellerPlan(choice.servicesTier) : null;
  const store = choice.storeTier ? getPlan(choice.storeTier) : null;
  if (services && store) return bundleQuote(services, store, choice.interval).totalCents;
  return (services ?? store)?.priceCents[choice.interval] ?? 0;
}

function productName(choice: PlanChoice): string {
  const names = [choice.servicesTier && getSellerPlan(choice.servicesTier).name, choice.storeTier && getPlan(choice.storeTier).name];
  return `${names.filter(Boolean).join(" + ")} (${choice.interval})`;
}

export const BILLING_PRODUCTS: readonly BillingProduct[] = INTERVALS.flatMap((interval) =>
  [null, ...SELLER_PLANS.map((p) => p.id)].flatMap((servicesTier) =>
    [null, ...PLANS.map((p) => p.id)].flatMap((storeTier): BillingProduct[] => {
      if (servicesTier === null && storeTier === null) return [];
      const choice = { servicesTier, storeTier, interval };
      const perMonth = monthlyCents(choice);
      return [{ ...choice, key: polarProductKey(choice), name: productName(choice), chargeCents: interval === "yearly" ? 12 * perMonth : perMonth }];
    }),
  ),
);
