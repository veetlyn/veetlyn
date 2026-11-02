import { and, eq, isNull, lte, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { launchWaitlist, waitlistNotification } from "../schema/waitlist";

export async function joinWaitlist(db: DbExecutor, email: string, alert?: { recipient: string; platformName: string }) {
  await db.transaction(async (tx) => {
    const [entry] = await tx.insert(launchWaitlist).values({ email }).onConflictDoNothing().returning();
    if (entry && alert) {
      await tx.insert(waitlistNotification).values({ ...alert, email: entry.email, joinedAt: entry.joinedAt });
    }
  });
}

export async function claimWaitlistNotifications(db: DbExecutor, now: Date, limit = 5) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(waitlistNotification)
      .where(and(isNull(waitlistNotification.sentAt), lte(waitlistNotification.nextAttemptAt, now)))
      .orderBy(waitlistNotification.nextAttemptAt).limit(limit).for("update", { skipLocked: true });
    const claimed = [];
    for (const row of rows) {
      const [updated] = await tx.update(waitlistNotification).set({
        attempts: sql`${waitlistNotification.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
      }).where(eq(waitlistNotification.email, row.email)).returning();
      if (updated) claimed.push(updated);
    }
    return claimed;
  });
}

export async function finishWaitlistNotification(db: DbExecutor, row: { email: string; attempts: number }, sent: boolean, now: Date) {
  await db.update(waitlistNotification).set(sent
    ? { sentAt: now }
    : { nextAttemptAt: new Date(now.getTime() + Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(row.attempts, 9))) },
  ).where(and(eq(waitlistNotification.email, row.email), eq(waitlistNotification.attempts, row.attempts), isNull(waitlistNotification.sentAt)));
}
