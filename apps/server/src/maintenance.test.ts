import { findFileUpload, insertFileUpload } from "@jendal-workspace/db/repositories/files";
import { findOrderById } from "@jendal-workspace/db/repositories/orders";
import { findWebhookEvent } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { insertActionLog } from "@jendal-workspace/db/repositories/action-log";
import { actionLog } from "@jendal-workspace/db/schema/action-log";
import { requestLimit } from "@jendal-workspace/db/schema/limits";
import { paypalWebhookEvent } from "@jendal-workspace/db/schema/paypal-webhooks";
import {
  createTestDb,
  hasTestDatabase,
  seedOrder,
  seedProduct,
  seedProject,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { log } from "evlog";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MaintenanceDeps, runMaintenance } from "./maintenance";

const NOW = new Date("2026-03-01T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const DAY_MINUTES = 24 * 60;

describe.skipIf(!hasTestDatabase)("runMaintenance", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => db.$client.end());

  function deps(overrides: Partial<MaintenanceDeps> = {}) {
    return {
      db,
      enqueueWebhookEvents: vi.fn<MaintenanceDeps["enqueueWebhookEvents"]>(async () => {}),
      files: { delete: vi.fn<MaintenanceDeps["files"]["delete"]>(async () => {}) },
      now: () => NOW,
      ...overrides,
    };
  }

  // Each payout sweep notes its name in `ran` when it runs.
  function payoutSweeps(ran: string[]) {
    return {
      createProjectPayouts: vi.fn(async () => {
        ran.push("createProjectPayouts");
        return { created: 1 };
      }),
      sendPayouts: vi.fn(async () => {
        ran.push("sendPayouts");
        return { sent: 2, held: 1 };
      }),
      settlePayouts: vi.fn(async () => {
        ran.push("settlePayouts");
        return { checked: 3, settled: 2 };
      }),
    };
  }

  async function seedEvent(id: string, receivedAt: Date) {
    await db.insert(paypalWebhookEvent).values({
      id,
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceType: "capture",
      resourceId: "CAPTURE1",
      customId: "pay-1",
      orderId: "ORDER1",
      merchantId: "SELLER1",
      receivedAt,
    });
  }

  async function seedUploadsAndOrders() {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const upload = (createdAt: Date, attachedAt?: Date) =>
      insertFileUpload(db, {
        teamId,
        projectId,
        purpose: "delivery",
        r2Key: `teams/${teamId}/files/${crypto.randomUUID()}`,
        fileName: "brand.zip",
        contentType: "application/zip",
        sizeBytes: 42,
        createdAt,
        attachedAt,
      });
    const product = await seedProduct(db, { storeId: teamId, kind: "digital", status: "published", priceMinor: 1900 });
    const order = (createdAt: Date) => seedOrder(db, { teamId, productId: product.id, createdAt });
    return {
      abandonedOrder: await order(minutesAgo(4 * DAY_MINUTES + 1)),
      recentOrder: await order(minutesAgo(3 * DAY_MINUTES)),
      leftover: await upload(minutesAgo(2 * DAY_MINUTES)),
      attached: await upload(minutesAgo(2 * DAY_MINUTES), minutesAgo(2 * DAY_MINUTES - 1)),
      recent: await upload(minutesAgo(60)),
    };
  }

  async function seedEverything() {
    await seedEvent("WH-stale", minutesAgo(20));
    await seedEvent("WH-fresh", minutesAgo(5));
    await seedEvent("WH-stuck", minutesAgo(4 * DAY_MINUTES));
    await db.insert(requestLimit).values([
      { key: "expired", windowStart: minutesAgo(DAY_MINUTES + 1).getTime(), count: 3 },
      { key: "current", windowStart: minutesAgo(10).getTime(), count: 1 },
    ]);
    return seedUploadsAndOrders();
  }

  async function requestLimitKeys() {
    const rows = await db.select({ key: requestLimit.key }).from(requestLimit);
    return rows.map((row) => row.key);
  }

  it("re-sends stale events, fails stuck ones, and deletes expired limits, leftover uploads and abandoned orders", async () => {
    const { leftover, attached, recent, abandonedOrder, recentOrder } = await seedEverything();
    const info = vi.spyOn(log, "info");
    const error = vi.spyOn(log, "error");
    const ran: string[] = [];
    const d = deps(payoutSweeps(ran));

    const report = await runMaintenance(d);

    expect(report).toEqual({
      webhookEventsRequeued: 1,
      webhookEventsFailed: 1,
      requestLimitsDeleted: 1,
      actionLogDeleted: 0,
      uploadsDeleted: 1,
      ordersDeleted: 1,
      projectPayoutsCreated: 1,
      payoutsSent: 2,
      payoutsChecked: 3,
      payoutsSettled: 2,
      errors: [],
    });
    expect(ran).toEqual(["createProjectPayouts", "sendPayouts", "settlePayouts"]);
    expect(d.enqueueWebhookEvents).toHaveBeenCalledExactlyOnceWith(["WH-stale"]);
    expect(await findWebhookEvent(db, "WH-stuck")).toMatchObject({
      status: "failed",
      note: "Stuck in received for 3 days.",
    });
    expect(await findWebhookEvent(db, "WH-fresh")).toMatchObject({ status: "received" });
    expect(await findWebhookEvent(db, "WH-stale")).toMatchObject({ status: "received" });
    expect(await requestLimitKeys()).toEqual(["current"]);
    expect(d.files.delete).toHaveBeenCalledExactlyOnceWith([leftover.r2Key]);
    expect(await findFileUpload(db, leftover.id)).toBeNull();
    expect(await findFileUpload(db, attached.id)).not.toBeNull();
    expect(await findFileUpload(db, recent.id)).not.toBeNull();
    expect(await findOrderById(db, abandonedOrder.id)).toBeNull();
    expect(await findOrderById(db, recentOrder.id)).not.toBeNull();
    expect(info).toHaveBeenCalledWith({ action: "maintenance.webhooks", maintenance: { requeued: 1, failed: 1 } });
    expect(error).toHaveBeenCalledExactlyOnceWith({
      action: "maintenance.webhooks.failed",
      paypalWebhook: {
        eventIds: ["WH-stuck"],
        eventTypes: ["PAYMENT.CAPTURE.COMPLETED"],
        note: "Stuck in received for 3 days.",
      },
    });
    expect(info).toHaveBeenCalledWith({ action: "maintenance.requestLimits", maintenance: { deleted: 1 } });
    expect(info).toHaveBeenCalledWith({ action: "maintenance.uploads", maintenance: { deleted: 1 } });
    expect(info).toHaveBeenCalledWith({ action: "maintenance.orders", maintenance: { deleted: 1 } });
    expect(info).toHaveBeenCalledWith({ action: "maintenance.projectPayouts", maintenance: { created: 1 } });
    expect(info).toHaveBeenCalledWith({ action: "maintenance.payoutSends", maintenance: { sent: 2, held: 1 } });
    expect(info).toHaveBeenCalledWith({ action: "maintenance.payouts", maintenance: { checked: 3, settled: 2 } });
  });

  it("deletes action log rows older than 180 days", async () => {
    const logRow = (requestId: string, days: number) =>
      insertActionLog(db, {
        requestId,
        createdAt: minutesAgo(days * DAY_MINUTES),
        action: "project.quote.send",
        surface: "web",
        actorKind: "user",
        actorId: "user-1",
        outcome: "ok",
        durationMs: 12,
      });
    await logRow("expired", 181);
    await logRow("kept", 179);

    const report = await runMaintenance(deps());

    expect(report).toMatchObject({ actionLogDeleted: 1, errors: [] });
    const rows = await db.select({ requestId: actionLog.requestId }).from(actionLog);
    expect(rows.map((row) => row.requestId)).toEqual(["kept"]);
  });

  it("does not enqueue when no event is stale", async () => {
    await seedEvent("WH-fresh", minutesAgo(5));
    const d = deps();

    expect(await runMaintenance(d)).toMatchObject({ webhookEventsRequeued: 0, errors: [] });
    expect(d.enqueueWebhookEvents).not.toHaveBeenCalled();
    expect(d.files.delete).not.toHaveBeenCalled();
  });

  it("keeps sweeping when re-sending the events fails", async () => {
    const { leftover, abandonedOrder } = await seedEverything();
    const error = vi.spyOn(log, "error");
    const d = deps({
      enqueueWebhookEvents: vi.fn(async () => {
        throw new TypeError("Queue send failed");
      }),
    });

    const report = await runMaintenance(d);

    expect(report).toMatchObject({ requestLimitsDeleted: 1, uploadsDeleted: 1, ordersDeleted: 1, errors: ["webhooks"] });
    expect(await requestLimitKeys()).toEqual(["current"]);
    expect(await findFileUpload(db, leftover.id)).toBeNull();
    expect(await findOrderById(db, abandonedOrder.id)).toBeNull();
    expect(error).toHaveBeenCalledWith({
      action: "maintenance.webhooks",
      error: { name: "TypeError", note: "TypeError: Queue send failed" },
    });
  });

  it.each([
    { sweep: "projectPayouts", dep: "createProjectPayouts", others: ["sendPayouts", "settlePayouts"] },
    { sweep: "payoutSends", dep: "sendPayouts", others: ["createProjectPayouts", "settlePayouts"] },
    { sweep: "payouts", dep: "settlePayouts", others: ["createProjectPayouts", "sendPayouts"] },
  ] as const)("records a failed $sweep sweep in the report and still runs the other payout sweeps", async (row) => {
    const error = vi.spyOn(log, "error");
    const ran: string[] = [];
    const d = deps({
      ...payoutSweeps(ran),
      [row.dep]: vi.fn(async () => {
        throw new TypeError("Database unavailable");
      }),
    });

    expect(await runMaintenance(d)).toMatchObject({ errors: [row.sweep] });
    expect(ran).toEqual(row.others);
    expect(error).toHaveBeenCalledWith({
      action: `maintenance.${row.sweep}`,
      error: { name: "TypeError", note: "TypeError: Database unavailable" },
    });
  });

  it("keeps the uploads when deleting their objects fails", async () => {
    const { leftover } = await seedEverything();
    const error = vi.spyOn(log, "error");
    const d = deps({
      files: {
        delete: vi.fn(async () => {
          throw new Error("R2 unavailable");
        }),
      },
    });

    const report = await runMaintenance(d);

    expect(report).toMatchObject({
      webhookEventsRequeued: 1,
      requestLimitsDeleted: 1,
      uploadsDeleted: 0,
      ordersDeleted: 1,
      errors: ["uploads"],
    });
    expect(await findFileUpload(db, leftover.id)).not.toBeNull();
    expect(error).toHaveBeenCalledWith({
      action: "maintenance.uploads",
      error: { name: "Error", note: "Error: R2 unavailable" },
    });
  });
});
