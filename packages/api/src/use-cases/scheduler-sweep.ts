import type { JsonObject } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  claimDueScheduleItems,
  completeScheduleItems,
  countMemberMarks,
  recordMemberMark,
  upsertPendingScheduleItems,
} from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { runInTransaction, type OutboxEventInput } from "@jendal-workspace/db/repositories/unit-of-work";
import { rulebook } from "@jendal-workspace/db/schema/operating-model";
import type { RulebookRules } from "@opmodel/engine-rules";
import { planProjectSchedule } from "@opmodel/engine-scheduler";
import { eq } from "drizzle-orm";
import { log } from "evlog";

import { autoAcceptDelivery, checkTransition } from "./projects";

// The 10-minute scheduler (AGT-37, AGT-51, AGT-52): claims due schedule items under a row lock and
// fires each once, through the same project transactions people's actions use. A failing item is
// marked failed with its error; a stale item (the project moved on) fires as a no-op, which keeps
// the ladder from re-notifying after someone acted.

export type SchedulerReport = { fired: number; failed: number; held: number };

export async function runDueScheduleItems(deps: { db: Database; now?: () => Date; limit?: number }): Promise<SchedulerReport> {
  const now = (deps.now ?? (() => new Date()))();
  const claimed = await claimDueScheduleItems(deps.db, now, deps.limit ?? 50);
  const report: SchedulerReport = { fired: 0, failed: 0, held: 0 };
  for (const item of claimed) {
    try {
      const outcome = await fireItem(deps.db, item, now);
      if (outcome === "held") {
        report.held += 1;
      } else {
        await completeScheduleItems(deps.db, [item.id], { status: "done" });
        report.fired += 1;
      }
    } catch (error) {
      report.failed += 1;
      log.error({
        action: "scheduler.item",
        scheduleItem: { id: item.id, kind: item.kind, subject: item.subject_id },
        error: { name: error instanceof Error ? error.name : "fire failed" },
      });
      await completeScheduleItems(deps.db, [item.id], { status: "failed", error: error instanceof Error ? error.message : "fire failed" });
    }
  }
  return report;
}

async function fireItem(db: Database, item: { subject_id: string; kind: string }, now: Date): Promise<"fired" | "held"> {
  const row = await findProjectById(db, item.subject_id);
  if (!row) return "held";

  switch (item.kind) {
    case "request.expire": {
      if (row.status !== "quoting") return "fired";
      await runInTransaction(db, async (_tx, uow) => {
        const status = checkTransition(row.status, "expire");
        await uow.apply({ project: row, set: { status }, events: [{ type: "request.expired", data: { projectId: row.id } }] });
      });
      return "fired";
    }

    case "request.remind": {
      if (row.status !== "quoting") return "fired";
      await notice(db, row, "request.remind", {});
      return "fired";
    }

    case "member.updateRemind": {
      if (row.status !== "in_progress") return "fired";
      await notice(db, row, "member.update_remind", {});
      return "fired";
    }

    case "member.updateLate": {
      if (row.status !== "in_progress" || !row.assignedFreelancerId) return "fired";
      const rules = await rulesFor(db, row.rulebookId);
      await recordMemberMark(db, { teamId: row.teamId, memberUserId: row.assignedFreelancerId, projectId: row.id, kind: "late_update" });
      await notice(db, row, "member.update_late", {});
      const threshold = rules?.strikes.threshold ?? 0;
      if (threshold > 0) {
        const marks = await countMemberMarks(db, {
          teamId: row.teamId,
          memberUserId: row.assignedFreelancerId,
          windowDays: rules?.strikes.windowDays ?? 30,
          now,
        });
        if (marks >= threshold) {
          await recordMemberMark(db, {
            teamId: row.teamId,
            memberUserId: row.assignedFreelancerId,
            projectId: row.id,
            kind: "warning",
            note: `${marks} marks in the rolling window`,
          });
          await notice(db, row, "member.warning", { marks });
        }
      }
      // The next update window starts now (AGT-51's next cycle).
      await armUpdateCycle(db, row, rules, now);
      return "fired";
    }

    case "client.reviewRemind1":
    case "client.reviewRemind2": {
      if (row.status !== "delivered") return "fired";
      await notice(db, row, "review.remind", { step: item.kind === "client.reviewRemind1" ? 1 : 2 });
      return "fired";
    }

    case "project.autoComplete":
    case "project.abandon": {
      if (row.status !== "delivered") return "fired";
      const rules = await rulesFor(db, row.rulebookId);
      const outcome = rules?.clientSilence.silenceOutcome ?? "accept_and_complete";
      if (item.kind === "project.abandon" || outcome === "abandon") {
        await runInTransaction(db, async (_tx, uow) => {
          const status = checkTransition(row.status, "abandon");
          await uow.apply({ project: row, set: { status }, events: [{ type: "project.abandoned", data: { projectId: row.id } }] });
        });
        return "fired";
      }
      await autoAcceptDelivery(db, row.id);
      return "fired";
    }

    default:
      return "held";
  }
}

async function notice(db: Database, row: Pick<ProjectRow, "id" | "teamId">, type: OutboxEventInput["type"], data: JsonObject): Promise<void> {
  await runInTransaction(db, (_tx, uow) => uow.appendEvents({ id: row.id, teamId: row.teamId }, [{ type, data }]));
}

async function rulesFor(db: Database, rulebookId: string | null): Promise<RulebookRules | null> {
  if (!rulebookId) return null;
  const [row] = await db.select({ spec: rulebook.spec }).from(rulebook).where(eq(rulebook.id, rulebookId)).limit(1);
  return row?.spec ?? null;
}

async function armUpdateCycle(db: Database, row: ProjectRow, rules: RulebookRules | null, now: Date): Promise<void> {
  if (!rules) return;
  const plan = planProjectSchedule({
    projectStatus: "in_progress",
    requestedAt: row.createdAt,
    workStartedAt: now,
    lastMemberActivityAt: null,
    deliveredAt: null,
    pausedByDispute: false,
    rules,
  });
  await upsertPendingScheduleItems(db, { teamId: row.teamId, subjectId: row.id, schedule: plan.schedule, cancel: [...plan.cancel] });
}
