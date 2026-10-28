import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Launch notification consent only. This is not an account or a team membership.
export const launchWaitlist = pgTable("launch_waitlist", {
  email: text("email").primaryKey(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});
