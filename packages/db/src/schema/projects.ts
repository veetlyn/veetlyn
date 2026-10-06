import {
  AMENDMENT_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_STATUSES,
  type PaymentLine,
  PROJECT_STATUSES,
  QUOTE_STATUSES,
  type QuoteItemDraft,
} from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";

const CURRENCIES = ["USD", "EUR"] as const;

// Money columns are bigint minor units read as JS numbers; MAX_AMOUNT_MINOR keeps them exact.
const minor = (name: string) => bigint(name, { mode: "number" });

// Services spec §5. Teams with projects cannot be deleted: their money history must stay.
export const project = pgTable(
  "project",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    brief: text("brief").notNull().default(""),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("quoting"),
    // Compare-and-set token: every change bumps it (services spec §6.1).
    version: integer("version").notNull().default(0),
    clientEmail: text("client_email"),
    clientDiscordId: text("client_discord_id"),
    channelId: text("channel_id"),
    assignedFreelancerId: text("assigned_freelancer_id").references(() => user.id, { onDelete: "set null" }),
    // Copied from the team settings when the project starts, so later settings changes leave it alone.
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    managementFeeBps: integer("management_fee_bps").notNull(),
    teamCutBps: integer("team_cut_bps").notNull(),
    revisions: integer("revisions").notNull().default(0),
    deadlineAt: timestamp("deadline_at"),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("project_teamId_idx").on(t.teamId),
    check("project_client_check", sql`client_email is not null or client_discord_id is not null`),
  ],
);

export const quote = pgTable(
  "quote",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    // 1 for proposals; each accepted amendment adds a version (services spec §5.5).
    version: integer("version").notNull().default(1),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("proposed"),
    freelancerId: text("freelancer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    amountMinor: minor("amount_minor").notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    previousQuoteId: text("previous_quote_id"),
    amendmentId: text("amendment_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at"),
  },
  (t) => [
    index("quote_projectId_idx").on(t.projectId),
    // The accepted quote is the current version; there is at most one.
    uniqueIndex("quote_current_idx").on(t.projectId).where(sql`status = 'accepted'`),
    check("quote_amount_check", sql`amount_minor > 0`),
    check("quote_delivery_days_check", sql`delivery_days >= 0`),
  ],
);

export const quoteItem = pgTable(
  "quote_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    extraDays: integer("extra_days").notNull().default(0),
  },
  (t) => [
    unique("quote_item_position_unique").on(t.quoteId, t.position),
    check("quote_item_amount_check", sql`amount_minor > 0`),
    check("quote_item_extra_days_check", sql`extra_days >= 0`),
  ],
);

export const amendment = pgTable(
  "amendment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    baseQuoteId: text("base_quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "restrict" }),
    status: text("status", { enum: AMENDMENT_STATUSES }).notNull().default("pending"),
    proposedById: text("proposed_by_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    addItems: jsonb("add_items").$type<QuoteItemDraft[]>().notNull(),
    removeItemIds: jsonb("remove_item_ids").$type<string[]>().notNull(),
    deltaMinor: minor("delta_minor").notNull(),
    // Set when a decrease is accepted: the management fee moved back to client_held (services spec §6.3).
    managementFeeCreditMinor: minor("management_fee_credit_minor").notNull().default(0),
    newAmountMinor: minor("new_amount_minor").notNull(),
    extraDays: integer("extra_days").notNull().default(0),
    resultingQuoteId: text("resulting_quote_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [
    index("amendment_projectId_idx").on(t.projectId),
    uniqueIndex("amendment_pending_idx").on(t.projectId).where(sql`status = 'pending'`),
    check("amendment_new_amount_check", sql`new_amount_minor > 0`),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: PAYMENT_KINDS }).notNull(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("pending"),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    // The ledger posts these two parts to different accounts (services spec §6.3).
    quotePartMinor: minor("quote_part_minor").notNull(),
    managementFeeMinor: minor("management_fee_minor").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    lines: jsonb("lines").$type<PaymentLine[]>().notNull(),
    amendmentId: text("amendment_id").references(() => amendment.id, { onDelete: "restrict" }),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    capturedAt: timestamp("captured_at"),
  },
  (t) => [
    index("payment_projectId_idx").on(t.projectId),
    uniqueIndex("payment_deposit_idx").on(t.projectId).where(sql`kind = 'deposit'`),
    uniqueIndex("payment_balance_idx").on(t.projectId).where(sql`kind = 'balance'`),
    check("payment_parts_check", sql`quote_part_minor >= 0 and management_fee_minor >= 0`),
    check("payment_amount_check", sql`amount_minor > 0 and amount_minor = quote_part_minor + management_fee_minor`),
  ],
);
