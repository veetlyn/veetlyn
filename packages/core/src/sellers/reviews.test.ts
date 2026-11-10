import { describe, expect, it } from "vitest";

import {
  isStarRating,
  portfolioUrlProblem,
  publicReviewBody,
  publicReviewerName,
  ratingLabel,
  ratingProblem,
  ratingSummary,
  reviewEditable,
} from "./reviews";

describe("ratingProblem", () => {
  it.each(["quoting", "awaiting_deposit", "in_progress", "delivered", "awaiting_balance", "cancelled", "declined", "expired", "abandoned"] as const)(
    "refuses a %s project",
    (projectStatus) => expect(ratingProblem({ projectStatus, openDispute: false })).toMatch(/completed and paid/),
  );
  it("allows a completed project, unless a PayPal case is open", () => {
    expect(ratingProblem({ projectStatus: "completed", openDispute: false })).toBeNull();
    expect(ratingProblem({ projectStatus: "completed", openDispute: true })).toMatch(/open PayPal case/);
  });
});

describe("reviews", () => {
  it("takes whole stars from 1 to 5", () => {
    expect([0, 1, 3, 5, 6, 4.5].map(isStarRating)).toEqual([false, true, true, true, false, false]);
  });
  it("can be edited for 30 days", () => {
    const at = new Date("2026-11-01T00:00:00Z");
    expect(reviewEditable(at, new Date("2026-11-30T23:59:00Z"))).toBe(true);
    expect(reviewEditable(at, new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });
  it("names the reviewer by first name and initial, never by email", () => {
    expect(publicReviewerName("Rita Client")).toBe("Rita C.");
    expect(publicReviewerName("  Aïcha  bint  Walk ")).toBe("Aïcha W.");
    expect(publicReviewerName("Rita")).toBe("Rita");
    expect(publicReviewerName("rita@example.com")).toBe("A client");
    expect(publicReviewerName("")).toBe("A client");
  });
  it("masks contact details written into a review", () => {
    expect(publicReviewBody("Great, write me at rita@example.com")).not.toContain("rita@example.com");
  });
});

describe("ratingSummary", () => {
  it("shows nothing for a seller nobody rated", () => {
    expect(ratingSummary(undefined)).toBeNull();
    expect(ratingSummary({ average: 0, count: 0 })).toBeNull();
    expect(ratingLabel(null)).toBeNull();
  });
  it("rounds the average to one decimal", () => {
    expect(ratingSummary({ average: 4.6666666667, count: 3 })).toEqual({ average: 4.7, count: 3 });
    expect(ratingLabel({ average: 5, count: 1 })).toBe("5.0 ★ (1 review)");
  });
});

describe("portfolioUrlProblem", () => {
  it("accepts only full https links", () => {
    expect(portfolioUrlProblem("https://behance.net/work/1")).toBeNull();
    expect(portfolioUrlProblem("http://example.com")).toMatch(/https/);
    expect(portfolioUrlProblem("javascript:alert(1)")).toMatch(/https/);
    expect(portfolioUrlProblem("example.com")).toMatch(/full link/);
  });
});
