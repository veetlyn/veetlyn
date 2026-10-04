import type { StoreRecord } from "./store";

export type TenantChannel = "web" | "admin" | "mcp" | "acp" | "ucp" | "store-sync" | "agent";
export type TenantEnvironment = "sandbox" | "live";

export type TenantContext = {
  storeId: string;
  organizationId: string;
  slug: string;
  paypalMerchantId: string | null;
  channel: TenantChannel;
  environment: TenantEnvironment;
};

export function createTenantContext(
  store: StoreRecord,
  channel: TenantChannel,
  environment: TenantEnvironment,
): TenantContext {
  return {
    storeId: store.id,
    organizationId: store.organizationId,
    slug: store.slug,
    paypalMerchantId: store.paypalMerchantId,
    channel,
    environment,
  };
}
