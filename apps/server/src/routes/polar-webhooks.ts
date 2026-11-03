import { polarSubscription, subscriptionSnapshot } from "@jendal-workspace/api/billing/polar";
import { applySubscriptionSnapshot, getBillingAccount, recordPolarWebhookEvent } from "@jendal-workspace/db/repositories/billing";
import { webhooks } from "@polar-sh/sdk/2026-10";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { AppEnv } from "../app-env";

// Polar subscription events are a few kilobytes; a larger body is not one of them.
const MAX_BODY_BYTES = 256 * 1024;

// Billing design §5: verify the Standard Webhooks signature, then record the delivery and apply the subscription in
// one transaction. A failure rolls both back and answers 5xx, so Polar's retry is not dropped as a duplicate.
// Every subscription.* event carries the whole subscription, and an older snapshot than the stored one is ignored,
// so the order deliveries arrive in does not matter.
export function createPolarWebhookRoute(deps: { secret: string }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => {
      c.get("log").set({ polarWebhook: { refused: "body_too_large" } });
      return c.json({ error: "body_too_large" }, 413);
    },
  });

  app.post("/", limit, async (c) => {
    const log = c.get("log");
    if (!deps.secret) {
      log.set({ polarWebhook: { refused: "not_configured" } });
      return c.json({ error: "polar_webhooks_not_configured" }, 503);
    }
    const headers = {
      "webhook-id": c.req.header("webhook-id") ?? "",
      "webhook-timestamp": c.req.header("webhook-timestamp") ?? "",
      "webhook-signature": c.req.header("webhook-signature") ?? "",
    };
    const body = await c.req.text();
    let event: Awaited<ReturnType<typeof webhooks.validateEvent>>;
    try {
      event = await webhooks.validateEvent(body, headers, deps.secret);
    } catch (error) {
      if (error instanceof webhooks.PolarWebhookVerificationError) {
        log.set({ polarWebhook: { refused: "bad_signature" } });
        return c.json({ error: "bad_signature" }, 403);
      }
      // An event type newer than this SDK: acknowledged, so Polar does not retry it.
      if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
        log.set({ polarWebhook: { ignored: "unknown_type" } });
        return c.body(null, 202);
      }
      throw error;
    }
    log.set({ polarWebhook: { id: headers["webhook-id"], type: event.type } });
    if (event.type !== "subscription.created" && event.type !== "subscription.updated") {
      log.set({ polarWebhook: { ignored: "not_a_subscription" } });
      return c.body(null, 202);
    }
    const parsed = polarSubscription.safeParse(event.data);
    if (!parsed.success) {
      log.set({ polarWebhook: { refused: "invalid_subscription" } });
      return c.json({ error: "invalid_subscription" }, 400);
    }
    const snapshot = subscriptionSnapshot(parsed.data);
    if (!snapshot) {
      log.set({ polarWebhook: { ignored: "not_a_workspace_plan" } });
      return c.body(null, 202);
    }
    const outcome = await c.get("db").transaction(async (tx) => {
      if (!(await recordPolarWebhookEvent(tx, { id: headers["webhook-id"], type: event.type }))) return "duplicate";
      // A checkout may race account creation. Roll back the receipt so a retry can apply it later.
      if (!(await getBillingAccount(tx, snapshot.organizationId))) throw new Error("Billing account not found for Polar subscription");
      return (await applySubscriptionSnapshot(tx, snapshot)) ? "applied" : "stale";
    });
    log.set({ polarWebhook: { outcome, organizationId: snapshot.organizationId, status: snapshot.status } });
    return c.body(null, 202);
  });
  return app;
}
