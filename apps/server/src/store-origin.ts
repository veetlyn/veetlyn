// Mirrors apps/web lib/store-url.ts: local stages serve stores over http on the web port; other hosts use https.
export function storeOriginFor(input: { storeDomain: string; adminOrigin: string }): (slug: string) => string {
  const local = input.storeDomain === "localhost";
  const port = local ? new URL(input.adminOrigin).port : "";
  return (slug) => `${local ? "http" : "https"}://${slug}.${input.storeDomain}${port ? `:${port}` : ""}`;
}
