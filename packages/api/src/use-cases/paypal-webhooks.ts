import type { PayPalWebhookEventRow } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import { payment } from "@jendal-workspace/db/schema/projects";
import { captureFromOrder, PayPalError } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { applyCaptureFact, CaptureFactConflict, captureFact, capturePayment, type PaymentDeps } from "./payments";

export type WebhookOutcome = { status: "processed" | "ignored" | "parked"; note: string };

const CAPTURE_EVENTS = new Set([
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.DENIED",
]);
const PARKED_EVENTS = new Set(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"]);
const REFUND_NOTE = "refunds and reversals need a person (run 4)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findPayment(deps: PaymentDeps, event: PayPalWebhookEventRow) {
  const byCustomId = event.customId && UUID.test(event.customId) ? eq(payment.id, event.customId) : null;
  const byOrder = event.orderId ? eq(payment.paypalOrderId, event.orderId) : null;
  const where = byCustomId ?? byOrder;
  if (!where) return null;
  const [row] = await deps.db.select().from(payment).where(where).limit(1);
  return row ?? null;
}

// Services spec §6.4: PayPal does not guarantee order, so the event only says which payment to look at; the
// order is re-fetched and its current capture applied through the same idempotent step as the pay page.
export async function processPayPalWebhookEvent(deps: PaymentDeps, event: PayPalWebhookEventRow): Promise<WebhookOutcome> {
  const isCapture = CAPTURE_EVENTS.has(event.eventType);
  const isApproval = event.eventType === "CHECKOUT.ORDER.APPROVED";
  if (!isCapture && !isApproval && !PARKED_EVENTS.has(event.eventType)) {
    return { status: "ignored", note: "event type not handled" };
  }
  const row = await findPayment(deps, event);
  if (!row) return { status: "ignored", note: "not a Payleor payment" };
  if (PARKED_EVENTS.has(event.eventType)) return { status: "parked", note: REFUND_NOTE };

  const team = await findTeamById(deps.db, row.teamId);
  const merchantId = team?.paypalMerchantId;
  if (!merchantId || (event.merchantId && event.merchantId !== merchantId)) {
    return { status: "parked", note: "merchant does not match the team" };
  }
  const orderId = event.orderId ?? row.paypalOrderId;
  if (!orderId) return { status: "parked", note: "no order id" };

  try {
    if (isApproval) {
      if (row.status !== "pending" || row.paypalCaptureId || row.paypalOrderId !== orderId) {
        return { status: "processed", note: "nothing to do" };
      }
      try {
        const { outcome } = await capturePayment(deps, { paymentId: row.id, orderId });
        return { status: "processed", note: outcome };
      } catch (error) {
        // The pay page reports these to the client (declined, restarted); nothing is left for the webhook.
        if (error instanceof TRPCError && error.code !== "INTERNAL_SERVER_ERROR") {
          return { status: "processed", note: error.message };
        }
        throw error;
      }
    }
    const order = await deps.paypal.client.orders.get({ orderId, merchantId });
    const capture = captureFromOrder(order);
    if (!capture) return { status: "ignored", note: "the order has no capture yet" };
    if (capture.status === "REFUNDED" || capture.status === "PARTIALLY_REFUNDED") {
      return { status: "parked", note: REFUND_NOTE };
    }
    const result = await applyCaptureFact(deps.db, captureFact(row.id, orderId, capture));
    return { status: "processed", note: result };
  } catch (error) {
    if (error instanceof CaptureFactConflict) return { status: "parked", note: error.message };
    // 4xx from PayPal will not change on retry (gone, forbidden); 429 and 5xx are retried by the queue.
    if (error instanceof PayPalError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      return { status: "parked", note: `PayPal ${error.status} ${error.name} (debug_id ${error.debugId ?? "none"})` };
    }
    throw error;
  }
}
