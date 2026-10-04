import {
  createTenantContext,
  isStoreReachable,
  lookupForTarget,
  parseRequestTarget,
  resolveStore,
  routingPath,
  type StoreDirectory,
  type StoreLookupCache,
  type TenantEnvironment,
} from "@jendal-workspace/core";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../app-env";

export type TenantSettings = { platformDomain: string; environment: TenantEnvironment };
export type StoreLookupDeps = { directory: StoreDirectory; cache: StoreLookupCache };

// Used as Hono's getPath, so routes match store.{domain}/{slug}/x as /x.
export function routingPathFor(request: Request, platformDomain: string): string {
  const url = new URL(request.url);
  const target = parseRequestTarget({ hostname: url.hostname, pathname: url.pathname }, platformDomain);
  return routingPath(target, url.pathname);
}

// Cloudflare for SaaS attaches custom hostname metadata to request.cf.
function hostMetadataStoreId(request: Request): string | undefined {
  const cf: unknown = Reflect.get(request, "cf");
  if (typeof cf !== "object" || cf === null || !("hostMetadata" in cf)) return undefined;
  const metadata = cf.hostMetadata;
  if (typeof metadata !== "object" || metadata === null || !("storeId" in metadata)) return undefined;
  return typeof metadata.storeId === "string" ? metadata.storeId : undefined;
}

export function tenantMiddleware(
  settings: TenantSettings,
  getStoreLookup: (c: Context<AppEnv>) => StoreLookupDeps,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const url = new URL(c.req.url);
    const target = parseRequestTarget({ hostname: url.hostname, pathname: url.pathname }, settings.platformDomain);
    c.set("target", target);
    c.set("store", null);
    c.set("tenant", null);

    if (target.kind === "platform") {
      await next();
      return;
    }

    const lookup = lookupForTarget(target, hostMetadataStoreId(c.req.raw));
    const store = lookup ? await resolveStore(lookup, getStoreLookup(c)) : null;

    if (!store || !isStoreReachable(store)) {
      c.get("log").set({ tenant: { resolved: false, target: target.kind } });
      return c.json({ error: "store_not_found" }, 404);
    }

    const tenant = createTenantContext(store, "web", settings.environment);
    c.set("store", store);
    c.set("tenant", tenant);
    c.get("log").set({
      tenant: { storeId: tenant.storeId, organizationId: tenant.organizationId, channel: tenant.channel },
    });
    await next();
  });
}
