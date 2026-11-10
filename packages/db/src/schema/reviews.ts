import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";
import { project } from "./projects";
import { clientContact } from "./contacts";

// P design §1: one review per completed project, written by its client. The seller never edits or removes it;
// support may hide one (hidden_at) for abuse or illegal content.
export const sellerReview = pgTable(
  "seller_review",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .unique()
      .references(() => project.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    authorContactId: text("author_contact_id").references(() => clientContact.id, { onDelete: "set null" }),
    body: text("body").notNull().default(""),
    // The public name, frozen when posted: first name and initial.
    reviewerName: text("reviewer_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    hiddenAt: timestamp("hidden_at"),
  },
  (t) => [
    index("seller_review_team_idx").on(t.teamId, t.createdAt),
    check("seller_review_rating_check", sql`rating between 1 and 5`),
    check("seller_review_body_check", sql`char_length(body) <= 1000`),
  ],
);

// P design §2: a team admin's rating of a project's client, seen only by that team's staff.
export const clientRating = pgTable(
  "client_rating",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => project.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    note: text("note").notNull().default(""),
    ratedById: text("rated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  () => [
    check("client_rating_rating_check", sql`rating between 1 and 5`),
    check("client_rating_note_check", sql`char_length(note) <= 500`),
  ],
);

// P design §3: links to a seller's past work, shown on the seller page in the order added.
export const portfolioItem = pgTable(
  "portfolio_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("portfolio_item_team_idx").on(t.teamId, t.createdAt),
    check("portfolio_item_url_check", sql`url like 'https://%'`),
  ],
);
