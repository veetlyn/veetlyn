import { signupDestination } from "@/lib/launch";
import { depositDue, formatOrderFee, getSellerPlan, NETWORK_FEE_BPS, SOLO_MANAGEMENT_FEE_BPS } from "@jendal-workspace/core";
import Link from "next/link";

import ChatDemo from "@/components/site/chat-demo";
import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import PMark from "@/components/site/p-mark";
import Split from "@/components/site/split";
import Story from "@/components/site/story";
import { Tier } from "@/components/site/tiers";
import { FREELANCER_FAQ } from "@/content/site/faqs";
import { platformSite } from "@/lib/platform";
import { getPlatformOrigins } from "@/lib/server-api";
import { freelancerExample, usd, usdCents } from "@/lib/site/examples";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

const solo = getSellerPlan("solo");
const soloFee = formatOrderFee(solo.feeBps);
const amadou = freelancerExample();
const amadouDeposit = depositDue(amadou.quoteMinor, SOLO_MANAGEMENT_FEE_BPS).quotePartMinor;

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/freelancers",
    title: `${site.name} for freelancers`,
    description: `Get hired from your clients' AI. An agent drafts your quotes, clients pay deposits with PayPal, and you pay ${soloFee} per payment and ${formatOrderFee(NETWORK_FEE_BPS)} once on new clients.`,
    site,
  });
}

