import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const PAYPAL_WEBHOOK_EVENT_STATUSES = ["received", "processed", "ignored", "parked", "failed"] as const;
export type PayPalWebhookEventStatus = (typeof PAYPAL_WEBHOOK_EVENT_STATUSES)[number];

// Services spec §6.4: verified PayPal events, one row per event id, so a redelivery is dropped. Only ids are
// kept; the processor re-fetches the resource from PayPal. "parked" needs a person; "failed" ran out of retries.
export const paypalWebhookEvent = pgTable(
  "paypal_webhook_event",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    customId: text("custom_id"),
    orderId: text("order_id"),
    merchantId: text("merchant_id"),
    status: text("status", { enum: PAYPAL_WEBHOOK_EVENT_STATUSES }).notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    note: text("note"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [index("paypal_webhook_event_status_idx").on(t.status, t.receivedAt)],
);
