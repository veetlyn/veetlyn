import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { team } from "./organization";

export const storeDomains = pgTable(
  "store_domains",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    storeId: text("store_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    status: text("status", { enum: ["pending", "active"] })
      .default("pending")
      .notNull(),
    cloudflareHostnameId: text("cloudflare_hostname_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("store_domains_storeId_idx").on(table.storeId)],
);
