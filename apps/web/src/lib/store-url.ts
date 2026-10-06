export type StoreUrlParts = { prefix: string; suffix: string };

// Local stages serve stores on *.localhost over http on the web port; deployed and tunnel hosts use https.
export function storeUrlParts(storeDomain: string, requestHost: string): StoreUrlParts {
  const port = /:\d+$/.exec(requestHost)?.[0] ?? "";
  const local = storeDomain === "localhost";
  return { prefix: local ? "http://" : "https://", suffix: `.${storeDomain}${local ? port : ""}` };
}

export function storeUrl(slug: string, parts: StoreUrlParts): string {
  return `${parts.prefix}${slug}${parts.suffix}`;
}
