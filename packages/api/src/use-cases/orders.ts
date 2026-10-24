import {
  buyerEmailProblem,
  captureReviewReason,
  type CaptureReviewReason,
  errorName,
  type FileStore,
  DOWNLOADS_PER_GRANT,
  grantExpiry,
  grantState,
  type GrantState,
  hashToken,
  sameHash,
  maskEmail,
  newToken,
  orderCustomId,
  orderFeesTransfer,
  orderPaidTransfer,
  orderRefundedTransfer,
  parseMajorAmount,
  platformFeeMinor,
  refundFeesTransfer,
  sellerPlanFor,
  toPayPalValue,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import { findAttachedProductFile } from "@jendal-workspace/db/repositories/files";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import {
  type DownloadGrantRow,
  findGrantByTokenHash,
  findOrderByPayPalOrderId,
  insertGrant,
  insertOrder,
  listTeamOrders,
  lockOrder,
  markOrderPaid,
  markOrderRefunded,
  type OrderRow,
  revokeOrderGrants,
  setOrderFees,
  setOrderPayPalOrder,
  setOrderReviewReason,
  useDownload,
} from "@jendal-workspace/db/repositories/orders";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { findServicesTeamBySlug, getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import { productVariants, products } from "@jendal-workspace/db/schema/catalog";
import { orders } from "@jendal-workspace/db/schema/orders";
import { team as teamTable } from "@jendal-workspace/db/schema/organization";
import { orderDownloadEmail } from "@jendal-workspace/email";
import {
  captureFromOrder,
  type PayPalCapture,
  PayPalError,
  type PayPalOrder,
  refundsFromOrder,
} from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { log } from "evlog";

import type { EmailServices, PayPalServices } from "../context";
import { captureFees, capturesIn, isRefundedCaptureStatus, postOnce, returnedFees } from "./paypal-amounts";
import { CaptureFactConflict, databaseErrorFields, unconfirmedCapture } from "./payments";
import { deliverDueOutboxDeliveries, fanOutOutboxEvents } from "./outbox-dispatcher";

export type OrderDeps = { db: Database; paypal: PayPalServices; email?: EmailServices };

// One capture of a store order as PayPal reports it: from the capture call, an order lookup or a webhook.
export type OrderCaptureFact = {
  orderId: string;
  paypalOrderId: string;
  captureId: string;
  // COMPLETED, PENDING, DECLINED or FAILED.
  status: string;
  amountMinor: number | null;
  currency: string | null;
  capturedAt: Date | null;
  paypalFeeMinor: number | null;
  platformFeeMinor: number | null;
  reviewReason: CaptureReviewReason | null;
};

// "stale": the fact changes nothing; the order has moved past it.
export type OrderCaptureResult = "applied" | "already_applied" | "pending" | "failed" | "stale";

export type CheckoutOutcome = { outcome: "captured"; orderPath: string } | { outcome: "pending" } | { outcome: "declined" };

const NOT_FOR_SALE = "This product is not for sale.";

function notForSale(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: NOT_FOR_SALE });
}

function invalidCheckout(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "This checkout is not valid." });
}

function refunded(): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: "This order was refunded." });
}

type SellableProduct = {
  team: NonNullable<Awaited<ReturnType<typeof findServicesTeamBySlug>>>;
  settings: NonNullable<Awaited<ReturnType<typeof getServicesTeamSettings>>>;
  product: { id: string; title: string; description: string };
  priceMinor: number;
};

// Sellers design §5.2: only a published digital product of an active team whose store is on is for sale.
export async function sellableProduct(db: Database, input: { slug: string; productId: string }): Promise<SellableProduct> {
  const team = await findServicesTeamBySlug(db, input.slug.trim().toLowerCase());
  if (!team || team.status !== "active") throw notForSale();
  const settings = await getServicesTeamSettings(db, team.id);
  if (!settings?.storeEnabled) throw notForSale();
  const [row] = await db
    .select({
      id: products.id,
      title: products.title,
      description: products.description,
      priceMinor: productVariants.priceMinor,
    })
    .from(products)
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .where(
      and(
        eq(products.storeId, team.id),
        eq(products.id, input.productId),
        eq(products.kind, "digital"),
        eq(products.status, "published"),
      ),
    )
    .orderBy(asc(productVariants.createdAt))
    .limit(1);
  if (!row || row.priceMinor <= 0) throw notForSale();
  return {
    team,
    settings,
    product: { id: row.id, title: row.title, description: row.description },
    priceMinor: row.priceMinor,
  };
}

