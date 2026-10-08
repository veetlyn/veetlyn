import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import { ledgerAccounts } from "@jendal-workspace/core";
import { markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import type { PayPalWebhookEventRow } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { team } from "@jendal-workspace/db/schema/organization";
import { payment } from "@jendal-workspace/db/schema/projects";
import {
  createTestDb,
  hasTestDatabase,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createPayPalClient, PayPalError } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink, signPayLink } from "../client-links";
import type { PayPalServices } from "../context";
import { appRouter } from "../routers/index";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { processPayPalWebhookEvent } from "./paypal-webhooks";

const SECRET = TEST_AUTH_CONFIG.BETTER_AUTH_SECRET;
const ITEMS = [
  { description: "Design", amountMinor: 40_000, extraDays: 0 },
  { description: "Build", amountMinor: 60_000, extraDays: 0 },
];

const FEE_BREAKDOWN = {
  create_time: "2026-10-08T00:00:00Z",
  seller_receivable_breakdown: {
    gross_amount: { currency_code: "USD", value: "600.00" },
    paypal_fee: { currency_code: "USD", value: "23.70" },
    platform_fees: [{ amount: { currency_code: "USD", value: "6.00" } }],
    net_amount: { currency_code: "USD", value: "570.30" },
  },
};

function capturedOrder(status: string, value = "600.00", extra: Record<string, unknown> = {}) {
  return {
    id: "ORDER1",
    status: status === "COMPLETED" ? "COMPLETED" : "PENDING",
    purchase_units: [{ payments: { captures: [{ id: "CAPTURE1", status, amount: { currency_code: "USD", value }, ...extra }] } }],
  };
}

// A fake PayPal API: token, order create (always ORDER1), capture and order lookup.
function fakePayPalApi(options: { capture?: () => Response; lookup?: () => Response } = {}) {
  return fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.method === "POST" && request.url.endsWith("/v2/checkout/orders")) {
      return jsonResponse(201, { id: "ORDER1", status: "CREATED" });
    }
    if (request.url.endsWith("/v2/checkout/orders/ORDER1/capture")) {
      return options.capture?.() ?? jsonResponse(201, capturedOrder("COMPLETED", "600.00", FEE_BREAKDOWN));
    }
    if (request.method === "GET" && request.url.endsWith("/v2/checkout/orders/ORDER1")) {
      return options.lookup?.() ?? jsonResponse(200, { id: "ORDER1", status: "APPROVED" });
    }
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
}

function makePayPal(fetchImpl: Parameters<typeof createPayPalClient>[0]["fetch"]): PayPalServices {
  return {
    client: createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
      partnerAttributionId: "PAYLEOR_BN",
    }),
    partnerId: "PARTNER42",
    returnUrl: "https://admin.example.com/api/paypal/onboarding/return",
    sdk: { clientId: "partner-client-id", partnerAttributionId: "PAYLEOR_BN", environment: "sandbox" },
  };
}

function lookups(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((r) => r.method === "GET" && r.url.endsWith("/v2/checkout/orders/ORDER1"));
}

function captures(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((r) => r.url.endsWith("/v2/checkout/orders/ORDER1/capture"));
}

function storedEvent(overrides: Partial<PayPalWebhookEventRow> = {}): PayPalWebhookEventRow {
  return {
    id: "WH-1",
    eventType: "PAYMENT.CAPTURE.COMPLETED",
    resourceType: "capture",
    resourceId: "CAPTURE1",
    customId: null,
    orderId: "ORDER1",
    merchantId: "SELLER1",
    status: "received",
    attempts: 0,
    note: null,
    receivedAt: new Date(),
    processedAt: null,
    ...overrides,
  };
}

