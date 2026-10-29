import type { MetadataRoute } from "next";

import { isIndexedStage, platformDomain } from "@/lib/platform";
import { absoluteUrl } from "@/lib/site/seo";

// Every crawler may read the site, the AI assistants' crawlers included, each named so a later rule for one of
// them cannot silently shut it out.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
];

export default function robots(): MetadataRoute.Robots {
  if (!isIndexedStage()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/" }, ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" }))],
    sitemap: absoluteUrl("/sitemap.xml", platformDomain()),
  };
}
