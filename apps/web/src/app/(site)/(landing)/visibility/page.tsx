import Link from "next/link";

import { AgentArt, SeoArt } from "@/components/site/art/visibility";
import CloseCta from "@/components/site/close-cta";
import FaqList, { faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import LogoStrip from "@/components/site/logo-strip";
import PMark from "@/components/site/p-mark";
import { visibilityFaq } from "@/content/site/faqs";
import { platformSite } from "@/lib/platform";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({
    path: "/visibility",
    title: "Get found on Google and in AI answers",
    description:
      "Get found on Google and in AI answers. Web SEO is coming to every seller page, and Network members will get AI visibility run by an agent with their approval.",
    site,
  });
}

export default function VisibilityPage() {
  const site = platformSite();
  const { name, domain, storeDomain } = site;
  const faq = visibilityFaq(name);
  return (
    <>
      <JsonLd data={graph(organization(site), breadcrumbs([["Get found", "/visibility"]], site), faqStructuredData(faq))} />
      <div className="band">
        <div className="wrap hero page">
          <div>
            <h1 data-in>Get found by Google and AI</h1>
            <p className="lead" data-in>Web SEO is coming to every seller page, the way it is built into {domain} today. Network members will also get AI visibility, run by an agent that asks before anything ships.</p>
            <div className="ctas" data-in>
              <Link className="btn btn-mint" href="/contact#membership">Join the membership waitlist</Link>{" "}<a className="link" href="#included">What every plan gets</a>
            </div>
          </div>
          <div className="answers" data-in role="img" aria-label="Example: someone asks for a pedicure in Brooklyn this Saturday, and Google, ChatGPT, Perplexity and Google's AI Overview all name Maison Lune">
            <p className="ask-label">Someone asks</p>
            <p className="ask">a pedicure in Brooklyn this Saturday</p>
            <div className="answer-row"><p className="engine">Google</p><p className="s">maisonlune.{storeDomain}</p><p className="serp-title">Pedicure in Brooklyn · Maison Lune</p></div>
            <div className="answer-row"><p className="engine">ChatGPT</p><p>Maison Lune does pedicures for $45, and you can request Saturday.</p></div>
            <div className="answer-row"><p className="engine">Perplexity · Sources</p><p><span className="src-n">1</span> maisonlune.{storeDomain}/pedicure</p></div>
            <div className="answer-row"><p className="engine">AI Overviews</p><p>Maison Lune in Brooklyn offers pedicures and hair care from one page.</p></div>
            <p className="s" style={{ marginTop: "12px" }}>Example</p>
          </div>
        </div>
        <div className="wrap"><LogoStrip /></div>
      </div>
      <div>
        <section id="included" aria-labelledby="inc-h">
          <div className="wrap">
            <h2 id="inc-h" data-in>Web SEO for every plan</h2>
            <p className="lead-dark" data-in>Before an AI can name you, it has to read you. Seller pages will be built to be read; {domain} already is.</p>
            <div className="bento">
              <div className="tile wide" data-in><p className="tag">Structured data <span className="soon">Coming soon</span></p><h3>Your offers, labelled</h3><p>Services, products, prices and questions, written for search engines and AI tools.</p><SeoArt name="labelled" /></div>
              <div className="tile" data-in><p className="tag">Crawlers <span className="soon">Coming soon</span></p><h3>Open to AI crawlers</h3><p>A sitemap, an llms.txt and robots rules that let AI assistants read you.</p><SeoArt name="crawlers" /></div>
              <div className="tile" data-in><p className="tag">Speed <span className="soon">Coming soon</span></p><h3>Fast, clean pages</h3><p>One page per offer, with clear titles and links that last.</p><SeoArt name="speed" /></div>
              <div className="tile" data-in><p className="tag">Discover <span className="soon">Coming soon</span></p><h3>Listed on Discover</h3><p>People browse the same catalog your clients' AI searches.</p><SeoArt name="discover" /></div>
              <div className="tile wide dark" data-in><p className="tag">{name} Network</p><h3>Found in Claude and ChatGPT</h3><p>By every client who adds {name} Network.</p><SeoArt name="found" /></div>
              <div className="tile" data-in><p className="tag">Your domain <span className="soon">Coming soon</span></p><h3>On your own address</h3><p>On Team, Agency, Grow and Scale.</p><SeoArt name="domain" /></div>
            </div>
          </div>
        </section>
        <section aria-labelledby="ai-h">
          <div className="wrap">
            <h2 id="ai-h" data-in>AI visibility, for Network members <span className="soon">Planned</span></h2>
            <p className="lead-dark" data-in>Each day, the visibility agent does what will get you named most. It drafts. You approve. Over a month, it adds up to all of this.</p>
            <div className="zigzag">
              <div className="zig">
                <div className="zig-art" data-in><AgentArt name="track" /></div>
                <div className="zig-text" data-in><p className="tag">Track</p><h3>See where you are named</h3><ul><li><b>AI mention tracking.</b> Ask ChatGPT, Claude, Perplexity and Gemini about your field, and fix what they get wrong</li><li><b>The questions clients ask.</b> What your clients search and ask, and who shows up for it today</li><li><b>One question per page.</b> Every page gets the searches it should win, so no two pages compete</li></ul></div>
              </div>
              <div className="zig">
                <div className="zig-art" data-in><AgentArt name="write" /></div>
                <div className="zig-text" data-in><p className="tag">Write</p><h3>Drafts that wait for your yes</h3><ul><li><b>Guides, drafted for you.</b> Answers better than the page on top, published only after your yes</li><li><b>"Which one" pages.</b> For the moment a client picks between you and someone else</li><li><b>Sharper pages.</b> Clearer titles, copy and links on the pages you already have</li></ul></div>
              </div>
              <div className="zig">
                <div className="zig-art" data-in><AgentArt name="keep" /></div>
                <div className="zig-text" data-in><p className="tag">Keep</p><h3>Stay right, and see what it brought</h3><ul><li><b>Index checks.</b> Make sure search engines and AI crawlers find and keep every page</li><li><b>Fact checks.</b> Your prices, hours and claims stay right everywhere they are quoted</li><li><b>A weekly report.</b> What changed, what moved, and what it brought you</li></ul></div>
              </div>
            </div>
            <p className="note" data-in>Plus listings where it counts, such as your Google Business Profile and Trustpilot page.</p>
          </div>
        </section>
        <section aria-labelledby="flow-h">
          <div className="wrap">
            <h2 id="flow-h" data-in>Nothing ships without your yes</h2>
            <ol className="timeline">
              <li className="tl-step" data-in><p className="tag">Step 1</p><h3>The agent finds a gap</h3><p>A question you should answer, a fact that is wrong, a page that is slow.</p></li>
              <li className="tl-step" data-in><p className="tag">Step 2</p><h3>It drafts the change</h3><p>A new article, a fixed title, a corrected price.</p></li>
              <li className="tl-step agent" data-in><p className="tag">Step 3</p><h3>You approve it</h3><p>In the dash or your team chat, with one press.</p></li>
              <li className="tl-step" data-in><p className="tag">Step 4</p><h3>It ships and is tracked</h3><p>The weekly report shows what moved.</p></li>
            </ol>
            <p className="term-line" data-in><PMark />We report what happened. We never promise rankings.</p>
          </div>
        </section>
        <FaqList title="Questions about getting found" items={faq} /><CloseCta />
      </div>
    </>
  );
}
