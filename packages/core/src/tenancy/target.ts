import { validateStoreSlug } from "./slug";

export type PlatformApp = "www" | "admin" | "api" | "mcp";

export type RequestTarget =
  | { kind: "platform"; app: PlatformApp }
  | { kind: "store"; slug: string; basePath: string }
  | { kind: "custom-domain"; hostname: string }
  | { kind: "unknown" };

const PLATFORM_APPS: Record<string, PlatformApp> = { www: "www", admin: "admin", api: "api", mcp: "mcp" };
const PATH_STORE_LABEL = "store";

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function parseRequestTarget(
  input: { hostname: string; pathname: string },
  platformDomain: string,
): RequestTarget {
  const hostname = normalizeHostname(input.hostname);
  const domain = normalizeHostname(platformDomain);

  if (hostname === domain) return { kind: "platform", app: "www" };
  if (!hostname.endsWith(`.${domain}`)) return { kind: "custom-domain", hostname };

  const label = hostname.slice(0, -(domain.length + 1));
  if (label.includes(".")) return { kind: "unknown" };

  const app = PLATFORM_APPS[label];
  if (app) return { kind: "platform", app };

  if (label === PATH_STORE_LABEL) {
    const firstSegment = input.pathname.split("/")[1] ?? "";
    const result = validateStoreSlug(firstSegment);
    return result.ok ? { kind: "store", slug: result.slug, basePath: `/${result.slug}` } : { kind: "unknown" };
  }

  const result = validateStoreSlug(label);
  return result.ok ? { kind: "store", slug: result.slug, basePath: "" } : { kind: "unknown" };
}

// Routes are written once; store.{domain}/{slug}/x is routed as /x, like {slug}.{domain}/x.
export function routingPath(target: RequestTarget, pathname: string): string {
  if (target.kind !== "store" || target.basePath === "") return pathname;
  return pathname.slice(target.basePath.length) || "/";
}
