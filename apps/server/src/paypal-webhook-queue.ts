import type { WebhookOutcome } from "@jendal-workspace/api/use-cases/paypal-webhooks";
import type { PayPalWebhookEventRow } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { log } from "evlog";

export const MAX_WEBHOOK_ATTEMPTS = 5;
const RETRY_STEP_SECONDS = 30;

export type WebhookMessage = {
  readonly body: unknown;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type PayPalWebhookQueueDeps = {
  find: (eventId: string) => Promise<PayPalWebhookEventRow | null>;
  process: (event: PayPalWebhookEventRow) => Promise<WebhookOutcome>;
  // false when the event was no longer "received": another delivery of it finished first.
  finish: (eventId: string, outcome: { status: WebhookOutcome["status"] | "failed"; note?: string }) => Promise<boolean>;
  // The attempt count after this one, or null when the event is no longer "received".
  noteAttempt: (eventId: string, error: string) => Promise<number | null>;
};

const ACTION = "paypal.webhook.process";

function eventIdOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("eventId" in body)) return null;
  return typeof body.eventId === "string" ? body.eventId : null;
}

function errorNote(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function logFinishedElsewhere(event: PayPalWebhookEventRow): void {
  log.info({ action: ACTION, paypalWebhook: { eventId: event.id, eventType: event.eventType, finishedElsewhere: true } });
}

function retryDelay(message: WebhookMessage) {
  return { delaySeconds: RETRY_STEP_SECONDS * message.attempts };
}

// Services spec §6.4. Messages are processed one at a time so a slow PayPal call cannot fail the batch;
// each message is acked or retried on its own.
export async function handlePayPalWebhookBatch(messages: readonly WebhookMessage[], deps: PayPalWebhookQueueDeps): Promise<void> {
  for (const message of messages) {
    try {
      await handleMessage(message, deps);
    } catch (error) {
      // The event table itself is unreachable, so nothing could be recorded; the Queue's own retries apply.
      log.error({ action: ACTION, error: { name: error instanceof Error ? error.name : typeof error } });
      message.retry(retryDelay(message));
    }
  }
}

async function handleMessage(message: WebhookMessage, deps: PayPalWebhookQueueDeps): Promise<void> {
  const eventId = eventIdOf(message.body);
  if (!eventId) {
    log.error({ action: ACTION, error: { name: "MalformedMessage", message: "queue message has no event id" } });
    message.ack();
    return;
  }
  const event = await deps.find(eventId);
  if (!event || event.status !== "received") {
    message.ack();
    return;
  }
  try {
    const outcome = await deps.process(event);
    if (await deps.finish(eventId, outcome)) {
      log.info({ action: ACTION, paypalWebhook: { eventId, eventType: event.eventType, ...outcome } });
    } else {
      logFinishedElsewhere(event);
    }
    message.ack();
  } catch (error) {
    const note = errorNote(error);
    const attempts = await deps.noteAttempt(eventId, note);
    if (attempts === null) {
      logFinishedElsewhere(event);
      message.ack();
    } else if (message.attempts >= MAX_WEBHOOK_ATTEMPTS) {
      if (await deps.finish(eventId, { status: "failed", note })) {
        log.error({
          action: ACTION,
          paypalWebhook: { eventId, eventType: event.eventType, status: "failed", attempts },
          error: { name: error instanceof Error ? error.name : typeof error },
        });
      } else {
        logFinishedElsewhere(event);
      }
      message.ack();
    } else {
      message.retry(retryDelay(message));
    }
  }
}
