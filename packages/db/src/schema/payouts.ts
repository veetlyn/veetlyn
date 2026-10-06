import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

// S2: the freelancer's verified PayPal payout destination (services spec §4.2). One per user;
// `recipient_type: PAYPAL_ID` payouts use the payer ID (spec §6.5).
export const payoutDestination = pgTable("payout_destination", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  paypalPayerId: text("paypal_payer_id").notNull(),
  paypalEmail: text("paypal_email"),
  verifiedAt: timestamp("verified_at").notNull(),
});
