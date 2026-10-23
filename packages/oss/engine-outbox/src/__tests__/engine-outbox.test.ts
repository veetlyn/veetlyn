import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, computeNextAttemptAt, deliveryDedupeKey, recordDeliveryFailure, recordDeliverySuccess } from "../index";

const T = (iso: string) => new Date(iso);
const NOW = T("2026-10-01T12:00:00Z");
const MINUTE = 60_000;

function pendingDelivery(attempts = 0) {
  return {
    id: "od_1",
    outboxId: "ob_1",
    channel: "email_client" as const,
    recipient: "buyer@example.com",
    dedupeKey: "ob_1:email_client:buyer@example.com",
    status: "pending" as const,
    attempts,
    nextAttemptAt: NOW,
    sentAt: null,
    lastError: null,
    providerMessageId: null,
  };
}

describe("computeNextAttemptAt", () => {
  it("backs off exponentially: 1m, 5m, 15m, 1h, 6h", () => {
    expect(computeNextAttemptAt(0, NOW)).toEqual(new Date(NOW.getTime() + 1 * MINUTE));
    expect(computeNextAttemptAt(1, NOW)).toEqual(new Date(NOW.getTime() + 5 * MINUTE));
    expect(computeNextAttemptAt(2, NOW)).toEqual(new Date(NOW.getTime() + 15 * MINUTE));
    expect(computeNextAttemptAt(3, NOW)).toEqual(new Date(NOW.getTime() + 60 * MINUTE));
    expect(computeNextAttemptAt(4, NOW)).toEqual(new Date(NOW.getTime() + 360 * MINUTE));
  });

  it("offers no further attempt once the maximum is reached", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(computeNextAttemptAt(5, NOW)).toBeNull();
  });
});

describe("recordDeliverySuccess", () => {
  it("marks the delivery sent with the provider message id", () => {
    const record = recordDeliverySuccess(pendingDelivery(2), "re_abc123", NOW);
    expect(record).toMatchObject({ status: "sent", attempts: 3, sentAt: NOW, providerMessageId: "re_abc123", lastError: null });
  });
});

describe("recordDeliveryFailure", () => {
  it("schedules the next retry after a transient failure", () => {
    const record = recordDeliveryFailure(pendingDelivery(0), "network down", NOW);
    expect(record).toMatchObject({ status: "pending", attempts: 1, lastError: "network down" });
    expect(record.nextAttemptAt).toEqual(new Date(NOW.getTime() + 1 * MINUTE));
  });

  it("marks the delivery failed after the final attempt", () => {
    const record = recordDeliveryFailure(pendingDelivery(4), "gave up", NOW);
    expect(record).toMatchObject({ status: "failed", attempts: 5, lastError: "gave up" });
    expect(record.nextAttemptAt).toBeNull();
  });
});

describe("deliveryDedupeKey", () => {
  it("keys a delivery by event, channel and recipient", () => {
    expect(deliveryDedupeKey("ob_1", "email_client", "buyer@example.com")).toBe("ob_1:email_client:buyer@example.com");
  });
});