export async function getCheckout(
  deps: { db: Database; paypal: PayPalServices | undefined },
  input: { slug: string; productId: string },
) {
  const { team, settings, product, priceMinor } = await sellableProduct(deps.db, input);
  return {
    product: { ...product, priceMinor },
    currency: settings.currency,
    team: { name: team.name },
    // Null until the server has PayPal configured and the team has connected its account.
    paypal: deps.paypal && team.paypalMerchantId ? { ...deps.paypal.sdk, merchantId: team.paypalMerchantId } : null,
  };
}

// Sellers design §5.2: each Buy click is a new order and a new PayPal order. The browser gets a secret that
// only it holds; the capture needs it, so a PayPal order id alone cannot claim the download.
export async function startCheckout(
  deps: OrderDeps,
  input: { slug: string; productId: string; email: string },
): Promise<{ orderId: string; secret: string }> {
  const emailProblem = buyerEmailProblem(input.email);
  if (emailProblem) throw new TRPCError({ code: "BAD_REQUEST", message: emailProblem });
  const { team, settings, product, priceMinor } = await sellableProduct(deps.db, input);
  const merchantId = team.paypalMerchantId;
  if (!merchantId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This seller cannot take payments yet." });
  if (!(await findAttachedProductFile(deps.db, product.id))) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This product is not available right now." });
  }
  const secret = newToken();
  const order = await insertOrder(deps.db, {
    teamId: team.id,
    productId: product.id,
    productTitle: product.title,
    buyerEmail: input.email.trim().toLowerCase(),
    currency: settings.currency,
    amountMinor: priceMinor,
    checkoutSecretHash: await hashToken(secret),
  });
  // The platform's fee follows the seller's plan (pricing proposal §1): Solo 2%, Team 1%.
  const fee = platformFeeMinor(priceMinor, sellerPlanFor({ id: team.id, solo: settings.solo }).feeBps);
  const value = toPayPalValue(priceMinor);
  const paypalOrder = await deps.paypal.client.orders.create({
    requestId: `checkout:${order.id}`,
    merchantId,
    currency: order.currency,
    value,
    platformFeeValue: fee > 0 ? toPayPalValue(fee) : null,
    customId: orderCustomId(order.id),
    description: product.title,
    brandName: team.name,
    items: [{ name: product.title, value }],
  });
  await setOrderPayPalOrder(deps.db, order.id, { paypalOrderId: paypalOrder.id, platformFeeMinor: fee });
  return { orderId: paypalOrder.id, secret };
}

export function orderCaptureFact(orderId: string, paypalOrderId: string, capture: PayPalCapture): OrderCaptureFact {
  const currency = capture.amount?.currency_code ?? null;
  const breakdown = capture.seller_receivable_breakdown;
  const fees = breakdown ? captureFees(currency, breakdown) : null;
  const capturedAt = capture.create_time ? new Date(capture.create_time) : null;
  return {
    orderId,
    paypalOrderId,
    captureId: capture.id,
    status: capture.status,
    amountMinor: capture.amount ? parseMajorAmount(capture.amount.value) : null,
    currency,
    capturedAt: capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt : null,
    paypalFeeMinor: fees?.paypalFeeMinor ?? null,
    platformFeeMinor: fees?.platformFeeMinor ?? null,
    reviewReason: breakdown && currency ? captureReviewReason(breakdown, currency) : null,
  };
}

export async function issueGrant(db: DbExecutor, orderId: string, now: Date = new Date()): Promise<string> {
  const token = newToken();
  await insertGrant(db, {
    orderId,
    tokenHash: await hashToken(token),
    expiresAt: grantExpiry(now),
    downloadsLeft: DOWNLOADS_PER_GRANT,
  });
  return token;
}

