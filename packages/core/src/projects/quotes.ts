import { assertBps, MAX_AMOUNT_MINOR } from "../money/money";
import type { PaymentSplit } from "./pricing";

export const QUOTE_STATUSES = ["proposed", "accepted", "superseded", "rejected"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const AMENDMENT_STATUSES = ["pending", "accepted", "declined"] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

export const PAYMENT_KINDS = ["deposit", "top_up", "balance"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ["pending", "captured", "failed", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DELIVERY_STATUSES = ["submitted", "accepted", "changes_requested"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type QuoteItemDraft = { description: string; amountMinor: number; extraDays: number };
export type QuoteItem = QuoteItemDraft & { id: string };

export const MAX_QUOTE_ITEMS = 20;
export const MAX_ITEM_DESCRIPTION = 200;
export const MAX_DAYS = 365;

export function quoteTotalMinor(items: readonly { amountMinor: number }[]): number {
  return items.reduce((sum, item) => sum + item.amountMinor, 0);
}

export type QuoteItemsProblem = "empty" | "too_many" | "description" | "amount" | "extra_days" | "total";

export function quoteItemsProblem(items: readonly QuoteItemDraft[]): QuoteItemsProblem | null {
  if (items.length === 0) return "empty";
  if (items.length > MAX_QUOTE_ITEMS) return "too_many";
  for (const item of items) {
    const description = item.description.trim();
    if (description.length === 0 || description.length > MAX_ITEM_DESCRIPTION) return "description";
    if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0 || item.amountMinor > MAX_AMOUNT_MINOR) {
      return "amount";
    }
    if (!Number.isSafeInteger(item.extraDays) || item.extraDays < 0 || item.extraDays > MAX_DAYS) return "extra_days";
  }
  return quoteTotalMinor(items) > MAX_AMOUNT_MINOR ? "total" : null;
}

export function quoteItemsProblemMessage(problem: QuoteItemsProblem): string {
  switch (problem) {
    case "empty":
      return "A quote needs at least one line.";
    case "too_many":
      return `A quote can have at most ${MAX_QUOTE_ITEMS} lines.`;
    case "description":
      return `Describe each line in 1 to ${MAX_ITEM_DESCRIPTION} characters.`;
    case "amount":
      return "Each line needs an amount above zero.";
    case "extra_days":
      return `Extra days must be a whole number from 0 to ${MAX_DAYS}.`;
    case "total":
      return "The quote total is too large.";
  }
}

export type AmendmentChange = { add: readonly QuoteItemDraft[]; removeItemIds: readonly string[] };

export type AmendedItems =
  | { ok: true; items: QuoteItemDraft[]; extraDays: number }
  | { ok: false; problem: "no_change" | "unknown_item" | QuoteItemsProblem };

// Services spec §5.5: an amendment adds or removes line items of the current quote version.
// Removing items does not shorten the deadline; added items extend it by their extra days.
export function amendQuoteItems(base: readonly QuoteItem[], change: AmendmentChange): AmendedItems {
  if (change.add.length === 0 && change.removeItemIds.length === 0) return { ok: false, problem: "no_change" };
  const removed = new Set(change.removeItemIds);
  if (removed.size !== change.removeItemIds.length) return { ok: false, problem: "unknown_item" };
  const baseIds = new Set(base.map((item) => item.id));
  if ([...removed].some((id) => !baseIds.has(id))) return { ok: false, problem: "unknown_item" };
  const items = [
    ...base
      .filter((item) => !removed.has(item.id))
      .map(({ description, amountMinor, extraDays }) => ({ description, amountMinor, extraDays })),
    ...change.add.map((item) => ({ ...item, description: item.description.trim() })),
  ];
  const problem = quoteItemsProblem(items);
  if (problem) return { ok: false, problem };
  return { ok: true, items, extraDays: change.add.reduce((sum, item) => sum + item.extraDays, 0) };
}

export function amendmentProblemMessage(problem: "no_change" | "unknown_item" | QuoteItemsProblem): string {
  if (problem === "no_change") return "Add or remove at least one line.";
  if (problem === "unknown_item") return "One of the lines to remove is not on the current quote.";
  if (problem === "empty") return "An amendment cannot remove every line. Cancel the project instead.";
  return quoteItemsProblemMessage(problem);
}

export type PaymentLineKind = PaymentKind | "management_fee";
export type PaymentLine = { kind: PaymentLineKind; label: string; amountMinor: number };

const QUOTE_PART_LABELS: Record<PaymentKind, string> = {
  deposit: "Deposit (50% of the quote)",
  top_up: "Top-up (50% of the increase)",
  balance: "Balance",
};

// The lines shown on the client page and the pay page; zero lines are left out.
export function paymentLines(kind: PaymentKind, split: PaymentSplit, managementFeeBps: number): PaymentLine[] {
  assertBps(managementFeeBps, "management fee");
  const lines: PaymentLine[] = [
    { kind, label: QUOTE_PART_LABELS[kind], amountMinor: split.quotePartMinor },
    { kind: "management_fee", label: `Management fee (${managementFeeBps / 100}%)`, amountMinor: split.managementFeeMinor },
  ];
  return lines.filter((line) => line.amountMinor > 0);
}
