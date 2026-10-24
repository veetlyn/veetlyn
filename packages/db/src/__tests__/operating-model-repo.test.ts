import { AGENCY_RULEBOOK_SPEC } from "@opmodel/engine-rules";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyDeliveryOutcome,
  claimDueOutboxDeliveries,
  claimDueScheduleItems,
  completeScheduleItems,
  countMemberMarks,
  ensurePublishedRulebook,
  findOpenDisputeForProject,
  getDraftRulebook,
  getPublishedRulebook,
  insertOutboxDeliveries,
  memberAcceptedRulebook,
  pauseScheduleItemsForSubject,
  publishRulebook,
  recordMemberMark,
  recordRulebookAcceptance,
  resumeScheduleItemsForSubject,
  saveRulebookDraft,
  teamHasOpenDispute,
  upsertDispute,
  upsertPendingScheduleItems,
} from "../repositories/operating-model";
import { runInTransaction } from "../repositories/unit-of-work";
import { memberMark, outboxDelivery, rulebookAcceptance, scheduleItem } from "../schema/operating-model";
import { project } from "../schema/projects";
import { servicesTeamSettings } from "../schema/services-teams";
import { outbox } from "../schema/outbox";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, seedUser, truncateAll } from "../testing/db";

describe.skipIf(!hasTestDatabase)("operating model repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("seeds a published v1 rulebook from the team's settings", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    await db.update(servicesTeamSettings).set({ teamCutBps: 1800, kind: "agency" }).where(eq(servicesTeamSettings.teamId, teamId));

    const rulebook = await ensurePublishedRulebook(db, teamId);

    expect(rulebook).toMatchObject({ id: `rb_v1_${teamId}`, version: 1, status: "published", preset: "agency" });
    expect(rulebook.spec.split.teamCutBps).toBe(1800);
    expect(rulebook.spec.split.managerCutBps).toBe(1000);
    expect(rulebook.spec.split.memberCutBps).toBe(7200);
    expect(await ensurePublishedRulebook(db, teamId)).toMatchObject({ id: rulebook.id });
  });

  it("publishes v2 with new cuts while in-flight projects stay pinned to v1", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const v1 = await ensurePublishedRulebook(db, teamId);
    const projectId = await seedProject(db, { teamId });
    await db.update(project).set({ rulebookId: v1.id }).where(eq(project.id, projectId));

    const draft = await saveRulebookDraft(db, {
      teamId,
      userId,
      preset: "custom",
      spec: { ...AGENCY_RULEBOOK_SPEC.rules, split: { teamCutBps: 2500, managerCutBps: 1000, memberCutBps: 6500 } },
    });
    expect(draft.status).toBe("draft");
    // Saving again edits the same draft row rather than stacking versions.
    await saveRulebookDraft(db, { teamId, userId, preset: "custom", spec: draft.spec });
    expect(await getDraftRulebook(db, teamId)).toMatchObject({ id: draft.id });

    const v2 = await publishRulebook(db, { teamId, userId });
    expect(v2).toMatchObject({ version: 2, status: "published" });
    expect(await getPublishedRulebook(db, teamId)).toMatchObject({ id: v2.id });

    const [pinned] = await db.select({ rulebookId: project.rulebookId }).from(project).where(eq(project.id, projectId));
    expect(pinned).toEqual({ rulebookId: v1.id });
    const [settings] = await db.select().from(servicesTeamSettings).where(eq(servicesTeamSettings.teamId, teamId));
    expect(settings).toMatchObject({ teamCutBps: 2500, managerCutBps: 1000 });
  });

  it("records client and member acceptances and answers the member query", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const v1 = await ensurePublishedRulebook(db, teamId);
    const projectId = await seedProject(db, { teamId });
    const otherUser = await seedUser(db, "Member");

    await recordRulebookAcceptance(db, { rulebookId: v1.id, teamId, actorKind: "client", contactId: null, projectId });
    await recordRulebookAcceptance(db, { rulebookId: v1.id, teamId, actorKind: "member", userId });

    const acceptances = await db.select().from(rulebookAcceptance).where(eq(rulebookAcceptance.rulebookId, v1.id));
    expect(acceptances).toHaveLength(2);
    expect(await memberAcceptedRulebook(db, { teamId, userId, rulebookId: v1.id })).toBe(true);
    expect(await memberAcceptedRulebook(db, { teamId, userId: otherUser, rulebookId: v1.id })).toBe(false);
  });

  it("reconciles, pauses, resumes and completes schedule items", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const runAt = new Date("2026-10-02T00:00:00Z");

    await upsertPendingScheduleItems(db, { teamId, subjectId: projectId, schedule: [{ kind: "request.remind", runAt }], cancel: [] });
    // Re-planning moves the armed row; cancelling a kind retires it.
    await upsertPendingScheduleItems(db, {
      teamId,
      subjectId: projectId,
      schedule: [{ kind: "request.remind", runAt: new Date("2026-10-02T12:00:00Z") }, { kind: "request.expire", runAt: new Date("2026-10-03T00:00:00Z") }],
      cancel: [],
    });
    await upsertPendingScheduleItems(db, { teamId, subjectId: projectId, schedule: [], cancel: ["request.expire"] });

    const claimed = await claimDueScheduleItems(db, new Date("2026-10-04T00:00:00Z"), 10);
    expect(claimed.map((row) => row.kind)).toEqual(["request.remind"]);
    await completeScheduleItems(db, claimed.map((row) => row.id), { status: "done" });
    expect(await claimDueScheduleItems(db, new Date("2026-10-04T00:00:00Z"), 10)).toEqual([]);

    await upsertPendingScheduleItems(db, {
      teamId,
      subjectId: projectId,
      schedule: [{ kind: "client.reviewRemind1", runAt: new Date("2026-10-05T00:00:00Z") }],
      cancel: [],
    });
    await pauseScheduleItemsForSubject(db, projectId);
    expect(await claimDueScheduleItems(db, new Date("2026-10-06T00:00:00Z"), 10)).toEqual([]);
    await resumeScheduleItemsForSubject(db, projectId);
    expect((await claimDueScheduleItems(db, new Date("2026-10-06T00:00:00Z"), 10)).map((row) => row.kind)).toEqual(["client.reviewRemind1"]);
    expect(await db.select().from(scheduleItem)).toHaveLength(3);
  });

  it("counts member marks inside the rolling window only", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const memberUserId = await seedUser(db, "Freelancer");

    await recordMemberMark(db, { teamId, memberUserId, kind: "late_update" });
    await recordMemberMark(db, { teamId, memberUserId, kind: "late_delivery" });
    await db.insert(memberMark).values({ teamId, memberUserId, kind: "late_update", createdAt: new Date(Date.now() - 40 * 86_400_000) });

    expect(await countMemberMarks(db, { teamId, memberUserId, windowDays: 30, now: new Date() })).toBe(2);
  });

  it("fans out deliveries at most once per event, channel and recipient, and applies engine outcomes", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const [event] = await db
      .insert(outbox)
      .values({ teamId, type: "payout.requested", projectId: null, sequence: 1, data: {} })
      .returning();
    if (!event) throw new Error("no outbox row");

    expect((await insertOutboxDeliveries(db, [{ outboxId: event.id, channel: "email_member", recipient: "member@example.com" }])).length).toBe(1);
    expect(await insertOutboxDeliveries(db, [{ outboxId: event.id, channel: "email_member", recipient: "member@example.com" }])).toEqual([]);
    expect(await db.select().from(outboxDelivery)).toHaveLength(1);

    const claimed = await claimDueOutboxDeliveries(db, new Date(), 10);
    expect(claimed).toHaveLength(1);
    const record = claimed[0];
    if (!record) throw new Error("no claimed delivery");

    await applyDeliveryOutcome(db, { record, providerMessageId: "re_1", at: new Date() });
    const [sent] = await db.select().from(outboxDelivery).where(eq(outboxDelivery.id, record.id));
    expect(sent).toMatchObject({ status: "sent", attempts: 1, providerMessageId: "re_1" });
    expect(await claimDueOutboxDeliveries(db, new Date(), 10)).toEqual([]);
  });

  it("persists disputes and finds open ones per project and team", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    const opened = await upsertDispute(db, {
      teamId,
      projectId,
      paypalDisputeId: "PP-D-1",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "open",
      amountMinor: 12050,
      currency: "USD",
    });
    expect(opened).toMatchObject({ status: "open", amountMinor: 12050 });
    expect(await findOpenDisputeForProject(db, projectId)).toMatchObject({ id: opened.id });
    expect(await teamHasOpenDispute(db, teamId)).toBe(true);

    const resolved = await upsertDispute(db, {
      teamId,
      projectId,
      paypalDisputeId: "PP-D-1",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "resolved_seller",
      outcome: "RESOLVED_SELLER_FAVOUR",
      amountMinor: 12050,
      currency: "USD",
      resolvedAt: new Date(),
    });
    expect(resolved).toMatchObject({ status: "resolved_seller" });
    expect(await findOpenDisputeForProject(db, projectId)).toBeNull();
    expect(await teamHasOpenDispute(db, teamId)).toBe(false);
  });

  it("appends team-scoped outbox events numbered per team, with no project", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const rows = await runInTransaction(db, (_tx, uow) =>
      uow.appendTeamOutbox({ teamId }, [
        { type: "payout.requested", data: {} },
        { type: "payout.approved", data: {} },
      ]),
    );
    expect(rows.map((row) => [row.type, row.sequence, row.projectId])).toEqual([
      ["payout.requested", 1, null],
      ["payout.approved", 2, null],
    ]);
  });
});
