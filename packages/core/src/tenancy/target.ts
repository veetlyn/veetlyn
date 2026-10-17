import { validateStoreSlug } from "./slug";

export type PlatformApp = "www" | "dash" | "admin" | "api" | "mcp";

export type RequestTarget =
  | { kind: "platform"; app: PlatformApp }
  | { kind: "store"; slug: string }
  | { kind: "custom-domain"; hostname: string }
  | { kind: "unknown" };

export type HostDomains = { platformDomain: string; storeDomain: string };

// A Map, not an object literal, so labels such as "constructor" never match inherited properties. "admin" is the
// dashboard's old host; the web app redirects it to "dash".
const PLATFORM_APPS = new Map<string, PlatformApp>([
  ["www", "www"],
  ["dash", "dash"],
  ["admin", "admin"],
  ["api", "api"],
  ["mcp", "mcp"],
]);
const VALID_HOSTNAME = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/;

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

// Request slugs must already be clean; the trimming and lowercasing in validateStoreSlug is for form input.
function exactSlug(candidate: string): string | null {
  const result = validateStoreSlug(candidate);
  return result.ok && result.slug === candidate ? result.slug : null;
}

// The label directly under `domain`, "" for a deeper subdomain, or null when the host is not under it.
function labelUnder(hostname: string, domain: string): string | null {
  if (!hostname.endsWith(`.${domain}`)) return null;
  const label = hostname.slice(0, -(domain.length + 1));
  return label.includes(".") ? "" : label;
}

export function parseRequestTarget(rawHostname: string, domains: HostDomains): RequestTarget {
  const hostname = normalizeHostname(rawHostname);
  const platform = normalizeHostname(domains.platformDomain);
  const store = normalizeHostname(domains.storeDomain);
  if (![hostname, platform, store].every((h) => VALID_HOSTNAME.test(h))) return { kind: "unknown" };
  if (hostname === platform) return { kind: "platform", app: "www" };

  const platformLabel = labelUnder(hostname, platform);
  const app = platformLabel ? PLATFORM_APPS.get(platformLabel) : undefined;
  if (app) return { kind: "platform", app };

  const storeLabel = labelUnder(hostname, store);
  if (storeLabel !== null) {
    const slug = exactSlug(storeLabel);
    return slug ? { kind: "store", slug } : { kind: "unknown" };
  }
  if (platformLabel !== null || hostname === store) return { kind: "unknown" };
  return { kind: "custom-domain", hostname };
}
