import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Launch notification consent only. This is not an account or a team membership.
export const launchWaitlist = pgTable("launch_waitlist", {
  email: text("email").primaryKey(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

// Only newly accepted sign-ups enqueue an alert. Existing subscribers are not backfilled.
export const waitlistNotification = pgTable("waitlist_notification", {
  email: text("email").primaryKey().references(() => launchWaitlist.email, { onDelete: "cascade" }),
  id: text("id").notNull().$defaultFn(() => crypto.randomUUID()),
  recipient: text("recipient").notNull(),
  platformName: text("platform_name").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  // Also acts as a five-minute lease while a worker is sending.
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("waitlist_notification_due_idx").on(t.sentAt, t.nextAttemptAt)]);
