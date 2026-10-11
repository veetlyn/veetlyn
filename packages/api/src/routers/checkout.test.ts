import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, hashToken } from "@jendal-workspace/core";
import { setServicesTeamStoreEnabled } from "@jendal-workspace/db/repositories/services-teams";
import { products } from "@jendal-workspace/db/schema/catalog";
import { ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { downloadGrant, orders } from "@jendal-workspace/db/schema/orders";
import { team } from "@jendal-workspace/db/schema/organization";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProduct,
  seedProductFile,
  seedServicesTeam,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer, type FakeMailer } from "@jendal-workspace/email/fake";
import { createPayPalClient } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { PayPalServices } from "../context";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

const FEE_BREAKDOWN = {
  create_time: "2026-10-10T00:00:00Z",
  seller_receivable_breakdown: {
    gross_amount: { currency_code: "USD", value: "19.00" },
    paypal_fee: { currency_code: "USD", value: "1.21" },
    platform_fees: [{ amount: { currency_code: "USD", value: "0.19" } }],
    net_amount: { currency_code: "USD", value: "17.60" },
  },
};

const DECLINED = {
  name: "UNPROCESSABLE_ENTITY",
  message: "The requested action could not be performed.",
  debug_id: "d422",
  details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was declined." }],
};

const ALREADY_CAPTURED = { ...DECLINED, details: [{ issue: "ORDER_ALREADY_CAPTURED", description: "Already captured." }] };

