import { OPEN_PAYOUT_REQUEST_STATUSES, PAYOUT_REQUEST_STATUSES } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";

// The predicate of the one-open-request partial index below; the insert conflict target must name the same one.
export const PAYOUT_REQUEST_OPEN_WHERE = sql.raw(
  `status in (${OPEN_PAYOUT_REQUEST_STATUSES.map((status) => `'${status}'`).join(", ")})`,
);

const CURRENCIES = ["USD", "EUR"] as const;
const minor = (name: string) => bigint(name, { mode: "number" });

// S2: the freelancer's verified PayPal payout destination (services spec §4.2). One per user.
export const payoutDestination = pgTable(
  "payout_destination",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    paypalPayerId: text("paypal_payer_id").notNull(),
    paypalEmail: text("paypal_email"),
    verifiedAt: timestamp("verified_at").notNull(),
    // Payout recipients are 18 or older: PayPal's age range says so, or the member confirmed it when PayPal sent none.
    ageConfirmedAt: timestamp("age_confirmed_at"),
    ageSource: text("age_source", { enum: ["paypal", "self"] }),
  },
  (t) => [check("payout_destination_age_source_check", sql`${t.ageSource} in ('paypal', 'self')`)],
);

// A member's request to be paid their available earnings from one team; an admin pays it in PayPal and marks it
// paid. The id is the ledger's payout request id.
export const payoutRequest = pgTable(
  "payout_request",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    status: text("status", { enum: PAYOUT_REQUEST_STATUSES }).notNull().default("requested"),
    // The member's destination when they asked.
    receiverPayerId: text("receiver_payer_id").notNull(),
    // The member's PayPal email when they asked: the admin pays this address.
    receiverEmail: text("receiver_email").notNull(),
    // What reached the member after PayPal's receiving fee, as the admin recorded it.
    receivedMinor: minor("received_minor"),
    paypalTransactionId: text("paypal_transaction_id"),
    decidedByUserId: text("decided_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
    paidAt: timestamp("paid_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("payout_request_team_status_idx").on(t.teamId, t.status),
    index("payout_request_user_team_idx").on(t.userId, t.teamId),
    uniqueIndex("payout_request_open_idx").on(t.teamId, t.userId).where(PAYOUT_REQUEST_OPEN_WHERE),
    check("payout_request_amount_positive", sql`${t.amountMinor} > 0`),
    check("payout_request_status_check", sql`${t.status} in ('requested', 'paid', 'rejected')`),
    check(
      "payout_request_received_check",
      sql`${t.receivedMinor} is null or (${t.receivedMinor} > 0 and ${t.receivedMinor} <= ${t.amountMinor})`,
    ),
  ],
);
