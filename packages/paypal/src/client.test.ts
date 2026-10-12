import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createPayPalClient, type PayPalClientConfig, PayPalError, type PayPalRequestOptions } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

const CONFIG = {
  clientId: "partner-client-id",
  clientSecret: "partner-secret",
  environment: "sandbox" as const,
  sleep: () => Promise.resolve(),
};

const OBJECT_BODY = z.looseObject({});

function clientWith(fetch: ReturnType<typeof fakeFetch>["fetch"], extra: Partial<PayPalClientConfig> = {}) {
  return createPayPalClient({ ...CONFIG, fetch, ...extra });
}

describe("OAuth token", () => {
  it("fetches a token once and reuses it until it expires", async () => {
    let now = 1_000_000;
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    const client = clientWith(fetch, { now: () => now });

    await client.request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);
    await client.request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);
    expect(requests.filter((r) => r.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);

    now += 32400 * 1000; // past expiry minus the 60-second skew
    await client.request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);
    expect(requests.filter((r) => r.url.endsWith("/v1/oauth2/token"))).toHaveLength(2);
  });

  it("sends basic auth to the token endpoint and a bearer token on API calls", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );

    await clientWith(fetch).request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);

    const tokenCall = recordedAt(requests, 0);
    expect(tokenCall.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(tokenCall.headers.get("authorization")).toBe(`Basic ${btoa("partner-client-id:partner-secret")}`);
    expect(tokenCall.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(tokenCall.body).toBe("grant_type=client_credentials");
    expect(recordedAt(requests, 1).headers.get("authorization")).toBe("Bearer token-1");
  });

  it("uses the live base URL when the environment is live", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    const client = createPayPalClient({ ...CONFIG, environment: "live", fetch });

    await client.request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);

    expect(recordedAt(requests, 0).url).toBe("https://api-m.paypal.com/v1/oauth2/token");
    expect(recordedAt(requests, 1).url).toBe("https://api-m.paypal.com/v1/example");
  });

  it("turns a token failure into a PayPalError without calling the API", async () => {
    const { requests, fetch } = fakeFetch(() =>
      jsonResponse(401, { name: "AUTHENTICATION_FAILURE", message: "Authentication failed.", debug_id: "d1" }),
    );

    const error = await clientWith(fetch).request({ method: "GET", path: "/v1/example" }, OBJECT_BODY).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 401, name: "AUTHENTICATION_FAILURE", debugId: "d1" });
    expect(requests).toHaveLength(1);
  });
});

describe("request headers", () => {
  async function postWithHeaders(extra: Partial<PayPalClientConfig> = {}, options: Partial<PayPalRequestOptions> = {}) {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    await clientWith(fetch, extra).request({ method: "POST", path: "/v2/example", body: { a: 1 }, requestId: "req-1", ...options }, OBJECT_BODY);
    return recordedAt(requests, 1);
  }

  it("sends PayPal-Request-Id and JSON content type on POST", async () => {
    const call = await postWithHeaders();

    expect(call.headers.get("paypal-request-id")).toBe("req-1");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("refuses a POST without a requestId before any HTTP call", async () => {
    const { requests, fetch } = fakeFetch(() => jsonResponse(200, FAKE_TOKEN_RESPONSE));
    const client = clientWith(fetch);

    await expect(client.request({ method: "POST", path: "/v2/example", body: {} }, OBJECT_BODY)).rejects.toThrow(/requestId/);
    expect(requests).toHaveLength(0);
  });

  it("sends no request id or content type on GET", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    await clientWith(fetch).request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);

    const call = recordedAt(requests, 1);
    expect(call.headers.get("paypal-request-id")).toBeNull();
    expect(call.headers.get("content-type")).toBeNull();
  });

  it("sends the BN code when one is configured", async () => {
    const withBn = await postWithHeaders({ partnerAttributionId: "PAYLEOR_BN" });
    expect(withBn.headers.get("paypal-partner-attribution-id")).toBe("PAYLEOR_BN");

    const withoutBn = await postWithHeaders();
    expect(withoutBn.headers.get("paypal-partner-attribution-id")).toBeNull();
  });

  it("adds an unsigned PayPal-Auth-Assertion JWT when a merchant id is given", async () => {
    const call = await postWithHeaders({}, { merchantId: "SELLER42" });

    const parts = (call.headers.get("paypal-auth-assertion") ?? "").split(".");
    expect(parts).toHaveLength(3);
    expect(JSON.parse(atob(String(parts[0])))).toEqual({ alg: "none" });
    expect(JSON.parse(atob(String(parts[1])))).toEqual({ iss: "partner-client-id", payer_id: "SELLER42" });
    expect(parts[2]).toBe("");
  });
});

