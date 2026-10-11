import {
  createTenantContext,
  isStorePublic,
  lookupForTarget,
  parseRequestTarget,
  resolveStore,
  type HostDomains,
  type StoreDirectory,
  type StoreLookupCache,
  type TenantEnvironment,
} from "@jendal-workspace/core";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import type { AppEnv } from "../app-env";

export type TenantSettings = { domains: HostDomains; environment: TenantEnvironment };
export type StoreLookupDeps = { directory: StoreDirectory; cache: StoreLookupCache };

// Cloudflare for SaaS attaches custom hostname metadata to request.cf; the Workers types leave it untyped.
const hostMetadataCfSchema = z.object({ hostMetadata: z.object({ storeId: z.string() }) });

function hostMetadataStoreId(request: Request): string | undefined {
  const parsed = hostMetadataCfSchema.safeParse(request.cf);
  return parsed.success ? parsed.data.hostMetadata.storeId : undefined;
}

export function tenantMiddleware(
  settings: TenantSettings,
  getStoreLookup: (c: Context<AppEnv>) => StoreLookupDeps,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const url = new URL(c.req.url);
    const target = parseRequestTarget(url.hostname, settings.domains);
    c.set("target", target);
    c.set("store", null);
    c.set("tenant", null);

    if (target.kind === "platform") {
      await next();
      return;
    }

    const lookup = lookupForTarget(target, hostMetadataStoreId(c.req.raw));
    const store = lookup ? await resolveStore(lookup, getStoreLookup(c)) : null;

    if (!store || !isStorePublic(store)) {
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
