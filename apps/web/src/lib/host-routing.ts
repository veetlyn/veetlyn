import { type HostDomains, parseRequestTarget } from "@jendal-workspace/core";

const API_PATH_PREFIXES = ["/api/", "/trpc/"];

export function shouldForwardToApi(url: URL): boolean {
  return API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

export type HostRoute =
  | { kind: "pass" }
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; location: string }
  | { kind: "not-found" };

const INTERNAL_ROUTE_TREES = new Set(["admin", "store"]);

export function routeForHost(url: URL, domains: HostDomains): HostRoute {
  // The route trees are reachable only through a rewrite, so one host never serves another host's pages.
  if (INTERNAL_ROUTE_TREES.has(url.pathname.split("/")[1] ?? "")) return { kind: "not-found" };

  const target = parseRequestTarget(url.hostname, domains);
  const suffix = url.pathname === "/" ? "" : url.pathname;

  switch (target.kind) {
    case "platform":
      if (target.app === "www") return { kind: "pass" };
      if (target.app === "dash") return { kind: "rewrite", pathname: `/admin${suffix}` };
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
