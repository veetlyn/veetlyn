import { describe, expect, it } from "vitest";

import { actionUrlFromLinks, createPayPalClient, PARTNER_REFERRAL_FEATURES } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

const REFERRAL_RESPONSE = {
  links: [
    {
      href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/REF-1",
      rel: "self",
      method: "GET",
    },
    {
      href: "https://www.sandbox.paypal.com/bizsignup/entry?partnerId=PARTNER42&token=REF-1",
      rel: "action_url",
      method: "GET",
    },
  ],
};

describe("partnerReferrals.create", () => {
  it("posts the referral body PayPal documents and returns the links", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(201, REFERRAL_RESPONSE),
    );
    const client = createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch,
      sleep: () => Promise.resolve(),
      partnerAttributionId: "PAYLEOR_BN",
    });

    const referral = await client.partnerReferrals.create({
      trackingId: "team-1",
      returnUrl: "https://admin.example.com/api/paypal/onboarding/return",
      requestId: "partner-referral:team-1:abc",
    });

    const call = recordedAt(requests, 1);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/customer/partner-referrals");
    expect(call.headers.get("paypal-request-id")).toBe("partner-referral:team-1:abc");
    expect(call.headers.get("paypal-partner-attribution-id")).toBe("PAYLEOR_BN");
    expect(JSON.parse(call.body ?? "")).toEqual({
      tracking_id: "team-1",
      partner_config_override: { return_url: "https://admin.example.com/api/paypal/onboarding/return" },
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: { features: [...PARTNER_REFERRAL_FEATURES] },
            },
          },
        },
      ],
      products: ["EXPRESS_CHECKOUT"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
    });
    expect(actionUrlFromLinks(referral.links)).toBe(
      "https://www.sandbox.paypal.com/bizsignup/entry?partnerId=PARTNER42&token=REF-1",
    );
  });

  it("requests exactly the platform spec's feature list", () => {
    expect([...PARTNER_REFERRAL_FEATURES]).toEqual([
      "PAYMENT",
      "REFUND",
      "PARTNER_FEE",
      "READ_SELLER_DISPUTE",
      "UPDATE_SELLER_DISPUTE",
      "TRACKING_SHIPMENT_READWRITE",
      "ACCESS_MERCHANT_INFORMATION",
    ]);
  });
});

describe("actionUrlFromLinks", () => {
  it("returns null when the response has no action_url link", () => {
    expect(actionUrlFromLinks([{ href: "https://api-m.sandbox.paypal.com/x", rel: "self" }])).toBeNull();
  });
});
