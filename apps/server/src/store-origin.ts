// Mirrors apps/web lib/store-url.ts: local stages serve stores over http on the web port; other hosts use https.
export function storeOriginFor(input: { storeDomain: string; dashOrigin: string }): (slug: string) => string {
  const local = input.storeDomain === "localhost";
  const port = local ? new URL(input.dashOrigin).port : "";
  return (slug) => `${local ? "http" : "https"}://${slug}.${input.storeDomain}${port ? `:${port}` : ""}`;
}

// The site lives on the platform domain itself; the dash origin is the same host under the dash label.
export function siteOriginFor(dashOrigin: string): string {
  return dashOrigin.replace("://dash.", "://");
}
