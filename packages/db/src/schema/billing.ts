import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./organization";

// Billing design (platform/plans/2026-11-02-billing-polar.md §2): one billing account per workspace. The tiers decide
// limits during the trial; once a Polar subscription exists, every webhook rewrites them from the product's key.
export const billingAccount = pgTable(
  "billing_account",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    servicesTier: text("services_tier", { enum: ["solo", "team", "agency"] }),
    storeTier: text("store_tier", { enum: ["starter", "grow", "scale"] }),
    interval: text("interval", { enum: ["monthly", "yearly"] }).notNull().default("monthly"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
    polarCustomerId: text("polar_customer_id").unique(),
    polarSubscriptionId: text("polar_subscription_id").unique(),
    polarProductId: text("polar_product_id"),
    polarStatus: text("polar_status", {
      enum: ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid"],
    }),
    pastDueAt: timestamp("past_due_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // The subscription's own modified_at: webhooks arrive out of order, and an older snapshot is ignored.
    polarModifiedAt: timestamp("polar_modified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // The maintenance job re-reads subscriptions that are past due or have not been heard from in a day.
  (t) => [index("billing_account_reconcile_idx").on(t.polarStatus, t.polarModifiedAt)],
);

// One row per delivered Polar webhook (its webhook-id header), so a redelivery is dropped.
export const polarWebhookEvent = pgTable("polar_webhook_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
