import {
  balanceDeltas,
  breaksLedgerInvariant,
  LedgerError,
  negativeBalanceError,
  validateTransfers,
  type Ledger,
  type LedgerAccountKey,
} from "@jendal-workspace/core";
import { and, asc, eq, sql } from "drizzle-orm";

import { ledgerBalance, ledgerEntry, ledgerTransfer } from "../schema/ledger";
import type { Transaction } from "../executor";

// The Postgres adapter of the Ledger port. post() must run inside a transaction (it uses
// SELECT … FOR UPDATE); runInTransaction is the caller.
export function createPostgresLedger(teamId: string, tx: Transaction): Ledger {
  return {
    async post(transfers) {
      validateTransfers(transfers);

      // Like the memory ledger, a reference this team already posted is rejected, not skipped:
      // the posting builders key every transfer by reference, so a duplicate is a bug. Retrying
      // callers (S6's applyPayPalFact) catch duplicate_reference as "already applied".
      for (const transfer of transfers) {
        const [existing] = await tx
          .select({ id: ledgerTransfer.id })
          .from(ledgerTransfer)
          .where(and(eq(ledgerTransfer.teamId, teamId), eq(ledgerTransfer.reference, transfer.reference)))
          .limit(1);
        if (existing) throw new LedgerError("duplicate_reference", `Reference ${transfer.reference} was already posted`);
      }

      const deltas = balanceDeltas(transfers);
      // Lock the balance rows in the fixed order balanceDeltas returns, so two transactions
      // touching the same accounts lock in the same order and cannot deadlock. The insert makes
      // sure the row exists before it is locked; on conflict the concurrent insert wins and this
      // transaction's lock read sees it.
      const after = new Map<string, number>();
      for (const delta of deltas) {
        await tx
          .insert(ledgerBalance)
          .values({ teamId, account: delta.account, currency: delta.currency, balanceMinor: 0 })
          .onConflictDoNothing();
        const [row] = await tx
          .select({ balanceMinor: ledgerBalance.balanceMinor })
          .from(ledgerBalance)
          .where(
            and(
              eq(ledgerBalance.teamId, teamId),
              eq(ledgerBalance.account, delta.account),
              eq(ledgerBalance.currency, delta.currency),
            ),
          )
          .for("update")
          .limit(1);
        const balanceMinor = (row?.balanceMinor ?? 0) + delta.deltaMinor;
        if (breaksLedgerInvariant(delta.account, balanceMinor)) {
          throw negativeBalanceError(delta.account, delta.currency, balanceMinor);
        }
        after.set(`${delta.currency} ${delta.account}`, balanceMinor);
      }

      for (const transfer of transfers) {
        const [row] = await tx
          .insert(ledgerTransfer)
          .values({ teamId, kind: transfer.kind, reference: transfer.reference, projectId: transfer.projectId })
          .returning({ id: ledgerTransfer.id });
        if (!row) throw new Error("Insert into ledger_transfer returned no row");
        await tx.insert(ledgerEntry).values(
          transfer.entries.map((entry) => ({
            transferId: row.id,
            teamId,
            account: entry.account,
            currency: entry.currency,
            amountMinor: entry.amountMinor,
          })),
        );
      }

      for (const delta of deltas) {
        await tx
          .update(ledgerBalance)
          .set({ balanceMinor: after.get(`${delta.currency} ${delta.account}`) ?? 0, updatedAt: new Date() })
          .where(
            and(
              eq(ledgerBalance.teamId, teamId),
              eq(ledgerBalance.account, delta.account),
              eq(ledgerBalance.currency, delta.currency),
            ),
          );
      }
    },
    async balance(account: LedgerAccountKey, currency) {
      const [row] = await tx
        .select({ balanceMinor: ledgerBalance.balanceMinor })
        .from(ledgerBalance)
        .where(
          and(eq(ledgerBalance.teamId, teamId), eq(ledgerBalance.account, account), eq(ledgerBalance.currency, currency)),
        )
        .limit(1);
      return row?.balanceMinor ?? 0;
    },
  };
}

export type LedgerBalanceRow = { account: string; currency: string; balanceMinor: number };

// Sums from ledger_entry, to compare with ledger_balance in reconciliation tests.
export async function ledgerBalancesFromEntries(tx: Transaction, teamId: string): Promise<LedgerBalanceRow[]> {
  return tx
    .select({
      account: ledgerEntry.account,
      currency: ledgerEntry.currency,
      balanceMinor: sql<number>`sum(${ledgerEntry.amountMinor})`.mapWith(Number),
    })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.teamId, teamId))
    .groupBy(ledgerEntry.account, ledgerEntry.currency)
    .orderBy(asc(ledgerEntry.account));
}

export async function hasLedgerReference(tx: Transaction, teamId: string, reference: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: ledgerTransfer.id })
    .from(ledgerTransfer)
    .where(and(eq(ledgerTransfer.teamId, teamId), eq(ledgerTransfer.reference, reference)))
    .limit(1);
  return row !== undefined;
}
