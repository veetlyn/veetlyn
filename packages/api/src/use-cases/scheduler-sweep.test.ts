import { ensurePublishedRulebook } from "@jendal-workspace/db/repositories/operating-model";
import { memberMark, scheduleItem } from "@jendal-workspace/db/schema/operating-model";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { project } from "@jendal-workspace/db/schema/projects";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

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
    } finally {
      await db.execute(sql`alter table schedule_item drop constraint scheduler_test_completion`);
    }
  });
});
