"use client";

import { type BillingInterval, NETWORK_FEE_BPS, SELLER_PLANS, TRIAL_DAYS } from "@jendal-workspace/core";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Label } from "@jendal-workspace/ui/components/label";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useState } from "react";

const INTERVALS = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly, 2 months free" },
] as const satisfies ReadonlyArray<{ id: BillingInterval; label: string }>;

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(
    cents / 100,
  );
const percent = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
// Basis points of an amount in cents, rounded half up once, as the payment code does.
const feeOf = (cents: number, bps: number) => Math.round((cents * bps) / 10_000);

const lowestFee = Math.min(...SELLER_PLANS.map((plan) => plan.feeBps));
const highestFee = Math.max(...SELLER_PLANS.map((plan) => plan.feeBps));

export default function ServicesPricing({ signupUrl }: { signupUrl: string }) {
  const [billing, setBilling] = useState<BillingInterval>("monthly");
  const [planId, setPlanId] = useState("team");
  const [amount, setAmount] = useState("2000");
  const [source, setSource] = useState<"own" | "network">("own");

  const plan = SELLER_PLANS.find((p) => p.id === planId) ?? SELLER_PLANS[0];
  const parsed = Number(amount);
  const amountCents = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
  const paymentFee = plan ? feeOf(amountCents, plan.feeBps) : 0;
  const networkFee = source === "network" ? feeOf(amountCents, NETWORK_FEE_BPS) : 0;

  return (
    <div className="space-y-14">
      <div className="max-w-2xl space-y-3">
        <p className="font-heading text-3xl text-balance">One plan. A small fee on payments. Nothing on clients you bring yourself.</p>
        <p className="text-muted-foreground">
          Pay a flat monthly plan for your team and a small fee on client payments that run through Payleor. When Payleor's
          network finds you a new client, you pay a one-time fee on that first project. That's all of it.
        </p>
      </div>

      <dl className="grid gap-6 sm:grid-cols-3">
        {[
          ["Plan", "A flat monthly price", "Sized by how many people are on your team. Change or cancel any time."],
          [
            `${percent(lowestFee)}–${percent(highestFee)}`,
            "On each client payment",
            "Deposits, balances and amendments paid through Payleor. Lower on bigger plans.",
          ],
          [
            percent(NETWORK_FEE_BPS),
            "Only on new clients we find you",
            "Once, on the first project with a client who came through Claude, ChatGPT or another AI agent.",
          ],
        ].map(([big, title, body]) => (
          <div key={title} className="grid content-start gap-1.5 border-t border-foreground pt-4">
            <dt className="font-heading font-tabular text-2xl">{big}</dt>
            <dd className="font-medium">{title}</dd>
            <dd className="text-sm text-muted-foreground">{body}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="services-plans-heading" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h4 id="services-plans-heading" className="font-heading text-xl">
              Plans
            </h4>
            <p className="text-sm text-muted-foreground">
              Every plan includes projects, quotes, deliveries, client pay pages, your seller page and data export.
            </p>
          </div>
          <div role="group" aria-label="Services billing period" className="well flex w-fit rounded-[10px] bg-tray p-0.5">
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
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {SELLER_PLANS.map((p) => {
            const featured = p.id === "team";
            return (
              <li key={p.id} className={cn("panel flex flex-col gap-5 p-6", featured && "border-foreground")}>
                <div>
                  <p className="font-heading text-lg">{p.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {p.audience === "freelancer" ? "For one freelancer" : `For teams up to ${p.members} people`}
                  </p>
                </div>
                <div>
                  <p>
                    <span className="font-heading font-tabular text-4xl">{usd(p.priceCents[billing])}</span>
                    <span className="text-muted-foreground"> a month</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {billing === "yearly" ? `Billed ${usd(p.priceCents.yearly * 12)} a year` : "Billed monthly"}
                  </p>
                </div>
                <p className="border-y py-3">
                  <span className="font-tabular text-lg font-semibold">{percent(p.feeBps)}</span>
                  <span className="text-sm text-muted-foreground"> on each client payment</span>
                </p>
                <ul className="flex-1 space-y-2 text-sm">
                  {p.highlights.map((item) => (
                    <li key={item} className="flex gap-2.5">
                      <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-[2px] bg-brand" />
                      {item}
                    </li>
                  ))}
                </ul>
                <a href={signupUrl} className={cn(buttonVariants({ size: "lg", variant: featured ? "default" : "outline" }), "w-full")}>
                  Start {TRIAL_DAYS}-day trial
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="network-heading" className="panel grid gap-6 p-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:p-8">
        <div className="space-y-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">The Payleor network</p>
          <h4 id="network-heading" className="font-heading text-2xl">
            Your clients stay yours. We charge only when we bring you one.
          </h4>
          <p className="text-sm text-muted-foreground">
            Your services are listed where people now ask for help: Claude, ChatGPT and other AI agents. When a new client
            finds you there and pays, Payleor takes {percent(NETWORK_FEE_BPS)} of that first project. Every project after that
            with the same client costs only your plan's payment fee.
          </p>
        </div>
        <ol className="space-y-3 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">A client asks an AI agent</span> for a logo, a site or an audit, and
            finds your service.
          </li>
          <li>
            <span className="font-medium text-foreground">They request a quote and pay</span> through Payleor. The{" "}
            {percent(NETWORK_FEE_BPS)} applies to this first project only.
          </li>
          <li>
            <span className="font-medium text-foreground">From the next project on</span>, they are your client. No network
            fee again.
          </li>
        </ol>
      </section>

      <section aria-labelledby="fee-calculator-heading" className="space-y-5">
        <div className="space-y-1">
          <h4 id="fee-calculator-heading" className="font-heading text-xl">
            What you'd pay on a project
          </h4>
          <p className="text-sm text-muted-foreground">Pick a plan, an amount and where the client came from.</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <form className="panel grid content-start gap-4 p-6" onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-2">
              <Label htmlFor="fee-plan">Plan</Label>
              <select id="fee-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className={nativeSelectClass}>
                {SELLER_PLANS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fee-amount">Project price (USD)</Label>
              <input
                id="fee-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step={50}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={nativeSelectClass}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fee-source">Where the client came from</Label>
              <select
                id="fee-source"
                value={source}
                onChange={(e) => setSource(e.target.value === "network" ? "network" : "own")}
                className={nativeSelectClass}
              >
                <option value="own">My own client</option>
                <option value="network">Found me through an AI agent (first project)</option>
              </select>
            </div>
          </form>
          <div className="panel grid content-start gap-4 p-6" aria-live="polite">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-0 gap-y-2.5 text-sm">
              <dt className="pr-4 text-muted-foreground">Project price</dt>
              <dd className="text-right font-tabular">{usd(amountCents)}</dd>
              <dt className="pr-4 text-muted-foreground">Payment fee</dt>
              <dd className="text-right font-tabular">
                {usd(paymentFee)} ({plan ? percent(plan.feeBps) : ""})
              </dd>
              <dt className="pr-4 text-muted-foreground">Network fee</dt>
              <dd className="text-right font-tabular">
                {source === "network" ? `${usd(networkFee)} (${percent(NETWORK_FEE_BPS)}, first project only)` : "None, your own client"}
              </dd>
              <dt className="border-t pt-3 pr-4 font-semibold">Payleor's total</dt>
              <dd className="border-t pt-3 text-right font-tabular font-semibold">{usd(paymentFee + networkFee)}</dd>
            </dl>
            <p className="text-sm text-muted-foreground">
              PayPal's own processing fee is separate. PayPal shows it to you and takes it; Payleor never adds to it.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="optional-heading" className="space-y-5">
        <h4 id="optional-heading" className="font-heading text-xl">
          Optional
        </h4>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-2 rounded-[10px] border p-6">
            <p className="text-xs font-medium text-brand-text">Add-on · $29 a month</p>
            <p className="font-heading text-lg">AI visibility</p>
            <p className="text-sm text-muted-foreground">
              Keeps your services easy for AI agents and search engines to read: a clean catalog feed, structured data and the
              files AI crawlers look for. A monthly report shows how often agents showed your services and how many became
              quote requests. We report what happened; we don't promise rankings.
            </p>
          </div>
          <div className="grid content-start gap-2 rounded-[10px] border p-6">
            <p className="text-xs font-medium text-muted-foreground">Planned for 2027</p>
            <p className="font-heading text-lg">Self-hosted</p>
            <p className="text-sm text-muted-foreground">
              Run Payleor on your own servers with a yearly licence. Your self-hosted install still joins the network, so
              agents can find you, and payments still run through PayPal with the same fees.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
