import type { JsonObject } from "@jendal-workspace/core";
import { NODE_KINDS, SECTIONS } from "@jendal-workspace/core/context/node";
import { sql } from "drizzle-orm";
import { check, index, uniqueIndex, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { organization, team } from "./organization";
import { project } from "./projects";

export const AGENT_CALL_STATUSES = ["open", "done"] as const;
export const AGENT_ENTRY_KINDS = ["message", "proposal"] as const;
export const AGENT_PROPOSAL_STATUSES = ["pending", "done", "declined", "failed"] as const;

// A call a person opened with the platform's assistant (calls design §5, "started by a person"), at one node of the
// context tree: their account, a workspace, a seller, one of its sections, or a project. It stays private to that
// person: what it read came from their own access, which is checked again each time the call is read or continued.
export const agentCall = pgTable(
  "agent_call",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    nodeKind: text("node_kind", { enum: NODE_KINDS }).notNull(),
    // Every node below the account sits in a workspace; the seller below the workspace.
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => team.id, { onDelete: "cascade" }),
    section: text("section", { enum: SECTIONS }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status", { enum: AGENT_CALL_STATUSES }).notNull().default("open"),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
    // Set while the agent is preparing a quote in this call, and kept once it has. Null on every other call.
    draftStartedAt: timestamp("draft_started_at"),
  },
  (t) => [
    index("agent_call_team_user_idx").on(t.teamId, t.userId, t.openedAt),
    // One prepared quote per person and request, whichever of the arrival and a visit to Home gets there first.
    uniqueIndex("agent_call_one_draft_idx").on(t.userId, t.projectId).where(sql`${t.draftStartedAt} is not null`),
    index("agent_call_user_org_idx").on(t.userId, t.organizationId, t.openedAt),
    // Each kind names exactly the places its node needs. A record call keeps its kind if its project is ever removed.
    check(
      "agent_call_node_check",
      sql`case ${t.nodeKind}
        when 'account' then ${t.organizationId} is null and ${t.teamId} is null and ${t.section} is null and ${t.projectId} is null
        when 'workspace' then ${t.organizationId} is not null and ${t.teamId} is null and ${t.section} is null and ${t.projectId} is null
        when 'seller' then ${t.organizationId} is not null and ${t.teamId} is not null and ${t.section} is null and ${t.projectId} is null
        when 'section' then ${t.organizationId} is not null and ${t.teamId} is not null and ${t.section} is not null and ${t.projectId} is null
        when 'record' then ${t.organizationId} is not null and ${t.teamId} is not null and ${t.section} is null
        else false end`,
    ),
  ],
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
