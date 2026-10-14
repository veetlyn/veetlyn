import { type HostDomains, parseRequestTarget } from "@jendal-workspace/core";

// OAuth discovery for the issuer at {admin}/api/auth inserts the issuer path after the well-known name (RFC 8414).
const API_PATH_PREFIXES = [
  "/api/",
  "/trpc/",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
];

export function shouldForwardToApi(url: URL): boolean {
  return API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

export type HostRoute = { kind: "pass" } | { kind: "rewrite"; pathname: string } | { kind: "not-found" };

const INTERNAL_ROUTE_TREES = new Set(["admin", "store"]);

export function routeForHost(url: URL, domains: HostDomains): HostRoute {
  // The route trees are reachable only through a rewrite, so one host never serves another host's pages.
  if (INTERNAL_ROUTE_TREES.has(url.pathname.split("/")[1] ?? "")) return { kind: "not-found" };

  const target = parseRequestTarget(url.hostname, domains);
  const suffix = url.pathname === "/" ? "" : url.pathname;

  switch (target.kind) {
    case "platform":
      if (target.app === "www") return { kind: "pass" };
      if (target.app === "admin") return { kind: "rewrite", pathname: `/admin${suffix}` };
      return { kind: "not-found" };
    case "store":
    case "custom-domain":
      return { kind: "rewrite", pathname: `/store${suffix}` };
    case "unknown":
      return { kind: "not-found" };
  }
}
