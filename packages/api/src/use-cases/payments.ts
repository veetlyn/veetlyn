import {
  captureReviewReason,
  type CaptureReviewReason,
  completionTransfer,
  errorName,
  type LedgerTransferDraft,
  parseMajorAmount,
  paymentCapturedTransfer,
  paymentFeesTransfer,
  platformFeeMinor,
  sellerPlanFor,
  toPayPalValue,
  transitionProject,
  transitionRefusalMessage,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { postgresError } from "@jendal-workspace/db/postgres-errors";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import {
  findProjectById,
  getCurrentQuote,
  type ProjectRow,
  setPaymentReviewReason,
} from "@jendal-workspace/db/repositories/projects";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import {
  type OutboxEventInput,
  ProjectConflictError,
  runInTransaction,
} from "@jendal-workspace/db/repositories/unit-of-work";
import { payment, type project } from "@jendal-workspace/db/schema/projects";
import { captureFromOrder, type PayPalCapture, PayPalError, type PayPalOrder } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { log } from "evlog";

import type { PayPalServices } from "../context";
import { armProjectSchedule } from "./projects";
import { captureFees, isRefundedCaptureStatus } from "./paypal-amounts";

// One capture as PayPal reports it: from a capture response, an order lookup or a webhook (R1c).
export type CaptureFact = {
  paymentId: string;
  orderId: string;
  captureId: string;
  status: string;
  // Null when PayPal sent no amount (a pending capture can omit it).
  amountMinor: number | null;
  currency: string | null;
  // PayPal's capture time (create_time); the deadline runs from it. Null when PayPal sent none.
  capturedAt: Date | null;
  // From the seller receivable breakdown, in the payment's currency; null while PayPal has not reported them.
  paypalFeeMinor: number | null;
  platformFeeMinor: number | null;
  // Converted funds or fees in another currency: the payment is flagged for a person.
  reviewReason: CaptureReviewReason | null;
};

// Money moved in a way the platform did not ask for (a second capture, a capture on an abandoned order or a
// cancelled payment, a wrong amount). A person has to look; retrying cannot fix it.
export class CaptureFactConflict extends Error {
  override name = "CaptureFactConflict";
}

// "stale": the fact changes nothing. It is about an order or a payment state the payment has moved past.
export type CaptureFactResult = "applied" | "already_applied" | "pending" | "failed" | "stale";

const DAY_MS = 86_400_000;

// The fact is idempotent, so losing a race with another project change is retried, not reported.
const MAX_CONFLICT_ATTEMPTS = 3;

type PaymentRow = typeof payment.$inferSelect;

class FactAlreadyApplied extends Error {}
class StaleFact extends Error {}

async function lockPayment(tx: Transaction, paymentId: string): Promise<PaymentRow> {
  const [row] = await tx.select().from(payment).where(eq(payment.id, paymentId)).limit(1).for("update");
  if (!row) throw new Error(`PayPal reported capture news for unknown payment ${paymentId}`);
  return row;
}

// A payment has one capture. Another capture id, or a completed capture on an abandoned order, means money
// moved in a way the platform did not ask for; that needs a person, so it throws instead of guessing.
function checkCaptureBelongs(row: PaymentRow, fact: CaptureFact): void {
  if (row.paypalCaptureId && row.paypalCaptureId !== fact.captureId) {
    throw new CaptureFactConflict(`Payment ${row.id} already has capture ${row.paypalCaptureId}; PayPal reported ${fact.captureId}`);
  }
  if (row.paypalOrderId !== fact.orderId && row.paypalCaptureId !== fact.captureId) {
    if (fact.status === "COMPLETED") {
      throw new CaptureFactConflict(`Capture ${fact.captureId} completed on order ${fact.orderId}, which payment ${row.id} no longer uses`);
    }
    throw new StaleFact();
  }
}

type CaptureChange = {
  set: Partial<typeof project.$inferInsert>;
  transfers: LedgerTransferDraft[];
  events: OutboxEventInput[];
};

async function projectChangeOnCapture(
  tx: Transaction,
  row: ProjectRow,
  kind: PaymentRow["kind"],
  capturedAt: Date,
): Promise<CaptureChange> {
  if (kind === "top_up") return { set: {}, transfers: [], events: [] };
  if (kind === "balance") {
    // Services spec §5.2 step 7: the balance capture completes the project with the completion postings.
    const result = transitionProject(row.status, "balance_captured");
    if (!result.ok) {
      throw new Error(`Project ${row.id} cannot take its balance: ${transitionRefusalMessage(result.reason)}`);
    }
    const freelancerId = row.assignedFreelancerId;
    if (row.finalPriceMinor === null || !freelancerId) {
      throw new Error(`Project ${row.id} has a balance without a final price or freelancer`);
    }
    const transfer = completionTransfer({
      currency: row.currency,
      projectId: row.id,
      freelancerId,
      finalPriceMinor: row.finalPriceMinor,
      teamCutBps: row.teamCutBps,
      managerId: row.managerId,
      managerCutBps: row.managerCutBps,
    });
    return {
      set: { status: result.to },
      transfers: [transfer],
      events: [{ type: "project.completed", data: { finalPriceMinor: row.finalPriceMinor } }],
    };
  }
  const result = transitionProject(row.status, "deposit_captured");
  if (!result.ok) {
    throw new Error(`Project ${row.id} cannot take its deposit: ${transitionRefusalMessage(result.reason)}`);
  }
  const quote = await getCurrentQuote(tx, row.id);
  if (!quote) throw new Error(`Project ${row.id} has a deposit but no accepted quote`);
  // Services spec §5.2 step 4: the deadline runs from the capture.
  return {
    set: { status: result.to, deadlineAt: new Date(capturedAt.getTime() + quote.deliveryDays * DAY_MS) },
    transfers: [],
    events: [],
  };
}

// A pending capture changes no money: it only records the capture id, so the later outcome matches it.
async function recordPendingCapture(db: Database, fact: CaptureFact): Promise<CaptureFactResult> {
  const updated = await db
    .update(payment)
    .set({ paypalCaptureId: fact.captureId, version: sql`${payment.version} + 1` })
    .where(
      and(
        eq(payment.id, fact.paymentId),
        eq(payment.status, "pending"),
        eq(payment.paypalOrderId, fact.orderId),
        or(isNull(payment.paypalCaptureId), eq(payment.paypalCaptureId, fact.captureId)),
      ),
    )
    .returning({ id: payment.id });
  return updated.length > 0 ? "pending" : "stale";
}

function applyInTransaction(db: Database, fact: CaptureFact): Promise<CaptureFactResult> {
  return runInTransaction(db, async (tx, uow) => {
    const row = await lockPayment(tx, fact.paymentId);
    checkCaptureBelongs(row, fact);
    if (row.status === "cancelled") {
      if (fact.status === "COMPLETED") {
        throw new CaptureFactConflict(`Capture ${fact.captureId} completed on cancelled payment ${row.id}`);
      }
      throw new StaleFact();
    }
    if (
      row.status === "captured" ||
      row.status === "refunded" ||
      (row.status === "failed" && row.paypalCaptureId === fact.captureId)
    ) {
      throw new FactAlreadyApplied();
    }
    const projectRow = await findProjectById(tx, row.projectId);
    if (!projectRow) throw new Error(`Payment ${row.id} has no project`);

    if (fact.status === "COMPLETED") {
      const capturedAt = fact.capturedAt ?? new Date();
      if (fact.amountMinor !== row.amountMinor || fact.currency !== row.currency) {
        throw new CaptureFactConflict(
          `Capture ${fact.captureId} (${fact.currency} ${fact.amountMinor}) does not match payment ${row.id} (${row.currency} ${row.amountMinor})`,
        );
      }
      await tx
        .update(payment)
        .set({ status: "captured", paypalCaptureId: fact.captureId, capturedAt, version: row.version + 1 })
        .where(eq(payment.id, row.id));
      const change = await projectChangeOnCapture(tx, projectRow, row.kind, capturedAt);
      await uow.apply({
        project: projectRow,
        set: change.set,
        // Posted in the same batch as the capture: completion takes out of client_held the money the capture puts
        // in, and the ledger checks the batch's net balances.
        transfers: [
          paymentCapturedTransfer({
            currency: row.currency,
            projectId: row.projectId,
            paymentId: row.id,
            quotePartMinor: row.quotePartMinor,
            managementFeeMinor: row.managementFeeMinor,
          }),
          ...change.transfers,
        ],
        events: [
          {
            type: "payment.captured",
            data: { paymentId: row.id, kind: row.kind, amountMinor: row.amountMinor, captureId: fact.captureId },
          },
          ...change.events,
        ],
      });
      if (change.set.status) {
        await armProjectSchedule(tx, { ...projectRow, ...change.set }, capturedAt, {
          workStartedAt: change.set.status === "in_progress" ? capturedAt : undefined,
        });
      }
      return "applied";
    }

    await tx
      .update(payment)
      .set({ status: "failed", paypalCaptureId: fact.captureId, version: row.version + 1 })
      .where(eq(payment.id, row.id));
    await uow.apply({
      project: projectRow,
      set: {},
      events: [{ type: "payment.failed", data: { paymentId: row.id, kind: row.kind, captureId: fact.captureId, status: fact.status } }],
    });
    return "failed";
  });
}

// A Drizzle error's message is the whole query with its parameters, so only the name and the Postgres code and
// constraint from its cause are logged.
export type DatabaseErrorFields = { name: string; code?: string; constraint?: string };

export function databaseErrorFields(cause: unknown): DatabaseErrorFields {
  const fields = postgresError(cause);
  return { name: errorName(cause), code: fields?.code, constraint: fields?.constraint_name };
}

// Services spec §6.4: applies each capture outcome at most once, whichever input reports it first. The
// payment row stays locked for the transaction, so the pay page and a webhook cannot both apply it.
export async function applyCaptureFact(db: Database, fact: CaptureFact): Promise<CaptureFactResult> {
  if (fact.status === "PENDING") return recordPendingCapture(db, fact);
  if (fact.status !== "COMPLETED" && fact.status !== "DECLINED" && fact.status !== "FAILED") {
    // REFUNDED, PARTIALLY_REFUNDED and REVERSED are refund news, handled by applyPaymentRefunds.
    throw new Error(`Capture ${fact.captureId} has status ${fact.status}, which is not a capture outcome`);
  }
  let result: CaptureFactResult;
  for (let attempt = 1; ; attempt++) {
    try {
      result = await applyInTransaction(db, fact);
      break;
    } catch (error) {
      // Thrown inside the transaction to roll it back: nothing was written.
      if (error instanceof FactAlreadyApplied) {
        result = "already_applied";
        break;
      }
      if (error instanceof StaleFact) return "stale";
      if (error instanceof ProjectConflictError && attempt < MAX_CONFLICT_ATTEMPTS) continue;
      throw error;
    }
  }
  if (result === "applied" || result === "already_applied") {
    try {
      await recordCaptureFees(db, fact);
    } catch (error) {
      // The capture is committed; the webhook re-fetch records the fees again and fails visibly there.
      log.error({
        action: "payment.fees",
        payment: { id: fact.paymentId },
        error: databaseErrorFields(error),
      });
    }
  }
  return result;
}

// Records PayPal's fee and the platform's fee for a captured payment, once: the first fact that carries the
// breakdown wins, whether it is the capture itself or a later webhook re-fetch. A refunded capture keeps its
// breakdown, and PayPal still charged the fees. Converted funds are flagged here.
export async function recordCaptureFees(db: Database, fact: CaptureFact): Promise<void> {
  const { paypalFeeMinor, reviewReason } = fact;
  if (fact.status !== "COMPLETED" && !isRefundedCaptureStatus(fact.status)) return;
  if (paypalFeeMinor === null && reviewReason === null) return;
  await db.transaction(async (tx) => {
    const row = await lockPayment(tx, fact.paymentId);
    if ((row.status !== "captured" && row.status !== "refunded") || row.paypalCaptureId !== fact.captureId) return;
    if (reviewReason && row.reviewReason === null) {
      await setPaymentReviewReason(tx, row.id, reviewReason);
      log.warn({ action: "payment.fees", payment: { id: row.id }, review: reviewReason });
    }
    if (paypalFeeMinor === null || row.paypalFeeMinor !== null) return;
    const platformFeeMinor = fact.platformFeeMinor ?? 0;
    await tx
      .update(payment)
      .set({ paypalFeeMinor, platformFeeMinor, version: row.version + 1 })
      .where(eq(payment.id, row.id));
    const transfer = paymentFeesTransfer({
      currency: row.currency,
      projectId: row.projectId,
      paymentId: row.id,
      paypalFeeMinor,
      platformFeeMinor,
    });
    if (transfer) await createPostgresLedger(row.teamId, tx).post([transfer]);
  });
}

export type PaymentDeps = { db: Database; paypal: PayPalServices };

async function requirePayment(db: Database, paymentId: string): Promise<PaymentRow> {
  const [row] = await db.select().from(payment).where(eq(payment.id, paymentId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return row;
}

async function requireSeller(db: Database, teamId: string): Promise<{ merchantId: string; name: string; solo: boolean }> {
  const team = await findTeamById(db, teamId);
  if (!team?.paypalMerchantId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This team cannot take PayPal payments yet." });
  }
  // The platform's fee follows the seller's plan (pricing proposal §1): Solo 2%, Team 1%.
  const settings = await getServicesTeamSettings(db, teamId);
  return { merchantId: team.paypalMerchantId, name: team.name, solo: settings?.solo ?? false };
}

export async function getPayPage(deps: { db: Database; paypal: PayPalServices | undefined }, paymentId: string) {
  const row = await requirePayment(deps.db, paymentId);
  const [projectRow, team] = await Promise.all([findProjectById(deps.db, row.projectId), findTeamById(deps.db, row.teamId)]);
  if (!projectRow || !team) throw new Error(`Payment ${row.id} has no project or team`);
  return {
    payment: {
      id: row.id,
      kind: row.kind,
      status: row.status,
      processing: row.status === "pending" && row.paypalCaptureId !== null,
      currency: row.currency,
      amountMinor: row.amountMinor,
      lines: row.lines,
      capturedAt: row.capturedAt,
    },
    project: { id: projectRow.id, title: projectRow.title },
    team: { name: team.name },
    // Null until the server has PayPal configured and the team has connected its account.
    paypal: deps.paypal && team.paypalMerchantId ? { ...deps.paypal.sdk, merchantId: team.paypalMerchantId } : null,
  };
}

export function captureFact(paymentId: string, orderId: string, capture: PayPalCapture): CaptureFact {
  const currency = capture.amount?.currency_code ?? null;
  const breakdown = capture.seller_receivable_breakdown;
  const fees = breakdown ? captureFees(currency, breakdown) : null;
  const capturedAt = capture.create_time ? new Date(capture.create_time) : null;
  return {
    paymentId,
    orderId,
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

// Asks PayPal about the payment's current order before anything replaces it. True when the client can keep
// using it; throws when PayPal already holds a capture for it; false when the order is dead.
async function keepsCurrentOrder(deps: PaymentDeps, row: PaymentRow, merchantId: string): Promise<boolean> {
  const orderId = row.paypalOrderId;
  if (!orderId) return false;
  let order: PayPalOrder;
  try {
    order = await deps.paypal.client.orders.get({ orderId, merchantId });
  } catch (error) {
    // An expired order is gone at PayPal, so nothing can be captured on it any more.
    if (error instanceof PayPalError && error.status === 404) return false;
    throw error;
  }
  const capture = captureFromOrder(order);
  if (capture) {
    await applyCaptureFact(deps.db, captureFact(row.id, orderId, capture));
    if (capture.status === "COMPLETED") throw new TRPCError({ code: "CONFLICT", message: "This payment is already paid." });
    if (capture.status === "PENDING") {
      throw new TRPCError({ code: "CONFLICT", message: "PayPal is still processing this payment. Check back soon." });
    }
    return false;
  }
  return order.status === "CREATED" || order.status === "APPROVED" || order.status === "PAYER_ACTION_REQUIRED";
}

function paymentRefunded(): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: "This payment was refunded." });
}

// Services spec §5.4. The client keeps the payment's order while PayPal can still capture it; a new order is
// created only once the old one is dead (declined, expired), so two orders can never both be paid.
export async function startPayment(deps: PaymentDeps, paymentId: string): Promise<{ orderId: string }> {
  const row = await requirePayment(deps.db, paymentId);
  if (row.status === "captured") throw new TRPCError({ code: "CONFLICT", message: "This payment is already paid." });
  if (row.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This payment was cancelled." });
  if (row.status === "refunded") throw paymentRefunded();
  if (row.status === "pending" && row.paypalCaptureId) {
    throw new TRPCError({ code: "CONFLICT", message: "PayPal is still processing this payment. Check back soon." });
  }
  const projectRow = await findProjectById(deps.db, row.projectId);
  if (!projectRow) throw new Error(`Payment ${row.id} has no project`);
  const seller = await requireSeller(deps.db, row.teamId);
  let current = row;
  if (row.paypalOrderId) {
    if (await keepsCurrentOrder(deps, row, seller.merchantId)) return { orderId: row.paypalOrderId };
    // Applying a capture the lookup found changed the row, and the compare-and-set below needs its new version.
    current = await requirePayment(deps.db, row.id);
    if (current.status !== "pending" && current.status !== "failed") {
      throw new TRPCError({ code: "CONFLICT", message: "This payment changed. Reload the page and try again." });
    }
  }
  const fee = platformFeeMinor(row.amountMinor, sellerPlanFor({ id: row.teamId, solo: seller.solo }).feeBps);
  const order = await deps.paypal.client.orders.create({
    // A new key per start: each start is a new order, while the client's own retries reuse this key.
    requestId: `order:${row.id}:${crypto.randomUUID()}`,
    merchantId: seller.merchantId,
    currency: row.currency,
    value: toPayPalValue(row.amountMinor),
    platformFeeValue: fee > 0 ? toPayPalValue(fee) : null,
    customId: row.id,
    description: projectRow.title,
    brandName: seller.name,
    // The lines always add up to the amount (core paymentLines); the check keeps a bad row from failing the order.
    items:
      row.lines.reduce((sum, line) => sum + line.amountMinor, 0) === row.amountMinor
        ? row.lines.map((line) => ({ name: line.label, value: toPayPalValue(line.amountMinor) }))
        : undefined,
  });
  const updated = await deps.db
    .update(payment)
    .set({ paypalOrderId: order.id, platformFeeMinor: fee, status: "pending", paypalCaptureId: null, version: current.version + 1 })
    .where(and(eq(payment.id, current.id), eq(payment.version, current.version)))
    .returning({ id: payment.id });
  if (updated.length === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "This payment changed. Reload the page and try again." });
  }
  return { orderId: order.id };
}

export type CaptureOutcome = "captured" | "pending" | "declined";

function hasIssue(error: PayPalError, issue: string): boolean {
  return error.details.some((detail) => detail.issue === issue);
}

// Only the buyer's own capture call shows this: a PayPal error that survives the order lookup leaves the capture's
// outcome unknown, and retrying blindly could pay twice. The webhook keeps PayPal's error to decide on a retry.
export function unconfirmedCapture(error: PayPalError): TRPCError {
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "We could not confirm your payment. It may have gone through; check your email before trying again.",
    cause: error,
  });
}

