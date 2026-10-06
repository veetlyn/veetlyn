import { storeSlugProblem } from "@jendal-workspace/core";

export type SlugCheckResult =
  | { status: "available"; slug: string }
  | { status: "taken"; slug: string }
  | { status: "invalid"; reason: "format" | "reserved" };

export type SlugStatus = { tone: "pending" | "available" | "problem"; text: string };

// `result` must be the check for `slug`, or undefined while that check is still running.
export function slugStatus(
  slug: string,
  result: SlugCheckResult | undefined,
  storeUrl: (slug: string) => string,
): SlugStatus | null {
  if (!slug) return null;
  if (!result) return { tone: "pending", text: "Checking the address…" };
  switch (result.status) {
    case "available":
      return { tone: "available", text: `${storeUrl(result.slug)} is available.` };
    case "taken":
      return { tone: "problem", text: storeSlugProblem("taken") };
    case "invalid":
      return { tone: "problem", text: storeSlugProblem(result.reason) };
  }
}
