import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { downloadGrant } from "../schema/orders";
import {
  createTestDb,
  hasTestDatabase,
  seedOrder,
  seedOrganization,
  seedProduct,
  seedServicesTeam,
  truncateAll,
} from "../testing/db";
import {
  findGrantByTokenHash,
  findOrderByCaptureId,
  findOrderById,
  findOrderByPayPalOrderId,
  insertGrant,
  insertOrder,
  listTeamOrders,
  lockOrder,
  markOrderPaid,
  markOrderRefunded,
  revokeOrderGrants,
  setOrderFees,
  setOrderPayPalOrder,
  useDownload,
} from "./orders";

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!hasTestDatabase)("orders repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedSeller() {
    const { organizationId } = await seedOrganization(db);
    const seller = await seedServicesTeam(db, { organizationId, slug: "maker", status: "active" });
    const product = await seedProduct(db, {
      storeId: seller.id,
      title: "Icon pack",
      kind: "digital",
      status: "published",
      priceMinor: 1900,
    });
    return { teamId: seller.id, productId: product.id };
  }

  async function newOrder(teamId: string, productId: string) {
    return insertOrder(db, {
      teamId,
      productId,
      productTitle: "Icon pack",
      buyerEmail: "buyer@example.com",
      currency: "USD",
      amountMinor: 1900,
      checkoutSecretHash: "a".repeat(64),
    });
  }

  it("inserts a pending order and finds it by id, PayPal order and capture", async () => {
    const { teamId, productId } = await seedSeller();
    const order = await newOrder(teamId, productId);
    expect(order).toMatchObject({ teamId, productId, status: "pending", amountMinor: 1900, paypalOrderId: null });

    await setOrderPayPalOrder(db, order.id, { paypalOrderId: "PP-1", platformFeeMinor: 95 });
    expect(await findOrderById(db, order.id)).toMatchObject({ paypalOrderId: "PP-1", platformFeeMinor: 95 });
    expect((await findOrderByPayPalOrderId(db, "PP-1"))?.id).toBe(order.id);
    expect(await findOrderByPayPalOrderId(db, "PP-2")).toBeNull();
    expect(await findOrderByCaptureId(db, "CAP-1")).toBeNull();

    const paidAt = new Date("2026-10-10T12:00:00Z");
    await db.transaction((tx) => markOrderPaid(tx, { orderId: order.id, captureId: "CAP-1", paidAt }));
    expect((await findOrderByCaptureId(db, "CAP-1"))?.id).toBe(order.id);
    expect(await findOrderById(db, "missing")).toBeNull();
  });

  it("locks an order inside a transaction", async () => {
    const { teamId, productId } = await seedSeller();
    const order = await newOrder(teamId, productId);
    const locked = await db.transaction((tx) => lockOrder(tx, order.id));
    expect(locked?.id).toBe(order.id);
    expect(await db.transaction((tx) => lockOrder(tx, "missing"))).toBeNull();
  });

  it("marks an order paid only from pending", async () => {
    const { teamId, productId } = await seedSeller();
    const order = await newOrder(teamId, productId);
    const paidAt = new Date("2026-10-10T12:00:00Z");

    expect(await markOrderPaid(db, { orderId: order.id, captureId: "CAP-1", paidAt })).toBe(true);
    expect(await findOrderById(db, order.id)).toMatchObject({ status: "paid", paypalCaptureId: "CAP-1", paidAt });
    expect(await markOrderPaid(db, { orderId: order.id, captureId: "CAP-2", paidAt: new Date() })).toBe(false);
    expect((await findOrderById(db, order.id))?.paypalCaptureId).toBe("CAP-1");
  });

  it("stores the fees", async () => {
    const { teamId, productId } = await seedSeller();
    const order = await newOrder(teamId, productId);
    await setOrderFees(db, { orderId: order.id, paypalFeeMinor: 85, platformFeeMinor: 95 });
    expect(await findOrderById(db, order.id)).toMatchObject({ paypalFeeMinor: 85, platformFeeMinor: 95 });
  });

  it("refunds a paid order once and revokes its grants", async () => {
    const { teamId, productId } = await seedSeller();
    const order = await seedOrder(db, { teamId, productId, status: "paid", paypalCaptureId: "CAP-1" });
    const pending = await seedOrder(db, { teamId, productId });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * DAY);
    await insertGrant(db, { orderId: order.id, tokenHash: "h1", expiresAt, downloadsLeft: 5 });
    await insertGrant(db, { orderId: order.id, tokenHash: "h2", expiresAt, downloadsLeft: 5 });
    const earlier = new Date(now.getTime() - DAY);
    const revokedEarlier = await insertGrant(db, { orderId: order.id, tokenHash: "h3", expiresAt, downloadsLeft: 5 });
    await db.update(downloadGrant).set({ revokedAt: earlier }).where(eq(downloadGrant.id, revokedEarlier.id));

    expect(await markOrderRefunded(db, { orderId: pending.id, refundedAt: now })).toBe(false);
    expect(await markOrderRefunded(db, { orderId: order.id, refundedAt: now })).toBe(true);
    expect(await findOrderById(db, order.id)).toMatchObject({ status: "refunded", refundedAt: now });
    expect(await markOrderRefunded(db, { orderId: order.id, refundedAt: new Date() })).toBe(false);

    await revokeOrderGrants(db, order.id, now);
    const grants = await db.select().from(downloadGrant).where(eq(downloadGrant.orderId, order.id));
    const byHash = Object.fromEntries(grants.map((g) => [g.tokenHash, g.revokedAt]));
    expect(byHash).toEqual({ h1: now, h2: now, h3: earlier });
  });

  it("finds a grant with its order and spends downloads while the grant is usable", async () => {
    const { teamId, productId } = await seedSeller();
    const order = await seedOrder(db, { teamId, productId, status: "paid" });
    const now = new Date();
    const grant = await insertGrant(db, {
      orderId: order.id,
      tokenHash: "hash",
      expiresAt: new Date(now.getTime() + DAY),
      downloadsLeft: 2,
    });
    expect(grant).toMatchObject({ orderId: order.id, downloadsLeft: 2, revokedAt: null });

    const found = await findGrantByTokenHash(db, "hash");
    expect(found?.grant.id).toBe(grant.id);
    expect(found?.order.id).toBe(order.id);
    expect(await findGrantByTokenHash(db, "other")).toBeNull();

    expect(await useDownload(db, grant.id, now)).toBe(true);
    expect(await useDownload(db, grant.id, now)).toBe(true);
    expect(await useDownload(db, grant.id, now)).toBe(false);
    expect((await findGrantByTokenHash(db, "hash"))?.grant.downloadsLeft).toBe(0);
  });

  it("refuses downloads on an expired or revoked grant", async () => {
    const { teamId, productId } = await seedSeller();
    const order = await seedOrder(db, { teamId, productId, status: "paid" });
    const now = new Date();
    const expired = await insertGrant(db, {
      orderId: order.id,
      tokenHash: "expired",
      expiresAt: new Date(now.getTime() - 1000),
      downloadsLeft: 5,
    });
    expect(await useDownload(db, expired.id, now)).toBe(false);

    const revoked = await insertGrant(db, {
      orderId: order.id,
      tokenHash: "revoked",
      expiresAt: new Date(now.getTime() + DAY),
      downloadsLeft: 5,
    });
    await revokeOrderGrants(db, order.id, now);
    expect(await useDownload(db, revoked.id, now)).toBe(false);
  });

  it("lists a team's paid and refunded orders, newest first", async () => {
    const { teamId, productId } = await seedSeller();
    const { organizationId } = await seedOrganization(db);
    const other = await seedServicesTeam(db, { organizationId, slug: "other" });
    const otherProduct = await seedProduct(db, { storeId: other.id, kind: "digital", status: "published", priceMinor: 500 });

    await seedOrder(db, { teamId, productId });
    const older = await seedOrder(db, { teamId, productId, status: "refunded" });
    const newer = await seedOrder(db, { teamId, productId, status: "paid", buyerEmail: "late@example.com" });
    await seedOrder(db, { teamId: other.id, productId: otherProduct.id, status: "paid" });

    const rows = await listTeamOrders(db, teamId);
    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(rows[0]).toEqual({
      id: newer.id,
      productTitle: "Test product",
      buyerEmail: "late@example.com",
      amountMinor: 1900,
      currency: "USD",
      status: "paid",
      createdAt: newer.createdAt,
      paidAt: newer.paidAt,
      refundedAt: null,
    });
  });
});