// Only a still-pending order on that PayPal order takes the capture id; the buyer retries with a new order.
async function recordCaptureId(db: Database, fact: OrderCaptureFact): Promise<boolean> {
  const updated = await db
    .update(orders)
    .set({ paypalCaptureId: fact.captureId })
    .where(
      and(
        eq(orders.id, fact.orderId),
        eq(orders.status, "pending"),
        eq(orders.paypalOrderId, fact.paypalOrderId),
        or(isNull(orders.paypalCaptureId), eq(orders.paypalCaptureId, fact.captureId)),
      ),
    )
    .returning({ id: orders.id });
  return updated.length > 0;
}

export type OrderEmailTeam = { name: string; slug: string; supportEmail: string | null };

export async function findOrderEmailTeam(db: DbExecutor, teamId: string): Promise<OrderEmailTeam | null> {
  const [row] = await db
    .select({ name: teamTable.name, slug: teamTable.slug, supportEmail: teamTable.supportEmail })
    .from(teamTable)
    .where(eq(teamTable.id, teamId))
    .limit(1);
  return row ?? null;
}

type AppliedCompletion =
  | { result: "applied"; order: OrderRow; team: OrderEmailTeam; emailToken: string }
  | { result: "already_applied" };

async function lockOrderOrThrow(tx: Transaction, orderId: string): Promise<OrderRow> {
  const row = await lockOrder(tx, orderId);
  if (!row) throw new Error(`PayPal reported capture news for unknown order ${orderId}`);
  return row;
}

function checkCaptureFact(row: OrderRow, fact: OrderCaptureFact): void {
  if (row.paypalCaptureId && row.paypalCaptureId !== fact.captureId) {
    throw new CaptureFactConflict(`Order ${row.id} already has capture ${row.paypalCaptureId}; PayPal reported ${fact.captureId}`);
  }
  if (row.paypalOrderId !== fact.paypalOrderId) {
    throw new CaptureFactConflict(`Capture ${fact.captureId} completed on PayPal order ${fact.paypalOrderId}, which order ${row.id} does not use`);
  }
}

// For a pending order the caller holds locked and has checked with checkCaptureFact.
async function markLockedOrderPaid(tx: Transaction, row: OrderRow, fact: OrderCaptureFact): Promise<OrderRow> {
  if (fact.amountMinor !== row.amountMinor || fact.currency !== row.currency) {
    throw new CaptureFactConflict(
      `Capture ${fact.captureId} (${fact.currency} ${fact.amountMinor}) does not match order ${row.id} (${row.currency} ${row.amountMinor})`,
    );
  }
  const paidAt = fact.capturedAt ?? new Date();
  if (!(await markOrderPaid(tx, { orderId: row.id, captureId: fact.captureId, paidAt }))) {
    throw new Error(`Order ${row.id} left pending while locked`);
  }
  await createPostgresLedger(row.teamId, tx).post([
    orderPaidTransfer({ currency: row.currency, orderId: row.id, amountMinor: row.amountMinor }),
  ]);
  return { ...row, status: "paid", paypalCaptureId: fact.captureId, paidAt };
}

// The order stays locked for the transaction, so the browser's capture and a webhook cannot both apply it.
function applyCompletion(db: Database, fact: OrderCaptureFact): Promise<AppliedCompletion> {
  return db.transaction(async (tx) => {
    const row = await lockOrderOrThrow(tx, fact.orderId);
    checkCaptureFact(row, fact);
    if (row.status !== "pending") return { result: "already_applied" as const };
    const paid = await markLockedOrderPaid(tx, row, fact);
    // One grant for the buyer email; the browser's capture call issues its own. The email's team is read here
    // too, so nothing between the commit and the send can fail and lose the email.
    const emailToken = await issueGrant(tx, row.id);
    const team = await findOrderEmailTeam(tx, row.teamId);
    if (!team) throw new Error(`Order ${row.id} has no team`);
    return {
      result: "applied" as const,
      order: paid,
      team,
      emailToken,
    };
  });
}

