// Hosts of the deployed stages. Production owns the apex domains; staging sits one label down, where
// Universal SSL does not reach, so every staging host is a Worker custom domain with its own certificate
// (seller sites only for the slugs listed in STAGING_STORE_SLUGS) and staging adds no zone routes.

export type DeployedStage = "production" | "staging";

const PLATFORM_ZONE = "payleor.com";
const STORE_ZONE = "payleor.app";
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

export function deployedHosts(stage: DeployedStage, stagingStoreSlugs: readonly string[]): DeployedHosts {
  const prefix = stage === "production" ? "" : "staging.";
  const platformDomain = `${prefix}${PLATFORM_ZONE}`;
  const storeDomain = `${prefix}${STORE_ZONE}`;
  const storeHosts = stage === "production" ? [] : stagingStoreSlugs.map((slug) => `${slug}.${storeDomain}`);
  return {
    platformDomain,
    storeDomain,
    dashOrigin: `https://dash.${platformDomain}`,
    web: {
      domain: {
        name: platformDomain,
        // admin. stays attached so the web app can redirect it to dash. with its path.
        aliases: [`dash.${platformDomain}`, `admin.${platformDomain}`, ...storeHosts],
        redirects: [`www.${platformDomain}`],
      },
      routes: stage === "production" ? [{ pattern: `*.${storeDomain}/*`, zoneName: STORE_ZONE }] : [],
    },
    api: { domain: `api.${platformDomain}` },
    fileOrigins: [`https://${platformDomain}`, `https://dash.${platformDomain}`],
  };
}
