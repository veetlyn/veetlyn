import type { Metadata } from "next";

import BundlePricing from "@/components/site/bundle-pricing";
import Pricing from "@/components/site/pricing";
import ServicesPricing from "@/components/site/services-pricing";
import { getPlatformOrigins } from "@/lib/server-api";

export const metadata: Metadata = {
  title: "Pricing · Payleor",
  description:
    "One plan, a small fee on client payments, and nothing on clients you bring yourself. Store plans and a bundle for teams that run both.",
};

export default async function PricingPage() {
  const { dash } = await getPlatformOrigins();
  const signupUrl = `${dash}/signup`;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-20 px-4 py-16 md:px-7 md:py-24">
      <h1 className="font-heading text-[clamp(40px,5vw,72px)] leading-[1]">Pricing</h1>

      <section aria-labelledby="services-pricing-heading" className="space-y-6">
        <h2 id="services-pricing-heading" className="font-heading text-2xl">
          Services teams
        </h2>
        <ServicesPricing signupUrl={signupUrl} />
      </section>

      <section aria-labelledby="commerce-pricing-heading" className="space-y-6">
        <div>
          <h2 id="commerce-pricing-heading" className="font-heading text-2xl">
            Stores
          </h2>
          <p className="mt-1 text-muted-foreground">One plan per store. Pay monthly or yearly. The order fee drops as you grow.</p>
        </div>
        <Pricing signupUrl={signupUrl} />
      </section>

      <section aria-labelledby="bundle-pricing-heading" className="space-y-6">
        <h2 id="bundle-pricing-heading" className="font-heading text-2xl">
          Using both
        </h2>
        <BundlePricing />
      </section>

      <p className="text-center text-sm text-muted-foreground">
        PayPal's processing fees apply and are charged by PayPal; their rate varies by country.
      </p>
    </main>
  );
}
