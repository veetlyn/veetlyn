import type { Database } from "@jendal-workspace/db";
import type { RatingSummary } from "@jendal-workspace/core";
import { type ListedOffering, searchListedOfferings } from "@jendal-workspace/db/repositories/services-catalog";

import { sellerRatings } from "./reviews";

export const MAX_SEARCH_RESULTS = 8;
const MAX_WORDS = 8;

// Short words ("a", "for") would match nearly everything, so only words of three letters or more search.
export function searchWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
  return [...new Set(words)].slice(0, MAX_WORDS);
}

// Each offering carries its seller's rating, or null when nobody has rated the seller yet (AGT-45).
export async function searchOfferings(
  db: Database,
  input: { query: string; budgetMinor?: number; deadlineDays?: number },
): Promise<(ListedOffering & { sellerRating: RatingSummary | null })[]> {
  const rows = await searchListedOfferings(db, {
    words: searchWords(input.query),
    maxPriceMinor: input.budgetMinor,
    maxDays: input.deadlineDays,
    limit: MAX_SEARCH_RESULTS,
  });
  const ratings = await sellerRatings(db, [...new Set(rows.map((row) => row.sellerId))]);
  return rows.map((row) => ({ ...row, sellerRating: ratings.get(row.sellerId) ?? null }));
}
