import type { MoneyCurrency } from "../money/money";
import { breaksLedgerInvariant, type LedgerAccountKey } from "./accounts";
import {
  assertBalanced,
  assertUniqueReferences,
  balanceDeltas,
  LedgerError,
  type LedgerTransferDraft,
} from "./transfers";

// The ledger of one team (services spec §6). Adapters post every transfer of a call or none of them.
export interface Ledger {
  // Rejects unbalanced transfers (`unbalanced`), a reference already posted (`duplicate_reference`) and any
  // balance that would break the §6.1 invariants (`negative_balance`), all with LedgerError, and posts
  // nothing. Both adapters behave identically. A caller that may retry a posting (S6's applyPayPalFact
  // consumer) treats `duplicate_reference` as "already applied" — that is the §6.4 at-most-once guarantee.
  post(transfers: readonly LedgerTransferDraft[]): Promise<void>;
  balance(account: LedgerAccountKey, currency: MoneyCurrency): Promise<number>;
}

// Checks a batch before an adapter writes it; shared by the memory and Postgres ledgers.
export function validateTransfers(transfers: readonly LedgerTransferDraft[]): void {
  for (const transfer of transfers) assertBalanced(transfer);
  assertUniqueReferences(transfers);
}

export function negativeBalanceError(account: LedgerAccountKey, currency: MoneyCurrency, balanceMinor: number) {
  return new LedgerError("negative_balance", `${account} (${currency}) would go to ${balanceMinor}`);
}

// In-memory ledger for core tests and for use cases tested without a database.
export function createMemoryLedger(): Ledger & { posted(): readonly LedgerTransferDraft[] } {
  const balances = new Map<string, number>();
  const posted: LedgerTransferDraft[] = [];
  const references = new Set<string>();
  const keyOf = (account: LedgerAccountKey, currency: MoneyCurrency) => `${currency} ${account}`;

  return {
    async post(transfers) {
      validateTransfers(transfers);
      for (const transfer of transfers) {
        if (references.has(transfer.reference)) {
          throw new LedgerError("duplicate_reference", `Reference ${transfer.reference} was already posted`);
        }
      }
      const next = balanceDeltas(transfers).map((delta) => ({
        ...delta,
        after: (balances.get(keyOf(delta.account, delta.currency)) ?? 0) + delta.deltaMinor,
      }));
      const broken = next.find((row) => breaksLedgerInvariant(row.account, row.after));
      if (broken) throw negativeBalanceError(broken.account, broken.currency, broken.after);
      for (const row of next) balances.set(keyOf(row.account, row.currency), row.after);
      for (const transfer of transfers) {
        posted.push(transfer);
        references.add(transfer.reference);
      }
    },
    async balance(account, currency) {
      return balances.get(keyOf(account, currency)) ?? 0;
    },
    posted: () => posted,
  };
}
