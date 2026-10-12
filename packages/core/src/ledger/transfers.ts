import { assertAmount, type MoneyCurrency } from "../money/money";
import { isLedgerAccountKey, type LedgerAccountKey } from "./accounts";

export const LEDGER_TRANSFER_KINDS = [
  "payment_captured",
  "payment_fees",
  "management_fee_credit",
  "completion",
  "refund_requested",
  "refund_confirmed",
  "payout_requested",
  "payout_succeeded",
  "payout_released",
  "payout_fees",
  "penalty_after_completion",
  "chargeback",
  "order_paid",
  "order_fees",
  "order_refunded",
  "refund_fees",
  "payment_refunded",
] as const;

export type LedgerTransferKind = (typeof LEDGER_TRANSFER_KINDS)[number];

// Signed: money leaves an account with a negative amount and enters one with a positive amount.
export type LedgerEntryDraft = { account: LedgerAccountKey; currency: MoneyCurrency; amountMinor: number };

export type LedgerTransferDraft = {
  kind: LedgerTransferKind;
  // Unique per team. A reused reference is rejected, so the same fact is never posted twice.
  reference: string;
  projectId: string | null;
  entries: readonly LedgerEntryDraft[];
};

export type LedgerErrorCode = "unbalanced" | "negative_balance" | "duplicate_reference";

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export function transferSums(transfer: LedgerTransferDraft): Map<MoneyCurrency, number> {
  const sums = new Map<MoneyCurrency, number>();
  for (const entry of transfer.entries) sums.set(entry.currency, (sums.get(entry.currency) ?? 0) + entry.amountMinor);
  return sums;
}

// Balanced: at least two non-zero whole-number entries on known accounts, summing to zero in every currency.
export function isBalanced(transfer: LedgerTransferDraft): boolean {
  if (transfer.entries.length < 2) return false;
  for (const entry of transfer.entries) {
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor === 0) return false;
    if (!isLedgerAccountKey(entry.account)) return false;
  }
  return [...transferSums(transfer).values()].every((sum) => sum === 0);
}

export function assertBalanced(transfer: LedgerTransferDraft): void {
  if (!isBalanced(transfer)) {
    throw new LedgerError("unbalanced", `Transfer ${transfer.reference} is not balanced`);
  }
}

export type LedgerMove = { from: LedgerAccountKey; to: LedgerAccountKey; amountMinor: number };

// Builds one transfer from "from → to" moves: entries on the same account are merged and zero amounts dropped.
export function transferFromMoves(input: {
  kind: LedgerTransferKind;
  reference: string;
  projectId: string | null;
  currency: MoneyCurrency;
  moves: readonly LedgerMove[];
}): LedgerTransferDraft {
  const totals = new Map<LedgerAccountKey, number>();
  for (const move of input.moves) {
    assertAmount(move.amountMinor, `${input.kind} amount`);
    totals.set(move.from, (totals.get(move.from) ?? 0) - move.amountMinor);
    totals.set(move.to, (totals.get(move.to) ?? 0) + move.amountMinor);
  }
  const entries = [...totals]
    .filter(([, amountMinor]) => amountMinor !== 0)
    .map(([account, amountMinor]) => ({ account, currency: input.currency, amountMinor }));
  if (entries.length === 0) throw new RangeError(`A ${input.kind} transfer needs a non-zero amount`);
  const transfer = { kind: input.kind, reference: input.reference, projectId: input.projectId, entries };
  assertBalanced(transfer);
  return transfer;
}

export type LedgerBalanceDelta = { account: LedgerAccountKey; currency: MoneyCurrency; deltaMinor: number };

// Net change per account, sorted by currency then account: the order in which adapters lock balance rows,
// so two transactions touching the same accounts always lock them in the same order.
export function balanceDeltas(transfers: readonly LedgerTransferDraft[]): LedgerBalanceDelta[] {
  const byKey = new Map<string, LedgerBalanceDelta>();
  for (const transfer of transfers) {
    for (const entry of transfer.entries) {
      const key = `${entry.currency} ${entry.account}`;
      const current = byKey.get(key) ?? { account: entry.account, currency: entry.currency, deltaMinor: 0 };
      byKey.set(key, { ...current, deltaMinor: current.deltaMinor + entry.amountMinor });
    }
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, delta]) => delta);
}

export function assertUniqueReferences(transfers: readonly LedgerTransferDraft[]): void {
  const seen = new Set<string>();
  for (const transfer of transfers) {
    if (seen.has(transfer.reference)) {
      throw new LedgerError("duplicate_reference", `Reference ${transfer.reference} is used twice`);
    }
    seen.add(transfer.reference);
  }
}
