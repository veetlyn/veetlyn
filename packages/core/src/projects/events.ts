// Services spec §6.6, plus `project.assigned` (an assignment is a committed change the team's bot shows).
export const OUTBOX_EVENT_TYPES = [
  "project.created",
  "project.assigned",
  "quote.created",
  "quote.accepted",
  "amendment.proposed",
  "amendment.accepted",
  "amendment.declined",
  "payment.created",
  "payment.captured",
  "payment.failed",
  "delivery.submitted",
  "delivery.accepted",
  "project.completed",
  "project.cancelled",
  "payout.requested",
  "payout.approved",
  "payout.queued",
  "payout.sent",
  "payout.failed",
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];
