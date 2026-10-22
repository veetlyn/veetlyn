import { platformSite } from "@/lib/platform";
import { llmsTxt } from "@/lib/site/llms";

export function GET() {
  return new Response(llmsTxt(platformSite()), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
