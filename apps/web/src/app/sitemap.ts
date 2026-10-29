import type { MetadataRoute } from "next";

import { platformDomain } from "@/lib/platform";
import { sitemapEntries } from "@/lib/site/llms";
import { absoluteUrl } from "@/lib/site/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const domain = platformDomain();
  return sitemapEntries().map(({ path, lastModified }) => ({ url: absoluteUrl(path, domain), lastModified }));
}
