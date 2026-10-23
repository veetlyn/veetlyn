import { posts } from "../../content/blog/posts";
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

export const sitePaths = (): string[] => [
  ...STATIC_PATHS,
  ...posts({ name: "", domain: "" }).map((p) => `/blog/${p.slug}`),
];

export function llmsTxt(site: SeoSite): string {
  const { name, domain } = site;
  const u = (path: string) => absoluteUrl(path, domain);
  const { from, minFee, maxFee, network } = PRICE_FACTS;
  return [
    `# ${name}`,
    "",
    `> ${name} lets freelancers, agencies, stores and studios sell services and products inside Claude and ChatGPT through ${name} Network, a connector clients add to their AI. The AI finds sellers, asks questions, requests quotes and fills carts. The client approves every payment in PayPal on ${name}'s page; a person or a rule the team sets approves every payout. ${name} never holds the money.`,
    "",
    "## Product",
    `- [${name} Network](${u("/network")}): the connector (api.${domain}/mcp), the gaps it fills, membership, and how clients add it`,
    `- [Discover](${u("/discover")}): services, courses, downloads and goods from sellers on the network`,
    `- [Get found](${u("/visibility")}): web SEO, and AI visibility for Network members`,
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
