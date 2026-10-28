import { signupDestination } from "@/lib/launch";
import { formatOrderFee, getPlan } from "@jendal-workspace/core";
import Link from "next/link";

import ChatDemo from "@/components/site/chat-demo";
import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import PMark from "@/components/site/p-mark";
import Story from "@/components/site/story";
import { Tier } from "@/components/site/tiers";
import { storeFaq } from "@/content/site/faqs";
import { platformSite } from "@/lib/platform";
import { getPlatformOrigins } from "@/lib/server-api";
import { usdCents } from "@/lib/site/examples";
import { PRICE_FACTS, saleFees } from "@/lib/site/fees";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

const growFee = formatOrderFee(getPlan("grow").orderFeeBps);
const CLAY_ROOM_ORDER_MINOR = 2_900;
const clayRoomFee = saleFees({ kind: "store", planId: "grow", amountMinor: CLAY_ROOM_ORDER_MINOR, source: "network" });

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/stores",
    title: `${site.name} for stores`,
    description: `Sell courses and downloads from your own page, paid with PayPal and delivered at once. Inside Claude and ChatGPT soon, from ${PRICE_FACTS.from} a month.`,
    site,
  });
}

export default async function StoresPage() {
  const site = platformSite();
  const { name, storeDomain } = site;
  const faq = storeFaq(name);
  const { dash } = await getPlatformOrigins();
  const signup = signupDestination(dash);
  return (
    <>
      <JsonLd data={graph(organization(site), breadcrumbs([["Stores", "/stores"]], site), faqStructuredData(faq))} />
      <div className="band">
        <div className="wrap hero page">
          <div>
            <h1 data-in>Sell your courses and downloads</h1>
            <p className="lead" data-in>For creators and course sellers. Clients pay with PayPal on your page and get the file at once. Inside Claude and ChatGPT soon.</p>
            <div className="ctas" data-in>
              <Link className="btn btn-mint" href="/pricing">Start with Grow</Link>{" "}<a className="link" href="#story">See how it works</a>
            </div>
          </div>
          <ChatDemo
            label={`Coming soon: in ChatGPT, a client asks for a glazing course. ${name} Network shows Clay Room's course for $29, and the client buys it on Clay Room's page with PayPal.`}
            who="ChatGPT, coming soon"
            message="Find me a pottery glazing course."
          >
            <div className="widget frame" data-at="400">
              <p className="wtop"><PMark /><b>{name} Network</b> · Clay Room</p>
              <div className="wrow"><span><span className="t">Glazing course</span><br /><span className="s">Six videos and a PDF</span></span><span className="num t">$29</span><span className="act" data-press="2000" data-done="Paying">Buy</span></div>
            </div>
            <p className="reply frame" data-at="2900">Checkout opened on Clay Room's page. You approve the payment in PayPal.</p>
          </ChatDemo>
        </div>
      </div>
      <div>
        <section id="story" aria-labelledby="story-h">
          <div className="wrap">
            <h2 id="story-h" data-in>From your page to a download</h2>
            <Story>
              <div className="steps">
                <span className="rail" aria-hidden="true"><i></i></span>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">A client, on your page</p><h3>Picks the course</h3><p className="promise">One link for your bio.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">The client, in PayPal</p><h3>Pays</h3><p className="promise">The money goes into your PayPal.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Clay Room</p><h3>Sees the order</h3><p className="promise">Paid, with the buyer and the file sent.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">The client</p><h3>Gets the course at once</h3><p className="promise">Download links expire, so your files stay yours.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">{name}</p><h3>Takes {growFee}, nothing more</h3><p className="promise">On Grow. Every fee shows before you sell.</p></div>
              </div>
              <div className="pin">
                <div className="scene-stage">
                  <div className="scene on">
                    <div className="ui">
                      <p className="s">clayroom.{storeDomain}</p>
                      <div className="lines">
                        <p className="row num"><span>Glazing course · Download</span><span>$29.00</span></p>
                        <p className="row"><span className="muted">Six videos and a PDF</span><span>1.2 GB</span></p>
                      </div>
                      <span className="act">Buy</span>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="s">Pay Clay Room</p>
                      <p className="big num">$29.00</p>
                      <span className="act">Pay with PayPal</span>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="row"><span className="t">Order for Clay Room</span><span className="ok">Paid</span></p>
                      <div className="lines">
                        <p className="row num"><span className="muted">Glazing course</span><span>$29.00</span></p>
                        <p className="row"><span className="muted">Download link</span><span>Sent</span></p>
                      </div>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="row"><span className="t">Glazing course</span><span className="ok">Download ready</span></p>
                      <div className="lines">
                        <p className="row"><span className="muted">Six videos and a PDF</span><span>1.2 GB</span></p>
                        <p className="row"><span className="muted">Link</span><span>Time-limited</span></p>
                      </div>
                      <span className="act">Download</span>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="t" style={{ font: "600 22px/1.2 var(--site-display)" }}>Clay Room's order: {usdCents(CLAY_ROOM_ORDER_MINOR)}</p>
                      <div className="lines">
                        <p className="row num"><span className="muted">{name}, {growFee} on Grow</span><span>{usdCents(clayRoomFee.totalMinor)}</span></p>
                        <p className="row num"><span className="muted">PayPal's fee</span><span>Shown in PayPal</span></p>
                      </div>
                      <p className="s" style={{ marginTop: "12px" }}>Paid into Clay Room's own PayPal.</p>
                    </div>
                  </div>
                </div>
              </div>
            </Story>
          </div>
        </section>
        <section aria-labelledby="link-h">
          <div className="wrap everywhere">
            <div>
              <h2 id="link-h" data-in>One link for your bio and every chat</h2>
              <p className="lead-dark" data-in>Coming from Shopify, WooCommerce, Gumroad or a link-in-bio page? Add your products and sell them from one page. Inside AI soon.</p>
              <div className="chans" data-in><span>Your bio</span><span>A pay link</span><span>Claude and ChatGPT, soon</span></div>
            </div>
            <div className="phone" data-in role="img" aria-label={`Clay Room's page at clayroom.${storeDomain} with a mug, the glazing course and a serving bowl`}>
              <div className="screen">
                <span className="url">clayroom.{storeDomain}</span>
                <p className="shopname"><b>Clay Room</b><span className="s">Ceramics, Portland</span></p>
                <div className="tabs"><span className="on">All</span><span>Shop</span><span>Courses</span></div>
                <div className="ui" style={{ boxShadow: "none", background: "var(--background)", display: "grid", gap: "12px" }}>
                  <div className="item"><span className="thumb"></span><span><span className="t">Blue mug</span><br /><span className="s">Shipped</span></span><span className="num t">$18</span></div>
                  <div className="item"><span className="thumb b"></span><span><span className="t">Glazing course</span><br /><span className="s">Download</span></span><span className="num t">$29</span></div>
                  <div className="item"><span className="thumb c"></span><span><span className="t">Serving bowl</span><br /><span className="s">Shipped</span></span><span className="num t">$42</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section aria-labelledby="feat-h">
          <div className="wrap">
            <h2 id="feat-h" data-in>A store that sells inside AI</h2>
            <div className="features">
              <div className="feature agent" data-in><p className="tag">Agent <span className="soon">Coming soon</span></p><h3>Found by AI</h3><p>Through {name} Network, Claude and ChatGPT will find your products.</p></div>
              <div className="feature agent" data-in><p className="tag">Agent <span className="soon">Coming soon</span></p><h3>An admin agent</h3><p>On Grow and Scale, for your orders and catalog.</p></div>
              <div className="feature" data-in><p className="tag">PayPal</p><h3>PayPal checkout</h3><p>Clients pay on your page. The money goes into your PayPal.</p></div>
              <div className="feature" data-in><p className="tag">Digital</p><h3>Courses and downloads</h3><p>Files delivered at once, with expiring links.</p></div>
              <div className="feature" data-in><p className="tag">Shipping <span className="soon">Coming soon</span></p><h3>Shipped goods</h3><p>Physical products with shipping and tracking.</p></div>
              <div className="feature" data-in><p className="tag">Your page <span className="soon">Coming soon</span></p><h3>Your own domain</h3><p>On Grow and Scale. One link for your bio.</p></div>
            </div>
          </div>
        </section>
        <section aria-labelledby="plan-h">
          <div className="wrap">
            <h2 id="plan-h" data-in>Plans for stores</h2>
            <div className="tiers"><Tier id="starter" interval="monthly" signupUrl={signup} /> <Tier id="grow" interval="monthly" signupUrl={signup} /> <Tier id="scale" interval="monthly" signupUrl={signup} /> <Tier id="enterprise" interval="monthly" signupUrl={signup} /></div>
            <Link className="more" href="/pricing">Compare every plan</Link>
          </div>
        </section>
        <FaqList title="Questions from store owners" items={faq} /><CloseCta />
      </div>
    </>
  );
}
