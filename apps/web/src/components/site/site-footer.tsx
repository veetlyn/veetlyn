import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { CONTACT_EMAIL } from "@/content/legal/meta";
import { AUDIENCES } from "@/content/site/audiences";

const PLATFORM_LINKS = [
  ["/network", "Payleor Network"],
  ["/discover", "Discover"],
  ["/visibility", "Get found"],
  ["/pricing", "Pricing"],
  ["/blog", "Blog"],
  ["/contact", "Contact"],
] as const;

export default function SiteFooter() {
  return (
    <footer className="wrap site">
      <div className="brand">
        <Link className="mark" href="/">
          <BrandMark />
          Payleor
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
        <b>Payleor</b>
        {PLATFORM_LINKS.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </div>
      <p className="small">
        Sandbox prototype. Walk Crew, Amadou, Clay Room, Roast House, Maison Lune, Coco Nails, Logo Bot, Inès and the
        Discover listings are examples.
      </p>
      <nav className="legal" aria-label="Legal">
        <Link href="/legal/terms">Terms of service</Link>
        <Link href="/legal/privacy">Privacy policy</Link>
        <Link href="/legal/acceptable-use">Acceptable use policy</Link>
        <span>© 2026 Payleor</span>
      </nav>
    </footer>
  );
}
