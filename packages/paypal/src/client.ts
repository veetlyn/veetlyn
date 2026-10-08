import { buildAuthAssertion } from "./auth-assertion";
import { payPalErrorFromResponse } from "./errors";
import { createMerchantIntegrations } from "./merchant-integrations";
import { createOrders } from "./orders";
import { createPartnerReferrals } from "./partner-referrals";
import { createMemoryTokenCache, type PayPalToken, type PayPalTokenCache } from "./token";
import { createWebhooks } from "./webhooks";

export type PayPalEnvironment = "sandbox" | "live";

// Fact 4.
export const PAYPAL_BASE_URLS: Record<PayPalEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export type FetchLike = (request: Request) => Promise<Response>;

export type PayPalClientConfig = {
  clientId: string;
  clientSecret: string;
  environment: PayPalEnvironment;
  fetch?: FetchLike;
  tokenCache?: PayPalTokenCache;
  // The partner's BN code, sent as PayPal-Partner-Attribution-Id on every call (Fact 7).
  partnerAttributionId?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export type PayPalRequestOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  // Required on POST: sent as PayPal-Request-Id, which makes retries idempotent (Fact 8).
  requestId?: string;
  // Adds PayPal-Auth-Assertion to act on behalf of this connected merchant (Fact 7).
  merchantId?: string;
  // Sent as the Prefer header; captures use return=representation to get the capture back (R1 facts §3).
  prefer?: "return=representation" | "return=minimal";
  // Sent as is instead of JSON.stringify(body): webhook verification must echo PayPal's bytes (R1 facts §4).
  rawBody?: string;
};

export type PayPalRequest = <T>(options: PayPalRequestOptions) => Promise<T>;

export interface PayPalClient {
  request: PayPalRequest;
  partnerReferrals: ReturnType<typeof createPartnerReferrals>;
  merchantIntegrations: ReturnType<typeof createMerchantIntegrations>;
  orders: ReturnType<typeof createOrders>;
  webhooks: ReturnType<typeof createWebhooks>;
}

type ResolvedConfig = {
  fetch: FetchLike;
  tokenCache: PayPalTokenCache;
  partnerAttributionId: string | undefined;
  maxAttempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
};

const TOKEN_EXPIRY_SKEW_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 429 and 5xx are retried with backoff and jitter (spec §6.3). Retried POSTs carry the
// caller's PayPal-Request-Id, so PayPal applies them at most once (Fact 8).
async function send(config: ResolvedConfig, build: () => Request): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await config.fetch(build());
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt >= config.maxAttempts) return response;
    await config.sleep(backoffDelay(config, response, attempt));
  }
}

function backoffDelay(config: ResolvedConfig, response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return config.baseDelayMs * 2 ** (attempt - 1) + Math.floor(config.random() * config.baseDelayMs);
}

export function createPayPalClient(config: PayPalClientConfig): PayPalClient {
  const resolved: ResolvedConfig = {
    fetch: config.fetch ?? ((request) => fetch(request)),
    tokenCache: config.tokenCache ?? createMemoryTokenCache(),
    partnerAttributionId: config.partnerAttributionId,
    maxAttempts: config.maxAttempts ?? 3,
    baseDelayMs: config.baseDelayMs ?? 250,
    sleep: config.sleep ?? defaultSleep,
    now: config.now ?? (() => Date.now()),
    random: config.random ?? Math.random,
  };
  const baseUrl = PAYPAL_BASE_URLS[config.environment];

  async function fetchToken(): Promise<PayPalToken> {
    const response = await send(
      resolved,
      () =>
        new Request(`${baseUrl}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        }),
    );
    if (!response.ok) throw await payPalErrorFromResponse(response);
    const body: unknown = await response.json();
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    if (typeof record.access_token !== "string") {
      throw new Error("PayPal's token response has no access_token.");
    }
    const expiresIn = typeof record.expires_in === "number" ? record.expires_in : 3600;
    return { accessToken: record.access_token, expiresAt: resolved.now() + expiresIn * 1000 };
  }

  async function accessToken(): Promise<string> {
    const cached = await resolved.tokenCache.get();
    if (cached && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > resolved.now()) return cached.accessToken;
    const token = await fetchToken();
    await resolved.tokenCache.set(token);
    return token.accessToken;
  }

  async function request<T>(options: PayPalRequestOptions): Promise<T> {
    if (options.method === "POST" && !options.requestId) {
      throw new Error("PayPal POST calls require options.requestId, sent as PayPal-Request-Id.");
    }
    const token = await accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (options.body !== undefined || options.rawBody !== undefined) headers["content-type"] = "application/json";
    if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
    if (resolved.partnerAttributionId) headers["PayPal-Partner-Attribution-Id"] = resolved.partnerAttributionId;
    if (options.merchantId) {
      headers["PayPal-Auth-Assertion"] = buildAuthAssertion({ clientId: config.clientId, payerId: options.merchantId });
    }
    if (options.prefer) headers.Prefer = options.prefer;
    const response = await send(
      resolved,
      () =>
        new Request(`${baseUrl}${options.path}`, {
          method: options.method,
          headers,
          body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
        }),
    );
    if (!response.ok) throw await payPalErrorFromResponse(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    request,
    partnerReferrals: createPartnerReferrals(request),
    merchantIntegrations: createMerchantIntegrations(request),
    orders: createOrders(request),
    webhooks: createWebhooks(request),
  };
}
