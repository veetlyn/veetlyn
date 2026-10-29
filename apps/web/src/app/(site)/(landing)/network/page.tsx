import ContextualAgentTeaser from "@/components/site/contextual-agent-teaser";
import { isWaitlistOnly, signupDestination } from "@/lib/launch";
import Link from "next/link";

import ChatDemo from "@/components/site/chat-demo";
import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import MemberCheck from "@/components/site/member-check";
import PMark from "@/components/site/p-mark";
import { networkFaq } from "@/content/site/faqs";
import { platformSite } from "@/lib/platform";
import { getPlatformOrigins } from "@/lib/server-api";
import { usd, walkCrewBalanceMinor } from "@/lib/site/examples";
import { PRICE_FACTS } from "@/lib/site/fees";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/network",
    title: `${site.name} Network`,
    description: `${site.name} Network is the connector clients add to Claude and ChatGPT. Their AI finds sellers and requests quotes, and clients pay on ${site.name} with PayPal.`,
    site,
  });
}

export default async function NetworkPage() {
  const site = platformSite();
  const { name, domain } = site;
  const faq = networkFaq(name);
  const { dash } = await getPlatformOrigins();
  const signup = signupDestination(dash);
  return (
    <>
      <JsonLd data={graph(organization(site), breadcrumbs([[`${name} Network`, "/network"]], site), faqStructuredData(faq))} />
      <div className="band">
        <div className="wrap hero page">
          <div>
            <h1 data-in>{name} Network</h1>
            <p className="lead" data-in>The connector your clients add to Claude and ChatGPT. Their AI finds you, asks and requests. They pay on {name}, with PayPal.</p>
            <div className="ctas" data-in>
              <a className="btn btn-mint" href={signup}>{isWaitlistOnly() ? "Join the waitlist" : "Get listed"}</a>{" "}<a className="link" href="#add">{isWaitlistOnly() ? "How clients add it" : "Add it to Claude or ChatGPT"}</a>
            </div>
          </div>
          <ChatDemo
            label={`In ChatGPT, the bakery asks whether its logo is ready. ${name} Network shows Walk Crew's delivery; the client accepts it with a press and is sent to pay the balance on ${name}.`}
            who="ChatGPT"
            message="Is my bakery logo ready?"
          >
            <div className="widget frame" data-at="400">
              <p className="wtop"><PMark /><b>{name} Network</b> · Delivery from Walk Crew</p>
              <div className="wrow"><span><span className="t">Logo, 3 directions</span><br /><span className="s">logo-final.zip · 3 files</span></span><span className="num t">Ready</span><span></span></div>
              <div className="wrow"><span><span className="t">Balance due</span><br /><span className="s">After you accept</span></span><span className="num t">{usd(walkCrewBalanceMinor())}</span><span className="act" data-press="1900" data-done="Accepted">Accept delivery</span></div>
            </div>
            <p className="reply frame" data-at="2800">Accepted. Pay the {usd(walkCrewBalanceMinor())} balance on {name}, with PayPal.</p>
          </ChatDemo>
        </div>
      </div>
      <div>
        <section aria-labelledby="gap-h">
          <div className="wrap">
            <h2 id="gap-h" data-in>AI shopping left services out. {name} Network brings them in.</h2>
            <p className="lead-dark" data-in>The assistants' own checkouts sell physical goods. Services, courses and downloads have no way in. These are the gaps the network fills.</p>
            <div className="features">
              <div className="feature agent" data-in><p className="tag">A way in</p><h3>For people who sell their work</h3><p>One connector puts every {name} seller in front of a client's AI.</p></div>
              <div className="feature agent" data-in><p className="tag">One integration</p><h3>We build it once, for everyone</h3><p>No seller writes a connector or passes a platform review.</p></div>
              <div className="feature agent" data-in><p className="tag">Your control</p><h3>Delegate with clear permissions</h3><p>Agents prepare the purchase. In the alpha, the payer approves checkout on {name}'s page in PayPal.</p></div>
              <div className="feature" data-in><p className="tag">Consent</p><h3>A press the model cannot fake</h3><p>Accepting a quote or a delivery takes the client's own press on a card.</p></div>
              <div className="feature" data-in><p className="tag">Proof</p><h3>A record for work with no tracking number</h3><p>The agreed scope, changes, deliveries and the client's answers are kept.</p></div>
              <div className="feature" data-in><p className="tag">After the sale</p><h3>Money for the whole team</h3><p>Deposits, balances, shares and payouts by your rules.</p></div>
            </div>
          </div>
        </section>
        <ContextualAgentTeaser name={name} />
        <section aria-labelledby="can-h">
          <div className="wrap">
            <h2 id="can-h" data-in>What their AI can do, and what only the client can</h2>
            <div className="sides two">
              <div className="side theirs" data-in>
                <p className="for">Their AI can</p>
                <ul><li>Search sellers and products</li><li>Ask the seller questions</li><li>Request and compare quotes</li><li>Follow a project</li></ul>
              </div>
              <div className="side middle" data-in>
                <p className="for">Only the client can</p>
                <ul><li>Accept a quote, with a press</li><li>Accept a delivery, with a press</li><li>Pay, on {name} with PayPal</li><li>Rate the seller</li></ul>
                <p className="foot-line">Card details stay with PayPal.</p>
              </div>
            </div>
          </div>
        </section>
        <section id="add" aria-labelledby="add-h">
          <div className="wrap">
            <h2 id="add-h" data-in>How clients add it</h2>
            <div className="features">
              <div className="feature" data-in><p className="tag">Claude</p><h3>Upload the plugin</h3><p>Customize, then Plugins, then Upload plugin. Or add a custom connector with this address.</p></div>
              <div className="feature" data-in><p className="tag">ChatGPT</p><h3>Upload the plugin</h3><p>Plugins, then Upload. Or turn on developer mode and add the connector with the same address.</p></div>
              <div className="feature agent" data-in><p className="tag">The address</p><h3 className="num">api.{domain}/mcp</h3><p>One address for every seller on the network.</p></div>
            </div>
            {isWaitlistOnly() ? (
              <p className="note" data-in>The plugin downloads open at launch.</p>
            ) : (
              <div className="ctas" data-in>
                <a className="btn btn-mint" href="/plugin/claude.zip" download>Get the plugin for Claude</a>{" "}
                <a className="btn btn-ink" href="/plugin/chatgpt.zip" download>Get the plugin for ChatGPT</a>
              </div>
            )}
            <p className="note" data-in>Directory listings in Claude and ChatGPT come after the platforms' review. Until then, clients add {name} Network themselves, once.</p>
          </div>
        </section>
        <section aria-labelledby="sell-h">
          <div className="wrap">
            <h2 id="sell-h" data-in>For sellers on the network</h2>
            <ul className="includes" data-in>
              <li>Listed by default, opt any offering out</li>
              <li>{PRICE_FACTS.network} once, only on clients it brings you</li>
              <li>Buyers see who does the work: people, AI or both</li>
            </ul>
            <Link className="more" href="/pricing">See pricing</Link>
          </div>
        </section>
        <section id="membership" aria-labelledby="member-h">
          <div className="wrap">
            <h2 id="member-h" data-in>Network membership: the check buyers trust</h2>
            <p className="lead-dark" data-in>Membership is earned, never sold. It opens soon, starting with sellers who can show the reputation they already have.</p>
            <div className="member">
              <div className="side theirs" data-in>
                <p className="for">How to qualify</p>
                <ul><li>A verified PayPal business account</li><li>A delivery record on {name}</li><li>Proof you already have: Trustpilot, a Google Business Profile, your social accounts</li></ul>
              </div>
              <div className="side middle" data-in>
                <p className="for">What members get</p>
                <ul><li>AI visibility, run by an agent with your approval</li><li>The member check on every card and page</li><li>A place on the Network members shelf in Discover</li><li>First access to new agents</li><li>A named contact at {name}</li></ul>
                <p className="planned">Planned, opening soon</p>
              </div>
              <div className="member-card" data-in role="img" aria-label="A member card for Maison Lune with the member check and three verified proofs">
                <span className="avatar">ML</span>
                <p className="name">Maison Lune <MemberCheck /></p>
                <p className="s">Hair and nails, Brooklyn</p>
                <ul className="proofs"><li><span>PayPal business</span><span>Verified</span></li><li><span>Google Business Profile</span><span>Linked</span></li><li><span>Trustpilot</span><span>Linked</span></li></ul>
              </div>
            </div>
            <div className="ctas" style={{ display: "flex", flexWrap: "wrap", gap: "16px 28px", alignItems: "center", marginTop: "28px" }}>
              <Link className="btn btn-ink" href="/contact#membership">Join the waitlist</Link>{" "}<span className="muted">We review every application by hand.</span>
            </div>
          </div>
        </section>
        <FaqList title="Questions about the network" items={faq} /><CloseCta />
      </div>
    </>
  );
}
