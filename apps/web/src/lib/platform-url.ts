export type PlatformOrigins = { site: string; admin: string };

// Same rule as storeUrlParts: local stages use http and keep the port; deployed and tunnel hosts use https.
export function platformOrigins(platformDomain: string, requestHost: string): PlatformOrigins {
  const local = platformDomain === "localhost";
  const port = local ? (/:\d+$/.exec(requestHost)?.[0] ?? "") : "";
  const scheme = local ? "http://" : "https://";
  return { site: `${scheme}${platformDomain}${port}`, admin: `${scheme}admin.${platformDomain}${port}` };
}