describe("retries", () => {
  it("retries 429 with exponential backoff and jitter, reusing the request id", async () => {
    const delays: number[] = [];
    const { requests, fetch } = fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      return requests.length < 4 ? jsonResponse(429, { name: "RATE_LIMIT_REACHED" }) : jsonResponse(200, {});
    });
    const client = clientWith(fetch, { random: () => 0, sleep: (ms: number) => (delays.push(ms), Promise.resolve()) });

    await client.request({ method: "POST", path: "/v2/example", body: {}, requestId: "same-id" }, OBJECT_BODY);

    expect(delays).toEqual([250, 500]);
    expect(requests).toHaveLength(4); // one token call, three API calls
    for (const call of requests.slice(1)) {
      expect(call.headers.get("paypal-request-id")).toBe("same-id");
    }
  });

  it("honors a Retry-After header on 429", async () => {
    const delays: number[] = [];
    let apiCalls = 0;
    const { fetch } = fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      apiCalls += 1;
      if (apiCalls === 1) {
        return new Response(JSON.stringify({ name: "RATE_LIMIT_REACHED" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "2" },
        });
      }
      return jsonResponse(200, {});
    });
    const client = clientWith(fetch, { sleep: (ms: number) => (delays.push(ms), Promise.resolve()) });

    await client.request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);

    expect(delays).toEqual([2000]);
  });

  it("retries 5xx but not other 4xx", async () => {
    const apiCalls: string[] = [];
    const { fetch } = fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      apiCalls.push(request.url);
      return apiCalls.length === 1 ? jsonResponse(500, {}) : jsonResponse(400, { name: "INVALID_REQUEST", message: "bad" });
    });
    const client = clientWith(fetch);

    await expect(client.request({ method: "GET", path: "/v1/example" }, OBJECT_BODY)).rejects.toMatchObject({ status: 400 });
    expect(apiCalls).toHaveLength(2);
  });

  it("gives up after maxAttempts and throws a PayPalError", async () => {
    const apiCalls: string[] = [];
    const { fetch } = fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      apiCalls.push(request.url);
      return jsonResponse(429, { name: "RATE_LIMIT_REACHED", debug_id: "d429" });
    });

    await expect(clientWith(fetch).request({ method: "GET", path: "/v1/example" }, OBJECT_BODY)).rejects.toMatchObject({
      status: 429,
      debugId: "d429",
    });
    expect(apiCalls).toHaveLength(3);
  });
});

