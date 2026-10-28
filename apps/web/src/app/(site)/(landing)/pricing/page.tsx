import { signupDestination } from "@/lib/launch";
import { TRIAL_DAYS } from "@jendal-workspace/core";
import Link from "next/link";

import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import PricingExplorer from "@/components/site/pricing-explorer";
import { pricingFaq } from "@/content/site/faqs";
import { platformSite } from "@/lib/platform";
import { getPlatformOrigins } from "@/lib/server-api";
import { PRICE_FACTS, pricingOffers } from "@/lib/site/fees";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/pricing",
    title: `${site.name} pricing`,
    description: `${site.name} pricing: a plan from ${PRICE_FACTS.from} a month, ${PRICE_FACTS.minFee.replace("%", "")} to ${PRICE_FACTS.maxFee} per payment or order, and ${PRICE_FACTS.network} once only on clients AI brings you. Services, stores, both or Enterprise.`,
    site,
  });
}

export default async function PricingPage() {
  const site = platformSite();
  const { name } = site;
  const faq = pricingFaq(name);
  const { dash } = await getPlatformOrigins();
  const signup = signupDestination(dash);
  return (
    <>
      <JsonLd
        data={graph(
          organization(site),
          breadcrumbs([["Pricing", "/pricing"]], site),
          {
            "@type": "SoftwareApplication",
            name,
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            offers: pricingOffers(),
          },
          faqStructuredData(faq),
        )}
      />
      <div className="band">
        <div className="wrap hero page solo">
          <div>
            <h1 data-in>Pricing for everything you sell</h1>
            <p className="lead" data-in>Your clients stay yours. We charge only when we bring you one: {PRICE_FACTS.network} once, on the first project.</p>
          </div>
        </div>
      </div>
      <div>
        <PricingExplorer signupUrl={signup} />
        <section aria-labelledby="net-h">
          <div className="wrap">
            <h2 id="net-h" data-in>{name} Network: {PRICE_FACTS.network}, once</h2>
            <div className="features">
              <div className="feature agent" data-in><p className="tag">1</p><h3>A client asks an AI agent</h3><p>For a logo, a site or a pedicure, and finds you.</p></div>
              <div className="feature agent" data-in><p className="tag">2</p><h3>They pay through {name}</h3><p>The {PRICE_FACTS.network} applies to this first project only.</p></div>
              <div className="feature" data-in><p className="tag">3</p><h3>Then they are your client</h3><p>No network fee on any project after that.</p></div>
            </div>
          </div>
        </section>
        <section aria-labelledby="add-h">
          <div className="wrap">
            <h2 id="add-h" data-in>Getting found</h2>
            <div className="addons">
              <article className="addon" data-in><p className="kind">Coming soon to every plan</p><h3>Web SEO</h3><p>Structured data on every offer, a sitemap and an llms.txt, AI crawlers allowed, fast pages, and a listing on Discover and {name} Network. <Link className="link" href="/visibility">Get found</Link></p></article>
              <article className="addon" data-in><p className="kind">Network members · Waitlist</p><h3>AI visibility</h3><p>An agent tracks what ChatGPT, Claude, Perplexity and Gemini say about you, drafts articles and fixes for your approval, and reports weekly. We never promise rankings.</p></article>
              <article className="addon later" data-in><p className="kind">Planned for 2027</p><h3>Self-hosted</h3><p>Run {name} on your own servers with a yearly licence. You stay in the network, payments still run through PayPal, with the same fees.</p></article>
            </div>
          </div>
        </section>
        <section aria-labelledby="inc-h">
          <div className="wrap">
            <h2 id="inc-h" data-in>Every plan includes our terms</h2>
            <ul className="includes" data-in>
              <li>We never hold your money</li>
              <li>The payer approves every payment</li>
              <li>Each share is paid once</li>
              <li>Every fee shows before you confirm</li>
              <li>Export everything, any time (coming soon)</li>
              <li>{TRIAL_DAYS} days free, no setup fee</li>
            </ul>
          </div>
        </section>
        <FaqList title="Pricing questions" items={faq} /><CloseCta />
      </div>
    </>
  );
}