// Applies each capture outcome of an order at most once, whichever input reports it first.
export async function applyOrderCaptureFact(
  deps: { db: Database; email?: EmailServices },
  fact: OrderCaptureFact,
): Promise<OrderCaptureResult> {
  if (fact.status === "PENDING") return (await recordCaptureId(deps.db, fact)) ? "pending" : "stale";
  if (fact.status === "DECLINED" || fact.status === "FAILED") {
    return (await recordCaptureId(deps.db, fact)) ? "failed" : "stale";
  }
  if (fact.status !== "COMPLETED") {
    // REFUNDED and PARTIALLY_REFUNDED are refund news, handled with refunds.
    throw new Error(`Capture ${fact.captureId} has status ${fact.status}, which is not a capture outcome`);
  }
  const applied = await applyCompletion(deps.db, fact);
  try {
    await recordOrderFees(deps.db, fact);
  } catch (error) {
    // The capture is committed; the webhook re-fetch records the fees again and fails visibly there.
    log.error({ action: "order.fees", order: { id: fact.orderId }, error: databaseErrorFields(error) });
  }
  if (applied.result === "applied") {
    await queueOrderPaidNotice(deps, { order: applied.order, team: applied.team, token: applied.emailToken });
  }
  return applied.result;
}

// The buyer's confirmation goes through the outbox (backlog row 15): a transient send failure retries
// on the 10-minute cron instead of being lost, and an admin can resend it from the order view.
async function queueOrderPaidNotice(
  deps: { db: Database; email?: EmailServices },
  input: { order: Pick<OrderRow, "id" | "teamId" | "buyerEmail" | "productTitle">; team: OrderEmailTeam; token: string },
): Promise<void> {
  const { email } = deps;
  if (!email) {
    log.warn({ action: "order.email", order: { id: input.order.id }, email: { configured: false } });
    return;
  }
  const url = `${email.storeOrigin(input.team.slug)}/orders/${input.token}`;
  try {
    const events = await runInTransaction(deps.db, (_tx, uow) =>
      uow.appendTeamOutbox(
        { teamId: input.order.teamId },
        [
          {
            type: "order.paid",
            data: {
              orderId: input.order.id,
              buyerEmail: input.order.buyerEmail,
              productTitle: input.order.productTitle,
              teamName: input.team.name,
              url,
            },
          },
        ],
      ),
    );
    await fanOutOutboxEvents({ db: deps.db }, events);
    await deliverDueOutboxDeliveries({ db: deps.db, email });
  } catch (error) {
    // The capture is already committed; the cron sweep picks the delivery up.
    log.error({ action: "order.email", order: { id: input.order.id }, error: { name: errorName(error) } });
  }
}

// The admin's Resend button: a fresh grant and a direct send, so it does not wait for the sweep.
export async function resendOrderEmail(deps: { db: Database; email?: EmailServices }, input: { orderId: string; teamId: string }): Promise<boolean> {
  const { email } = deps;
  if (!email) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Email is not configured on this server." });
  const [order] = await deps.db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  if (!order || order.teamId !== input.teamId) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
  if (order.status !== "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Only a paid order can be resent." });
  const team = await findOrderEmailTeam(deps.db, order.teamId);
  if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
  const token = await issueGrant(deps.db, order.id);
  return sendDownloadEmail(deps, { order, team, token });
}

// Records PayPal's fee and the platform's fee for a paid order, once: the first fact that carries the breakdown wins.
// A refunded capture keeps its breakdown, and PayPal still charged the fees. Converted funds are flagged here.
export async function recordOrderFees(db: Database, fact: OrderCaptureFact): Promise<void> {
  const { paypalFeeMinor, reviewReason } = fact;
  if (fact.status !== "COMPLETED" && !isRefundedCaptureStatus(fact.status)) return;
  if (paypalFeeMinor === null && reviewReason === null) return;
  await db.transaction(async (tx) => {
    const row = await lockOrderOrThrow(tx, fact.orderId);
    if (row.status === "pending" || row.paypalCaptureId !== fact.captureId) return;
    if (reviewReason && row.reviewReason === null) {
      await setOrderReviewReason(tx, row.id, reviewReason);
      log.warn({ action: "order.fees", order: { id: row.id }, review: reviewReason });
    }
    if (paypalFeeMinor === null || row.paypalFeeMinor !== null) return;
    const platformFee = fact.platformFeeMinor ?? 0;
    await setOrderFees(tx, { orderId: row.id, paypalFeeMinor, platformFeeMinor: platformFee });
    const transfer = orderFeesTransfer({
      currency: row.currency,
      orderId: row.id,
      paypalFeeMinor,
      platformFeeMinor: platformFee,
    });
    if (transfer) await createPostgresLedger(row.teamId, tx).post([transfer]);
  });
}

