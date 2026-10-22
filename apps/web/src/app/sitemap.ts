import type { MetadataRoute } from "next";

import { platformDomain } from "@/lib/platform";
import { sitePaths } from "@/lib/site/llms";
import { absoluteUrl } from "@/lib/site/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const domain = platformDomain();
  return sitePaths().map((p) => ({ url: absoluteUrl(p, domain), lastModified: "2026-10-19" }));
}
