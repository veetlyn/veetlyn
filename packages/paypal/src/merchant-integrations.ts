import type { PayPalRequest } from "./client";
import { PayPalError } from "./errors";

export type OAuthThirdParty = {
  partnerClientId?: string;
  merchantClientId?: string;
  scopes: string[];
};

export type OAuthIntegration = {
  integrationType?: string;
  integrationMethod?: string;
  status?: string;
  oauthThirdParty: OAuthThirdParty[];
};

// Field list from the live doc's sample responses (Fact 5); unknown fields are ignored.
export type MerchantIntegration = {
  merchantId: string;
  trackingId?: string;
  paymentsReceivable?: boolean;
  primaryEmail?: string;
  primaryEmailConfirmed?: boolean;
  legalName?: string;
  products: { name: string; status?: string; vettingStatus?: string }[];
  capabilities: { name: string; status?: string }[];
  oauthIntegrations: OAuthIntegration[];
};

export type MerchantIntegrationRef = { merchantId: string; trackingId?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const records: Record<string, unknown>[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record) records.push(record);
  }
  return records;
}

export function parseMerchantIntegration(body: unknown): MerchantIntegration {
  const record = asRecord(body);
  const merchantId = record ? asString(record.merchant_id) : undefined;
  if (!record || !merchantId) {
    throw new Error("PayPal's merchant-integration response has no merchant_id.");
  }
  return {
    merchantId,
    trackingId: asString(record.tracking_id),
    paymentsReceivable: asBoolean(record.payments_receivable),
    primaryEmail: asString(record.primary_email),
    primaryEmailConfirmed: asBoolean(record.primary_email_confirmed),
    legalName: asString(record.legal_name),
    products: asRecordArray(record.products).map((product) => ({
      name: asString(product.name) ?? "",
      status: asString(product.status),
      vettingStatus: asString(product.vetting_status),
    })),
    capabilities: asRecordArray(record.capabilities).map((capability) => ({
      name: asString(capability.name) ?? "",
      status: asString(capability.status),
    })),
    oauthIntegrations: asRecordArray(record.oauth_integrations).map((integration) => ({
      integrationType: asString(integration.integration_type),
      integrationMethod: asString(integration.integration_method),
      status: asString(integration.status),
      oauthThirdParty: asRecordArray(integration.oauth_third_party).map((thirdParty) => ({
        partnerClientId: asString(thirdParty.partner_client_id),
        merchantClientId: asString(thirdParty.merchant_client_id),
        scopes: Array.isArray(thirdParty.scopes)
          ? thirdParty.scopes.filter((scope): scope is string => typeof scope === "string")
          : [],
      })),
    })),
  };
}

export function createMerchantIntegrations(request: PayPalRequest) {
  return {
    // GET /v1/customer/partners/{partner_id}/merchant-integrations/{merchant_id} (Fact 5).
    async get(partnerId: string, merchantId: string): Promise<MerchantIntegration> {
      const body = await request<unknown>({
        method: "GET",
        path: `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations/${encodeURIComponent(merchantId)}`,
      });
      return parseMerchantIntegration(body);
    },

    // GET /v1/customer/partners/{partner_id}/merchant-integrations?tracking_id=… (Fact 5).
    // 404 means PayPal has no integration for the tracking id: the seller has not finished.
    async findByTrackingId(partnerId: string, trackingId: string): Promise<MerchantIntegrationRef | null> {
      try {
        const body = await request<unknown>({
          method: "GET",
          path: `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations?tracking_id=${encodeURIComponent(trackingId)}`,
        });
        const record = asRecord(body);
        const merchantId = record ? asString(record.merchant_id) : undefined;
        if (!record || !merchantId) return null;
        return { merchantId, trackingId: asString(record.tracking_id) };
      } catch (error) {
        if (error instanceof PayPalError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
