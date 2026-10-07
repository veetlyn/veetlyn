import { paymentCapturedTransfer, transitionProject, transitionRefusalMessage } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { findProjectById, getCurrentQuote, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { payment, type project } from "@jendal-workspace/db/schema/projects";
import { and, eq } from "drizzle-orm";

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

// "stale": the fact is about an order this payment no longer uses, and no money moved.
export type CaptureFactResult = "applied" | "already_applied" | "pending" | "failed" | "stale";

const DAY_MS = 86_400_000;

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
    .where(and(eq(payment.id, fact.paymentId), eq(payment.status, "pending"), eq(payment.paypalOrderId, fact.orderId)))
    .returning({ id: payment.id });
  return updated.length > 0 ? "pending" : "stale";
}

// Services spec §6.4: applies each capture outcome at most once, whichever input reports it first. The
// payment row stays locked for the transaction, so the pay page and a webhook cannot both apply it.
export async function applyCaptureFact(db: Database, fact: CaptureFact): Promise<CaptureFactResult> {
  if (fact.status === "PENDING") return recordPendingCapture(db, fact);
  if (fact.status !== "COMPLETED" && fact.status !== "DECLINED" && fact.status !== "FAILED") {
    // REFUNDED and PARTIALLY_REFUNDED are refund news, handled with refunds.
    throw new Error(`Capture ${fact.captureId} has status ${fact.status}, which is not a capture outcome`);
  }
  try {
    return await runInTransaction(db, async (tx, uow) => {
      const row = await lockPayment(tx, fact.paymentId);
      checkCaptureBelongs(row, fact);
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
  } catch (error) {
    // Thrown inside the transaction to roll it back: nothing was written.
    if (error instanceof FactAlreadyApplied) return "already_applied";
    if (error instanceof StaleFact) return "stale";
    throw error;
  }
}