// Sellers design §5.2: the buyer's link to the order page. Never throws: a failure goes to email.onError and
// the log, and the result says whether the email went out, so each caller decides whether that fails it.
export async function sendDownloadEmail(
  deps: { email?: EmailServices },
  input: { order: Pick<OrderRow, "id" | "buyerEmail" | "productTitle">; team: OrderEmailTeam; token: string },
): Promise<boolean> {
  const { email } = deps;
  const to = input.order.buyerEmail;
  if (!email) {
    log.warn({ action: "order.email", order: { id: input.order.id }, email: { configured: false } });
    return false;
  }
  try {
    await email.mailer.send({
      sender: "stores",
      onBehalfOf: input.team.name,
      replyTo: input.team.supportEmail ?? undefined,
      tag: "order-download",
      to,
      ...orderDownloadEmail({
        platformName: email.platformName,
        teamName: input.team.name,
        productTitle: input.order.productTitle,
        url: `${email.storeOrigin(input.team.slug)}/orders/${input.token}`,
      }),
    });
    return true;
  } catch (error) {
    // The provider's error text can carry the address, so only the name is logged.
    log.error({
      action: "order.email",
      order: { id: input.order.id },
      error: { name: errorName(error) },
    });
    try {
      await email.onError?.(error, { kind: "order-download", to });
    } catch {
      // A failing error reporter must not turn a lost email into a failed capture.
    }
    return false;
  }
}

function hasIssue(error: PayPalError, issue: string): boolean {
  return error.details.some((detail) => detail.issue === issue);
}

async function sellerMerchantId(db: Database, teamId: string): Promise<string> {
  const team = await findTeamById(db, teamId);
  if (!team?.paypalMerchantId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This seller cannot take payments yet." });
  }
  return team.paypalMerchantId;
}

async function captureAtPayPal(deps: OrderDeps, paypalOrderId: string, merchantId: string): Promise<PayPalOrder> {
  try {
    return await deps.paypal.client.orders.capture({
      orderId: paypalOrderId,
      // A new key per attempt: after INSTRUMENT_DECLINED the buyer approves again, and a reused key would
      // replay the decline. PayPal refuses a second capture of the order (ORDER_ALREADY_CAPTURED).
      requestId: `capture:${paypalOrderId}:${crypto.randomUUID()}`,
      merchantId,
    });
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    if (hasIssue(error, "INSTRUMENT_DECLINED")) {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: "PayPal declined this payment method. Choose another way to pay.",
        cause: error,
      });
    }
    // A capture that raced another, or whose answer was lost, may still have gone through: the order tells.
    let current: PayPalOrder;
    try {
      current = await deps.paypal.client.orders.get({ orderId: paypalOrderId, merchantId });
    } catch {
      // The capture's own error, with its debug_id, is the one worth logging.
      throw error;
    }
    if (!captureFromOrder(current)) throw error;
    return current;
  }
}

// The order lock orders this after any refund: a refund that commits first is seen here, and one that commits
// later revokes this grant with the others.
async function issueBrowserGrant(db: Database, orderId: string): Promise<CheckoutOutcome> {
  const token = await db.transaction(async (tx) => {
    const row = await lockOrderOrThrow(tx, orderId);
    if (row.status === "refunded") throw refunded();
    if (row.status !== "paid") throw new Error(`Order ${row.id} is ${row.status}, not paid, after its capture`);
    return issueGrant(tx, row.id);
  });
  return { outcome: "captured", orderPath: `/orders/${token}` };
}

