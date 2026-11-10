import { defineMachine } from "../state-machines/machine";

export const PAYPAL_WEBHOOK_EVENT_STATUSES = ["received", "processed", "ignored", "parked", "failed"] as const;
export type PayPalWebhookEventStatus = (typeof PAYPAL_WEBHOOK_EVENT_STATUSES)[number];

// A verified PayPal event finishes once: two queue messages for one event can be in flight, and a slow retry must not
// turn a processed event into a failed one. "parked" needs a person; "failed" ran out of retries or got stuck.
export const paypalWebhookEventMachine = defineMachine({
  name: "paypal_webhook_event",
  states: PAYPAL_WEBHOOK_EVENT_STATUSES,
  initial: "received",
  transitions: {
    process: { from: ["received"], to: "processed" },
    ignore: { from: ["received"], to: "ignored" },
    park: { from: ["received"], to: "parked" },
    fail: { from: ["received"], to: "failed" },
  },
});
export type PayPalWebhookEventEvent = (typeof paypalWebhookEventMachine.events)[number];

export const WEBHOOK_EVENT_FINISHED_BY = {
  processed: "process",
  ignored: "ignore",
  parked: "park",
  failed: "fail",
} as const satisfies Record<Exclude<PayPalWebhookEventStatus, "received">, PayPalWebhookEventEvent>;
