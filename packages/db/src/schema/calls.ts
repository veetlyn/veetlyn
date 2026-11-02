import type { JsonObject } from "@jendal-workspace/core";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";
import { project } from "./projects";

export const AGENT_CALL_STATUSES = ["open", "done"] as const;
export const AGENT_ENTRY_KINDS = ["message", "proposal"] as const;
export const AGENT_PROPOSAL_STATUSES = ["pending", "done", "declined", "failed"] as const;

// A call a person opened with the platform's assistant (calls design §5, "started by a person"), at the team or on
// one project. It stays private to that person: what it read came from their own access.
export const agentCall = pgTable(
  "agent_call",
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
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status", { enum: AGENT_CALL_STATUSES }).notNull().default("open"),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (t) => [index("agent_call_team_user_idx").on(t.teamId, t.userId, t.openedAt)],
);

// The call's thread: what the person and the assistant said, and the actions the assistant proposed. A proposal
// runs only when the person confirms it, through the registry, as that person. Its body is the server's account of the
// stored input (what will run); the assistant's own words are only the note beside it.
export const agentCallEntry = pgTable(
  "agent_call_entry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    callId: text("call_id")
      .notNull()
      .references(() => agentCall.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: AGENT_ENTRY_KINDS }).notNull(),
    author: text("author", { enum: ["person", "assistant"] }).notNull(),
    body: text("body").notNull(),
    note: text("note"),
    action: text("action"),
    input: jsonb("input").$type<JsonObject>(),
    status: text("status", { enum: AGENT_PROPOSAL_STATUSES }),
    outcome: text("outcome"),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("agent_call_entry_call_idx").on(t.callId, t.createdAt)],
);
