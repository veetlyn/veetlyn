import Link from "next/link";

import ChatDemo from "@/components/site/chat-demo";
import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import { NetworkArt, SideArt } from "@/components/site/art/home";
import LogoStrip from "@/components/site/logo-strip";
import PMark from "@/components/site/p-mark";
import { indexFaq } from "@/content/site/faqs";
import { platformSite } from "@/lib/platform";
import { agencyExample, usd, walkCrewDepositMinor } from "@/lib/site/examples";
import { PRICE_FACTS } from "@/lib/site/fees";
import { graph, organization, pageMetadata, websiteWithSearch } from "@/lib/site/seo";

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/",
    title: `${site.name}: sell services and products where AI shops`,
    description: `Sell services and products where AI shops. ${site.name} Network brings freelancers, agencies, stores and studios into Claude and ChatGPT, paid through PayPal.`,
    site,
  });
}

function Terms() {
  return (
    <section id="terms" aria-labelledby="terms-h">
      <div className="wrap">
        <h2 id="terms-h" data-in>Our terms, on top of every integration</h2>
        <div className="terms three">
          <div className="term" data-in>
            <span className="via">Claude and ChatGPT</span><p className="coat">
              <PMark />The client's AI finds, asks and requests quotes. It never pays.
            </p>
          </div>
          <div className="term" data-in>
            <span className="via">PayPal checkout</span><p className="coat">
              <PMark />The price on the page is the price charged.
            </p>
          </div>
          <div className="term" data-in>
            <span className="via">PayPal Payouts</span><p className="coat">
              <PMark />Each share is sent once, after a person or your rule says yes.
            </p>
          </div>
          <div className="term" data-in>
            <span className="via">Your dash and team chat</span><p className="coat">
              <PMark />Agent drafts wait for a person to confirm them.
            </p>
          </div>
          <div className="term" data-in>
            <span className="via">Your own agents, through our API</span><p className="coat">
              <PMark />The same approvals and payout rules as your team.
            </p>
          </div>
          <div className="term" data-in>
            <span className="via">Every offer</span><p className="coat">
              <PMark />Buyers see who does the work: people, AI or both.
            </p>
          </div>
        </div>
      </div>
    </section>

  );
}

function Seen({ storeDomain }: { storeDomain: string }) {
  return (
    <section id="seen" aria-labelledby="seen-h">
      <div className="wrap">
        <h2 id="seen-h" data-in>Get found on search and in AI answers</h2>
        <p className="note" data-in>Web SEO is coming to every seller page. Network members will also get AI visibility, run by an agent with their approval.</p>
        <div className="seen">
          <div className="ui" data-in>
            <p className="src">maisonlune.{storeDomain} › pedicure</p>
            <p className="serp-title">Pedicure in Brooklyn · Maison Lune</p>
            <p className="s">Service · $45 · 45 min</p>
            <p className="s">Request a pedicure and shop hair care from the same page.</p>
          </div>
          <div className="ui" data-in>
            <p className="src">ChatGPT</p>
            <p className="answer">Maison Lune does pedicures for $45. Want me to request Saturday?</p>
            <span className="chip">
              <PMark />Maison Lune · Pedicure · $45
            </span>
          </div>
          <div className="ui report" data-in>
            <p className="src">AI visibility report · <span className="soon">For members</span></p>
            <ul className="report-list"><li>How often AI agents showed you</li><li>The requests that came from it</li><li>The orders that came from it</li></ul>
          </div>
        </div>
        <p className="term-line" data-in>
          <PMark />We report what happened. We never promise rankings.
        </p>
        <Link className="more" href="/visibility">How you get found</Link>
      </div>
    </section>

  );
}

