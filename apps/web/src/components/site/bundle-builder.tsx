"use client";

import {
  type BillingInterval,
  bundleQuote,
  formatOrderFee,
  PLANS,
  type PlanId,
  SELLER_PLANS,
  type SellerPlanId,
} from "@jendal-workspace/core";
import { useState } from "react";

import { usd, usdCents } from "@/lib/site/examples";

// A services plan and a store plan together: the dearer one in full, the other at half price, and the lower fee.
export default function BundleBuilder({ interval = "monthly" }: { interval?: BillingInterval }) {
  const [servicesId, setServicesId] = useState<SellerPlanId>("team");
  const [storeId, setStoreId] = useState<PlanId>("grow");
  const services = SELLER_PLANS.find((p) => p.id === servicesId) ?? SELLER_PLANS[0];
  const store = PLANS.find((p) => p.id === storeId) ?? PLANS[0];
  if (!services || !store) return null;
  const q = bundleQuote(services, store, interval);
  const lines = [
    { name: services.name, halved: q.discountedProduct === "services", cents: services.priceCents[interval] },
    { name: store.name, halved: q.discountedProduct === "store", cents: store.priceCents[interval] },
  ];
  return (
    <div className="receipt num" aria-live="polite">
      <p className="head">Your bundle</p>
      <label className="field">
        <span>Services plan</span>
        <select value={servicesId} onChange={(e) => setServicesId(sellerPlanId(e.target.value))}>
          {SELLER_PLANS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {usd(p.priceCents[interval])} a month
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Store plan</span>
        <select value={storeId} onChange={(e) => setStoreId(storePlanId(e.target.value))}>
          {PLANS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {usd(p.priceCents[interval])} a month
            </option>
          ))}
        </select>
      </label>
      <div>
        {lines.map((l) => (
          <p key={l.name} className="row">
            <span>
              {l.name}
              {l.halved ? ", half price" : ""}
            </span>
            <span>{usdCents(l.halved ? q.discountedCents : l.cents)}</span>
          </p>
        ))}
        <p className="row sum">
          <span>A month</span>
          <span>{usdCents(q.totalCents)}</span>
        </p>
      </div>
      <p className="next">Every payment and order pays {formatOrderFee(q.feeBps)}, the lower fee.</p>
    </div>
  );
}

const sellerPlanId = (v: string): SellerPlanId => SELLER_PLANS.find((p) => p.id === v)?.id ?? "team";
const storePlanId = (v: string): PlanId => PLANS.find((p) => p.id === v)?.id ?? "grow";
