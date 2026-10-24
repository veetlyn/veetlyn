CREATE TABLE "dispute" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"project_id" text,
	"order_id" text,
	"paypal_dispute_id" text NOT NULL UNIQUE,
	"paypal_capture_id" text,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"raw_payload" jsonb,
	CONSTRAINT "dispute_amount_check" CHECK (amount_minor >= 0)
);
--> statement-breakpoint
CREATE TABLE "member_mark" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"member_user_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_notice_preference" (
	"team_id" text,
	"user_id" text,
	"project_notices_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_notice_preference_pkey" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_delivery" (
	"id" text PRIMARY KEY,
	"outbox_id" text NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now(),
	"sent_at" timestamp,
	"last_error" text,
	"provider_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rulebook" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"preset" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_by_id" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rulebook_acceptance" (
	"id" text PRIMARY KEY,
	"rulebook_id" text NOT NULL,
	"team_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"user_id" text,
	"contact_id" text,
	"project_id" text,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_item" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"run_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"payload" jsonb,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD COLUMN "kind" text DEFAULT 'agency' NOT NULL;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD COLUMN "manager_cut_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "services_offering" ADD COLUMN "fulfilment" text DEFAULT 'people' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "rulebook_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "manager_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "manager_cut_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "upfront_bps" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "late_refund_proposed_minor" bigint;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "late_refund_days_late" integer;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "late_refund_status" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "late_refund_decided_by" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "late_refund_decided_at" timestamp;--> statement-breakpoint
CREATE INDEX "dispute_team_idx" ON "dispute" ("team_id");--> statement-breakpoint
CREATE INDEX "dispute_project_idx" ON "dispute" ("project_id");--> statement-breakpoint
CREATE INDEX "member_mark_team_member_idx" ON "member_mark" ("team_id","member_user_id","created_at");--> statement-breakpoint
CREATE INDEX "member_mark_project_idx" ON "member_mark" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_delivery_dedupe_idx" ON "outbox_delivery" ("outbox_id","channel","recipient");--> statement-breakpoint
CREATE INDEX "outbox_delivery_due_idx" ON "outbox_delivery" ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rulebook_team_version_idx" ON "rulebook" ("team_id","version");--> statement-breakpoint
CREATE INDEX "rulebook_team_published_idx" ON "rulebook" ("team_id","status");--> statement-breakpoint
CREATE INDEX "rulebook_acceptance_rulebook_idx" ON "rulebook_acceptance" ("rulebook_id");--> statement-breakpoint
CREATE INDEX "rulebook_acceptance_team_user_idx" ON "rulebook_acceptance" ("team_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_item_active_idx" ON "schedule_item" ("subject_id","kind") WHERE status in ('pending', 'paused');--> statement-breakpoint
CREATE INDEX "schedule_item_due_idx" ON "schedule_item" ("status","run_at");--> statement-breakpoint
CREATE INDEX "schedule_item_team_idx" ON "schedule_item" ("team_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_manager_id_user_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_late_refund_decided_by_user_id_fkey" FOREIGN KEY ("late_refund_decided_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "member_mark" ADD CONSTRAINT "member_mark_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_mark" ADD CONSTRAINT "member_mark_member_user_id_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_mark" ADD CONSTRAINT "member_mark_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "member_notice_preference" ADD CONSTRAINT "member_notice_preference_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_notice_preference" ADD CONSTRAINT "member_notice_preference_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD CONSTRAINT "outbox_delivery_outbox_id_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "outbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rulebook" ADD CONSTRAINT "rulebook_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rulebook" ADD CONSTRAINT "rulebook_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "rulebook_acceptance" ADD CONSTRAINT "rulebook_acceptance_rulebook_id_rulebook_id_fkey" FOREIGN KEY ("rulebook_id") REFERENCES "rulebook"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rulebook_acceptance" ADD CONSTRAINT "rulebook_acceptance_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rulebook_acceptance" ADD CONSTRAINT "rulebook_acceptance_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "rulebook_acceptance" ADD CONSTRAINT "rulebook_acceptance_contact_id_client_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contact"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "rulebook_acceptance" ADD CONSTRAINT "rulebook_acceptance_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "schedule_item" ADD CONSTRAINT "schedule_item_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
UPDATE "services_team_settings" SET "kind" = CASE WHEN "solo" THEN 'solo' ELSE 'agency' END;--> statement-breakpoint
INSERT INTO "rulebook" ("id", "team_id", "version", "status", "preset", "spec", "published_at")
SELECT
	'rb_v1_' || s."team_id",
	s."team_id",
	1,
	'published',
	CASE WHEN s."solo" THEN 'solo' ELSE 'agency' END,
	jsonb_set(
		jsonb_set(
			jsonb_set(
				CASE WHEN s."solo" THEN '{"upfront":{"defaultBps":5000},"upfrontTiers":{"tiers":[{"minQuoteMinor":100000,"maxQuoteMinor":null,"bps":5000},{"minQuoteMinor":0,"maxQuoteMinor":30000,"bps":10000}]},"revisions":{"freeCount":2,"paidRevisionPriceMinor":5000},"responseWindow":{"hours":48,"remindBeforeHours":12},"updateWindow":{"hours":72,"remindBeforeHours":12},"clientSilence":{"firstReminderDays":5,"secondReminderDays":10,"finalDays":14,"silenceOutcome":"accept_and_complete"},"lateDelivery":{"ratePerDayBps":0,"capBps":0},"qualityRefund":{"beforeWorkCapBps":10000,"inProgressCapBps":5000,"afterDeliveryCapBps":2500},"split":{"teamCutBps":0,"managerCutBps":0,"memberCutBps":10000},"strikes":{"threshold":0,"windowDays":30},"leavingNotice":{"days":0},"dispute":{"discussionDays":3,"reviewDays":10,"decisionDays":5}}'::jsonb ELSE '{"upfront":{"defaultBps":5000},"upfrontTiers":{"tiers":[{"minQuoteMinor":100000,"maxQuoteMinor":null,"bps":5000},{"minQuoteMinor":0,"maxQuoteMinor":30000,"bps":10000}]},"revisions":{"freeCount":2,"paidRevisionPriceMinor":7500},"responseWindow":{"hours":48,"remindBeforeHours":12},"updateWindow":{"hours":48,"remindBeforeHours":8},"clientSilence":{"firstReminderDays":5,"secondReminderDays":10,"finalDays":14,"silenceOutcome":"accept_and_complete"},"lateDelivery":{"ratePerDayBps":200,"capBps":2000},"qualityRefund":{"beforeWorkCapBps":10000,"inProgressCapBps":5000,"afterDeliveryCapBps":2500},"split":{"teamCutBps":2000,"managerCutBps":1000,"memberCutBps":7000},"strikes":{"threshold":3,"windowDays":30},"leavingNotice":{"days":14},"dispute":{"discussionDays":3,"reviewDays":10,"decisionDays":5}}'::jsonb END,
				'{split,teamCutBps}',
				to_jsonb(least(s."team_cut_bps", 10000 - (CASE WHEN s."solo" THEN 0 ELSE 1000 END)))
			),
			'{split,managerCutBps}',
			to_jsonb(CASE WHEN s."solo" THEN 0 ELSE 1000 END)
		),
		'{split,memberCutBps}',
		to_jsonb(10000 - least(s."team_cut_bps", 10000 - (CASE WHEN s."solo" THEN 0 ELSE 1000 END)) - (CASE WHEN s."solo" THEN 0 ELSE 1000 END))
	),
	now()
FROM "services_team_settings" s
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "services_team_settings" s
SET "manager_cut_bps" = coalesce((r."spec" -> 'split' ->> 'managerCutBps')::int, 0)
FROM "rulebook" r
WHERE r."id" = 'rb_v1_' || s."team_id" AND s."manager_cut_bps" = 0;--> statement-breakpoint
UPDATE "project" SET "rulebook_id" = 'rb_v1_' || "team_id" WHERE "rulebook_id" IS NULL;