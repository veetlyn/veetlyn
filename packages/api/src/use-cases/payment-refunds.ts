import {
  ledgerAccounts,
  parseMajorAmount,
  paymentRefundedTransfer,
  refundConfirmedTransfer,
  refundFeesTransfer,
  splitServicesRefund,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import { createPostgresLedger, hasLedgerReference } from "@jendal-workspace/db/repositories/ledger";
import {
  completeProjectRefundIfDone,
  findProjectRefundForProject,
  findRefundPartByPayPalRefundId,
  listRefundParts,
  lockProjectRefund,
  markRefundPartCompleted,
} from "@jendal-workspace/db/repositories/project-refunds";
import { addPaymentRefunded, type PaymentRow } from "@jendal-workspace/db/repositories/projects";
import { payment } from "@jendal-workspace/db/schema/projects";
import { type PayPalOrder, type PayPalRefund, refundsFromOrder } from "@jendal-workspace/paypal";
import { eq } from "drizzle-orm";
import { log } from "evlog";

import { capturesIn, isRefundedCaptureStatus, postIfNew, returnedFees } from "./paypal-amounts";
import { CaptureFactConflict, captureFact, recordCaptureFees } from "./payments";

type PaymentRefundResult = "refunded" | "not captured";
type AppliedRefund = "applied" | "already_applied" | "skipped";

async function findPaymentRow(tx: DbExecutor, paymentId: string): Promise<PaymentRow> {
  const [row] = await tx.select().from(payment).where(eq(payment.id, paymentId)).limit(1);
  if (!row) throw new Error(`PayPal reported refund news for unknown payment ${paymentId}`);
  return row;
}

async function lockCapturedPayment(tx: Transaction, paymentId: string): Promise<PaymentRow> {
  const [row] = await tx.select().from(payment).where(eq(payment.id, paymentId)).limit(1).for("update");
  if (!row) throw new Error(`PayPal reported refund news for unknown payment ${paymentId}`);
  if (row.status !== "captured" && row.status !== "refunded") {
    throw new CaptureFactConflict(`PayPal refunded payment ${row.id}, which is ${row.status}, not captured`);
  }
  return row;
}

// Services decision 4: money PayPal gave back without a request comes out of client_held first (see
// splitServicesRefund), and the payment counts it as refunded. The balance is read under the payment lock but
// another payment of the project may move client_held meanwhile. A higher stale read is refused by the ledger
// (negative balance) and the queue retries with a fresh read; a lower one only shifts the split toward
// team_revenue, which getProjectFacts reads back from the posting, so paid totals stay consistent.
async function postUnrequestedRefund(
  tx: Transaction,
  row: PaymentRow,
  input: { refundKey: string; amountMinor: number },
): Promise<boolean> {
  const clientHeldMinor = await createPostgresLedger(row.teamId, tx).balance(
    ledgerAccounts.clientHeld(row.projectId),
    row.currency,
  );
  const split = splitServicesRefund({ amountMinor: input.amountMinor, clientHeldMinor });
  const posted = await postIfNew(
    tx,
    row.teamId,
    paymentRefundedTransfer({ currency: row.currency, projectId: row.projectId, refundKey: input.refundKey, ...split }),
  );
  if (posted) await addPaymentRefunded(tx, row.id, input.amountMinor);
  return posted;
}

async function postReturnedFees(tx: Transaction, row: PaymentRow, refund: PayPalRefund): Promise<void> {
  const fees = returnedFees(row.currency, refund.seller_payable_breakdown);
  if (!fees) {
    log.warn({ action: "payment.refund_fees", payment: { id: row.id }, refund: { id: refund.id, posted: false } });
    return;
  }
  const transfer = refundFeesTransfer({ currency: row.currency, projectId: row.projectId, refundId: refund.id, ...fees });
  if (transfer) await postIfNew(tx, row.teamId, transfer);
}

// Applies one COMPLETED PayPal refund of a services payment, once, inside the caller's transaction: the capture
// refund answer and the webhook may both report it. A refund Payleor issued for an overpayment confirms its
// part (refund_confirmed); any other is posted as payment_refunded. Locks the project's refund before the payment,
// the order the admin's refund call takes too.
export async function applyCompletedPaymentRefund(
  tx: Transaction,
  input: { paymentId: string; refund: PayPalRefund; now?: Date },
): Promise<AppliedRefund> {
  const { refund } = input;
  if (refund.status !== "COMPLETED") throw new Error(`Refund ${refund.id} is ${refund.status}, not completed`);
  const unlocked = await findPaymentRow(tx, input.paymentId);
  const amountMinor = refund.amount?.currency_code === unlocked.currency ? parseMajorAmount(refund.amount.value) : null;
  if (amountMinor === null) {
    log.warn({ action: "payment.refund", payment: { id: unlocked.id }, refund: { id: refund.id, posted: false } });
    return "skipped";
  }
  const found = await findProjectRefundForProject(tx, unlocked.projectId);
  // Waits for an admin's refund call still storing PayPal's refund id, so its refund is matched below. The status
  // checked further down must come from this locked read: a stale "requested" would post an overpayment refund
  // as payment_refunded.
  const projectRefund = found ? await lockProjectRefund(tx, found.id) : null;
  const part = await findRefundPartByPayPalRefundId(tx, refund.id);
  const row = await lockCapturedPayment(tx, input.paymentId);

  if (part) {
    if (part.paymentId !== row.id) {
      throw new CaptureFactConflict(`Refund ${refund.id} belongs to payment ${part.paymentId}, not ${row.id}`);
    }
    if (await hasLedgerReference(tx, row.teamId, `payment_refunded:refund:${refund.id}`)) {
      throw new CaptureFactConflict(`Refund ${refund.id} was posted as unrequested before it matched its overpayment part`);
    }
    const posted = await postIfNew(
      tx,
      row.teamId,
      refundConfirmedTransfer({ currency: row.currency, projectId: row.projectId, refundId: refund.id, amountMinor }),
    );
    if (posted) await addPaymentRefunded(tx, row.id, amountMinor);
    await postReturnedFees(tx, row, refund);
    await markRefundPartCompleted(tx, part.id);
    await completeProjectRefundIfDone(tx, part.projectRefundId, input.now ?? new Date());
    return posted ? "applied" : "already_applied";
  }

  if (projectRefund && projectRefund.status !== "completed") {
    const parts = await listRefundParts(tx, projectRefund.id);
    if (parts.some((item) => item.paymentId === row.id && item.status === "pending" && item.paypalRefundId === null)) {
      // Posting it as unrequested would refund the overpayment from client_held; the retry finds its part.
      throw new Error(`Refund ${refund.id} of payment ${row.id} may be the overpayment refund still being issued`);
    }
  }
  if (await hasLedgerReference(tx, row.teamId, `refund_confirmed:${refund.id}`)) {
    throw new CaptureFactConflict(`Refund ${refund.id} was confirmed as an overpayment refund but no part names it`);
  }
  const posted = await postUnrequestedRefund(tx, row, { refundKey: `refund:${refund.id}`, amountMinor });
  await postReturnedFees(tx, row, refund);
  return posted ? "applied" : "already_applied";
}

// A reversal (chargeback) takes back what the refunds left with the team, not the full amount again.
async function applyReversal(tx: Transaction, paymentId: string, captureId: string): Promise<void> {
  const row = await lockCapturedPayment(tx, paymentId);
  const reversedMinor = row.amountMinor - row.refundedMinor;
  if (reversedMinor <= 0) return;
  await postUnrequestedRefund(tx, row, { refundKey: `reversal:${captureId}`, amountMinor: reversedMinor });
}

// Applies the refunds and reversal PayPal's order shows for a services payment, each once by its PayPal id,
// whichever event reports it. expectedRefundId is the refund the event reported: until PayPal's order lists it,
// the queue retries.
export async function applyPaymentRefunds(
  deps: { db: Database },
  paymentId: string,
  paypalOrder: PayPalOrder,
  options: { expectedRefundId?: string | null; now?: Date } = {},
): Promise<PaymentRefundResult> {
  const row = await findPaymentRow(deps.db, paymentId);
  const captures = capturesIn(paypalOrder);
  if (row.status !== "captured" && row.status !== "refunded") {
    const early = captures.find((item) => isRefundedCaptureStatus(item.status));
    if (!early) return "not captured";
    // Recording it would start or complete the project with money the client already got back.
    throw new CaptureFactConflict(`Capture ${early.id} of payment ${row.id} was refunded before Payleor applied it`);
  }
  const captureId = row.paypalCaptureId;
  if (!captureId) throw new Error(`Payment ${row.id} is ${row.status} without a capture`);
  const capture = captures.find((item) => item.id === captureId) ?? null;
  const refunds = refundsFromOrder(paypalOrder).filter((refund) => refund.status === "COMPLETED");
  if (capture?.status !== "REVERSED" && refunds.length === 0) {
    // PayPal sent refund news, so its order lookup is lagging; the queue retries.
    throw new Error(`PayPal order ${paypalOrder.id} lists no completed refund yet for capture ${captureId}`);
  }
  // The capture's fees may not be recorded yet when a refund lands before the fee step.
  if (capture) await recordCaptureFees(deps.db, captureFact(row.id, paypalOrder.id, capture));

  for (const refund of refunds) {
    await deps.db.transaction((tx) => applyCompletedPaymentRefund(tx, { paymentId: row.id, refund, now: options.now }));
  }
  if (capture?.status === "REVERSED") await deps.db.transaction((tx) => applyReversal(tx, row.id, captureId));

  const { expectedRefundId } = options;
  if (expectedRefundId && !refunds.some((refund) => refund.id === expectedRefundId)) {
    throw new Error(`PayPal order ${paypalOrder.id} does not list refund ${expectedRefundId} as completed yet`);
  }
  return "refunded";
}
