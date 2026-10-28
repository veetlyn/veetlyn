import { signupDestination } from "@/lib/launch";
import { depositDue, formatOrderFee, getSellerPlan } from "@jendal-workspace/core";
import Link from "next/link";

import ChatDemo from "@/components/site/chat-demo";
import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import PMark from "@/components/site/p-mark";
import Split from "@/components/site/split";
import Story from "@/components/site/story";
import { Tier } from "@/components/site/tiers";
import { agencyFaq } from "@/content/site/faqs";
import { platformSite } from "@/lib/platform";
import { getPlatformOrigins } from "@/lib/server-api";
import { agencyExample, EXAMPLE_TEAM, usdCents, walkCrewBalanceMinor } from "@/lib/site/examples";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

const walkCrew = agencyExample();
const deposit = depositDue(walkCrew.quoteMinor, EXAMPLE_TEAM.managementFeeBps);

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/agencies",
    title: `${site.name} for agencies`,
    description:
      "Run your agency with agents: requests from AI and your page, quotes drafted for you, and every member paid their share by your payout rules.",
    site,
  });
}

export default async function AgenciesPage() {
  const site = platformSite();
  const { name } = site;
  const faq = agencyFaq(name);
  const walkCrewSplit = [
    { label: "Amadou", minor: walkCrew.memberMinor, tone: "brand" },
    { label: "Walk Crew", minor: walkCrew.teamMinor, tone: "ink" },
    { label: "PayPal", minor: walkCrew.paypalMinor, tone: "paypal" },
    { label: `${name}, ${formatOrderFee(EXAMPLE_TEAM.platformFeeBps)}`, minor: walkCrew.platformMinor, tone: "platform" },
  ] as const;
  const { dash } = await getPlatformOrigins();
  const signup = signupDestination(dash);
  return (
    <>
      <JsonLd data={graph(organization(site), breadcrumbs([["Agencies", "/agencies"]], site), faqStructuredData(faq))} />
      <div className="band">
        <div className="wrap hero page">
          <div>
            <h1 data-in>Run your agency with agents</h1>
            <p className="lead" data-in>For agencies, collectives and remote teams. Requests come from AI or your page. Agents draft and report. Your rules pay everyone.</p>
            <div className="ctas" data-in>
              <Link className="btn btn-mint" href="/pricing">Start with Team</Link>{" "}<Link className="link" href="/contact#sales">Talk to sales</Link>
            </div>
          </div>
          <ChatDemo
            label={`In Walk Crew's ${name} dash, a client asks for a logo for a bakery. The intake agent drafts a quote of $640, and an admin confirms it.`}
            who={`${name} · New request`}
            message="Hi! We need a logo for our bakery, three directions, in two weeks."
          >
            <div className="widget frame" data-at="400">
              <p className="wtop"><PMark /><b>{name}</b> · Draft by the intake agent</p>
              <div className="wrow"><span><span className="t">Logo, 3 directions</span><br /><span className="s">Amadou · 10 days</span></span><span className="num t">$400</span><span></span></div>
              <div className="wrow"><span><span className="t">Colour and type sheet</span><br /><span className="s">Amadou</span></span><span className="num t">$240</span><span className="act" data-press="2000" data-done="Confirmed">Confirm</span></div>
            </div>
            <p className="reply frame" data-at="2900">Quote sent to the client.</p>
          </ChatDemo>
        </div>
      </div>
      <div>
        <section id="story" aria-labelledby="story-h">
          <div className="wrap">
            <h2 id="story-h" data-in>One project, everyone paid</h2>
            <Story>
              <div className="steps">
                <span className="rail" aria-hidden="true"><i></i></span>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Your intake agent</p><h3>Drafts the quote</h3><p className="promise">An admin confirms it. Nothing else goes out.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">The client, in PayPal</p><h3>Pays the deposit</h3><p className="promise">It lands in the agency's PayPal.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Amadou</p><h3>Uploads the delivery</h3><p className="promise">The client approves and pays the rest.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Your payout rules</p><h3>Pay Amadou his share</h3><p className="promise">Each share is sent once.</p></div>
                <div className="step"><span className="dot" aria-hidden="true"></span><p className="actor">Your copilot</p><h3>Answers the money questions</h3><p className="promise">It reads your books. It changes nothing.</p></div>
              </div>
              <div className="pin">
                <div className="scene-stage">
                  <div className="scene on">
                    <div className="ui">
                      <p className="row"><span className="t">New request</span><span className="s">From Claude</span></p>
                      <p className="s" style={{ marginTop: "10px" }}>The intake agent drafted a quote</p>
                      <div className="lines">
                        <p className="row num"><span>Logo, 3 directions</span><span>$400.00</span></p>
                        <p className="row num"><span>Colour and type sheet</span><span>$240.00</span></p>
                      </div>
                      <div className="btns"><span className="act">Confirm</span><span className="act ghost">Edit</span></div>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="s">Pay Walk Crew</p>
                      <p className="big num">{usdCents(deposit.totalMinor)}</p>
                      <div className="lines">
                        <p className="row num"><span className="muted">Deposit, half the quote</span><span>{usdCents(deposit.quotePartMinor)}</span></p>
                        <p className="row num"><span className="muted">Management fee</span><span>{usdCents(deposit.managementFeeMinor)}</span></p>
                      </div>
                      <span className="act">Pay with PayPal</span>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="row"><span className="t">logo-final.zip</span><span className="s">Delivered</span></p>
                      <div className="lines">
                        <p className="row"><span className="muted">Delivery</span><span className="ok">Approved</span></p>
                        <p className="row num"><span className="muted">Balance</span><span>{usdCents(walkCrewBalanceMinor())} <span className="ok">Paid</span></span></p>
                      </div>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="t" style={{ font: "600 22px/1.2 var(--site-display)" }}>Send {usdCents(walkCrew.memberMinor)} to Amadou?</p>
                      <Split parts={walkCrewSplit} />
                      <span className="act ink">Confirm payout</span>
                    </div>
                  </div>
                  <div className="scene">
                    <div className="ui">
                      <p className="s">You asked</p>
                      <p className="t">What did we make this week?</p>
                      <div className="bars" aria-hidden="true"><span style={{ height: "40%" }}></span><span style={{ height: "58%" }}></span><span style={{ height: "47%" }}></span><span style={{ height: "72%" }}></span><span style={{ height: "64%" }}></span><span style={{ height: "100%" }}></span><span style={{ height: "80%" }}></span></div>
                      <div className="kpis num">
                        <div><span className="s">Came in</span><b>$4,820</b></div>
                        <div><span className="s">Paid out</span><b>$3,910</b></div>
                        <div><span className="s">Waiting</span><b>$910</b></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Story>
          </div>
        </section>
        <section aria-labelledby="feat-h">
          <div className="wrap">
            <h2 id="feat-h" data-in>Built for agencies that share the work and the money</h2>
            <div className="features">
              <div className="feature agent" data-in><p className="tag">Agent</p><h3>Intake agent</h3><p>
                  {getSellerPlan("team").aiDraftsPerMonth} draft quotes a month on Team,{" "}
                  {getSellerPlan("agency").aiDraftsPerMonth.toLocaleString("en-US")} on Agency.
                </p></div>
              <div className="feature agent" data-in><p className="tag">Agent</p><h3>Team copilot</h3><p>Ask what came in, what you owe and what is waiting.</p></div>
              <div className="feature agent" data-in><p className="tag">Agent</p><h3>Payout agent</h3><p>On Agency, it pays shares by your rules.</p></div>
              <div className="feature" data-in><p className="tag">Team chat <span className="soon">Coming soon</span></p><h3>Your agents in your chat</h3><p>Slack, Discord and Google Chat, where you already work.</p></div>
              <div className="feature" data-in><p className="tag">Payouts</p><h3>Your rules, your approvers</h3><p>Approve each one, set limits, or add a second admin.</p></div>
              <div className="feature" data-in><p className="tag">API</p><h3>Your own agents</h3><p>The public API and webhooks, with the same approvals.</p></div>
            </div>
          </div>
        </section>
        <section aria-labelledby="plan-h">
          <div className="wrap">
            <h2 id="plan-h" data-in>Plans for agencies</h2>
            <div className="tiers three"><Tier id="team" interval="monthly" signupUrl={signup} /> <Tier id="agency" interval="monthly" signupUrl={signup} /> <Tier id="enterprise" interval="monthly" signupUrl={signup} /></div>
            <Link className="more" href="/pricing">Compare every plan</Link>
          </div>
        </section>
        <FaqList title="Questions from agencies" items={faq} /><CloseCta />
      </div>
    </>
  );
}
