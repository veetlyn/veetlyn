import type { FetchLike } from "./client";
import type { JsonBody } from "./schemas";

export type RecordedRequest = { url: string; method: string; headers: Headers; body: string | null };

// Shared fake fetch for every test of this package and its callers (router tests included).
export function fakeFetch(handler: (request: RecordedRequest, callCount: number) => Response | Promise<Response>) {
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

export function jsonResponse(status: number, body: JsonBody): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function recordedAt(requests: RecordedRequest[], index: number): RecordedRequest {
  const request = requests[index];
  if (!request) throw new Error(`Only ${requests.length} requests recorded; no request #${index}.`);
  return request;
}

export const FAKE_TOKEN_RESPONSE = { access_token: "token-1", expires_in: 32400 };
