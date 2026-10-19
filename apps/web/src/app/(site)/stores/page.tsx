import { formatOrderFee, getPlan } from "@jendal-workspace/core";
import Link from "next/link";

import ChatDemo from "@/components/site/chat-demo";
import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import PMark from "@/components/site/p-mark";
import Story from "@/components/site/story";
import { Tier } from "@/components/site/tiers";
import { STORE_FAQ } from "@/content/site/faqs";
import { getPlatformOrigins } from "@/lib/server-api";
import { usdCents } from "@/lib/site/examples";
import { PRICE_FACTS, saleFees } from "@/lib/site/fees";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

const growFee = formatOrderFee(getPlan("grow").orderFeeBps);
const CLAY_ROOM_ORDER_MINOR = 6_500;
const clayRoomFee = saleFees({ kind: "store", planId: "grow", amountMinor: CLAY_ROOM_ORDER_MINOR, source: "network" });

export const metadata = pageMetadata({
  path: "/stores",
  title: "Payleor for stores",
  description:
    `Sell in AI carts. Clients' AI fills one cart across Payleor stores and pays once with PayPal. Downloads, courses and shipped goods, from ${PRICE_FACTS.from} a month.`,
});

export default async function StoresPage() {
  const { dash } = await getPlatformOrigins();
  const signup = `${dash}/signup`;
  return (
    <>
      <JsonLd data={graph(organization(), breadcrumbs([["Stores", "/stores"]]), faqStructuredData(STORE_FAQ))} />
      <div className="band">
        <div className="wrap hero page">
          <div>
            <h1 data-in>Your products, in every AI cart</h1>
            <p className="lead" data-in>For store owners, creators and course sellers. Your clients' AI fills one cart across stores, and they pay once with PayPal.</p>
            <div className="ctas" data-in>
              <Link className="btn btn-mint" href="/pricing">Start with Grow</Link>{" "}<a className="link" href="#story">See how it works</a>
            </div>
          </div>
          <ChatDemo
            label="In ChatGPT, a client asks for two mugs, the glazing course and coffee beans. Payleor's cart shows items from Clay Room and Roast House, and the client checks out on Payleor."
            who="ChatGPT"
            message="Add two of those blue mugs, the glazing course and a bag of coffee."
          >
            <div className="widget frame" data-at="400">
              <p className="wtop"><PMark /><b>Payleor Network</b> · Cart, 2 stores</p>
              <div className="wrow"><span><span className="t">Two mugs</span><br /><span className="s">Clay Room · shipped</span></span><span className="num t">$36</span><span></span></div>
              <div className="wrow"><span><span className="t">Glazing course</span><br /><span className="s">Clay Room · download</span></span><span className="num t">$29</span><span></span></div>
              <div className="wrow"><span><span className="t">Coffee beans</span><br /><span className="s">Roast House · shipped</span></span><span className="num t">$24</span><span className="act" data-press="2000" data-done="Checking out">Check out</span></div>
            </div>
            <p className="reply frame" data-at="2900">Checkout opened on Payleor. You approve the payment in PayPal.</p>
          </ChatDemo>
        </div>
      </div>
      <main>
        <section id="story" aria-labelledby="story-h">
          <div className="wrap">
            <h2 id="story-h" data-in>From a chat to a shipped order</h2>
            <Story>
              <div className="steps">
                <span className="rail" aria-hidden="true"><i></i></span>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">ChatGPT, for a client</p><h3>Fills one cart from two stores</h3><p className="promise">The chat never takes the payment.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">The client, on Payleor</p><h3>Pays both stores at once</h3><p className="promise">One PayPal payment. Each store gets its part.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Clay Room</p><h3>Gets its own order</h3><p className="promise">PayPal collects the address.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">The client</p><h3>Gets the course at once</h3><p className="promise">Download links expire, so your files stay yours.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Payleor</p><h3>Takes {growFee}, nothing more</h3><p className="promise">On Grow. Every fee shows before you sell.</p></div>
              </div>
              <div className="pin">
                <div className="scene-stage">
                  <div className="scene on">
                    <div className="ui">
                      <p className="s">Cart, in ChatGPT</p>
                      <div className="lines">
                        <p className="row num"><span>Two mugs · Clay Room</span><span>$36.00</span></p>
                        <p className="row num"><span>Glazing course · Clay Room</span><span>$29.00</span></p>
                        <p className="row num"><span>Coffee beans · Roast House</span><span>$24.00</span></p>
                        <p className="row num sum"><span className="t">Two stores</span><span className="t">$89.00</span></p>
                      </div>
                      <span className="act">Check out on Payleor</span>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="s">Checkout on Payleor</p>
                      <p className="big num">$89.00</p>
                      <div className="lines">
                        <p className="row num"><span className="muted">Clay Room</span><span>$65.00</span></p>
                        <p className="row num"><span className="muted">Roast House</span><span>$24.00</span></p>
                      </div>
                      <span className="act">Pay with PayPal</span>
                      <p className="s" style={{ marginTop: "8px" }}>Shipping set by each store, shown in PayPal</p>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="row"><span className="t">Order for Clay Room</span><span className="ok">Paid</span></p>
                      <div className="lines">
                        <p className="row num"><span className="muted">Two mugs</span><span>$36.00</span></p>
                        <p className="row num"><span className="muted">Glazing course</span><span>$29.00</span></p>
                        <p className="row"><span className="muted">Ship to</span><span>Address from PayPal</span></p>
                      </div>
                      <span className="act ink">Add tracking</span>
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
                        <p className="row num"><span className="muted">Payleor, {growFee} on Grow</span><span>{usdCents(clayRoomFee.totalMinor)}</span></p>
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
              <p className="lead-dark" data-in>Coming from Shopify, WooCommerce, Gumroad or a link-in-bio page? Add your products and sell them inside AI too.</p>
              <div className="chans" data-in><span>Your bio</span><span>Claude</span><span>ChatGPT</span><span>Discord</span><span>A pay link</span></div>
            </div>
            <div className="phone" data-in role="img" aria-label="Clay Room's page at clayroom.payleor.app with a mug, the glazing course and a serving bowl">
              <div className="screen">
                <span className="url">clayroom.payleor.app</span>
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
              <div className="feature agent" data-in><p className="tag">Agent</p><h3>Sold in AI carts</h3><p>Through Payleor Network, Claude and ChatGPT add your products to a cart.</p></div>
              <div className="feature agent" data-in><p className="tag">Agent</p><h3>An admin agent</h3><p>On Grow and Scale, for your orders and catalog.</p></div>
              <div className="feature" data-in><p className="tag">PayPal</p><h3>One checkout, many stores</h3><p>One payment, split into one order per store.</p></div>
              <div className="feature" data-in><p className="tag">Digital</p><h3>Courses and downloads</h3><p>Files delivered at once, with expiring links.</p></div>
              <div className="feature" data-in><p className="tag">Shipping</p><h3>Flat shipping and tracking</h3><p>PayPal collects the address. You add tracking.</p></div>
              <div className="feature" data-in><p className="tag">Your page</p><h3>Your own domain</h3><p>On Grow and Scale. One link for your bio.</p></div>
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
        <FaqList title="Questions from store owners" items={STORE_FAQ} /><CloseCta />
      </main>
    </>
  );
}
