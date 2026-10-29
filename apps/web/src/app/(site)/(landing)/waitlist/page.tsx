import Link from "next/link";

import WaitlistForm from "@/components/site/waitlist-form";
import { platformSite } from "@/lib/platform";
import { pageMetadata } from "@/lib/site/seo";

export function generateMetadata() {
  return pageMetadata({ path: "/waitlist", title: "Join the waitlist", description: "Leave your email and we’ll let you know when we launch.", site: platformSite() });
}

export default function WaitlistPage() {
  const { name } = platformSite();
  return (
    <div className="band">
      <section className="wrap waitlist-hero" aria-labelledby="waitlist-title">
        <div className="waitlist-copy">
          <p className="tag">{name} · Launching soon</p>
          <h1 id="waitlist-title">Agentic ways of doing business.</h1>
          <p className="lead">
            Your requests, projects and payouts. One agent that follows the work,
            with your operating model guiding every step.
          </p>
          <p className="waitlist-audience">For independent professionals, studios and teams.</p>
          <Link className="link" href="/">Explore what’s coming <span aria-hidden="true">↗</span></Link>
        </div>
        <WaitlistForm />
      </section>
    </div>
  );
}
