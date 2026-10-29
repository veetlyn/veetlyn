import { shouldForwardToApi } from "./host-routing";

// The seller domain's root has no store of its own, so it sends visitors to the platform site.
export function domainRedirect(request: Request, domains: { platformDomain: string; storeDomain: string }): Response | null {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method) || shouldForwardToApi(url)) return null;
  if (url.hostname !== domains.storeDomain && url.hostname !== `www.${domains.storeDomain}`) return null;
  url.hostname = domains.platformDomain;
  return new Response(null, { status: 307, headers: { Location: url.href, "Cache-Control": "no-store" } });
}
