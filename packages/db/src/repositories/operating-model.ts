import { PRESET_RULEBOOKS, type RulePreset, type RulebookRules } from "@opmodel/engine-rules";
import {
  claimDueDeliveryRows,
  claimDueScheduleRows,
  type ClaimedDeliveryRow,
  type ClaimedScheduleRow,
  completeScheduleRows,
  countMarksInWindow,
  reconcileScheduleRows,
  setSchedulePaused,
} from "@opmodel/engine-drizzle";
import { type DeliveryChannel, recordDeliveryFailure, recordDeliverySuccess, type OutboxDeliveryRecord } from "@opmodel/engine-outbox";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { dispute, memberMark, memberNoticePreference, outboxDelivery, rulebook, rulebookAcceptance } from "../schema/operating-model";
import { servicesTeamSettings } from "../schema/services-teams";

export type RulebookRow = typeof rulebook.$inferSelect;

const SCHEDULE_TABLE = "schedule_item";
const DELIVERY_TABLE = "outbox_delivery";

export type ScheduleItemPlan = {
  teamId: string;
  subjectId: string;
  schedule: { kind: string; runAt: Date }[];
  cancel: string[];
};

export function upsertPendingScheduleItems(db: DbExecutor, plan: ScheduleItemPlan): Promise<void> {
  return reconcileScheduleRows(db, SCHEDULE_TABLE, plan);
}

export function claimDueScheduleItems(db: DbExecutor, now: Date, limit: number): Promise<ClaimedScheduleRow[]> {
  return claimDueScheduleRows(db, SCHEDULE_TABLE, now, limit);
}

export function completeScheduleItems(
  db: DbExecutor,
  ids: string[],
  outcome: { status: "done" | "failed"; error?: string },
): Promise<void> {
  return completeScheduleRows(db, SCHEDULE_TABLE, ids, outcome);
}

export function pauseScheduleItemsForSubject(db: DbExecutor, subjectId: string): Promise<void> {
  return setSchedulePaused(db, SCHEDULE_TABLE, subjectId, true);
}

export function resumeScheduleItemsForSubject(db: DbExecutor, subjectId: string): Promise<void> {
  return setSchedulePaused(db, SCHEDULE_TABLE, subjectId, false);
}

