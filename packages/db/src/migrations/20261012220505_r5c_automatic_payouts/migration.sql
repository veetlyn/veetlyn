CREATE TABLE "team_payout_credentials" (
	"team_id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"key_id" text NOT NULL,
	"paypal_account_id" text,
	"verified_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_request" DROP CONSTRAINT "payout_request_received_check";--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "send_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "paypal_batch_id" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "paypal_item_id" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "paypal_item_status" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "failure_message" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "uncertain_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "receiver_email";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "received_minor";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "paypal_transaction_id";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "paid_at";--> statement-breakpoint
DROP INDEX "payout_request_open_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "payout_request_open_idx" ON "payout_request" ("team_id","user_id") WHERE status in ('requested', 'queued', 'sending', 'sent');--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_paypal_batch_id_key" UNIQUE("paypal_batch_id");--> statement-breakpoint
ALTER TABLE "team_payout_credentials" ADD CONSTRAINT "team_payout_credentials_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payout_request" DROP CONSTRAINT "payout_request_status_check", ADD CONSTRAINT "payout_request_status_check" CHECK ("status" in ('requested', 'rejected', 'queued', 'sending', 'sent', 'succeeded', 'failed'));