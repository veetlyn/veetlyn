import { fromPartial } from "@total-typescript/shoehorn";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { claimDueDeliveryRows, claimDueScheduleRows, completeScheduleRows, countMarksInWindow, reconcileScheduleRows, setSchedulePaused, type SqlExecutor } from "../index";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

const SCHEDULE_TABLE = "__opm_test_schedule_item";
const DELIVERY_TABLE = "__opm_test_delivery";
const MARK_TABLE = "__opm_test_member_mark";

describe.skipIf(!hasDb)("engine-drizzle storage helpers", () => {
  const client = postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, fetch_types: false });
  const db = drizzle({ client });

  beforeAll(async () => {
    await client.unsafe(`create table if not exists ${SCHEDULE_TABLE} (
      id text primary key default gen_random_uuid()::text,
      team_id text not null,
      subject_id text not null,
      kind text not null,
      run_at timestamptz not null,
      status text not null default 'pending',
      attempts integer not null default 0,
      last_error text,
      payload jsonb,
      completed_at timestamptz,
      created_at timestamptz not null default now()
    )`);
    await client.unsafe(`create unique index if not exists ${SCHEDULE_TABLE}_active_idx on ${SCHEDULE_TABLE} (subject_id, kind) where status in ('pending','paused')`);
    await client.unsafe(`create table if not exists ${DELIVERY_TABLE} (
      id text primary key default gen_random_uuid()::text,
      outbox_id text not null,
      channel text not null,
      recipient text not null,
      status text not null default 'pending',
      attempts integer not null default 0,
      next_attempt_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    )`);
    await client.unsafe(`create table if not exists ${MARK_TABLE} (
      id text primary key default gen_random_uuid()::text,
      team_id text not null,
      member_user_id text not null,
      kind text not null,
      created_at timestamptz not null default now()
    )`);
  });

  beforeEach(async () => {
    await client.unsafe(`truncate ${SCHEDULE_TABLE}, ${DELIVERY_TABLE}, ${MARK_TABLE}`);
  });

  afterAll(async () => {
    await client.unsafe(`drop table if exists ${SCHEDULE_TABLE}, ${DELIVERY_TABLE}, ${MARK_TABLE}`);
    await client.end();
  });

  const T = (iso: string) => new Date(iso);

  it("reconciles a plan: arms new items, moves armed items, cancels the rest", async () => {
    await reconcileScheduleRows(db, SCHEDULE_TABLE, {
      teamId: "team1",
      subjectId: "p1",
      schedule: [
        { kind: "request.remind", runAt: T("2026-10-02T12:00:00Z") },
        { kind: "request.expire", runAt: T("2026-10-03T00:00:00Z") },
      ],
      cancel: [],
    });
    // Re-planning with a later reminder moves the armed row instead of duplicating it.
    await reconcileScheduleRows(db, SCHEDULE_TABLE, {
      teamId: "team1",
      subjectId: "p1",
      schedule: [{ kind: "request.remind", runAt: T("2026-10-02T18:00:00Z") }],
      cancel: ["request.expire"],
    });

    const claimed = await claimDueScheduleRows(db, SCHEDULE_TABLE, T("2026-10-04T00:00:00Z"), 10);
    expect(claimed).toEqual([{ id: expect.any(String), team_id: "team1", subject_id: "p1", kind: "request.remind", run_at: T("2026-10-02T18:00:00Z"), attempts: 0, payload: null }]);
  });

  it("claims only due pending rows in run_at order", async () => {
    await reconcileScheduleRows(db, SCHEDULE_TABLE, {
      teamId: "team1",
      subjectId: "p1",
      schedule: [
        { kind: "request.expire", runAt: T("2026-10-03T00:00:00Z") },
        { kind: "request.remind", runAt: T("2026-10-02T00:00:00Z") },
      ],
      cancel: [],
    });
    await reconcileScheduleRows(db, SCHEDULE_TABLE, {
      teamId: "team1",
      subjectId: "p2",
      schedule: [{ kind: "request.remind", runAt: T("2026-12-01T00:00:00Z") }],
      cancel: [],
    });

    const claimed = await claimDueScheduleRows(db, SCHEDULE_TABLE, T("2026-10-04T00:00:00Z"), 10);
    expect(claimed.map((row) => row.kind)).toEqual(["request.remind", "request.expire"]);

    // Completed rows never come back; a fresh claim after completion is empty.
    await completeScheduleRows(db, SCHEDULE_TABLE, claimed.map((row) => row.id), { status: "done" });
    expect(await claimDueScheduleRows(db, SCHEDULE_TABLE, T("2026-10-04T00:00:00Z"), 10)).toEqual([]);
  });

  it("records a failed attempt without losing the row", async () => {
    await reconcileScheduleRows(db, SCHEDULE_TABLE, {
      teamId: "team1",
      subjectId: "p1",
      schedule: [{ kind: "request.expire", runAt: T("2026-10-03T00:00:00Z") }],
      cancel: [],
    });
    const [row] = await claimDueScheduleRows(db, SCHEDULE_TABLE, T("2026-10-04T00:00:00Z"), 1);
    if (!row) throw new Error("no claimed row");
    await completeScheduleRows(db, SCHEDULE_TABLE, [row.id], { status: "failed", error: "boom" });

    const after = await client.unsafe(`select status, attempts, last_error from ${SCHEDULE_TABLE} where id = $1`, [row.id]);
    expect(after[0]).toMatchObject({ status: "failed", attempts: 1, last_error: "boom" });
  });

  it("pauses and resumes a subject's active items", async () => {
    await reconcileScheduleRows(db, SCHEDULE_TABLE, {
      teamId: "team1",
      subjectId: "p1",
      schedule: [
        { kind: "member.updateRemind", runAt: T("2026-10-03T00:00:00Z") },
        { kind: "member.updateLate", runAt: T("2026-10-04T00:00:00Z") },
      ],
      cancel: [],
    });
    await setSchedulePaused(db, SCHEDULE_TABLE, "p1", true);
    await reconcileScheduleRows(db, SCHEDULE_TABLE, {
      teamId: "team1", subjectId: "p1",
      schedule: [{ kind: "member.updateRemind", runAt: T("2026-10-03T12:00:00Z") }], cancel: [],
    });
    expect(await claimDueScheduleRows(db, SCHEDULE_TABLE, T("2026-10-05T00:00:00Z"), 10)).toEqual([]);

    await setSchedulePaused(db, SCHEDULE_TABLE, "p1", false);
    const claimed = await claimDueScheduleRows(db, SCHEDULE_TABLE, T("2026-10-05T00:00:00Z"), 10);
    expect(claimed.map((row) => row.kind)).toEqual(["member.updateRemind", "member.updateLate"]);
  });

  it("recovers rolled-back claims and refuses to complete inactive or already completed occurrences", async () => {
    await reconcileScheduleRows(db, SCHEDULE_TABLE, {
      teamId: "team1", subjectId: "p1",
      schedule: [{ kind: "request.remind", runAt: T("2026-10-02T00:00:00Z") }], cancel: [],
    });
    const now = T("2026-10-04T00:00:00Z");
    await expect(db.transaction(async (tx) => {
      const claimed = await claimDueScheduleRows(tx, SCHEDULE_TABLE, now, 1);
      expect(claimed).toHaveLength(1);
      await completeScheduleRows(tx, SCHEDULE_TABLE, claimed.map((row) => row.id), { status: "done" });
      throw new Error("interrupted occurrence");
    })).rejects.toThrow("interrupted occurrence");
    await db.transaction(async (tx) => {
      const claimed = await claimDueScheduleRows(tx, SCHEDULE_TABLE, now, 1);
      expect(claimed).toHaveLength(1);
      const ids = claimed.map((row) => row.id);
      await setSchedulePaused(tx, SCHEDULE_TABLE, "p1", true);
      await completeScheduleRows(tx, SCHEDULE_TABLE, ids, { status: "done" });
      expect(await claimDueScheduleRows(tx, SCHEDULE_TABLE, now, 1)).toEqual([]);
      await setSchedulePaused(tx, SCHEDULE_TABLE, "p1", false);
      expect(await claimDueScheduleRows(tx, SCHEDULE_TABLE, now, 1)).toHaveLength(1);
      await completeScheduleRows(tx, SCHEDULE_TABLE, ids, { status: "done" });
      await completeScheduleRows(tx, SCHEDULE_TABLE, ids, { status: "failed", error: "stale completion" });
    });
    expect(await client.unsafe(`select status, attempts, last_error from ${SCHEDULE_TABLE}`)).toEqual([
      expect.objectContaining({ status: "done", attempts: 1, last_error: null }),
    ]);
  });

  it("claims due deliveries and counts marks inside a rolling window", async () => {
    await client.unsafe(
      `insert into ${DELIVERY_TABLE} (outbox_id, channel, recipient, next_attempt_at) values ('ob1', 'email_client', 'a@example.com', now() - interval '1 minute'), ('ob2', 'email_client', 'b@example.com', now() + interval '1 hour')`,
    );
    const claimed = await claimDueDeliveryRows(db, DELIVERY_TABLE, new Date(), 10);
    expect(claimed).toEqual([{ id: expect.any(String), outbox_id: "ob1", channel: "email_client", recipient: "a@example.com", attempts: 0 }]);

    await client.unsafe(
      `insert into ${MARK_TABLE} (team_id, member_user_id, kind, created_at) values ('team1', 'u1', 'late_update', now() - interval '2 days'), ('team1', 'u1', 'late_delivery', now() - interval '10 days'), ('team1', 'u1', 'warning', now() - interval '1 day'), ('team1', 'u2', 'late_update', now())`,
    );
    const count = await countMarksInWindow(db, MARK_TABLE, {
      teamId: "team1",
      memberUserId: "u1",
      since: new Date(Date.now() - 5 * 86_400_000),
      kinds: ["late_update", "late_delivery"],
    });
    expect(count).toBe(1);
  });
});

it("rejects an undecodable scheduler driver result instead of reporting empty work", async () => {
  const db = fromPartial<SqlExecutor>({ execute: () => fromPartial<ReturnType<SqlExecutor["execute"]>>(Promise.resolve({})) });
  await expect(claimDueScheduleRows(db, "schedule_item", new Date(), 1)).rejects.toThrow();
});
