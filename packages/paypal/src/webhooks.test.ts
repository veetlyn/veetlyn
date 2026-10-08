import { describe, expect, it } from "vitest";

import { createPayPalClient, parseWebhookEvent } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

function clientWith(status: "SUCCESS" | "FAILURE") {
  const { requests, fetch } = fakeFetch((request) =>
    request.url.endsWith("/v1/oauth2/token")
      ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
      : jsonResponse(200, { verification_status: status }),
  );
  const client = createPayPalClient({
    clientId: "partner-client-id",
    clientSecret: "partner-secret",
    environment: "sandbox",
    fetch,
    sleep: () => Promise.resolve(),
  });
  return { client, requests };
}

const HEADERS = {
  authAlgo: "SHA256withRSA",
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  transmissionId: "tx-1",
  transmissionSig: "sig==",
  transmissionTime: "2026-10-08T00:28:22Z",
};

describe("webhooks.verifySignature", () => {
  it("posts the event body back exactly as received", async () => {
    const { client, requests } = clientWith("SUCCESS");
    // Key order and spacing that JSON.stringify would not reproduce.
    const rawBody = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"b":1,"a":2}}';

    expect(await client.webhooks.verifySignature({ webhookId: "WEBHOOK1", headers: HEADERS, rawBody })).toBe(true);

    const call = recordedAt(requests, 1);
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    expect(call.body).toBe(
      '{"auth_algo":"SHA256withRSA","cert_url":"https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1","transmission_id":"tx-1","transmission_sig":"sig==","transmission_time":"2026-10-08T00:28:22Z","webhook_id":"WEBHOOK1","webhook_event":' +
        rawBody +
        "}",
    );
    // A fresh id per call: keyed on the transmission alone, an idempotent replay could answer for another body.
    expect(call.headers.get("PayPal-Request-Id")).toMatch(/^verify:[0-9a-f-]{36}$/);
  });

  it("reports a failed verification", async () => {
    const { client } = clientWith("FAILURE");
    expect(await client.webhooks.verifySignature({ webhookId: "WEBHOOK1", headers: HEADERS, rawBody: "{}" })).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  it("reads the ids of a capture event", () => {
    expect(
      parseWebhookEvent({
        id: "WH-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource_type: "capture",
        resource: {
          id: "CAPTURE1",
          custom_id: "pay-1",
          payee: { merchant_id: "SELLER1" },
          supplementary_data: { related_ids: { order_id: "ORDER1" } },
        },
      }),
    ).toEqual({
      id: "WH-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceType: "capture",
      resourceId: "CAPTURE1",
      customId: "pay-1",
      orderId: "ORDER1",
      merchantId: "SELLER1",
    });
  });

  it("reads the ids of an order event", () => {
    expect(
      parseWebhookEvent({
        id: "WH-2",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource_type: "checkout-order",
        resource: { id: "ORDER1", purchase_units: [{ custom_id: "pay-1", payee: { merchant_id: "SELLER1" } }] },
      }),
    ).toEqual({
      id: "WH-2",
      eventType: "CHECKOUT.ORDER.APPROVED",
      resourceType: "checkout-order",
      resourceId: "ORDER1",
      customId: "pay-1",
      orderId: "ORDER1",
      merchantId: "SELLER1",
    });
  });

  it("reads the order ids of any event whose resource is an order", () => {
    expect(
      parseWebhookEvent({
        id: "WH-4",
        event_type: "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
        resource_type: "checkout-order",
        resource: { id: "ORDER1", purchase_units: [{ custom_id: "pay-1", payee: { merchant_id: "SELLER1" } }] },
      }),
    ).toMatchObject({ resourceId: "ORDER1", customId: "pay-1", orderId: "ORDER1", merchantId: "SELLER1" });
  });

  it("reads a refund's seller from its payer and not its custom_id", () => {
    expect(
      parseWebhookEvent({
        id: "WH-5",
        event_type: "PAYMENT.CAPTURE.REFUNDED",
        resource_type: "refund",
        resource: {
          id: "REFUND1",
          custom_id: "refund-own-value",
          payer: { merchant_id: "SELLER1" },
          links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAPTURE1" }],
        },
      }),
    ).toEqual({
      id: "WH-5",
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      resourceType: "refund",
      resourceId: "REFUND1",
      customId: null,
      orderId: null,
      merchantId: "SELLER1",
    });
  });

  it("keeps unknown events with what it can read, and rejects bodies without an id or type", () => {
    expect(parseWebhookEvent({ id: "WH-3", event_type: "MERCHANT.ONBOARDING.COMPLETED", resource: {} })).toEqual({
      id: "WH-3",
      eventType: "MERCHANT.ONBOARDING.COMPLETED",
      resourceType: null,
      resourceId: null,
      customId: null,
      orderId: null,
      merchantId: null,
    });
    expect(parseWebhookEvent({ event_type: "X" })).toBeNull();
    expect(parseWebhookEvent("nope")).toBeNull();
  });
});
