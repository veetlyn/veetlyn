"use client";

import { type BillingInterval, formatOrderFee, NETWORK_FEE_BPS, PLANS, SELLER_PLANS } from "@jendal-workspace/core";
import { useState } from "react";

import { parsePriceInput } from "@/lib/money";
import { usd, usdCents } from "@/lib/site/examples";
import { type SaleSource, saleFees } from "@/lib/site/fees";

type Product = "services" | "store";

const PLAN_LISTS = { services: SELLER_PLANS, store: PLANS } as const;

// What Payleor would take on one sale, with the plan, the price and (for services) where the client came from.
export default function FeeCalculator({ product, interval }: { product: Product; interval: BillingInterval }) {
  const [planIndex, setPlanIndex] = useState({ services: 1, store: 1 });
  const [amount, setAmount] = useState({ services: "640", store: "36" });
  const [source, setSource] = useState<SaleSource>("network");

  const plans = PLAN_LISTS[product];
  const plan = plans[planIndex[product]] ?? plans[0];
  if (!plan) return null;
  const amountMinor = parsePriceInput(amount[product]) ?? 0;
  const fees =
    product === "services"
      ? saleFees({ kind: "services", planId: SELLER_PLANS[planIndex.services]?.id ?? "team", amountMinor, source })
      : saleFees({ kind: "store", planId: PLANS[planIndex.store]?.id ?? "grow", amountMinor, source: "own" });
  const fee = formatOrderFee(fees.feeBps);
  const note =
    product === "store"
      ? "PayPal's own fee is separate."
      : source === "network"
        ? `The next project with this client: ${fee} only.`
        : "Your own clients never pay the network fee.";

  return (
    <div className="receipt num" aria-live="polite">
      <label className="field">
        <span>Plan</span>
        <select
          value={planIndex[product]}
          onChange={(e) => setPlanIndex({ ...planIndex, [product]: Number(e.target.value) })}
        >
          {plans.map((p, i) => (
            <option key={p.id} value={i}>
              {p.name}, {usd(p.priceCents[interval])} a month
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{product === "store" ? "Order total" : "Project price"}</span>
        <span className="money">
          <span>$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={amount[product]}
            onChange={(e) => setAmount({ ...amount, [product]: e.target.value })}
          />
        </span>
      </label>
      {product === "services" && (
        <div className="switch" role="group" aria-label="Where the client came from">
          <button type="button" aria-pressed={source === "own"} onClick={() => setSource("own")}>
            Your own client
          </button>
          <button type="button" aria-pressed={source === "network"} onClick={() => setSource("network")}>
            Found through AI
          </button>
        </div>
      )}
      <div>
        <p className="row">
          <span>
            {fee} {product === "store" ? "order" : "payment"} fee
          </span>
          <span>{usdCents(fees.feeMinor)}</span>
        </p>
        {product === "services" && (
          <p className="row">
            <span>{formatOrderFee(NETWORK_FEE_BPS)} network fee, first project</span>
            <span>{usdCents(fees.networkMinor)}</span>
          </p>
        )}
        <p className="row sum">
          <span>Payleor</span>
          <span>{usdCents(fees.totalMinor)}</span>
        </p>
      </div>
      <p className="next">{note}</p>
    </div>
  );
}
