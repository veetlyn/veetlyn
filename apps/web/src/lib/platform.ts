import { env } from "cloudflare:workers";
import { z } from "zod";

export type PlatformSite = { name: string; domain: string; storeDomain: string };

// The product name people read; set per stage (PLATFORM_NAME).
export function platformName(): string {
  return z.string().min(1).parse(env.PLATFORM_NAME);
}

export function platformDomain(): string {
  return z.string().min(1).parse(env.PLATFORM_DOMAIN);
}

export function storeDomain(): string {
  return z.string().min(1).parse(env.STORE_DOMAIN);
}

// Only production is indexed: other stages would compete with it in search results.
export function isIndexedStage(): boolean {
  return env.DEPLOY_STAGE === "production";
}

export function platformSite(): PlatformSite {
  return { name: platformName(), domain: platformDomain(), storeDomain: storeDomain() };
}
