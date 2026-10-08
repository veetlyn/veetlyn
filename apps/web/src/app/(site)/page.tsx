import { env } from "cloudflare:workers";
import { TRIAL_DAYS } from "@jendal-workspace/core";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { Bot, Briefcase, Check, Scale, Store, Wallet } from "lucide-react";
import type { Metadata } from "next";

import PayoutsPricing from "@/components/site/payouts-pricing";
import Pricing from "@/components/site/pricing";
import { getPlatformOrigins, getStoreUrlParts } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

export const metadata: Metadata = {
  title: "Payleor: stores and services teams, paid through PayPal",
  description:
    "Run a store that sells on the web, in ChatGPT and Claude, and to AI shoppers. Or run a services team with quotes, client payments and freelancer payouts. Payments go to your PayPal account.",
};

const PRODUCTS = [
  {
    id: "commerce",
    icon: Store,
    name: "Commerce",
    title: "Agentic stores",
    text: "One catalog, sold on your web storefront, in the ChatGPT and Claude plugins, and to AI shoppers.",
    points: [
      "A web storefront at your own address",
      "ChatGPT and Claude plugins",
      "AI shopper protocols: Store Sync, ACP, UCP and AP2",
      "A dispute agent that drafts your replies for you to approve",
      "Several stores per workspace, with staff access per store",
    ],
    cta: "Create your store",
  },
  {
    id: "payouts",
    icon: Briefcase,
    name: "Payouts",
    title: "Services teams",
    text: "For freelance teams that sell services. Follow each project from quote to final payment, and pay your freelancers from your own PayPal account.",
    points: [
      "Projects with quotes, amendments and deliveries",
      "Clients pay on a pay page, with no account to create",
      "Freelancer payouts by approval, by rule or automatically",
      "A public API and a Discord bot for your ticket channels",
      "Cases and disputes, with templates you set up",
    ],
    cta: "Get started",
  },
];

const STEPS = [
  { title: "Create your workspace", text: "Sign up, then add a store, a services team, or both." },
  { title: "Connect PayPal", text: "Link your PayPal business account. Buyers and clients pay you directly." },
  { title: "Get to work", text: "Sell on every channel, or send quotes and pay your freelancers." },
];

const PRINCIPLES = [
  {
    icon: Wallet,
    title: "Paid straight to you",
    text: "Payments land in your PayPal account. Payleor never holds your money.",
  },
  {
    icon: Bot,
    title: "Agents ask first",
    text: "Agents draft dispute replies and prepare payouts. None of them moves money without a rule you set or your confirmation.",
  },
  {
    icon: Scale,
    title: "One place for disputes",
    text: "Store disputes and services cases share one module, and PayPal disputes sync into it.",
  },
];

export default async function LandingPage() {
  const [{ admin }, urlParts] = await Promise.all([getPlatformOrigins(), getStoreUrlParts()]);
  const signupUrl = `${admin}/signup`;
  const demoUrl = env.DEMO_STORE_SLUG ? storeUrl(env.DEMO_STORE_SLUG, urlParts) : null;

  return (
    <main>
      <section className="container mx-auto max-w-5xl px-4 py-20 text-center sm:py-28">
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Sell products or services, and get paid through PayPal
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground text-pretty">
          A Payleor workspace has two products. Commerce gives you a store that sells to people and to AI shoppers.
          Payouts runs a services team: quotes, client payments and what you owe each freelancer. Use one or both.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <a href={signupUrl} className={buttonVariants({ size: "lg" })}>
            Get started
          </a>
          <a href="#pricing" className={buttonVariants({ size: "lg", variant: "outline" })}>
            See pricing
          </a>
          {demoUrl ? (
            <a href={demoUrl} className={buttonVariants({ size: "lg", variant: "outline" })}>
              See the demo store
            </a>
          ) : null}
        </div>
      </section>

      <section id="products" aria-labelledby="products-heading" className="scroll-mt-16 border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="products-heading" className="text-2xl font-semibold tracking-tight">
            Two products, one workspace
          </h2>
          <ul className="mt-8 grid gap-6 md:grid-cols-2">
            {PRODUCTS.map((product) => (
              <li key={product.id} aria-labelledby={`${product.id}-heading`} className="flex flex-col border p-6">
                <product.icon aria-hidden className="size-5" />
                <p className="mt-4 text-sm font-medium text-muted-foreground">{product.name}</p>
                <h3 id={`${product.id}-heading`} className="text-xl font-semibold">
                  {product.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{product.text}</p>
                <ul className="mt-6 flex-1 space-y-2 text-sm">
                  {product.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <a href={signupUrl} className={`${buttonVariants({ variant: "outline" })} mt-6 self-start`}>
                  {product.cta}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <p className="text-sm font-medium text-muted-foreground tabular-nums">Step {index + 1}</p>
                <h3 className="mt-1 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="principles-heading" className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="principles-heading" className="text-2xl font-semibold tracking-tight">
            Your money, your rules
          </h2>
          <ul className="mt-8 grid gap-8 md:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <li key={principle.title} className="flex gap-4">
                <principle.icon aria-hidden className="mt-0.5 size-5 shrink-0" />
                <div>
                  <h3 className="font-semibold">{principle.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{principle.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-16 border-t">
        <div className="container mx-auto max-w-5xl space-y-16 px-4 py-16">
          <div className="text-center">
            <h2 id="pricing-heading" className="text-2xl font-semibold tracking-tight">
              Pricing
            </h2>
            <p className="mt-2 text-muted-foreground">Each product has its own plan and fees. Pay only for what you use.</p>
          </div>

          <section aria-labelledby="commerce-pricing-heading" className="space-y-6">
            <div>
              <h3 id="commerce-pricing-heading" className="text-xl font-semibold">
                Commerce
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                One plan per store. Pay monthly or yearly. The order fee drops as you grow.
              </p>
            </div>
            <Pricing signupUrl={signupUrl} />
          </section>

          <section aria-labelledby="payouts-pricing-heading" className="space-y-6">
            <div>
              <h3 id="payouts-pricing-heading" className="text-xl font-semibold">
                Payouts
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">A fee on each client payment, plus a plan.</p>
            </div>
            <PayoutsPricing signupUrl={signupUrl} />
          </section>

          <div className="space-y-2 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Using both? Bundles of both products are coming.</p>
            <p>PayPal's processing fees apply and are charged by PayPal; their rate varies by country.</p>
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Start with one product. Add the other when you need it.</h2>
          <p className="mt-2 text-muted-foreground">Commerce plans start with a {TRIAL_DAYS}-day free trial. No setup fee.</p>
          <a href={signupUrl} className={`${buttonVariants({ size: "lg" })} mt-6`}>
            Get started
          </a>
        </div>
      </section>
    </main>
  );
}
