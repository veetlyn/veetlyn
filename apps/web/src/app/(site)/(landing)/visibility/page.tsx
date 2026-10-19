import Link from "next/link";

import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import LogoStrip from "@/components/site/logo-strip";
import PMark from "@/components/site/p-mark";
import { VISIBILITY_FAQ } from "@/content/site/faqs";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

export const metadata = pageMetadata({
  path: "/visibility",
  title: "Get found on Google and in AI answers",
  description:
    "Get found on Google and in AI answers. Web SEO comes to every seller page with run V, and Network members will get AI visibility run by an agent with their approval.",
});

export default function VisibilityPage() {
  return (
    <>
      <JsonLd data={graph(organization(), breadcrumbs([["Get found", "/visibility"]]), faqStructuredData(VISIBILITY_FAQ))} />
      <div className="band">
        <div className="wrap hero page">
          <div>
            <h1 data-in>Get found by Google and AI</h1>
            <p className="lead" data-in>Web SEO comes to every seller page with run V, the way it is built into payleor.com today. Network members will also get AI visibility, run by an agent that asks before anything ships.</p>
            <div className="ctas" data-in>
              <Link className="btn btn-mint" href="/contact#membership">Join the membership waitlist</Link>{" "}<a className="link" href="#included">What every plan gets</a>
            </div>
          </div>
          <div className="answers" data-in role="img" aria-label="Example: someone asks for a pedicure in Brooklyn this Saturday, and Google, ChatGPT, Perplexity and Google's AI Overview all name Maison Lune">
            <p className="ask-label">Someone asks</p>
            <p className="ask">a pedicure in Brooklyn this Saturday</p>
            <div className="answer-row"><p className="engine">Google</p><p className="s">maisonlune.payleor.app</p><p className="serp-title">Pedicure in Brooklyn · Maison Lune</p></div>
            <div className="answer-row"><p className="engine">ChatGPT</p><p>Maison Lune does pedicures for $45, and you can request Saturday.</p></div>
            <div className="answer-row"><p className="engine">Perplexity · Sources</p><p><span className="src-n">1</span> maisonlune.payleor.app/pedicure</p></div>
            <div className="answer-row"><p className="engine">AI Overviews</p><p>Maison Lune in Brooklyn offers pedicures and hair care from one page.</p></div>
            <p className="s" style={{ marginTop: "12px" }}>Example</p>
          </div>
        </div>
        <div className="wrap"><LogoStrip /></div>
      </div>
      <main>
        <section id="included" aria-labelledby="inc-h">
          <div className="wrap">
            <h2 id="inc-h" data-in>Web SEO for every plan</h2>
            <p className="lead-dark" data-in>Before an AI can name you, it has to read you. Seller pages are built to be read with run V; payleor.com already is.</p>
            <div className="features">
              <div className="feature" data-in><p className="tag">Structured data <span className="soon">Coming with run V</span></p><h3>Your offers, labelled</h3><p>Services, products, prices and questions, written for search engines and AI tools.</p></div>
              <div className="feature" data-in><p className="tag">Crawlers <span className="soon">Coming with run V</span></p><h3>Open to AI crawlers</h3><p>A sitemap, an llms.txt and robots rules that let AI assistants read you.</p></div>
              <div className="feature" data-in><p className="tag">Speed <span className="soon">Coming with run V</span></p><h3>Fast, clean pages</h3><p>One page per offer, with clear titles and links that last.</p></div>
              <div className="feature" data-in><p className="tag">Discover <span className="soon">Coming with run V</span></p><h3>Listed on Discover</h3><p>People browse the same catalog your clients' AI searches.</p></div>
              <div className="feature" data-in><p className="tag">Payleor Network</p><h3>Found in Claude and ChatGPT</h3><p>By every client who adds Payleor Network.</p></div>
              <div className="feature" data-in><p className="tag">Your domain</p><h3>On your own address</h3><p>On Team, Agency, Grow and Scale.</p></div>
            </div>
          </div>
        </section>
        <section aria-labelledby="ai-h">
          <div className="wrap">
            <h2 id="ai-h" data-in>AI visibility, for Network members <span className="soon">Planned</span></h2>
            <p className="lead-dark" data-in>Each day, the visibility agent does what will get you named most. It drafts. You approve. Over a month, it adds up to all of this.</p>
            <div className="features">
              <div className="feature agent" data-in><p className="tag">Mentions</p><h3>AI mention tracking</h3><p>Ask ChatGPT, Claude, Perplexity and Gemini about your field, and fix what they get wrong.</p></div>
              <div className="feature agent" data-in><p className="tag">Research</p><h3>The questions clients ask</h3><p>What your clients search and ask, and who shows up for it today.</p></div>
              <div className="feature agent" data-in><p className="tag">Map</p><h3>One question per page</h3><p>Every page gets the searches it should win, so no two pages compete.</p></div>
              <div className="feature" data-in><p className="tag">Articles</p><h3>Guides, drafted for you</h3><p>Answers better than the page on top, published only after your yes.</p></div>
              <div className="feature" data-in><p className="tag">Comparisons</p><h3>"Which one" pages</h3><p>For the moment a client picks between you and someone else.</p></div>
              <div className="feature" data-in><p className="tag">Fixes</p><h3>Sharper pages</h3><p>Clearer titles, copy and links on the pages you already have.</p></div>
              <div className="feature" data-in><p className="tag">Index</p><h3>Index checks</h3><p>Make sure search engines and AI crawlers find and keep every page.</p></div>
              <div className="feature" data-in><p className="tag">Facts</p><h3>Fact checks</h3><p>Your prices, hours and claims stay right everywhere they are quoted.</p></div>
              <div className="feature" data-in><p className="tag">Report</p><h3>A weekly report</h3><p>What changed, what moved, and what it brought you.</p></div>
            </div>
            <p className="note" data-in>Plus listings where it counts, such as your Google Business Profile and Trustpilot page.</p>
          </div>
        </section>
        <section aria-labelledby="flow-h">
          <div className="wrap">
            <h2 id="flow-h" data-in>Nothing ships without your yes</h2>
            <div className="story-flow">
              <div className="feature" data-in><p className="tag">1</p><h3>The agent finds a gap</h3><p>A question you should answer, a fact that is wrong, a page that is slow.</p></div>
              <div className="feature" data-in><p className="tag">2</p><h3>It drafts the change</h3><p>A new article, a fixed title, a corrected price.</p></div>
              <div className="feature agent" data-in><p className="tag">3</p><h3>You approve it</h3><p>In the dash or in Discord, with one press.</p></div>
              <div className="feature" data-in><p className="tag">4</p><h3>It ships and is tracked</h3><p>The weekly report shows what moved.</p></div>
            </div>
            <p className="term-line" data-in><PMark />We report what happened. We never promise rankings.</p>
          </div>
        </section>
        <FaqList title="Questions about getting found" items={VISIBILITY_FAQ} /><CloseCta />
      </main>
    </>
  );
}
