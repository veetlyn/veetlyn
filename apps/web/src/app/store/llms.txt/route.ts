import { platformName } from "@/lib/platform";
import { sellerSite } from "@/lib/seller-site";
import { getPlatformOrigins } from "@/lib/server-api";
import { isIndexableSeller, sellerLlmsTxt } from "@/lib/site/seller-seo";

export async function GET() {
  const site = await sellerSite();
  if (!site || !isIndexableSeller(site.page)) return new Response("Not found", { status: 404 });
  const { site: platformSite } = await getPlatformOrigins();
  return new Response(sellerLlmsTxt(site.page, site.url, { name: platformName(), site: platformSite }), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
