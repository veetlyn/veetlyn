import { isWaitlistOnly } from "@/lib/launch";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { contactEmail } from "@/content/legal/meta";
import { AUDIENCES } from "@/content/site/audiences";
import { platformSite } from "@/lib/platform";

export default function SiteFooter() {
  const { name, domain } = platformSite();
  const email = contactEmail(domain);
  const platformLinks = [
    ["/network", `${name} Network`],
    ["/discover", "Discover"],
    ["/visibility", "Get found"],
    ["/pricing", "Pricing"],
    ["/blog", "Blog"],
    ["/contact", "Contact"],
  ] as const;
  return (
    <footer className="wrap site">
      <div className="brand">
        <Link className="mark" href="/">
          <BrandMark />
          {name}
        </Link>
        <p>Sell products and services inside AI, paid through PayPal.</p>
      </div>
      <div>
        <b>Sell</b>
        {AUDIENCES.map((a) => (
          <Link key={a.path} href={a.path}>
            {a.label}
          </Link>
        ))}
      </div>
      <div>
        <b>{name}</b>
        {platformLinks.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
        <a href={`mailto:${email}`}>{email}</a>
      </div>
      <p className="small">
        {isWaitlistOnly() ? "Coming soon. Join the waitlist for launch news. " : "Sandbox prototype. "}
        Walk Crew, Amadou, Clay Room, Roast House, Maison Lune, Coco Nails, Logo Bot, Inès and the Discover listings are examples.
      </p>
      <nav className="legal" aria-label="Legal">
        <Link href="/legal/terms">Terms of service</Link>
        <Link href="/legal/privacy">Privacy policy</Link>
        <Link href="/legal/acceptable-use">Acceptable use policy</Link>
        <span>© 2026 {name}</span>
      </nav>
    </footer>
  );
}
