import { ORDER_STATUSES } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { products } from "./catalog";
import { team } from "./organization";

const CURRENCIES = ["USD", "EUR"] as const;
const minor = (name: string) => bigint(name, { mode: "number" });

// Sellers design §5.3: one product per order. Title and amount are copied at checkout so later product edits
// do not change what the buyer paid for. Orders keep the money history, so neither team nor product can be
// deleted under them.
export const orders = pgTable(
  "orders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productTitle: text("product_title").notNull(),
    buyerEmail: text("buyer_email").notNull(),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    platformFeeMinor: minor("platform_fee_minor"),
    paypalFeeMinor: minor("paypal_fee_minor"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    // SHA-256 of the secret checkout.start gave the browser; checkout.capture must present it.
    checkoutSecretHash: text("checkout_secret_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    paidAt: timestamp("paid_at"),
    refundedAt: timestamp("refunded_at"),
  },
  (t) => [
    index("orders_team_created_idx").on(t.teamId, t.createdAt),
    check("orders_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

export const downloadGrant = pgTable(
  "download_grant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    downloadsLeft: integer("downloads_left").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("download_grant_order_idx").on(t.orderId),
    check("download_grant_downloads_left_check", sql`${t.downloadsLeft} >= 0`),
  ],
);