export default async function FreelancersPage() {
  const site = platformSite();
  const { name } = site;
  const amadouSplit = [
    { label: "You", minor: amadou.keptMinor, tone: "brand" },
    { label: "PayPal", minor: amadou.paypalMinor, tone: "paypal" },
    { label: `${name}, ${soloFee} and ${formatOrderFee(NETWORK_FEE_BPS)} once`, minor: amadou.platformMinor, tone: "platform" },
  ] as const;
  const { dash } = await getPlatformOrigins();
  const signup = signupDestination(dash);
  return (
    <>
      <JsonLd data={graph(organization(site), breadcrumbs([["Freelancers", "/freelancers"]], site), faqStructuredData(FREELANCER_FAQ))} />
      <div className="band">
        <div className="wrap hero page">
          <div>
            <h1 data-in>Get hired from your clients' AI</h1>
            <p className="lead" data-in>For freelancers. Through {name} Network, your services show up in your clients' Claude and ChatGPT. Your agent drafts the quote, and PayPal pays you.</p>
            <div className="ctas" data-in>
              <Link className="btn btn-mint" href="/pricing">Start with Solo</Link>{" "}<a className="link" href="#story">See how it works</a>
            </div>
          </div>
          <ChatDemo
            label={`In Claude, a bakery asks for a logo under $900. ${name} shows an automated logo seller for $29 and Amadou, a designer, for $400 to $900; the client requests a quote from Amadou.`}
            who="Claude"
            message="Find someone to design a logo for my bakery, under $900."
          >
            <div className="widget frame" data-at="400">
              <p className="wtop"><PMark /><b>{name} Network</b> · 2 sellers</p>
              <div className="wrow"><span><span className="t">Logo Bot</span><br /><span className="s">Automated · ready now</span></span><span className="num t">$29</span><span className="act ghost">Buy</span></div>
              <div className="wrow"><span><span className="t">Amadou, designer</span><br /><span className="s">By people · 7–14 days</span></span><span className="num t">$400+</span><span className="act" data-press="1900" data-done="Requested">Request a quote</span></div>
            </div>
            <p className="reply frame" data-at="2800">Amadou has your brief. You will see his quote here.</p>
          </ChatDemo>
        </div>
      </div>
      <div>
        <section id="story" aria-labelledby="story-h">
          <div className="wrap">
            <h2 id="story-h" data-in>From a chat to your PayPal</h2>
            <Story>
              <div className="steps">
                <span className="rail" aria-hidden="true"><i></i></span>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Claude, for the bakery</p><h3>Sends you the brief</h3><p className="promise">Buyers see your work is done by people.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Your intake agent</p><h3>Drafts the quote from your prices</h3><p className="promise">Nothing goes out until you send it.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">The client, in PayPal</p><h3>Pays half up front</h3><p className="promise">It lands in your PayPal. We never hold it.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">You</p><h3>Deliver, and get the rest</h3><p className="promise">Paid only shows once PayPal confirms it.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">{name}</p><h3>Shows what you kept</h3><p className="promise">Every fee, to the cent, before you start.</p></div>
              </div>
              <div className="pin">
                <div className="scene-stage">
                  <div className="scene on">
                    <div className="ui">
                      <p className="row"><span className="t">New request</span><span className="s">From Claude</span></p>
                      <div className="lines">
                        <p className="row"><span className="muted">Logo for a bakery</span><span>Under $900</span></p>
                        <p className="row"><span className="muted">Wants</span><span>3 directions, colours</span></p>
                        <p className="row"><span className="muted">By</span><span>In 2 weeks</span></p>
                      </div>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="row"><span className="t">Draft quote</span><span className="s">By your intake agent</span></p>
                      <div className="lines">
                        <p className="row num"><span className="muted">Logo, 3 directions</span><span>$400.00</span></p>
                        <p className="row num"><span className="muted">Colour and type sheet</span><span>$240.00</span></p>
                        <p className="row num sum"><span className="t">Total</span><span className="t">{usdCents(amadou.quoteMinor)}</span></p>
                      </div>
                      <div className="btns"><span className="act ink">Send</span><span className="act ghost">Edit</span></div>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="s">Pay Amadou</p>
                      <p className="big num">{usdCents(amadouDeposit)}</p>
                      <div className="lines"><p className="row num"><span className="muted">Deposit, half of {usd(amadou.quoteMinor)}</span><span>{usdCents(amadouDeposit)}</span></p></div>
                      <span className="act">Pay with PayPal</span>
                      <p className="s" style={{ marginTop: "8px" }}>or pay as a guest</p>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="row"><span className="t">Delivery</span><span className="ok">Approved</span></p>
                      <div className="lines">
                        <p className="row num"><span className="muted">Deposit</span><span>{usdCents(amadouDeposit)} <span className="ok">Paid</span></span></p>
                        <p className="row num"><span className="muted">Balance</span><span>{usdCents(amadouDeposit)} <span className="ok">Paid</span></span></p>
                      </div>
                      <p className="s" style={{ marginTop: "12px" }}>Confirmed by PayPal</p>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="t" style={{ font: "600 22px/1.2 var(--site-display)" }}>You kept {usdCents(amadou.keptMinor)}</p>
                      <Split parts={amadouSplit} />
                      <p className="s" style={{ marginTop: "12px" }}>The bakery's next project: {soloFee} only.</p>
                    </div>
                  </div>
                </div>
              </div>
            </Story>
          </div>
        </section>
        <section aria-labelledby="feat-h">
          <div className="wrap">
            <h2 id="feat-h" data-in>Everything a freelancer needs to get paid</h2>
            <div className="features">
              <div className="feature agent" data-in><p className="tag">Agent</p><h3>On {name} Network</h3><p>Clients who add it to Claude or ChatGPT find you and send briefs.</p></div>
              <div className="feature agent" data-in><p className="tag">Agent</p><h3>An intake agent</h3><p>{solo.aiDraftsPerMonth} draft quotes a month from your own prices.</p></div>
              <div className="feature" data-in><p className="tag">PayPal</p><h3>Deposits and balances</h3><p>Pay pages with PayPal, or as a guest.</p></div>
              <div className="feature" data-in><p className="tag">Your page</p><h3>A seller page and pay links</h3><p>One link for your bio, your email and every chat.</p></div>
              <div className="feature" data-in><p className="tag">Delivery</p><h3>Deliver and get approved</h3><p>Files, approval and the balance in one place.</p></div>
              <div className="feature" data-in><p className="tag">Yours <span className="soon">Coming soon</span></p><h3>Export everything</h3><p>Projects, clients, payments and files, any time.</p></div>
            </div>
          </div>
        </section>
        <section aria-labelledby="plan-h">
          <div className="wrap">
            <h2 id="plan-h" data-in>One plan for one person</h2>
            <div className="tiers three"><Tier id="solo" interval="monthly" signupUrl={signup} /> <Tier id="team" interval="monthly" signupUrl={signup} /> <Tier id="enterprise" interval="monthly" signupUrl={signup} /></div>
            <Link className="more" href="/pricing">Compare every plan</Link>
          </div>
        </section>
        <FaqList title="Questions from freelancers" items={FREELANCER_FAQ} /><CloseCta />
      </div>
    </>
  );
}
