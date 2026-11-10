import {
  canServicesTeam,
  isStarRating,
  MAX_CLIENT_RATING_NOTE,
  MAX_PORTFOLIO_DESCRIPTION,
  MAX_PORTFOLIO_ITEMS,
  MAX_PORTFOLIO_TITLE,
  MAX_REVIEW_BODY,
  portfolioUrlProblem,
  PUBLIC_REVIEWS_SHOWN,
  publicReviewBody,
  publicReviewerName,
  ratingProblem,
  ratingSummary,
  type RatingSummary,
  reviewEditable,
  reviewEditableUntil,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import { contactWithIdentities, projectContactLink } from "@jendal-workspace/db/repositories/contacts";
import { project } from "@jendal-workspace/db/schema/projects";
import { team } from "@jendal-workspace/db/schema/organization";
import { eq } from "drizzle-orm";
import { projectHasOpenDispute } from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import {
  countPortfolio,
  deletePortfolioItem,
  findClientRating,
  findReviewForProject,
  insertPortfolioItem,
  listPortfolio,
  listPublicReviews,
  saveClientRating,
  saveSellerReview,
  teamRatingAggregates,
} from "@jendal-workspace/db/repositories/reviews";

import { fail, type ProjectActor } from "./projects";

async function ratingRefusal(db: DbExecutor, row: ProjectRow): Promise<string | null> {
  const openDispute = row.status === "completed" && (await projectHasOpenDispute(db, { teamId: row.teamId, projectId: row.id }));
  return ratingProblem({ projectStatus: row.status, openDispute });
}

async function requireProject(db: DbExecutor, projectId: string): Promise<ProjectRow> {
  const row = await findProjectById(db, projectId);
  if (!row) fail("NOT_FOUND", "Project not found.");
  return row;
}

function requireStars(rating: number) {
  if (!isStarRating(rating)) fail("BAD_REQUEST", "Choose from 1 to 5 stars.");
}

export type ClientReviewView = {
  canReview: boolean;
  problem: string | null;
  review: { rating: number; body: string; createdAt: Date; editable: boolean; editableUntil: Date } | null;
};

// What the client's page and the plugin show about rating this project.
export async function clientReviewView(db: DbExecutor, row: ProjectRow, now: Date = new Date(), contactId?: string): Promise<ClientReviewView> {
  const [problem, found] = await Promise.all([ratingRefusal(db, row), findReviewForProject(db, row.id)]);
  const editable = found ? reviewEditable(found.createdAt, now) && (contactId === undefined || found.authorContactId === contactId) : true;
  return {
    canReview: problem === null && editable,
    problem,
    review: found && {
      rating: found.rating,
      body: found.body,
      createdAt: found.createdAt,
      editable,
      editableUntil: reviewEditableUntil(found.createdAt),
    },
  };
}

// P design §1: the client of a completed project, once, editable for 30 days. Callers have checked it is their project.
export async function submitReview(
  db: Database,
  input: { projectId: string; contactId: string; rating: number; body: string },
  now: Date = new Date(),
): Promise<{ rating: number; body: string }> {
  requireStars(input.rating);
  const body = input.body.trim();
  if (body.length > MAX_REVIEW_BODY) fail("BAD_REQUEST", `Keep the review to ${MAX_REVIEW_BODY} characters.`);
  return db.transaction(async (tx) => {
    await tx.select({ id: project.id }).from(project).where(eq(project.id, input.projectId)).for("update");
    const row = await requireProject(tx, input.projectId);
    const link = await projectContactLink(tx, { projectId: row.id, contactId: input.contactId });
    if (!link) fail("NOT_FOUND", "Project not found.");
    const problem = await ratingRefusal(tx, row);
    if (problem) fail("BAD_REQUEST", problem);
    const existing = await findReviewForProject(tx, row.id);
    if (existing && existing.authorContactId !== input.contactId) {
      fail("FORBIDDEN", "Only the client who posted this review can change it.");
    }
    if (existing && !reviewEditable(existing.createdAt, now)) {
      fail("BAD_REQUEST", "Reviews can be changed for 30 days after posting. This one is now final.");
    }
    const contact = await contactWithIdentities(tx, { teamId: row.teamId, contactId: input.contactId });
    const saved = await saveSellerReview(tx, {
      projectId: row.id,
      teamId: row.teamId,
      authorContactId: input.contactId,
      rating: input.rating,
      body,
      reviewerName: existing?.reviewerName ?? publicReviewerName(contact?.name ?? ""),
    });
    return { rating: saved.rating, body: saved.body };
  });
}

export function isTeamStaff(actor: ProjectActor): boolean {
  return actor.role !== "freelancer";
}

// P design §2: an admin rates the client; only the team's staff read it.
export async function rateClient(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; rating: number; note: string },
): Promise<void> {
  if (!canServicesTeam(actor.role, "manage_settings")) fail("FORBIDDEN", "Only an admin can rate a client.");
  requireStars(input.rating);
  const note = input.note.trim();
  if (note.length > MAX_CLIENT_RATING_NOTE) fail("BAD_REQUEST", `Keep the note to ${MAX_CLIENT_RATING_NOTE} characters.`);
  await db.transaction(async (tx) => {
    // Dispute webhooks take this lock before opening a case, so eligibility and the rating commit together.
    await tx.select({ id: project.id }).from(project).where(eq(project.id, input.projectId)).for("update");
    const row = await requireProject(tx, input.projectId);
    if (row.teamId !== actor.teamId) fail("NOT_FOUND", "Project not found.");
    const problem = await ratingRefusal(tx, row);
    if (problem) fail("BAD_REQUEST", problem);
    await saveClientRating(tx, { projectId: row.id, teamId: row.teamId, rating: input.rating, note, ratedById: actor.actorId });
  });
}

