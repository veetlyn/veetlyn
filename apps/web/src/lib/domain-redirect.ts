import { canonicalLegacyHost } from "@jendal-workspace/core/tenancy/legacy-host";
import { shouldForwardToApi } from "./host-routing";

type DomainConfig = Parameters<typeof canonicalLegacyHost>[1];

export function domainRedirect(request: Request, domains: DomainConfig): Response | null {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method) || shouldForwardToApi(url)) return null;
  const storeRoots = [domains.storeDomain, `www.${domains.storeDomain}`];
  if (domains.legacyStoreDomain) storeRoots.push(domains.legacyStoreDomain, `www.${domains.legacyStoreDomain}`);
  let target = storeRoots.includes(url.hostname) ? domains.platformDomain : canonicalLegacyHost(url.hostname, domains);
  if (!target) return null;
  if (target === `www.${domains.platformDomain}`) target = domains.platformDomain;
  url.hostname = target;
  return new Response(null, { status: 307, headers: { Location: url.href, "Cache-Control": "no-store" } });
}