describe("revoked token", () => {
  function tokenCalls(requests: ReturnType<typeof fakeFetch>["requests"]) {
    return requests.filter((r) => r.url.endsWith("/v1/oauth2/token"));
  }

  function fakeWithApiStatuses(statuses: number[]) {
    let tokenCount = 0;
    let apiCount = 0;
    return fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) {
        tokenCount += 1;
        return jsonResponse(200, { access_token: `token-${tokenCount}`, expires_in: 32400 });
      }
      const status = statuses[apiCount] ?? 200;
      apiCount += 1;
      return status === 401
        ? jsonResponse(401, { name: "AUTHENTICATION_FAILURE", message: "Authentication failed.", debug_id: "d401" })
        : jsonResponse(status, { ok: true });
    });
  }

  it("clears the cached token, fetches a new one and repeats the call once after a 401", async () => {
    const { requests, fetch } = fakeWithApiStatuses([401, 200]);
    const client = clientWith(fetch);

    await expect(client.request({ method: "GET", path: "/v1/example" }, OBJECT_BODY)).resolves.toEqual({ ok: true });

    expect(tokenCalls(requests)).toHaveLength(2);
    expect(recordedAt(requests, 1).headers.get("authorization")).toBe("Bearer token-1");
    expect(recordedAt(requests, 3).headers.get("authorization")).toBe("Bearer token-2");

    await client.request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);
    expect(tokenCalls(requests)).toHaveLength(2);
    expect(recordedAt(requests, 4).headers.get("authorization")).toBe("Bearer token-2");
  });

  it("clears the configured token cache before fetching the new token", async () => {
    const events: string[] = [];
    let stored: { accessToken: string; expiresAt: number } | null = null;
    const tokenCache = {
      async get() {
        events.push("get");
        return stored;
      },
      async set(token: { accessToken: string; expiresAt: number }) {
        events.push(`set:${token.accessToken}`);
        stored = token;
      },
      async clear() {
        events.push("clear");
        stored = null;
      },
    };
    const { fetch } = fakeWithApiStatuses([401, 200]);

    await clientWith(fetch, { tokenCache }).request({ method: "GET", path: "/v1/example" }, OBJECT_BODY);

    expect(events).toEqual(["get", "set:token-1", "clear", "set:token-2"]);
  });

  it("throws the usual PayPalError when the repeat also gets a 401, without a third token", async () => {
    const { requests, fetch } = fakeWithApiStatuses([401, 401, 200]);

    const error = await clientWith(fetch).request({ method: "GET", path: "/v1/example" }, OBJECT_BODY).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 401, name: "AUTHENTICATION_FAILURE", debugId: "d401" });
    expect(tokenCalls(requests)).toHaveLength(2);
    expect(requests).toHaveLength(4);
  });

  it("does not retry a 401 from the token endpoint", async () => {
    const { requests, fetch } = fakeFetch(() =>
      jsonResponse(401, { name: "AUTHENTICATION_FAILURE", message: "Authentication failed.", debug_id: "d1" }),
    );

    await expect(clientWith(fetch).request({ method: "GET", path: "/v1/example" }, OBJECT_BODY)).rejects.toMatchObject({ status: 401 });
    expect(requests).toHaveLength(1);
  });

  it("keeps the PayPal-Request-Id and body when a POST is repeated", async () => {
    const { requests, fetch } = fakeWithApiStatuses([401, 200]);

    await clientWith(fetch).request({ method: "POST", path: "/v2/example", body: { a: 1 }, requestId: "req-401" }, OBJECT_BODY);

    const first = recordedAt(requests, 1);
    const repeat = recordedAt(requests, 3);
    expect(first.headers.get("paypal-request-id")).toBe("req-401");
    expect(repeat.headers.get("paypal-request-id")).toBe("req-401");
    expect(repeat.body).toBe(JSON.stringify({ a: 1 }));
    expect(repeat.headers.get("authorization")).toBe("Bearer token-2");
  });
});

describe("error mapping", () => {
  it("carries status, debug id, name, details and links", async () => {
    const link = { href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH1", rel: "self", method: "GET" };
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(422, {
            name: "INVALID_REQUEST",
            message: "Request is not well-formed.",
            debug_id: "abc123",
            details: [{ field: "/tracking_id", value: "", issue: "INVALID_STRING_LENGTH", description: "Too short." }],
            links: [link, { rel: "no-href" }],
          }),
    );

    const error = await clientWith(fetch)
      .request({ method: "POST", path: "/v2/example", body: {}, requestId: "r" }, OBJECT_BODY)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({
      status: 422,
      name: "INVALID_REQUEST",
      message: "Request is not well-formed.",
      debugId: "abc123",
      details: [{ field: "/tracking_id", value: "", issue: "INVALID_STRING_LENGTH", description: "Too short." }],
      links: [link],
    });
  });

  it("maps a non-JSON error body to a bare PayPalError", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : new Response("oops", { status: 400, headers: { "content-type": "text/plain" } }),
    );

    await expect(clientWith(fetch).request({ method: "GET", path: "/v1/example" }, OBJECT_BODY)).rejects.toMatchObject({
      status: 400,
      message: "PayPal answered 400",
      debugId: undefined,
      details: [],
    });
  });

  it("turns a 200 body that fails its schema into an UNEXPECTED_RESPONSE PayPalError", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, { id: 7 }),
    );

    const error = await clientWith(fetch)
      .request({ method: "GET", path: "/v1/example" }, z.looseObject({ id: z.string() }))
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 200, name: "UNEXPECTED_RESPONSE" });
  });

  it("resolves undefined for a 204", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : new Response(null, { status: 204 }),
    );

    await expect(clientWith(fetch).request({ method: "GET", path: "/v1/none" }, z.undefined())).resolves.toBeUndefined();
  });
});
