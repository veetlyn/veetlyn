import type { PayPalServices } from "@jendal-workspace/api/context";
import type { Database } from "@jendal-workspace/db";
import { recordWebhookEvent } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { type ParsedWebhookEvent, parseWebhookEvent, PayPalError } from "@jendal-workspace/paypal";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

export type PayPalWebhookRouteDeps = {
  paypal: PayPalServices | undefined;
  webhookId: string;
  enqueue: (event: { id: string; eventType: string }) => Promise<unknown>;
  record?: (db: Database, event: ParsedWebhookEvent) => ReturnType<typeof recordWebhookEvent>;
};

const HEADER_NAMES = {
  authAlgo: "paypal-auth-algo",
  certUrl: "paypal-cert-url",
  transmissionId: "paypal-transmission-id",
  transmissionSig: "paypal-transmission-sig",
  transmissionTime: "paypal-transmission-time",
} as const;

// Services spec §6.4: verify, store by event id, acknowledge, process from the Queue. PayPal retries any
// non-2xx for 3 days, so a 5xx here is a request to try again later.
export function createPayPalWebhookRoute(deps: PayPalWebhookRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const record = deps.record ?? recordWebhookEvent;

  app.post("/", async (c) => {
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
    let body: unknown;
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
      log.error(error, { paypal: { status: error.status, debugId: error.debugId } });
      return c.json({ error: "verification_unavailable" }, 502);
    }
    if (!verified) {
      log.set({ paypalWebhook: { refused: "signature" } });
      return c.json({ error: "invalid_signature" }, 400);
    }

    const status = await record(c.get("db"), event);
    // A redelivery of an event still "received" is enqueued again: the first enqueue may have failed.
    if (status === "received") await deps.enqueue({ id: event.id, eventType: event.eventType });
    log.set({ paypalWebhook: { stored: status } });
    return c.json({ ok: true }, 200);
  });

  return app;
}
