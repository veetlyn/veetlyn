import { type CaptureReviewReason, OPEN_PROJECT_STATUSES, type ProjectPaid } from "@jendal-workspace/core";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { amendment, delivery, payment, project, quote, quoteItem } from "../schema/projects";

export type ProjectRow = typeof project.$inferSelect;
export type QuoteRow = typeof quote.$inferSelect;
export type QuoteItemRow = typeof quoteItem.$inferSelect;
export type AmendmentRow = typeof amendment.$inferSelect;
export type PaymentRow = typeof payment.$inferSelect;
export type DeliveryRow = typeof delivery.$inferSelect;
export type QuoteWithItems = QuoteRow & { items: QuoteItemRow[] };

export async function findProjectById(tx: DbExecutor, id: string): Promise<ProjectRow | null> {
  const [row] = await tx.select().from(project).where(eq(project.id, id)).limit(1);
  return row ?? null;
}

export async function listTeamProjects(tx: DbExecutor, teamId: string): Promise<ProjectRow[]> {
  // id breaks created_at ties so the list is stable.
  return tx.select().from(project).where(eq(project.teamId, teamId)).orderBy(desc(project.createdAt), asc(project.id));
}

// The "3 open web requests per email per team" limit (sellers design §4.2).
export async function countOpenWebRequests(
  tx: DbExecutor,
  input: { teamId: string; clientEmail: string },
): Promise<number> {
  const [row] = await tx
    .select({ count: count() })
    .from(project)
    .where(
      and(
        eq(project.teamId, input.teamId),
        eq(project.clientEmail, input.clientEmail),
        eq(project.source, "web"),
        inArray(project.status, OPEN_PROJECT_STATUSES),
      ),
    );
  return row?.count ?? 0;
}

async function withItems(tx: DbExecutor, quotes: QuoteRow[]): Promise<QuoteWithItems[]> {
  const result: QuoteWithItems[] = [];
  for (const row of quotes) {
    const items = await tx
      .select()
      .from(quoteItem)
      .where(eq(quoteItem.quoteId, row.id))
      .orderBy(asc(quoteItem.position));
    result.push({ ...row, items });
  }
  return result;
}

export async function getCurrentQuote(tx: DbExecutor, projectId: string): Promise<QuoteWithItems | null> {
  const [row] = await tx
    .select()
    .from(quote)
    .where(and(eq(quote.projectId, projectId), eq(quote.status, "accepted")))
    .limit(1);
  if (!row) return null;
  const [withItemRows] = await withItems(tx, [row]);
  return withItemRows ?? null;
}

export async function listProjectQuotes(tx: DbExecutor, projectId: string): Promise<QuoteWithItems[]> {
  const rows = await tx
    .select()
    .from(quote)
    .where(eq(quote.projectId, projectId))
    .orderBy(asc(quote.version), asc(quote.createdAt), asc(quote.id));
  return withItems(tx, rows);
}

export async function listProjectAmendments(tx: DbExecutor, projectId: string): Promise<AmendmentRow[]> {
  return tx
    .select()
    .from(amendment)
    .where(eq(amendment.projectId, projectId))
    .orderBy(asc(amendment.createdAt), asc(amendment.id));
}

export async function listProjectPayments(tx: DbExecutor, projectId: string): Promise<PaymentRow[]> {
  return tx
    .select()
    .from(payment)
    .where(eq(payment.projectId, projectId))
    .orderBy(asc(payment.createdAt), asc(payment.id));
}

// Payments a refund can still be taken from, newest capture first.
export async function listRefundablePayments(tx: DbExecutor, projectId: string): Promise<PaymentRow[]> {
  return tx
    .select()
    .from(payment)
    .where(
      and(
        eq(payment.projectId, projectId),
        eq(payment.status, "captured"),
        isNotNull(payment.paypalCaptureId),
        gt(payment.amountMinor, payment.refundedMinor),
      ),
    )
    .orderBy(desc(payment.capturedAt), desc(payment.id));
}

// Adds a refund PayPal made on the capture; once nothing is left the payment becomes "refunded". Refunding more
// than was captured breaks payment_refunded_check, so a miscounted refund fails instead of posting.
export async function addPaymentRefunded(
  tx: DbExecutor,
  paymentId: string,
  amountMinor: number,
): Promise<PaymentRow | null> {
  const [row] = await tx
    .update(payment)
    .set({
      refundedMinor: sql`${payment.refundedMinor} + ${amountMinor}`,
      status: sql`case when ${payment.refundedMinor} + ${amountMinor} >= ${payment.amountMinor} then 'refunded' else ${payment.status} end`,
    })
    .where(eq(payment.id, paymentId))
    .returning();
  return row ?? null;
}

export async function setPaymentReviewReason(
  tx: DbExecutor,
  paymentId: string,
  reason: CaptureReviewReason,
): Promise<void> {
  await tx.update(payment).set({ reviewReason: reason }).where(eq(payment.id, paymentId));
}

export type ProjectFactsRow = ProjectPaid & { pendingAmendment: boolean; unpaidTopUp: boolean };

// What the state machine guards and the money math need, read inside the transaction (§6.1).
export async function getProjectFacts(tx: DbExecutor, projectId: string): Promise<ProjectFactsRow> {
  const [paid] = await tx
    .select({
      paidQuoteMinor: sql<number>`coalesce(sum(${payment.quotePartMinor}), 0)`.mapWith(Number),
      paidManagementFeeMinor: sql<number>`coalesce(sum(${payment.managementFeeMinor}), 0)`.mapWith(Number),
    })
    .from(payment)
    .where(and(eq(payment.projectId, projectId), eq(payment.status, "captured")));
  const [credit] = await tx
    .select({
      managementFeeCreditedMinor: sql<number>`coalesce(sum(${amendment.managementFeeCreditMinor}), 0)`.mapWith(Number),
    })
    .from(amendment)
    .where(and(eq(amendment.projectId, projectId), eq(amendment.status, "accepted")));
  const [pendingAmendment] = await tx
    .select({ id: amendment.id })
    .from(amendment)
    .where(and(eq(amendment.projectId, projectId), eq(amendment.status, "pending")))
    .limit(1);
  // A failed top-up can still be paid, so it is as unpaid as a pending one.
  const [unpaidTopUp] = await tx
    .select({ id: payment.id })
    .from(payment)
    .where(
      and(eq(payment.projectId, projectId), eq(payment.kind, "top_up"), inArray(payment.status, ["pending", "failed"])),
    )
    .limit(1);
  return {
    paidQuoteMinor: paid?.paidQuoteMinor ?? 0,
    paidManagementFeeMinor: paid?.paidManagementFeeMinor ?? 0,
    managementFeeCreditedMinor: credit?.managementFeeCreditedMinor ?? 0,
    pendingAmendment: pendingAmendment !== undefined,
    unpaidTopUp: unpaidTopUp !== undefined,
  };
}

export async function listProjectDeliveries(tx: DbExecutor, projectId: string): Promise<DeliveryRow[]> {
  return tx
    .select()
    .from(delivery)
    .where(eq(delivery.projectId, projectId))
    .orderBy(asc(delivery.createdAt), asc(delivery.id));
}
