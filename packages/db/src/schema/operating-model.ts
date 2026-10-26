import type { JsonObject } from "@jendal-workspace/core";
import type { RulebookRules } from "@opmodel/engine-rules";
import type { ScheduleItemKind } from "@opmodel/engine-scheduler";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { clientContact } from "./contacts";
import { team } from "./organization";
import { orders } from "./orders";
import { outbox } from "./outbox";
import { project } from "./projects";

// Money columns are bigint minor units read as JS numbers; MAX_AMOUNT_MINOR keeps them exact.
const minor = (name: string) => bigint(name, { mode: "number" });

const SCHEDULE_ITEM_KINDS = [
  "request.remind",
  "request.expire",
  "member.updateRemind",
  "member.updateLate",
  "client.reviewRemind1",
  "client.reviewRemind2",
  "project.autoComplete",
  "project.abandon",
] as const satisfies readonly ScheduleItemKind[];

const OUTBOX_DELIVERY_CHANNELS = ["email_client", "email_member", "email_dispute", "discord", "webhook"] as const;

// The team's versioned operating model. Projects pin the version they started under; a published
// version never changes, so an in-flight project keeps its rules.
export const rulebook = pgTable(
  "rulebook",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status", { enum: ["draft", "published"] }).notNull(),
    preset: text("preset", { enum: ["solo", "agency", "collective", "custom"] }).notNull(),
    spec: jsonb("spec").$type<RulebookRules>().notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rulebook_team_version_idx").on(t.teamId, t.version), index("rulebook_team_published_idx").on(t.teamId, t.status)],
);

// A client or member accepting a team's terms at a point in time; one row per acceptance.
export const rulebookAcceptance = pgTable(
  "rulebook_acceptance",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    rulebookId: text("rulebook_id")
      .notNull()
      .references(() => rulebook.id, { onDelete: "restrict" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    actorKind: text("actor_kind", { enum: ["client", "member"] }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => clientContact.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at").notNull().defaultNow(),
  },
  (t) => [index("rulebook_acceptance_rulebook_idx").on(t.rulebookId), index("rulebook_acceptance_team_user_idx").on(t.teamId, t.userId)],
);

// One timed rule per subject and kind while it is active: the scheduler upserts and cancels these as
// the subject moves (request answered, update posted, delivery accepted, dispute opened).
export const scheduleItem = pgTable(
  "schedule_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    // The subject the rule runs on: today always a project id. Plain text so other subjects can come
    // without a schema change.
    subjectId: text("subject_id").notNull(),
    kind: text("kind", { enum: SCHEDULE_ITEM_KINDS }).notNull(),
    runAt: timestamp("run_at").notNull(),
    status: text("status", { enum: ["pending", "paused", "done", "cancelled", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    payload: jsonb("payload"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("schedule_item_active_idx").on(t.subjectId, t.kind).where(sql`status in ('pending', 'paused')`),
    index("schedule_item_due_idx").on(t.status, t.runAt),
    index("schedule_item_team_idx").on(t.teamId),
  ],
);

// Marks recorded against a member; three inside the rulebook's rolling window trigger a warning and
// (with the strike rule on) suspension from new requests.
export const memberMark = pgTable(
  "member_mark",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    memberUserId: text("member_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["late_update", "late_delivery", "quality_refund", "warning", "leaving_notice"] }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("member_mark_team_member_idx").on(t.teamId, t.memberUserId, t.createdAt), index("member_mark_project_idx").on(t.projectId)],
);

// One delivery per event, channel and recipient: the outbox pipeline's idempotency and retry state.
export const outboxDelivery = pgTable(
  "outbox_delivery",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    outboxId: text("outbox_id")
      .notNull()
      .references(() => outbox.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: OUTBOX_DELIVERY_CHANNELS }).notNull(),
    recipient: text("recipient").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed", "skipped"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // Null once the delivery is dead (attempts exhausted) or sent.
    nextAttemptAt: timestamp("next_attempt_at").defaultNow(),
    sentAt: timestamp("sent_at"),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    claimToken: text("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at"),
    firstAttemptAt: timestamp("first_attempt_at"),
    // Retries must present the same message to the provider's idempotency key.
    message: jsonb("message").$type<JsonObject>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("outbox_delivery_dedupe_idx").on(t.outboxId, t.channel, t.recipient),
    index("outbox_delivery_due_idx").on(t.status, t.nextAttemptAt),
  ],
);

// A PayPal dispute case matched to a project or a store order; open cases pause timers and payouts.
export const dispute = pgTable(
  "dispute",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    paypalDisputeId: text("paypal_dispute_id").notNull().unique(),
    paypalCaptureId: text("paypal_capture_id"),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "waiting_for_seller", "under_review", "resolved_buyer", "resolved_seller"] }).notNull(),
    outcome: text("outcome"),
    amountMinor: minor("amount_minor"),
    currency: text("currency"),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    rawPayload: jsonb("raw_payload"),
  },
  (t) => [index("dispute_team_idx").on(t.teamId), index("dispute_project_idx").on(t.projectId), check("dispute_amount_check", sql`amount_minor >= 0`)],
);

// A member's notice opt-out, per team; absent means notices on.
export const memberNoticePreference = pgTable(
  "member_notice_preference",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectNoticesEnabled: boolean("project_notices_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);