// The team's latest published rulebook, or the v1 seeded from its settings. Projects pin the id.
export async function ensurePublishedRulebook(db: DbExecutor, teamId: string): Promise<RulebookRow> {
  const published = await getPublishedRulebook(db, teamId);
  if (published) return published;

  const [settings] = await db.select().from(servicesTeamSettings).where(eq(servicesTeamSettings.teamId, teamId));
  const preset: RulePreset = settings?.kind ?? "agency";
  const base = PRESET_RULEBOOKS[preset === "solo" ? "solo" : preset === "collective" ? "collective" : "agency"].rules;
  const teamCutBps = settings?.teamCutBps ?? base.split.teamCutBps;
  const rules: RulebookRules = { ...base, split: { ...base.split, teamCutBps, memberCutBps: 10_000 - teamCutBps - base.split.managerCutBps } };
  const [row] = await db
    .insert(rulebook)
    .values({ id: `rb_v1_${teamId}`, teamId, version: 1, status: "published", preset, spec: rules, publishedAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const raced = await getPublishedRulebook(db, teamId);
  if (raced) return raced;
  throw new Error("The rulebook could not be created");
}

export async function getPublishedRulebook(db: DbExecutor, teamId: string): Promise<RulebookRow | null> {
  const [row] = await db
    .select()
    .from(rulebook)
    .where(and(eq(rulebook.teamId, teamId), eq(rulebook.status, "published")))
    .orderBy(desc(rulebook.version))
    .limit(1);
  return row ?? null;
}

export async function getDraftRulebook(db: DbExecutor, teamId: string): Promise<RulebookRow | null> {
  const [row] = await db
    .select()
    .from(rulebook)
    .where(and(eq(rulebook.teamId, teamId), eq(rulebook.status, "draft")))
    .orderBy(desc(rulebook.version))
    .limit(1);
  return row ?? null;
}

// A draft is one row per team: saving again edits it until it is published.
export async function saveRulebookDraft(
  db: DbExecutor,
  input: { teamId: string; preset: RulePreset; spec: RulebookRules; userId: string | null },
): Promise<RulebookRow> {
  const draft = await getDraftRulebook(db, input.teamId);
  if (draft) {
    const [row] = await db
      .update(rulebook)
      .set({ preset: input.preset, spec: input.spec, createdById: input.userId })
      .where(eq(rulebook.id, draft.id))
      .returning();
    if (row) return row;
  }
  const [latest] = await db
    .select({ version: rulebook.version })
    .from(rulebook)
    .where(eq(rulebook.teamId, input.teamId))
    .orderBy(desc(rulebook.version))
    .limit(1);
  const [row] = await db
    .insert(rulebook)
    .values({
      teamId: input.teamId,
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      preset: input.preset,
      spec: input.spec,
      createdById: input.userId,
    })
    .returning();
  if (!row) throw new Error("The draft could not be saved");
  return row;
}

// Publishing stamps the version and syncs the settings' cuts, so both places always agree.
export async function publishRulebook(db: DbExecutor, input: { teamId: string; userId: string | null }): Promise<RulebookRow> {
  const draft = await getDraftRulebook(db, input.teamId);
  if (!draft) throw new Error("There is no draft to publish");
  const [row] = await db.update(rulebook).set({ status: "published", publishedAt: new Date() }).where(eq(rulebook.id, draft.id)).returning();
  if (!row) throw new Error("The draft could not be published");
  await db
    .update(servicesTeamSettings)
    .set({ teamCutBps: row.spec.split.teamCutBps, managerCutBps: row.spec.split.managerCutBps, settingsSavedAt: new Date() })
    .where(eq(servicesTeamSettings.teamId, input.teamId));
  return row;
}

export async function recordRulebookAcceptance(
  db: DbExecutor,
  input: {
    rulebookId: string;
    teamId: string;
    actorKind: "client" | "member";
    userId?: string | null;
    contactId?: string | null;
    projectId?: string | null;
  },
): Promise<void> {
  await db.insert(rulebookAcceptance).values({
    rulebookId: input.rulebookId,
    teamId: input.teamId,
    actorKind: input.actorKind,
    userId: input.userId ?? null,
    contactId: input.contactId ?? null,
    projectId: input.projectId ?? null,
  });
}

export async function memberAcceptedRulebook(db: DbExecutor, input: { teamId: string; userId: string; rulebookId: string }): Promise<boolean> {
  const [row] = await db
    .select({ id: rulebookAcceptance.id })
    .from(rulebookAcceptance)
    .where(
      and(
        eq(rulebookAcceptance.teamId, input.teamId),
        eq(rulebookAcceptance.userId, input.userId),
        eq(rulebookAcceptance.rulebookId, input.rulebookId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function recordMemberMark(
  db: DbExecutor,
  input: { teamId: string; memberUserId: string; projectId?: string | null; kind: "late_update" | "late_delivery" | "quality_refund" | "warning"; note?: string | null },
): Promise<void> {
  await db.insert(memberMark).values({
    teamId: input.teamId,
    memberUserId: input.memberUserId,
    projectId: input.projectId ?? null,
    kind: input.kind,
    note: input.note ?? null,
  });
}

export function countMemberMarks(
  db: DbExecutor,
  input: { teamId: string; memberUserId: string; windowDays: number; now: Date },
): Promise<number> {
  const since = new Date(input.now.getTime() - input.windowDays * 86_400_000);
  return countMarksInWindow(db, "member_mark", {
    teamId: input.teamId,
    memberUserId: input.memberUserId,
    since,
    kinds: ["late_update", "late_delivery", "quality_refund"],
  });
}

// Idempotent fan-out: returns only the rows this call created, so callers can act on fresh ones.
export async function insertOutboxDeliveries(
  db: DbExecutor,
  rows: { outboxId: string; channel: DeliveryChannel; recipient: string }[],
): Promise<OutboxDeliveryRow[]> {
  if (rows.length === 0) return [];
  return db
    .insert(outboxDelivery)
    .values(rows.map((row) => ({ ...row, dedupeKey: `${row.outboxId}:${row.channel}:${row.recipient}` })))
    .onConflictDoNothing()
    .returning();
}

export type OutboxDeliveryRow = typeof outboxDelivery.$inferSelect;

// Claims due deliveries under a row lock and returns them as engine records, so the caller applies
// the engine's pure transitions and writes them back.
export async function claimDueOutboxDeliveries(db: DbExecutor, now: Date, limit: number): Promise<OutboxDeliveryRow[]> {
  const claimed = await claimDueDeliveryRows(db, DELIVERY_TABLE, now, limit);
  if (claimed.length === 0) return [];
  return db
    .select()
    .from(outboxDelivery)
    .where(inArray(outboxDelivery.id, claimed.map((row: ClaimedDeliveryRow) => row.id)));
}

export async function applyDeliveryOutcome(
  db: DbExecutor,
  input: { record: OutboxDeliveryRecord; providerMessageId?: string; error?: string; at: Date },
): Promise<void> {
  const next =
    input.providerMessageId !== undefined || input.error === undefined
      ? recordDeliverySuccess(input.record, input.providerMessageId ?? null, input.at)
      : recordDeliveryFailure(input.record, input.error, input.at);
  await db
    .update(outboxDelivery)
    .set({
      status: next.status,
      attempts: next.attempts,
      nextAttemptAt: next.nextAttemptAt,
      sentAt: next.sentAt,
      lastError: next.lastError,
      providerMessageId: next.providerMessageId,
    })
    .where(eq(outboxDelivery.id, input.record.id));
}

export async function skipOutboxDelivery(db: DbExecutor, id: string): Promise<void> {
  await db.update(outboxDelivery).set({ status: "skipped" }).where(eq(outboxDelivery.id, id));
}

export async function getMemberNoticeEnabled(db: DbExecutor, teamId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: memberNoticePreference.projectNoticesEnabled })
    .from(memberNoticePreference)
    .where(and(eq(memberNoticePreference.teamId, teamId), eq(memberNoticePreference.userId, userId)))
    .limit(1);
  return row?.enabled ?? true;
}

export async function setMemberNoticeEnabled(db: DbExecutor, input: { teamId: string; userId: string; enabled: boolean }): Promise<void> {
  await db
    .insert(memberNoticePreference)
    .values({ teamId: input.teamId, userId: input.userId, projectNoticesEnabled: input.enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [memberNoticePreference.teamId, memberNoticePreference.userId],
      set: { projectNoticesEnabled: input.enabled, updatedAt: new Date() },
    });
}

export type DisputeStatus = "open" | "waiting_for_seller" | "under_review" | "resolved_buyer" | "resolved_seller";

export type DisputeRow = typeof dispute.$inferSelect;

export async function upsertDispute(
  db: DbExecutor,
  input: {
    teamId: string;
    projectId?: string | null;
    orderId?: string | null;
    paypalDisputeId: string;
    paypalCaptureId?: string | null;
    reason: string;
    status: DisputeStatus;
    outcome?: string | null;
    amountMinor: number;
    currency: string;
    resolvedAt?: Date | null;
    rawPayload?: unknown;
  },
): Promise<DisputeRow> {
  const [row] = await db
    .insert(dispute)
    .values({ ...input, resolvedAt: input.resolvedAt ?? null, rawPayload: input.rawPayload ?? null })
    .onConflictDoUpdate({
      target: dispute.paypalDisputeId,
      set: {
        status: input.status,
        outcome: input.outcome ?? null,
        reason: input.reason,
        resolvedAt: input.resolvedAt ?? null,
        rawPayload: input.rawPayload ?? null,
      },
    })
    .returning();
  if (!row) throw new Error("The dispute could not be saved");
  return row;
}

export async function findOpenDisputeForProject(db: DbExecutor, projectId: string): Promise<DisputeRow | null> {
  const [row] = await db
    .select()
    .from(dispute)
    .where(and(eq(dispute.projectId, projectId), inArray(dispute.status, ["open", "waiting_for_seller", "under_review"])))
    .limit(1);
  return row ?? null;
}

export async function teamHasOpenDispute(db: DbExecutor, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(dispute)
    .where(and(eq(dispute.teamId, teamId), inArray(dispute.status, ["open", "waiting_for_seller", "under_review"])));
  return (row?.count ?? 0) > 0;
}

export async function findOutboxDeliveriesForOutbox(db: DbExecutor, outboxId: string): Promise<OutboxDeliveryRow[]> {
  return db.select().from(outboxDelivery).where(eq(outboxDelivery.outboxId, outboxId));
}

export async function hasPendingDeliveries(db: DbExecutor, outboxIds: string[]): Promise<boolean> {
  if (outboxIds.length === 0) return false;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(outboxDelivery)
    .where(and(inArray(outboxDelivery.outboxId, outboxIds), eq(outboxDelivery.status, "pending")));
  return (row?.count ?? 0) > 0;
}

export type { ClaimedScheduleRow };
