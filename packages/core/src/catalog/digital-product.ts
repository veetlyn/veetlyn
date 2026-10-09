import { MAX_PRICE_MINOR } from "./product";

// Sellers design §5.1: a digital product is a title, a description, one price and one file.
export type DigitalProductDraft = { title: string; description: string; priceMinor: number };
export type DigitalProductProblem = { field: string; message: string };

// The same rules run in the browser before submit and in the API as a backstop.
export function validateDigitalProductDraft(draft: DigitalProductDraft): DigitalProductProblem[] {
  const problems: DigitalProductProblem[] = [];
  if (!draft.title.trim()) problems.push({ field: "title", message: "Add a title." });
  else if (draft.title.length > 200) problems.push({ field: "title", message: "Keep the title under 200 characters." });
  if (draft.description.length > 5_000) {
    problems.push({ field: "description", message: "Keep the description under 5,000 characters." });
  }
  if (!Number.isInteger(draft.priceMinor) || draft.priceMinor < 0 || draft.priceMinor > MAX_PRICE_MINOR) {
    problems.push({ field: "price", message: "Enter a valid price." });
  }
  return problems;
}

// Publishing adds two rules: a real price, and the file buyers download.
export function digitalPublishProblems(draft: DigitalProductDraft, fileAttached: boolean): DigitalProductProblem[] {
  const problems = validateDigitalProductDraft(draft);
  if (problems.length > 0) return problems;
  if (draft.priceMinor === 0) return [{ field: "price", message: "Set a price above zero before publishing." }];
  if (!fileAttached) return [{ field: "file", message: "Add the file buyers download before publishing." }];
  return [];
}
