import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";

// The platform's own request limits (Better Auth's limiter owns rate_limit). One row per key and fixed window.
export const requestLimit = pgTable("request_limit", {
  key: text("key").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
});
