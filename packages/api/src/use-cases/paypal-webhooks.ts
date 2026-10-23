import { orderIdFromCustomId } from "@jendal-workspace/core";
import { findOrderByCaptureId, findOrderById, type OrderRow } from "@jendal-workspace/db/repositories/orders";
import type { PayPalWebhookEventRow } from "@jendal-workspace/db/repositories/paypal-webhooks";
import type { PaymentRow } from "@jendal-workspace/db/repositories/projects";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import { payment } from "@jendal-workspace/db/schema/projects";
import { captureFromOrder, type PayPalOrder } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import type { EmailServices } from "../context";
import { applyOrderCaptureFact, applyOrderRefund, captureOrderFromWebhook, orderCaptureFact, recordOrderFees } from "./orders";
import { applyPaymentRefunds } from "./payment-refunds";
import {
  applyCaptureFact,
  CaptureFactConflict,
  captureFact,
  capturePayment,
  type PaymentDeps,
  recordCaptureFees,
} from "./payments";
import { isRefundedCaptureStatus, isSettledPayPalRefusal } from "./paypal-amounts";

export type WebhookOutcome = { status: "processed" | "ignored" | "parked"; note: string };
export type WebhookDeps = PaymentDeps & { email?: EmailServices };

const CAPTURE_EVENTS = new Set([
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.DENIED",
]);
const REFUND_EVENTS = new Set(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"]);
const NOT_OURS: WebhookOutcome = { status: "ignored", note: "not a platform payment" };
// Refusals the pay page shows the client; the webhook has nothing left to do after them.
const CLIENT_REFUSALS = new Set(["CONFLICT", "BAD_REQUEST", "UNPROCESSABLE_CONTENT"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findPayment(deps: PaymentDeps, event: PayPalWebhookEventRow) {
  const byCustomId = event.customId && UUID.test(event.customId) ? eq(payment.id, event.customId) : null;
  const byOrder = event.orderId ? eq(payment.paypalOrderId, event.orderId) : null;
  const where = byCustomId ?? byOrder;
  if (!where) return null;
  const [row] = await deps.db.select().from(payment).where(where).limit(1);
  return row ?? null;
}

// PayPal refusals that will not change on retry, and capture facts that contradict the platform's records.
function settledFailure(cause: unknown): WebhookOutcome | null {
  if (cause instanceof CaptureFactConflict) return { status: "parked", note: cause.message };
  if (isSettledPayPalRefusal(cause)) {
    return { status: "parked", note: `PayPal ${cause.status} ${cause.name} (debug_id ${cause.debugId ?? "none"})` };
  }
  return null;
}

function clientRefusal(cause: unknown): WebhookOutcome | null {
  if (!(cause instanceof TRPCError)) return null;
  return { status: CLIENT_REFUSALS.has(cause.code) ? "processed" : "parked", note: cause.message };
}

// The event's merchant, when PayPal names one, must be the team's: anything else is not for this team to act on.
type TeamMerchant = { found: true; merchantId: string } | { found: false; outcome: WebhookOutcome };

async function teamMerchant(deps: PaymentDeps, teamId: string, event: PayPalWebhookEventRow): Promise<TeamMerchant> {
  const team = await findTeamById(deps.db, teamId);
  const merchantId = team?.paypalMerchantId;
  if (!merchantId) return { found: false, outcome: { status: "parked", note: "team has no PayPal merchant" } };
  if (event.merchantId && event.merchantId !== merchantId) {
    return { found: false, outcome: { status: "parked", note: "merchant does not match the team" } };
  }
  return { found: true, merchantId };
}

// Services spec §6.4: PayPal does not guarantee order, so the event only says which payment or store order to
// look at; the PayPal order is re-fetched and its current state applied through the same idempotent steps as
// the browser. Store orders carry an "order:" custom id; refunds carry neither id and are found by capture id.
export async function processPayPalWebhookEvent(deps: WebhookDeps, event: PayPalWebhookEventRow): Promise<WebhookOutcome> {
  const isRefund = REFUND_EVENTS.has(event.eventType);
  if (!CAPTURE_EVENTS.has(event.eventType) && event.eventType !== "CHECKOUT.ORDER.APPROVED" && !isRefund) {
    return { status: "ignored", note: "event type not handled" };
  }
  const orderId = orderIdFromCustomId(event.customId);
  if (orderId) {
    const order = await findOrderById(deps.db, orderId);
    return order ? processOrderEvent(deps, order, event) : NOT_OURS;
  }
  if (isRefund && event.captureId) {
    const order = await findOrderByCaptureId(deps.db, event.captureId);
    if (order) return processOrderEvent(deps, order, event);
    const [refunded] = await deps.db.select().from(payment).where(eq(payment.paypalCaptureId, event.captureId)).limit(1);
    if (refunded) return processPaymentEvent(deps, event, refunded);
  }
  return processPaymentEvent(deps, event);
}

async function processOrderEvent(deps: WebhookDeps, order: OrderRow, event: PayPalWebhookEventRow): Promise<WebhookOutcome> {
  const merchant = await teamMerchant(deps, order.teamId, event);
  if (!merchant.found) return merchant.outcome;
  const { merchantId } = merchant;
  const paypalOrderId = event.orderId ?? order.paypalOrderId;
  if (!paypalOrderId) return { status: "parked", note: "no order id" };

  try {
    if (event.eventType === "CHECKOUT.ORDER.APPROVED") {
      if (order.status !== "pending" || order.paypalCaptureId || order.paypalOrderId !== paypalOrderId) {
        return { status: "processed", note: "nothing to do" };
      }
      try {
        return { status: "processed", note: await captureOrderFromWebhook(deps, order, merchantId) };
      } catch (error) {
        const refusal = clientRefusal(error);
        if (refusal) return refusal;
        throw error;
      }
    }
    const paypalOrder = await deps.paypal.client.orders.get({ orderId: paypalOrderId, merchantId });
    if (REFUND_EVENTS.has(event.eventType)) return await refundOutcome(deps, order, paypalOrder, event);
    const capture = captureFromOrder(paypalOrder);
    // PayPal sent a capture event, so its order lookup is lagging; the queue retries.
    if (!capture) throw new Error(`Order ${paypalOrderId} has no capture yet`);
    if (isRefundedCaptureStatus(capture.status)) return await refundOutcome(deps, order, paypalOrder, event);
    const fact = orderCaptureFact(order.id, paypalOrderId, capture);
    const result = await applyOrderCaptureFact(deps, fact);
    // applyOrderCaptureFact only logs a fee failure; here it throws, so the queue retries it and then marks it failed.
    if (result === "applied" || result === "already_applied") await recordOrderFees(deps.db, fact);
    return { status: "processed", note: result };
  } catch (error) {
    const settled = settledFailure(error);
    if (settled) return settled;
    throw error;
  }
}

function expectedRefundId(event: PayPalWebhookEventRow): string | null {
  return event.eventType === "PAYMENT.CAPTURE.REFUNDED" && event.resourceType === "refund" ? event.resourceId : null;
}

async function refundOutcome(
  deps: WebhookDeps,
  order: OrderRow,
  paypalOrder: PayPalOrder,
  event: PayPalWebhookEventRow,
): Promise<WebhookOutcome> {
  const note = await applyOrderRefund(deps, order.id, paypalOrder, { expectedRefundId: expectedRefundId(event) });
  return { status: "processed", note };
}

// found: the payment a refund event named by its capture id.
async function processPaymentEvent(
  deps: PaymentDeps,
  event: PayPalWebhookEventRow,
  found?: PaymentRow,
): Promise<WebhookOutcome> {
  const row = found ?? (await findPayment(deps, event));
  if (!row) return NOT_OURS;

  const merchant = await teamMerchant(deps, row.teamId, event);
  if (!merchant.found) return merchant.outcome;
  const { merchantId } = merchant;
  const orderId = event.orderId ?? row.paypalOrderId;
  if (!orderId) return { status: "parked", note: "no order id" };

  try {
    if (event.eventType === "CHECKOUT.ORDER.APPROVED") {
      if (row.status !== "pending" || row.paypalCaptureId || row.paypalOrderId !== orderId) {
        return { status: "processed", note: "nothing to do" };
      }
      try {
        const { outcome } = await capturePayment(deps, { paymentId: row.id, orderId });
        return { status: "processed", note: outcome };
      } catch (error) {
        const refusal = clientRefusal(error);
        if (refusal) return refusal;
        throw error;
      }
    }
    const order = await deps.paypal.client.orders.get({ orderId, merchantId });
    const capture = captureFromOrder(order);
    if (REFUND_EVENTS.has(event.eventType) || (capture && isRefundedCaptureStatus(capture.status))) {
      const note = await applyPaymentRefunds(deps, row.id, order, { expectedRefundId: expectedRefundId(event) });
      return { status: "processed", note };
    }
    // PayPal sent a capture event, so its order lookup is lagging; the queue retries.
    if (!capture) throw new Error(`Order ${orderId} has no capture yet`);
    const fact = captureFact(row.id, orderId, capture);
    const result = await applyCaptureFact(deps.db, fact);
    // applyCaptureFact only logs a fee failure; here it throws, so the queue retries it and then marks it failed.
    if (result === "applied" || result === "already_applied") await recordCaptureFees(deps.db, fact);
    return { status: "processed", note: result };
  } catch (error) {
    const settled = settledFailure(error);
    if (settled) return settled;
    throw error;
  }
}