export type TeamRatingsView = {
  canRateClient: boolean;
  problem: string | null;
  clientRating: { rating: number; note: string } | null;
  review: { rating: number; body: string; reviewerName: string; createdAt: Date } | null;
};

// What the team's project page shows. Freelancers see the client's public review but never the team's rating of them.
export async function teamRatingsView(db: DbExecutor, actor: ProjectActor, row: ProjectRow): Promise<TeamRatingsView> {
  const staff = isTeamStaff(actor);
  const [problem, rating, review] = await Promise.all([
    ratingRefusal(db, row),
    staff ? findClientRating(db, row.id) : null,
    findReviewForProject(db, row.id),
  ]);
  return {
    canRateClient: problem === null && canServicesTeam(actor.role, "manage_settings"),
    problem,
    clientRating: rating && { rating: rating.rating, note: rating.note },
    review: review && !review.hiddenAt
      ? { rating: review.rating, body: publicReviewBody(review.body), reviewerName: review.reviewerName, createdAt: review.createdAt }
      : null,
  };
}

export type PublicReview = { id: string; rating: number; body: string; reviewerName: string; createdAt: Date };
export type SellerReputation = {
  rating: RatingSummary | null;
  reviews: PublicReview[];
  portfolio: { id: string; title: string; url: string; description: string }[];
};

// AGT-44: what the seller page shows under the name.
export async function sellerReputation(db: DbExecutor, teamId: string): Promise<SellerReputation> {
  const [aggregates, reviews, portfolio] = await Promise.all([
    teamRatingAggregates(db, [teamId]),
    listPublicReviews(db, teamId, PUBLIC_REVIEWS_SHOWN),
    listPortfolio(db, teamId),
  ]);
  return {
    rating: ratingSummary(aggregates.get(teamId)),
    reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, body: publicReviewBody(r.body), reviewerName: r.reviewerName, createdAt: r.createdAt })),
    portfolio: portfolio.map((p) => ({ id: p.id, title: p.title, url: p.url, description: p.description })),
  };
}

// AGT-45: the rating each seller's offerings carry in search.
export async function sellerRatings(db: DbExecutor, teamIds: readonly string[]): Promise<Map<string, RatingSummary>> {
  const aggregates = await teamRatingAggregates(db, teamIds);
  return new Map([...aggregates].flatMap(([teamId, aggregate]) => {
    const summary = ratingSummary(aggregate);
    return summary ? [[teamId, summary] as const] : [];
  }));
}

function requireAdmin(actor: ProjectActor) {
  if (!canServicesTeam(actor.role, "manage_settings")) fail("FORBIDDEN", "Only an admin can change the portfolio.");
}

export async function addPortfolioItem(
  db: Database,
  actor: ProjectActor,
  input: { title: string; url: string; description: string },
): Promise<{ id: string }> {
  requireAdmin(actor);
  const title = input.title.trim();
  const url = input.url.trim();
  const description = input.description.trim();
  if (title.length === 0) fail("BAD_REQUEST", "Give the work a title.");
  if (title.length > MAX_PORTFOLIO_TITLE) fail("BAD_REQUEST", `Keep the title to ${MAX_PORTFOLIO_TITLE} characters.`);
  if (description.length > MAX_PORTFOLIO_DESCRIPTION) fail("BAD_REQUEST", `Keep the description to ${MAX_PORTFOLIO_DESCRIPTION} characters.`);
  const urlProblem = portfolioUrlProblem(url);
  if (urlProblem) fail("BAD_REQUEST", urlProblem);
  return db.transaction(async (tx) => {
    await tx.select({ id: team.id }).from(team).where(eq(team.id, actor.teamId)).for("update");
    if ((await countPortfolio(tx, actor.teamId)) >= MAX_PORTFOLIO_ITEMS) {
      fail("BAD_REQUEST", `A portfolio holds up to ${MAX_PORTFOLIO_ITEMS} items. Remove one first.`);
    }
    const row = await insertPortfolioItem(tx, { teamId: actor.teamId, title, url, description });
    return { id: row.id };
  });
}

export async function removePortfolioItem(db: Database, actor: ProjectActor, input: { id: string }): Promise<void> {
  requireAdmin(actor);
  if (!(await deletePortfolioItem(db, { teamId: actor.teamId, id: input.id }))) fail("NOT_FOUND", "That item is not in the portfolio.");
}
