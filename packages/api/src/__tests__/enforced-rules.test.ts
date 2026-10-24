import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ensurePublishedRulebook, recordMemberMark } from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { conversationMessage } from "@jendal-workspace/db/schema/conversations";
import { rulebookAcceptance, scheduleItem, memberMark } from "@jendal-workspace/db/schema/operating-model";
import { delivery, project as projectTable, quote } from "@jendal-workspace/db/schema/projects";
import {
  createTestDb,
  hasTestDatabase,
  seedProject,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { AGENCY_RULEBOOK_SPEC } from "@opmodel/engine-rules";

import { postConversationMessage } from "../use-cases/conversations";
import { acceptQuote, armProjectSchedule, requestChanges } from "../use-cases/projects";
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

  it("records the client's acceptance of the pinned terms at quote acceptance", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const projectId = await pinnedProject(db, teamId);
    const quoteId = crypto.randomUUID();
    await db.insert(quote).values({ id: quoteId, projectId, teamId, freelancerId: userId, amountMinor: 120_000, deliveryDays: 3 });

    await acceptQuote(db, { projectId, quoteId });

    const rows = await db.select().from(rulebookAcceptance).where(eq(rulebookAcceptance.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorKind: "client" });
  });

});
