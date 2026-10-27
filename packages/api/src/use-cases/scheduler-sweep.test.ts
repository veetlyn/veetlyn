import type { Database } from "@jendal-workspace/db";
import * as operatingModel from "@jendal-workspace/db/repositories/operating-model";
import { ensurePublishedRulebook } from "@jendal-workspace/db/repositories/operating-model";
import { memberMark, rulebook, scheduleItem } from "@jendal-workspace/db/schema/operating-model";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { actionLog } from "@jendal-workspace/db/schema/action-log";
import { project } from "@jendal-workspace/db/schema/projects";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runDueScheduleItems } from "./scheduler-sweep";

describe.skipIf(!hasTestDatabase)("scheduler occurrences", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function workingProject() {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const rules = await ensurePublishedRulebook(db, teamId);
    const projectId = await seedProject(db, { teamId, status: "in_progress" });
    await db.update(project).set({ rulebookId: rules.id, assignedFreelancerId: userId }).where(eq(project.id, projectId));
    return { teamId, projectId, rules: rules.spec };
  }

  it("retires each missed update and keeps both steps of the next two windows", async () => {
    const { teamId, projectId, rules } = await workingProject();
    const now = new Date("2026-10-25T12:00:00Z");
    await db.insert(scheduleItem).values({ teamId, subjectId: projectId, kind: "member.updateLate", runAt: now });

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const at = new Date(now.getTime() + cycle * rules.updateWindow.hours * 3_600_000);
      expect(await runDueScheduleItems({ db, now: () => at })).toEqual({ fired: cycle === 0 ? 1 : 2, failed: 0, held: 0 });
      const rows = await db.select().from(scheduleItem);
      const pending = rows.filter((row) => row.status === "pending");
      expect(pending).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "member.updateRemind", runAt: new Date(at.getTime() + (rules.updateWindow.hours - rules.updateWindow.remindBeforeHours) * 3_600_000) }),
        expect.objectContaining({ kind: "member.updateLate", runAt: new Date(at.getTime() + rules.updateWindow.hours * 3_600_000) }),
      ]));
      expect(pending).toHaveLength(2);
      expect(rows.filter((row) => row.status === "done" && row.kind === "member.updateLate")).toHaveLength(cycle + 1);
      expect((await db.select().from(memberMark)).filter((row) => row.kind === "late_update")).toHaveLength(cycle + 1);
      expect(await runDueScheduleItems({ db, now: () => at })).toEqual({ fired: 0, failed: 0, held: 0 });
    }
    expect((await db.select().from(outbox)).filter((row) => row.type === "member.update_late")).toHaveLength(2);
    const logs = await db.select().from(actionLog);
    expect(logs).toHaveLength(3);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "member.updateLate", actorKind: "system", actorId: "project-scheduler", surface: "cron", outcome: "ok", teamId, projectId }),
      expect.objectContaining({ action: "member.updateRemind", actorKind: "system", actorId: "project-scheduler", surface: "cron", outcome: "ok", teamId, projectId }),
    ]));
  });

  it("fires a due timer whose stored time is finer than a millisecond", async () => {
    const { teamId, projectId } = await workingProject();
    const now = new Date("2026-10-25T12:00:00Z");
    await db.insert(scheduleItem).values({ teamId, subjectId: projectId, kind: "member.updateRemind", runAt: now });
    await db.execute(sql`update schedule_item set run_at = run_at - interval '0.000123 seconds'`);

    expect(await runDueScheduleItems({ db, now: () => now })).toEqual({ fired: 1, failed: 0, held: 0 });
    expect(await db.select().from(scheduleItem).where(eq(scheduleItem.kind, "member.updateRemind"))).toEqual([
      expect.objectContaining({ status: "done" }),
    ]);
  });

  it("retains holds, inactive and future rows, and refuses a timer from another team", async () => {
    const { teamId, projectId } = await workingProject();
    const other = await seedServicesTeamWithAdmin(db, { slug: "other" });
    const now = new Date("2026-10-25T12:00:00Z");
    await db.insert(scheduleItem).values([
      { teamId, subjectId: projectId, kind: "request.remind", status: "paused", runAt: new Date(0) },
      { teamId, subjectId: projectId, kind: "request.expire", status: "cancelled", runAt: new Date(0) },
      { teamId, subjectId: projectId, kind: "member.updateRemind", runAt: new Date("2026-10-26T12:00:00Z") },
      { teamId, subjectId: projectId, kind: sql`${"unknown.timer"}`, runAt: new Date(0) },
      { teamId: other.teamId, subjectId: projectId, kind: "member.updateLate", runAt: new Date(0) },
    ]);
    const before = await db.select().from(scheduleItem).orderBy(scheduleItem.id);
    expect(await runDueScheduleItems({ db, now: () => now })).toEqual({ fired: 0, failed: 0, held: 2 });
    expect(await db.select().from(scheduleItem).orderBy(scheduleItem.id)).toEqual(before);
    expect(await db.select().from(memberMark)).toEqual([]);
    expect(await db.select().from(outbox)).toEqual([]);
  });

  it("excludes a second consumer while the first is blocked inside its database effect", async () => {
    const { teamId, projectId } = await workingProject();
    await db.insert(scheduleItem).values({ teamId, subjectId: projectId, kind: "member.updateRemind", runAt: new Date(0) });
    const firstDb = createTestDb();
    const secondDb = createTestDb();
    let first: ReturnType<typeof runDueScheduleItems> | undefined;
    let second: ReturnType<typeof runDueScheduleItems> | undefined;
    try {
      await db.transaction(async (blocker) => {
        await blocker.select().from(project).where(eq(project.id, projectId)).for("update");
        async function blockedCount() {
          await blocker.execute(sql`select pg_stat_clear_snapshot()`);
          const [row] = await blocker.select({ count: sql<number>`count(*)::int` })
            .from(sql`pg_stat_activity`).where(sql`datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0`);
          return row?.count ?? 0;
        }
        const deadline = Date.now() + 8000;
        first = runDueScheduleItems({ db: firstDb });
        while (await blockedCount() < 1) {
          if (Date.now() > deadline) throw new Error("First consumer did not reach the blocked effect");
        }
        let secondFinished = false;
        second = runDueScheduleItems({ db: secondDb });
        void second.then(() => { secondFinished = true; });
        while (!secondFinished && await blockedCount() < 2) {
          if (Date.now() > deadline) throw new Error("Second consumer neither skipped nor reached the effect");
        }
      });
      expect(await first).toEqual({ fired: 1, failed: 0, held: 0 });
      expect(await second).toEqual({ fired: 0, failed: 0, held: 0 });
      expect(await db.select().from(outbox)).toEqual([expect.objectContaining({ type: "member.update_remind" })]);
      expect(await db.select().from(scheduleItem)).toEqual([expect.objectContaining({ status: "done", attempts: 1 })]);
    } finally {
      await Promise.allSettled([first, second]);
      await Promise.all([firstDb.$client.end(), secondDb.$client.end()]);
    }
  });

  it("rolls back a deadlocked late timer and recovers it on the next sweep", async () => {
    const { teamId, projectId } = await workingProject();
    const now = new Date("2026-10-25T12:00:00Z");
    await db.insert(scheduleItem).values([
      { teamId, subjectId: projectId, kind: "member.updateRemind", runAt: new Date(0) },
      { teamId, subjectId: projectId, kind: "member.updateLate", runAt: new Date(1) },
    ]);
    const firstDb = createTestDb();
    const secondDb = createTestDb();
    const rearm = operatingModel.upsertPendingScheduleItems;
    const deadlocks: Error[] = [];
    const observedRearm = vi.spyOn(operatingModel, "upsertPendingScheduleItems").mockImplementation(async (...args) => {
      try {
        await rearm(...args);
      } catch (error) {
        if (error instanceof Error) deadlocks.push(error);
        throw error;
      }
    });
    const reminderLocked = Promise.withResolvers<void>();
    const projectLocked = Promise.withResolvers<void>();
    const firstTransaction: Database["transaction"] = (callback, config) => firstDb.transaction(async (tx) => {
      await tx.select().from(scheduleItem).where(eq(scheduleItem.kind, "member.updateRemind")).for("update");
      reminderLocked.resolve();
      await projectLocked.promise;
      return callback(tx);
    }, config);
    const secondTransaction: Database["transaction"] = (callback, config) => secondDb.transaction(async (tx) => {
      await reminderLocked.promise;
      await tx.select().from(project).where(eq(project.id, projectId)).for("update");
      // Keep detection enabled; make the late consumer detect the cycle first.
      await tx.execute(sql`set local deadlock_timeout = '50ms'`);
      projectLocked.resolve();
      const deadline = Date.now() + 8000;
      while (true) {
        const [blocked] = await db.select({ count: sql<number>`count(*)::int` }).from(sql`pg_stat_activity`)
          .where(sql`datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0`);
        if (blocked?.count === 1) break;
        if (Date.now() > deadline) throw new Error("Reminder consumer did not wait on the project lock");
      }
      return callback(tx);
    }, config);
    const first = runDueScheduleItems({ db: fromPartial<Database>({ transaction: firstTransaction }), now: () => now, limit: 1 });
    const second = runDueScheduleItems({ db: fromPartial<Database>({ transaction: secondTransaction }), now: () => now, limit: 1 });
    try {
      const results = await Promise.allSettled([first, second]);
      expect(deadlocks).toEqual([expect.objectContaining({ name: "DrizzleQueryError", cause: expect.objectContaining({ name: "PostgresError", code: "40P01" }) })]);
      expect.soft(await db.select().from(scheduleItem).where(eq(scheduleItem.kind, "member.updateLate")))
        .toEqual([expect.objectContaining({ status: "pending", attempts: 0, lastError: null, completedAt: null })]);
      expect(results[0]).toEqual({ status: "fulfilled", value: { fired: 1, failed: 0, held: 0 } });
      expect(results[1]).toMatchObject({ status: "rejected", reason: { name: "ActionError", cause: { name: "DrizzleQueryError", cause: { name: "PostgresError", code: "40P01" } } } });
      expect(await db.select().from(actionLog)).toEqual([expect.objectContaining({ action: "member.updateRemind", outcome: "ok" })]);
      expect(await db.select().from(memberMark)).toEqual([]);
      expect(await db.select().from(outbox)).toEqual([expect.objectContaining({ type: "member.update_remind" })]);
      expect(await runDueScheduleItems({ db, now: () => now })).toEqual({ fired: 1, failed: 0, held: 0 });
      expect(await runDueScheduleItems({ db, now: () => now })).toEqual({ fired: 0, failed: 0, held: 0 });
      expect(await db.select().from(memberMark)).toEqual([expect.objectContaining({ kind: "late_update" })]);
      expect((await db.select().from(outbox)).filter((row) => row.type === "member.update_late")).toHaveLength(1);
      expect(await db.select().from(scheduleItem).where(eq(scheduleItem.status, "pending"))).toHaveLength(2);
    } finally {
      await Promise.allSettled([first, second]);
      observedRearm.mockRestore();
      await Promise.all([firstDb.$client.end(), secondDb.$client.end()]);
    }
  });

  it("preserves both future steps when equal deadlines are claimed late-first", async () => {
    const { teamId, projectId, rules } = await workingProject();
    await db.update(rulebook).set({ spec: { ...rules, updateWindow: { ...rules.updateWindow, remindBeforeHours: 0 } } }).where(eq(rulebook.teamId, teamId));
    const now = new Date("2026-10-25T12:00:00Z");
    await db.insert(scheduleItem).values([
      { teamId, subjectId: projectId, kind: "member.updateLate", runAt: now },
      { teamId, subjectId: projectId, kind: "member.updateRemind", runAt: now },
    ]);
    const claim = operatingModel.claimDueScheduleItems;
    // Exercise a legal tie order while retaining the real query, locks and snapshots.
    const orderedClaim = vi.spyOn(operatingModel, "claimDueScheduleItems").mockImplementation(async (...args) =>
      (await claim(...args)).sort((a, b) => Number(b.kind === "member.updateLate") - Number(a.kind === "member.updateLate")));
    try {
      expect.soft(await runDueScheduleItems({ db, now: () => now })).toEqual({ fired: 1, failed: 0, held: 0 });
      const future = new Date(now.getTime() + rules.updateWindow.hours * 3_600_000);
      expect(await db.select().from(scheduleItem).where(eq(scheduleItem.status, "pending"))).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "member.updateRemind", runAt: future, attempts: 0 }),
        expect.objectContaining({ kind: "member.updateLate", runAt: future, attempts: 0 }),
      ]));
      expect(await db.select().from(scheduleItem).where(eq(scheduleItem.status, "done")))
        .toEqual([expect.objectContaining({ kind: "member.updateLate", attempts: 1 })]);
      expect(await db.select().from(outbox)).toEqual([expect.objectContaining({ type: "member.update_late" })]);
      expect(await runDueScheduleItems({ db, now: () => now })).toEqual({ fired: 0, failed: 0, held: 0 });
      expect(await runDueScheduleItems({ db, now: () => future })).toEqual({ fired: 1, failed: 0, held: 0 });
      expect(await db.select().from(scheduleItem).where(and(eq(scheduleItem.status, "pending"), eq(scheduleItem.kind, "member.updateRemind"))))
        .toEqual([expect.objectContaining({ runAt: new Date(future.getTime() + rules.updateWindow.hours * 3_600_000), attempts: 0 })]);
      expect(await db.select().from(memberMark)).toHaveLength(2);
    } finally {
      orderedClaim.mockRestore();
    }
  });

  it("rolls back marks and notices when completion fails and still completes another occurrence", async () => {
    const { teamId, projectId } = await workingProject();
    await db.insert(scheduleItem).values([
      { teamId, subjectId: projectId, kind: "member.updateLate", runAt: new Date(0) },
      { teamId, subjectId: projectId, kind: "member.updateRemind", runAt: new Date(1) },
    ]);
    await db.execute(sql`alter table schedule_item add constraint scheduler_test_completion check (kind <> 'member.updateLate' or status <> 'done')`);
    try {
      expect(await runDueScheduleItems({ db })).toEqual({ fired: 1, failed: 1, held: 0 });
      expect(await db.select().from(memberMark)).toEqual([]);
      expect(await db.select().from(outbox)).toEqual([expect.objectContaining({ type: "member.update_remind" })]);
      const rows = await db.select().from(scheduleItem);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "member.updateLate", status: "failed", attempts: 1, lastError: expect.any(String) }),
        expect.objectContaining({ kind: "member.updateRemind", status: "done", attempts: 1 }),
      ]));
      expect(await db.select().from(actionLog)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "member.updateLate", actorKind: "system", outcome: "internal", teamId, projectId }),
        expect.objectContaining({ action: "member.updateRemind", actorKind: "system", outcome: "ok", teamId, projectId }),
      ]));
    } finally {
      await db.execute(sql`alter table schedule_item drop constraint scheduler_test_completion`);
    }
  });
});
