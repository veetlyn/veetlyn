import { FILE_PURPOSES } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";
import { project } from "./projects";

// One uploaded object in the private Files bucket. A row is created when the upload starts and attached
// once to what it belongs to (a delivery now); rows never attached are leftovers to clean up later.
export const fileUpload = pgTable(
  "file_upload",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: FILE_PURPOSES }).notNull(),
    r2Key: text("r2_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    attachedAt: timestamp("attached_at"),
  },
  (t) => [
    index("file_upload_projectId_idx").on(t.projectId),
    // The leftover sweep reads only unattached rows, oldest first.
    index("file_upload_unattached_idx").on(t.createdAt).where(sql`attached_at is null`),
  ],
);