// Captures the order's PayPal order and applies the result; shared by the browser's call and the webhook.
async function captureAndApply(
  deps: OrderDeps,
  orderId: string,
  paypalOrderId: string,
  merchantId: string,
): Promise<{ status: string; result: OrderCaptureResult }> {
  const paypalOrder = await captureAtPayPal(deps, paypalOrderId, merchantId);
  const capture = captureFromOrder(paypalOrder);
  if (!capture) throw new Error(`PayPal order ${paypalOrderId} has no capture`);
  // The capture went through and was refunded before this call saw it: recorded as paid and refunded.
  if (isRefundedCaptureStatus(capture.status)) {
    log.warn({ action: "order.capture", order: { id: orderId }, capture: { id: capture.id, status: capture.status } });
    await applyOrderRefund(deps, orderId, paypalOrder);
    throw refunded();
  }
  const result = await applyOrderCaptureFact(deps, orderCaptureFact(orderId, paypalOrderId, capture));
  return { status: capture.status, result };
}

export async function verifyCheckout(db: Database, input: { paypalOrderId: string; secret: string }): Promise<OrderRow> {
  const row = await findOrderByPayPalOrderId(db, input.paypalOrderId);
  if (!row || !sameHash(await hashToken(input.secret), row.checkoutSecretHash)) throw invalidCheckout();
  return row;
}

// The browser's capture call, for an order checked by verifyCheckout. A paid order (by this call earlier, or by
// the webhook) gets a fresh grant.
export async function captureCheckout(deps: OrderDeps, row: OrderRow): Promise<CheckoutOutcome> {
  if (row.status === "refunded") throw refunded();
  if (row.status === "paid") return issueBrowserGrant(deps.db, row.id);
  if (!row.paypalOrderId) throw invalidCheckout();
  const merchantId = await sellerMerchantId(deps.db, row.teamId);
  let status: string;
  try {
    ({ status } = await captureAndApply(deps, row.id, row.paypalOrderId, merchantId));
  } catch (error) {
    if (error instanceof PayPalError) throw unconfirmedCapture(error);
    throw error;
  }
  if (status === "COMPLETED") return issueBrowserGrant(deps.db, row.id);
  if (status === "PENDING") return { outcome: "pending" };
  return { outcome: "declined" };
}

// An approved order whose browser never called back. The buyer gets the order page only through the email.
export async function captureOrderFromWebhook(
  deps: OrderDeps,
  order: Pick<OrderRow, "id" | "paypalOrderId">,
  merchantId: string,
): Promise<OrderCaptureResult> {
  if (!order.paypalOrderId) throw new Error(`Order ${order.id} has no PayPal order to capture`);
  const { result } = await captureAndApply(deps, order.id, order.paypalOrderId, merchantId);
  return result;
}

export type OrderRefundResult = "refunded" | "already refunded" | "not paid";

type MarkedRefund = { result: OrderRefundResult; order: OrderRow; capture: PayPalCapture | null };

