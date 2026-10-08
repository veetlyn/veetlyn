import type { PayPalServices } from "@jendal-workspace/api/context";
import type { Database } from "@jendal-workspace/db";
import { createPayPalClient } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../app-env";
import { createPayPalWebhookRoute, type PayPalWebhookRouteDeps } from "./paypal-webhooks";

const VERIFY_PATH = "/v1/notifications/verify-webhook-signature";

const SIGNATURE_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "TRANSMISSION-1",
  "paypal-transmission-sig": "SIGNATURE",
  "paypal-transmission-time": "2026-10-08T10:00:00Z",
};

// Spacing and key order a re-serialization would change: the verification must send these bytes.
const RAW_BODY =
  '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource_type":"capture","resource":{"id":"CAPTURE-1","custom_id":"payment-1","payee":{"merchant_id":"SELLER1"},"supplementary_data":{"related_ids":{"order_id":"ORDER-1"}}}}';

type VerifyAnswer = "SUCCESS" | "FAILURE" | 503;

function makePayPal(answer: VerifyAnswer) {
  const { fetch, requests } = fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.url.endsWith(VERIFY_PATH)) {
      if (answer === 503) return jsonResponse(503, { name: "SERVICE_UNAVAILABLE", debug_id: "d503" });
      return jsonResponse(200, { verification_status: answer });
    }
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
  const paypal: PayPalServices = {
    client: createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch,
      sleep: () => Promise.resolve(),
    }),
    partnerId: "PARTNER42",
    returnUrl: "http://admin.localhost:3001/api/paypal/onboarding/return",
    sdk: { clientId: "partner-client-id", partnerAttributionId: "PAYLEOR_BN", environment: "sandbox" },
  };
  return { paypal, requests };
}

function buildApp(
  options: {
    answer?: VerifyAnswer;
    paypal?: null;
    webhookId?: string;
    stored?: "received" | "processed";
    enqueue?: PayPalWebhookRouteDeps["enqueue"];
  } = {},
) {
  const { paypal, requests } = makePayPal(options.answer ?? "SUCCESS");
  const record = vi.fn(async () => options.stored ?? "received");
  const enqueue = vi.fn(options.enqueue ?? (async () => undefined));
  const db = {} as Database;
  const app = new Hono<AppEnv>();
  app.use(evlog());
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  app.route(
    "/webhooks/paypal",
    createPayPalWebhookRoute({
      paypal: options.paypal === null ? undefined : paypal,
      webhookId: options.webhookId ?? "WEBHOOK-1",
      enqueue,
      record,
    }),
  );
  return { app, record, enqueue, requests, db };
}

function post(app: Hono<AppEnv>, body: string = RAW_BODY, headers: Record<string, string> = SIGNATURE_HEADERS) {
  return app.request("http://localhost/webhooks/paypal", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const verifyRequests = (requests: RecordedRequest[]) => requests.filter((request) => request.url.endsWith(VERIFY_PATH));

describe("POST /webhooks/paypal", () => {
  it("verifies a new event, stores its ids and enqueues it", async () => {
    const { app, record, enqueue, requests, db } = buildApp();

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(record).toHaveBeenCalledWith(db, {
      id: "WH-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceType: "capture",
      resourceId: "CAPTURE-1",
      customId: "payment-1",
      orderId: "ORDER-1",
      merchantId: "SELLER1",
    });
    expect(enqueue).toHaveBeenCalledWith({ id: "WH-1", eventType: "PAYMENT.CAPTURE.COMPLETED" });
    const [verify] = verifyRequests(requests);
    expect(verify?.body).toBeDefined();
    expect(verify?.body?.endsWith(`,"webhook_event":${RAW_BODY}}`)).toBe(true);
    expect(JSON.parse(verify?.body ?? "{}")).toMatchObject({
      auth_algo: "SHA256withRSA",
      transmission_id: "TRANSMISSION-1",
      transmission_sig: "SIGNATURE",
      webhook_id: "WEBHOOK-1",
    });
  });

  it("acknowledges a redelivered event already processed without enqueuing it", async () => {
    const { app, enqueue } = buildApp({ stored: "processed" });

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues a redelivered event still waiting, since an earlier enqueue may have failed", async () => {
    const { app, enqueue } = buildApp({ stored: "received" });

    expect((await post(app)).status).toBe(200);
    expect((await post(app)).status).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("refuses an event PayPal does not vouch for and stores nothing", async () => {
    const { app, record, enqueue } = buildApp({ answer: "FAILURE" });

    const res = await post(app);

    expect(res.status).toBe(400);
    expect(record).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a request without the signature headers without asking PayPal", async () => {
    const { app, record, requests } = buildApp();
    const { "paypal-transmission-sig": _omitted, ...headers } = SIGNATURE_HEADERS;

    const res = await post(app, RAW_BODY, headers);

    expect(res.status).toBe(400);
    expect(requests).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });

  it("answers 503 when webhooks are not configured, so PayPal retries", async () => {
    expect((await post(buildApp({ webhookId: "" }).app)).status).toBe(503);
    expect((await post(buildApp({ paypal: null }).app)).status).toBe(503);
  });

  it("answers 502 when PayPal cannot verify the signature right now", async () => {
    const { app, record } = buildApp({ answer: 503 });

    const res = await post(app);

    expect(res.status).toBe(502);
    expect(record).not.toHaveBeenCalled();
  });

  it("answers 500 when the event cannot be enqueued, so PayPal delivers it again", async () => {
    const { app } = buildApp({
      enqueue: async () => {
        throw new Error("queue unavailable");
      },
    });

    expect((await post(app)).status).toBe(500);
  });

  it("refuses a body that is not JSON or not an event", async () => {
    const { app, requests, record } = buildApp();

    expect((await post(app, "not json")).status).toBe(400);
    expect((await post(app, JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED" }))).status).toBe(400);
    expect(verifyRequests(requests)).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });
});
