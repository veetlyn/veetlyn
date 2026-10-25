export type DeliveryChannel = "email_client" | "email_member" | "email_dispute" | "discord" | "webhook";
export type DeliveryStatus = "pending" | "sent" | "failed" | "skipped";

export type OutboxDeliveryRecord = {
  id: string;
  outboxId: string;
  channel: DeliveryChannel;
  recipient: string;
  dedupeKey: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  lastError: string | null;
  providerMessageId: string | null;
};

// 1 min, 5 min, 15 min, 1 h, 6 h: one entry per attempt index.
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export function computeNextAttemptAt(attempts: number, baseTime: Date): Date | null {
  const delayMs = RETRY_DELAYS_MS[attempts];
  return delayMs === undefined ? null : new Date(baseTime.getTime() + delayMs);
}

// One durable delivery identity per (event, channel, recipient).
export function deliveryDedupeKey(outboxId: string, channel: DeliveryChannel, recipient: string): string {
  return `${outboxId}:${channel}:${recipient}`;
}

export function recordDeliverySuccess(record: OutboxDeliveryRecord, providerMessageId: string | null, at: Date): OutboxDeliveryRecord {
  return { ...record, status: "sent", attempts: record.attempts + 1, sentAt: at, lastError: null, providerMessageId };
}

export function recordDeliveryFailure(record: OutboxDeliveryRecord, error: string, at: Date): OutboxDeliveryRecord {
  const attempts = record.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return { ...record, status: "failed", attempts, nextAttemptAt: null, lastError: error };
  }
  return { ...record, status: "pending", attempts, nextAttemptAt: computeNextAttemptAt(record.attempts, at), lastError: error };
}
