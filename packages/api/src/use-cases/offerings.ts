import type { Database } from "@jendal-workspace/db";
import { type ListedOffering, searchListedOfferings } from "@jendal-workspace/db/repositories/services-catalog";

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

export function searchOfferings(
  db: Database,
  input: { query: string; budgetMinor?: number; deadlineDays?: number },
): Promise<ListedOffering[]> {
  return searchListedOfferings(db, {
    words: searchWords(input.query),
    maxPriceMinor: input.budgetMinor,
    maxDays: input.deadlineDays,
    limit: MAX_SEARCH_RESULTS,
  });
}
