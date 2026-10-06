import { index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";

// Per-team roles for services teams (services spec §4.1). Workspace owners and admins are admins of
// every services team without a row here.
export const servicesTeamMember = pgTable(
  "services_team_member",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "manager", "freelancer"] }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("services_team_member_team_user_unique").on(table.teamId, table.userId),
    index("services_team_member_userId_idx").on(table.userId),
  ],
);

// Services spec §4.3. The defaults must match defaultServicesTeamSettings in @jendal-workspace/core.
export const servicesTeamSettings = pgTable("services_team_settings", {
  teamId: text("team_id")
    .primaryKey()
    .references(() => team.id, { onDelete: "cascade" }),
  currency: text("currency", { enum: ["USD", "EUR"] })
    .default("USD")
    .notNull(),
  teamCutBps: integer("team_cut_bps").default(1500).notNull(),
  managementFeeBps: integer("management_fee_bps").default(1000).notNull(),
  quotingMode: text("quoting_mode", { enum: ["open", "assigned", "team"] })
    .default("assigned")
    .notNull(),
  payoutMode: text("payout_mode", { enum: ["manual", "rules", "automatic"] })
    .default("manual")
    .notNull(),
  settingsSavedAt: timestamp("settings_saved_at"),
});
