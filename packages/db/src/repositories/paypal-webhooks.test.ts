import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, hasTestDatabase, truncateAll } from "../testing/db";
import { findWebhookEvent, finishWebhookEvent, noteWebhookAttempt, recordWebhookEvent } from "./paypal-webhooks";

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
});
