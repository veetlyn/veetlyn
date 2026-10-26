import type { JsonValue } from "@jendal-workspace/core";
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
import { type DeliveryChannel, recordDeliveryFailure, recordDeliverySuccess } from "@opmodel/engine-outbox";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { dispute, memberMark, memberNoticePreference, outboxDelivery, rulebook, rulebookAcceptance, scheduleItem } from "../schema/operating-model";
import { user } from "../schema/auth";
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

// A draft is one row per team: saving again edits it until it is published. The write re-checks the status, so a
// save that loses a race with a publish starts the next draft instead of rewriting terms people have accepted.
export async function saveRulebookDraft(
  db: DbExecutor,
  input: { teamId: string; preset: RulePreset; spec: RulebookRules; userId: string | null },
): Promise<RulebookRow> {
  const draft = await getDraftRulebook(db, input.teamId);
  if (draft) {
    const [row] = await db
      .update(rulebook)
      .set({ preset: input.preset, spec: input.spec, createdById: input.userId })
      .where(and(eq(rulebook.id, draft.id), eq(rulebook.status, "draft")))
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
  return db.transaction(async (tx) => {
    const draft = await getDraftRulebook(tx, input.teamId);
    if (!draft) throw new Error("There is no draft to publish");
    const [row] = await tx
      .update(rulebook)
      .set({ status: "published", publishedAt: new Date() })
      .where(and(eq(rulebook.id, draft.id), eq(rulebook.status, "draft")))
      .returning();
    if (!row) throw new Error("The draft could not be published");
    await tx
      .update(servicesTeamSettings)
      .set({ teamCutBps: row.spec.split.teamCutBps, managerCutBps: row.spec.split.managerCutBps, settingsSavedAt: new Date() })
      .where(eq(servicesTeamSettings.teamId, input.teamId));
    return row;
  });
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
        eq(rulebookAcceptance.actorKind, "member"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function lockMemberWork(db: DbExecutor, input: { teamId: string; memberUserId: string }): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`member-work:${input.teamId}:${input.memberUserId}`}, 0))`);
}

export async function memberHasLeavingNotice(db: DbExecutor, input: { teamId: string; memberUserId: string }): Promise<boolean> {
  const [row] = await db.select({ id: memberMark.id }).from(memberMark).where(and(
    eq(memberMark.teamId, input.teamId),
    eq(memberMark.memberUserId, input.memberUserId),
    eq(memberMark.kind, "leaving_notice"),
  )).limit(1);
  return row !== undefined;
}

export async function recordMemberMark(
  db: DbExecutor,
  input: { teamId: string; memberUserId: string; projectId?: string | null; kind: "late_update" | "late_delivery" | "quality_refund" | "warning" | "leaving_notice"; note?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockMemberWork(tx, input);
    await tx.insert(memberMark).values({
      teamId: input.teamId,
      memberUserId: input.memberUserId,
      projectId: input.projectId ?? null,
      kind: input.kind,
      note: input.note ?? null,
    });
  });
}

// The marks recorded on one project, oldest first, with the member's name for the team's project page.
export function listProjectMemberMarks(db: DbExecutor, input: { teamId: string; projectId: string }) {
  return db
    .select({ id: memberMark.id, kind: memberMark.kind, note: memberMark.note, createdAt: memberMark.createdAt, memberName: user.name })
    .from(memberMark)
    .innerJoin(user, eq(user.id, memberMark.memberUserId))
    .where(and(eq(memberMark.teamId, input.teamId), eq(memberMark.projectId, input.projectId)))
    .orderBy(memberMark.createdAt);
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

// The atomic claim persists ownership before any external send; a stale owner cannot record its outcome.
export async function claimDueOutboxDeliveries(db: DbExecutor, now: Date, limit: number, outboxIds?: readonly string[]): Promise<OutboxDeliveryRow[]> {
  const claimed = await claimDueDeliveryRows(db, DELIVERY_TABLE, now, limit, outboxIds);
  if (claimed.length === 0) return [];
  return db
    .select()
    .from(outboxDelivery)
    .where(or(...claimed.map((row: ClaimedDeliveryRow) => and(eq(outboxDelivery.id, row.id), eq(outboxDelivery.claimToken, row.claim_token)))));
}

export async function applyDeliveryOutcome(
  db: DbExecutor,
  input: { record: OutboxDeliveryRow; providerMessageId?: string; error?: string; at: Date; requireConfirmation?: boolean },
): Promise<boolean> {
  if (!input.record.claimToken) throw new Error("Delivery outcome requires claim ownership");
  const next =
    input.providerMessageId !== undefined || input.error === undefined
      ? recordDeliverySuccess(input.record, input.providerMessageId ?? null, input.at)
      : recordDeliveryFailure(input.record, input.error, input.at);
  const updated = await db
    .update(outboxDelivery)
    .set({
      status: input.requireConfirmation ? "failed" : next.status,
      attempts: next.attempts,
      nextAttemptAt: input.requireConfirmation || next.status === "sent" ? null : next.nextAttemptAt,
      sentAt: next.sentAt,
      lastError: next.lastError,
      providerMessageId: next.providerMessageId,
      // The rendered snapshot holds the client's signed link; it is kept only while a retry may need it.
      message: next.status === "sent" && !input.requireConfirmation ? null : sql`${outboxDelivery.message}`,
      claimToken: null,
      claimExpiresAt: null,
    })
    .where(and(eq(outboxDelivery.id, input.record.id), eq(outboxDelivery.status, "pending"), eq(outboxDelivery.claimToken, input.record.claimToken)))
    .returning({ id: outboxDelivery.id });
  return updated.length > 0;
}

export async function skipOutboxDelivery(db: DbExecutor, id: string, claimToken?: string | null): Promise<void> {
  await db.update(outboxDelivery).set({ status: "skipped", message: null, claimToken: null, claimExpiresAt: null, nextAttemptAt: null }).where(and(
    eq(outboxDelivery.id, id), eq(outboxDelivery.status, "pending"),
    claimToken ? eq(outboxDelivery.claimToken, claimToken) : isNull(outboxDelivery.claimToken),
  ));
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
    amountMinor: number | null;
    currency: string | null;
    resolvedAt?: Date | null;
    rawPayload?: JsonValue;
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
        amountMinor: input.amountMinor ?? sql`${dispute.amountMinor}`,
        currency: input.currency ?? sql`${dispute.currency}`,
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

export async function projectHasOpenDispute(db: DbExecutor, input: { teamId: string; projectId: string }): Promise<boolean> {
  const [row] = await db.select({ id: dispute.id }).from(dispute).where(and(
    eq(dispute.teamId, input.teamId),
    eq(dispute.projectId, input.projectId),
    inArray(dispute.status, ["open", "waiting_for_seller", "under_review"]),
  )).limit(1);
  return row !== undefined;
}

export async function pauseProjectSchedule(db: DbExecutor, input: { teamId: string; projectId: string }): Promise<void> {
  await db.update(scheduleItem).set({ status: "paused" }).where(and(
    eq(scheduleItem.teamId, input.teamId),
    eq(scheduleItem.subjectId, input.projectId),
    eq(scheduleItem.status, "pending"),
  ));
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
