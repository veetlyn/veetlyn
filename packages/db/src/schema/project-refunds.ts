import { PROJECT_REFUND_PART_STATUSES, PROJECT_REFUND_STATUSES } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { team } from "./organization";
import { payment, project } from "./projects";

const CURRENCIES = ["USD", "EUR"] as const;
const minor = (name: string) => bigint(name, { mode: "number" });

// Money owed back to an overpaid client (services spec: refunded on the original captures). The id is the
// ledger's refund id, so the refund_requested and refund_confirmed transfers name the same refund.
export const projectRefund = pgTable(
  "project_refund",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    status: text("status", { enum: PROJECT_REFUND_STATUSES }).notNull().default("requested"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("project_refund_project_idx").on(t.projectId),
    check("project_refund_amount_positive", sql`${t.amountMinor} > 0`),
    check("project_refund_status_check", sql`${t.status} in ('requested', 'issuing', 'completed', 'failed')`),
  ],
);

// One PayPal capture refund per payment the refund is taken from.
export const projectRefundPart = pgTable(
  "project_refund_part",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectRefundId: text("project_refund_id")
      .notNull()
      .references(() => projectRefund.id, { onDelete: "restrict" }),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payment.id, { onDelete: "restrict" }),
    captureId: text("capture_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    paypalRefundId: text("paypal_refund_id").unique(),
    status: text("status", { enum: PROJECT_REFUND_PART_STATUSES }).notNull().default("pending"),
    // PayPal's message when the refund call failed, shown to the admin who retries.
    failureMessage: text("failure_message"),
    // Set when an attempt left PayPal's outcome unknown: from then on PayPal may hold a refund for this part, so
    // a later refusal is not trusted to mean there is none.
    uncertainAt: timestamp("uncertain_at", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("project_refund_part_payment_unique").on(t.projectRefundId, t.paymentId),
    check("project_refund_part_amount_positive", sql`${t.amountMinor} > 0`),
    check("project_refund_part_status_check", sql`${t.status} in ('pending', 'completed', 'failed')`),
  ],
);