export default function HomePage() {
  const site = platformSite();
  const { name, storeDomain } = site;
  const faq = indexFaq(name);
  return (
    <>
      <JsonLd data={graph(organization(site), websiteWithSearch(site), faqStructuredData(faq))} />
      <div className="band">
        <div className="wrap hero">
          <div>
            <h1 data-in>Sell where <em>AI</em> shops</h1>
            <p className="lead" data-in>{name} Network puts your services and products inside Claude and ChatGPT. Agents do the work. People approve the money.</p>
            <div className="ctas" data-in>
              <Link className="btn btn-mint" href="/pricing">Start selling</Link>{" "}<Link className="link" href="/network">How {name} Network works</Link>
            </div>
            <p className="hero-note" data-in>Clients add {name} Network once, in Claude or ChatGPT.</p>
          </div>
          <ChatDemo
            label={`In Claude, a bakery asks for a logo under $900. ${name} Network shows an automated seller for $29 and Walk Crew, a studio of people. The client requests a quote, accepts Walk Crew's $640 quote with a press, and goes to pay the deposit on ${name}.`}
            who="Claude"
            message="Find someone to design a logo for my bakery, under $900."
          >
            <div className="widget frame" data-at="400">
              <p className="wtop"><PMark /><b>{name} Network</b> · 2 sellers</p>
              <div className="wrow"><span><span className="t">Logo Bot</span><br /><span className="s">Automated · ready now</span></span><span className="num t">$29</span><span className="act ghost">Buy</span></div>
              <div className="wrow"><span><span className="t">Walk Crew</span><br /><span className="s">By people · 7–14 days</span></span><span className="num t">$400+</span><span className="act" data-press="1800" data-done="Requested">Request a quote</span></div>
            </div>
            <div className="widget frame" data-at="2900">
              <p className="wtop"><PMark /><b>{name} Network</b> · Quote from Walk Crew</p>
              <div className="wrow"><span><span className="t">Logo and brand kit</span><br /><span className="s">10 days · deposit {usd(walkCrewDepositMinor())}</span></span><span className="num t">{usd(agencyExample().quoteMinor)}</span><span className="act" data-press="4300" data-done="Accepted">Accept</span></div>
            </div>
            <p className="reply frame" data-at="5100">Accepted. Pay the deposit on {name}, with PayPal.</p>
          </ChatDemo>
        </div>
        <div className="wrap"><LogoStrip channels /></div>
      </div>
      <div>
        <section aria-labelledby="sides-h">
          <div className="wrap">
            <h2 id="sides-h" data-in>Agentic commerce, with a person on every payment</h2>
            <div className="sides">
              <div className="side theirs" data-in>
                <p className="for">Their agents</p>
                <h3>Claude and ChatGPT, through {name} Network</h3>
                <SideArt name="theirs" />
                <ul><li>Find your offers</li><li>Ask your questions</li><li>Request quotes</li><li>Follow the project</li></ul>
                <p className="foot-line">They never pay.</p>
              </div>
              <div className="side middle" data-in>
                <p className="for">{name}</p>
                <h3>The money and the rules</h3>
                <SideArt name="middle" />
                <ul><li>The price comes from your project</li><li>The payer approves each payment in PayPal</li><li>A person or your rule approves each payout</li><li>Every step is recorded</li></ul>
                <p className="foot-line">Paid through PayPal.</p>
              </div>
              <div className="side yours" data-in>
                <p className="for">Your agents</p>
                <h3>Quotes, answers and payouts, drafted for you</h3>
                <SideArt name="yours" />
                <ul><li>The intake agent drafts quotes</li><li>The copilot answers money questions</li><li>The payout agent pays by your rules</li><li>Your own agents join through the API</li></ul>
                <p className="foot-line">They act inside your rules.</p>
              </div>
            </div>
          </div>
        </section>
        <section id="network" aria-labelledby="network-h">
          <div className="wrap">
            <h2 id="network-h" data-in>AI shopping left services out. {name} Network brings them in.</h2>
            <div className="zigzag">
              <div className="zig">
                <div className="zig-art plain" data-in><NetworkArt /></div>
                <div className="zig-text" data-in>
                  <p className="tag">A way in</p>
                  <h3>For people who sell their work</h3>
                  <ul>
                    <li><b>One connector.</b> Assistant checkouts sell physical goods. One connector puts every {name} seller in front of a client's AI.</li>
                    <li><b>The AI never pays.</b> The client approves each payment on {name}, in PayPal.</li>
                    <li><b>A press the model cannot fake.</b> Accepting a quote or a delivery takes the client's own press.</li>
                  </ul>
                </div>
              </div>
            </div>
            <Link className="more" href="/network">How {name} Network works</Link>
          </div>
        </section>
        <section id="stories" aria-labelledby="stories-h">
          <div className="wrap">
            <h2 id="stories-h" data-in>For anyone who sells</h2>
            <div className="marquee" data-in>
              <div className="marquee-track">
                <ul className="wall"><li>Salons</li><li>Course creators</li><li>Template shops</li><li>Web agencies</li><li>Remote teams</li><li>Merchants</li><li>Freelancers</li><li>AI sellers</li><li>Studios</li><li>Designers</li><li>Coaches</li><li>Developers</li></ul>
                <ul className="wall" aria-hidden="true"><li>Salons</li><li>Course creators</li><li>Template shops</li><li>Web agencies</li><li>Remote teams</li><li>Merchants</li><li>Freelancers</li><li>AI sellers</li><li>Studios</li><li>Designers</li><li>Coaches</li><li>Developers</li></ul>
              </div>
            </div>
            <div className="stories">
              <Link className="story-card is-dark" href="/freelancers" data-in>
                <p className="for">Freelancers</p>
                <h3>Amadou gets hired from a chat</h3>
                <div className="ui"><p className="row"><span className="t">Logo and brand kit</span><span className="ok">By people</span></p><p className="row num"><span className="s">Amadou · 7–14 days</span><span className="t">$400–$900</span></p></div>
                <p className="go">Read the story</p>
              </Link>{" "}<Link className="story-card" href="/agencies" data-in>
                <p className="for">Agencies</p>
                <h3>Walk Crew answers requests with an agent</h3>
                <div className="ui"><p className="row"><span className="t">New request</span><span className="s">Logo and brand kit</span></p><p className="row num"><span>Draft quote, by the intake agent</span><span className="t">$640</span></p></div>
                <p className="go">Read the story</p>
              </Link>{" "}<Link className="story-card" href="/stores" data-in>
                <p className="for">Stores</p>
                <h3>Clay Room sells a course from one page</h3>
                <div className="ui"><p className="row num"><span>Glazing course · Download</span><span>$29</span></p><p className="row"><span>Paid with PayPal</span><span className="ok">Sent at once</span></p></div>
                <p className="go">Read the story</p>
              </Link>{" "}<Link className="story-card is-dark" href="/studios" data-in>
                <p className="for">Studios</p>
                <h3>Maison Lune sells pedicures and shampoo</h3>
                <div className="ui"><p className="row num"><span>Pedicure · Service</span><span>$45</span></p><p className="row num"><span>Argan shampoo · Product</span><span>$18</span></p></div>
                <p className="go">Read the story</p>
              </Link>
            </div>
          </div>
        </section><Terms /> <Seen storeDomain={storeDomain} /><section aria-labelledby="price-h">
          <div className="wrap">
            <h2 id="price-h" data-in>Your clients stay yours. We charge when we bring you one.</h2>
            <div className="model" data-in>
              <div><b>A plan</b><span>From {PRICE_FACTS.from} a month</span></div>
              <div><b>{PRICE_FACTS.minFee.replace("%", "")}–{PRICE_FACTS.maxFee}</b><span>On each payment or order</span></div>
              <div className="hit"><b>{PRICE_FACTS.network} once</b><span>Only on clients AI brings you</span></div>
            </div>
            <Link className="more" href="/pricing">See every plan, from Solo to Enterprise</Link>
          </div>
        </section><FaqList title="Money questions" items={faq} /> <CloseCta />
      </div>

    </>
  );
}
