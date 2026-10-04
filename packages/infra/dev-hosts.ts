// Local Alchemy stages, their ports, and how the Cloudflare named tunnel exposes one of them.
// alchemy.run.ts and scripts/tunnel.ts both read this file, so ports and hostnames stay in one place.
//
// The tunnel uses the production host layout on TUNNEL_DOMAIN (D): the web app on D and every
// subdomain of D, the api on api.D. Moving to jendal.com only changes D.

export type LocalStage = "dev" | "preprod";

const PORTS: Record<LocalStage, { web: number; api: number }> = {
  dev: { web: 3001, api: 3000 },
  preprod: { web: 3101, api: 3100 },
};

export type StageUrls = { platformDomain: string; admin: string };
export type IngressRule = { hostname: string; port: number };
export type TunnelSettings = { domain: string; stage: LocalStage };

export function parseLocalStage(value: string | undefined): LocalStage | undefined {
  return value === "dev" || value === "preprod" ? value : undefined;
}

export function localPorts(stage: LocalStage): { web: number; api: number } {
  return PORTS[stage];
}

// Reads TUNNEL_DOMAIN and TUNNEL_STAGE (default "dev"). Undefined when no tunnel is configured.
export function tunnelSettings(env: Record<string, string | undefined>): TunnelSettings | undefined {
  const domain = env.TUNNEL_DOMAIN?.trim().toLowerCase();
  if (!domain) return undefined;
  const stage = parseLocalStage(env.TUNNEL_STAGE || "dev");
  if (!stage) throw new Error(`TUNNEL_STAGE must be "dev" or "preprod", got "${env.TUNNEL_STAGE}".`);
  return { domain, stage };
}

// Only the stage that owns the tunnel is reached through D; the other one stays on localhost.
export function stageUrls(stage: LocalStage, tunnel: TunnelSettings | undefined): StageUrls {
  if (tunnel?.stage === stage) {
    return { platformDomain: tunnel.domain, admin: `https://admin.${tunnel.domain}` };
  }
  return { platformDomain: "localhost", admin: `http://admin.localhost:${PORTS[stage].web}` };
}

// cloudflared uses the first matching rule, so api.D comes before the wildcard.
export function tunnelIngress(tunnel: TunnelSettings): IngressRule[] {
  const ports = PORTS[tunnel.stage];
  return [
    { hostname: `api.${tunnel.domain}`, port: ports.api },
    { hostname: tunnel.domain, port: ports.web },
    { hostname: `*.${tunnel.domain}`, port: ports.web },
  ];
}