describe.skipIf(!hasTestDatabase)("processPayPalWebhookEvent", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null, paypal?: PayPalServices) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      paypal,
      catalog: createTestCatalogServices(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  // A $1,000 quote accepted by the client, for a team connected to PayPal: a pending $600 deposit.
  async function connectedDeposit() {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await callerFor(userId).project.create({
      teamSlug: "team",
      title: "Website redesign",
      clientEmail: "client@example.com",
    });
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 14,
    });
    const { paymentId } = await callerFor(null).project.clientAcceptQuote({
      token: await signClientLink(SECRET, projectId),
      quoteId,
    });
    await markTeamPayPalMerchant(db, { teamId, merchantId: "SELLER1" });
    return { projectId, paymentId, token: await signPayLink(SECRET, paymentId) };
  }

  // A connected deposit whose client has approved ORDER1 but whose browser never reported back.
  async function startedDeposit(options: { capture?: () => Response; lookup?: () => Response } = {}) {
    const seeded = await connectedDeposit();
    const api = fakePayPalApi(options);
    const paypal = makePayPal(api.fetch);
    await callerFor(null, paypal).payment.payStart({ token: seeded.token });
    return { ...seeded, requests: api.requests, deps: { db, paypal } };
  }

  async function paymentRow(paymentId: string) {
    const [row] = await db.select().from(payment).where(eq(payment.id, paymentId));
    return row;
  }

  async function transfersOf(kind: "payment_captured" | "payment_fees") {
    return db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, kind));
  }

  const completedLookup = () => jsonResponse(200, capturedOrder("COMPLETED", "600.00", FEE_BREAKDOWN));

  it("applies a completed capture the browser never reported, with its fees", async () => {
    const { projectId, paymentId, deps } = await startedDeposit({ lookup: completedLookup });

    expect(await processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId }))).toEqual({
      status: "processed",
      note: "applied",
    });

    expect(await paymentRow(paymentId)).toMatchObject({
      status: "captured",
      paypalCaptureId: "CAPTURE1",
      paypalFeeMinor: 2_370,
      platformFeeMinor: 600,
    });
    expect((await paymentRow(paymentId))?.capturedAt?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    expect(await transfersOf("payment_fees")).toHaveLength(1);
    expect(await db.select().from(ledgerBalance)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: ledgerAccounts.paypalFees, balanceMinor: 2_370 }),
        expect.objectContaining({ account: ledgerAccounts.payleorFees, balanceMinor: 600 }),
      ]),
    );
  });

  it("finds the payment by its order id alone", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: completedLookup });

    expect(await processPayPalWebhookEvent(deps, storedEvent({ customId: null, orderId: "ORDER1" }))).toEqual({
      status: "processed",
      note: "applied",
    });
    expect((await paymentRow(paymentId))?.status).toBe("captured");
  });

  it("leaves a capture event to the queue's retries while the order shows no capture yet", async () => {
    const { paymentId, deps } = await startedDeposit();

    await expect(processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId }))).rejects.toThrow(/has no capture yet/);
    expect((await paymentRow(paymentId))?.status).toBe("pending");
  });

  it("records a pending capture's id and keeps the payment pending", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: () => jsonResponse(200, capturedOrder("PENDING")) });

    expect(
      await processPayPalWebhookEvent(deps, storedEvent({ eventType: "PAYMENT.CAPTURE.PENDING", customId: paymentId })),
    ).toEqual({ status: "processed", note: "pending" });
    expect(await paymentRow(paymentId)).toMatchObject({ status: "pending", paypalCaptureId: "CAPTURE1" });
  });

  it("marks the payment failed for a declined capture", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: () => jsonResponse(200, capturedOrder("DECLINED")) });

    expect(
      await processPayPalWebhookEvent(deps, storedEvent({ eventType: "PAYMENT.CAPTURE.DECLINED", customId: paymentId })),
    ).toEqual({ status: "processed", note: "failed" });
    expect((await paymentRow(paymentId))?.status).toBe("failed");
  });

  it("retries the fee step visibly when it keeps failing", async () => {
    const breakdown = {
      ...FEE_BREAKDOWN,
      seller_receivable_breakdown: {
        ...FEE_BREAKDOWN.seller_receivable_breakdown,
        // Above the amount: the payment's check constraint refuses it.
        paypal_fee: { currency_code: "USD", value: "700.00" },
      },
    };
    const { paymentId, deps } = await startedDeposit({
      lookup: () => jsonResponse(200, capturedOrder("COMPLETED", "600.00", breakdown)),
    });

    const error = await processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId })).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ cause: { constraint_name: "payment_paypal_fee_check" } });
    expect(await paymentRow(paymentId)).toMatchObject({ status: "captured", paypalFeeMinor: null });
  });

  it("changes nothing for a redelivered or late event", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: completedLookup });
    const event = storedEvent({ customId: paymentId });
    await processPayPalWebhookEvent(deps, event);

    expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "already_applied" });

    expect(await transfersOf("payment_captured")).toHaveLength(1);
    expect(await transfersOf("payment_fees")).toHaveLength(1);
  });

  it("captures an approved order the browser did not capture, once", async () => {
    const { paymentId, requests, deps } = await startedDeposit();
    const event = storedEvent({
      eventType: "CHECKOUT.ORDER.APPROVED",
      resourceType: "checkout-order",
      resourceId: "ORDER1",
      customId: paymentId,
    });

    expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "captured" });
    expect(captures(requests)).toHaveLength(1);
    expect(await paymentRow(paymentId)).toMatchObject({ status: "captured", paypalFeeMinor: 2_370 });

    expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "nothing to do" });
    expect(captures(requests)).toHaveLength(1);
  });

  it("counts an approval PayPal declines as processed, with the decline", async () => {
    const declined = {
      name: "UNPROCESSABLE_ENTITY",
      message: "The requested action could not be performed.",
      debug_id: "d422",
      details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was declined." }],
    };
    const { paymentId, deps } = await startedDeposit({ capture: () => jsonResponse(422, declined) });
    const event = storedEvent({ eventType: "CHECKOUT.ORDER.APPROVED", resourceType: "checkout-order", customId: paymentId });

    expect(await processPayPalWebhookEvent(deps, event)).toEqual({
      status: "processed",
      note: "PayPal declined this payment method. Choose another way to pay.",
    });
  });

  it("parks a completed capture on a cancelled payment", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: completedLookup });
    await db.update(payment).set({ status: "cancelled" }).where(eq(payment.id, paymentId));

    const outcome = await processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId }));

    expect(outcome.status).toBe("parked");
    expect(outcome.note).toContain("cancelled payment");
  });

  it("ignores events about other payments and events it does not handle", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: completedLookup });

    expect(await processPayPalWebhookEvent(deps, storedEvent({ orderId: "OTHER" }))).toEqual({
      status: "ignored",
      note: "not a Payleor payment",
    });
    expect(await processPayPalWebhookEvent(deps, storedEvent({ customId: crypto.randomUUID(), orderId: null }))).toEqual({
      status: "ignored",
      note: "not a Payleor payment",
    });
    expect(await processPayPalWebhookEvent(deps, storedEvent({ customId: "INV-42", orderId: null }))).toEqual({
      status: "ignored",
      note: "not a Payleor payment",
    });
    expect(
      await processPayPalWebhookEvent(deps, storedEvent({ eventType: "MERCHANT.ONBOARDING.COMPLETED", customId: paymentId })),
    ).toEqual({ status: "ignored", note: "event type not handled" });
    expect((await paymentRow(paymentId))?.status).toBe("pending");
  });

  it("parks refunds and reversals", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: completedLookup });

    for (const eventType of ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"]) {
      expect(await processPayPalWebhookEvent(deps, storedEvent({ eventType, customId: paymentId, orderId: null }))).toEqual({
        status: "parked",
        note: "refunds and reversals need a person (run 4)",
      });
    }
  });

  it("parks a capture that does not match the payment", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: () => jsonResponse(200, capturedOrder("COMPLETED", "1.00")) });

    const outcome = await processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId }));

    expect(outcome.status).toBe("parked");
    expect(outcome.note).toContain("does not match");
    expect((await paymentRow(paymentId))?.status).toBe("pending");
  });

  it("parks an event for another seller without calling PayPal", async () => {
    const { paymentId, requests, deps } = await startedDeposit({ lookup: completedLookup });

    expect(await processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId, merchantId: "SOMEONE_ELSE" }))).toEqual({
      status: "parked",
      note: "merchant does not match the team",
    });
    expect(lookups(requests)).toHaveLength(0);
  });

  it("parks an event for a team that has no PayPal merchant", async () => {
    const { paymentId, requests, deps } = await startedDeposit({ lookup: completedLookup });
    await db.update(team).set({ paypalMerchantId: null });

    expect(await processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId }))).toEqual({
      status: "parked",
      note: "team has no PayPal merchant",
    });
    expect(lookups(requests)).toHaveLength(0);
  });

  it("leaves a PayPal outage, 401 and 429 to the queue's retries, and parks an order PayPal no longer has", async () => {
    const outage = await startedDeposit({ lookup: () => jsonResponse(503, { name: "SERVICE_UNAVAILABLE", debug_id: "d503" }) });
    await expect(processPayPalWebhookEvent(outage.deps, storedEvent({ customId: outage.paymentId }))).rejects.toBeInstanceOf(
      PayPalError,
    );

    for (const status of [401, 429]) {
      await truncateAll(db);
      const refused = await startedDeposit({ lookup: () => jsonResponse(status, { name: "REFUSED", debug_id: "d4xx" }) });
      await expect(
        processPayPalWebhookEvent(refused.deps, storedEvent({ customId: refused.paymentId })),
      ).rejects.toBeInstanceOf(PayPalError);
    }

    await truncateAll(db);
    const gone = await startedDeposit({ lookup: () => jsonResponse(404, { name: "RESOURCE_NOT_FOUND", debug_id: "d404" }) });
    const outcome = await processPayPalWebhookEvent(gone.deps, storedEvent({ customId: gone.paymentId }));
    expect(outcome).toMatchObject({ status: "parked" });
    expect(outcome.note).toContain("404");
  });
});
