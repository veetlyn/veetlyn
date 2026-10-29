import { validateStoreSlug } from "./slug";

// Exact configured suffixes only: never redirect a custom seller domain or an
// unrecognized platform hostname during a brand/domain cutover.
export function canonicalLegacyHost(hostname: string, domains: {
  platformDomain: string;
  storeDomain: string;
  legacyPlatformDomain?: string;
  legacyStoreDomain?: string;
}): string | null {
  if (domains.legacyPlatformDomain) {
    for (const prefix of ["", "www.", "dash.", "admin.", "api."]) {
      if (hostname === `${prefix}${domains.legacyPlatformDomain}`) return `${prefix}${domains.platformDomain}`;
    }
  }
  if (domains.legacyStoreDomain && hostname.endsWith(`.${domains.legacyStoreDomain}`)) {
    const slug = hostname.slice(0, -domains.legacyStoreDomain.length - 1);
    if (validateStoreSlug(slug).ok) return `${slug}.${domains.storeDomain}`;
  }
  return null;
}
