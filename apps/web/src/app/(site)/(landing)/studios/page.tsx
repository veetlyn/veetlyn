import { depositDue } from "@jendal-workspace/core";
import Link from "next/link";

import BundleBuilder from "@/components/site/bundle-builder";
import ChatDemo from "@/components/site/chat-demo";
import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import PMark from "@/components/site/p-mark";
import Split from "@/components/site/split";
import Story from "@/components/site/story";
import { STUDIO_FAQ } from "@/content/site/faqs";
import { platformSite } from "@/lib/platform";
import { studioExample, usd, usdCents } from "@/lib/site/examples";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

const ines = studioExample();
const pedicureDeposit = depositDue(ines.priceMinor, 0).quotePartMinor;

function Week({ name }: { name: string }) {
  const inesSplit = [
    { label: "Inès", minor: ines.staffMinor, tone: "brand" },
    { label: "Maison Lune", minor: ines.salonMinor, tone: "ink" },
    { label: "PayPal", minor: ines.paypalMinor, tone: "paypal" },
    { label: name, minor: ines.platformMinor, tone: "platform" },
  ] as const;
  return (
    <section id="week" aria-labelledby="week-h">
      <div className="wrap">
        <h2 id="week-h" data-in>A week at Maison Lune</h2>
        <Story>
          <div className="steps">
            <span className="rail" aria-hidden="true"><i></i></span>
            <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Claude, for a client</p><h3>Finds the pedicure</h3><p className="promise">Gets the purchase ready for checkout.</p></div>
            <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Your intake agent</p><h3>Drafts the pedicure quote</h3><p className="promise">Nothing goes out until you confirm.</p></div>
            <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">The client, in PayPal</p><h3>Pays the deposit</h3><p className="promise">It lands in your PayPal. We never hold it.</p></div>
            <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Your payout rules</p><h3>Pay Inès her share</h3><p className="promise">Each share is sent once.</p></div>
            <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Your copilot</p><h3>Sums up the week</h3><p className="promise">It reads your books. It changes nothing.</p></div>
          </div>
          <div className="pin">
            <div className="scene-stage">
              <div className="scene on">
                <div className="ui">
                  <p className="s">Maison Lune, in Claude</p>
                  <div className="lines">
                    <p className="row num"><span>Pedicure · 45 min</span><span>$45.00</span></p>
                    <p className="row"><span className="muted">Saturday</span><span>11:00</span></p>
                  </div>
                  <span className="act">Request</span>
                </div>
              </div>
              <div className="scene">
                <div className="ui">
                  <p className="row"><span className="t">New request</span><span className="s">From Claude</span></p>
                  <p className="s" style={{ marginTop: "10px" }}>The intake agent drafted a quote</p>
                  <div className="lines">
                    <p className="row num"><span>Pedicure, Saturday 11:00</span><span className="t">$45.00</span></p>
                  </div>
                  <div className="btns"><span className="act">Confirm</span><span className="act ghost">Edit</span></div>
                </div>
              </div>
              <div className="scene">
                <div className="ui">
                  <p className="s">Pay Maison Lune</p>
                  <p className="big num">{usdCents(pedicureDeposit)}</p>
                  <div className="lines">
                    <p className="row num"><span className="muted">Deposit, half of {usd(ines.priceMinor)}</span><span>{usdCents(pedicureDeposit)}</span></p>
                  </div>
                  <span className="act">Pay with PayPal</span>
                  <p className="s" style={{ marginTop: "8px" }}>or pay as a guest</p>
                </div>
              </div>
              <div className="scene">
                <div className="ui">
                  <p className="t" style={{ font: "600 22px/1.2 var(--site-display)" }}>Send {usdCents(ines.staffMinor)} to Inès?</p>
                  <Split parts={inesSplit} />
                  <span className="act ink">Confirm payout</span>
                </div>
              </div>
              <div className="scene">
                <div className="ui">
                  <p className="s">You asked</p>
                  <p className="t">What did we make this week?</p>
                  <div className="bars" aria-hidden="true">
                    <span style={{ height: "38%" }}></span><span style={{ height: "52%" }}></span><span style={{ height: "44%" }}></span><span style={{ height: "66%" }}></span><span style={{ height: "58%" }}></span><span style={{ height: "100%" }}></span><span style={{ height: "72%" }}></span>
                  </div>
                  <div className="kpis num">
                    <div><span className="s">Services</span><b>$2,610</b></div>
                    <div><span className="s">Products</span><b>$630</b></div>
                    <div><span className="s">Total</span><b>$3,240</b></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Story>
      </div>
    </section>
  );
}

