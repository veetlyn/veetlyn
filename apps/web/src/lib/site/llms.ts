import { POSTS } from "../../content/blog/posts";
import { AUDIENCES } from "../../content/site/audiences";
import { PRICE_FACTS } from "./fees";
import { absoluteUrl } from "./seo";

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

export const sitePaths = (): string[] => [...STATIC_PATHS, ...POSTS.map((p) => `/blog/${p.slug}`)];

export function llmsTxt(): string {
  const u = absoluteUrl;
  const { from, minFee, maxFee, network } = PRICE_FACTS;
  return [
    "# Payleor",
    "",
    "> Payleor lets freelancers, agencies, stores and studios sell services and products inside Claude and ChatGPT through Payleor Network, a connector clients add to their AI. The AI finds sellers, asks questions, requests quotes and fills carts. The client approves every payment in PayPal on Payleor's page; a person or a rule the team sets approves every payout. Payleor never holds the money.",
    "",
    "## Product",
    `- [Payleor Network](${u("/network")}): the connector (api.payleor.com/mcp), the gaps it fills, membership, and how clients add it`,
    `- [Discover](${u("/discover")}): services, courses, downloads and goods from sellers on the network`,
    `- [Get found](${u("/visibility")}): web SEO, and AI visibility for Network members`,
    `- [Pricing](${u("/pricing")}): plans from ${from} a month, ${minFee.replace("%", "")} to ${maxFee} per payment or order, and ${network} once on clients the network brings`,
    "",
    "## Who it is for",
    ...AUDIENCES.map((a) => `- [${a.label}](${u(a.path)}): ${a.tagline}`),
    "",
    "## Guides",
    ...POSTS.map((p) => `- [${p.title}](${u(`/blog/${p.slug}`)}): ${p.description}`),
    "",
    "## Optional",
    `- [Contact](${u("/contact")}): Enterprise, membership, partnerships and support, contact@payleor.com`,
    "",
  ].join("\n");
}
