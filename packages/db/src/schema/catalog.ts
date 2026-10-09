import type { VariantOption } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { team } from "./organization";

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A store is a Better Auth team, so store scoping is a FK to team.id (see packages/db/src/schema/organization.ts).
    storeId: text("store_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    // physical (Commerce stores) or digital (sellers, run 4a); derived from the team at creation.
    kind: text("kind").notNull().default("physical"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    brand: text("brand").notNull().default(""),
    category: text("category").notNull().default(""),
    // Tax and shipping behavior is defined by the services workstream; the catalog already records the flags.
    chargeTax: boolean("charge_tax").notNull().default(true),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    channel3ProductId: text("channel3_product_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_products_store_status").on(table.storeId, table.status),
    check("products_status_check", sql`${table.status} IN ('draft', 'published')`),
    check("products_kind_check", sql`${table.kind} IN ('physical', 'digital')`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: text("store_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    options: jsonb("options").$type<VariantOption[]>().notNull().default([]),
    sku: text("sku"),
    // Minor units (platform spec §3); the store currency arrives with store settings in a later workstream.
    priceMinor: integer("price_minor").notNull().default(0),
    stock: integer("stock").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_variants_product").on(table.productId),
    uniqueIndex("uq_variants_store_sku")
      .on(table.storeId, sql`lower(${table.sku})`)
      .where(sql`${table.sku} IS NOT NULL AND ${table.sku} <> ''`),
    check("variants_price_check", sql`${table.priceMinor} BETWEEN 0 AND 99999999`),
    check("variants_stock_check", sql`${table.stock} BETWEEN 0 AND 1000000`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: text("store_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    imageKey: text("image_key").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_images_product").on(table.productId)],
);
