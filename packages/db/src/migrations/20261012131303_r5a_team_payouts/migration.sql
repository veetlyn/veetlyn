CREATE TABLE "payout_request" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"receiver_payer_id" text NOT NULL,
	"paypal_batch_id" text UNIQUE,
	"paypal_item_id" text,
	"paypal_item_status" text,
	"fee_minor" bigint,
	"failure_message" text,
	"review_reason" text,
	"uncertain_at" timestamp with time zone,
	"decided_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	"sent_at" timestamp,
	"settled_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payout_request_amount_positive" CHECK ("amount_minor" > 0),
	CONSTRAINT "payout_request_status_check" CHECK ("status" in ('requested', 'rejected', 'queued', 'sending', 'sent', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "team_payout_credentials" (
	"team_id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"key_id" text NOT NULL,
	"paypal_account_id" text NOT NULL,
	"verified_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_destination" ADD COLUMN "age_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "payout_destination" ADD COLUMN "age_source" text;--> statement-breakpoint
CREATE INDEX "payout_request_team_status_idx" ON "payout_request" ("team_id","status");--> statement-breakpoint
CREATE INDEX "payout_request_user_team_idx" ON "payout_request" ("user_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_request_open_idx" ON "payout_request" ("team_id","user_id") WHERE status in ('requested', 'queued', 'sending', 'sent');--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_decided_by_user_id_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "team_payout_credentials" ADD CONSTRAINT "team_payout_credentials_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payout_destination" ADD CONSTRAINT "payout_destination_age_source_check" CHECK ("age_source" in ('paypal', 'self'));