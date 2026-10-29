import { sellerSite } from "@/lib/seller-site";
import { sellerRobotsTxt } from "@/lib/site/seller-seo";

export async function GET() {
  const site = await sellerSite();
  if (!site) return new Response("Not found", { status: 404 });
  return new Response(sellerRobotsTxt(site.url, site.indexable), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
