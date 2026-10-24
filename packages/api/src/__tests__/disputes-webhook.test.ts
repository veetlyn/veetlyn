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

  async function capturedProject(): Promise<{ teamId: string; projectId: string }> {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    await ensurePublishedRulebook(db, teamId);
    const projectId = await seedProject(db, { teamId, status: "in_progress" });
    await db.update(projectTable).set({ assignedFreelancerId: userId, rulebookId: `rb_v1_${teamId}` }).where(eq(projectTable.id, projectId));
    await db.insert(payment).values({
      projectId,
      teamId,
      kind: "deposit",
      status: "captured",
      currency: "USD",
      quotePartMinor: 12050,
      managementFeeMinor: 0,
      amountMinor: 12050,
      lines: [],
      paypalCaptureId: "CAP-1",
      capturedAt: new Date(),
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
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent());

    const note = await handlePayPalDisputeWebhook(
      { db, ...DEPS },
      disputeEvent({ eventType: "CUSTOMER.DISPUTE.UPDATED", status: "WAITING_FOR_SELLER_RESPONSE" }),
    );
    expect(note).toBe("dispute waiting_for_seller");
    const [row] = await db.select().from(dispute);
    expect(row).toMatchObject({ status: "waiting_for_seller", teamId });
    expect(await payoutsHeldForDispute(db, teamId)).toBe(true);
  });

  it("resolves seller-favourably: timers resume and payouts unblock", async () => {
    const { teamId } = await capturedProject();
    await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent());

    await handlePayPalDisputeWebhook(
      { db, ...DEPS },
      disputeEvent({ eventType: "CUSTOMER.DISPUTE.RESOLVED", status: "RESOLVED", outcomeCode: "RESOLVED_SELLER_FAVOUR" }),
    );

    const [row] = await db.select().from(dispute);
    expect(row).toMatchObject({ status: "resolved_seller", outcome: "RESOLVED_SELLER_FAVOUR", resolvedAt: expect.any(Date) });
    const [timer] = await db.select().from(scheduleItem);
    expect(timer?.status).toBe("pending");
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

  it("ignores a dispute that names none of this platform's captures", async () => {
    await capturedProject();
    const note = await handlePayPalDisputeWebhook({ db, ...DEPS }, disputeEvent({ sellerTransactionIds: ["NOT-OURS"] }));
    expect(note).toContain("does not name");
    expect(await db.select().from(dispute)).toEqual([]);
  });
});
