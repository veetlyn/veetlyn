import { policiesFor } from "@jendal-workspace/core";

import { sellerSite } from "@/lib/seller-site";
import { sellerSitemapXml } from "@/lib/site/seller-seo";

export async function GET() {
  const site = await sellerSite();
  if (!site) return new Response("Not found", { status: 404 });
  const { page, url, indexable } = site;
  // A commerce team's home is a placeholder until its products are listed.
  const home = page.product === "services" ? ["/"] : [];
  const paths = indexable ? [...home, ...policiesFor(page.product).map((p) => `/policies/${p}`)] : [];
  return new Response(sellerSitemapXml(url, paths), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
