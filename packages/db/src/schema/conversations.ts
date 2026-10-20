import {
  CONVERSATION_AUTHOR_KINDS,
  CONVERSATION_MESSAGE_KINDS,
  CONVERSATION_SPACES,
  CONVERSATION_SURFACES,
} from "@jendal-workspace/core";
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { clientContact } from "./contacts";
import { team } from "./organization";
import { project } from "./projects";
import { servicesDepartment } from "./services-catalog";

// Conversations design §5: every message belongs to the request space (the team's eligible freelancers and
// staff, until a quote is accepted) or the project space (the client and staff, and the accepted freelancer).
export const conversationMessage = pgTable(
  "conversation_message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    space: text("space", { enum: CONVERSATION_SPACES }).notNull(),
    authorKind: text("author_kind", { enum: CONVERSATION_AUTHOR_KINDS }).notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    // A removed contact keeps their messages; the author shows as "Client".
    authorContactId: text("author_contact_id").references(() => clientContact.id, { onDelete: "set null" }),
    kind: text("kind", { enum: CONVERSATION_MESSAGE_KINDS }).notNull(),
    // As written; only the team's admins read it when it differs from shown_body.
    body: text("body").notNull(),
    // What every other reader sees: contact details masked when posted before a quote was accepted.
    shownBody: text("shown_body").notNull(),
    replyToId: text("reply_to_id"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    surface: text("surface", { enum: CONVERSATION_SURFACES }).notNull(),
    discordMessageId: text("discord_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversation_message_project_idx").on(t.projectId, t.createdAt)],
);

// Which departments a freelancer answers requests for (conversations design §2).
export const memberDepartment = pgTable(
  "member_department",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    departmentId: text("department_id")
      .notNull()
      .references(() => servicesDepartment.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.departmentId] }),
    index("member_department_team_idx").on(t.teamId),
  ],
);

// When a project has rows here, they replace the department rule for its request space.
export const requestShortlist = pgTable(
  "request_shortlist",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);
