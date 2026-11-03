// Where a seller's public site lives. Production: <slug>.<store domain>. Staging's store domain is
// staging.<store zone>, two labels down, where the zone's free certificate (*.<zone>) does not reach; so staging
// sellers live one label down instead, at <slug>-staging.<zone>, served by the staging Worker's
// *-staging.<zone> route. Production refuses slugs ending in -staging (validateStoreSlug), so the two never meet.
export const STAGING_SELLER_SUFFIX = "-staging";
const STAGING_PREFIX = "staging.";

// The text after the slug in a seller's host: ".acme.test" in production, "-staging.acme.test" on staging.
export function sellerHostSuffix(storeDomain: string): string {
  return storeDomain.startsWith(STAGING_PREFIX)
    ? `${STAGING_SELLER_SUFFIX}.${storeDomain.slice(STAGING_PREFIX.length)}`
    : `.${storeDomain}`;
}

export function sellerHost(slug: string, storeDomain: string): string {
  return `${slug}${sellerHostSuffix(storeDomain)}`;
}

// The host-source that covers every seller site of a stage, for content-security allowlists. CSP wildcards only
// stand for whole labels, so staging's allows the whole zone.
export function sellerHostWildcard(storeDomain: string): string {
  return storeDomain.startsWith(STAGING_PREFIX) ? `*.${storeDomain.slice(STAGING_PREFIX.length)}` : `*.${storeDomain}`;
}