function OneLink({ storeDomain }: { storeDomain: string }) {
  return (
    <section id="link" aria-labelledby="link-h">
      <div className="wrap everywhere">
        <div>
          <h2 id="link-h" data-in>One link for your bio and every chat</h2>
          <div className="chans" data-in><span>Your bio</span><span>Claude</span><span>ChatGPT</span><span>A pay link</span></div>
        </div>
        <div className="phone" data-in role="img" aria-label={`Maison Lune's page at maisonlune.${storeDomain} with its services and its store: pedicure, argan shampoo and a nail kit`}>
          <div className="screen">
            <span className="url">maisonlune.{storeDomain}</span>
            <p className="shopname"><b>Maison Lune</b><span className="s">Hair and nails, Brooklyn</span></p>
            <div className="tabs"><span className="on">All</span><span>Services</span><span>Store</span></div>
            <div className="ui" style={{ boxShadow: "none", background: "var(--background)", display: "grid", gap: "12px" }}>
              <div className="item"><span className="thumb"></span><span><span className="t">Pedicure</span><br /><span className="s">Service · 45 min</span></span><span className="num t">$45</span></div>
              <div className="item"><span className="thumb b"></span><span><span className="t">Argan shampoo</span><br /><span className="s">Product · 250 ml</span></span><span className="num t">$18</span></div>
              <div className="item"><span className="thumb c"></span><span><span className="t">Hair course</span><br /><span className="s">Download · 6 videos</span></span><span className="num t">$39</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/studios",
    title: `${site.name} for studios`,
    description:
      "For salons, spas and studios that sell services and products: one shop, one link, staff paid their share, and the cheaper plan at half price.",
    site,
  });
}

export default function StudiosPage() {
  const site = platformSite();
  const { name, storeDomain } = site;
  return (
    <>
      <JsonLd data={graph(organization(site), breadcrumbs([["Studios", "/studios"]], site), faqStructuredData(STUDIO_FAQ))} />
      <div className="band">
        <div className="wrap hero page">
          <div>
            <h1 data-in>One shop, two ways to sell</h1>
            <p className="lead" data-in>For salons, spas and studios that sell services and products. One workspace, one link, and the cheaper plan at half price.</p>
            <div className="ctas" data-in>
              <Link className="btn btn-mint" href="/pricing">Start with a bundle</Link>{" "}<a className="link" href="#week">See a week</a>
            </div>
          </div>
          <ChatDemo
            label={`In Claude, a client asks for a pedicure on Saturday. ${name}'s card shows Maison Lune's pedicure, and the client requests it.`}
            who="Claude"
            message="Find me a pedicure in Brooklyn for Saturday."
          >
            <div className="widget frame" data-at="400">
              <p className="wtop"><PMark /><b>{name} Network</b> · Maison Lune</p>
              <div className="wrow"><span><span className="t">Pedicure</span><br /><span className="s">Service · 45 min</span></span><span className="num t">$45</span><span className="act" data-press="1800" data-done="Requested">Request</span></div>
            </div>
            <p className="reply frame" data-at="3500">Maison Lune has your request for Saturday.</p>
          </ChatDemo>
        </div>
      </div>
      <div>
        <Week name={name} />
        <OneLink storeDomain={storeDomain} />
        <section aria-labelledby="bundle-h">
          <div className="wrap calc-wrap">
            <div>
              <h2 id="bundle-h" data-in>Run both. Pay less.</h2>
              <p className="lead-dark" data-in>The dearer plan at full price, the other at half, and the lower fee on every payment and order.</p>
              <Link className="more" href="/pricing">See every plan</Link>
            </div>
            <BundleBuilder />
          </div>
        </section>
        <FaqList title="Questions from studios" items={STUDIO_FAQ} /><CloseCta />
      </div>
    </>
  );
}
