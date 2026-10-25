import { createFakeFileStore } from "@jendal-workspace/core";
import { resumeScheduleItemsForSubject, upsertDispute } from "@jendal-workspace/db/repositories/operating-model";
import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { memberMark, scheduleItem } from "@jendal-workspace/db/schema/operating-model";
import { team } from "@jendal-workspace/db/schema/organization";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { conversationMessage } from "@jendal-workspace/db/schema/conversations";
import { delivery, project, payment } from "@jendal-workspace/db/schema/projects";
import { createTestDb, hasTestDatabase, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerQuestion, declineRequest, postConversationMessage } from "./conversations";
import { applyCaptureFact } from "./payments";
import { acceptAmendment, acceptDelivery, acceptQuote, addQuote, assignFreelancer, proposeAmendment, requestChanges, submitDelivery, type ProjectActor } from "./projects";
import { requestQuote } from "./requests";
import { runDueScheduleItems } from "./scheduler-sweep";

const START = new Date("2026-10-25T12:00:00Z");
const hoursAfter = (hours: number) => new Date(START.getTime() + hours * 3_600_000);

describe.skipIf(!hasTestDatabase)("transactional timer lifecycle", () => {
  const db = createTestDb();
  beforeEach(async () => {
    await truncateAll(db);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => db.$client.end());

  async function requested() {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    await db.update(team).set({ status: "active" }).where(eq(team.id, teamId));
    const { projectId } = await requestQuote(db, {
      slug: "team", offeringId: null, name: "Client", email: "client@example.com",
      description: "Please design a bakery logo", answers: [],
    });
    const contact = await primaryContactFor(db, projectId);
    if (!contact) throw new Error("Missing request contact");
    return { teamId, projectId, contactId: contact.contactId, actor: { teamId, actorId: userId, role: "admin" } satisfies ProjectActor };
  }

  async function quoted() {
    const fixture = await requested();
    vi.setSystemTime(hoursAfter(1));
    await assignFreelancer(db, fixture.actor, { projectId: fixture.projectId, freelancerId: fixture.actor.actorId });
    const { quoteId } = await addQuote(db, fixture.actor, {
      projectId: fixture.projectId, freelancerId: fixture.actor.actorId,
      items: [{ description: "Logo", amountMinor: 20_000, extraDays: 0 }], deliveryDays: 4,
    });
    const accepted = await acceptQuote(db, { projectId: fixture.projectId, quoteId });
    const [row] = await db.select().from(payment).where(eq(payment.id, accepted.paymentId));
    if (!row) throw new Error("Missing deposit");
    const orderId = `order-${row.id}`;
    await db.update(payment).set({ paypalOrderId: orderId }).where(eq(payment.id, row.id));
    const fact = {
      paymentId: row.id, orderId, captureId: `capture-${row.id}`, status: "COMPLETED",
      amountMinor: row.amountMinor, currency: row.currency, capturedAt: hoursAfter(2),
      paypalFeeMinor: 0, platformFeeMinor: 0, reviewReason: null,
    };
    return { ...fixture, fact };
  }

  async function timers(projectId: string) {
    return db.select().from(scheduleItem).where(eq(scheduleItem.subjectId, projectId)).orderBy(scheduleItem.kind, scheduleItem.id);
  }

  it("capture arms the pinned work window once and future sweeps remind then mark late", async () => {
    const { projectId, fact } = await quoted();
    expect(await applyCaptureFact(db, fact)).toBe("applied");
    const armed = await timers(projectId);
    expect(armed.filter((row) => row.status === "pending")).toEqual([
      expect.objectContaining({ kind: "member.updateLate", runAt: hoursAfter(50) }),
      expect.objectContaining({ kind: "member.updateRemind", runAt: hoursAfter(42) }),
    ]);
    expect(await applyCaptureFact(db, { ...fact, capturedAt: hoursAfter(10) })).toBe("already_applied");
    expect(await timers(projectId)).toEqual(armed);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(42) })).toEqual({ fired: 1, failed: 0, held: 0 });
    expect(await db.select().from(memberMark)).toEqual([]);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(50) })).toEqual({ fired: 1, failed: 0, held: 0 });
    expect(await db.select().from(memberMark)).toEqual([expect.objectContaining({ kind: "late_update", projectId })]);
    expect((await db.select().from(outbox)).filter((row) => row.type === "member.update_remind" || row.type === "member.update_late").map((row) => row.type))
      .toEqual(["member.update_remind", "member.update_late"]);
    expect(await findProjectById(db, projectId)).toMatchObject({ status: "in_progress", deadlineAt: hoursAfter(98) });
  });

  it("a real working update moves both steps and the old deadlines have no effect", async () => {
    const { projectId, actor, fact } = await quoted();
    await applyCaptureFact(db, fact);
    vi.setSystemTime(hoursAfter(30));
    await postConversationMessage(db, { kind: "member", actor }, { projectId, kind: "text", body: "The first draft is ready" }, "web");
    expect((await timers(projectId)).filter((row) => row.status === "pending")).toEqual([
      expect.objectContaining({ kind: "member.updateLate", runAt: hoursAfter(78) }),
      expect.objectContaining({ kind: "member.updateRemind", runAt: hoursAfter(70) }),
    ]);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(50) })).toEqual({ fired: 0, failed: 0, held: 0 });
    expect(await db.select().from(memberMark)).toEqual([]);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(70) })).toEqual({ fired: 1, failed: 0, held: 0 });
  });


  it.each(["quote", "question", "decline"] as const)("%s cancels response steps atomically even at the request timestamp", async (response) => {
    const { projectId, actor } = await requested();
    const row = await findProjectById(db, projectId);
    if (!row) throw new Error("Missing request");
    vi.setSystemTime(row.createdAt);
    await db.execute(sql`alter table schedule_item add constraint lifecycle_cancel_failure check (status <> 'cancelled')`);
    async function respond() {
      if (response === "quote") {
        await assignFreelancer(db, actor, { projectId, freelancerId: actor.actorId });
        return addQuote(db, actor, { projectId, freelancerId: actor.actorId, items: [{ description: "Logo", amountMinor: 20_000, extraDays: 0 }], deliveryDays: 4 });
      }
      if (response === "question") return postConversationMessage(db, { kind: "member", actor }, { projectId, kind: "question", body: "Which colors?" }, "web");
      return declineRequest(db, actor, { projectId, reason: "No capacity" });
    }
    const beforeEvents = await db.select().from(outbox);
    try {
      await expect(respond()).rejects.toMatchObject({ cause: { constraint_name: "lifecycle_cancel_failure" } });
      expect((await timers(projectId)).filter((timer) => timer.status === "pending")).toHaveLength(2);
      expect((await db.select().from(outbox)).filter((event) => event.type === "quote.created" || event.type === "message.posted" || event.type === "project.declined")).toEqual([]);
      expect(await findProjectById(db, projectId)).toMatchObject({ status: "quoting" });
    } finally {
      await db.execute(sql`alter table schedule_item drop constraint lifecycle_cancel_failure`);
    }
    expect(beforeEvents).toHaveLength(1);
    await respond();
    expect((await timers(projectId)).filter((timer) => timer.status === "pending")).toEqual([]);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(100) })).toEqual({ fired: 0, failed: 0, held: 0 });
  });

  it.each(["reply", "answer", "changes"] as const)("delivery followed by client %s retires silence until a genuinely new delivery", async (reply) => {
    const { projectId, actor, contactId, fact } = await quoted();
    await applyCaptureFact(db, fact);
    vi.setSystemTime(hoursAfter(3));
    const question = await postConversationMessage(db, { kind: "member", actor }, { projectId, kind: "question", body: "What do you think?" }, "web");
    const { deliveryId } = await submitDelivery(db, createFakeFileStore(), actor, { projectId, note: "First draft", link: "" });
    const active = (await timers(projectId)).filter((timer) => timer.status === "pending");
    expect(active).toEqual([
      expect.objectContaining({ kind: "client.reviewRemind1", runAt: hoursAfter(123) }),
      expect.objectContaining({ kind: "client.reviewRemind2", runAt: hoursAfter(243) }),
      expect.objectContaining({ kind: "project.autoComplete", runAt: hoursAfter(339) }),
    ]);
    vi.setSystemTime(hoursAfter(4));
    if (reply === "answer") await answerQuestion(db, { contactId }, { projectId, questionId: question.messageId, body: "Please use blue" }, "web");
    else if (reply === "changes") await requestChanges(db, { projectId, deliveryId, note: "Please use blue" });
    else await postConversationMessage(db, { kind: "client", contactId }, { projectId, kind: "text", body: "I am checking" }, "web");
    expect((await timers(projectId)).filter((timer) => timer.status === "pending" && !timer.kind.startsWith("member."))).toEqual([]);
    if (reply === "changes") expect((await timers(projectId)).filter((timer) => timer.status === "pending")).toEqual([
      expect.objectContaining({ kind: "member.updateLate", runAt: hoursAfter(52) }),
      expect.objectContaining({ kind: "member.updateRemind", runAt: hoursAfter(44) }),
    ]);
    await postConversationMessage(db, { kind: "member", actor }, { projectId, kind: "text", body: "Thank you" }, "web");
    expect((await timers(projectId)).filter((timer) => timer.status === "pending" && !timer.kind.startsWith("member."))).toEqual([]);
    await runDueScheduleItems({ db, now: () => hoursAfter(340) });
    expect(await findProjectById(db, projectId)).toMatchObject({ status: reply === "changes" ? "in_progress" : "delivered", finalPriceMinor: null });
    expect((await db.select().from(outbox)).filter((event) => event.type === "delivery.accepted")).toEqual([]);
    if (reply === "changes") {
      vi.setSystemTime(hoursAfter(341));
      await submitDelivery(db, createFakeFileStore(), actor, { projectId, note: "Blue version", link: "" });
      expect((await timers(projectId)).filter((timer) => timer.status === "pending")).toEqual([
        expect.objectContaining({ kind: "client.reviewRemind1", runAt: hoursAfter(461) }),
        expect.objectContaining({ kind: "client.reviewRemind2", runAt: hoursAfter(581) }),
        expect.objectContaining({ kind: "project.autoComplete", runAt: hoursAfter(677) }),
      ]);
    }
  });


  async function hold(fixture: { teamId: string; projectId: string }, status: "open" | "waiting_for_seller" | "under_review" = "open") {
    return upsertDispute(db, { ...fixture, paypalDisputeId: crypto.randomUUID(), reason: "Not received", status, amountMinor: 20_000, currency: "USD" });
  }

  it.each(["open", "waiting_for_seller", "under_review"] as const)("delivery during a persisted %s hold creates only paused review steps", async (status) => {
    const fixture = await quoted();
    await applyCaptureFact(db, fixture.fact);
    await hold(fixture, status);
    vi.setSystemTime(hoursAfter(3));
    await submitDelivery(db, createFakeFileStore(), fixture.actor, { projectId: fixture.projectId, note: "Ready", link: "" });
    const rows = await timers(fixture.projectId);
    expect(rows.filter((timer) => timer.status === "pending")).toEqual([]);
    expect(rows.filter((timer) => timer.status === "paused")).toEqual([
      expect.objectContaining({ kind: "client.reviewRemind1", runAt: hoursAfter(123) }),
      expect.objectContaining({ kind: "client.reviewRemind2", runAt: hoursAfter(243) }),
      expect.objectContaining({ kind: "project.autoComplete", runAt: hoursAfter(339) }),
    ]);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(340) })).toEqual({ fired: 0, failed: 0, held: 0 });
    expect(await findProjectById(db, fixture.projectId)).toMatchObject({ status: "delivered", finalPriceMinor: null });
    await postConversationMessage(db, { kind: "client", contactId: fixture.contactId }, { projectId: fixture.projectId, kind: "text", body: "Checking" }, "web");
    await resumeScheduleItemsForSubject(db, fixture.projectId);
    expect((await timers(fixture.projectId)).filter((timer) => timer.status === "pending" || timer.status === "paused")).toEqual([]);
  });

  it.each(["working", "delivered"] as const)("the sweep holds stale pending %s timers using persisted team/project authority", async (phase) => {
    const fixture = await quoted();
    await applyCaptureFact(db, fixture.fact);
    if (phase === "delivered") await submitDelivery(db, createFakeFileStore(), fixture.actor, { projectId: fixture.projectId, note: "Ready", link: "" });
    await hold(fixture);
    const before = await db.select().from(outbox);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(400) })).toEqual({ fired: 0, failed: 0, held: phase === "working" ? 2 : 3 });
    expect(await db.select().from(outbox)).toEqual(before);
    expect(await db.select().from(memberMark)).toEqual([]);
    expect(await findProjectById(db, fixture.projectId)).toMatchObject({ status: phase === "working" ? "in_progress" : "delivered", finalPriceMinor: null });
    expect((await timers(fixture.projectId)).filter((timer) => timer.status === "pending")).toEqual([]);
  });

  it("capture and working updates during a hold keep the current phase paused without sliding on unrelated client activity", async () => {
    const fixture = await quoted();
    await hold(fixture);
    await applyCaptureFact(db, fixture.fact);
    expect((await timers(fixture.projectId)).filter((timer) => timer.status === "paused")).toHaveLength(2);
    vi.setSystemTime(hoursAfter(30));
    await postConversationMessage(db, { kind: "member", actor: fixture.actor }, { projectId: fixture.projectId, kind: "text", body: "Progress" }, "web");
    const before = await timers(fixture.projectId);
    expect(before.filter((timer) => timer.status === "paused")).toEqual([
      expect.objectContaining({ kind: "member.updateLate", runAt: hoursAfter(78) }),
      expect.objectContaining({ kind: "member.updateRemind", runAt: hoursAfter(70) }),
    ]);
    await postConversationMessage(db, { kind: "client", contactId: fixture.contactId }, { projectId: fixture.projectId, kind: "text", body: "Thanks" }, "web");
    expect(await timers(fixture.projectId)).toEqual(before);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(80) })).toEqual({ fired: 0, failed: 0, held: 0 });
  });


  it("request timer failure rolls back the request itself", async () => {
    await db.execute(sql`alter table schedule_item add constraint lifecycle_request_failure check (kind <> 'request.expire')`);
    try {
      await expect(requested()).rejects.toMatchObject({ cause: { constraint_name: "lifecycle_request_failure" } });
      expect(await db.select().from(project)).toEqual([]);
      expect(await db.select().from(scheduleItem)).toEqual([]);
      expect(await db.select().from(outbox)).toEqual([]);
    } finally {
      await db.execute(sql`alter table schedule_item drop constraint lifecycle_request_failure`);
    }
  });

  it.each(["capture", "delivery", "update", "reply"] as const)("a genuine timer write failure rolls back the whole %s action", async (action) => {
    const fixture = await quoted();
    const { projectId, actor, contactId, fact } = fixture;
    if (action !== "capture") await applyCaptureFact(db, fact);
    if (action === "reply") await submitDelivery(db, createFakeFileStore(), actor, { projectId, note: "Ready", link: "" });
    const beforeProject = await findProjectById(db, projectId);
    const beforeTimers = await timers(projectId);
    const beforeEvents = await db.select().from(outbox).orderBy(outbox.id);
    const beforeMessages = await db.select().from(conversationMessage).orderBy(conversationMessage.id);
    const beforePayments = await db.select().from(payment).orderBy(payment.id);
    const beforeLedger = await db.select().from(ledgerTransfer).orderBy(ledgerTransfer.id);
    vi.setSystemTime(hoursAfter(30));
    const constraint = action === "capture" ? sql`kind <> 'member.updateLate'`
      : action === "delivery" ? sql`kind <> 'client.reviewRemind2'`
      : action === "update" ? sql`kind <> 'member.updateLate' or run_at < '2026-10-28T00:00:00Z'`
      : sql`kind <> 'project.autoComplete' or status <> 'cancelled'`;
    await db.execute(sql`alter table schedule_item add constraint lifecycle_write_failure check (${constraint})`);
    try {
      const attempted = action === "capture" ? applyCaptureFact(db, fact)
        : action === "delivery" ? submitDelivery(db, createFakeFileStore(), actor, { projectId, note: "Ready", link: "" })
        : postConversationMessage(db, action === "update" ? { kind: "member", actor } : { kind: "client", contactId }, { projectId, kind: "text", body: "Checking progress" }, "web");
      await expect(attempted).rejects.toMatchObject({ cause: { constraint_name: "lifecycle_write_failure" } });
      expect(await findProjectById(db, projectId)).toEqual(beforeProject);
      expect(await timers(projectId)).toEqual(beforeTimers);
      expect(await db.select().from(outbox).orderBy(outbox.id)).toEqual(beforeEvents);
      expect(await db.select().from(conversationMessage).orderBy(conversationMessage.id)).toEqual(beforeMessages);
      expect(await db.select().from(payment).orderBy(payment.id)).toEqual(beforePayments);
      expect(await db.select().from(ledgerTransfer).orderBy(ledgerTransfer.id)).toEqual(beforeLedger);
      if (action === "delivery") expect(await db.select().from(delivery)).toEqual([]);
    } finally {
      await db.execute(sql`alter table schedule_item drop constraint lifecycle_write_failure`);
    }
  });

  it("a rejected foreign-team message cannot alter an armed delivery ladder", async () => {
    const fixture = await quoted();
    await applyCaptureFact(db, fixture.fact);
    await submitDelivery(db, createFakeFileStore(), fixture.actor, { projectId: fixture.projectId, note: "Ready", link: "" });
    const before = await timers(fixture.projectId);
    const events = await db.select().from(outbox).orderBy(outbox.id);
    await expect(postConversationMessage(db, { kind: "member", actor: { ...fixture.actor, teamId: "another-team" } }, { projectId: fixture.projectId, kind: "text", body: "Cancel that" }, "web")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await timers(fixture.projectId)).toEqual(before);
    expect(await db.select().from(outbox).orderBy(outbox.id)).toEqual(events);
  });


  it("top-up capture leaves the work window intact and human acceptance retires review steps", async () => {
    const fixture = await quoted();
    await applyCaptureFact(db, fixture.fact);
    const before = await timers(fixture.projectId);
    vi.setSystemTime(hoursAfter(20));
    const { amendmentId } = await proposeAmendment(db, fixture.actor, { projectId: fixture.projectId, add: [{ description: "Icon", amountMinor: 500, extraDays: 0 }], removeItemIds: [] });
    const accepted = await acceptAmendment(db, { projectId: fixture.projectId, amendmentId });
    if (!accepted.topUpPaymentId) throw new Error("Missing top-up");
    const [topUp] = await db.select().from(payment).where(eq(payment.id, accepted.topUpPaymentId));
    if (!topUp) throw new Error("Missing top-up payment");
    await db.update(payment).set({ paypalOrderId: "top-up-order" }).where(eq(payment.id, topUp.id));
    expect(await applyCaptureFact(db, { ...fixture.fact, paymentId: topUp.id, orderId: "top-up-order", captureId: "top-up-capture", amountMinor: topUp.amountMinor, capturedAt: hoursAfter(20) })).toBe("applied");
    expect(await timers(fixture.projectId)).toEqual(before);
    const { deliveryId } = await submitDelivery(db, createFakeFileStore(), fixture.actor, { projectId: fixture.projectId, note: "Complete", link: "" });
    await acceptDelivery(db, { projectId: fixture.projectId, deliveryId });
    expect((await timers(fixture.projectId)).filter((timer) => timer.status === "pending" || timer.status === "paused")).toEqual([]);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(400) })).toEqual({ fired: 0, failed: 0, held: 0 });
  });

  it("a dispute belonging to another team cannot hold this project's timers", async () => {
    const fixture = await quoted();
    const other = await seedServicesTeamWithAdmin(db, { slug: "other" });
    await hold({ teamId: other.teamId, projectId: fixture.projectId });
    await applyCaptureFact(db, fixture.fact);
    expect((await timers(fixture.projectId)).filter((timer) => timer.status === "pending")).toHaveLength(2);
    expect(await runDueScheduleItems({ db, now: () => hoursAfter(42) })).toEqual({ fired: 1, failed: 0, held: 0 });
  });

});
