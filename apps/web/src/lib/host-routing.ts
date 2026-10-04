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
