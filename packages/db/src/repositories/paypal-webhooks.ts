import { eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { type PayPalWebhookEventStatus, paypalWebhookEvent } from "../schema/paypal-webhooks";

export type PayPalWebhookEventInput = {
  id: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  customId: string | null;
  orderId: string | null;
  merchantId: string | null;
};

export type PayPalWebhookEventRow = typeof paypalWebhookEvent.$inferSelect;

// PayPal redelivers until it gets a 2xx; the event id makes every redelivery a no-op. Returns the stored status,
// so the caller enqueues only events still waiting.
export async function recordWebhookEvent(db: DbExecutor, input: PayPalWebhookEventInput): Promise<PayPalWebhookEventStatus> {
  const [inserted] = await db
    .insert(paypalWebhookEvent)
    .values(input)
    .onConflictDoNothing({ target: paypalWebhookEvent.id })
    .returning({ status: paypalWebhookEvent.status });
  if (inserted) return inserted.status;
  const existing = await findWebhookEvent(db, input.id);
  if (!existing) throw new Error(`PayPal webhook event ${input.id} vanished after a conflicting insert`);
  return existing.status;
}

export async function findWebhookEvent(db: DbExecutor, id: string): Promise<PayPalWebhookEventRow | null> {
  const [row] = await db.select().from(paypalWebhookEvent).where(eq(paypalWebhookEvent.id, id)).limit(1);
  return row ?? null;
}

export async function finishWebhookEvent(
  db: DbExecutor,
  id: string,
  outcome: { status: Exclude<PayPalWebhookEventStatus, "received">; note?: string },
): Promise<void> {
  await db
    .update(paypalWebhookEvent)
    .set({ status: outcome.status, note: outcome.note ?? null, processedAt: new Date() })
    .where(eq(paypalWebhookEvent.id, id));
}

// Returns the attempt count after this one.
export async function noteWebhookAttempt(db: DbExecutor, id: string, error: string): Promise<number> {
  const [row] = await db
    .update(paypalWebhookEvent)
    .set({ attempts: sql`${paypalWebhookEvent.attempts} + 1`, note: error.slice(0, 500) })
    .where(eq(paypalWebhookEvent.id, id))
    .returning({ attempts: paypalWebhookEvent.attempts });
  return row?.attempts ?? 0;
}
