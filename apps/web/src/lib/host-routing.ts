import { parseRequestTarget, type RequestTarget, routingPath } from "@jendal-workspace/core";

const API_PATH_PREFIXES = ["/api/", "/trpc/"];

function targetAndPath(url: URL, platformDomain: string): { target: RequestTarget; path: string } {
  const target = parseRequestTarget({ hostname: url.hostname, pathname: url.pathname }, platformDomain);
  return { target, path: routingPath(target, url.pathname) };
}

export function shouldForwardToApi(url: URL, platformDomain: string): boolean {
  const { path } = targetAndPath(url, platformDomain);
  return API_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const BASE_PATH_HEADER = "x-jendal-base-path";

export type HostRoute =
  | { kind: "pass" }
  | { kind: "rewrite"; pathname: string; basePath: string }
  | { kind: "not-found" };

const INTERNAL_ROUTE_TREES = new Set(["admin", "store"]);

export function routeForHost(url: URL, platformDomain: string): HostRoute {
  // The route trees are reachable only through a rewrite, so one host never serves another host's pages.
  if (INTERNAL_ROUTE_TREES.has(url.pathname.split("/")[1] ?? "")) return { kind: "not-found" };

  const { target, path } = targetAndPath(url, platformDomain);
  const suffix = path === "/" ? "" : path;

  switch (target.kind) {
    case "platform":
      if (target.app === "www") return { kind: "pass" };
      if (target.app === "admin") return { kind: "rewrite", pathname: `/admin${suffix}`, basePath: "" };
      return { kind: "not-found" };
    case "store":
      return { kind: "rewrite", pathname: `/store${suffix}`, basePath: target.basePath };
    case "custom-domain":
      return { kind: "rewrite", pathname: `/store${suffix}`, basePath: "" };
    case "unknown":
      return { kind: "not-found" };
  }
}
