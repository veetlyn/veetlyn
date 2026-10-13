import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

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
    // Sellers design §4.1: a free-text label ("Brand designer") shown next to the member's name.
    title: text("title"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("services_team_member_team_user_unique").on(table.teamId, table.userId),
    index("services_team_member_userId_idx").on(table.userId),
  ],
);

// Services spec §4.3. The defaults must match defaultServicesTeamSettings in @jendal-workspace/core.
export const servicesTeamSettings = pgTable(
  "services_team_settings",
  {
    teamId: text("team_id")
      .primaryKey()
      .references(() => team.id, { onDelete: "cascade" }),
    // Sellers design §3.1: a team of one; its cut is 100% and its management fee 0.
    solo: boolean("solo").default(false).notNull(),
    // Sellers design §3.2: the store section of the seller page (run 4 fills it).
    storeEnabled: boolean("store_enabled").default(false).notNull(),
    // Sellers design §3.2: shown on the seller page; MAX_BIO_CHARS in core.
    bio: text("bio").default("").notNull(),
    currency: text("currency", { enum: ["USD", "EUR"] })
      .default("USD")
      .notNull(),
    teamCutBps: integer("team_cut_bps").default(1500).notNull(),
    managementFeeBps: integer("management_fee_bps").default(1000).notNull(),
    quotingMode: text("quoting_mode", { enum: ["open", "assigned", "team"] })
      .default("assigned")
      .notNull(),
    settingsSavedAt: timestamp("settings_saved_at"),
    // S2: the guild this team is linked to; one server per team and one team per server (unique).
    discordGuildId: text("discord_guild_id").unique(),
  },
  // The check is raw SQL, so the table argument goes unused (the repo's tsc flags unused parameters).
  (_table) => [check("services_team_settings_bio_check", sql`char_length(bio) <= 280`)],
);

// S2: a one-time code an admin creates in the team admin and runs as /payleor link in their server
// (services spec §4.2); consumed by deleting it (see the discord repository).
export const discordLinkCode = pgTable(
  "discord_link_code",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("discord_link_code_teamId_idx").on(table.teamId)],
);
