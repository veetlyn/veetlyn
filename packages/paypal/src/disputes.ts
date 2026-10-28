import { z } from "zod";

import { type JsonBody, parsedItems, webhookEventSchema } from "./schemas";

export const DISPUTE_WEBHOOK_EVENT_TYPES = ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"] as const;

export type PayPalDisputeWebhookEventType = (typeof DISPUTE_WEBHOOK_EVENT_TYPES)[number];

const disputeEventTypes = new Set<string>(DISPUTE_WEBHOOK_EVENT_TYPES);

function isDisputeWebhookEventType(eventType: string): eventType is PayPalDisputeWebhookEventType {
  return disputeEventTypes.has(eventType);
}

// PayPal amount strings ("1234.56"). The platform's currencies (USD, EUR) both have two decimals.
export function parseDecimalToMinorUnits(value: string): number | null {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

const disputeText = z.string().min(1).nullable().catch(null);

const disputeTransactionSchema = z.looseObject({
  seller_transaction_id: disputeText,
  buyer_transaction_id: disputeText,
});

// The dispute resource of a CUSTOMER.DISPUTE.* webhook, shaped by the disputes API
// (paypal-rest-api-specifications/openapi/customer_disputes_v1.json). Fields beyond dispute_id are read
// leniently: a dispute is still matched and its detail re-fetched when a field PayPal may omit is absent.
export const PayPalDisputeResourceSchema = z.looseObject({
  dispute_id: z.string().min(1),
  reason: disputeText,
  status: disputeText,
  dispute_state: disputeText,
  dispute_amount: z.object({ currency_code: disputeText, value: disputeText }).nullable().catch(null),
  disputed_transactions: z
    .array(z.unknown())
    .catch([])
    .transform((rows) => parsedItems(disputeTransactionSchema, rows)),
  dispute_life_cycle_stage: disputeText,
  dispute_outcome: z.looseObject({ outcome_code: disputeText }).nullable().catch(null),
});

// The ids and amounts the platform keeps from a verified dispute event. The payload itself is not stored:
// the dispute row re-fetches the resource from PayPal.
export type PayPalDisputeWebhook = {
  id: string;
  eventType: PayPalDisputeWebhookEventType;
  disputeId: string;
  reason: string | null;
  status: string | null;
  disputeState: string | null;
  amountMinor: number | null;
  currency: string | null;
  sellerTransactionIds: string[];
  buyerTransactionIds: string[];
  lifeCycleStage: string | null;
  outcomeCode: string | null;
};

export function parseDisputeWebhookEvent(body: JsonBody): PayPalDisputeWebhook | null {
  const event = webhookEventSchema.safeParse(body);
  if (!event.success || !isDisputeWebhookEventType(event.data.event_type)) return null;
  const resource = PayPalDisputeResourceSchema.safeParse(event.data.resource);
  if (!resource.success) return null;
  const dispute = resource.data;
  const amountMinor = dispute.dispute_amount ? parseDecimalToMinorUnits(dispute.dispute_amount.value ?? "") : null;
  return {
    id: event.data.id,
    eventType: event.data.event_type,
    disputeId: dispute.dispute_id,
    reason: dispute.reason,
    status: dispute.status,
    disputeState: dispute.dispute_state,
    amountMinor,
    currency: amountMinor !== null ? (dispute.dispute_amount?.currency_code ?? null) : null,
    sellerTransactionIds: dispute.disputed_transactions.flatMap((tx) => (tx.seller_transaction_id ? [tx.seller_transaction_id] : [])),
    buyerTransactionIds: dispute.disputed_transactions.flatMap((tx) => (tx.buyer_transaction_id ? [tx.buyer_transaction_id] : [])),
    lifeCycleStage: dispute.dispute_life_cycle_stage,
    outcomeCode: dispute.dispute_outcome?.outcome_code ?? null,
  };
}
