import type { BillingInterval, Plan } from "./plans";
import type { SellerPlan } from "./seller-plans";

export type BundleQuote = {
  // US cents per month for the given interval.
  fullCents: number;
  discountedCents: number;
  totalCents: number;
  savedCents: number;
  // The fee every payment and order in the workspace takes: the lower of the two plans' fees.
  feeBps: number;
  discountedProduct: "services" | "store";
};

// A workspace that runs a services team and a store pays the dearer plan in full and the other at half price.
// On a tie the store plan is the one halved.
export function bundleQuote(services: SellerPlan, store: Plan, interval: BillingInterval): BundleQuote {
  const servicesCents = services.priceCents[interval];
  const storeCents = store.priceCents[interval];
  const discountedProduct = servicesCents >= storeCents ? "store" : "services";
  const fullCents = Math.max(servicesCents, storeCents);
  const halved = Math.min(servicesCents, storeCents);
  const discountedCents = Math.round(halved / 2);
  return {
    fullCents,
    discountedCents,
    totalCents: fullCents + discountedCents,
    savedCents: halved - discountedCents,
    feeBps: Math.min(services.feeBps, store.orderFeeBps),
    discountedProduct,
  };
}
