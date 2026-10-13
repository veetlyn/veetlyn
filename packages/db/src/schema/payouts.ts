import {
  OPEN_PAYOUT_REQUEST_STATUSES,
  PAYDAYS,
  PAYOUT_REQUEST_STATUSES,
  PAYOUT_RULE_PRESETS,
  PAYOUT_RULE_SCOPES,
} from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";
import { project } from "./projects";

const OPEN_STATUS_LIST = OPEN_PAYOUT_REQUEST_STATUSES.map((status) => `'${status}'`).join(", ");

// The predicate of the one-open-request partial index below; the insert conflict target must name the same one.
// Project payouts are left out: a member can have one per completed project next to their own request.
export const PAYOUT_REQUEST_MEMBER_OPEN_WHERE = sql.raw(`source = 'member' and status in (${OPEN_STATUS_LIST})`);

const CURRENCIES = ["USD", "EUR"] as const;
const minor = (name: string) => bigint(name, { mode: "number" });

// S2: the freelancer's verified PayPal payout destination (services spec §4.2). One per user;
// `recipient_type: PAYPAL_ID` payouts use the payer ID (spec §6.5).
export const payoutDestination = pgTable(
  "payout_destination",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    paypalPayerId: text("paypal_payer_id").notNull(),
    paypalEmail: text("paypal_email"),
    verifiedAt: timestamp("verified_at").notNull(),
    // Payout recipients are 18 or older: PayPal's age range says so, or the member confirmed it when PayPal sent none.
    ageConfirmedAt: timestamp("age_confirmed_at"),
    ageSource: text("age_source", { enum: ["paypal", "self"] }),
    // ISO country code from PayPal's userinfo; it sets PayPal's payout fee. Null when PayPal did not share it.
    paypalCountry: text("paypal_country"),
  },
  (t) => [check("payout_destination_age_source_check", sql`${t.ageSource} in ('paypal', 'self')`)],
);

