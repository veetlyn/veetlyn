// Local Alchemy stages, their ports, and how the Cloudflare named tunnel exposes one of them.
// alchemy.run.ts and scripts/tunnel.ts both read this file, so ports and hostnames stay in one place.
//
// The tunnel uses the production host layout on TUNNEL_DOMAIN (D): the web app on D and every
// subdomain of D, the api on api.D. With TUNNEL_STORE_DOMAIN (S), stores move to *.S as they do in
// production (PLATFORM_DOMAIN payleor.com, STORE_DOMAIN payleor.app).

export type LocalStage = "dev" | "preprod";

type LocalPorts = { web: number; api: number };

const PORTS = {
  dev: { web: 3001, api: 3000 },
  preprod: { web: 3101, api: 3100 },
} satisfies Record<LocalStage, LocalPorts>;

export type StageUrls = { platformDomain: string; storeDomain: string; platform: string; admin: string };
export type IngressRule = { hostname: string; port: number };
export type TunnelSettings = { domain: string; storeDomain: string; stage: LocalStage };

export function parseLocalStage(value: string | undefined): LocalStage | undefined {
  return value === "dev" || value === "preprod" ? value : undefined;
}

export function localPorts(stage: LocalStage): LocalPorts {
  return PORTS[stage];
}

// Reads TUNNEL_DOMAIN, TUNNEL_STORE_DOMAIN (default TUNNEL_DOMAIN) and TUNNEL_STAGE (default "dev").
// Undefined when no tunnel is configured.
export function tunnelSettings(env: Record<string, string | undefined>): TunnelSettings | undefined {
  const domain = env.TUNNEL_DOMAIN?.trim().toLowerCase();
  if (!domain) return undefined;
  const storeDomain = env.TUNNEL_STORE_DOMAIN?.trim().toLowerCase() || domain;
  const stage = parseLocalStage(env.TUNNEL_STAGE || "dev");
  if (!stage) throw new Error(`TUNNEL_STAGE must be "dev" or "preprod", got "${env.TUNNEL_STAGE}".`);
  return { domain, storeDomain, stage };
}

// Only the stage that owns the tunnel is reached through D; the other one stays on localhost.
export function stageUrls(stage: LocalStage, tunnel: TunnelSettings | undefined): StageUrls {
  if (tunnel?.stage === stage) {
    return {
      platformDomain: tunnel.domain,
      storeDomain: tunnel.storeDomain,
      platform: `https://${tunnel.domain}`,
      admin: `https://admin.${tunnel.domain}`,
    };
  }
  return {
    platformDomain: "localhost",
    storeDomain: "localhost",
    platform: `http://localhost:${PORTS[stage].web}`,
    admin: `http://admin.localhost:${PORTS[stage].web}`,
  };
}

// cloudflared uses the first matching rule, so api.D comes before the wildcard. The bare store domain
// is not a store host, so only its subdomains are routed.
export function tunnelIngress(tunnel: TunnelSettings): IngressRule[] {
  const ports = PORTS[tunnel.stage];
  const rules = [
    { hostname: `api.${tunnel.domain}`, port: ports.api },
    { hostname: tunnel.domain, port: ports.web },
    { hostname: `*.${tunnel.domain}`, port: ports.web },
  ];
  if (tunnel.storeDomain !== tunnel.domain) rules.push({ hostname: `*.${tunnel.storeDomain}`, port: ports.web });
  return rules;
}
