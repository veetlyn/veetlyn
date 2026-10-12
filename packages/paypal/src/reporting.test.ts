import { describe, expect, it } from "vitest";

import { createPayPalClient } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

describe("reporting.balances", () => {
  it("reads the available balance, falling back to the total when PayPal omits it", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(200, {
            balances: [
              {
                currency: "USD",
                primary: true,
                total_balance: { currency_code: "USD", value: "120.00" },
                available_balance: { currency_code: "USD", value: "100.00" },
                withheld_balance: { currency_code: "USD", value: "20.00" },
              },
              { currency: "EUR", total_balance: { currency_code: "EUR", value: "7.50" } },
            ],
            account_id: "ACCOUNT1",
            as_of_time: "2026-10-12T10:00:00Z",
            last_refresh_time: "2026-10-12T09:59:00Z",
          }),
    );
    const client = createPayPalClient({
      clientId: "team-client-id",
      clientSecret: "team-secret",
      environment: "sandbox",
      fetch,
      sleep: () => Promise.resolve(),
    });

    const balances = await client.reporting.balances("USD");

    const call = recordedAt(requests, 1);
    expect(call.method).toBe("GET");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/reporting/balances?currency_code=USD");
    expect(balances).toEqual({
      accountId: "ACCOUNT1",
      balances: [
        { currency: "USD", total: "120.00", available: "100.00" },
        { currency: "EUR", total: "7.50", available: "7.50" },
      ],
    });
  });
});
