import {
  buyerEmailProblem,
  DOWNLOADS_PER_GRANT,
  grantExpiry,
  hashToken,
  newToken,
  orderCustomId,
  orderFeesTransfer,
  orderPaidTransfer,
  parseMajorAmount,
  platformFeeMinor,
  sellerPlanFor,
  toPayPalValue,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import { findAttachedProductFile } from "@jendal-workspace/db/repositories/files";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import {
  findOrderById,
  findOrderByPayPalOrderId,
  insertGrant,
  insertOrder,
  lockOrder,
  markOrderPaid,
  type OrderRow,
  setOrderFees,
  setOrderPayPalOrder,
} from "@jendal-workspace/db/repositories/orders";
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
  type PayPalMoney,
  type PayPalOrder,
} from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { log } from "evlog";

import type { EmailServices, PayPalServices } from "../context";
import { CaptureFactConflict, databaseErrorFields } from "./payments";

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
  // Payleor's fee follows the seller's plan (pricing proposal §1): Solo 2%, Team 1%.
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

function minorIn(currency: string | null, money: PayPalMoney | undefined): number | null {
  return money && money.currency_code === currency ? parseMajorAmount(money.value) : null;
}

export function orderCaptureFact(orderId: string, paypalOrderId: string, capture: PayPalCapture): OrderCaptureFact {
  const currency = capture.amount?.currency_code ?? null;
  const breakdown = capture.seller_receivable_breakdown;
  const capturedAt = capture.create_time ? new Date(capture.create_time) : null;
  return {
    orderId,
    paypalOrderId,
    captureId: capture.id,
    status: capture.status,
    amountMinor: capture.amount ? parseMajorAmount(capture.amount.value) : null,
    currency,
    capturedAt: capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt : null,
    // A fee in another currency (a converted receivable) is not posted; the reconciliation job will show it.
    paypalFeeMinor: breakdown ? minorIn(currency, breakdown.paypal_fee) : null,
    platformFeeMinor: breakdown ? (minorIn(currency, breakdown.platform_fees[0]?.amount) ?? 0) : null,
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

type AppliedCompletion = { result: "applied"; order: OrderRow; emailToken: string } | { result: "already_applied" };

async function lockOrderOrThrow(tx: Transaction, orderId: string): Promise<OrderRow> {
  const row = await lockOrder(tx, orderId);
  if (!row) throw new Error(`PayPal reported capture news for unknown order ${orderId}`);
  return row;
}

// The order stays locked for the transaction, so the browser's capture and a webhook cannot both apply it.
function applyCompletion(db: Database, fact: OrderCaptureFact): Promise<AppliedCompletion> {
  return db.transaction(async (tx) => {
    const row = await lockOrderOrThrow(tx, fact.orderId);
    if (row.paypalCaptureId && row.paypalCaptureId !== fact.captureId) {
      throw new CaptureFactConflict(`Order ${row.id} already has capture ${row.paypalCaptureId}; PayPal reported ${fact.captureId}`);
    }
    if (row.paypalOrderId !== fact.paypalOrderId) {
      throw new CaptureFactConflict(`Capture ${fact.captureId} completed on PayPal order ${fact.paypalOrderId}, which order ${row.id} does not use`);
    }
    if (row.status !== "pending") return { result: "already_applied" as const };
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
    // One grant for the buyer email; the browser's capture call issues its own.
    const emailToken = await issueGrant(tx, row.id);
    return { result: "applied" as const, order: { ...row, status: "paid" as const, paypalCaptureId: fact.captureId, paidAt }, emailToken };
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
  if (applied.result === "applied") await sendDownloadEmail(deps, { order: applied.order, token: applied.emailToken });
  return applied.result;
}

// Records PayPal's fee and Payleor's fee for a paid order, once: the first fact that carries the breakdown wins.
export async function recordOrderFees(db: Database, fact: OrderCaptureFact): Promise<void> {
  const { paypalFeeMinor } = fact;
  if (fact.status !== "COMPLETED" || paypalFeeMinor === null) return;
  await db.transaction(async (tx) => {
    const row = await lockOrderOrThrow(tx, fact.orderId);
    if (row.status !== "paid" || row.paypalCaptureId !== fact.captureId || row.paypalFeeMinor !== null) return;
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

// Sellers design §5.2: the buyer's link to the order page. A failed send never fails the capture: the buyer
// has the page already and can ask it for a new link.
export async function sendDownloadEmail(
  deps: { db: Database; email?: EmailServices },
  input: { order: Pick<OrderRow, "id" | "teamId" | "buyerEmail" | "productTitle">; token: string },
): Promise<void> {
  const { email } = deps;
  if (!email) {
    log.warn({ action: "order.email", order: { id: input.order.id }, email: { configured: false } });
    return;
  }
  const [team] = await deps.db
    .select({ name: teamTable.name, slug: teamTable.slug, supportEmail: teamTable.supportEmail })
    .from(teamTable)
    .where(eq(teamTable.id, input.order.teamId))
    .limit(1);
  if (!team) throw new Error(`Order ${input.order.id} has no team`);
  const to = input.order.buyerEmail;
  const message = {
    sender: "stores" as const,
    onBehalfOf: team.name,
    replyTo: team.supportEmail ?? undefined,
    tag: "order-download",
    to,
    ...orderDownloadEmail({
      teamName: team.name,
      productTitle: input.order.productTitle,
      url: `${email.storeOrigin(team.slug)}/orders/${input.token}`,
    }),
  };
  try {
    await email.mailer.send(message);
  } catch (error) {
    await email.onError?.(error, { kind: "order-download", to });
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

async function capturedOutcome(db: Database, orderId: string): Promise<CheckoutOutcome> {
  const token = await issueGrant(db, orderId);
  return { outcome: "captured", orderPath: `/orders/${token}` };
}

// The browser's capture call. A paid order (by this call earlier, or by the webhook) gets a fresh grant.
export async function captureCheckout(
  deps: OrderDeps,
  input: { paypalOrderId: string; secret: string },
): Promise<CheckoutOutcome> {
  const row = await findOrderByPayPalOrderId(deps.db, input.paypalOrderId);
  if (!row || (await hashToken(input.secret)) !== row.checkoutSecretHash) throw invalidCheckout();
  if (row.status === "refunded") throw refunded();
  if (row.status === "paid") return capturedOutcome(deps.db, row.id);
  const merchantId = await sellerMerchantId(deps.db, row.teamId);
  const paypalOrder = await captureAtPayPal(deps, input.paypalOrderId, merchantId);
  const capture = captureFromOrder(paypalOrder);
  if (!capture) throw new Error(`PayPal order ${input.paypalOrderId} has no capture`);
  const result = await applyOrderCaptureFact(deps, orderCaptureFact(row.id, input.paypalOrderId, capture));
  if (capture.status === "COMPLETED") {
    if (result === "already_applied") {
      // Another input applied the capture first; a refund may have followed it.
      const current = await findOrderById(deps.db, row.id);
      if (current?.status === "refunded") throw refunded();
    }
    return capturedOutcome(deps.db, row.id);
  }
  if (capture.status === "PENDING") return { outcome: "pending" };
  return { outcome: "declined" };
}
