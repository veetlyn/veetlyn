import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { type PayPalWebhookEventStatus, paypalWebhookEvent } from "../schema/paypal-webhooks";
import { createTestDb, hasTestDatabase, truncateAll } from "../testing/db";
import {
  failStuckWebhookEvents,
  findWebhookEvent,
  finishWebhookEvent,
  listStaleWebhookEvents,
  noteWebhookAttempt,
  recordWebhookEvent,
} from "./paypal-webhooks";

const EVENT = {
  id: "WH-1",
  eventType: "PAYMENT.CAPTURE.COMPLETED",
  resourceType: "capture",
  resourceId: "CAPTURE1",
  customId: "pay-1",
  orderId: "ORDER1",
  merchantId: "SELLER1",
};

describe.skipIf(!hasTestDatabase)("paypal webhook events", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("records an event once and reports the stored status on redelivery", async () => {
    expect(await recordWebhookEvent(db, EVENT)).toBe("received");
    await finishWebhookEvent(db, "WH-1", { status: "processed", note: "applied" });
    expect(await recordWebhookEvent(db, { ...EVENT, eventType: "CHANGED" })).toBe("processed");
    expect(await findWebhookEvent(db, "WH-1")).toMatchObject({
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      status: "processed",
      note: "applied",
      processedAt: expect.any(Date),
    });
  });

  it("counts attempts and keeps the last error", async () => {
    await recordWebhookEvent(db, EVENT);
    expect(await noteWebhookAttempt(db, "WH-1", "PayPal 503")).toBe(1);
    expect(await noteWebhookAttempt(db, "WH-1", "PayPal 503 again")).toBe(2);
    expect(await findWebhookEvent(db, "WH-1")).toMatchObject({ status: "received", attempts: 2, note: "PayPal 503 again" });
    expect(await findWebhookEvent(db, "WH-404")).toBeNull();
  });

  it("leaves a finished event alone when a slower retry finishes it or notes an attempt", async () => {
    await recordWebhookEvent(db, EVENT);
    await noteWebhookAttempt(db, "WH-1", "PayPal 503");
    expect(await finishWebhookEvent(db, "WH-1", { status: "processed", note: "applied" })).toBe(true);
    expect(await finishWebhookEvent(db, "WH-1", { status: "failed", note: "out of retries" })).toBe(false);
    expect(await noteWebhookAttempt(db, "WH-1", "PayPal 503 again")).toBeNull();
    expect(await findWebhookEvent(db, "WH-1")).toMatchObject({ status: "processed", note: "applied", attempts: 1 });
  });

  it("keeps notes to 500 characters", async () => {
    await recordWebhookEvent(db, EVENT);
    await noteWebhookAttempt(db, "WH-1", "x".repeat(600));
    expect((await findWebhookEvent(db, "WH-1"))?.note).toHaveLength(500);
    await finishWebhookEvent(db, "WH-1", { status: "parked", note: "y".repeat(600) });
    expect((await findWebhookEvent(db, "WH-1"))?.note).toBe("y".repeat(500));
  });

  describe("sweeps", () => {
    const NOW = new Date("2026-03-01T12:00:00Z");
    const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

    async function seedEvent(id: string, receivedAt: Date, status: PayPalWebhookEventStatus = "received") {
      await db.insert(paypalWebhookEvent).values({ ...EVENT, id, receivedAt, status });
    }

    it("lists received events older than the cutoff, oldest first, up to the limit", async () => {
      await seedEvent("WH-new", minutesAgo(5));
      await seedEvent("WH-20", minutesAgo(20));
      await seedEvent("WH-60", minutesAgo(60));
      await seedEvent("WH-30", minutesAgo(30));
      await seedEvent("WH-processed", minutesAgo(90), "processed");
      await seedEvent("WH-parked", minutesAgo(90), "parked");

      expect(await listStaleWebhookEvents(db, { receivedBefore: minutesAgo(15), limit: 10 })).toEqual([
        "WH-60",
        "WH-30",
        "WH-20",
      ]);
      expect(await listStaleWebhookEvents(db, { receivedBefore: minutesAgo(15), limit: 2 })).toEqual(["WH-60", "WH-30"]);
    });

    it("fails received events older than the cutoff and leaves the rest alone", async () => {
      await seedEvent("WH-old", minutesAgo(5_000));
      await seedEvent("WH-older", minutesAgo(6_000));
      await seedEvent("WH-recent", minutesAgo(20));
      await seedEvent("WH-processed", minutesAgo(6_000), "processed");

      const failed = await failStuckWebhookEvents(db, { receivedBefore: minutesAgo(4_320), note: "Stuck." });
      expect(failed.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: "WH-old", eventType: "PAYMENT.CAPTURE.COMPLETED" },
        { id: "WH-older", eventType: "PAYMENT.CAPTURE.COMPLETED" },
      ]);

      for (const id of ["WH-old", "WH-older"]) {
        expect(await findWebhookEvent(db, id)).toMatchObject({ status: "failed", note: "Stuck.", processedAt: expect.any(Date) });
      }
      expect(await findWebhookEvent(db, "WH-recent")).toMatchObject({ status: "received", note: null, processedAt: null });
      expect(await findWebhookEvent(db, "WH-processed")).toMatchObject({ status: "processed", note: null });
      expect(await failStuckWebhookEvents(db, { receivedBefore: minutesAgo(4_320), note: "Stuck." })).toEqual([]);
    });
  });
});
