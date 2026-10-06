import { type TeamProduct, teamSlugProblem } from "@jendal-workspace/core";

export type SlugCheckResult =
  | { status: "available"; slug: string }
  | { status: "taken"; slug: string }
  | { status: "invalid"; reason: "format" | "reserved" };

export type SlugStatus = { tone: "pending" | "available" | "problem"; text: string };

// `result` must be the check for `slug`, or undefined while that check is still running.
export function slugStatus(
  slug: string,
  result: SlugCheckResult | undefined,
  teamUrl: (slug: string) => string,
  product: TeamProduct = "store",
): SlugStatus | null {
  if (!slug) return null;
  if (!result) return { tone: "pending", text: "Checking the address…" };
  switch (result.status) {
    case "available":
      return { tone: "available", text: `${teamUrl(result.slug)} is available.` };
    case "taken":
      return { tone: "problem", text: teamSlugProblem("taken", product) };
    case "invalid":
      return { tone: "problem", text: teamSlugProblem(result.reason, product) };
  }
}
