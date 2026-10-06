import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { team } from "./organization";
import { project } from "./projects";

// Services spec §6.6: events written in the same transaction as the change they describe.
export const outbox = pgTable(
  "outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    // Per project, from 1, with no gaps; subscribers order by it.
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex("outbox_project_sequence_idx").on(t.projectId, t.sequence),
    index("outbox_teamId_createdAt_idx").on(t.teamId, t.createdAt),
  ],
);
