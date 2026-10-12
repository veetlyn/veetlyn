import { describe, expect, it } from "vitest";

import { createPayPalClient, PayPalError } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

const CONFIG = {
  clientId: "partner-client-id",
  clientSecret: "partner-secret",
  environment: "sandbox" as const,
  sleep: () => Promise.resolve(),
};

const INTEGRATION_BODY = {
  merchant_id: "SELLER1",
  tracking_id: "team-1",
  products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE" }],
  capabilities: [{ name: "PAYPAL_CHECKOUT", status: "ACTIVE" }],
  payments_receivable: true,
  legal_name: "Acme LLC",
  country: "SN",
  primary_email: "seller@example.com",
  primary_email_confirmed: true,
  oauth_integrations: [
    {
      integration_type: "OAUTH_THIRD_PARTY",
      integration_method: "PAYPAL",
      oauth_third_party: [
        {
          partner_client_id: "partner-client-id",
          merchant_client_id: "seller-client-id",
          scopes: [
            "https://uri.paypal.com/services/payments/realtimepayment",
            "https://uri.paypal.com/services/payments/refund",
          ],
        },
      ],
    },
  ],
};

describe("merchantIntegrations.get", () => {
  it("gets the status and maps it to camelCase", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, INTEGRATION_BODY),
    );
    const client = createPayPalClient({ ...CONFIG, fetch });

    const status = await client.merchantIntegrations.get("PARTNER42", "SELLER1");

    expect(recordedAt(requests, 1).url).toBe(
      "https://api-m.sandbox.paypal.com/v1/customer/partners/PARTNER42/merchant-integrations/SELLER1",
    );
    expect(status).toEqual({
      merchantId: "SELLER1",
      trackingId: "team-1",
      paymentsReceivable: true,
      primaryEmail: "seller@example.com",
      primaryEmailConfirmed: true,
      legalName: "Acme LLC",
      country: "SN",
      products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE", vettingStatus: undefined }],
      capabilities: [{ name: "PAYPAL_CHECKOUT", status: "ACTIVE" }],
      oauthIntegrations: [
        {
          integrationType: "OAUTH_THIRD_PARTY",
          integrationMethod: "PAYPAL",
          status: undefined,
          oauthThirdParty: [
            {
              partnerClientId: "partner-client-id",
              merchantClientId: "seller-client-id",
              scopes: [
                "https://uri.paypal.com/services/payments/realtimepayment",
                "https://uri.paypal.com/services/payments/refund",
              ],
            },
          ],
        },
      ],
    });
  });

  it("throws when the response has no merchant_id", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );

    await expect(createPayPalClient({ ...CONFIG, fetch }).merchantIntegrations.get("PARTNER42", "SELLER1")).rejects.toThrow(
      /merchant_id/,
    );
  });
});

describe("merchantIntegrations.findByTrackingId", () => {
  it("returns the merchant reference for a known tracking id", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(200, { merchant_id: "SELLER1", tracking_id: "team-1" }),
    );
    const client = createPayPalClient({ ...CONFIG, fetch });

    await expect(client.merchantIntegrations.findByTrackingId("PARTNER42", "team-1")).resolves.toEqual({
      merchantId: "SELLER1",
      trackingId: "team-1",
    });
    expect(recordedAt(requests, 1).url).toBe(
      "https://api-m.sandbox.paypal.com/v1/customer/partners/PARTNER42/merchant-integrations?tracking_id=team-1",
    );
  });

  it("returns null on a 404 (the seller has not finished onboarding)", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(404, { name: "INVALID_RESOURCE_ID", message: "Resource not found.", debug_id: "d404" }),
    );

    await expect(
      createPayPalClient({ ...CONFIG, fetch }).merchantIntegrations.findByTrackingId("PARTNER42", "team-1"),
    ).resolves.toBeNull();
  });

  it("returns null for a 200 body without a merchant id, and rethrows other errors", async () => {
    const { fetch: emptyFetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    await expect(
      createPayPalClient({ ...CONFIG, fetch: emptyFetch }).merchantIntegrations.findByTrackingId("PARTNER42", "team-1"),
    ).resolves.toBeNull();

    const { fetch: failingFetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(500, { name: "INTERNAL_SERVER_ERROR", debug_id: "d500" }),
    );
    const error = await createPayPalClient({ ...CONFIG, fetch: failingFetch })
      .merchantIntegrations.findByTrackingId("PARTNER42", "team-1")
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 500, debugId: "d500" });
  });
});
