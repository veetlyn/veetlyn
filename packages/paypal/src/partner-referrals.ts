import type { z } from "zod";

import type { PayPalRequest } from "./client";
import { partnerReferralSchema } from "./schemas";

// Platform spec §5 step 1: the permissions Payleor asks every seller for (Fact 2).
export const PARTNER_REFERRAL_FEATURES = [
  "PAYMENT",
  "REFUND",
  "PARTNER_FEE",
  "READ_SELLER_DISPUTE",
  "UPDATE_SELLER_DISPUTE",
  "TRACKING_SHIPMENT_READWRITE",
  "ACCESS_MERCHANT_INFORMATION",
] as const;

export type PartnerReferral = z.output<typeof partnerReferralSchema>;
export type PartnerReferralLink = PartnerReferral["links"][number];

export type CreatePartnerReferralInput = {
  trackingId: string;
  returnUrl: string;
  requestId: string;
  features?: readonly string[];
};

// What a team grants when it turns on automatic payouts. PayPal shares the team's own REST credentials for these
// (first-party onboarding); PAYOUTS is refused for third-party integrations.
export const FIRST_PARTY_REFERRAL_FEATURES = ["PAYMENT", "REFUND", "PAYOUTS"] as const;

export type CreateFirstPartyReferralInput = {
  requestId: string;
  returnUrl: string;
  // The PKCE code verifier for the authorization code PayPal hands back after consent.
  sellerNonce: string;
  features?: readonly string[];
};

export function createPartnerReferrals(request: PayPalRequest) {
  return {
    async createFirstParty(input: CreateFirstPartyReferralInput): Promise<PartnerReferral> {
      return request(
        {
          method: "POST",
          path: "/v2/customer/partner-referrals",
          requestId: input.requestId,
          body: {
            partner_config_override: { return_url: input.returnUrl },
            operations: [
              {
                operation: "API_INTEGRATION",
                api_integration_preference: {
                  rest_api_integration: {
                    integration_method: "PAYPAL",
                    integration_type: "FIRST_PARTY",
                    first_party_details: {
                      features: [...(input.features ?? FIRST_PARTY_REFERRAL_FEATURES)],
                      seller_nonce: input.sellerNonce,
                    },
                  },
                },
              },
            ],
            products: ["EXPRESS_CHECKOUT"],
            legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
          },
        },
        partnerReferralSchema,
      );
    },

    async create(input: CreatePartnerReferralInput): Promise<PartnerReferral> {
      return request(
        {
          method: "POST",
          path: "/v2/customer/partner-referrals",
          requestId: input.requestId,
          body: {
            tracking_id: input.trackingId,
            partner_config_override: { return_url: input.returnUrl },
            operations: [
              {
                operation: "API_INTEGRATION",
                api_integration_preference: {
                  rest_api_integration: {
                    integration_method: "PAYPAL",
                    integration_type: "THIRD_PARTY",
                    third_party_details: { features: [...(input.features ?? PARTNER_REFERRAL_FEATURES)] },
                  },
                },
              },
            ],
            products: ["EXPRESS_CHECKOUT"],
            legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
          },
        },
        partnerReferralSchema,
      );
    },
  };
}

// The seller is redirected to the link with rel "action_url" (Fact 1).
export function actionUrlFromLinks(links: readonly PartnerReferralLink[]): string | null {
  return links.find((link) => link.rel === "action_url")?.href ?? null;
}
