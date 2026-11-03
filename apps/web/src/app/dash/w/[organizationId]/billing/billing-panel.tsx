"use client";

import {
  BILLING_PRODUCTS,
  type BillingInterval,
  formatOrderFee,
  PLANS,
  type PlanId,
  polarProductKey,
  SELLER_PLANS,
  type SellerPlanId,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Label } from "@jendal-workspace/ui/components/label";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { usdCents } from "@/lib/site/examples";
import { trpc } from "@/utils/trpc";

type BillingView = inferRouterOutputs<AppRouter>["billing"]["get"];

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

const TONE = { muted: "text-muted-foreground", warn: "text-amber-700 dark:text-amber-400", problem: "text-destructive" } as const;
type StatusLine = { text: string; tone: keyof typeof TONE };

function statusLine(view: BillingView): StatusLine {
  const { state, graceEndsAt } = view.entitlements;
  if (state === "trial") return { text: `Free trial until ${day(view.trialEndsAt)}. No card needed until then.`, tone: "muted" };
  if (state === "grace") {
    const by = graceEndsAt ? day(graceEndsAt) : "soon";
    return view.subscribed
      ? { text: `Your last payment failed. Update your card by ${by} to keep selling.`, tone: "warn" }
      : { text: `Your trial has ended. Choose a plan by ${by} to keep selling.`, tone: "warn" };
  }
  if (state === "lapsed") {
    return { text: "Selling is paused: clients cannot pay and shoppers cannot buy. Paid work, deliveries and refunds continue.", tone: "problem" };
  }
  if (view.cancelAtPeriodEnd && view.currentPeriodEnd) return { text: `Cancelled. Selling stops on ${day(view.currentPeriodEnd)}.`, tone: "warn" };
  return { text: view.currentPeriodEnd ? `Renews on ${day(view.currentPeriodEnd)}.` : "Active.", tone: "muted" };
}

