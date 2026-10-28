import { sql } from "drizzle-orm";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";

// Any Drizzle Postgres executor: a database or a transaction.
export type SqlExecutor = PgAsyncDatabase<PgQueryResultHKT>;

// Storage helpers for the operating-model engine over Drizzle's SQL executor. They know the column
// shape the engine needs (schedule items and outbox deliveries) but no concrete table: the host
// passes its table names, and every row is decoded before it leaves this boundary.

const scheduleRowSchema = z.object({
  id: z.string(),
  subject_id: z.string(),
  team_id: z.string(),
  kind: z.string(),
  run_at: z.coerce.date(),
  attempts: z.number().nullable().catch(0),
  payload: z.unknown().nullable().catch(null),
});

export type ClaimedScheduleRow = z.output<typeof scheduleRowSchema>;

const deliveryRowSchema = z.object({
  id: z.string(),
  outbox_id: z.string(),
  channel: z.string(),
  recipient: z.string(),
  attempts: z.number().int().nonnegative(),
  claim_token: z.string().min(1),
  claim_expires_at: z.coerce.date(),
  first_attempt_at: z.coerce.date(),
});

export type ClaimedDeliveryRow = z.output<typeof deliveryRowSchema>;

export type ScheduleReconciliation = {
  teamId: string;
  subjectId: string;
  schedule: { kind: string; runAt: Date }[];
  cancel: string[];
};

// Drivers differ in what execute returns: postgres-js hands back the rows array, other drivers a
// result object with rows. Decode either shape at this boundary.
const queryRows = z
  .union([z.array(z.unknown()), z.object({ rows: z.array(z.unknown()) }).transform((value) => value.rows)])
  .catch([]);

// Arms and cancels timed rules for a subject in one statement each. Upserts hit the partial unique
// index on active items only, so history (done, cancelled, failed) is kept, and re-running the same
// reconciliation is a no-op.
export async function reconcileScheduleRows(db: SqlExecutor, table: string, plan: ScheduleReconciliation): Promise<void> {
  for (const item of plan.schedule) {
    await db.execute(sql`
      insert into ${sql.identifier(table)} (id, team_id, subject_id, kind, run_at, status)
      values (${crypto.randomUUID()}, ${plan.teamId}, ${plan.subjectId}, ${item.kind}, ${item.runAt.toISOString()}, 'pending')
      on conflict (subject_id, kind) where status in ('pending', 'paused')
      do update set run_at = excluded.run_at
    `);
  }
  if (plan.cancel.length > 0) {
    await db.execute(sql`
      update ${sql.identifier(table)}
      set status = 'cancelled'
      where subject_id = ${plan.subjectId} and status in ('pending', 'paused')
        and kind in (${sql.join(plan.cancel.map((kind) => sql`${kind}`), sql`, `)})
    `);
  }
}

// Claims due items under a row lock so two sweeps never fire the same item; the caller marks each
// claimed row done or failed in the same transaction.
export async function claimDueScheduleRows(db: SqlExecutor, table: string, now: Date, limit: number): Promise<ClaimedScheduleRow[]> {
  const result = await db.execute(sql`
    select id, team_id, subject_id, kind, run_at, attempts, payload
    from ${sql.identifier(table)}
    where status = 'pending' and run_at <= ${now.toISOString()}
    order by run_at
    limit ${limit}
    for update skip locked
  `);
  return queryRows.removeCatch().parse(result).map((row) => scheduleRowSchema.parse(row));
}

export async function completeScheduleRows(
  db: SqlExecutor,
  table: string,
  ids: string[],
  outcome: { status: "done" | "failed"; error?: string },
): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(sql`
    update ${sql.identifier(table)}
    set status = ${outcome.status}, completed_at = now(),
        attempts = coalesce(attempts, 0) + 1,
        last_error = ${outcome.error ?? null}
    where status = 'pending' and id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
}

// A dispute holds a subject's timers: pausing keeps the items and their times; resuming re-arms them.
export async function setSchedulePaused(
  db: SqlExecutor,
  table: string,
  subjectId: string,
  paused: boolean,
  kinds?: string[],
): Promise<void> {
  const kindFilter = kinds ? sql` and kind in (${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)})` : sql``;
  await db.execute(sql`
    update ${sql.identifier(table)}
    set status = ${paused ? "paused" : "pending"}
    where subject_id = ${subjectId} and status in ('pending', 'paused')${kindFilter}
  `);
}

export async function claimDueDeliveryRows(db: SqlExecutor, table: string, now: Date, limit: number, outboxIds?: readonly string[]): Promise<ClaimedDeliveryRow[]> {
  if (outboxIds?.length === 0) return [];
  const scope = outboxIds ? sql`and outbox_id in (${sql.join(outboxIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const result = await db.execute(sql`
    update ${sql.identifier(table)}
    set claim_token = gen_random_uuid()::text, claim_expires_at = ${expiresAt.toISOString()},
        first_attempt_at = coalesce(first_attempt_at, ${now.toISOString()})
    where id in (
      select id from ${sql.identifier(table)}
      where status = 'pending' and next_attempt_at <= ${now.toISOString()}
        and (claim_expires_at is null or claim_expires_at <= ${now.toISOString()})
        ${scope}
      order by next_attempt_at, id
      limit ${limit}
      for update skip locked
    )
    returning id, outbox_id, channel, recipient, attempts, claim_token, claim_expires_at, first_attempt_at
  `);
  return queryRows.removeCatch().parse(result).map((row) => deliveryRowSchema.parse(row));
}

// Marks in a rolling window: the strike rule's count.
export async function countMarksInWindow(
  db: SqlExecutor,
  table: string,
  input: { teamId: string; memberUserId: string; since: Date; kinds: string[] },
): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as count
    from ${sql.identifier(table)}
    where team_id = ${input.teamId} and member_user_id = ${input.memberUserId}
      and created_at >= ${input.since.toISOString()}
      and kind in (${sql.join(input.kinds.map((kind) => sql`${kind}`), sql`, `)})
  `);
  const countSchema = z.object({ count: z.number() }).catch({ count: 0 });
  const [row] = queryRows.parse(result).map((entry) => countSchema.parse(entry));
  return (row ?? { count: 0 }).count;
}

// The store contracts an adapter implements for the scheduler and the outbox dispatcher.
export type ScheduleStore = {
  reconcile(plan: ScheduleReconciliation): Promise<void>;
  claimDue(now: Date, limit: number): Promise<ClaimedScheduleRow[]>;
  complete(ids: string[], outcome: { status: "done" | "failed"; error?: string }): Promise<void>;
  setPaused(subjectId: string, paused: boolean, kinds?: string[]): Promise<void>;
};

export type DeliveryStore = {
  claimDue(now: Date, limit: number): Promise<ClaimedDeliveryRow[]>;
};
