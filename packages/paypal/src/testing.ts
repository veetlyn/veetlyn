import type { FetchLike } from "./client";

export type RecordedRequest = { url: string; method: string; headers: Headers; body: string | null };

// Shared fake fetch for every test of this package and its callers (router tests included).
export function fakeFetch(handler: (request: RecordedRequest, callCount: number) => Response) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (request) => {
    const body = await request.text();
    const record: RecordedRequest = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: body || null,
    };
    requests.push(record);
    return handler(record, requests.length);
  };
  return { requests, fetch: fetchImpl };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function recordedAt(requests: RecordedRequest[], index: number): RecordedRequest {
  const request = requests[index];
  if (!request) throw new Error(`Only ${requests.length} requests recorded; no request #${index}.`);
  return request;
}

export const FAKE_TOKEN_RESPONSE = { access_token: "token-1", expires_in: 32400 };
