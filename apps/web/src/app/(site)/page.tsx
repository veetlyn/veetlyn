import { env } from "cloudflare:workers";
import type { Metadata } from "next";

import Board from "@/components/landing/board";
import Channels from "@/components/landing/channels";
import FaqCards from "@/components/landing/faq-cards";
import Hero from "@/components/landing/hero";
import MoneyPath from "@/components/landing/money-path";
import NameBand from "@/components/landing/name-band";
import PlansStep from "@/components/landing/plans-step";
import RevealRoot from "@/components/landing/reveal-root";
import RulesDeck from "@/components/landing/rules-deck";
import StartCta from "@/components/landing/start-cta";
import { getPlatformOrigins, getStoreUrlParts } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

export const metadata: Metadata = {
  title: "Payleor: quote, get paid, pay your team",
  description:
    "Payleor runs the money around client work: quotes, client payments through PayPal and every freelancer's payout. Sell services or products, on the web and in Claude and ChatGPT.",
};

export default async function LandingPage() {
  const [{ dash }, urlParts] = await Promise.all([getPlatformOrigins(), getStoreUrlParts()]);
  const signupUrl = `${dash}/signup`;
  const demoUrl = env.DEMO_STORE_SLUG ? storeUrl(env.DEMO_STORE_SLUG, urlParts) : null;

  return (
    <RevealRoot>
      <main className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Hero signupUrl={signupUrl} loginUrl={`${dash}/login`} demoUrl={demoUrl} />
        <MoneyPath />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-y-24 pt-24 md:gap-y-40 md:pt-40">
          <Board />
          <Channels />
          <RulesDeck />
          <PlansStep signupUrl={signupUrl} />
          <FaqCards />
          <StartCta signupUrl={signupUrl} />
        </div>
        <NameBand />
      </main>
    </RevealRoot>
  );
}
