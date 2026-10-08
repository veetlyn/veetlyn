import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import { ledgerAccounts } from "@jendal-workspace/core";
import { markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { payment } from "@jendal-workspace/db/schema/projects";
import {
  createTestDb,
  hasTestDatabase,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { buildAuthAssertion, createPayPalClient, PayPalError } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink, signPayLink, verifyPayLink } from "../client-links";
import type { PayPalServices } from "../context";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { applyCaptureFact, type CaptureFact, CaptureFactConflict } from "../use-cases/payments";
import { appRouter } from "./index";

const SECRET = TEST_AUTH_CONFIG.BETTER_AUTH_SECRET;
const ITEMS = [
  { description: "Design", amountMinor: 40_000, extraDays: 0 },
  { description: "Build", amountMinor: 60_000, extraDays: 0 },
];

function capturedOrder(status: string, value = "600.00", extra: Record<string, unknown> = {}) {
  return {
    id: "ORDER1",
    status: status === "COMPLETED" ? "COMPLETED" : "PENDING",
    purchase_units: [{ payments: { captures: [{ id: "CAPTURE1", status, amount: { currency_code: "USD", value }, ...extra }] } }],
  };
}

const FEE_BREAKDOWN = {
  create_time: "2026-10-08T00:00:00Z",
  seller_receivable_breakdown: {
    gross_amount: { currency_code: "USD", value: "600.00" },
    paypal_fee: { currency_code: "USD", value: "23.70" },
    platform_fees: [{ amount: { currency_code: "USD", value: "6.00" } }],
    net_amount: { currency_code: "USD", value: "570.30" },
  },
};

const DECLINED = {
  name: "UNPROCESSABLE_ENTITY",
  message: "The requested action could not be performed.",
  debug_id: "d422",
  details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was declined." }],
};

const ALREADY_CAPTURED = { ...DECLINED, details: [{ issue: "ORDER_ALREADY_CAPTURED", description: "Already captured." }] };

// A fake PayPal API: token, order create (always ORDER1), capture and order lookup.
function fakePayPalApi(options: { capture?: () => Response; lookup?: () => Response } = {}) {
  return fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.method === "POST" && request.url.endsWith("/v2/checkout/orders")) {
      return jsonResponse(201, { id: "ORDER1", status: "CREATED" });
    }
    if (request.url.endsWith("/v2/checkout/orders/ORDER1/capture")) {
      return options.capture?.() ?? jsonResponse(201, capturedOrder("COMPLETED"));
    }
    if (request.method === "GET" && request.url.endsWith("/v2/checkout/orders/ORDER1")) {
      return options.lookup?.() ?? jsonResponse(200, { id: "ORDER1", status: "CREATED" });
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

function calls(requests: RecordedRequest[], suffix: string): RecordedRequest[] {
  return requests.filter((r) => r.url.endsWith(suffix));
}

describe.skipIf(!hasTestDatabase)("payments", () => {
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

  // A $1,000 quote accepted by the client: a pending $600 deposit ($500 + the 10% management fee).
  async function pendingDeposit() {
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
    return { userId, teamId, projectId, paymentId };
  }

  async function depositWithOrder() {
    const seeded = await pendingDeposit();
    await db.update(payment).set({ paypalOrderId: "ORDER1" }).where(eq(payment.id, seeded.paymentId));
    return seeded;
  }

  function fact(paymentId: string, overrides: Partial<CaptureFact> = {}): CaptureFact {
    return {
      paymentId,
      orderId: "ORDER1",
      captureId: "CAPTURE1",
      status: "COMPLETED",
      amountMinor: 60_000,
      currency: "USD",
      capturedAt: null,
      paypalFeeMinor: null,
      platformFeeMinor: null,
      ...overrides,
    };
  }

  async function paymentRow(paymentId: string) {
    const [row] = await db.select().from(payment).where(eq(payment.id, paymentId));
    return row;
  }

  describe("applyCaptureFact", () => {
    it("applies a completed deposit capture once: payment, ledger, project and outbox", async () => {
      const { projectId, paymentId } = await depositWithOrder();
      expect(await applyCaptureFact(db, fact(paymentId, { capturedAt: new Date("2026-10-08T00:00:00Z") }))).toBe("applied");
      expect(await applyCaptureFact(db, fact(paymentId))).toBe("already_applied");

      expect(await paymentRow(paymentId)).toMatchObject({ status: "captured", paypalCaptureId: "CAPTURE1" });
      const project = await findProjectById(db, projectId);
      expect(project?.status).toBe("in_progress");
      // Services spec §5.2 step 4: the deadline runs from PayPal's capture time, for the quote's 14 days.
      expect(project?.deadlineAt?.toISOString()).toBe("2026-10-22T00:00:00.000Z");
      expect((await paymentRow(paymentId))?.capturedAt?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
      expect(await db.select().from(ledgerTransfer)).toHaveLength(1);
      expect(await db.select().from(ledgerBalance)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: ledgerAccounts.clientHeld(projectId), balanceMinor: 50_000 }),
          expect.objectContaining({ account: ledgerAccounts.teamRevenue, balanceMinor: 10_000 }),
        ]),
      );
      const events = await db.select().from(outbox).where(eq(outbox.type, "payment.captured"));
      expect(events).toEqual([
        expect.objectContaining({ projectId, data: expect.objectContaining({ paymentId, captureId: "CAPTURE1" }) }),
      ]);
    });

    it("refuses a capture whose amount or currency differs from the payment", async () => {
      const { paymentId } = await depositWithOrder();

      await expect(applyCaptureFact(db, fact(paymentId, { amountMinor: 59_999 }))).rejects.toThrow(/does not match/);
      await expect(applyCaptureFact(db, fact(paymentId, { currency: "EUR" }))).rejects.toThrow(/does not match/);
      expect((await paymentRow(paymentId))?.status).toBe("pending");
    });

    it("records a pending capture, then applies its completion", async () => {
      const { projectId, paymentId } = await depositWithOrder();
      const versionBefore = (await paymentRow(paymentId))?.version ?? 0;

      expect(await applyCaptureFact(db, fact(paymentId, { status: "PENDING", amountMinor: null, currency: null }))).toBe(
        "pending",
      );
      expect(await paymentRow(paymentId)).toMatchObject({
        status: "pending",
        paypalCaptureId: "CAPTURE1",
        version: versionBefore + 1,
      });
      expect((await findProjectById(db, projectId))?.status).toBe("awaiting_deposit");

      expect(await applyCaptureFact(db, fact(paymentId))).toBe("applied");
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("marks a declined capture failed, once, and leaves the project waiting", async () => {
      const { projectId, paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId, { status: "DECLINED" }))).toBe("failed");
      expect(await applyCaptureFact(db, fact(paymentId, { status: "DECLINED" }))).toBe("already_applied");

      expect(await paymentRow(paymentId)).toMatchObject({ status: "failed", paypalCaptureId: "CAPTURE1" });
      expect((await findProjectById(db, projectId))?.status).toBe("awaiting_deposit");
      expect(await db.select().from(outbox).where(eq(outbox.type, "payment.failed"))).toHaveLength(1);
    });

    it("ignores news about an order the payment no longer uses, unless money moved", async () => {
      const { paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId, { orderId: "OLD", captureId: "C-OLD", status: "DECLINED" }))).toBe(
        "stale",
      );
      await expect(applyCaptureFact(db, fact(paymentId, { orderId: "OLD", captureId: "C-OLD" }))).rejects.toThrow(
        /no longer uses/,
      );
    });

    it("ignores news about a cancelled payment, unless money moved", async () => {
      const { paymentId } = await depositWithOrder();
      await db.update(payment).set({ status: "cancelled" }).where(eq(payment.id, paymentId));

      expect(await applyCaptureFact(db, fact(paymentId, { status: "DECLINED" }))).toBe("stale");
      await expect(applyCaptureFact(db, fact(paymentId))).rejects.toThrow(/cancelled payment/);
      expect((await paymentRow(paymentId))?.status).toBe("cancelled");
    });

    it("keeps the first pending capture when PayPal reports another", async () => {
      const { paymentId } = await depositWithOrder();
      const pending = { status: "PENDING", amountMinor: null, currency: null };

      expect(await applyCaptureFact(db, fact(paymentId, pending))).toBe("pending");
      expect(await applyCaptureFact(db, fact(paymentId, { ...pending, captureId: "CAPTURE2" }))).toBe("stale");
      expect((await paymentRow(paymentId))?.paypalCaptureId).toBe("CAPTURE1");
    });

    it("refuses a second capture for the same payment", async () => {
      const { paymentId } = await depositWithOrder();
      await applyCaptureFact(db, fact(paymentId));

      await expect(applyCaptureFact(db, fact(paymentId, { captureId: "CAPTURE2" }))).rejects.toThrow(/already has capture/);
    });

    it("records the fees once, with the capture or from a later fact", async () => {
      const { projectId, paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId))).toBe("applied");
      expect(await paymentRow(paymentId)).toMatchObject({ paypalFeeMinor: null });

      const withFees = fact(paymentId, { paypalFeeMinor: 2_370, platformFeeMinor: 600 });
      expect(await applyCaptureFact(db, withFees)).toBe("already_applied");
      expect(await applyCaptureFact(db, withFees)).toBe("already_applied");

      expect(await paymentRow(paymentId)).toMatchObject({ paypalFeeMinor: 2_370, platformFeeMinor: 600 });
      const fees = await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "payment_fees"));
      expect(fees).toHaveLength(1);
      expect(fees[0]?.projectId).toBe(projectId);
      expect(await db.select().from(ledgerBalance)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: ledgerAccounts.teamRevenue, balanceMinor: 10_000 - 2_970 }),
          expect.objectContaining({ account: ledgerAccounts.paypalFees, balanceMinor: 2_370 }),
          expect.objectContaining({ account: ledgerAccounts.payleorFees, balanceMinor: 600 }),
        ]),
      );
    });

    it("keeps a committed capture applied when its fee step fails", async () => {
      const { paymentId } = await depositWithOrder();

      // The payment's check constraint refuses a platform fee above the amount.
      expect(await applyCaptureFact(db, fact(paymentId, { paypalFeeMinor: 100, platformFeeMinor: 70_000 }))).toBe("applied");

      expect(await paymentRow(paymentId)).toMatchObject({ status: "captured", paypalFeeMinor: null });
      expect(await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "payment_fees"))).toHaveLength(0);
    });

    it("reports money PayPal moved without Payleor asking as a conflict", async () => {
      const { paymentId } = await depositWithOrder();
      await expect(applyCaptureFact(db, fact(paymentId, { amountMinor: 1 }))).rejects.toBeInstanceOf(CaptureFactConflict);
      await applyCaptureFact(db, fact(paymentId));
      await expect(applyCaptureFact(db, fact(paymentId, { captureId: "CAPTURE2" }))).rejects.toBeInstanceOf(CaptureFactConflict);
    });
  });

  async function connectedDeposit() {
    const seeded = await pendingDeposit();
    await markTeamPayPalMerchant(db, { teamId: seeded.teamId, merchantId: "SELLER1" });
    return { ...seeded, token: await signPayLink(SECRET, seeded.paymentId) };
  }

  describe("payment router", () => {
    it("shows the pay page with the SDK settings and a way back to the project", async () => {
      const { projectId, paymentId, token } = await connectedDeposit();
      const { fetch } = fakePayPalApi();

      const page = await callerFor(null, makePayPal(fetch)).payment.payGet({ token });

      expect(page).toMatchObject({
        payment: {
          id: paymentId,
          kind: "deposit",
          status: "pending",
          processing: false,
          currency: "USD",
          amountMinor: 60_000,
        },
        project: { id: projectId, title: "Website redesign" },
        team: { name: "team" },
        paypal: {
          clientId: "partner-client-id",
          partnerAttributionId: "PAYLEOR_BN",
          environment: "sandbox",
          merchantId: "SELLER1",
        },
        clientPath: `/c/${await signClientLink(SECRET, projectId)}`,
      });
      await expect(callerFor(null).payment.payGet({ token: `${paymentId}.bad` })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("says PayPal is not available while the team is not connected", async () => {
      const { paymentId } = await pendingDeposit();
      const { fetch } = fakePayPalApi();
      const token = await signPayLink(SECRET, paymentId);

      expect((await callerFor(null, makePayPal(fetch)).payment.payGet({ token })).paypal).toBeNull();
      await expect(callerFor(null, makePayPal(fetch)).payment.payStart({ token })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await expect(callerFor(null).payment.payStart({ token })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("limits how often one payment can be started or captured", async () => {
      const { token } = await connectedDeposit();
      const { fetch } = fakePayPalApi({ capture: () => jsonResponse(422, DECLINED) });
      const caller = callerFor(null, makePayPal(fetch));

      for (let i = 0; i < 10; i++) await caller.payment.payStart({ token });
      await expect(caller.payment.payStart({ token })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

      for (let i = 0; i < 20; i++) {
        await expect(caller.payment.payCapture({ token, orderId: "ORDER1" })).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
      }
      await expect(caller.payment.payCapture({ token, orderId: "ORDER1" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("creates an order for the team with Payleor's 1% Team fee", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi();

      expect(await callerFor(null, makePayPal(fetch)).payment.payStart({ token })).toEqual({ orderId: "ORDER1" });

      const [create] = calls(requests, "/v2/checkout/orders");
      expect(create?.headers.get("paypal-request-id")).toMatch(/^order:/);
      expect(create?.headers.get("paypal-auth-assertion")).toBe(
        buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER1" }),
      );
      expect(JSON.parse(create?.body ?? "{}").purchase_units[0]).toMatchObject({
        custom_id: paymentId,
        description: "Website redesign",
        amount: { currency_code: "USD", value: "600.00", breakdown: { item_total: { currency_code: "USD", value: "600.00" } } },
        payee: { merchant_id: "SELLER1" },
        payment_instruction: { platform_fees: [{ amount: { currency_code: "USD", value: "6.00" } }] },
        items: [
          { name: "Deposit (50% of the quote)", quantity: "1", unit_amount: { currency_code: "USD", value: "500.00" } },
          { name: "Management fee (10%)", quantity: "1", unit_amount: { currency_code: "USD", value: "100.00" } },
        ],
      });
      expect(await paymentRow(paymentId)).toMatchObject({ paypalOrderId: "ORDER1", platformFeeMinor: 600, status: "pending" });
    });

    it("captures the deposit, starts the work, and answers a repeated capture without calling PayPal again", async () => {
      const { projectId, paymentId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi({
        capture: () => jsonResponse(201, capturedOrder("COMPLETED", "600.00", FEE_BREAKDOWN)),
      });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "captured" });
      expect(await paymentRow(paymentId)).toMatchObject({ paypalFeeMinor: 2_370, platformFeeMinor: 600 });
      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "captured" });

      expect(calls(requests, "/capture")).toHaveLength(1);
      expect(calls(requests, "/capture")[0]?.headers.get("paypal-request-id")).toMatch(/^capture:ORDER1:/);
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("lets the client choose another way to pay after INSTRUMENT_DECLINED", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi({
        capture: () => jsonResponse(422, DECLINED),
        lookup: () => jsonResponse(200, { id: "ORDER1", status: "APPROVED" }),
      });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      const rejection = await caller.payment.payCapture({ token, orderId: "ORDER1" }).catch((error: unknown) => error);
      expect(rejection).toMatchObject({
        code: "UNPROCESSABLE_CONTENT",
        message: "PayPal declined this payment method. Choose another way to pay.",
      });
      const cause = (rejection as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(PayPalError);
      expect(cause).toMatchObject({ debugId: "d422" });
      expect((await paymentRow(paymentId))?.status).toBe("pending");
      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });
      expect(calls(requests, "/v2/checkout/orders")).toHaveLength(1);
    });

    it("applies the capture from the order when PayPal says it is already captured", async () => {
      const { projectId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi({
        capture: () => jsonResponse(422, ALREADY_CAPTURED),
        lookup: () => jsonResponse(200, capturedOrder("COMPLETED")),
      });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "captured" });

      expect(requests.some((r) => r.method === "GET" && r.url.endsWith("/v2/checkout/orders/ORDER1"))).toBe(true);
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("reports a declined capture and lets the client start again", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi({
        capture: () => jsonResponse(201, capturedOrder("DECLINED")),
        lookup: () => jsonResponse(200, capturedOrder("DECLINED")),
      });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "declined" });
      expect((await paymentRow(paymentId))?.status).toBe("failed");

      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });
      expect(calls(requests, "/v2/checkout/orders")).toHaveLength(2);
      expect(await paymentRow(paymentId)).toMatchObject({ status: "pending", paypalCaptureId: null });
    });

    it("reports a pending capture and refuses to start a second order while PayPal finishes it", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { fetch } = fakePayPalApi({ capture: () => jsonResponse(201, capturedOrder("PENDING")) });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "pending" });
      expect(await paymentRow(paymentId)).toMatchObject({ status: "pending", paypalCaptureId: "CAPTURE1" });
      await expect(caller.payment.payStart({ token })).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("refuses to capture an order the payment no longer uses", async () => {
      const { token } = await connectedDeposit();
      const { fetch } = fakePayPalApi();
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      await expect(caller.payment.payCapture({ token, orderId: "ORDER9" })).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("reuses the current order instead of creating another", async () => {
      const { token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi();
      const caller = callerFor(null, makePayPal(fetch));

      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });
      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });

      expect(calls(requests, "/v2/checkout/orders")).toHaveLength(1);
      expect(calls(requests, "/v2/checkout/orders/ORDER1").filter((r) => r.method === "GET")).toHaveLength(1);
    });

    it("applies a capture PayPal took before a restart, after its answer was lost", async () => {
      const { projectId, paymentId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi({ lookup: () => jsonResponse(200, capturedOrder("COMPLETED")) });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      await expect(caller.payment.payStart({ token })).rejects.toMatchObject({
        code: "CONFLICT",
        message: "This payment is already paid.",
      });

      expect(calls(requests, "/capture")).toHaveLength(0);
      expect(calls(requests, "/v2/checkout/orders")).toHaveLength(1);
      expect((await paymentRow(paymentId))?.status).toBe("captured");
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("creates a new order once PayPal has let the old one expire", async () => {
      const { token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi({
        lookup: () => jsonResponse(404, { name: "RESOURCE_NOT_FOUND", message: "Not found", debug_id: "d404" }),
      });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });
      expect(calls(requests, "/v2/checkout/orders")).toHaveLength(2);
    });

    it("refuses to capture a cancelled or failed payment without calling PayPal", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi();
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      await db.update(payment).set({ status: "cancelled" }).where(eq(payment.id, paymentId));
      await expect(caller.payment.payCapture({ token, orderId: "ORDER1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await db.update(payment).set({ status: "failed" }).where(eq(payment.id, paymentId));
      await expect(caller.payment.payCapture({ token, orderId: "ORDER1" })).rejects.toMatchObject({ code: "CONFLICT" });

      expect(calls(requests, "/capture")).toHaveLength(0);
    });

    it("recovers a capture whose answer failed with a server error", async () => {
      const { projectId, token } = await connectedDeposit();
      const { fetch } = fakePayPalApi({
        capture: () => jsonResponse(500, { name: "INTERNAL_SERVER_ERROR", message: "x", debug_id: "d500" }),
        lookup: () => jsonResponse(200, capturedOrder("COMPLETED")),
      });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "captured" });
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("keeps the capture's own error when the order lookup fails too", async () => {
      const { token } = await connectedDeposit();
      const { fetch } = fakePayPalApi({
        capture: () => jsonResponse(500, { name: "INTERNAL_SERVER_ERROR", message: "x", debug_id: "d500" }),
        lookup: () => jsonResponse(403, { name: "NOT_AUTHORIZED", message: "x", debug_id: "d403" }),
      });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      const rejection = await caller.payment.payCapture({ token, orderId: "ORDER1" }).catch((error: unknown) => error);
      expect(rejection).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      const cause = (rejection as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(PayPalError);
      expect(cause).toMatchObject({ debugId: "d500" });
    });

    it("restarts in one go after a declined capture whose answer was lost", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi({ lookup: () => jsonResponse(200, capturedOrder("DECLINED")) });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });
      expect(calls(requests, "/v2/checkout/orders")).toHaveLength(2);
      expect(await paymentRow(paymentId)).toMatchObject({ status: "pending", paypalCaptureId: null });
    });
  });

  describe("balance", () => {
    // The deposit captured, the work delivered and accepted: a pending $500 balance (no fee left to pay).
    async function awaitingBalance() {
      const seeded = await connectedDeposit();
      // PayPal order and capture ids are unique across payments; the balance gets ORDER1 and CAPTURE1.
      await db.update(payment).set({ paypalOrderId: "ORDER-DEPOSIT" }).where(eq(payment.id, seeded.paymentId));
      const deposit = fact(seeded.paymentId, { orderId: "ORDER-DEPOSIT", captureId: "CAPTURE-DEPOSIT" });
      expect(await applyCaptureFact(db, deposit)).toBe("applied");
      const project = await findProjectById(db, seeded.projectId);
      const freelancerId = project?.assignedFreelancerId;
      if (!freelancerId) throw new Error("no freelancer");
      const { deliveryId } = await callerFor(freelancerId).project.deliver({
        teamSlug: "team",
        projectId: seeded.projectId,
        note: "Here it is",
      });
      const clientToken = await signClientLink(SECRET, seeded.projectId);
      const { balancePaymentId } = await callerFor(null).project.clientAcceptDelivery({ token: clientToken, deliveryId });
      if (!balancePaymentId) throw new Error("no balance payment");
      return {
        projectId: seeded.projectId,
        freelancerId,
        balancePaymentId,
        token: await signPayLink(SECRET, balancePaymentId),
      };
    }

    function balanceFact(paymentId: string): CaptureFact {
      return fact(paymentId, { amountMinor: 50_000 });
    }

    async function balanceOf(account: string) {
      const [row] = await db.select().from(ledgerBalance).where(eq(ledgerBalance.account, account));
      return row?.balanceMinor ?? 0;
    }

    async function outboxTypes(projectId: string) {
      const rows = await db.select().from(outbox).where(eq(outbox.projectId, projectId));
      return rows.sort((a, b) => a.sequence - b.sequence).map((e) => e.type);
    }

    async function expectCompleted(projectId: string, freelancerId: string) {
      expect((await findProjectById(db, projectId))?.status).toBe("completed");
      expect(await balanceOf(ledgerAccounts.clientHeld(projectId))).toBe(0);
      // The $100 management fee plus the 15% team cut of the $1,000 final price.
      expect(await balanceOf(ledgerAccounts.teamRevenue)).toBe(10_000 + 15_000);
      expect(await balanceOf(`owed:${freelancerId}:available`)).toBe(85_000);
      expect((await outboxTypes(projectId)).slice(-2)).toEqual(["payment.captured", "project.completed"]);
      const [completed] = await db.select().from(outbox).where(eq(outbox.type, "project.completed"));
      expect(completed?.data).toEqual({ finalPriceMinor: 100_000 });
    }

    it("starts the balance payment and completes the project with its capture", async () => {
      const { projectId, freelancerId, balancePaymentId, token } = await awaitingBalance();
      const { requests, fetch } = fakePayPalApi({
        capture: () => jsonResponse(201, capturedOrder("COMPLETED", "500.00")),
      });
      const caller = callerFor(null, makePayPal(fetch));

      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });
      const [create] = calls(requests, "/v2/checkout/orders");
      expect(JSON.parse(create?.body ?? "{}").purchase_units[0]).toMatchObject({
        amount: { currency_code: "USD", value: "500.00" },
        items: [{ name: "Balance", unit_amount: { currency_code: "USD", value: "500.00" } }],
      });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "captured" });
      expect(await paymentRow(balancePaymentId)).toMatchObject({ status: "captured", paypalCaptureId: "CAPTURE1" });
      // The webhook for the same capture arrives afterwards.
      expect(await applyCaptureFact(db, balanceFact(balancePaymentId))).toBe("already_applied");
      await expectCompleted(projectId, freelancerId);
    });

    it("completes the project from a webhook capture, and posts the completion once", async () => {
      const { projectId, freelancerId, balancePaymentId } = await awaitingBalance();
      await db.update(payment).set({ paypalOrderId: "ORDER1" }).where(eq(payment.id, balancePaymentId));

      expect(await applyCaptureFact(db, balanceFact(balancePaymentId))).toBe("applied");
      expect(await applyCaptureFact(db, balanceFact(balancePaymentId))).toBe("already_applied");

      await expectCompleted(projectId, freelancerId);
      expect(await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.reference, `completion:${projectId}`))).toHaveLength(1);
      expect(await db.select().from(outbox).where(eq(outbox.type, "project.completed"))).toHaveLength(1);
    });
  });

  it("gives the client page a pay path for a payment that can be paid, and none once it is paid", async () => {
    const { projectId, paymentId, token } = await connectedDeposit();
    const clientToken = await signClientLink(SECRET, projectId);

    const before = await callerFor(null).project.clientGet({ token: clientToken });
    const payPath = before.payments[0]?.payPath ?? "";
    expect(payPath).toBe(`/pay/${token}`);
    expect(await verifyPayLink(SECRET, payPath.slice("/pay/".length))).toBe(paymentId);
    expect(before.payments[0]?.processing).toBe(false);

    await db.update(payment).set({ paypalCaptureId: "CAPTURE-PENDING" }).where(eq(payment.id, paymentId));
    const processing = await callerFor(null).project.clientGet({ token: clientToken });
    expect(processing.payments[0]?.processing).toBe(true);
    await db.update(payment).set({ paypalCaptureId: null }).where(eq(payment.id, paymentId));

    await db.update(payment).set({ paypalOrderId: "ORDER1" }).where(eq(payment.id, paymentId));
    await applyCaptureFact(db, fact(paymentId));
    const after = await callerFor(null).project.clientGet({ token: clientToken });
    expect(after.payments[0]?.payPath).toBeNull();
  });
});