// Sellers decision: any refund or reversal, full or partial, refunds the order and revokes every grant. Each
// PayPal refund is posted once by its id, with the fees it returned, and a reversal once by its capture,
// whichever event reports it. A capture refunded before the platform applied it is recorded as paid then refunded,
// without a grant or an email, so the ledger still shows the payment, its fees and the refund.
// expectedRefundId is the refund the event reported: until PayPal's order lists it, the queue retries.
export async function applyOrderRefund(
  deps: { db: Database },
  orderId: string,
  paypalOrder: PayPalOrder,
  options: { expectedRefundId?: string | null; now?: Date } = {},
): Promise<OrderRefundResult> {
  const now = options.now ?? new Date();
  const captures = capturesIn(paypalOrder);
  const refunds = refundsFromOrder(paypalOrder).filter((refund) => refund.status === "COMPLETED");

  // The lock orders this against the browser's grant and a fresh link, which both refuse a refunded order.
  const marked = await deps.db.transaction(async (tx): Promise<MarkedRefund> => {
    let row = await lockOrderOrThrow(tx, orderId);
    if (row.status === "pending") {
      const early = captures.find((capture) => isRefundedCaptureStatus(capture.status));
      if (!early) return { result: "not paid", order: row, capture: null };
      // Nothing to revoke yet, so nothing is committed until PayPal lists the refund; every retry path re-enters.
      if (early.status !== "REVERSED" && refunds.length === 0) {
        throw new Error(`PayPal order ${paypalOrder.id} lists no completed refund yet for capture ${early.id}`);
      }
      const fact = orderCaptureFact(row.id, paypalOrder.id, early);
      checkCaptureFact(row, fact);
      row = await markLockedOrderPaid(tx, row, fact);
    }
    const capture = captures.find((item) => item.id === row.paypalCaptureId) ?? null;
    const captureStatus = capture?.status ?? null;
    if (captureStatus !== "REVERSED" && refunds.length === 0 && !(captureStatus && isRefundedCaptureStatus(captureStatus))) {
      // PayPal sent refund news, so its order lookup is lagging; the queue retries.
      throw new Error(`PayPal order ${paypalOrder.id} shows no refund yet for capture ${row.paypalCaptureId}`);
    }
    if (row.status === "refunded") return { result: "already refunded", order: row, capture };
    if (!(await markOrderRefunded(tx, { orderId: row.id, refundedAt: now }))) {
      throw new Error(`Order ${row.id} left paid while locked`);
    }
    await revokeOrderGrants(tx, row.id, now);
    return { result: "refunded", order: row, capture };
  });
  if (marked.result === "not paid") return marked.result;
  const { order, capture } = marked;
  const captureId = order.paypalCaptureId;
  if (!captureId) throw new Error(`Order ${order.id} is ${order.status} without a capture`);
  // The capture's fees may not be recorded yet: the capture was refunded before the platform applied it, or a
  // refund landed before the fee step.
  if (capture) await recordOrderFees(deps.db, orderCaptureFact(order.id, paypalOrder.id, capture));

  let refundedMinor = 0;
  for (const refund of refunds) {
    const amountMinor = refund.amount?.currency_code === order.currency ? parseMajorAmount(refund.amount.value) : null;
    if (amountMinor === null) {
      log.warn({ action: "order.refund", order: { id: order.id }, refund: { id: refund.id, posted: false } });
      continue;
    }
    refundedMinor += amountMinor;
    await postOnce(
      deps.db,
      order.teamId,
      orderRefundedTransfer({ currency: order.currency, orderId: order.id, refundKey: `refund:${refund.id}`, amountMinor }),
    );
    const fees = returnedFees(order.currency, refund.seller_payable_breakdown);
    if (!fees) {
      log.warn({ action: "order.refund_fees", order: { id: order.id }, refund: { id: refund.id, posted: false } });
      continue;
    }
    const feesTransfer = refundFeesTransfer({ currency: order.currency, projectId: null, refundId: refund.id, ...fees });
    if (feesTransfer) await postOnce(deps.db, order.teamId, feesTransfer);
  }
  if (capture?.status === "REVERSED") {
    // A reversal takes back what the refunds left with the seller, not the full amount again.
    const reversedMinor = Math.max(0, order.amountMinor - refundedMinor);
    if (reversedMinor > 0) {
      await postOnce(
        deps.db,
        order.teamId,
        orderRefundedTransfer({
          currency: order.currency,
          orderId: order.id,
          refundKey: `reversal:${captureId}`,
          amountMinor: reversedMinor,
        }),
      );
    }
  } else if (refunds.length === 0) {
    // Revoked already; the retry posts the refund once PayPal lists it.
    throw new Error(`PayPal order ${paypalOrder.id} lists no completed refund yet for capture ${captureId}`);
  }
  const { expectedRefundId } = options;
  if (expectedRefundId && !refunds.some((refund) => refund.id === expectedRefundId)) {
    // A later partial refund on an order already refunded: posted on the retry once PayPal lists it.
    throw new Error(`PayPal order ${paypalOrder.id} does not list refund ${expectedRefundId} as completed yet`);
  }
  return marked.result;
}

// The R2b download length: long enough to start the download, too short to share.
const DOWNLOAD_URL_SECONDS = 300;
const HOUR_MS = 3_600_000;

export type OrderLink = { token: string; slug: string };

function invalidLink(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
}

type OrderByGrant = { grant: DownloadGrantRow; order: OrderRow; team: OrderEmailTeam };

// Grants are only issued for paid orders, so a pending one behind a token is treated as no order at all.
// A link only works on its own store's host.
async function findOrderByToken(db: DbExecutor, token: string, slug: string): Promise<OrderByGrant> {
  const found = await findGrantByTokenHash(db, await hashToken(token));
  if (!found || found.order.status === "pending") throw invalidLink();
  const team = await findOrderEmailTeam(db, found.order.teamId);
  if (team?.slug !== slug) throw invalidLink();
  return { ...found, team };
}

