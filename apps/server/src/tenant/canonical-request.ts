import { canonicalLegacyHost } from "@jendal-workspace/core/tenancy/legacy-host";

type DomainConfig = Parameters<typeof canonicalLegacyHost>[1];

export function canonicalRequest(request: Request, domains: DomainConfig): Request {
  const url = new URL(request.url);
  const canonical = canonicalLegacyHost(url.hostname, domains);
  if (!canonical) return request;
  url.hostname = canonical;
  const headers = new Headers(request.headers);
  headers.set("Host", canonical);
  // Retain Origin, method and body. Changing Origin would bypass CSRF checks.
  return new Request(url, new Request(request, { headers }));
}
