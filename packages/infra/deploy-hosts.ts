// Hosts of the deployed stages. Production owns the apex domains; staging sits one label down, where
// Universal SSL does not reach, so every staging host is a Worker custom domain with its own certificate
// (seller sites only for the slugs listed in STAGING_STORE_SLUGS) and staging adds no zone routes.

export type DeployedStage = "production" | "staging";

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// The zones the deployed stages serve: the platform site and dashboard, and the seller storefronts.
export type Zones = { platformZone: string; storeZone: string };

export type DeployedHosts = {
  platformDomain: string;
  storeDomain: string;
  dashOrigin: string;
  web: {
    domain: { name: string; aliases: string[]; redirects: string[] };
    routes: { pattern: string; zoneName: string }[];
  };
  api: { domain: string };
  fileOrigins: string[];
};

export function parseDeployedStage(value: string | undefined): DeployedStage | undefined {
  return value === "production" || value === "staging" ? value : undefined;
}

export function storeSlugsFrom(value: string | undefined): string[] {
  const slugs = (value ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug !== "");
  const bad = slugs.find((slug) => !HOST_LABEL.test(slug));
  if (bad) throw new Error(`STAGING_STORE_SLUGS has "${bad}", which is not a host label.`);
  return slugs;
}

function checkZone(name: string, zone: string): void {
  const labels = zone.split(".");
  if (labels.length < 2 || labels.some((label) => !HOST_LABEL.test(label))) {
    throw new Error(`${name} has "${zone}", which is not a domain name.`);
  }
}

export function deployedHosts(stage: DeployedStage, stagingStoreSlugs: readonly string[], zones: Zones): DeployedHosts {
  checkZone("PLATFORM_ZONE", zones.platformZone);
  checkZone("STORE_ZONE", zones.storeZone);
  const prefix = stage === "production" ? "" : "staging.";
  const platformDomain = `${prefix}${zones.platformZone}`;
  const storeDomain = `${prefix}${zones.storeZone}`;
  const storeHosts = stage === "production" ? [] : stagingStoreSlugs.map((slug) => `${slug}.${storeDomain}`);
  return {
    platformDomain,
    storeDomain,
    dashOrigin: `https://dash.${platformDomain}`,
    web: {
      domain: {
        name: platformDomain,
        // admin. stays attached so the web app can redirect it to dash. with its path.
        aliases: [`dash.${platformDomain}`, `admin.${platformDomain}`, storeDomain, `www.${storeDomain}`, ...storeHosts],
        redirects: [`www.${platformDomain}`],
      },
      routes: stage === "production" ? [{ pattern: `*.${storeDomain}/*`, zoneName: zones.storeZone }] : [],
    },
    api: { domain: `api.${platformDomain}` },
    fileOrigins: [`https://${platformDomain}`, `https://dash.${platformDomain}`],
  };
}
