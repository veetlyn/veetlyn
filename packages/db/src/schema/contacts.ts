import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";
import { project } from "./projects";

export const CLIENT_IDENTITY_KINDS = ["email", "user", "discord"] as const;
export const CLIENT_IDENTITY_SOURCES = ["typed", "request", "migration", "interaction", "account"] as const;
export type ClientIdentityKind = (typeof CLIENT_IDENTITY_KINDS)[number];
export type ClientIdentitySource = (typeof CLIENT_IDENTITY_SOURCES)[number];

// A person or company a team works for (action catalog design §5.1).
export const clientContact = pgTable(
  "client_contact",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("client_contact_teamId_idx").on(t.teamId)],
);

export const clientIdentity = pgTable(
  "client_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    contactId: text("contact_id")
      .notNull()
      .references(() => clientContact.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: CLIENT_IDENTITY_KINDS }).notNull(),
    // Emails are stored lowercased.
    value: text("value").notNull(),
    source: text("source", { enum: CLIENT_IDENTITY_SOURCES }).notNull(),
    // Unverified identities give no authority.
    verifiedAt: timestamp("verified_at"),
  },
  (t) => [
    index("client_identity_contact_idx").on(t.contactId),
    index("client_identity_lookup_idx").on(t.teamId, t.kind, t.value),
    // A verified identity belongs to one contact; unverified duplicates may exist.
    uniqueIndex("client_identity_verified_unique")
      .on(t.teamId, t.kind, t.value)
      .where(sql`verified_at is not null`),
  ],
);

export const projectClient = pgTable(
  "project_client",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => clientContact.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    // Client links carry this version; bumping it revokes them. Links issued before contacts existed count as 0.
    linkVersion: integer("link_version").notNull().default(1),
    addedById: text("added_by_id").references(() => user.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.contactId] }),
    index("project_client_contact_idx").on(t.contactId),
    uniqueIndex("project_client_primary_idx").on(t.projectId).where(sql`is_primary`),
  ],
);
