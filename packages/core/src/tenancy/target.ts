import { validateStoreSlug } from "./slug";

export type PlatformApp = "www" | "admin" | "api" | "mcp";

export type RequestTarget =
  | { kind: "platform"; app: PlatformApp }
  | { kind: "store"; slug: string; basePath: string }
  | { kind: "custom-domain"; hostname: string }
  | { kind: "unknown" };

// A Map, not an object literal, so labels such as "constructor" never match inherited properties.
const PLATFORM_APPS = new Map<string, PlatformApp>([
  ["www", "www"],
  ["admin", "admin"],
  ["api", "api"],
  ["mcp", "mcp"],
]);
const PATH_STORE_LABEL = "store";
const VALID_HOSTNAME = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/;

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

// Request slugs must already be clean; the trimming and lowercasing in validateStoreSlug is for form input.
function exactSlug(candidate: string): string | null {
  const result = validateStoreSlug(candidate);
  return result.ok && result.slug === candidate ? result.slug : null;
}

export function parseRequestTarget(
  input: { hostname: string; pathname: string },
  platformDomain: string,
): RequestTarget {
  const hostname = normalizeHostname(input.hostname);
  const domain = normalizeHostname(platformDomain);

  if (!VALID_HOSTNAME.test(hostname) || !VALID_HOSTNAME.test(domain)) return { kind: "unknown" };
  if (hostname === domain) return { kind: "platform", app: "www" };
  if (!hostname.endsWith(`.${domain}`)) return { kind: "custom-domain", hostname };

  const label = hostname.slice(0, -(domain.length + 1));
  if (label.includes(".")) return { kind: "unknown" };

  const app = PLATFORM_APPS.get(label);
  if (app) return { kind: "platform", app };

  if (label === PATH_STORE_LABEL) {
    const slug = exactSlug(input.pathname.split("/")[1] ?? "");
    return slug ? { kind: "store", slug, basePath: `/${slug}` } : { kind: "unknown" };
  }

  const slug = exactSlug(label);
  return slug ? { kind: "store", slug, basePath: "" } : { kind: "unknown" };
}

// Routes are written once; store.{domain}/{slug}/x is routed as /x, like {slug}.{domain}/x.
export function routingPath(target: RequestTarget, pathname: string): string {
  if (target.kind !== "store" || target.basePath === "") return pathname;
  if (pathname === target.basePath) return "/";
  if (!pathname.startsWith(`${target.basePath}/`)) return pathname;
  return pathname.slice(target.basePath.length);
}
