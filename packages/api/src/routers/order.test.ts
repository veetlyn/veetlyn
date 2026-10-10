import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, hashToken } from "@jendal-workspace/core";
import { downloadGrant, orders } from "@jendal-workspace/db/schema/orders";
import { team } from "@jendal-workspace/db/schema/organization";
import {
  createTestDb,
  hasTestDatabase,
  seedOrder,
  seedProduct,
  seedProductFile,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer, type FakeMailer } from "@jendal-workspace/email/fake";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { issueGrant } from "../use-cases/orders";
import { appRouter } from "./index";

const notValid = { code: "NOT_FOUND", message: "This link is not valid." };
const wasRefunded = { code: "BAD_REQUEST", message: "This order was refunded." };

describe.skipIf(!hasTestDatabase)("order router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function callerFor(
    options: { userId?: string; files?: ReturnType<typeof createFakeFileStore>; mailer?: FakeMailer | null } = {},
  ) {
    const mailer = options.mailer === undefined ? createFakeMailer() : options.mailer;
    return appRouter.createCaller({
      db,
      session: options.userId ? makeSession(options.userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: options.files ?? createFakeFileStore(),
      email: mailer
        ? {
            mailer,
            siteOrigin: "https://payleor.test",
            adminOrigin: "https://admin.payleor.test",
            storeOrigin: (slug: string) => `https://${slug}.payleor.test`,
          }
        : undefined,
    });
  }

  // A seller team with a digital product and its file, and a paid order with a fresh grant.
  async function paidOrder(options: { status?: "pending" | "paid" | "refunded"; grantAt?: Date; file?: boolean } = {}) {
    const seeded = await seedServicesTeamWithAdmin(db, { slug: "pixels" });
    await db.update(team).set({ name: "Pixel Shop" }).where(eq(team.id, seeded.teamId));
    const product = await seedProduct(db, { storeId: seeded.teamId, kind: "digital", status: "published", priceMinor: 1900 });
    const file =
      options.file === false
        ? null
        : await seedProductFile(db, { teamId: seeded.teamId, productId: product.id, fileName: "icons.zip" });
    const order = await seedOrder(db, {
      teamId: seeded.teamId,
      productId: product.id,
      status: options.status ?? "paid",
      buyerEmail: "jo@example.com",
    });
    const token = await issueGrant(db, order.id, options.grantAt);
    return { ...seeded, productId: product.id, file, order, token };
  }

  async function grantsOf(orderId: string) {
    return db.select().from(downloadGrant).where(eq(downloadGrant.orderId, orderId));
  }

  describe("get", () => {
    it("shows the order, the team, the grant and the masked buyer email", async () => {
      const { order, token } = await paidOrder();
      const page = await callerFor().order.get({ token });
      expect(page).toEqual({
        order: {
          productTitle: "Test product",
          amountMinor: 1900,
          currency: "USD",
          status: "paid",
          paidAt: order.paidAt?.toISOString(),
        },
        team: { name: "Pixel Shop" },
        grant: { state: "usable", downloadsLeft: 5, expiresAt: expect.any(String) },
        maskedEmail: "j•@example.com",
      });
      expect(new Date(page.grant.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    });

    it("refuses an unknown token", async () => {
      await expect(callerFor().order.get({ token: "x".repeat(43) })).rejects.toMatchObject(notValid);
    });

    it("reports a refunded order's grant as revoked", async () => {
      const { token } = await paidOrder({ status: "refunded" });
      const page = await callerFor().order.get({ token });
      expect(page.order.status).toBe("refunded");
      expect(page.grant.state).toBe("revoked");
    });
  });

  describe("download", () => {
    it("presigns the product file for 300 seconds and spends a download", async () => {
      const { token, file } = await paidOrder();
      const files = createFakeFileStore();
      const result = await callerFor({ files }).order.download({ token });
      expect(result).toEqual({ url: `https://files.test/${file?.r2Key}?op=get` });
      expect(files.gets).toEqual([{ key: file?.r2Key, fileName: "icons.zip", expiresInSeconds: 300 }]);
      expect((await callerFor().order.get({ token })).grant.downloadsLeft).toBe(4);
    });

    it("refuses a sixth download and shows the grant used up", async () => {
      const { token } = await paidOrder();
      const caller = callerFor();
      for (let i = 0; i < 5; i++) await caller.order.download({ token });
      await expect(caller.order.download({ token })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This link has no downloads left. Ask for a new one.",
      });
      expect((await caller.order.get({ token })).grant.state).toBe("used_up");
    });

    it("refuses an expired grant", async () => {
      const { token } = await paidOrder({ grantAt: new Date(Date.now() - 8 * 86_400_000) });
      await expect(callerFor().order.download({ token })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This link has expired. Ask for a new one.",
      });
    });

    it("refuses a refunded order even when its grant was not revoked", async () => {
      const { token, order } = await paidOrder({ status: "refunded" });
      const files = createFakeFileStore();
      await expect(callerFor({ files }).order.download({ token })).rejects.toMatchObject(wasRefunded);
      expect(files.gets).toEqual([]);
      expect((await grantsOf(order.id))[0]?.downloadsLeft).toBe(5);
    });

    it("refuses when the product has no file, without spending a download", async () => {
      const { token, order } = await paidOrder({ file: false });
      await expect(callerFor().order.download({ token })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "This file is not available. Contact the seller.",
      });
      expect((await grantsOf(order.id))[0]?.downloadsLeft).toBe(5);
    });
  });

  describe("sendNewLink", () => {
    it("issues a new grant and emails its link to the buyer", async () => {
      const { token, order } = await paidOrder();
      await db.update(downloadGrant).set({ downloadsLeft: 0 }).where(eq(downloadGrant.orderId, order.id));
      const mailer = createFakeMailer();
      const result = await callerFor({ mailer }).order.sendNewLink({ token });
      expect(result).toEqual({ sentTo: "j•@example.com" });

      const grants = await grantsOf(order.id);
      expect(grants).toHaveLength(2);
      expect(mailer.sent).toHaveLength(1);
      const message = mailer.sent[0];
      expect(message?.to).toBe("jo@example.com");
      const match = message?.text.match(/https:\/\/pixels\.payleor\.test\/orders\/([A-Za-z0-9_-]+)/);
      const newToken = match?.[1];
      expect(newToken).toBeDefined();
      expect(newToken).not.toBe(token);
      const newHash = await hashToken(newToken ?? "");
      expect(grants.some((grant) => grant.tokenHash === newHash && grant.downloadsLeft === 5)).toBe(true);
    });

    it("allows three new links an hour per order", async () => {
      const { token } = await paidOrder();
      const caller = callerFor();
      for (let i = 0; i < 3; i++) await caller.order.sendNewLink({ token });
      await expect(caller.order.sendNewLink({ token })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("refuses a refunded order", async () => {
      const { token, order } = await paidOrder({ status: "refunded" });
      await expect(callerFor().order.sendNewLink({ token })).rejects.toMatchObject(wasRefunded);
      expect(await grantsOf(order.id)).toHaveLength(1);
    });

    it("treats a pending order's link as not valid", async () => {
      const { token } = await paidOrder({ status: "pending" });
      await expect(callerFor().order.sendNewLink({ token })).rejects.toMatchObject(notValid);
    });

    it("needs email on the server", async () => {
      const { token, order } = await paidOrder();
      await expect(callerFor({ mailer: null }).order.sendNewLink({ token })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "Email is not configured on this server.",
      });
      expect(await grantsOf(order.id)).toHaveLength(1);
    });

    it("fails when the email cannot be sent", async () => {
      const { token } = await paidOrder();
      const failing: FakeMailer = { sent: [], send: () => Promise.reject(new Error("provider down")) };
      await expect(callerFor({ mailer: failing }).order.sendNewLink({ token })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "We could not send the email. Try again in a few minutes.",
      });
    });
  });

  describe("list", () => {
    it("lists paid and refunded orders, newest first, for an admin", async () => {
      const { userId, teamId, productId, order: paid } = await paidOrder();
      const refundedRow = await seedOrder(db, { teamId, productId, status: "refunded" });
      await seedOrder(db, { teamId, productId, status: "pending" });
      await db.update(orders).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(orders.id, paid.id));

      const rows = await callerFor({ userId }).order.list({ teamSlug: "pixels" });
      expect(rows.map((row) => row.id)).toEqual([refundedRow.id, paid.id]);
      expect(rows[0]).toEqual({
        id: refundedRow.id,
        productTitle: "Test product",
        buyerEmail: "buyer@example.com",
        amountMinor: 1900,
        currency: "USD",
        status: "refunded",
        paidAt: refundedRow.paidAt?.toISOString(),
        refundedAt: refundedRow.refundedAt?.toISOString(),
      });
    });

    it("refuses a freelancer", async () => {
      const { organizationId, teamId } = await paidOrder();
      const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
      await expect(callerFor({ userId: freelancer }).order.list({ teamSlug: "pixels" })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Only an admin can see orders.",
      });
    });

    it("hides the team from an outsider", async () => {
      await paidOrder();
      const outsider = await seedUser(db, "Outsider");
      await expect(callerFor({ userId: outsider }).order.list({ teamSlug: "pixels" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
