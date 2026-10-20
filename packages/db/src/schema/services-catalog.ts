import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { team } from "./organization";

// Money columns are bigint minor units read as JS numbers; MAX_AMOUNT_MINOR keeps them exact.
const minor = (name: string) => bigint(name, { mode: "number" });

// Sellers design §4.1: one level of grouping, optional, so a solo seller usually has none.
export const servicesDepartment = pgTable(
  "services_department",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    // "List in AI assistants": off hides every offering of the department from the plugin's search.
    listed: boolean("listed").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("services_department_teamId_idx").on(table.teamId),
    uniqueIndex("services_department_team_name_idx").on(table.teamId, sql`lower(name)`),
  ],
);

// Sellers design §4.1: what the team sells. The price range and the usual days are what the seller page
// shows; the intake questions are what the request form asks (run 3b).
export const servicesOffering = pgTable(
  "services_offering",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    // Deleting a department leaves its offerings ungrouped rather than deleting them.
    departmentId: text("department_id").references(() => servicesDepartment.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceMinMinor: minor("price_min_minor").notNull(),
    priceMaxMinor: minor("price_max_minor").notNull(),
    daysMin: integer("days_min").notNull(),
    daysMax: integer("days_max").notNull(),
    intakeQuestions: jsonb("intake_questions").$type<string[]>().notNull().default([]),
    // An inactive offering stays in the admin and disappears from the seller page.
    active: boolean("active").notNull().default(true),
    // "List in AI assistants": default on, so a seller opts out rather than in (run C design §3).
    listed: boolean("listed").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("services_offering_teamId_idx").on(table.teamId),
    uniqueIndex("services_offering_team_name_idx").on(table.teamId, sql`lower(name)`),
    check("services_offering_price_check", sql`price_min_minor >= 0 and price_max_minor >= price_min_minor`),
    check("services_offering_days_check", sql`days_min >= 1 and days_max >= days_min`),
    check("services_offering_questions_check", sql`jsonb_array_length(intake_questions) <= 5`),
  ],
);
