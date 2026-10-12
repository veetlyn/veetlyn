import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import { ledgerAccounts, createFakeFileStore, hashToken, orderFeesTransfer, type JsonObject } from "@jendal-workspace/core";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import { markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import type { PayPalWebhookEventRow } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { ledgerBalance, ledgerEntry, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { downloadGrant, orders } from "@jendal-workspace/db/schema/orders";
import { team } from "@jendal-workspace/db/schema/organization";
import { payment } from "@jendal-workspace/db/schema/projects";
import {
  createTestDb,
  hasTestDatabase,
  seedOrder,
  seedProduct,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer } from "@jendal-workspace/email/fake";
import { createPayPalClient, PayPalError } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink, signPayLink } from "../client-links";
import type { PayPalServices } from "../context";
import { appRouter } from "../routers/index";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { captureCheckout, issueGrant, verifyCheckout } from "./orders";
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

function capturedOrder(status: string, value = "600.00", extra: JsonObject = {}) {
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
    captureId: null,
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
      files: createFakeFileStore(),
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
      (cause: unknown) => cause,
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

  it("parks refunds and reversals, found by their capture id", async () => {
    const { paymentId, deps } = await startedDeposit({ lookup: completedLookup });
    await processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId }));

    for (const eventType of ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"]) {
      expect(
        await processPayPalWebhookEvent(
          deps,
          storedEvent({ eventType, resourceId: "REFUND1", customId: null, orderId: null, captureId: "CAPTURE1" }),
        ),
      ).toEqual({ status: "parked", note: "refunds and reversals need a person" });
    }
    expect(
      await processPayPalWebhookEvent(
        deps,
        storedEvent({ eventType: "PAYMENT.CAPTURE.REFUNDED", customId: null, orderId: null, captureId: "OTHER" }),
      ),
    ).toEqual({ status: "ignored", note: "not a Payleor payment" });
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

  describe("store orders", () => {
    // A store order on ORDER1 for $600, from a team connected to PayPal as SELLER1.
    async function storeOrder(
      options: {
        status?: "pending" | "paid";
        lookup?: () => Response;
        capture?: () => Response;
      } = {},
    ) {
      const { teamId } = await seedServicesTeamWithAdmin(db);
      await markTeamPayPalMerchant(db, { teamId, merchantId: "SELLER1" });
      const product = await seedProduct(db, { storeId: teamId, kind: "digital", status: "published", priceMinor: 60_000 });
      const paid = options.status === "paid";
      const order = await seedOrder(db, {
        teamId,
        productId: product.id,
        amountMinor: 60_000,
        status: options.status,
        paypalOrderId: "ORDER1",
        paypalCaptureId: paid ? "CAPTURE1" : undefined,
      });
      const api = fakePayPalApi({ capture: options.capture, lookup: options.lookup });
      const mailer = createFakeMailer();
      const deps = {
        db,
        paypal: makePayPal(api.fetch),
        email: {
          mailer,
          siteOrigin: "https://payleor.test",
          adminOrigin: "https://admin.payleor.test",
          storeOrigin: (slug: string) => `https://${slug}.payleor.test`,
        },
      };
      return { teamId, order, mailer, deps, requests: api.requests, customId: `order:${order.id}` };
    }

    async function orderRow(orderId: string) {
      const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
      return row;
    }

    async function grantsOf(orderId: string) {
      return db.select().from(downloadGrant).where(eq(downloadGrant.orderId, orderId));
    }

    async function orderPostings() {
      const rows = await db
        .select({ kind: ledgerTransfer.kind, reference: ledgerTransfer.reference, amountMinor: ledgerEntry.amountMinor })
        .from(ledgerTransfer)
        .innerJoin(ledgerEntry, eq(ledgerEntry.transferId, ledgerTransfer.id))
        .where(and(eq(ledgerTransfer.kind, "order_refunded"), eq(ledgerEntry.account, ledgerAccounts.paypalClearing)));
      return rows.map((row) => ({ ...row, amountMinor: Math.abs(row.amountMinor) }));
    }

    function refundedLookup(
      captureStatus: string,
      refunds: { id: string; status: string; value: string; breakdown?: JsonObject }[],
    ) {
      return () =>
        jsonResponse(200, {
          id: "ORDER1",
          status: "COMPLETED",
          purchase_units: [
            {
              payments: {
                captures: [{ id: "CAPTURE1", status: captureStatus, amount: { currency_code: "USD", value: "600.00" } }],
                refunds: refunds.map((refund) => ({
                  id: refund.id,
                  status: refund.status,
                  amount: { currency_code: "USD", value: refund.value },
                  // null reads as no breakdown, as PayPal's pending refunds have.
                  seller_payable_breakdown: refund.breakdown ?? null,
                })),
              },
            },
          ],
        });
    }

    // The ledger entries of every refund_fees transfer.
    async function refundFeePostings() {
      return db
        .select({ reference: ledgerTransfer.reference, account: ledgerEntry.account, amountMinor: ledgerEntry.amountMinor })
        .from(ledgerTransfer)
        .innerJoin(ledgerEntry, eq(ledgerEntry.transferId, ledgerTransfer.id))
        .where(eq(ledgerTransfer.kind, "refund_fees"))
        .orderBy(ledgerEntry.account);
    }

    // PayPal's sandbox answer for a $5.00 refund: its fee and Payleor's fee returned in proportion.
    const SANDBOX_REFUND_BREAKDOWN = {
      paypal_fee: { currency_code: "USD", value: "0.19" },
      platform_fees: [{ amount: { currency_code: "USD", value: "0.05" } }],
      net_amount: { currency_code: "USD", value: "4.76" },
    };

    function refundEvent(overrides: Partial<PayPalWebhookEventRow> = {}) {
      return storedEvent({
        eventType: "PAYMENT.CAPTURE.REFUNDED",
        resourceType: "refund",
        resourceId: "R1",
        customId: null,
        orderId: null,
        captureId: "CAPTURE1",
        ...overrides,
      });
    }

    it("captures an approved order the browser did not capture, and emails the buyer once", async () => {
      const { order, mailer, deps, requests, customId } = await storeOrder();
      const event = storedEvent({
        eventType: "CHECKOUT.ORDER.APPROVED",
        resourceType: "checkout-order",
        resourceId: "ORDER1",
        customId,
      });

      expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "applied" });
      expect(captures(requests)).toHaveLength(1);
      expect(await orderRow(order.id)).toMatchObject({ status: "paid", paypalCaptureId: "CAPTURE1", paypalFeeMinor: 2_370 });
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe("buyer@example.com");
      expect(await grantsOf(order.id)).toHaveLength(1);

      expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "nothing to do" });
      expect(captures(requests)).toHaveLength(1);
      expect(mailer.sent).toHaveLength(1);
    });

    it("counts an approval PayPal declines as processed, with the decline", async () => {
      const declined = {
        name: "UNPROCESSABLE_ENTITY",
        debug_id: "d422",
        details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was declined." }],
      };
      const { order, deps, customId } = await storeOrder({ capture: () => jsonResponse(422, declined) });
      const event = storedEvent({ eventType: "CHECKOUT.ORDER.APPROVED", resourceType: "checkout-order", customId });

      expect(await processPayPalWebhookEvent(deps, event)).toEqual({
        status: "processed",
        note: "PayPal declined this payment method. Choose another way to pay.",
      });
      expect((await orderRow(order.id))?.status).toBe("pending");
    });

    it("applies a completed capture event with its fees, once", async () => {
      const { order, mailer, deps, requests, customId } = await storeOrder({ lookup: completedLookup });
      const event = storedEvent({ customId });

      expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "applied" });
      expect(lookups(requests)).toHaveLength(1);
      expect(await orderRow(order.id)).toMatchObject({ status: "paid", paypalFeeMinor: 2_370, platformFeeMinor: 600 });

      expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "already_applied" });
      expect(mailer.sent).toHaveLength(1);
      expect(await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "order_paid"))).toHaveLength(1);
      expect(await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "order_fees"))).toHaveLength(1);
    });

    it("emails the buyer once when the browser's capture applies before the capture event", async () => {
      const { order, mailer, deps, customId } = await storeOrder({ lookup: completedLookup });
      const secret = "browser-secret";
      await db.update(orders).set({ checkoutSecretHash: await hashToken(secret) }).where(eq(orders.id, order.id));

      const verified = await verifyCheckout(db, { paypalOrderId: "ORDER1", secret });
      expect(await captureCheckout(deps, verified)).toMatchObject({ outcome: "captured" });
      expect(mailer.sent).toHaveLength(1);

      expect(await processPayPalWebhookEvent(deps, storedEvent({ customId }))).toEqual({
        status: "processed",
        note: "already_applied",
      });
      expect(mailer.sent).toHaveLength(1);
      expect(await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "order_paid"))).toHaveLength(1);
    });

    it("retries the fee step visibly when it keeps failing", async () => {
      const { teamId, order, deps, customId } = await storeOrder({ lookup: completedLookup });
      // A fee posting already under the order's reference makes every fee step fail.
      const blocking = orderFeesTransfer({ currency: "USD", orderId: order.id, paypalFeeMinor: 1, platformFeeMinor: 0 });
      if (!blocking) throw new Error("No fee transfer");
      await db.transaction((tx) => createPostgresLedger(teamId, tx).post([blocking]));

      await expect(processPayPalWebhookEvent(deps, storedEvent({ customId }))).rejects.toMatchObject({
        code: "duplicate_reference",
      });
      expect(await orderRow(order.id)).toMatchObject({ status: "paid", paypalFeeMinor: null });
    });

    it("refunds the order on a refund found by its capture id, revoking every grant and posting each refund once", async () => {
      const first = refundedLookup("PARTIALLY_REFUNDED", [
        { id: "R1", status: "COMPLETED", value: "5.00", breakdown: SANDBOX_REFUND_BREAKDOWN },
      ]);
      const both = refundedLookup("PARTIALLY_REFUNDED", [
        { id: "R1", status: "COMPLETED", value: "5.00", breakdown: SANDBOX_REFUND_BREAKDOWN },
        { id: "R2", status: "COMPLETED", value: "7.50" },
      ]);
      let lookup = first;
      const { order, deps } = await storeOrder({ status: "paid", lookup: () => lookup() });
      await issueGrant(db, order.id);
      await issueGrant(db, order.id);

      expect(await processPayPalWebhookEvent(deps, refundEvent())).toEqual({ status: "processed", note: "refunded" });
      expect(await orderRow(order.id)).toMatchObject({ status: "refunded", refundedAt: expect.any(Date) });
      const grants = await grantsOf(order.id);
      expect(grants).toHaveLength(2);
      expect(grants.every((grant) => grant.revokedAt !== null)).toBe(true);
      expect(await orderPostings()).toEqual([
        { kind: "order_refunded", reference: "order_refunded:refund:R1", amountMinor: 500 },
      ]);
      const returnedFees = [
        { reference: "refund_fees:R1", account: ledgerAccounts.payleorFees, amountMinor: -5 },
        { reference: "refund_fees:R1", account: ledgerAccounts.paypalFees, amountMinor: -19 },
        { reference: "refund_fees:R1", account: ledgerAccounts.teamRevenue, amountMinor: 24 },
      ];
      expect(await refundFeePostings()).toEqual(returnedFees);

      expect(await processPayPalWebhookEvent(deps, refundEvent())).toEqual({
        status: "processed",
        note: "already refunded",
      });
      expect(await orderPostings()).toHaveLength(1);
      expect(await refundFeePostings()).toEqual(returnedFees);

      lookup = both;
      expect(await processPayPalWebhookEvent(deps, refundEvent({ id: "WH-2", resourceId: "R2" }))).toEqual({
        status: "processed",
        note: "already refunded",
      });
      expect(await orderPostings()).toEqual(
        expect.arrayContaining([
          { kind: "order_refunded", reference: "order_refunded:refund:R1", amountMinor: 500 },
          { kind: "order_refunded", reference: "order_refunded:refund:R2", amountMinor: 750 },
        ]),
      );
      expect(await orderPostings()).toHaveLength(2);
    });

    it("retries a later refund until PayPal's order lists it, then posts it once", async () => {
      const first = refundedLookup("PARTIALLY_REFUNDED", [{ id: "R1", status: "COMPLETED", value: "5.00" }]);
      const both = refundedLookup("PARTIALLY_REFUNDED", [
        { id: "R1", status: "COMPLETED", value: "5.00" },
        { id: "R2", status: "COMPLETED", value: "7.50" },
      ]);
      let lookup = first;
      const { order, deps } = await storeOrder({ status: "paid", lookup: () => lookup() });
      expect(await processPayPalWebhookEvent(deps, refundEvent())).toEqual({ status: "processed", note: "refunded" });

      const second = refundEvent({ id: "WH-2", resourceId: "R2" });
      await expect(processPayPalWebhookEvent(deps, second)).rejects.toThrow(/R2/);
      expect((await orderRow(order.id))?.status).toBe("refunded");
      expect(await orderPostings()).toHaveLength(1);

      lookup = both;
      expect(await processPayPalWebhookEvent(deps, second)).toEqual({ status: "processed", note: "already refunded" });
      expect(await processPayPalWebhookEvent(deps, second)).toEqual({ status: "processed", note: "already refunded" });
      expect(await orderPostings()).toEqual(
        expect.arrayContaining([
          { kind: "order_refunded", reference: "order_refunded:refund:R1", amountMinor: 500 },
          { kind: "order_refunded", reference: "order_refunded:refund:R2", amountMinor: 750 },
        ]),
      );
      expect(await orderPostings()).toHaveLength(2);
    });

    it("posts only what the refunds left on a reversal after a partial refund", async () => {
      const { order, deps } = await storeOrder({
        status: "paid",
        lookup: refundedLookup("REVERSED", [{ id: "R1", status: "COMPLETED", value: "5.00" }]),
      });
      const event = storedEvent({
        eventType: "PAYMENT.CAPTURE.REVERSED",
        resourceType: "capture",
        resourceId: "CAPTURE1",
        customId: null,
        orderId: null,
        captureId: "CAPTURE1",
      });

      expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "refunded" });
      expect((await orderRow(order.id))?.status).toBe("refunded");
      expect(await orderPostings()).toEqual(
        expect.arrayContaining([
          { kind: "order_refunded", reference: "order_refunded:refund:R1", amountMinor: 500 },
          { kind: "order_refunded", reference: "order_refunded:reversal:CAPTURE1", amountMinor: 59_500 },
        ]),
      );
      expect(await orderPostings()).toHaveLength(2);
    });

    it("posts no reversal when the refunds already took back the full amount", async () => {
      const { deps } = await storeOrder({
        status: "paid",
        lookup: refundedLookup("REVERSED", [{ id: "R1", status: "COMPLETED", value: "600.00" }]),
      });
      const event = storedEvent({
        eventType: "PAYMENT.CAPTURE.REVERSED",
        resourceType: "capture",
        resourceId: "CAPTURE1",
        customId: null,
        orderId: null,
        captureId: "CAPTURE1",
      });

      expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "refunded" });
      expect(await orderPostings()).toEqual([
        { kind: "order_refunded", reference: "order_refunded:refund:R1", amountMinor: 60_000 },
      ]);
    });

    it("does not post a refund in another currency, but still refunds the order", async () => {
      const lookup = () =>
        jsonResponse(200, {
          id: "ORDER1",
          status: "COMPLETED",
          purchase_units: [
            {
              payments: {
                captures: [{ id: "CAPTURE1", status: "PARTIALLY_REFUNDED", amount: { currency_code: "USD", value: "600.00" } }],
                refunds: [{ id: "R1", status: "COMPLETED", amount: { currency_code: "EUR", value: "5.00" } }],
              },
            },
          ],
        });
      const { order, deps } = await storeOrder({ status: "paid", lookup });

      expect(await processPayPalWebhookEvent(deps, refundEvent())).toEqual({ status: "processed", note: "refunded" });
      expect((await orderRow(order.id))?.status).toBe("refunded");
      expect(await orderPostings()).toEqual([]);
    });

    it("refunds the order on a reversal and posts the full amount once", async () => {
      const { order, deps } = await storeOrder({ status: "paid", lookup: refundedLookup("REVERSED", []) });
      await issueGrant(db, order.id);
      const event = storedEvent({
        eventType: "PAYMENT.CAPTURE.REVERSED",
        resourceType: "capture",
        resourceId: "CAPTURE1",
        customId: null,
        orderId: null,
        captureId: "CAPTURE1",
      });

      expect(await processPayPalWebhookEvent(deps, event)).toEqual({ status: "processed", note: "refunded" });
      expect((await orderRow(order.id))?.status).toBe("refunded");
      expect((await grantsOf(order.id)).every((grant) => grant.revokedAt !== null)).toBe(true);
      expect(await orderPostings()).toEqual([
        { kind: "order_refunded", reference: "order_refunded:reversal:CAPTURE1", amountMinor: 60_000 },
      ]);

      expect(await processPayPalWebhookEvent(deps, { ...event, customId: `order:${order.id}`, orderId: "ORDER1" })).toEqual({
        status: "processed",
        note: "already refunded",
      });
      expect(await orderPostings()).toHaveLength(1);
    });

    it("refunds the order when a capture event finds the capture refunded", async () => {
      const { order, deps, customId } = await storeOrder({
        status: "paid",
        lookup: refundedLookup("REFUNDED", [{ id: "R1", status: "COMPLETED", value: "600.00" }]),
      });

      expect(await processPayPalWebhookEvent(deps, storedEvent({ customId }))).toEqual({
        status: "processed",
        note: "refunded",
      });
      expect((await orderRow(order.id))?.status).toBe("refunded");
      expect(await orderPostings()).toEqual([
        { kind: "order_refunded", reference: "order_refunded:refund:R1", amountMinor: 60_000 },
      ]);

      // A capture refunded before Payleor applied it: recorded as paid, then refunded, with no grant or email.
      await truncateAll(db);
      const early = await storeOrder({
        lookup: refundedLookup("REFUNDED", [{ id: "R1", status: "COMPLETED", value: "600.00" }]),
      });
      expect(await processPayPalWebhookEvent(early.deps, storedEvent({ customId: early.customId }))).toEqual({
        status: "processed",
        note: "refunded",
      });
      expect(await orderRow(early.order.id)).toMatchObject({
        status: "refunded",
        paypalCaptureId: "CAPTURE1",
        paidAt: expect.any(Date),
      });
      expect(await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "order_paid"))).toHaveLength(1);
      expect(await orderPostings()).toEqual([
        { kind: "order_refunded", reference: "order_refunded:refund:R1", amountMinor: 60_000 },
      ]);
      expect(await grantsOf(early.order.id)).toHaveLength(0);
      expect(early.mailer.sent).toHaveLength(0);
    });

    it("flags converted funds for review, and posts the fees only when they are in the capture's currency", async () => {
      const cases = [
        {
          breakdown: {
            ...FEE_BREAKDOWN.seller_receivable_breakdown,
            receivable_amount: { currency_code: "EUR", value: "527.00" },
            exchange_rate: { value: "0.924", source_currency: "USD", target_currency: "EUR" },
          },
          reviewReason: "converted_receivable",
          paypalFeeMinor: 2_370,
          feeTransfers: 1,
        },
        {
          breakdown: {
            ...FEE_BREAKDOWN.seller_receivable_breakdown,
            paypal_fee: { currency_code: "EUR", value: "21.90" },
          },
          reviewReason: "fee_currency",
          paypalFeeMinor: null,
          feeTransfers: 0,
        },
      ];
      for (const { breakdown, reviewReason, paypalFeeMinor, feeTransfers } of cases) {
        await truncateAll(db);
        const capture = { ...FEE_BREAKDOWN, seller_receivable_breakdown: breakdown };
        const { order, deps, customId } = await storeOrder({
          lookup: () => jsonResponse(200, capturedOrder("COMPLETED", "600.00", capture)),
        });

        expect(await processPayPalWebhookEvent(deps, storedEvent({ customId }))).toEqual({ status: "processed", note: "applied" });
        expect(await orderRow(order.id)).toMatchObject({ status: "paid", reviewReason, paypalFeeMinor });
        expect(await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "order_fees"))).toHaveLength(feeTransfers);
      }
    });

    it("leaves a refund to the queue's retries while PayPal's order shows none", async () => {
      const { order, deps } = await storeOrder({ status: "paid", lookup: completedLookup });

      await expect(processPayPalWebhookEvent(deps, refundEvent())).rejects.toThrow(/no refund yet/);
      expect((await orderRow(order.id))?.status).toBe("paid");
    });

    it("revokes at once when the capture shows refunded, and posts the refund on the retry once PayPal lists it", async () => {
      let lookup = refundedLookup("REFUNDED", []);
      const { order, deps } = await storeOrder({ status: "paid", lookup: () => lookup() });
      await issueGrant(db, order.id);

      await expect(processPayPalWebhookEvent(deps, refundEvent())).rejects.toThrow(/no completed refund yet/);
      expect((await orderRow(order.id))?.status).toBe("refunded");
      expect((await grantsOf(order.id)).every((grant) => grant.revokedAt !== null)).toBe(true);
      expect(await orderPostings()).toEqual([]);

      lookup = refundedLookup("REFUNDED", [{ id: "R1", status: "COMPLETED", value: "600.00" }]);
      expect(await processPayPalWebhookEvent(deps, refundEvent())).toEqual({ status: "processed", note: "already refunded" });
      expect(await processPayPalWebhookEvent(deps, refundEvent())).toEqual({ status: "processed", note: "already refunded" });
      expect(await orderPostings()).toEqual([
        { kind: "order_refunded", reference: "order_refunded:refund:R1", amountMinor: 60_000 },
      ]);
    });

    it("parks order events for another merchant without calling PayPal", async () => {
      const { order, deps, requests, customId } = await storeOrder({
        status: "paid",
        lookup: refundedLookup("REFUNDED", [{ id: "R1", status: "COMPLETED", value: "600.00" }]),
      });

      expect(await processPayPalWebhookEvent(deps, refundEvent({ merchantId: "SOMEONE_ELSE" }))).toEqual({
        status: "parked",
        note: "merchant does not match the team",
      });
      expect(await processPayPalWebhookEvent(deps, storedEvent({ customId, merchantId: "SOMEONE_ELSE" }))).toEqual({
        status: "parked",
        note: "merchant does not match the team",
      });
      expect(lookups(requests)).toHaveLength(0);
      expect((await orderRow(order.id))?.status).toBe("paid");
    });

    it("ignores an event for an order Payleor does not have", async () => {
      const { deps } = await storeOrder({ lookup: completedLookup });

      expect(
        await processPayPalWebhookEvent(deps, storedEvent({ customId: `order:${crypto.randomUUID()}`, orderId: null })),
      ).toEqual({ status: "ignored", note: "not a Payleor payment" });
    });
  });
});