// A refunded order's grants are revoked with it; the order status also covers a grant the revocation missed.
function pageGrantState({ grant, order }: OrderByGrant, now: Date): GrantState {
  return order.status === "refunded" ? "revoked" : grantState(grant, now);
}

export async function getOrderPage(db: Database, input: OrderLink, now: Date = new Date()) {
  const found = await findOrderByToken(db, input.token, input.slug);
  const { order, grant, team } = found;
  return {
    order: {
      productTitle: order.productTitle,
      amountMinor: order.amountMinor,
      currency: order.currency,
      status: order.status,
      paidAt: order.paidAt?.toISOString() ?? null,
    },
    team: { name: team.name },
    grant: { state: pageGrantState(found, now), downloadsLeft: grant.downloadsLeft, expiresAt: grant.expiresAt.toISOString() },
    maskedEmail: maskEmail(order.buyerEmail),
  };
}

function refusedDownload(state: GrantState): TRPCError {
  if (state === "expired") return new TRPCError({ code: "BAD_REQUEST", message: "This link has expired. Ask for a new one." });
  // Grants are revoked only by a refund.
  if (state === "revoked") return refunded();
  return new TRPCError({ code: "BAD_REQUEST", message: "This link has no downloads left. Ask for a new one." });
}

// Sellers design §5.2: the file is the product's current one, so a replaced file reaches past buyers.
export async function downloadOrderFile(
  deps: { db: Database; files: FileStore },
  link: OrderLink,
  now: Date = new Date(),
): Promise<{ url: string }> {
  const found = await findOrderByToken(deps.db, link.token, link.slug);
  if (found.order.status !== "paid") throw refunded();
  const state = grantState(found.grant, now);
  if (state !== "usable") throw refusedDownload(state);
  // Checked before spending a download, so a missing file does not cost the buyer one.
  const file = await findAttachedProductFile(deps.db, found.order.productId);
  if (!file) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This file is not available. Contact the seller." });
  }
  if (!(await useDownload(deps.db, found.grant.id, now))) {
    // Another download or a refund got there first; the fresh row says which.
    const current = await findOrderByToken(deps.db, link.token, link.slug);
    const currentState = pageGrantState(current, now);
    throw refusedDownload(currentState === "usable" ? "used_up" : currentState);
  }
  const url = await deps.files.presignGet({ key: file.r2Key, fileName: file.fileName, expiresInSeconds: DOWNLOAD_URL_SECONDS });
  return { url };
}

// The new link goes only to the buyer email on the order, never to the page, so a leaked old link
// cannot be turned into a working one.
export async function sendNewOrderLink(
  deps: { db: Database; email?: EmailServices },
  link: OrderLink,
  now: Date = new Date(),
): Promise<{ sentTo: string }> {
  if (!deps.email) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Email is not configured on this server." });
  }
  const { order, team } = await findOrderByToken(deps.db, link.token, link.slug);
  if (order.status === "refunded") throw refunded();
  const allowed = await hitRequestLimit(deps.db, { key: `order-link:${order.id}`, windowMs: HOUR_MS, max: 3 });
  if (!allowed) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many new links for this order. Try again in an hour." });
  }
  // The order lock orders this against a refund, as for the browser's grant at capture.
  const newGrantToken = await deps.db.transaction(async (tx) => {
    const row = await lockOrderOrThrow(tx, order.id);
    if (row.status === "refunded") throw refunded();
    return issueGrant(tx, row.id, now);
  });
  const sent = await sendDownloadEmail(deps, { order, team, token: newGrantToken });
  if (!sent) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We could not send the email. Try again in a few minutes." });
  }
  return { sentTo: maskEmail(order.buyerEmail) };
}

export async function listOrders(db: Database, teamId: string) {
  const rows = await listTeamOrders(db, teamId);
  return rows.map((row) => ({
    id: row.id,
    productTitle: row.productTitle,
    buyerEmail: row.buyerEmail,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    paidAt: row.paidAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
    reviewReason: row.reviewReason,
  }));
}