export async function capturePayment(
  deps: PaymentDeps,
  input: { paymentId: string; orderId: string },
): Promise<{ outcome: CaptureOutcome }> {
  const row = await requirePayment(deps.db, input.paymentId);
  if (row.paypalOrderId !== input.orderId) {
    throw new TRPCError({ code: "CONFLICT", message: "This payment was restarted. Reload the page and try again." });
  }
  if (row.status === "captured") return { outcome: "captured" };
  if (row.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This payment was cancelled." });
  if (row.status === "refunded") throw paymentRefunded();
  if (row.status === "failed") {
    throw new TRPCError({ code: "CONFLICT", message: "This payment needs a fresh start. Reload the page and try again." });
  }
  const seller = await requireSeller(deps.db, row.teamId);
  let order: PayPalOrder;
  try {
    order = await deps.paypal.client.orders.capture({
      orderId: input.orderId,
      // A new key per attempt: after INSTRUMENT_DECLINED the client approves again, and a reused key would
      // replay the decline. PayPal refuses a second capture of the order (ORDER_ALREADY_CAPTURED).
      requestId: `capture:${input.orderId}:${crypto.randomUUID()}`,
      merchantId: seller.merchantId,
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
      current = await deps.paypal.client.orders.get({ orderId: input.orderId, merchantId: seller.merchantId });
    } catch {
      // The capture's own error, with its debug_id, is the one worth logging.
      throw error;
    }
    if (!captureFromOrder(current)) throw error;
    order = current;
  }
  const capture = captureFromOrder(order);
  if (!capture) throw new Error(`PayPal order ${input.orderId} has no capture`);
  const result = await applyCaptureFact(deps.db, captureFact(row.id, input.orderId, capture));
  if (result === "stale") {
    throw new TRPCError({ code: "CONFLICT", message: "This payment was restarted. Reload the page and try again." });
  }
  if (capture.status === "COMPLETED") return { outcome: "captured" };
  if (capture.status === "PENDING") return { outcome: "pending" };
  return { outcome: "declined" };
}
