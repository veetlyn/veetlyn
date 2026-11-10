import { and, asc, avg, count, desc, eq, inArray, isNull } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { clientRating, portfolioItem, sellerReview } from "../schema/reviews";

export type SellerReviewRow = typeof sellerReview.$inferSelect;
export type ClientRatingRow = typeof clientRating.$inferSelect;
export type PortfolioItemRow = typeof portfolioItem.$inferSelect;
export type RatingAggregate = { average: number; count: number };

export async function findReviewForProject(db: DbExecutor, projectId: string): Promise<SellerReviewRow | null> {
  const [row] = await db.select().from(sellerReview).where(eq(sellerReview.projectId, projectId)).limit(1);
  return row ?? null;
}

// The use case decides whether the client may still write; this keeps one review per project either way.
export async function saveSellerReview(
  db: DbExecutor,
  values: { projectId: string; teamId: string; authorContactId: string; rating: number; body: string; reviewerName: string },
): Promise<SellerReviewRow> {
  const [row] = await db
    .insert(sellerReview)
    .values(values)
    .onConflictDoUpdate({
      target: sellerReview.projectId,
      set: { rating: values.rating, body: values.body, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Saving the review returned no row");
  return row;
}

export async function listPublicReviews(db: DbExecutor, teamId: string, limit: number): Promise<SellerReviewRow[]> {
  return db
    .select()
    .from(sellerReview)
    .where(and(eq(sellerReview.teamId, teamId), isNull(sellerReview.hiddenAt)))
    .orderBy(desc(sellerReview.createdAt), desc(sellerReview.id))
    .limit(limit);
}

// The raw average and count of visible reviews per team; rounding is core's ratingSummary. Teams without reviews are absent.
export async function teamRatingAggregates(db: DbExecutor, teamIds: readonly string[]): Promise<Map<string, RatingAggregate>> {
  if (teamIds.length === 0) return new Map();
  const rows = await db
    .select({ teamId: sellerReview.teamId, average: avg(sellerReview.rating), count: count() })
    .from(sellerReview)
    .where(and(inArray(sellerReview.teamId, [...teamIds]), isNull(sellerReview.hiddenAt)))
    .groupBy(sellerReview.teamId);
  return new Map(rows.map((row) => [row.teamId, { average: Number(row.average ?? 0), count: row.count }]));
}

export async function findClientRating(db: DbExecutor, projectId: string): Promise<ClientRatingRow | null> {
  const [row] = await db.select().from(clientRating).where(eq(clientRating.projectId, projectId)).limit(1);
  return row ?? null;
}

export async function saveClientRating(
  db: DbExecutor,
  values: { projectId: string; teamId: string; rating: number; note: string; ratedById: string },
): Promise<ClientRatingRow> {
  const [row] = await db
    .insert(clientRating)
    .values(values)
    .onConflictDoUpdate({
      target: clientRating.projectId,
      set: { rating: values.rating, note: values.note, ratedById: values.ratedById, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Saving the client rating returned no row");
  return row;
}

export async function listPortfolio(db: DbExecutor, teamId: string): Promise<PortfolioItemRow[]> {
  return db
    .select()
    .from(portfolioItem)
    .where(eq(portfolioItem.teamId, teamId))
    .orderBy(asc(portfolioItem.createdAt), asc(portfolioItem.id));
}

export async function countPortfolio(db: DbExecutor, teamId: string): Promise<number> {
  const [row] = await db.select({ count: count() }).from(portfolioItem).where(eq(portfolioItem.teamId, teamId));
  return row?.count ?? 0;
}

export async function insertPortfolioItem(
  db: DbExecutor,
  values: { teamId: string; title: string; url: string; description: string },
): Promise<PortfolioItemRow> {
  const [row] = await db.insert(portfolioItem).values(values).returning();
  if (!row) throw new Error("Insert into portfolio_item returned no row");
  return row;
}

export async function deletePortfolioItem(db: DbExecutor, input: { teamId: string; id: string }): Promise<boolean> {
  const rows = await db
    .delete(portfolioItem)
    .where(and(eq(portfolioItem.id, input.id), eq(portfolioItem.teamId, input.teamId)))
    .returning({ id: portfolioItem.id });
  return rows.length > 0;
}
