"use client";

import { type BillingInterval, formatOrderFee, formatPlanPrice, PLANS, TRIAL_DAYS } from "@jendal-workspace/core";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Check } from "lucide-react";
import { useState } from "react";

const INTERVALS: Array<{ id: BillingInterval; label: string }> = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly · save about 25%" },
];

export default function Pricing({ signupUrl }: { signupUrl: string }) {
  const [billing, setBilling] = useState<BillingInterval>("monthly");

  return (
    <div className="space-y-8">
      <div role="group" aria-label="Commerce billing period" className="mx-auto flex w-fit border p-1">
        {INTERVALS.map((interval) => (
          <button
            key={interval.id}
            type="button"
            aria-pressed={billing === interval.id}
            onClick={() => setBilling(interval.id)}
            className="px-4 py-1.5 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {interval.label}
          </button>
        ))}
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <li key={plan.id} className="flex flex-col panel p-6">
            <h4 className="text-lg font-semibold">{plan.name}</h4>
            <p className="mt-4">
              <span className="text-4xl font-semibold tabular-nums">{formatPlanPrice(plan.priceCents[billing])}</span>
              <span className="text-muted-foreground"> /month</span>
            </p>
            <p className="mt-1 min-h-5 text-sm text-muted-foreground">
              {billing === "yearly" ? `Billed yearly at ${formatPlanPrice(plan.priceCents.yearly * 12)}` : "Billed monthly"}
            </p>
            <p className="mt-3 text-sm font-medium">+ {formatOrderFee(plan.orderFeeBps)} per order</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {plan.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {highlight}
                </li>
              ))}
            </ul>
            <a href={signupUrl} className={`${buttonVariants({ size: "lg" })} mt-6 w-full`}>
              Start free trial
            </a>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm text-muted-foreground">{TRIAL_DAYS}-day free trial. No setup fee.</p>
    </div>
  );
}
