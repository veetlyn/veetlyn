import type { PayPalServices } from "@jendal-workspace/api/context";
import type { JsonValue } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { type PayPalWebhookEventInput, recordWebhookEvent } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { parseWebhookEvent, PayPalError } from "@jendal-workspace/paypal";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { AppEnv } from "../app-env";

export type PayPalWebhookRouteDeps = {
  paypal: PayPalServices | undefined;
  webhookId: string;
  enqueue: (eventId: string, options: { delaySeconds?: number }) => Promise<void>;
  record?: (db: Database, event: PayPalWebhookEventInput) => ReturnType<typeof recordWebhookEvent>;
};

const HEADER_NAMES = {
  authAlgo: "paypal-auth-algo",
  certUrl: "paypal-cert-url",
  transmissionId: "paypal-transmission-id",
  transmissionSig: "paypal-transmission-sig",
  transmissionTime: "paypal-transmission-time",
} as const;

// PayPal events are a few kilobytes; a larger body is not one of them.
const MAX_BODY_BYTES = 1024 * 1024;
// The pay page captures right after approval; the delay lets it win, so the webhook rarely races it.
export const APPROVAL_DELAY_SECONDS = 60;
// PayPal answers that can change on retry (an expired token, a timeout, rate limiting); other 4xx answers
// mean PayPal rejected the delivery's own data, such as a forged header or cert URL.
const RETRIED_PAYPAL_STATUSES = new Set([401, 408, 429]);

// Services spec §6.4: verify, store by event id, acknowledge, process from the Queue. PayPal retries any
// non-2xx for 3 days, so a 5xx here is a request to try again later.
export function createPayPalWebhookRoute(deps: PayPalWebhookRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const record = deps.record ?? recordWebhookEvent;

  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => {
      c.get("log").set({ paypalWebhook: { refused: "body_too_large" } });
      return c.json({ error: "body_too_large" }, 413);
    },
  });

  app.post("/", limit, async (c) => {
    const log = c.get("log");
    if (!deps.paypal || !deps.webhookId) {
      log.set({ paypalWebhook: { refused: "not_configured" } });
      return c.json({ error: "paypal_webhooks_not_configured" }, 503);
    }
    const authAlgo = c.req.header(HEADER_NAMES.authAlgo);
    const certUrl = c.req.header(HEADER_NAMES.certUrl);
    const transmissionId = c.req.header(HEADER_NAMES.transmissionId);
    const transmissionSig = c.req.header(HEADER_NAMES.transmissionSig);
    const transmissionTime = c.req.header(HEADER_NAMES.transmissionTime);
    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      log.set({ paypalWebhook: { refused: "missing_signature_headers" } });
      return c.json({ error: "missing_signature_headers" }, 400);
    }
    const rawBody = await c.req.text();
    let body: JsonValue;
    try {
      body = JSON.parse(rawBody);
    } catch {
      log.set({ paypalWebhook: { refused: "invalid_body" } });
      return c.json({ error: "invalid_body" }, 400);
    }
    const event = parseWebhookEvent(body);
    if (!event) {
      log.set({ paypalWebhook: { refused: "invalid_event" } });
      return c.json({ error: "invalid_event" }, 400);
    }
    log.set({ paypalWebhook: { eventId: event.id, eventType: event.eventType, transmissionId } });

    let verified: boolean;
    try {
      verified = await deps.paypal.client.webhooks.verifySignature({
        webhookId: deps.webhookId,
        headers: { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime },
        rawBody,
      });
    } catch (error) {
      if (!(error instanceof PayPalError)) throw error;
      if (error.status >= 400 && error.status < 500 && !RETRIED_PAYPAL_STATUSES.has(error.status)) {
        log.set({ paypalWebhook: { refused: "verification_rejected" }, paypal: { status: error.status, debugId: error.debugId } });
        return c.json({ error: "verification_rejected" }, 400);
      }
      log.error(error, { paypal: { status: error.status, debugId: error.debugId } });
      return c.json({ error: "verification_unavailable" }, 502);
    }
    if (!verified) {
      log.set({ paypalWebhook: { refused: "signature" } });
      return c.json({ error: "invalid_signature" }, 400);
    }

    const status = await record(c.get("db"), event);
    // A redelivery of an event still "received" is enqueued again: the first enqueue may have failed.
    if (status === "received") {
      await deps.enqueue(
        event.id,
        event.eventType === "CHECKOUT.ORDER.APPROVED" ? { delaySeconds: APPROVAL_DELAY_SECONDS } : {},
      );
    }
    log.set({ paypalWebhook: { stored: status } });
    return c.json({ ok: true }, 200);
  });

  return app;
}
