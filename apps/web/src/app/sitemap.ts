import type { MetadataRoute } from "next";

import { sitePaths } from "@/lib/site/llms";
import { absoluteUrl } from "@/lib/site/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitePaths().map((p) => ({ url: absoluteUrl(p), lastModified: "2026-10-19" }));
}
