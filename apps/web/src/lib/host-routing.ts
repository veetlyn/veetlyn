import { type HostDomains, parseRequestTarget } from "@jendal-workspace/core";

// OAuth discovery for the issuer at {dash}/api/auth puts the issuer path after the well-known name (RFC 8414),
// so those paths reach Better Auth on the api Worker too.
const API_PATH_PREFIXES = [
  "/api/",
  "/trpc/",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
];

export function shouldForwardToApi(url: URL): boolean {
  return API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

export type HostRoute =
  | { kind: "pass" }
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; location: string }
  | { kind: "not-found" };

const INTERNAL_ROUTE_TREES = new Set(["dash", "admin", "store"]);

export function routeForHost(url: URL, domains: HostDomains, publicAccess = "open"): HostRoute {
  if (publicAccess === "waitlist") {
    const target = parseRequestTarget(url.hostname, domains);
    if (target.kind === "platform" && (target.app === "dash" || target.app === "admin")) {
      return { kind: "redirect", location: `https://${domains.platformDomain}/waitlist` };
    }
    if (target.kind === "platform" && target.app === "www" && ["/login", "/signup", "/sign-in", "/sign-up"].includes(url.pathname)) {
      return { kind: "redirect", location: new URL("/waitlist", url).href };
    }
  }
  // The route trees are reachable only through a rewrite, so one host never serves another host's pages.
  if (INTERNAL_ROUTE_TREES.has(url.pathname.split("/")[1] ?? "")) return { kind: "not-found" };

  const target = parseRequestTarget(url.hostname, domains);
  const suffix = url.pathname === "/" ? "" : url.pathname;

  switch (target.kind) {
    case "platform":
      if (target.app === "www") return { kind: "pass" };
      if (target.app === "dash") return { kind: "rewrite", pathname: `/dash${suffix}` };
      if (target.app === "admin") {
        const location = new URL(url);
        location.hostname = `dash.${url.hostname.slice("admin.".length)}`;
        return { kind: "redirect", location: location.href };
      }
      return { kind: "not-found" };
    case "store":
    case "custom-domain":
      return { kind: "rewrite", pathname: `/store${suffix}` };
    case "unknown":
      return { kind: "not-found" };
  }
}
