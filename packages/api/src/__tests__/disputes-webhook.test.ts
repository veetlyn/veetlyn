import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ensurePublishedRulebook } from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { dispute, outboxDelivery, scheduleItem } from "@jendal-workspace/db/schema/operating-model";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { payment, project as projectTable } from "@jendal-workspace/db/schema/projects";
import {
  createTestDb,
  hasTestDatabase,
  seedProject,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import type { PayPalDisputeWebhook } from "@jendal-workspace/paypal";

import { handlePayPalDisputeWebhook, payoutsHeldForDispute } from "../use-cases/disputes";

const DEPS = { alertEmail: "disputes@example.com", dashOrigin: "https://dash.example.com" };

function disputeEvent(overrides: Partial<PayPalDisputeWebhook> = {}): PayPalDisputeWebhook {
  return {
    id: "WH-D1",
    eventType: "CUSTOMER.DISPUTE.CREATED",
    disputeId: "PP-D-1234",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "OPEN",
    disputeState: null,
    amountMinor: 12050,
    currency: "USD",
    sellerTransactionIds: ["CAP-1"],
    buyerTransactionIds: ["BUY-1"],
    lifeCycleStage: "INQUIRY",
    outcomeCode: null,
    ...overrides,
  };
}

describe.skipIf(!hasTestDatabase)("dispute webhooks", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function capturedProject(status: "captured" | "pending" = "captured"): Promise<{ teamId: string; projectId: string }> {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    await ensurePublishedRulebook(db, teamId);
    const projectId = await seedProject(db, { teamId, status: "in_progress" });
    await db.update(projectTable).set({ assignedFreelancerId: userId, rulebookId: `rb_v1_${teamId}` }).where(eq(projectTable.id, projectId));
    await db.insert(payment).values({
      projectId,
      teamId,
      kind: "deposit",
      status,
      currency: "USD",
      quotePartMinor: 12050,
      managementFeeMinor: 0,
      amountMinor: 12050,
      lines: [],
      paypalCaptureId: "CAP-1",
      capturedAt: status === "captured" ? new Date() : null,
    });
    await db.insert(scheduleItem).values({ teamId, subjectId: projectId, kind: "member.updateLate", runAt: new Date(Date.now() + 86_400_000) });
    return { teamId, projectId };
  }

  it("opens a case, pauses timers, alerts the team and holds payouts", async () => {
    const { teamId, projectId } = await capturedProject();

    const note = await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent());
    expect(note).toContain("timers paused");

    const [row] = await db.select().from(dispute);
    expect(row).toMatchObject({ teamId, projectId, status: "open", amountMinor: 12050, paypalDisputeId: "PP-D-1234" });

    const [timer] = await db.select().from(scheduleItem);
    expect(timer?.status).toBe("paused");

    const [event] = await db.select().from(outbox).where(eq(outbox.type, "dispute.opened"));
    expect(event).toMatchObject({ teamId, projectId: null });
    const [alert] = await db.select().from(outboxDelivery);
    expect(alert).toMatchObject({ channel: "email_dispute", recipient: "disputes@example.com" });

    expect(await payoutsHeldForDispute(db, teamId)).toBe(true);
  });

  it("updates the case status from PayPal's answer", async () => {
    const { teamId } = await capturedProject();
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ amountMinor: null, currency: null }));
    expect(await db.select().from(dispute)).toEqual([expect.objectContaining({ amountMinor: null, currency: null })]);

    const note = await handlePayPalDisputeWebhook(
      { db, ...DEPS },
      disputeEvent({ eventType: "CUSTOMER.DISPUTE.UPDATED", status: "WAITING_FOR_SELLER_RESPONSE" }),
    );
    expect(note).toBe("dispute waiting_for_seller");
    const [row] = await db.select().from(dispute);
    expect(row).toMatchObject({ status: "waiting_for_seller", teamId, amountMinor: 12050, currency: "USD" });
    expect(await payoutsHeldForDispute(db, teamId)).toBe(true);
  });

  it("resolves seller-favourably: timers resume and payouts unblock", async () => {
    const { teamId } = await capturedProject();
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent());
    await db.update(payment).set({ status: "refunded", refundedMinor: 12050 }).where(eq(payment.teamId, teamId));

    await handlePayPalDisputeWebhook(
      { db, ...DEPS },
      disputeEvent({ eventType: "CUSTOMER.DISPUTE.RESOLVED", status: "RESOLVED", outcomeCode: "RESOLVED_SELLER_FAVOUR", sellerTransactionIds: [] }),
    );

    const [row] = await db.select().from(dispute);
    expect(row).toMatchObject({ status: "resolved_seller", outcome: "RESOLVED_SELLER_FAVOUR", resolvedAt: expect.any(Date) });
    const [timer] = await db.select().from(scheduleItem);
    expect(timer?.status).toBe("pending");
    expect(await payoutsHeldForDispute(db, teamId)).toBe(false);
  });

  it("enriches missing resolved-case money from late events without reopening or alerting", async () => {
    const { teamId } = await capturedProject();
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({
      eventType: "CUSTOMER.DISPUTE.RESOLVED",
      outcomeCode: "RESOLVED_SELLER_FAVOUR",
      amountMinor: null,
      currency: null,
    }));
    const [resolved] = await db.select().from(dispute);
    expect(resolved).toMatchObject({ status: "resolved_seller", amountMinor: null, currency: null });
    const timers = await db.select().from(scheduleItem);
    const events = await db.select().from(outbox);
    const alerts = await db.select().from(outboxDelivery);

    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent());
    expect(await db.select().from(dispute)).toEqual([
      { ...resolved, amountMinor: 12050, currency: "USD" },
    ]);
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({
      eventType: "CUSTOMER.DISPUTE.UPDATED",
      amountMinor: 99999,
      currency: "EUR",
    }));
    expect(await db.select().from(dispute)).toEqual([
      { ...resolved, amountMinor: 12050, currency: "USD" },
    ]);
    expect(await db.select().from(scheduleItem)).toEqual(timers);
    expect(await db.select().from(outbox)).toEqual(events);
    expect(await db.select().from(outboxDelivery)).toEqual(alerts);
    expect(await payoutsHeldForDispute(db, teamId)).toBe(false);
  });

  it("resolves buyer-favourably: the ladder ends and the project stays as it was", async () => {
    const { projectId } = await capturedProject();
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent());

    await handlePayPalDisputeWebhook(
      { db, ...DEPS },
      disputeEvent({ eventType: "CUSTOMER.DISPUTE.RESOLVED", status: "RESOLVED", outcomeCode: "RESOLVED_BUYER_FAVOUR" }),
    );

    const [row] = await db.select().from(dispute);
    expect(row).toMatchObject({ status: "resolved_buyer" });
    const timers = await db.select().from(scheduleItem);
    expect(timers.filter((timer) => timer.status === "pending")).toEqual([]);
    expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
  });

  it("keeps timers paused until every case resolves and ignores a late reopening event", async () => {
    const { teamId } = await capturedProject();
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ disputeId: "CASE-A" }));
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ disputeId: "CASE-B" }));
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ disputeId: "CASE-A", eventType: "CUSTOMER.DISPUTE.RESOLVED", outcomeCode: "RESOLVED_SELLER_FAVOUR" }));
    expect(await db.select().from(scheduleItem)).toEqual([expect.objectContaining({ status: "paused" })]);
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ disputeId: "CASE-A" }));
    expect(await db.select().from(dispute).where(eq(dispute.paypalDisputeId, "CASE-A"))).toEqual([expect.objectContaining({ status: "resolved_seller" })]);
    expect(await payoutsHeldForDispute(db, teamId)).toBe(true);
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ disputeId: "CASE-B", eventType: "CUSTOMER.DISPUTE.RESOLVED", outcomeCode: "RESOLVED_SELLER_FAVOUR" }));
    expect(await db.select().from(scheduleItem)).toEqual([expect.objectContaining({ status: "pending" })]);
    expect(await payoutsHeldForDispute(db, teamId)).toBe(false);
  });

  it("holds a case whose update arrived first and whose resolution outcome is unknown", async () => {
    const { teamId } = await capturedProject();
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ eventType: "CUSTOMER.DISPUTE.UPDATED", status: "UNDER_REVIEW" }));
    expect(await db.select().from(scheduleItem)).toEqual([expect.objectContaining({ status: "paused" })]);
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ eventType: "CUSTOMER.DISPUTE.RESOLVED", outcomeCode: "RESOLVED_WITH_PAYOUT" }));
    expect(await db.select().from(dispute)).toEqual([expect.objectContaining({ status: "under_review", resolvedAt: null })]);
    expect(await payoutsHeldForDispute(db, teamId)).toBe(true);
    expect(await db.select().from(scheduleItem)).toEqual([expect.objectContaining({ status: "paused" })]);
  });

  it("opens a case on a capture PayPal reported as pending", async () => {
    const { teamId, projectId } = await capturedProject("pending");

    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent());

    expect(await db.select().from(dispute)).toEqual([expect.objectContaining({ teamId, projectId, status: "open" })]);
    expect(await payoutsHeldForDispute(db, teamId)).toBe(true);
  });

  it("ignores a dispute that names none of this platform's captures", async () => {
    await capturedProject();
    const note = await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ sellerTransactionIds: ["NOT-OURS"] }));
    expect(note).toContain("does not name");
    expect(await db.select().from(dispute)).toEqual([]);
  });
});
