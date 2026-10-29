import { minorToPriceInput } from "../money";
import { daysLabel, priceLabel } from "../offering-labels";

// What the seller's site needs for search and AI answers; structural so tests need no api payload.
export type SellerSeoPage = {
  name: string;
  product: "services" | "store";
  status: "draft" | "active" | "suspended";
  bio: string;
  currency: string;
  offerings: ReadonlyArray<{
    name: string;
    description: string;
    priceMinMinor: number;
    priceMaxMinor: number;
    daysMin: number;
    daysMax: number;
  }>;
  products: ReadonlyArray<{ id: string; title: string; description: string; priceMinor: number }>;
};

// Paths that carry a private token or a checkout step; they never belong in an index.
export const SELLER_PRIVATE_PATHS = ["/c/", "/pay/", "/orders/", "/buy/"] as const;

// Search engines cut descriptions near 160 characters; cutting at a word keeps the snippet readable.
function clip(text: string, max = 160): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const boundary = flat.lastIndexOf(" ", max - 1);
  return `${flat.slice(0, boundary > 0 ? boundary : max - 1)}…`;
}

export const isIndexableSeller = (page: Pick<SellerSeoPage, "status">) => page.status === "active";

export function sellerDescription(page: SellerSeoPage, platform: string): string {
  if (page.bio.trim()) return clip(page.bio);
  const what = page.offerings.length > 0 ? page.offerings.slice(0, 3).map((o) => o.name).join(", ") : null;
  if (page.product === "services") {
    return clip(`${page.name}${what ? `: ${what}` : ""}. Request a quote and pay with PayPal on ${platform}.`);
  }
  return clip(`${page.name}: digital products, paid with PayPal on ${platform}.`);
}

export function sellerJsonLd(page: SellerSeoPage, url: string) {
  const id = `${url}/#seller`;
  const services = page.offerings.map((o) => ({
    "@type": "Offer" as const,
    itemOffered: { "@type": "Service" as const, name: o.name, description: o.description || undefined, provider: { "@id": id } },
    priceSpecification: {
      "@type": "PriceSpecification" as const,
      priceCurrency: page.currency,
      minPrice: minorToPriceInput(o.priceMinMinor),
      maxPrice: minorToPriceInput(o.priceMaxMinor),
    },
    url: `${url}/request`,
  }));
  const products = page.products.map((p) => ({
    "@type": "Offer" as const,
    itemOffered: { "@type": "Product" as const, name: p.title, description: p.description || undefined },
    price: minorToPriceInput(p.priceMinor),
    priceCurrency: page.currency,
    availability: "https://schema.org/InStock",
    url: `${url}/buy/${p.id}`,
  }));
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": page.product === "services" ? "ProfessionalService" : "Store",
        "@id": id,
        name: page.name,
        url: `${url}/`,
        description: page.bio.trim() || undefined,
        paymentAccepted: "PayPal",
        currenciesAccepted: page.currency,
        makesOffer: services.length + products.length > 0 ? [...services, ...products] : undefined,
      },
      { "@type": "WebSite", "@id": `${url}/#site`, url: `${url}/`, name: page.name, publisher: { "@id": id } },
    ],
  };
}

export function sellerRobotsTxt(url: string, indexable: boolean): string {
  if (!indexable) return "User-agent: *\nDisallow: /\n";
  return ["User-agent: *", "Allow: /", ...SELLER_PRIVATE_PATHS.map((p) => `Disallow: ${p}`), "", `Sitemap: ${url}/sitemap.xml`, ""].join(
    "\n",
  );
}

const xmlEscape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function sellerSitemapXml(url: string, paths: readonly string[]): string {
  const urls = paths.map((p) => `  <url><loc>${xmlEscape(`${url}${p}`)}</loc></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, "</urlset>", ""].join("\n");
}

export function sellerLlmsTxt(page: SellerSeoPage, url: string, platform: { name: string; site: string }): string {
  const lines = [`# ${page.name}`, "", `> ${sellerDescription(page, platform.name)}`, ""];
  if (page.product === "services") {
    lines.push("## Services");
    if (page.offerings.length === 0) lines.push(`- [Request a quote](${url}/request): describe the work you need`);
    for (const o of page.offerings) {
      lines.push(`- ${o.name}: usually ${priceLabel(o, page.currency)}, ${daysLabel(o)}${o.description ? `. ${clip(o.description, 200)}` : ""}`);
    }
    lines.push("", `Ask for a quote at ${url}/request. The client pays a deposit and the balance with PayPal.`, "");
  }
  if (page.products.length > 0) {
    lines.push("## Products");
    for (const p of page.products) {
      lines.push(`- [${p.title}](${url}/buy/${p.id}): ${priceLabel({ priceMinMinor: p.priceMinor, priceMaxMinor: p.priceMinor }, page.currency)}${p.description ? `. ${clip(p.description, 200)}` : ""}`);
    }
    lines.push("");
  }
  lines.push(
    "## About payments",
    `- Payments run through PayPal on ${platform.name} (${platform.site}). The payer approves every payment in PayPal.`,
    `- Clients using Claude or ChatGPT can reach this seller through ${platform.name} Network: ${platform.site}/network`,
    "",
  );
  return lines.join("\n");
}
