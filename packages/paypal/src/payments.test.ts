import { describe, expect, it } from "vitest";

import { buildAuthAssertion, createPayPalClient } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

describe("payments.refundCapture", () => {
  it("refunds part of a capture from the seller's account and reads the returned fees", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(201, {
            id: "REFUND1",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "5.00" },
            seller_payable_breakdown: {
              gross_amount: { currency_code: "USD", value: "5.00" },
              paypal_fee: { currency_code: "USD", value: "0.19" },
              platform_fees: [{ amount: { currency_code: "USD", value: "0.05" } }],
              net_amount: { currency_code: "USD", value: "4.76" },
            },
            links: [],
          }),
    );
    const client = createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch,
      sleep: () => Promise.resolve(),
    });

    const refund = await client.payments.refundCapture({
      captureId: "CAPTURE1",
      merchantId: "SELLER1",
      requestId: "project-refund:completion-p1:pay-1",
      amount: { currency_code: "USD", value: "5.00" },
      noteToPayer: "Overpayment",
    });

    expect(refund).toEqual({
      id: "REFUND1",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "5.00" },
      seller_payable_breakdown: {
        paypal_fee: { currency_code: "USD", value: "0.19" },
        platform_fees: [{ amount: { currency_code: "USD", value: "0.05" } }],
        net_amount: { currency_code: "USD", value: "4.76" },
      },
    });
    const call = recordedAt(requests, 1);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE1/refund");
    expect(call.headers.get("paypal-auth-assertion")).toBe(
      buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER1" }),
    );
    expect(call.headers.get("paypal-request-id")).toBe("project-refund:completion-p1:pay-1");
    expect(call.headers.get("prefer")).toBe("return=representation");
    expect(JSON.parse(call.body ?? "")).toEqual({
      amount: { currency_code: "USD", value: "5.00" },
      note_to_payer: "Overpayment",
    });
  });
});
