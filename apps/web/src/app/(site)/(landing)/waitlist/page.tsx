import WaitlistForm from "@/components/site/waitlist-form";
import { platformSite } from "@/lib/platform";
import { pageMetadata } from "@/lib/site/seo";

export function generateMetadata() {
  return pageMetadata({ path: "/waitlist", title: "Join the waitlist", description: "Leave your email and we’ll let you know when we launch.", site: platformSite() });
}

export default function WaitlistPage() {
  return <section className="wrap hero page solo"><div>
    <p className="kind">Coming soon</p>
    <h1>Be there at launch</h1>
    <p className="lead">We’re getting ready. Leave your email and we’ll let you know when {platformSite().name} opens.</p>
    <WaitlistForm />
  </div></section>;
}
