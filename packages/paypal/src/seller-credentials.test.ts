import { describe, expect, it } from "vitest";

import { createPayPalClient, PayPalError } from "./index";
import { fakeFetch, jsonResponse, recordedAt } from "./testing";

const CREDENTIALS_PATH = "/v1/customer/partners/PARTNER42/merchant-integrations/credentials/";

function clientWith(handler: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(handler);
  const client = createPayPalClient({
    clientId: "partner-client-id",
    clientSecret: "partner-secret",
    environment: "sandbox",
    fetch: fake.fetch,
    partnerAttributionId: "PLATFORM_BN",
  });
  return { client, requests: fake.requests };
}

describe("sellerCredentials", () => {
  it("exchanges the authorization code as the seller and reads the seller's REST credentials with its token", async () => {
    const { client, requests } = clientWith((request) =>
      new URL(request.url).pathname === "/v1/oauth2/token"
        ? jsonResponse(200, { access_token: "seller-token", expires_in: 28800 })
        : jsonResponse(200, { client_id: "seller-client", client_secret: "seller-secret", payer_id: "SELLER1" }),
    );

    const token = await client.sellerCredentials.exchangeSellerAuthCode({
      sharedId: "shared-1",
      authCode: "code/1+",
      codeVerifier: "nonce-1",
    });
    await expect(client.sellerCredentials.getSellerCredentials(token, "PARTNER42")).resolves.toEqual({
      clientId: "seller-client",
      clientSecret: "seller-secret",
      payerId: "SELLER1",
    });

    expect(requests).toHaveLength(2);
    const exchange = recordedAt(requests, 0);
    expect(exchange.method).toBe("POST");
    expect(exchange.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(exchange.headers.get("authorization")).toBe(`Basic ${btoa("shared-1:")}`);
    expect(Object.fromEntries(new URLSearchParams(exchange.body ?? ""))).toEqual({
      grant_type: "authorization_code",
      code: "code/1+",
      code_verifier: "nonce-1",
    });
    const read = recordedAt(requests, 1);
    expect(read.method).toBe("GET");
    expect(read.url).toBe(`https://api-m.sandbox.paypal.com${CREDENTIALS_PATH}`);
    expect(read.headers.get("authorization")).toBe("Bearer seller-token");
    expect(read.headers.get("paypal-partner-attribution-id")).toBe("PLATFORM_BN");
  });

  it.each([
    { case: "a refusal", answer: () => jsonResponse(401, { error: "invalid_grant" }), name: "PayPalError" },
    {
      case: "an answer without the secret",
      answer: () => jsonResponse(200, { client_id: "seller-client", payer_id: "SELLER1" }),
      name: "UNEXPECTED_RESPONSE",
    },
    {
      case: "an unreadable answer",
      answer: () => new Response('{"client_secret": "seller-secret"', { status: 200 }),
      name: "UNEXPECTED_RESPONSE",
    },
  ])("throws a PayPalError without PayPal's body on $case", async ({ answer, name }) => {
    const { client } = clientWith(answer);

    const error = await client.sellerCredentials.getSellerCredentials("seller-token", "PARTNER42").catch((cause) => cause);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ name });
    expect(String(error.message)).not.toContain("seller-secret");
  });
});
