import type { JsonObject } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import {
  claimDueScheduleItems,
  completeScheduleItems,
  countMemberMarks,
  recordMemberMark,
  projectHasOpenDispute,
} from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { runInTransaction, type OutboxEventInput } from "@jendal-workspace/db/repositories/unit-of-work";
import { rulebook, scheduleItem } from "@jendal-workspace/db/schema/operating-model";
import type { RulebookRules } from "@opmodel/engine-rules";
import { and, eq, lte } from "drizzle-orm";
import { log } from "evlog";
import { z } from "zod";

import type { ActionDefinition } from "../actions/define";
import { perform } from "../actions/perform";
import { armProjectSchedule, autoAcceptDelivery, checkTransition } from "./projects";

// The 10-minute scheduler (AGT-37, AGT-51, AGT-52): claims due schedule items under a row lock and
// fires each once, through the same project transactions people's actions use. A failing item is
// marked failed with its error; a stale item (the project moved on) fires as a no-op, which keeps
// the ladder from re-notifying after someone acted.

export type SchedulerReport = { fired: number; failed: number; held: number };
const scheduleActionInput = z.strictObject({ projectId: z.string().min(1), teamId: z.string().min(1) });
type ScheduleActionInput = z.output<typeof scheduleActionInput>;

export async function runDueScheduleItems(deps: { db: Database; now?: () => Date; limit?: number }): Promise<SchedulerReport> {
  const now = (deps.now ?? (() => new Date()))();
  return deps.db.transaction(async (tx) => {
    const claimed = await claimDueScheduleItems(tx, now, deps.limit ?? 50);
    const report: SchedulerReport = { fired: 0, failed: 0, held: 0 };
    for (const item of claimed) {
      try {
        // Earlier effects in this batch may have rearmed this same locked row.
        const [current] = await tx.select({ id: scheduleItem.id }).from(scheduleItem).where(and(
          eq(scheduleItem.id, item.id),
          eq(scheduleItem.status, "pending"),
          eq(scheduleItem.runAt, item.run_at),
          lte(scheduleItem.runAt, now),
        ));
        if (!current) continue;
        const owner = await findProjectById(tx, item.subject_id);
        if (!owner || owner.teamId !== item.team_id) {
          report.held += 1;
          continue;
        }
        const action: ActionDefinition<ScheduleActionInput, "fired" | "held", ScheduleActionInput, { db: DbExecutor }> = {
          name: item.kind,
          kind: "action",
          summary: "Apply one due project timer.",
          input: scheduleActionInput,
          output: null,
          scope: (input) => ({ teamId: input.teamId, projectId: input.projectId }),
          allow: [{ grant: "system" }],
          surfaces: ["cron"],
          run: ({ deps: runtime }) => runtime.db.transaction(async (occurrence) => {
            const outcome = await fireItem(occurrence, item, now);
            if (outcome !== "held") {
              await completeScheduleItems(occurrence, [item.id], { status: "done" });
              const row = await findProjectById(occurrence, item.subject_id);
              if (row && row.teamId === item.team_id && ["awaiting_balance", "completed", "cancelled", "declined", "expired", "abandoned"].includes(row.status)) {
                // Retire the firing occurrence before cancelling the phase's remaining steps.
                await armProjectSchedule(occurrence, row, now);
              }
            }
            return outcome;
          }),
        };
        const outcome = await perform({
          deps: { db: tx },
          actor: { kind: "system", job: "project-scheduler" },
          surface: "cron",
          request: { requestId: item.id, ip: null },
          team: { id: item.team_id },
        }, action, { projectId: item.subject_id, teamId: item.team_id });
        if (outcome === "held") report.held += 1;
        else if (outcome === "fired") report.fired += 1;
      } catch (error) {
        // Contention must roll back the whole claim transaction for a later sweep.
        if (isDatabaseDeadlock(error)) throw error;
        log.error({
          action: "scheduler.item",
          scheduleItem: { id: item.id, kind: item.kind, subject: item.subject_id },
          error: { name: error instanceof Error ? error.name : "fire failed" },
        });
        await completeScheduleItems(tx, [item.id], { status: "failed", error: error instanceof Error ? error.message : "fire failed" });
        report.failed += 1;
      }
    }
    return report;
  });
}

const databaseErrorSchema = z.object({ code: z.string().optional(), cause: z.unknown().optional() });

function isDatabaseDeadlock(cause: unknown): boolean {
  const seen = new Set<unknown>();
  while (!seen.has(cause)) {
    seen.add(cause);
    const decoded = databaseErrorSchema.safeParse(cause);
    if (!decoded.success) return false;
    if (decoded.data.code === "40P01") return true;
    cause = decoded.data.cause;
  }
  return false;
}

async function fireItem(db: DbExecutor, item: { id: string; team_id: string; subject_id: string; kind: string }, now: Date): Promise<"fired" | "held"> {
  const row = await findProjectById(db, item.subject_id);
  if (!row || row.teamId !== item.team_id) return "held";
  if (await projectHasOpenDispute(db, { teamId: row.teamId, projectId: row.id })) {
    await db.update(scheduleItem).set({ status: "paused" }).where(and(
      eq(scheduleItem.id, item.id),
      eq(scheduleItem.teamId, row.teamId),
      eq(scheduleItem.subjectId, row.id),
      eq(scheduleItem.status, "pending"),
    ));
    return "held";
  }

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
      // Retire this occurrence before reconciliation can insert its successor.
      await completeScheduleItems(db, [item.id], { status: "done" });
      await armProjectSchedule(db, row, now, { workStartedAt: now });
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

async function notice(db: DbExecutor, row: Pick<ProjectRow, "id" | "teamId">, type: OutboxEventInput["type"], data: JsonObject): Promise<void> {
  await runInTransaction(db, (_tx, uow) => uow.appendEvents({ id: row.id, teamId: row.teamId }, [{ type, data }]));
}

async function rulesFor(db: DbExecutor, rulebookId: string | null): Promise<RulebookRules | null> {
  if (!rulebookId) return null;
  const [row] = await db.select({ spec: rulebook.spec }).from(rulebook).where(eq(rulebook.id, rulebookId)).limit(1);
  return row?.spec ?? null;
}
