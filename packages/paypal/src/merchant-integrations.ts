import type { z } from "zod";

import type { PayPalRequest } from "./client";
import { PayPalError } from "./errors";
import { merchantIntegrationRefSchema, merchantIntegrationSchema } from "./schemas";

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

function toMerchantIntegration(body: z.output<typeof merchantIntegrationSchema>): MerchantIntegration {
  if (!body.merchant_id) throw new Error("PayPal's merchant-integration response has no merchant_id.");
  return {
    merchantId: body.merchant_id,
    trackingId: body.tracking_id,
    paymentsReceivable: body.payments_receivable,
    primaryEmail: body.primary_email,
    primaryEmailConfirmed: body.primary_email_confirmed,
    legalName: body.legal_name,
    products: body.products.map((product) => ({
      name: product.name,
      status: product.status,
      vettingStatus: product.vetting_status,
    })),
    capabilities: body.capabilities.map((capability) => ({ name: capability.name, status: capability.status })),
    oauthIntegrations: body.oauth_integrations.map((integration) => ({
      integrationType: integration.integration_type,
      integrationMethod: integration.integration_method,
      status: integration.status,
      oauthThirdParty: integration.oauth_third_party.map((thirdParty) => ({
        partnerClientId: thirdParty.partner_client_id,
        merchantClientId: thirdParty.merchant_client_id,
        scopes: thirdParty.scopes,
      })),
    })),
  };
}

export function createMerchantIntegrations(request: PayPalRequest) {
  return {
    // GET /v1/customer/partners/{partner_id}/merchant-integrations/{merchant_id} (Fact 5).
    async get(partnerId: string, merchantId: string): Promise<MerchantIntegration> {
      const body = await request(
        {
          method: "GET",
          path: `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations/${encodeURIComponent(merchantId)}`,
        },
        merchantIntegrationSchema,
      );
      return toMerchantIntegration(body);
    },

    // GET /v1/customer/partners/{partner_id}/merchant-integrations?tracking_id=… (Fact 5).
    // 404 means PayPal has no integration for the tracking id: the seller has not finished.
    async findByTrackingId(partnerId: string, trackingId: string): Promise<MerchantIntegrationRef | null> {
      try {
        const body = await request(
          {
            method: "GET",
            path: `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations?tracking_id=${encodeURIComponent(trackingId)}`,
          },
          merchantIntegrationRefSchema,
        );
        if (!body.merchant_id) return null;
        return { merchantId: body.merchant_id, trackingId: body.tracking_id };
      } catch (error) {
        if (error instanceof PayPalError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
