import { PAYOUT_REQUEST_STATUSES } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";

const CURRENCIES = ["USD", "EUR"] as const;
const minor = (name: string) => bigint(name, { mode: "number" });

// S2: the freelancer's verified PayPal payout destination (services spec §4.2). One per user;
// `recipient_type: PAYPAL_ID` payouts use the payer ID (spec §6.5).
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

// The REST app on the team's own PayPal Business account that sends its payouts. The secret is sealed with the
// platform key and the team id as additional data, so a row copied to another team does not open.
export const teamPayoutCredentials = pgTable("team_payout_credentials", {
  teamId: text("team_id")
    .primaryKey()
    .references(() => team.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  secretCiphertext: text("secret_ciphertext").notNull(),
  secretIv: text("secret_iv").notNull(),
  keyId: text("key_id").notNull(),
  // The account PayPal reported for these credentials; null when PayPal did not say.
  paypalAccountId: text("paypal_account_id"),
  verifiedAt: timestamp("verified_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// A member's request to be paid their available earnings from one team. The id is the ledger's payout request id
// and PayPal's sender_item_id; with send_attempt it names the batch, so a retry of an unconfirmed send names the
// same batch.
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
    // The member's destination when they asked: what the admin approves is what PayPal pays.
    receiverPayerId: text("receiver_payer_id").notNull(),
    // Numbers PayPal's sender_batch_id and PayPal-Request-Id. It moves on only after PayPal definitely made no
    // payout, so a resend is not answered with the replayed refusal; an unknown outcome keeps the same ids.
    sendAttempt: integer("send_attempt").notNull().default(0),
    paypalBatchId: text("paypal_batch_id").unique(),
    paypalItemId: text("paypal_item_id"),
    paypalItemStatus: text("paypal_item_status"),
    feeMinor: minor("fee_minor"),
    failureMessage: text("failure_message"),
    reviewReason: text("review_reason"),
    // Set when a send left PayPal's outcome unknown: PayPal may hold a batch for this id, so no later refusal is final.
    uncertainAt: timestamp("uncertain_at", { withTimezone: true }),
    decidedByUserId: text("decided_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
    sentAt: timestamp("sent_at"),
    settledAt: timestamp("settled_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("payout_request_team_status_idx").on(t.teamId, t.status),
    index("payout_request_user_team_idx").on(t.userId, t.teamId),
    uniqueIndex("payout_request_open_idx")
      .on(t.teamId, t.userId)
      .where(sql`status in ('requested', 'queued', 'sending', 'sent')`),
    check("payout_request_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "payout_request_status_check",
      sql`${t.status} in ('requested', 'rejected', 'queued', 'sending', 'sent', 'succeeded', 'failed')`,
    ),
  ],
);
