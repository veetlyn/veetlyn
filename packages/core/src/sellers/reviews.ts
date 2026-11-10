import { maskContactDetails } from "../conversations/masking";
import type { ProjectStatus } from "../projects/state-machine";

// P design §1: a review is earned by paid, delivered work, stays the client's own words, and shows no contact details.
export const MAX_REVIEW_BODY = 1_000;
export const MAX_CLIENT_RATING_NOTE = 500;
export const REVIEW_EDIT_DAYS = 30;
export const PUBLIC_REVIEWS_SHOWN = 20;
export const MAX_PORTFOLIO_TITLE = 120;
export const MAX_PORTFOLIO_DESCRIPTION = 500;
export const MAX_PORTFOLIO_ITEMS = 24;

const DAY_MS = 86_400_000;

export function isStarRating(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

// Why this project cannot be rated now, or null when it can. Only a completed project was delivered, accepted and paid.
export function ratingProblem(input: { projectStatus: ProjectStatus; openDispute: boolean }): string | null {
  if (input.projectStatus !== "completed") return "A project can be rated once it is completed and paid.";
  if (input.openDispute) return "This project has an open PayPal case. Rate it once the case is resolved.";
  return null;
}

export function reviewEditableUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REVIEW_EDIT_DAYS * DAY_MS);
}

export function reviewEditable(createdAt: Date, now: Date): boolean {
  return now < reviewEditableUntil(createdAt);
}

// "Rita Client" → "Rita C."; a single name stays as it is; nothing usable reads as "A client".
export function publicReviewerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const [first, ...rest] = parts;
  if (!first || first.includes("@")) return "A client";
  const last = rest.at(-1);
  return last ? `${first} ${last[0]?.toLocaleUpperCase() ?? ""}.` : first;
}

export function publicReviewBody(body: string): string {
  return maskContactDetails(body.trim()).shown;
}

export type RatingSummary = { average: number; count: number };

// Null with no ratings: a seller nobody rated shows no stars, not zero (AGT-45).
export function ratingSummary(aggregate: RatingSummary | undefined): RatingSummary | null {
  if (!aggregate || aggregate.count === 0) return null;
  return { average: Math.round(aggregate.average * 10) / 10, count: aggregate.count };
}

export function ratingLabel(summary: RatingSummary | null): string | null {
  if (!summary) return null;
  return `${summary.average.toFixed(1)} ★ (${summary.count} ${summary.count === 1 ? "review" : "reviews"})`;
}

// A full https link to a host: core has no URL parser, so the shape is checked here and the database checks the scheme.
const HTTPS_LINK = /^https:\/\/[^\s/?#.]+(\.[^\s/?#.]+)+([/?#][^\s]*)?$/i;

export function portfolioUrlProblem(url: string): string | null {
  const link = url.trim();
  if (/^https:\/\//i.test(link)) return HTTPS_LINK.test(link) ? null : "Enter the full link, starting with https://.";
  return /^[a-z][a-z0-9+.-]*:/i.test(link) ? "Use a secure link that starts with https://." : "Enter the full link, starting with https://.";
}
