import { createFakeFileStore } from "@jendal-workspace/core";
import { ensurePublishedRulebook } from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { scheduleItem } from "@jendal-workspace/db/schema/operating-model";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { amendment, delivery, payment, project, quote } from "@jendal-workspace/db/schema/projects";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamMember, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { applyCaptureFact } from "./payments";
import { acceptDelivery, acceptQuote, submitDelivery } from "./projects";
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

  async function delivered(amountMinor: number, manager: "other" | "self" | "none" = "other", split = { teamCutBps: 2000, managerCutBps: 1000 }) {
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
    const { deliveryId } = await submitDelivery(db, createFakeFileStore(), { teamId, actorId: freelancerId, role: "freelancer" }, { projectId, note: "Ready", link: "https://example.com/work" });
    // Only the terminal review timer is due in this test.
    await db.update(scheduleItem).set({ runAt: new Date(Date.now() + 86_400_000) }).where(eq(scheduleItem.subjectId, projectId));
    await db.update(scheduleItem).set({ runAt: new Date(0) }).where(eq(scheduleItem.kind, "project.autoComplete"));
    return { teamId, projectId, quoteId, deliveryId, freelancerId, managerId };
  }

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
