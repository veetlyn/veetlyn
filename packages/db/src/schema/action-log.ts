import type { JsonObject } from "@jendal-workspace/core";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Who did what, for whom and from where. Inputs are never stored: they can hold client personal data.
// No foreign keys: the log outlives the rows it names and never blocks their deletion.
export const actionLog = pgTable(
  "action_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    requestId: text("request_id").notNull(),
    action: text("action").notNull(),
    surface: text("surface").notNull(),
    teamId: text("team_id"),
    projectId: text("project_id"),
    subjectKind: text("subject_kind"),
    subjectId: text("subject_id"),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    onBehalfOf: jsonb("on_behalf_of").$type<JsonObject>(),
    ip: text("ip"),
    outcome: text("outcome").notNull(),
    message: text("message"),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => [
    index("action_log_created_at_idx").on(t.createdAt),
    index("action_log_team_created_idx").on(t.teamId, t.createdAt),
  ],
);
