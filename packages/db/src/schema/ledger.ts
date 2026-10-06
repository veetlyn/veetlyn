import { LEDGER_TRANSFER_KINDS } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

import { team } from "./organization";
import { project } from "./projects";

const CURRENCIES = ["USD", "EUR"] as const;

// Services spec §6. ledger_transfer and ledger_entry are append-only: a trigger added in the
// s4_ledger_projects migration rejects UPDATE and DELETE. No foreign key cascades into them.
export const ledgerTransfer = pgTable(
  "ledger_transfer",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    kind: text("kind", { enum: LEDGER_TRANSFER_KINDS }).notNull(),
    reference: text("reference").notNull(),
    projectId: text("project_id").references(() => project.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_transfer_reference_unique").on(t.teamId, t.reference),
    index("ledger_transfer_projectId_idx").on(t.projectId),
  ],
);

export const ledgerEntry = pgTable(
  "ledger_entry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    transferId: text("transfer_id")
      .notNull()
      .references(() => ledgerTransfer.id),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    account: text("account").notNull(),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entry_account_idx").on(t.teamId, t.account, t.currency),
    index("ledger_entry_transferId_idx").on(t.transferId),
    check("ledger_entry_amount_check", sql`amount_minor <> 0`),
  ],
);

// One row per account: the running balance the adapter locks (SELECT … FOR UPDATE) to check invariants.
// The check mirrors breaksLedgerInvariant in core as a last line of defence.
export const ledgerBalance = pgTable(
  "ledger_balance",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    account: text("account").notNull(),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    balanceMinor: bigint("balance_minor", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "ledger_balance_pk", columns: [t.teamId, t.account, t.currency] }),
    check(
      "ledger_balance_non_negative_check",
      sql`balance_minor >= 0 or not (starts_with(account, 'client_held:') or starts_with(account, 'owed:') or starts_with(account, 'paid_out:') or account = 'client_refunds')`,
    ),
  ],
);
