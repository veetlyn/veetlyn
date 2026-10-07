import {
  parseMajorAmount,
  paymentCapturedTransfer,
  platformFeeMinor,
  sellerPlanFor,
  toPayPalValue,
  transitionProject,
  transitionRefusalMessage,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { findProjectById, getCurrentQuote, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import { ProjectConflictError, runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { payment, type project } from "@jendal-workspace/db/schema/projects";
import { captureFromOrder, PayPalError, type PayPalOrder } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or } from "drizzle-orm";

import type { PayPalServices } from "../context";

// One capture as PayPal reports it: from a capture response, an order lookup or a webhook (R1c).
export type CaptureFact = {
  paymentId: string;
  orderId: string;
  captureId: string;
  status: string;
  // Null when PayPal sent no amount (a pending capture can omit it).
  amountMinor: number | null;
  currency: string | null;
};

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
// moved in a way Payleor did not ask for; that needs a person, so it throws instead of guessing.
function checkCaptureBelongs(row: PaymentRow, fact: CaptureFact): void {
  if (row.paypalCaptureId && row.paypalCaptureId !== fact.captureId) {
    throw new Error(`Payment ${row.id} already has capture ${row.paypalCaptureId}; PayPal reported ${fact.captureId}`);
  }
  if (row.paypalOrderId !== fact.orderId && row.paypalCaptureId !== fact.captureId) {
    if (fact.status === "COMPLETED") {
      throw new Error(`Capture ${fact.captureId} completed on order ${fact.orderId}, which payment ${row.id} no longer uses`);
    }
    throw new StaleFact();
  }
}

async function projectChangeOnCapture(
  tx: Transaction,
  row: ProjectRow,
  kind: PaymentRow["kind"],
): Promise<Partial<typeof project.$inferInsert>> {
  if (kind === "top_up") return {};
  if (kind === "balance") {
    // The balance capture completes the project with the completion postings (services spec §6.3, run 2).
    throw new Error(`Payment kind ${kind} cannot be captured yet`);
  }
  const result = transitionProject(row.status, "deposit_captured");
  if (!result.ok) {
    throw new Error(`Project ${row.id} cannot take its deposit: ${transitionRefusalMessage(result.reason)}`);
  }
  const quote = await getCurrentQuote(tx, row.id);
  if (!quote) throw new Error(`Project ${row.id} has a deposit but no accepted quote`);
  // Services spec §5.2 step 4: the deadline runs from the capture.
  return { status: result.to, deadlineAt: new Date(Date.now() + quote.deliveryDays * DAY_MS) };
}

// A pending capture changes no money: it only records the capture id, so the later outcome matches it.
async function recordPendingCapture(db: Database, fact: CaptureFact): Promise<CaptureFactResult> {
  const updated = await db
    .update(payment)
    .set({ paypalCaptureId: fact.captureId })
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
      if (fact.status === "COMPLETED") throw new Error(`Capture ${fact.captureId} completed on cancelled payment ${row.id}`);
      throw new StaleFact();
    }
    if (row.status === "captured" || (row.status === "failed" && row.paypalCaptureId === fact.captureId)) {
      throw new FactAlreadyApplied();
    }
    const projectRow = await findProjectById(tx, row.projectId);
    if (!projectRow) throw new Error(`Payment ${row.id} has no project`);

    if (fact.status === "COMPLETED") {
      if (fact.amountMinor !== row.amountMinor || fact.currency !== row.currency) {
        throw new Error(
          `Capture ${fact.captureId} (${fact.currency} ${fact.amountMinor}) does not match payment ${row.id} (${row.currency} ${row.amountMinor})`,
        );
      }
      await tx
        .update(payment)
        .set({ status: "captured", paypalCaptureId: fact.captureId, capturedAt: new Date(), version: row.version + 1 })
        .where(eq(payment.id, row.id));
      await uow.apply({
        project: projectRow,
        set: await projectChangeOnCapture(tx, projectRow, row.kind),
        transfers: [
          paymentCapturedTransfer({
            currency: row.currency,
            projectId: row.projectId,
            paymentId: row.id,
            quotePartMinor: row.quotePartMinor,
            managementFeeMinor: row.managementFeeMinor,
          }),
        ],
        events: [
          {
            type: "payment.captured",
            data: { paymentId: row.id, kind: row.kind, amountMinor: row.amountMinor, captureId: fact.captureId },
          },
        ],
      });
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

// Services spec §6.4: applies each capture outcome at most once, whichever input reports it first. The
// payment row stays locked for the transaction, so the pay page and a webhook cannot both apply it.
export async function applyCaptureFact(db: Database, fact: CaptureFact): Promise<CaptureFactResult> {
  if (fact.status === "PENDING") return recordPendingCapture(db, fact);
  if (fact.status !== "COMPLETED" && fact.status !== "DECLINED" && fact.status !== "FAILED") {
    // REFUNDED and PARTIALLY_REFUNDED are refund news, handled with refunds.
    throw new Error(`Capture ${fact.captureId} has status ${fact.status}, which is not a capture outcome`);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await applyInTransaction(db, fact);
    } catch (error) {
      // Thrown inside the transaction to roll it back: nothing was written.
      if (error instanceof FactAlreadyApplied) return "already_applied";
      if (error instanceof StaleFact) return "stale";
      if (error instanceof ProjectConflictError && attempt < MAX_CONFLICT_ATTEMPTS) continue;
      throw error;
    }
  }
}

export type PaymentDeps = { db: Database; paypal: PayPalServices };

async function requirePayment(db: Database, paymentId: string): Promise<PaymentRow> {
  const [row] = await db.select().from(payment).where(eq(payment.id, paymentId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return row;
}

async function requireSeller(db: Database, teamId: string): Promise<{ merchantId: string; name: string }> {
  const team = await findTeamById(db, teamId);
  if (!team?.paypalMerchantId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This team cannot take PayPal payments yet." });
  }
  return { merchantId: team.paypalMerchantId, name: team.name };
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

// Services spec §5.4. Every start creates a fresh order for the payment's amount and makes it the only
// order this payment can be captured on, so an abandoned order can never be paid as well.
export async function startPayment(deps: PaymentDeps, paymentId: string): Promise<{ orderId: string }> {
  const row = await requirePayment(deps.db, paymentId);
  if (row.status === "captured") throw new TRPCError({ code: "CONFLICT", message: "This payment is already paid." });
  if (row.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This payment was cancelled." });
  if (row.status === "pending" && row.paypalCaptureId) {
    throw new TRPCError({ code: "CONFLICT", message: "PayPal is still processing this payment. Check back soon." });
  }
  if (row.kind === "balance") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Balance payments open once deliveries can be accepted." });
  }
  const projectRow = await findProjectById(deps.db, row.projectId);
  if (!projectRow) throw new Error(`Payment ${row.id} has no project`);
  const seller = await requireSeller(deps.db, row.teamId);
  const fee = platformFeeMinor(row.amountMinor, sellerPlanFor({ id: row.teamId }).feeBps);
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
  });
  const updated = await deps.db
    .update(payment)
    .set({ paypalOrderId: order.id, platformFeeMinor: fee, status: "pending", paypalCaptureId: null, version: row.version + 1 })
    .where(and(eq(payment.id, row.id), eq(payment.version, row.version)))
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

export async function capturePayment(
  deps: PaymentDeps,
  input: { paymentId: string; orderId: string },
): Promise<{ outcome: CaptureOutcome }> {
  const row = await requirePayment(deps.db, input.paymentId);
  if (row.paypalOrderId !== input.orderId) {
    throw new TRPCError({ code: "CONFLICT", message: "This payment was restarted. Reload the page and try again." });
  }
  if (row.status === "captured") return { outcome: "captured" };
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
    if (!hasIssue(error, "ORDER_ALREADY_CAPTURED")) throw error;
    // An earlier capture succeeded but its answer was lost: the order holds the capture to apply.
    order = await deps.paypal.client.orders.get({ orderId: input.orderId, merchantId: seller.merchantId });
  }
  const capture = captureFromOrder(order);
  if (!capture) throw new Error(`PayPal order ${input.orderId} has no capture`);
  const result = await applyCaptureFact(deps.db, {
    paymentId: row.id,
    orderId: input.orderId,
    captureId: capture.id,
    status: capture.status,
    amountMinor: capture.amount ? parseMajorAmount(capture.amount.value) : null,
    currency: capture.amount?.currency_code ?? null,
  });
  if (result === "stale") {
    throw new TRPCError({ code: "CONFLICT", message: "This payment was restarted. Reload the page and try again." });
  }
  if (capture.status === "COMPLETED") return { outcome: "captured" };
  if (capture.status === "PENDING") return { outcome: "pending" };
  return { outcome: "declined" };
}
