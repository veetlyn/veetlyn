import { createFakeFileStore } from "@jendal-workspace/core";
import { ensurePublishedRulebook } from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { memberMark, scheduleItem } from "@jendal-workspace/db/schema/operating-model";
import { projectRefund } from "@jendal-workspace/db/schema/project-refunds";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { amendment, delivery, payment, project, quote } from "@jendal-workspace/db/schema/projects";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamMember, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { applyCaptureFact } from "./payments";
import { acceptDelivery, acceptQuote, decideLateDeliveryRefund, type ProjectActor, setQualityRefund, submitDelivery } from "./projects";
import { runDueScheduleItems } from "./scheduler-sweep";
import { acceptCurrentMemberAgreement } from "../testing/rulebooks";

describe.skipIf(!hasTestDatabase)("delivery settlement", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function capture(paymentId: string) {
    const [row] = await db.select().from(payment).where(eq(payment.id, paymentId));
    if (!row) throw new Error("Missing payment");
    const orderId = `order-${paymentId}`;
    await db.update(payment).set({ paypalOrderId: orderId }).where(eq(payment.id, paymentId));
    expect(await applyCaptureFact(db, {
      paymentId, orderId, captureId: `capture-${paymentId}`, status: "COMPLETED",
      amountMinor: row.amountMinor, currency: row.currency, capturedAt: new Date(),
      paypalFeeMinor: 0, platformFeeMinor: 0, reviewReason: null,
    })).toBe("applied");
  }

  async function delivered(amountMinor: number, manager: "other" | "self" | "none" = "other", split = { teamCutBps: 2000, managerCutBps: 1000 }, daysLate = 0) {
    const { teamId, organizationId, userId } = await seedServicesTeamWithAdmin(db);
    const freelancerId = await seedServicesTeamMember(db, { teamId, organizationId, role: "freelancer" });
    const managerId = manager === "other" ? userId : manager === "self" ? freelancerId : null;
    const rb = await ensurePublishedRulebook(db, teamId);
    await acceptCurrentMemberAgreement(db, teamId, freelancerId);
    const projectId = await seedProject(db, { teamId });
    await db.update(project).set({ rulebookId: rb.id, ...split, managerId }).where(eq(project.id, projectId));
    const quoteId = crypto.randomUUID();
    await db.insert(quote).values({ id: quoteId, teamId, projectId, freelancerId, amountMinor, deliveryDays: 3 });
    const deposit = await acceptQuote(db, { projectId, quoteId });
    await capture(deposit.paymentId);
    if (daysLate > 0) {
      // An hour into the last late day, so the started day counts.
      await db.update(project).set({ deadlineAt: new Date(Date.now() - (daysLate - 1) * 86_400_000 - 3_600_000) }).where(eq(project.id, projectId));
    }
    const { deliveryId } = await submitDelivery(db, createFakeFileStore(), { teamId, actorId: freelancerId, role: "freelancer" }, { projectId, note: "Ready", link: "https://example.com/work" });
    // Only the terminal review timer is due in this test.
    await db.update(scheduleItem).set({ runAt: new Date(Date.now() + 86_400_000) }).where(eq(scheduleItem.subjectId, projectId));
    await db.update(scheduleItem).set({ runAt: new Date(0) }).where(eq(scheduleItem.kind, "project.autoComplete"));
    return { teamId, projectId, quoteId, deliveryId, freelancerId, managerId, adminId: userId };
  }

  const admin = (fixture: { teamId: string; adminId: string }) => ({ teamId: fixture.teamId, actorId: fixture.adminId, role: "admin" as const });

  async function balance(account: string) {
    const rows = await db.select().from(ledgerBalance).where(eq(ledgerBalance.account, account));
    return rows.reduce((sum, row) => sum + row.balanceMinor, 0);
  }

  async function settled(fixture: Awaited<ReturnType<typeof delivered>>, price: number, team: number, manager: number, member: number) {
    expect(await findProjectById(db, fixture.projectId)).toMatchObject({ status: "completed", finalPriceMinor: price });
    expect(await balance(`client_held:${fixture.projectId}`)).toBe(0);
    expect(await balance("team_revenue")).toBe(team);
    expect(await balance(`owed:${fixture.freelancerId}:available`)).toBe(member);
    if (fixture.managerId && fixture.managerId !== fixture.freelancerId) expect(await balance(`owed:${fixture.managerId}:available`)).toBe(manager);
    expect(await db.select().from(delivery).where(eq(delivery.id, fixture.deliveryId))).toEqual([expect.objectContaining({ status: "accepted", decidedAt: expect.any(Date) })]);
    const transfers = await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.reference, `completion:${fixture.projectId}`));
    expect(transfers).toHaveLength(1);
    const events = await db.select().from(outbox).where(eq(outbox.projectId, fixture.projectId));
    expect(events.filter((event) => event.type === "delivery.accepted")).toHaveLength(1);
    expect(events.filter((event) => event.type === "project.completed")).toHaveLength(1);
  }

  it.each(["other", "self", "none"] as const)("settles paid silence acceptance with manager=%s and tolerates repeated timers", async (manager) => {
    const fixture = await delivered(20_000, manager);
    expect(await runDueScheduleItems({ db })).toMatchObject({ failed: 0 });
    await settled(fixture, 20_000, 6000, manager === "other" ? 2000 : 0, manager === "other" ? 14_000 : 16_000);
    await db.update(scheduleItem).set({ status: "pending", runAt: new Date(0) }).where(eq(scheduleItem.kind, "project.autoComplete"));
    expect(await runDueScheduleItems({ db })).toMatchObject({ failed: 0 });
    await expect(acceptDelivery(db, { projectId: fixture.projectId, deliveryId: fixture.deliveryId })).rejects.toThrow();
    await settled(fixture, 20_000, 6000, manager === "other" ? 2000 : 0, manager === "other" ? 14_000 : 16_000);
  });

  it.each(["other", "self", "none"] as const)("creates one payable balance on silence and completes manager=%s on capture", async (manager) => {
    const fixture = await delivered(120_000, manager);
    expect(await runDueScheduleItems({ db })).toMatchObject({ failed: 0 });
    expect(await findProjectById(db, fixture.projectId)).toMatchObject({ status: "awaiting_balance", finalPriceMinor: 120_000 });
    await db.update(scheduleItem).set({ status: "pending", runAt: new Date(0) }).where(eq(scheduleItem.kind, "project.autoComplete"));
    await runDueScheduleItems({ db });
    const invoices = (await db.select().from(payment).where(eq(payment.projectId, fixture.projectId))).filter((row) => row.kind === "balance");
    expect(invoices).toEqual([expect.objectContaining({ status: "pending", quotePartMinor: 60_000, managementFeeMinor: 0, amountMinor: 60_000, lines: [{ kind: "balance", label: "Balance", amountMinor: 60_000 }] })]);
    const invoiceEvents = await db.select().from(outbox).where(eq(outbox.projectId, fixture.projectId));
    expect(invoiceEvents.filter((event) => event.type === "payment.created" && event.data.kind === "balance")).toEqual([
      expect.objectContaining({ data: { paymentId: invoices[0]!.id, kind: "balance", amountMinor: 60_000 } }),
    ]);
    expect(invoiceEvents.filter((event) => event.type === "project.auto_completed")).toEqual([
      expect.objectContaining({ data: { projectId: fixture.projectId, to: "awaiting_balance" } }),
    ]);
    const invoice = invoices[0]!;
    await capture(invoice.id);
    await settled(fixture, 120_000, 36_000, manager === "other" ? 12_000 : 0, manager === "other" ? 84_000 : 96_000);
  });

  it("starts the member's update window when the deposit is captured", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const freelancerId = await seedServicesTeamMember(db, { teamId, organizationId, role: "freelancer" });
    const rb = await ensurePublishedRulebook(db, teamId);
    await acceptCurrentMemberAgreement(db, teamId, freelancerId);
    const projectId = await seedProject(db, { teamId });
    await db.update(project).set({ rulebookId: rb.id }).where(eq(project.id, projectId));
    const quoteId = crypto.randomUUID();
    await db.insert(quote).values({ id: quoteId, teamId, projectId, freelancerId, amountMinor: 20_000, deliveryDays: 3 });
    const deposit = await acceptQuote(db, { projectId, quoteId });
    expect((await db.select().from(scheduleItem).where(eq(scheduleItem.subjectId, projectId))).map((row) => row.kind)).not.toContain("member.updateLate");

    const before = Date.now();
    await capture(deposit.paymentId);
    const pending = (await db.select().from(scheduleItem).where(eq(scheduleItem.subjectId, projectId))).filter((row) => row.status === "pending");
    const late = pending.find((row) => row.kind === "member.updateLate");
    expect(pending.map((row) => row.kind)).toEqual(expect.arrayContaining(["member.updateRemind", "member.updateLate"]));
    expect(late!.runAt.getTime()).toBeGreaterThanOrEqual(before + rb.spec.updateWindow.hours * 3_600_000 - 1_000);
  });

  it("proposes a late-delivery refund without moving money, and a confirmed one comes out of the member's share", async () => {
    const fixture = await delivered(20_000, "other", undefined, 3);
    // The agency rules: 2% a day for 3 days on $200.00.
    expect(await findProjectById(db, fixture.projectId)).toMatchObject({ lateRefundStatus: "pending", lateRefundDaysLate: 3, lateRefundProposedMinor: 1_200 });
    expect(await db.select().from(memberMark).where(eq(memberMark.projectId, fixture.projectId))).toEqual([
      expect.objectContaining({ memberUserId: fixture.freelancerId, kind: "late_delivery" }),
    ]);
    expect(await balance(`client_held:${fixture.projectId}`)).toBe(20_000);

    await expect(
      decideLateDeliveryRefund(db, { teamId: fixture.teamId, actorId: fixture.freelancerId, role: "freelancer" }, { projectId: fixture.projectId, decision: "confirm" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await decideLateDeliveryRefund(db, admin(fixture), { projectId: fixture.projectId, decision: "confirm" });
    await expect(decideLateDeliveryRefund(db, admin(fixture), { projectId: fixture.projectId, decision: "waive" })).rejects.toThrow(/no late-delivery refund waiting/i);

    await acceptDelivery(db, { projectId: fixture.projectId, deliveryId: fixture.deliveryId });
    // The team and manager keep 20% and 10% of $200.00 (team revenue also holds the $20.00 fee); the member's
    // $140.00 pays the $12.00.
    await settled(fixture, 18_800, 6_000, 2_000, 12_800);
    expect(await db.select().from(projectRefund).where(eq(projectRefund.projectId, fixture.projectId))).toEqual([
      expect.objectContaining({ amountMinor: 1_200 }),
    ]);
  });

  it("keeps the full price when the late refund is waived, and proposes nothing for an on-time delivery", async () => {
    const late = await delivered(20_000, "other", undefined, 3);
    await decideLateDeliveryRefund(db, admin(late), { projectId: late.projectId, decision: "waive" });
    await acceptDelivery(db, { projectId: late.projectId, deliveryId: late.deliveryId });
    await settled(late, 20_000, 6_000, 2_000, 14_000);

    await truncateAll(db);
    const onTime = await delivered(20_000);
    expect(await findProjectById(db, onTime.projectId)).toMatchObject({ lateRefundStatus: null, lateRefundProposedMinor: null });
    expect(await db.select().from(memberMark)).toEqual([]);
  });

  it("takes a confirmed late refund from the balance and the member's share when the balance completes the project", async () => {
    const fixture = await delivered(120_000, "other", undefined, 2);
    await decideLateDeliveryRefund(db, admin(fixture), { projectId: fixture.projectId, decision: "confirm" });
    await acceptDelivery(db, { projectId: fixture.projectId, deliveryId: fixture.deliveryId });
    // 4% of $1,200.00 is $48.00 off the $600.00 balance.
    const [invoice] = (await db.select().from(payment).where(eq(payment.projectId, fixture.projectId))).filter((row) => row.kind === "balance");
    expect(invoice).toMatchObject({ amountMinor: 55_200 });
    await capture(invoice!.id);
    await settled(fixture, 115_200, 36_000, 12_000, 79_200);
  });

  it("refuses a quality refund above the phase cap and lowers the final price for everyone within it", async () => {
    const fixture = await delivered(20_000);
    const set = (amountMinor: number, actor: ProjectActor = admin(fixture)) => setQualityRefund(db, actor, { projectId: fixture.projectId, amountMinor });
    await expect(set(5_000, { teamId: fixture.teamId, actorId: fixture.freelancerId, role: "freelancer" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // After delivery the agency rules cap it at 25% of the $200.00 price.
    await expect(set(5_001)).rejects.toThrow(/REFUND_EXCEEDS_RULEBOOK_CAP.*\$50\.00/);
    await set(5_000);
    await set(4_000);
    expect(await balance(`client_held:${fixture.projectId}`)).toBe(20_000);
    // The member's quality mark is recorded once, however often the amount changes.
    expect(await db.select().from(memberMark).where(eq(memberMark.projectId, fixture.projectId))).toEqual([
      expect.objectContaining({ memberUserId: fixture.freelancerId, kind: "quality_refund" }),
    ]);
    await set(5_000);

    await acceptDelivery(db, { projectId: fixture.projectId, deliveryId: fixture.deliveryId });
    await settled(fixture, 15_000, 5_000, 1_500, 10_500);
  });

  it("caps a quality refund during the work at the in-progress share", async () => {
    const { teamId, organizationId, userId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const rb = await ensurePublishedRulebook(db, teamId);
    await db.update(project).set({ rulebookId: rb.id, status: "in_progress" }).where(eq(project.id, projectId));
    const freelancerId = await seedServicesTeamMember(db, { teamId, organizationId, role: "freelancer" });
    await db.insert(quote).values({ teamId, projectId, freelancerId, amountMinor: 20_000, deliveryDays: 3, status: "accepted" });
    const actor = { teamId, actorId: userId, role: "admin" as const };

    await expect(setQualityRefund(db, actor, { projectId, amountMinor: 10_001 })).rejects.toThrow(/REFUND_EXCEEDS_RULEBOOK_CAP.*\$100\.00/);
    await setQualityRefund(db, actor, { projectId, amountMinor: 10_000 });
    expect(await findProjectById(db, projectId)).toMatchObject({ qualityRefundMinor: 10_000, qualityRefundSetBy: userId });
  });

  it.each(["other", "self"] as const)("immediate human acceptance settles manager=%s equivalently", async (manager) => {
    const fixture = await delivered(20_000, manager);
    await acceptDelivery(db, { projectId: fixture.projectId, deliveryId: fixture.deliveryId });
    await settled(fixture, 20_000, 6000, manager === "other" ? 2000 : 0, manager === "other" ? 14_000 : 16_000);
  });


  it.each([
    { price: 1, teamCutBps: 5000, managerCutBps: 5000, team: 1, manager: 0, member: 0 },
    { price: 1, teamCutBps: 0, managerCutBps: 0, team: 0, manager: 0, member: 1 },
  ])("posts valid tiny-price allocation for $price cents with team=$teamCutBps", async ({ price, teamCutBps, managerCutBps, team, manager, member }) => {
    const fixture = await delivered(price, "other", { teamCutBps, managerCutBps });
    expect(await runDueScheduleItems({ db })).toMatchObject({ failed: 0 });
    await settled(fixture, price, team, manager, member);
  });

  it.each([
    { price: 20_000, team: 6000, manager: 2000, member: 14_000 },
    { price: 120_000, team: 36_000, manager: 12_000, member: 84_000 },
  ])("settles once when client acceptance races silence for $price cents", async ({ price, team, manager, member }) => {
    const fixture = await delivered(price);
    const results = await Promise.allSettled([
      acceptDelivery(db, { projectId: fixture.projectId, deliveryId: fixture.deliveryId }),
      runDueScheduleItems({ db }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const invoices = (await db.select().from(payment).where(eq(payment.projectId, fixture.projectId))).filter((row) => row.kind === "balance");
    expect(invoices).toHaveLength(price === 120_000 ? 1 : 0);
    if (invoices[0]) await capture(invoices[0].id);
    await settled(fixture, price, team, manager, member);
  });


  it.each([{ price: 20_000, held: 20_000 }, { price: 120_000, held: 60_000 }])("rolls back settlement for $price cents when its occurrence cannot complete", async ({ price, held }) => {
    const fixture = await delivered(price);
    await db.execute(sql`alter table schedule_item add constraint settlement_test_completion check (kind <> 'project.autoComplete' or status <> 'done')`);
    try {
      expect(await runDueScheduleItems({ db })).toEqual({ fired: 0, failed: 1, held: 0 });
      expect(await findProjectById(db, fixture.projectId)).toMatchObject({ status: "delivered", finalPriceMinor: null });
      expect(await balance(`client_held:${fixture.projectId}`)).toBe(held);
      expect((await db.select().from(payment)).filter((row) => row.kind === "balance")).toEqual([]);
      expect((await db.select().from(ledgerTransfer)).filter((row) => row.kind === "completion")).toEqual([]);
      expect(await db.select().from(delivery)).toEqual([expect.objectContaining({ status: "submitted" })]);
      expect((await db.select().from(outbox)).filter((row) => row.type === "delivery.accepted" || row.type === "project.completed")).toEqual([]);
      expect((await db.select().from(scheduleItem)).filter((row) => row.kind === "project.autoComplete")).toEqual([
        expect.objectContaining({ status: "failed", attempts: 1, lastError: expect.any(String) }),
      ]);
    } finally {
      await db.execute(sql`alter table schedule_item drop constraint settlement_test_completion`);
    }
  });

  it("keeps abandonment separate from acceptance and settlement", async () => {
    const fixture = await delivered(20_000);
    await db.update(scheduleItem).set({ kind: "project.abandon" }).where(eq(scheduleItem.kind, "project.autoComplete"));
    expect(await runDueScheduleItems({ db })).toMatchObject({ failed: 0 });
    expect(await findProjectById(db, fixture.projectId)).toMatchObject({ status: "abandoned", finalPriceMinor: null });
    expect(await balance(`client_held:${fixture.projectId}`)).toBe(20_000);
    const events = await db.select().from(outbox).where(eq(outbox.projectId, fixture.projectId));
    expect(events.filter((event) => event.type === "project.abandoned")).toHaveLength(1);
    expect(events.filter((event) => event.type === "delivery.accepted" || event.type === "project.completed")).toHaveLength(0);
  });

  it.each(["amendment", "pending", "failed"] as const)("blocks silence acceptance for %s despite a fully paid quote", async (guard) => {
    const fixture = await delivered(20_000);
    if (guard === "amendment") {
      await db.insert(amendment).values({ projectId: fixture.projectId, teamId: fixture.teamId, baseQuoteId: fixture.quoteId, proposedById: fixture.managerId, newAmountMinor: 21_000, deltaMinor: 1000, addItems: [], removeItemIds: [] });
    } else {
      await db.insert(payment).values({ projectId: fixture.projectId, teamId: fixture.teamId, kind: "top_up", status: guard, currency: "USD", quotePartMinor: 100, managementFeeMinor: 10, amountMinor: 110, lines: [] });
    }
    await expect(acceptDelivery(db, { projectId: fixture.projectId, deliveryId: fixture.deliveryId })).rejects.toThrow(
      guard === "amendment" ? "An amendment is waiting for the client's answer." : "The top-up for the last amendment is not paid yet.",
    );
    expect(await runDueScheduleItems({ db })).toMatchObject({ failed: 1 });
    expect(await findProjectById(db, fixture.projectId)).toMatchObject({ status: "delivered", finalPriceMinor: null });
    expect(await balance(`client_held:${fixture.projectId}`)).toBe(20_000);
    expect(await db.select().from(delivery).where(eq(delivery.id, fixture.deliveryId))).toEqual([expect.objectContaining({ status: "submitted" })]);
    expect((await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.projectId, fixture.projectId))).filter((row) => row.kind === "completion")).toHaveLength(0);
  });
});
