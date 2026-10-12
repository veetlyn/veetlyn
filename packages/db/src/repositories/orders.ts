import type { CaptureReviewReason } from "@jendal-workspace/core";
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";

import type { DbExecutor, Transaction } from "../executor";
import { downloadGrant, orders } from "../schema/orders";

export type OrderRow = typeof orders.$inferSelect;
export type DownloadGrantRow = typeof downloadGrant.$inferSelect;
export type NewOrder = Pick<
  typeof orders.$inferInsert,
  "teamId" | "productId" | "productTitle" | "buyerEmail" | "currency" | "amountMinor" | "checkoutSecretHash"
>;
export type TeamOrderRow = Pick<
  OrderRow,
  | "id"
  | "productTitle"
  | "buyerEmail"
  | "amountMinor"
  | "currency"
  | "status"
  | "createdAt"
  | "paidAt"
  | "refundedAt"
  | "reviewReason"
>;

export async function insertOrder(db: DbExecutor, values: NewOrder): Promise<OrderRow> {
  const [row] = await db.insert(orders).values(values).returning();
  if (!row) throw new Error("Insert into orders returned no row");
  return row;
}

export async function setOrderPayPalOrder(
  db: DbExecutor,
  orderId: string,
  input: { paypalOrderId: string; platformFeeMinor: number | null },
): Promise<void> {
  await db
    .update(orders)
    .set({ paypalOrderId: input.paypalOrderId, platformFeeMinor: input.platformFeeMinor })
    .where(eq(orders.id, orderId));
}

export async function findOrderById(db: DbExecutor, id: string): Promise<OrderRow | null> {
  const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return row ?? null;
}

export async function findOrderByPayPalOrderId(db: DbExecutor, paypalOrderId: string): Promise<OrderRow | null> {
  const [row] = await db.select().from(orders).where(eq(orders.paypalOrderId, paypalOrderId)).limit(1);
  return row ?? null;
}

export async function findOrderByCaptureId(db: DbExecutor, captureId: string): Promise<OrderRow | null> {
  const [row] = await db.select().from(orders).where(eq(orders.paypalCaptureId, captureId)).limit(1);
  return row ?? null;
}

// Holds the order until the transaction ends, so the capture call and the webhook cannot both apply a capture.
export async function lockOrder(tx: Transaction, id: string): Promise<OrderRow | null> {
  const [row] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1).for("update");
  return row ?? null;
}

// Returns whether this call moved the order out of pending.
export async function markOrderPaid(
  db: DbExecutor,
  input: { orderId: string; captureId: string; paidAt: Date },
): Promise<boolean> {
  const rows = await db
    .update(orders)
    .set({ status: "paid", paypalCaptureId: input.captureId, paidAt: input.paidAt })
    .where(and(eq(orders.id, input.orderId), eq(orders.status, "pending")))
    .returning({ id: orders.id });
  return rows.length > 0;
}

export async function setOrderFees(
  db: DbExecutor,
  input: { orderId: string; paypalFeeMinor: number | null; platformFeeMinor: number | null },
): Promise<void> {
  await db
    .update(orders)
    .set({ paypalFeeMinor: input.paypalFeeMinor, platformFeeMinor: input.platformFeeMinor })
    .where(eq(orders.id, input.orderId));
}

// Returns whether this call refunded the order; a second refund event for the same order changes nothing.
export async function markOrderRefunded(
  db: DbExecutor,
  input: { orderId: string; refundedAt: Date },
): Promise<boolean> {
  const rows = await db
    .update(orders)
    .set({ status: "refunded", refundedAt: input.refundedAt })
    .where(and(eq(orders.id, input.orderId), eq(orders.status, "paid")))
    .returning({ id: orders.id });
  return rows.length > 0;
}

export async function setOrderReviewReason(db: DbExecutor, orderId: string, reason: CaptureReviewReason): Promise<void> {
  await db.update(orders).set({ reviewReason: reason }).where(eq(orders.id, orderId));
}

export async function revokeOrderGrants(db: DbExecutor, orderId: string, now: Date): Promise<void> {
  await db
    .update(downloadGrant)
    .set({ revokedAt: now })
    .where(and(eq(downloadGrant.orderId, orderId), isNull(downloadGrant.revokedAt)));
}

export async function insertGrant(
  db: DbExecutor,
  values: { orderId: string; tokenHash: string; expiresAt: Date; downloadsLeft: number },
): Promise<DownloadGrantRow> {
  const [row] = await db.insert(downloadGrant).values(values).returning();
  if (!row) throw new Error("Insert into download_grant returned no row");
  return row;
}

export async function findGrantByTokenHash(
  db: DbExecutor,
  tokenHash: string,
): Promise<{ grant: DownloadGrantRow; order: OrderRow } | null> {
  const [row] = await db
    .select({ grant: downloadGrant, order: orders })
    .from(downloadGrant)
    .innerJoin(orders, eq(orders.id, downloadGrant.orderId))
    .where(eq(downloadGrant.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

// One conditional update, so concurrent downloads can never spend more than the grant holds.
export async function useDownload(db: DbExecutor, grantId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(downloadGrant)
    .set({ downloadsLeft: sql`${downloadGrant.downloadsLeft} - 1` })
    .where(
      and(
        eq(downloadGrant.id, grantId),
        gt(downloadGrant.downloadsLeft, 0),
        gt(downloadGrant.expiresAt, now),
        isNull(downloadGrant.revokedAt),
      ),
    )
    .returning({ id: downloadGrant.id });
  return rows.length > 0;
}

// A pending order with a capture id may still complete, so only orders PayPal never captured are removed.
export async function deleteAbandonedOrders(
  db: DbExecutor,
  input: { createdBefore: Date; limit: number },
): Promise<number> {
  const batch = db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending"), isNull(orders.paypalCaptureId), lt(orders.createdAt, input.createdBefore)))
    .orderBy(asc(orders.createdAt))
    .limit(input.limit);
  const rows = await db.delete(orders).where(inArray(orders.id, batch)).returning({ id: orders.id });
  return rows.length;
}

// Pending orders are abandoned checkouts and never shown.
export async function listTeamOrders(db: DbExecutor, teamId: string): Promise<TeamOrderRow[]> {
  return db
    .select({
      id: orders.id,
      productTitle: orders.productTitle,
      buyerEmail: orders.buyerEmail,
      amountMinor: orders.amountMinor,
      currency: orders.currency,
      status: orders.status,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      refundedAt: orders.refundedAt,
      reviewReason: orders.reviewReason,
    })
    .from(orders)
    .where(and(eq(orders.teamId, teamId), inArray(orders.status, ["paid", "refunded"])))
    .orderBy(desc(orders.createdAt), desc(orders.id));
}
