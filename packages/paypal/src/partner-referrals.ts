import type { PayPalRequest } from "./client";

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

export type PartnerReferralLink = { href: string; rel: string; method?: string };

// The 201 response is only a links array (Fact 1).
export type PartnerReferral = { links: PartnerReferralLink[] };

export type CreatePartnerReferralInput = {
  trackingId: string;
  returnUrl: string;
  requestId: string;
  features?: readonly string[];
};

export function createPartnerReferrals(request: PayPalRequest) {
  return {
    async create(input: CreatePartnerReferralInput): Promise<PartnerReferral> {
      return request<PartnerReferral>({
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
      });
    },
  };
}

// The seller is redirected to the link with rel "action_url" (Fact 1).
export function actionUrlFromLinks(links: readonly PartnerReferralLink[]): string | null {
  return links.find((link) => link.rel === "action_url")?.href ?? null;
}