function capturedOrder(status: string, value = "19.00", extra: Record<string, unknown> = {}) {
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
      return options.capture?.() ?? jsonResponse(201, capturedOrder("COMPLETED", "19.00", FEE_BREAKDOWN));
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

function calls(requests: RecordedRequest[], suffix: string): RecordedRequest[] {
  return requests.filter((r) => r.url.endsWith(suffix));
}

function orderPathOf(result: { outcome: string; orderPath?: string }): string {
  if (!result.orderPath) throw new Error(`No order path in a ${result.outcome} outcome`);
  return result.orderPath;
}

const notForSale = { code: "NOT_FOUND", message: "This product is not for sale." };
const notValid = { code: "NOT_FOUND", message: "This checkout is not valid." };

describe.skipIf(!hasTestDatabase)("checkout router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function callerFor(options: { paypal?: PayPalServices; mailer?: FakeMailer; ip?: string } = {}) {
    return appRouter.createCaller({
      db,
      session: null,
      environment: "sandbox",
      auth,
      headers: new Headers({ "cf-connecting-ip": options.ip ?? "203.0.113.9" }),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
      paypal: options.paypal,
      email: options.mailer
        ? {
            mailer: options.mailer,
            siteOrigin: "https://payleor.test",
            adminOrigin: "https://admin.payleor.test",
            storeOrigin: (slug: string) => `https://${slug}.payleor.test`,
          }
        : undefined,
    });
  }

  // An active services team connected to PayPal, its store on, and a published $19 digital product with a file.
  async function seller() {
    const { organizationId } = await seedOrganization(db);
    const row = await seedServicesTeam(db, { organizationId, slug: "pixels", name: "Pixel Shop", status: "active" });
    await db
      .update(team)
      .set({ paypalMerchantId: "SELLER1", supportEmail: "support@pixels.test" })
      .where(eq(team.id, row.id));
    await setServicesTeamStoreEnabled(db, row.id, true);
    const product = await seedProduct(db, {
      storeId: row.id,
      kind: "digital",
      status: "published",
      priceMinor: 1900,
      title: "Icon pack",
    });
    await db.update(products).set({ description: "200 icons." }).where(eq(products.id, product.id));
    await seedProductFile(db, { teamId: row.id, productId: product.id });
    return { organizationId, teamId: row.id, productId: product.id };
  }

  async function onlyOrder() {
    const rows = await db.select().from(orders);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error("No order");
    return row;
  }

  async function grantsOf(orderId: string) {
    return db.select().from(downloadGrant).where(eq(downloadGrant.orderId, orderId));
  }

  async function transfersOf(teamId: string) {
    return db.select().from(ledgerTransfer).where(eq(ledgerTransfer.teamId, teamId));
  }

  async function started(options: { capture?: () => Response; lookup?: () => Response } = {}) {
    const seeded = await seller();
    const api = fakePayPalApi(options);
    const mailer = createFakeMailer();
    const caller = callerFor({ paypal: makePayPal(api.fetch), mailer });
    const { secret } = await caller.checkout.start({ slug: "pixels", productId: seeded.productId, email: "jo@example.com" });
    return { ...seeded, caller, mailer, secret, requests: api.requests };
  }

  describe("get", () => {
    it("returns the product, the currency, the team and PayPal's browser settings", async () => {
      const { productId } = await seller();
      const { fetch } = fakePayPalApi();

      await expect(callerFor({ paypal: makePayPal(fetch) }).checkout.get({ slug: "pixels", productId })).resolves.toEqual({
        product: { id: productId, title: "Icon pack", description: "200 icons.", priceMinor: 1900 },
        currency: "USD",
        team: { name: "Pixel Shop" },
        paypal: {
          clientId: "partner-client-id",
          partnerAttributionId: "PAYLEOR_BN",
          environment: "sandbox",
          merchantId: "SELLER1",
        },
      });
    });

    it("says the product is not for sale unless the team, the store and the product all sell it", async () => {
      const { organizationId, teamId, productId } = await seller();
      const caller = callerFor();
      const get = (input: { slug?: string; productId?: string } = {}) =>
        caller.checkout.get({ slug: input.slug ?? "pixels", productId: input.productId ?? productId });

      await db.update(team).set({ status: "draft" }).where(eq(team.id, teamId));
      await expect(get()).rejects.toMatchObject(notForSale);
      await db.update(team).set({ status: "active" }).where(eq(team.id, teamId));

      await setServicesTeamStoreEnabled(db, teamId, false);
      await expect(get()).rejects.toMatchObject(notForSale);
      await setServicesTeamStoreEnabled(db, teamId, true);

      const draft = await seedProduct(db, { storeId: teamId, kind: "digital", status: "draft", priceMinor: 900 });
      await expect(get({ productId: draft.id })).rejects.toMatchObject(notForSale);

      const physical = await seedProduct(db, { storeId: teamId, kind: "physical", status: "published", priceMinor: 900 });
      await expect(get({ productId: physical.id })).rejects.toMatchObject(notForSale);

      const other = await seedServicesTeam(db, { organizationId, slug: "other", status: "active" });
      await setServicesTeamStoreEnabled(db, other.id, true);
      const foreign = await seedProduct(db, { storeId: other.id, kind: "digital", status: "published", priceMinor: 900 });
      await expect(get({ productId: foreign.id })).rejects.toMatchObject(notForSale);

      await expect(get({ slug: "nobody" })).rejects.toMatchObject(notForSale);
      await expect(get()).resolves.toMatchObject({ product: { id: productId }, paypal: null });
    });
  });

  describe("start", () => {
    it("creates a pending order and a PayPal order for the seller with Payleor's fee", async () => {
      const { teamId, productId } = await seller();
      const { requests, fetch } = fakePayPalApi();

      const result = await callerFor({ paypal: makePayPal(fetch) }).checkout.start({
        slug: "pixels",
        productId,
        email: "  Jo@Example.com ",
      });
      expect(result).toEqual({ orderId: "ORDER1", secret: expect.any(String) });
      expect(result.secret).toHaveLength(43);

      const order = await onlyOrder();
      expect(order).toMatchObject({
        teamId,
        productId,
        status: "pending",
        buyerEmail: "jo@example.com",
        productTitle: "Icon pack",
        currency: "USD",
        amountMinor: 1900,
        platformFeeMinor: 19,
        paypalOrderId: "ORDER1",
        paypalCaptureId: null,
        checkoutSecretHash: await hashToken(result.secret),
      });

      const [create] = calls(requests, "/v2/checkout/orders");
      expect(create?.headers.get("paypal-request-id")).toMatch(/^checkout:/);
      expect(JSON.parse(create?.body ?? "{}").purchase_units[0]).toMatchObject({
        custom_id: `order:${order.id}`,
        description: "Icon pack",
        amount: { currency_code: "USD", value: "19.00" },
        payee: { merchant_id: "SELLER1" },
        payment_instruction: { platform_fees: [{ amount: { currency_code: "USD", value: "0.19" } }] },
        items: [{ name: "Icon pack", quantity: "1", unit_amount: { currency_code: "USD", value: "19.00" } }],
      });
    });

    it("refuses a bad email, a product not for sale, a seller without PayPal and a product without a file", async () => {
      const { teamId, productId } = await seller();
      const { requests, fetch } = fakePayPalApi();
      const caller = callerFor({ paypal: makePayPal(fetch) });
      const start = (email = "jo@example.com") => caller.checkout.start({ slug: "pixels", productId, email });

      await expect(start("not-an-email")).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "That email address does not look right.",
      });

      await setServicesTeamStoreEnabled(db, teamId, false);
      await expect(start()).rejects.toMatchObject(notForSale);
      await setServicesTeamStoreEnabled(db, teamId, true);

      await db.update(products).set({ status: "draft" }).where(eq(products.id, productId));
      await expect(start()).rejects.toMatchObject(notForSale);
      await db.update(products).set({ status: "published" }).where(eq(products.id, productId));

      await db.update(team).set({ paypalMerchantId: null }).where(eq(team.id, teamId));
      await expect(start()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "This seller cannot take payments yet.",
      });
      await db.update(team).set({ paypalMerchantId: "SELLER1" }).where(eq(team.id, teamId));

      const bare = await seedProduct(db, { storeId: teamId, kind: "digital", status: "published", priceMinor: 900 });
      await expect(caller.checkout.start({ slug: "pixels", productId: bare.id, email: "jo@example.com" })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "This product is not available right now.",
      });

      expect(await db.select().from(orders)).toHaveLength(0);
      expect(calls(requests, "/v2/checkout/orders")).toHaveLength(0);
    });

    it("limits starts from one IP to 20 in 10 minutes", async () => {
      const { productId } = await seller();
      const { fetch } = fakePayPalApi();
      const caller = callerFor({ paypal: makePayPal(fetch) });
      const start = () => caller.checkout.start({ slug: "pixels", productId, email: "nope" });

      for (let i = 0; i < 20; i++) await expect(start()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(start()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      await expect(
        callerFor({ paypal: makePayPal(fetch), ip: "198.51.100.1" }).checkout.start({ slug: "pixels", productId, email: "nope" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("capture", () => {
    it("marks the order paid, posts it, issues two grants and emails the buyer", async () => {
      const { teamId, caller, mailer, secret } = await started();

      const result = await caller.checkout.capture({ orderId: "ORDER1", secret });
      expect(result).toEqual({ outcome: "captured", orderPath: expect.stringMatching(/^\/orders\/[\w-]{43}$/) });

      const order = await onlyOrder();
      expect(order).toMatchObject({
        status: "paid",
        paypalCaptureId: "CAPTURE1",
        paidAt: new Date("2026-10-10T00:00:00Z"),
        paypalFeeMinor: 121,
        platformFeeMinor: 19,
      });

      const grants = await grantsOf(order.id);
      expect(grants).toHaveLength(2);
      for (const grant of grants) {
        expect(grant.downloadsLeft).toBe(5);
        expect(grant.revokedAt).toBeNull();
        const days = (grant.expiresAt.getTime() - grant.createdAt.getTime()) / 86_400_000;
        expect(days).toBeGreaterThan(6.99);
        expect(days).toBeLessThan(7.01);
      }
      const browserToken = orderPathOf(result).slice("/orders/".length);
      const hashes = grants.map((grant) => grant.tokenHash);
      expect(hashes).toContain(await hashToken(browserToken));

      const transfers = await transfersOf(teamId);
      expect(transfers.map((transfer) => transfer.reference).sort()).toEqual([`order_fees:${order.id}`, `order_paid:${order.id}`]);

      expect(mailer.sent).toHaveLength(1);
      const [message] = mailer.sent;
      expect(message).toMatchObject({
        sender: "stores",
        onBehalfOf: "Pixel Shop",
        replyTo: "support@pixels.test",
        to: "jo@example.com",
        subject: "Your download: Icon pack",
      });
      expect(message?.text).toContain("https://pixels.payleor.test/orders/");
      const emailToken = /https:\/\/pixels\.payleor\.test\/orders\/([\w-]{43})/.exec(message?.text ?? "")?.[1] ?? "";
      expect(emailToken).not.toBe(browserToken);
      expect(hashes).toContain(await hashToken(emailToken));
    });

    it("answers a repeated capture with a new grant, without a second email or posting", async () => {
      const { teamId, caller, mailer, secret, requests } = await started();

      const first = await caller.checkout.capture({ orderId: "ORDER1", secret });
      const second = await caller.checkout.capture({ orderId: "ORDER1", secret });
      expect(second).toEqual({ outcome: "captured", orderPath: expect.stringMatching(/^\/orders\//) });
      expect(orderPathOf(second)).not.toBe(orderPathOf(first));

      const order = await onlyOrder();
      expect(await grantsOf(order.id)).toHaveLength(3);
      expect(mailer.sent).toHaveLength(1);
      expect(await transfersOf(teamId)).toHaveLength(2);
      expect(calls(requests, "/capture")).toHaveLength(1);
    });

    it("reads the capture from the PayPal order when the capture call reports it already captured", async () => {
      const { teamId, caller, mailer, secret } = await started({
        capture: () => jsonResponse(422, ALREADY_CAPTURED),
        lookup: () => jsonResponse(200, capturedOrder("COMPLETED", "19.00", FEE_BREAKDOWN)),
      });

      await expect(caller.checkout.capture({ orderId: "ORDER1", secret })).resolves.toEqual({
        outcome: "captured",
        orderPath: expect.stringMatching(/^\/orders\//),
      });
      const order = await onlyOrder();
      expect(order).toMatchObject({ status: "paid", paypalCaptureId: "CAPTURE1", paypalFeeMinor: 121 });
      expect((await transfersOf(teamId)).map((transfer) => transfer.reference).sort()).toEqual([
        `order_fees:${order.id}`,
        `order_paid:${order.id}`,
      ]);
      expect(mailer.sent).toHaveLength(1);
    });

    it("says the order was refunded when PayPal reports the capture refunded", async () => {
      const { teamId, caller, mailer, secret } = await started({
        capture: () => jsonResponse(422, ALREADY_CAPTURED),
        lookup: () => jsonResponse(200, capturedOrder("REFUNDED")),
      });

      await expect(caller.checkout.capture({ orderId: "ORDER1", secret })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This order was refunded.",
      });
      const order = await onlyOrder();
      expect(order.status).toBe("pending");
      expect(await grantsOf(order.id)).toHaveLength(0);
      expect(await transfersOf(teamId)).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
    });

    it("answers a capture call for a refunded order without a new grant", async () => {
      const { caller, secret } = await started();
      await caller.checkout.capture({ orderId: "ORDER1", secret });
      const order = await onlyOrder();
      await db.update(orders).set({ status: "refunded", refundedAt: new Date() }).where(eq(orders.id, order.id));

      await expect(caller.checkout.capture({ orderId: "ORDER1", secret })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This order was refunded.",
      });
      expect(await grantsOf(order.id)).toHaveLength(2);
    });

    it("still captures when the buyer email fails, and reports the failure", async () => {
      const seeded = await seller();
      const { fetch } = fakePayPalApi();
      const reported: { kind: string; to: string }[] = [];
      const caller = appRouter.createCaller({
        db,
        session: null,
        environment: "sandbox",
        auth,
        headers: new Headers({ "cf-connecting-ip": "203.0.113.9" }),
        catalog: createTestCatalogServices(),
        files: createFakeFileStore(),
        paypal: makePayPal(fetch),
        email: {
          mailer: { send: () => Promise.reject(new Error("provider down")) },
          siteOrigin: "https://payleor.test",
          adminOrigin: "https://admin.payleor.test",
          storeOrigin: (slug: string) => `https://${slug}.payleor.test`,
          onError: (_error, email) => {
            reported.push(email);
          },
        },
      });
      const { secret } = await caller.checkout.start({ slug: "pixels", productId: seeded.productId, email: "jo@example.com" });

      await expect(caller.checkout.capture({ orderId: "ORDER1", secret })).resolves.toMatchObject({ outcome: "captured" });
      expect((await onlyOrder()).status).toBe("paid");
      expect(reported).toEqual([{ kind: "order-download", to: "jo@example.com" }]);
    });

    it("refuses a wrong secret and an unknown PayPal order", async () => {
      const { caller, secret, requests } = await started();

      await expect(caller.checkout.capture({ orderId: "ORDER1", secret: `${secret}x` })).rejects.toMatchObject(notValid);
      await expect(caller.checkout.capture({ orderId: "ORDER2", secret })).rejects.toMatchObject(notValid);
      expect(calls(requests, "/capture")).toHaveLength(0);
      expect((await onlyOrder()).status).toBe("pending");
    });

    it("asks for another way to pay after INSTRUMENT_DECLINED and leaves the order pending", async () => {
      const { caller, secret, mailer } = await started({ capture: () => jsonResponse(422, DECLINED) });

      await expect(caller.checkout.capture({ orderId: "ORDER1", secret })).rejects.toMatchObject({
        code: "UNPROCESSABLE_CONTENT",
        message: "PayPal declined this payment method. Choose another way to pay.",
      });
      const order = await onlyOrder();
      expect(order).toMatchObject({ status: "pending", paypalCaptureId: null });
      expect(await grantsOf(order.id)).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
    });

    it("fails and posts nothing when PayPal captured another amount", async () => {
      const { teamId, caller, secret, mailer } = await started({
        capture: () => jsonResponse(201, capturedOrder("COMPLETED", "10.00", FEE_BREAKDOWN)),
      });

      await expect(caller.checkout.capture({ orderId: "ORDER1", secret })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      const order = await onlyOrder();
      expect(order).toMatchObject({ status: "pending", paypalCaptureId: null, paidAt: null });
      expect(await grantsOf(order.id)).toHaveLength(0);
      expect(await transfersOf(teamId)).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
    });

    it("records a pending capture without paying the order", async () => {
      const { teamId, caller, secret, mailer } = await started({
        capture: () => jsonResponse(201, capturedOrder("PENDING")),
      });

      await expect(caller.checkout.capture({ orderId: "ORDER1", secret })).resolves.toEqual({ outcome: "pending" });
      const order = await onlyOrder();
      expect(order).toMatchObject({ status: "pending", paypalCaptureId: "CAPTURE1" });
      expect(await grantsOf(order.id)).toHaveLength(0);
      expect(await transfersOf(teamId)).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
    });
  });
});
