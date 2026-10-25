import type { JsonValue } from "@jendal-workspace/core";
import type { PayPalWebhookEventRow } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { log } from "evlog";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  errorNote,
  handlePayPalWebhookBatch,
  MAX_WEBHOOK_ATTEMPTS,
  type PayPalWebhookQueueDeps,
} from "./paypal-webhook-queue";

function eventRow(overrides: Partial<PayPalWebhookEventRow> = {}): PayPalWebhookEventRow {
  return {
    id: "WH-1",
    eventType: "PAYMENT.CAPTURE.COMPLETED",
    resourceType: "capture",
    resourceId: "CAPTURE-1",
    customId: "payment-1",
    orderId: "ORDER-1",
    captureId: null,
    merchantId: "SELLER1",
    disputePayload: null,
    status: "received",
    attempts: 0,
    note: null,
    receivedAt: new Date("2026-10-08T10:00:00Z"),
    processedAt: null,
    ...overrides,
  };
}

function message(body: JsonValue, attempts = 1) {
  return { body, attempts, ack: vi.fn(), retry: vi.fn() };
}

function makeDeps(overrides: Partial<PayPalWebhookQueueDeps> = {}) {
  return {
    find: vi.fn<PayPalWebhookQueueDeps["find"]>(async () => eventRow()),
    process: vi.fn<PayPalWebhookQueueDeps["process"]>(async () => ({ status: "processed", note: "applied" })),
    finish: vi.fn<PayPalWebhookQueueDeps["finish"]>(async () => true),
    noteAttempt: vi.fn<PayPalWebhookQueueDeps["noteAttempt"]>(async () => 1),
    ...overrides,
  };
}

const failing = async (): Promise<never> => {
  throw new Error("PayPal answered 503");
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handlePayPalWebhookBatch", () => {
  it("processes a received event, finishes it with the outcome and acks", async () => {
    const deps = makeDeps();
    const msg = message({ eventId: "WH-1" });

    await handlePayPalWebhookBatch([msg], deps);

    expect(deps.find).toHaveBeenCalledWith("WH-1");
    expect(deps.process).toHaveBeenCalledWith(eventRow());
    expect(deps.finish).toHaveBeenCalledWith("WH-1", { status: "processed", note: "applied" });
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("acks an event already finished, or missing, without processing it", async () => {
    const finished = makeDeps({ find: vi.fn(async () => eventRow({ status: "processed" })) });
    const finishedMsg = message({ eventId: "WH-1" });
    await handlePayPalWebhookBatch([finishedMsg], finished);

    const missing = makeDeps({ find: vi.fn(async () => null) });
    const missingMsg = message({ eventId: "WH-2" });
    await handlePayPalWebhookBatch([missingMsg], missing);

    expect(finished.process).not.toHaveBeenCalled();
    expect(missing.process).not.toHaveBeenCalled();
    expect(finishedMsg.ack).toHaveBeenCalled();
    expect(missingMsg.ack).toHaveBeenCalled();
  });

  it("acks when a parallel delivery finished the event first", async () => {
    const info = vi.spyOn(log, "info");
    const deps = makeDeps({ finish: vi.fn(async () => false) });
    const msg = message({ eventId: "WH-1" });

    await handlePayPalWebhookBatch([msg], deps);

    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ paypalWebhook: expect.objectContaining({ eventId: "WH-1", finishedElsewhere: true }) }),
    );
  });

  it("notes a failed attempt and retries it with a growing delay", async () => {
    const deps = makeDeps({ process: vi.fn(failing) });
    const first = message({ eventId: "WH-1" }, 1);
    const third = message({ eventId: "WH-1" }, 3);

    await handlePayPalWebhookBatch([first, third], deps);

    expect(deps.noteAttempt).toHaveBeenCalledWith("WH-1", "Error: PayPal answered 503");
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(third.retry).toHaveBeenCalledWith({ delaySeconds: 90 });
    expect(first.ack).not.toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
  });

  it("stores only the name and database code of a database error, never its query", async () => {
    const queryError = new Error('Failed query: update "payment" set "paypal_fee_minor" = $1\nparams: 70000', {
      cause: { code: "23514", constraint_name: "payment_paypal_fee_check", message: "violates check constraint" },
    });
    queryError.name = "DrizzleQueryError";
    const deps = makeDeps({
      process: vi.fn(async () => {
        throw queryError;
      }),
    });
    const noCode = new Error("lost", { cause: { code: "08006" } });

    await handlePayPalWebhookBatch([message({ eventId: "WH-1" })], deps);

    expect(deps.noteAttempt).toHaveBeenCalledWith("WH-1", "DrizzleQueryError (23514 payment_paypal_fee_check)");
    expect(errorNote(noCode)).toBe("Error (08006)");
    expect(errorNote(new Error("PayPal answered 503"))).toBe("Error: PayPal answered 503");
  });

  it("marks the event failed on the last attempt and acks", async () => {
    const error = vi.spyOn(log, "error");
    const deps = makeDeps({ process: vi.fn(failing) });
    const msg = message({ eventId: "WH-1" }, MAX_WEBHOOK_ATTEMPTS);

    await handlePayPalWebhookBatch([msg], deps);

    expect(deps.finish).toHaveBeenCalledWith("WH-1", { status: "failed", note: "Error: PayPal answered 503" });
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ paypalWebhook: expect.objectContaining({ eventId: "WH-1", status: "failed" }) }),
    );
  });

  it("acks a failed attempt when another delivery already finished the event", async () => {
    const deps = makeDeps({ process: vi.fn(failing), noteAttempt: vi.fn(async () => null) });
    const msg = message({ eventId: "WH-1" }, 1);

    await handlePayPalWebhookBatch([msg], deps);

    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
  });

  it("acks and logs a malformed message", async () => {
    const error = vi.spyOn(log, "error");
    const deps = makeDeps();
    const msgs = [message("WH-1"), message({ eventId: 42 }), message(null)];

    await handlePayPalWebhookBatch(msgs, deps);

    for (const msg of msgs) expect(msg.ack).toHaveBeenCalled();
    expect(deps.find).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(3);
  });

  it("retries a message when the event table cannot be read, and goes on with the batch", async () => {
    const deps = makeDeps({
      find: vi.fn(async (eventId: string) => {
        if (eventId === "WH-1") throw new Error("connection refused");
        return eventRow({ id: eventId });
      }),
    });
    const unreadable = message({ eventId: "WH-1" }, 2);
    const next = message({ eventId: "WH-2" });

    await handlePayPalWebhookBatch([unreadable, next], deps);

    expect(unreadable.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(next.ack).toHaveBeenCalled();
  });

  it("handles each message on its own", async () => {
    const deps = makeDeps({
      find: vi.fn(async (eventId: string) => eventRow({ id: eventId })),
      process: vi.fn(async (event: PayPalWebhookEventRow) => {
        if (event.id === "WH-1") throw new Error("PayPal answered 503");
        return { status: "ignored" as const, note: "event type not handled" };
      }),
    });
    const failingMsg = message({ eventId: "WH-1" });
    const okMsg = message({ eventId: "WH-2" });

    await handlePayPalWebhookBatch([failingMsg, okMsg], deps);

    expect(failingMsg.retry).toHaveBeenCalled();
    expect(okMsg.ack).toHaveBeenCalled();
    expect(deps.finish).toHaveBeenCalledWith("WH-2", { status: "ignored", note: "event type not handled" });
  });
});
