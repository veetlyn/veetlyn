"use client";

import { bundleQuote, type PlanId, PLANS, SELLER_PLANS, type SellerPlanId } from "@jendal-workspace/core";
import { Label } from "@jendal-workspace/ui/components/label";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { useState } from "react";

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(
    cents / 100,
  );
const percent = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export default function BundlePricing() {
  const [servicesId, setServicesId] = useState<SellerPlanId>("team");
  const [storeId, setStoreId] = useState<PlanId>("grow");
  const services = SELLER_PLANS.find((p) => p.id === servicesId) ?? SELLER_PLANS[0];
  const store = PLANS.find((p) => p.id === storeId) ?? PLANS[0];
  if (!services || !store) return null;

  const monthly = bundleQuote(services, store, "monthly");
  const yearly = bundleQuote(services, store, "yearly");
  const halved = monthly.discountedProduct === "store" ? store.name : services.name;

  return (
    <div className="panel grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:p-8">
      <div className="space-y-3">
        <p className="font-heading text-2xl text-balance">Run both, and the smaller plan is half price.</p>
        <p className="text-sm text-muted-foreground">
          A workspace with a services team and a store pays the dearer plan in full and the other at half. Every client
          payment and store order then takes the lower of the two fees.
        </p>
        <div className="grid gap-4 pt-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="bundle-services">Services plan</Label>
            <select
              id="bundle-services"
              value={servicesId}
              onChange={(e) => setServicesId(SELLER_PLANS.find((p) => p.id === e.target.value)?.id ?? "team")}
              className={nativeSelectClass}
            >
              {SELLER_PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bundle-store">Store plan</Label>
            <select
              id="bundle-store"
              value={storeId}
              onChange={(e) => setStoreId(PLANS.find((p) => p.id === e.target.value)?.id ?? "grow")}
              className={nativeSelectClass}
            >
              {PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <dl className="grid content-start grid-cols-[minmax(0,1fr)_auto] gap-x-0 gap-y-2.5 text-sm" aria-live="polite">
        <dt className="pr-4 text-muted-foreground">
          {services.name} and {store.name}, separately
        </dt>
        <dd className="text-right font-tabular text-muted-foreground line-through">
          {usd(services.priceCents.monthly + store.priceCents.monthly)}
        </dd>
        <dt className="pr-4 text-muted-foreground">{halved} at half price</dt>
        <dd className="text-right font-tabular">−{usd(monthly.savedCents)}</dd>
        <dt className="border-t pt-3 pr-4 font-semibold">Together, a month</dt>
        <dd className="border-t pt-3 text-right font-heading font-tabular text-2xl">{usd(monthly.totalCents)}</dd>
        <dt className="pr-4 text-muted-foreground">Billed yearly, a month</dt>
        <dd className="text-right font-tabular">{usd(yearly.totalCents)}</dd>
        <dt className="pr-4 text-muted-foreground">Fee on every payment and order</dt>
        <dd className="text-right font-tabular font-semibold">{percent(monthly.feeBps)}</dd>
      </dl>
    </div>
  );
}