// Billing design §7: the workspace's plans, its state, and the one action that moves it forward.
export default function BillingPanel({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const checkoutId = useSearchParams().get("checkout");
  const billing = useQuery(trpc.billing.get.queryOptions({ organizationId }));
  const pending = useQuery({
    ...trpc.billing.pendingChange.queryOptions({ organizationId }),
    enabled: Boolean(billing.data?.subscribed && billing.data.configured),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.billing.pathKey() });

  // Back from Polar's checkout: apply it now rather than wait for the webhook, then drop the parameter.
  const sync = useMutation(trpc.billing.syncCheckout.mutationOptions({ onSettled: () => void refresh() }));
  const synced = useRef(false);
  useEffect(() => {
    if (!checkoutId || synced.current) return;
    synced.current = true;
    sync.mutate({ organizationId, checkoutId });
    router.replace(`/w/${organizationId}/billing`);
  }, [checkoutId, organizationId, router, sync]);

  const go = (result: { url: string }) => window.location.assign(result.url);
  const checkout = useMutation(trpc.billing.startCheckout.mutationOptions({ onSuccess: go, onError: (e) => toast.error(e.message) }));
  const portal = useMutation(trpc.billing.portalUrl.mutationOptions({ onSuccess: go, onError: (e) => toast.error(e.message) }));
  const change = useMutation(
    trpc.billing.changePlan.mutationOptions({
      onSuccess: ({ timing, appliesAt }) => {
        toast.success(timing === "prorate" ? "Plan changed." : `Plan change scheduled for ${appliesAt ? day(appliesAt) : "your next renewal"}.`);
        void refresh();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const [servicesTier, setServicesTier] = useState<SellerPlanId | null | undefined>(undefined);
  const [storeTier, setStoreTier] = useState<PlanId | null | undefined>(undefined);
  const [interval, setBillingInterval] = useState<BillingInterval | undefined>(undefined);

  if (billing.isLoading) return <Loader />;
  if (billing.error || !billing.data) return <p className="text-sm text-destructive">{billing.error?.message ?? "Billing is unavailable."}</p>;
  const view = billing.data;
  const choice = {
    servicesTier: servicesTier === undefined ? view.choice.servicesTier : servicesTier,
    storeTier: storeTier === undefined ? view.choice.storeTier : storeTier,
    interval: interval ?? view.choice.interval,
  };
  const product = BILLING_PRODUCTS.find((p) => p.key === polarProductKey(choice));
  const unchanged = view.subscribed && polarProductKey(choice) === polarProductKey(view.choice);
  const status = statusLine(view);
  const { entitlements } = view;
  const busy = checkout.isPending || change.isPending || portal.isPending || sync.isPending;

  return (
    <div className="space-y-6">
      <section className="panel space-y-2 p-5">
        <h2 className="font-medium">Current plan</h2>
        <p>
          {[entitlements.services?.name, entitlements.store?.name].filter(Boolean).join(" + ") || "No plan"}
          <span className="text-muted-foreground"> · {view.choice.interval === "yearly" ? "billed yearly" : "billed monthly"}</span>
        </p>
        {entitlements.servicesFeeBps !== null || entitlements.storeFeeBps !== null ? (
          <p className="text-sm text-muted-foreground">
            Platform fee: {formatOrderFee(entitlements.servicesFeeBps ?? entitlements.storeFeeBps ?? 0)} of each payment
          </p>
        ) : null}
        <p className={`text-sm ${TONE[status.tone]}`} role={status.tone === "muted" ? undefined : "status"}>
          {status.text}
        </p>
        {pending.data?.choice ? (
          <p className="text-sm text-muted-foreground">
            Changes to{" "}
            {[
              SELLER_PLANS.find((p) => p.id === pending.data?.choice?.servicesTier)?.name,
              PLANS.find((p) => p.id === pending.data?.choice?.storeTier)?.name,
            ]
              .filter(Boolean)
              .join(" + ")}{" "}
            on{" "}
            {day(pending.data.appliesAt)}.
          </p>
        ) : null}
      </section>

      <section className="panel grid gap-4 p-5">
        <h2 className="font-medium">{view.subscribed ? "Change plan" : "Choose a plan"}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="billing-services">Services</Label>
            <select
              id="billing-services"
              className={nativeSelectClass}
              value={choice.servicesTier ?? ""}
              onChange={(e) => setServicesTier(SELLER_PLANS.find((p) => p.id === e.target.value)?.id ?? null)}
            >
              <option value="">None</option>
              {SELLER_PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-store">Store</Label>
            <select
              id="billing-store"
              className={nativeSelectClass}
              value={choice.storeTier ?? ""}
              onChange={(e) => setStoreTier(PLANS.find((p) => p.id === e.target.value)?.id ?? null)}
            >
              <option value="">None</option>
              {PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-interval">Billing</Label>
            <select
              id="billing-interval"
              className={nativeSelectClass}
              value={choice.interval}
              onChange={(e) => setBillingInterval(e.target.value === "yearly" ? "yearly" : "monthly")}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        </div>
        <p className="num text-sm" aria-live="polite">
          {product ? `${usdCents(product.chargeCents)} ${choice.interval === "yearly" ? "a year" : "a month"}` : "Choose at least one plan."}
        </p>
        {!view.configured ? <p className="text-sm text-muted-foreground">Billing is not set up on this server yet.</p> : null}
        <div className="flex flex-wrap gap-2">
          {view.subscribed ? (
            <>
              <Button disabled={!product || unchanged || busy || !view.configured} onClick={() => change.mutate({ organizationId, ...choice })}>
                {change.isPending ? "Changing…" : "Change plan"}
              </Button>
              <Button variant="outline" disabled={busy || !view.configured} onClick={() => portal.mutate({ organizationId })}>
                Manage billing
              </Button>
            </>
          ) : (
            <Button disabled={!product || busy || !view.configured} onClick={() => checkout.mutate({ organizationId, ...choice })}>
              {checkout.isPending ? "Opening checkout…" : "Continue to payment"}
            </Button>
          )}
        </div>
        {view.subscribed ? (
          <p className="text-xs text-muted-foreground">
            Upgrades apply now and are prorated. Downgrades take effect at your next renewal.
          </p>
        ) : null}
      </section>
    </div>
  );
}
