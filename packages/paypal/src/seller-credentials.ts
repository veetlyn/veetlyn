import type { z } from "zod";

import type { FetchLike } from "./client";
import { PayPalError, payPalErrorFromResponse } from "./errors";
import { sellerCredentialsSchema, tokenResponseSchema } from "./schemas";

export type SellerCredentials = { clientId: string; clientSecret: string; payerId: string };

export type SellerCredentialsTransport = {
  baseUrl: string;
  fetch: FetchLike;
  partnerAttributionId: string | undefined;
};

// After first-party consent PayPal hands the browser an authorization code and the seller's shared id. These calls
// authenticate as the seller (the shared id, then the seller's token), never with the partner token, so they go
// through a plain fetch. The answers carry the seller's secret and token: errors keep only PayPal's error fields.
export function createSellerCredentials(transport: SellerCredentialsTransport) {
  async function decoded<S extends z.ZodType>(response: Response, schema: S, call: string): Promise<z.output<S>> {
    if (!response.ok) throw await payPalErrorFromResponse(response);
    // A JSON parse error quotes the text it read, which may hold the secret.
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new PayPalError({
        status: response.status,
        name: "UNEXPECTED_RESPONSE",
        message: `PayPal's ${response.status} answer to ${call} does not match the expected response.`,
      });
    }
    return parsed.data;
  }

  return {
    // Returns the seller's access token. The code verifier is the seller_nonce sent with the referral.
    async exchangeSellerAuthCode(input: { sharedId: string; authCode: string; codeVerifier: string }): Promise<string> {
      const response = await transport.fetch(
        new Request(`${transport.baseUrl}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            authorization: `Basic ${btoa(`${input.sharedId}:`)}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: input.authCode,
            code_verifier: input.codeVerifier,
          }).toString(),
        }),
      );
      const body = await decoded(response, tokenResponseSchema, "POST /v1/oauth2/token");
      return body.access_token;
    },

    async getSellerCredentials(sellerToken: string, partnerMerchantId: string): Promise<SellerCredentials> {
      const path = `/v1/customer/partners/${encodeURIComponent(partnerMerchantId)}/merchant-integrations/credentials/`;
      const headers = new Headers({ authorization: `Bearer ${sellerToken}` });
      if (transport.partnerAttributionId) headers.set("PayPal-Partner-Attribution-Id", transport.partnerAttributionId);
      const response = await transport.fetch(new Request(`${transport.baseUrl}${path}`, { method: "GET", headers }));
      const body = await decoded(response, sellerCredentialsSchema, `GET ${path}`);
      return { clientId: body.client_id, clientSecret: body.client_secret, payerId: body.payer_id };
    },
  };
}
