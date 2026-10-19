"use client";

import { type BillingInterval, formatOrderFee, formatPlanPrice, PLANS, TRIAL_DAYS } from "@jendal-workspace/core";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useState } from "react";

const INTERVALS: Array<{ id: BillingInterval; label: string }> = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly · save about 25%" },
];

export default function Pricing({ signupUrl }: { signupUrl: string }) {
  const [billing, setBilling] = useState<BillingInterval>("monthly");

  return (
    <div className="space-y-8">
      <div role="group" aria-label="Commerce billing period" className="well mx-auto flex w-fit rounded-[10px] bg-tray p-0.5">
        {INTERVALS.map((interval) => (
          <button
            key={interval.id}
            type="button"
            aria-pressed={billing === interval.id}
            onClick={() => setBilling(interval.id)}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-[0_0_0_1px_var(--input),var(--raise)]"
          >
            {interval.label}
          </button>
        ))}
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <li key={plan.id} className={cn("panel flex flex-col p-6", plan.id === "grow" && "border-foreground")}>
            <h4 className="font-heading text-lg">{plan.name}</h4>
            <p className="mt-4">
              <span className="font-heading font-tabular text-4xl">{formatPlanPrice(plan.priceCents[billing])}</span>
              <span className="text-muted-foreground"> a month</span>
            </p>
            <p className="mt-1 min-h-5 text-sm text-muted-foreground">
              {billing === "yearly" ? `Billed yearly at ${formatPlanPrice(plan.priceCents.yearly * 12)}` : "Billed monthly"}
            </p>
            <p className="mt-3 text-sm font-medium">+ {formatOrderFee(plan.orderFeeBps)} per order</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {plan.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-[2px] bg-brand" />
                  {highlight}
                </li>
              ))}
            </ul>
            <a href={signupUrl} className={cn(buttonVariants({ size: "lg", variant: plan.id === "grow" ? "default" : "outline" }), "mt-6 w-full")}>
              Start free trial
            </a>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm text-muted-foreground">{TRIAL_DAYS}-day free trial. No setup fee.</p>
    </div>
  );
}