// The REST app on the team's own PayPal Business account that sends its payouts. The secret is sealed with the
// platform key and the team id as additional data, so a row copied to another team does not open.
export const teamPayoutCredentials = pgTable("team_payout_credentials", {
  teamId: text("team_id")
    .primaryKey()
    .references(() => team.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  secretCiphertext: text("secret_ciphertext").notNull(),
  secretIv: text("secret_iv").notNull(),
  keyId: text("key_id").notNull(),
  // The account PayPal reported for these credentials; null when PayPal did not say.
  paypalAccountId: text("paypal_account_id"),
  // The connection was granted PayPal's balance and transaction search scope, so the send sweep can read the balance.
  canReadBalance: boolean("can_read_balance").notNull().default(false),
  verifiedAt: timestamp("verified_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// One started "turn on automatic payouts": the seller nonce sent with PayPal's first-party referral is the code
// verifier that turns the authorization code PayPal hands back into the team's credentials. Valid one hour, used once.
export const payoutConnectAttempt = pgTable(
  "payout_connect_attempt",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    sellerNonce: text("seller_nonce").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    usedAt: timestamp("used_at"),
  },
  (t) => [index("payout_connect_attempt_team_idx").on(t.teamId)],
);

// A member's request to be paid their available earnings from one team. The id is the ledger's payout request id
// and PayPal's sender_item_id; with send_attempt it names the batch, so a retry of an unconfirmed send names the
// same batch.
export const payoutRequest = pgTable(
  "payout_request",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    status: text("status", { enum: PAYOUT_REQUEST_STATUSES }).notNull().default("requested"),
    // "project": created by the sweep for one completed project; "member": the member asked.
    source: text("source", { enum: ["member", "project"] })
      .notNull()
      .default("member"),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    // An approved payout waits for the team's payday until send_after, and after a held send until next_attempt_at.
    sendAfter: timestamp("send_after", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    // How many times the send sweep put it back to wait (low balance, PayPal hold); picks the next backoff delay.
    waitCount: integer("wait_count").notNull().default(0),
    // The Customer ID in a Payouts Web CSV export, matched when the results log is imported.
    offlineReference: text("offline_reference").unique(),
    offlineBatchId: text("offline_batch_id"),
    // The member's destination when they asked: what the admin approves is what PayPal pays.
    receiverPayerId: text("receiver_payer_id").notNull(),
    // Numbers PayPal's sender_batch_id and PayPal-Request-Id. It moves on only after PayPal definitely made no
    // payout, so a resend is not answered with the replayed refusal; an unknown outcome keeps the same ids.
    sendAttempt: integer("send_attempt").notNull().default(0),
    paypalBatchId: text("paypal_batch_id").unique(),
    paypalItemId: text("paypal_item_id"),
    paypalItemStatus: text("paypal_item_status"),
    // Set when a fresh send is claimed and kept for its retries: PayPal's fee is estimated and taken off the payout,
    // so sent_minor + fee_estimate_minor = amount_minor.
    feeEstimateMinor: minor("fee_estimate_minor"),
    sentMinor: minor("sent_minor"),
    // The fee PayPal reported when the payout succeeded.
    feeMinor: minor("fee_minor"),
    failureMessage: text("failure_message"),
    reviewReason: text("review_reason"),
    // Set when a send left PayPal's outcome unknown: PayPal may hold a batch for this id, so no later refusal is final.
    uncertainAt: timestamp("uncertain_at", { withTimezone: true }),
    decidedByUserId: text("decided_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
    sentAt: timestamp("sent_at"),
    settledAt: timestamp("settled_at"),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("payout_request_team_status_idx").on(t.teamId, t.status),
    index("payout_request_user_team_idx").on(t.userId, t.teamId),
    uniqueIndex("payout_request_open_idx").on(t.teamId, t.userId).where(PAYOUT_REQUEST_MEMBER_OPEN_WHERE),
    uniqueIndex("payout_request_project_idx").on(t.projectId).where(sql`${t.projectId} is not null`),
    index("payout_request_due_idx").on(t.status, t.sendAfter, t.nextAttemptAt),
    check("payout_request_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "payout_request_sent_check",
      sql`(${t.sentMinor} is null and ${t.feeEstimateMinor} is null) or (${t.sentMinor} > 0 and ${t.feeEstimateMinor} >= 0 and ${t.sentMinor} + ${t.feeEstimateMinor} = ${t.amountMinor})`,
    ),
    check(
      "payout_request_status_check",
      sql`${t.status} in ('requested', 'rejected', 'queued', 'sending', 'sent', 'succeeded', 'failed', 'exported')`,
    ),
    check("payout_request_source_check", sql`${t.source} in ('member', 'project')`),
  ],
);

// One row per team; a team without one follows the manual preset (payout rules spec §3.1).
export const teamPayoutRules = pgTable(
  "team_payout_rules",
  {
    teamId: text("team_id")
      .primaryKey()
      .references(() => team.id, { onDelete: "cascade" }),
    preset: text("preset", { enum: PAYOUT_RULE_PRESETS }).notNull().default("manual"),
    autoApproveUpToMinor: minor("auto_approve_up_to_minor"),
    autoApproveScope: text("auto_approve_scope", { enum: PAYOUT_RULE_SCOPES }).notNull().default("requests"),
    trustedScope: text("trusted_scope", { enum: PAYOUT_RULE_SCOPES }).notNull().default("requests"),
    secondApproverAboveMinor: minor("second_approver_above_minor"),
    secondApproverScope: text("second_approver_scope", { enum: PAYOUT_RULE_SCOPES }).notNull().default("both"),
    payCompletedProjects: boolean("pay_completed_projects").notNull().default(false),
    holdDays: integer("hold_days").notNull().default(0),
    payday: text("payday", { enum: PAYDAYS }).notNull().default("immediate"),
    paydayWeekday: integer("payday_weekday"),
    paydayMonthDay: integer("payday_month_day"),
    balanceFloorMinor: minor("balance_floor_minor"),
    minimumPayoutMinor: integer("minimum_payout_minor").notNull().default(100),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("team_payout_rules_hold_days_check", sql`${t.holdDays} between 0 and 90`),
    check("team_payout_rules_payday_month_day_check", sql`${t.paydayMonthDay} between 1 and 28`),
    check("team_payout_rules_payday_weekday_check", sql`${t.paydayWeekday} between 0 and 6`),
    check("team_payout_rules_minimum_check", sql`${t.minimumPayoutMinor} >= 100`),
  ],
);

// Members whose own requests the trusted rule approves (payout rules spec §3.1).
export const teamPayoutTrustedMember = pgTable(
  "team_payout_trusted_member",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ name: "team_payout_trusted_member_pk", columns: [t.teamId, t.userId] })],
);

// One admin's approval of a request; a request above the second-approver amount needs two.
export const payoutApproval = pgTable(
  "payout_approval",
  {
    requestId: text("request_id")
      .notNull()
      .references(() => payoutRequest.id, { onDelete: "cascade" }),
    adminUserId: text("admin_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "payout_approval_pk", columns: [t.requestId, t.adminUserId] })],
);
