CREATE TABLE "payout_approval" (
	"request_id" text,
	"admin_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payout_approval_pk" PRIMARY KEY("request_id","admin_user_id")
);
--> statement-breakpoint
CREATE TABLE "team_payout_rules" (
	"team_id" text PRIMARY KEY,
	"preset" text DEFAULT 'manual' NOT NULL,
	"auto_approve_up_to_minor" bigint,
	"auto_approve_scope" text DEFAULT 'requests' NOT NULL,
	"trusted_scope" text DEFAULT 'requests' NOT NULL,
	"second_approver_above_minor" bigint,
	"second_approver_scope" text DEFAULT 'both' NOT NULL,
	"pay_completed_projects" boolean DEFAULT false NOT NULL,
	"hold_days" integer DEFAULT 0 NOT NULL,
	"payday" text DEFAULT 'immediate' NOT NULL,
	"payday_weekday" integer,
	"payday_month_day" integer,
	"balance_floor_minor" bigint,
	"minimum_payout_minor" integer DEFAULT 100 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_payout_rules_hold_days_check" CHECK ("hold_days" between 0 and 90),
	CONSTRAINT "team_payout_rules_payday_month_day_check" CHECK ("payday_month_day" between 1 and 28),
	CONSTRAINT "team_payout_rules_payday_weekday_check" CHECK ("payday_weekday" between 0 and 6),
	CONSTRAINT "team_payout_rules_minimum_check" CHECK ("minimum_payout_minor" >= 100)
);
--> statement-breakpoint
CREATE TABLE "team_payout_trusted_member" (
	"team_id" text,
	"user_id" text,
	CONSTRAINT "team_payout_trusted_member_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "source" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "send_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "wait_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "offline_reference" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "offline_batch_id" text;--> statement-breakpoint
ALTER TABLE "team_payout_credentials" ADD COLUMN "can_read_balance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Carry each team's payout mode over to its payout rules before the column goes (presetRules in core).
INSERT INTO "team_payout_rules" ("team_id", "preset", "auto_approve_up_to_minor", "auto_approve_scope", "pay_completed_projects")
SELECT "team_id",
       "payout_mode",
       CASE "payout_mode" WHEN 'rules' THEN 10000 WHEN 'automatic' THEN 9007199254740991 ELSE NULL END,
       CASE "payout_mode" WHEN 'automatic' THEN 'automatic' ELSE 'requests' END,
       "payout_mode" = 'automatic'
FROM "services_team_settings";--> statement-breakpoint
ALTER TABLE "services_team_settings" DROP COLUMN "payout_mode";--> statement-breakpoint
DROP INDEX "payout_request_open_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "payout_request_open_idx" ON "payout_request" ("team_id","user_id") WHERE source = 'member' and status in ('requested', 'queued', 'sending', 'sent', 'exported');--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_offline_reference_key" UNIQUE("offline_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_request_project_idx" ON "payout_request" ("project_id") WHERE "project_id" is not null;--> statement-breakpoint
CREATE INDEX "payout_request_due_idx" ON "payout_request" ("status","send_after","next_attempt_at");--> statement-breakpoint
ALTER TABLE "payout_approval" ADD CONSTRAINT "payout_approval_request_id_payout_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payout_request"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payout_approval" ADD CONSTRAINT "payout_approval_admin_user_id_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team_payout_rules" ADD CONSTRAINT "team_payout_rules_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_payout_trusted_member" ADD CONSTRAINT "team_payout_trusted_member_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_payout_trusted_member" ADD CONSTRAINT "team_payout_trusted_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_source_check" CHECK ("source" in ('member', 'project'));--> statement-breakpoint
ALTER TABLE "payout_request" DROP CONSTRAINT "payout_request_status_check", ADD CONSTRAINT "payout_request_status_check" CHECK ("status" in ('requested', 'rejected', 'queued', 'sending', 'sent', 'succeeded', 'failed', 'exported'));