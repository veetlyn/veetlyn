import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ensurePublishedRulebook, recordMemberMark, recordRulebookAcceptance } from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { conversationMessage } from "@jendal-workspace/db/schema/conversations";
import { scheduleItem, memberMark } from "@jendal-workspace/db/schema/operating-model";
import { amendment, delivery, payment, project as projectTable, quote, quoteItem } from "@jendal-workspace/db/schema/projects";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import {
  createTestDb,
  hasTestDatabase,
  seedProject,
  seedServicesTeam,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { AGENCY_RULEBOOK_SPEC } from "@opmodel/engine-rules";

import { postConversationMessage } from "../use-cases/conversations";
import { acceptAmendment, acceptQuote, addQuote, armProjectSchedule, assignFreelancer, offerPaidRevision, requestChanges } from "../use-cases/projects";
import { acceptMemberRulebook, giveMemberLeavingNotice, publishRulebook, saveRulebookDraft } from "../use-cases/rulebooks";
import { runDueScheduleItems } from "../use-cases/scheduler-sweep";

const H = 3_600_000;

async function pinnedProject(db: ReturnType<typeof createTestDb>, teamId: string, title = "Brand refresh"): Promise<string> {
  const rb = await ensurePublishedRulebook(db, teamId);
  const projectId = await seedProject(db, { teamId, title });
  await db.update(projectTable).set({ rulebookId: rb.id, revisions: AGENCY_RULEBOOK_SPEC.rules.revisions.freeCount }).where(eq(projectTable.id, projectId));
  return projectId;
}

describe.skipIf(!hasTestDatabase)("enforced rules", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it.each(["strike", "leaving", "agreement"])("refuses new assignments and quotes for a member on %s restriction", async (restriction) => {
    const { teamId, organizationId, userId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await pinnedProject(db, teamId);
    const published = await ensurePublishedRulebook(db, teamId);
    if (restriction !== "agreement") {
      await acceptMemberRulebook(db, { teamId, userId: memberId, termsAccepted: true, acceptedRulebookId: published.id });
    } else {
      await acceptMemberRulebook(db, { teamId, userId, termsAccepted: true, acceptedRulebookId: published.id });
      await recordRulebookAcceptance(db, { teamId, userId: memberId, actorKind: "client", rulebookId: published.id });
    }
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    if (restriction === "strike") {
      for (let count = 0; count < 3; count++) {
        await recordMemberMark(db, { teamId, memberUserId: memberId, kind: "late_update" });
      }
    } else if (restriction === "leaving") {
      await giveMemberLeavingNotice(db, { teamId, userId: memberId, rulebook: { leavingNotice: { days: 14 } } });
    }
    const actor = { teamId, actorId: userId, role: "admin" } as const;
    const assignment = await assignFreelancer(db, actor, { projectId, freelancerId: memberId }).then(() => "allowed", () => "refused");
    const quoting = await addQuote(db, { teamId, actorId: memberId, role: "freelancer" }, {
      projectId, deliveryDays: 3,
      items: [{ description: "Logo", amountMinor: 10000, extraDays: 0 }],
    }).then(() => "allowed", () => "refused");
    expect([assignment, quoting]).toEqual(["refused", "refused"]);
    if (restriction === "agreement") {
      await expect(addQuote(db, actor, {
        projectId, freelancerId: memberId, deliveryDays: 3,
        items: [{ description: "Logo", amountMinor: 10000, extraDays: 0 }],
      })).rejects.toThrow(/member agreement/);
    }
    expect((await findProjectById(db, projectId))?.assignedFreelancerId).toBeNull();
    expect(await db.select().from(quote)).toEqual([]);
  });

  it.each(["strike", "leaving", "agreement"])("refuses accepting an older quote after a %s restriction", async (restriction) => {
    const { teamId, organizationId, userId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await pinnedProject(db, teamId);
    const published = await ensurePublishedRulebook(db, teamId);
    await acceptMemberRulebook(db, { teamId, userId: memberId, termsAccepted: true, acceptedRulebookId: published.id });
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const { quoteId } = await addQuote(db, { teamId, actorId: memberId, role: "freelancer" }, {
      projectId, deliveryDays: 3, items: [{ description: "Logo", amountMinor: 10000, extraDays: 0 }],
    });
    if (restriction === "strike") {
      for (let count = 0; count < 3; count++) await recordMemberMark(db, { teamId, memberUserId: memberId, kind: "late_update" });
    } else if (restriction === "leaving") {
      await giveMemberLeavingNotice(db, { teamId, userId: memberId, rulebook: { leavingNotice: { days: 14 } } });
    } else {
      await saveRulebookDraft(db, { teamId, userId, preset: "custom", spec: { ...published.spec, leavingNotice: { days: 15 } } });
      await publishRulebook(db, { teamId, userId });
    }
    await expect(acceptQuote(db, { projectId, quoteId })).rejects.toThrow(/suspended|leaving notice|member agreement/);
    expect((await findProjectById(db, projectId))?.status).toBe("quoting");
    expect(await db.select().from(payment)).toEqual([]);
    expect(await db.select().from(quote)).toEqual([expect.objectContaining({ id: quoteId, status: "proposed" })]);
    if (restriction === "agreement") {
      const current = await ensurePublishedRulebook(db, teamId);
      await acceptMemberRulebook(db, { teamId, userId: memberId, termsAccepted: true, acceptedRulebookId: current.id });
      await acceptQuote(db, { projectId, quoteId });
      expect(await findProjectById(db, projectId)).toMatchObject({ status: "awaiting_deposit", rulebookId: published.id });
      expect(await db.select().from(payment)).toHaveLength(1);
    }
  });

  it("ignores expired and foreign-team marks when accepting new work", async () => {
    const { teamId, organizationId, userId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await pinnedProject(db, teamId);
    const published = await ensurePublishedRulebook(db, teamId);
    await acceptMemberRulebook(db, { teamId, userId: memberId, termsAccepted: true, acceptedRulebookId: published.id });
    for (let count = 0; count < 3; count++) {
      await recordMemberMark(db, { teamId, memberUserId: memberId, kind: "late_update" });
    }
    await db.update(memberMark).set({ createdAt: new Date(Date.now() - 31 * 24 * H) }).where(eq(memberMark.teamId, teamId));
    const other = await seedServicesTeam(db, { organizationId, slug: "other-team" });
    for (let count = 0; count < 3; count++) await recordMemberMark(db, { teamId: other.id, memberUserId: memberId, kind: "late_update" });
    const actor = { teamId, actorId: userId, role: "admin" } as const;
    await assignFreelancer(db, actor, { projectId, freelancerId: memberId });
    await addQuote(db, { teamId, actorId: memberId, role: "freelancer" }, {
      projectId, deliveryDays: 3,
      items: [{ description: "Logo", amountMinor: 10000, extraDays: 0 }],
    });
    expect((await findProjectById(db, projectId))?.assignedFreelancerId).toBe(memberId);
    expect(await db.select().from(quote)).toEqual([expect.objectContaining({ projectId, freelancerId: memberId })]);
  });

  it("arms the response window for a new request and retires it when the seller answers", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await pinnedProject(db, teamId);

    const row = (await findProjectById(db, projectId))!;
    await armProjectSchedule(db, row, new Date());
    const armed = await db.select().from(scheduleItem).where(eq(scheduleItem.subjectId, projectId));
    expect(armed.map((item) => item.kind).sort()).toEqual(["request.expire", "request.remind"]);

    // The seller's answer (a quote or a question) closes the window.
    await armProjectSchedule(db, row, new Date(), { memberActivityAt: new Date() });
    const active = await db.select().from(scheduleItem).where(eq(scheduleItem.subjectId, projectId));
    expect(active.filter((item) => item.status === "pending")).toEqual([]);
  });

  it("collects a tiered upfront deposit and stores the rate on the project", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const projectId = await pinnedProject(db, teamId);
    const published = await ensurePublishedRulebook(db, teamId);
    await acceptMemberRulebook(db, { teamId, userId, termsAccepted: true, acceptedRulebookId: published.id });
    await db.update(projectTable).set({ managementFeeBps: 1000 }).where(eq(projectTable.id, projectId));
    const quoteId = crypto.randomUUID();
    await db.insert(quote).values({ id: quoteId, projectId, teamId, freelancerId: userId, amountMinor: 20_000, deliveryDays: 3 });

    // A quote under $300.00 hits the 100% tier: the whole quote plus the fee is due up front.
    const result = await acceptQuote(db, { projectId, quoteId });
    const row = await findProjectById(db, projectId);
    expect(row?.upfrontBps).toBe(10_000);
    expect(result.amountMinor).toBe(22_000);

    // A larger quote takes the 50% default tier: half the quote plus the fee on the full quote.
    const otherId = await pinnedProject(db, teamId, "Second");
    const otherQuote = crypto.randomUUID();
    await db.update(projectTable).set({ managementFeeBps: 1000 }).where(eq(projectTable.id, otherId));
    await db.insert(quote).values({ id: otherQuote, projectId: otherId, teamId, freelancerId: userId, amountMinor: 120_000, deliveryDays: 3 });
    const other = await acceptQuote(db, { projectId: otherId, quoteId: otherQuote });
    expect(other.amountMinor).toBe(72_000);
  });

  it("refuses changes past the free rounds and names the paid revision price", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const projectId = await pinnedProject(db, teamId);
    await db
      .update(projectTable)
      .set({ status: "delivered", revisions: 2, assignedFreelancerId: userId })
      .where(eq(projectTable.id, projectId));
    // Both free rounds are already used.
    await db.insert(delivery).values([
      { projectId, teamId, note: "first", status: "changes_requested", decidedAt: new Date() },
      { projectId, teamId, note: "second", status: "changes_requested", decidedAt: new Date() },
    ]);
    await db.insert(delivery).values({ projectId, teamId, note: "third" });
    const [openDelivery] = await db.select().from(delivery).where(eq(delivery.status, "submitted")).limit(1);

    await expect(requestChanges(db, { projectId, deliveryId: openDelivery!.id, note: "Again" })).rejects.toThrow(/REVISION_LIMIT_REACHED.*\$75\.00/);
  });

  it("offers a paid revision at the rulebook price that adds a round once the client accepts it", async () => {
    const { teamId, organizationId, userId } = await seedServicesTeamWithAdmin(db);
    const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await pinnedProject(db, teamId);
    await db.update(projectTable).set({ status: "delivered", revisions: 2, assignedFreelancerId: freelancerId, managementFeeBps: 0 }).where(eq(projectTable.id, projectId));
    const [current] = await db.insert(quote).values({ projectId, teamId, freelancerId, amountMinor: 20_000, deliveryDays: 3, status: "accepted" }).returning();
    await db.insert(quoteItem).values({ quoteId: current!.id, position: 0, description: "Logo", amountMinor: 20_000 });
    await db.insert(delivery).values([
      { projectId, teamId, note: "first", status: "changes_requested", decidedAt: new Date() },
      { projectId, teamId, note: "second", status: "changes_requested", decidedAt: new Date() },
    ]);
    const [open] = await db.insert(delivery).values({ projectId, teamId, note: "third" }).returning();
    const freelancer = { teamId, actorId: freelancerId, role: "freelancer" } as const;

    await expect(offerPaidRevision(db, { teamId, actorId: userId, role: "admin" }, { projectId: crypto.randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { amendmentId } = await offerPaidRevision(db, freelancer, { projectId });
    expect(await db.select().from(amendment)).toEqual([
      expect.objectContaining({ id: amendmentId, newAmountMinor: 27_500, revisionsAdded: 1, addItems: [{ description: "Paid revision", amountMinor: 7_500, extraDays: 0 }] }),
    ]);
    await expect(offerPaidRevision(db, freelancer, { projectId })).rejects.toThrow();

    const { topUpPaymentId } = await acceptAmendment(db, { projectId, amendmentId });
    expect((await findProjectById(db, projectId))?.revisions).toBe(3);
    // The extra round waits for its top-up, like any increase's work.
    await expect(requestChanges(db, { projectId, deliveryId: open!.id, note: "One more pass" })).rejects.toThrow(/top-up/i);
    await db.update(payment).set({ status: "captured" }).where(eq(payment.id, topUpPaymentId!));
    await requestChanges(db, { projectId, deliveryId: open!.id, note: "One more pass" });
    expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
  });

  it("expires an unanswered request through the scheduler", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await pinnedProject(db, teamId);
    await db.insert(scheduleItem).values({ teamId, subjectId: projectId, kind: "request.expire", runAt: new Date(Date.now() - H) });

    const report = await runDueScheduleItems({ db });
    expect(report).toMatchObject({ fired: 1, failed: 0 });
    expect((await findProjectById(db, projectId))?.status).toBe("expired");
    // The expired request cannot be quoted: quoting is closed outside "quoting".
    expect((await findProjectById(db, projectId))?.status).not.toBe("quoting");
  });

  it("marks a late update and warns at the strike threshold", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await pinnedProject(db, teamId);
    await db.update(projectTable).set({ status: "in_progress", assignedFreelancerId: memberId }).where(eq(projectTable.id, projectId));
    // Two marks already inside the window; the late update is the third, which warns.
    await recordMemberMark(db, { teamId, memberUserId: memberId, kind: "late_update" });
    await recordMemberMark(db, { teamId, memberUserId: memberId, kind: "late_delivery" });
    await db.insert(scheduleItem).values({ teamId, subjectId: projectId, kind: "member.updateLate", runAt: new Date(Date.now() - H) });

    const report = await runDueScheduleItems({ db });
    expect(report).toMatchObject({ failed: 0, held: 0 });
    const marks = await db.select().from(memberMark).where(eq(memberMark.memberUserId, memberId));
    expect(marks.filter((mark) => mark.kind === "late_update")).toHaveLength(2);
    expect(marks.filter((mark) => mark.kind === "warning")).toHaveLength(1);
  });

  it("caps messages at ten per author per minute", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "manager" });
    const projectId = await pinnedProject(db, teamId);
    await db.update(projectTable).set({ status: "in_progress", assignedFreelancerId: memberId }).where(eq(projectTable.id, projectId));

    const author = { kind: "member" as const, actor: { teamId, actorId: memberId, role: "manager" as const } };
    for (let i = 0; i < 10; i++) {
      await postConversationMessage(db, author, { projectId, kind: "text", body: `Message ${i}` }, "web");
    }
    await expect(postConversationMessage(db, author, { projectId, kind: "text", body: "One too many" }, "web")).rejects.toThrow(/too quickly/);
    const rows = await db.select().from(conversationMessage).where(eq(conversationMessage.projectId, projectId));
    expect(rows.filter((row) => row.surface === "web")).toHaveLength(10);
  });

});
