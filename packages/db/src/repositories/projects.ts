import type { ProjectPaid } from "@jendal-workspace/core";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { amendment, payment, project, quote, quoteItem } from "../schema/projects";

export type ProjectRow = typeof project.$inferSelect;
export type QuoteRow = typeof quote.$inferSelect;
export type QuoteItemRow = typeof quoteItem.$inferSelect;
export type AmendmentRow = typeof amendment.$inferSelect;
export type PaymentRow = typeof payment.$inferSelect;
export type QuoteWithItems = QuoteRow & { items: QuoteItemRow[] };

export async function findProjectById(tx: DbExecutor, id: string): Promise<ProjectRow | null> {
  const [row] = await tx.select().from(project).where(eq(project.id, id)).limit(1);
  return row ?? null;
}

export async function listTeamProjects(tx: DbExecutor, teamId: string): Promise<ProjectRow[]> {
  // id breaks created_at ties so the list is stable.
  return tx.select().from(project).where(eq(project.teamId, teamId)).orderBy(desc(project.createdAt), asc(project.id));
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
  const [unpaidTopUp] = await tx
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.projectId, projectId), eq(payment.kind, "top_up"), eq(payment.status, "pending")))
    .limit(1);
  return {
    paidQuoteMinor: paid?.paidQuoteMinor ?? 0,
    paidManagementFeeMinor: paid?.paidManagementFeeMinor ?? 0,
    managementFeeCreditedMinor: credit?.managementFeeCreditedMinor ?? 0,
    pendingAmendment: pendingAmendment !== undefined,
    unpaidTopUp: unpaidTopUp !== undefined,
  };
}
