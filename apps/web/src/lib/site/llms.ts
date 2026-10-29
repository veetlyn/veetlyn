import { posts } from "../../content/blog/posts";
import { LEGAL_LAST_UPDATED } from "../../content/legal/meta";
import { AUDIENCES } from "../../content/site/audiences";
import { PRICE_FACTS } from "./fees";
import { absoluteUrl, type SeoSite } from "./seo";

export const STATIC_PATHS = [
  "/",
  "/network",
  "/discover",
  "/visibility",
  "/freelancers",
  "/agencies",
  "/stores",
  "/studios",
  "/pricing",
  "/contact",
  "/blog",
] as const;

const LEGAL_PATHS = ["/legal/terms", "/legal/privacy", "/legal/acceptable-use"] as const;

// The last copy change on the landing pages; bump it with a content release so crawlers revisit.
const SITE_UPDATED = "2026-10-29";

export const sitemapEntries = (): { path: string; lastModified: string }[] => [
  ...STATIC_PATHS.map((path) => ({ path, lastModified: SITE_UPDATED })),
  ...LEGAL_PATHS.map((path) => ({ path, lastModified: LEGAL_LAST_UPDATED.toISOString().slice(0, 10) })),
  ...posts({ name: "", domain: "" }).map((p) => ({ path: `/blog/${p.slug}`, lastModified: p.updated ?? p.date })),
];

export function llmsTxt(site: SeoSite): string {
  const { name, domain } = site;
  const u = (path: string) => absoluteUrl(path, domain);
  const { from, minFee, maxFee, network } = PRICE_FACTS;
  return [
    `# ${name}`,
    "",
    `> ${name} lets freelancers, agencies, stores and studios connect their services to clients using Claude and ChatGPT through ${name} Network, a connector clients add to their AI. The AI finds sellers, asks questions, requests quotes and follows projects. Digital products use checkout on the seller’s own page. The client approves every payment in PayPal on ${name}'s page; a person or a rule the team sets approves every payout. ${name} never holds the money.`,
    "",
    "## Product",
    `- [${name} Network](${u("/network")}): the connector (api.${domain}/mcp), the gaps it fills, membership, and how clients add it`,
    `- [Discover](${u("/discover")}): illustrative seller listings; live seller discovery is planned`,
    `- [Get found](${u("/visibility")}): web SEO (coming soon), and AI visibility for Network members (planned)`,
    `- [Pricing](${u("/pricing")}): plans from ${from} a month, ${minFee.replace("%", "")} to ${maxFee} per payment or order, and ${network} once on clients the network brings`,
    "",
    "## Who it is for",
    ...AUDIENCES.map((a) => `- [${a.label}](${u(a.path)}): ${a.tagline}`),
    "",
    "## Guides",
    ...posts(site).map((p) => `- [${p.title}](${u(`/blog/${p.slug}`)}): ${p.description}`),
    "",
    "## Optional",
    `- [Contact](${u("/contact")}): Enterprise, membership, partnerships and support, contact@${domain}`,
    "",
  ].join("\n");
}
