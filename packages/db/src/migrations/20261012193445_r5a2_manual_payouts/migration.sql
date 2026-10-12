DROP TABLE "team_payout_credentials";--> statement-breakpoint
ALTER TABLE "payout_request" DROP CONSTRAINT "payout_request_paypal_batch_id_key";--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "receiver_email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "received_minor" bigint;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "paypal_transaction_id" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "send_attempt";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "paypal_batch_id";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "paypal_item_id";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "paypal_item_status";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "fee_minor";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "failure_message";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "review_reason";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "uncertain_at";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "sent_at";--> statement-breakpoint
ALTER TABLE "payout_request" DROP COLUMN "settled_at";--> statement-breakpoint
DROP INDEX "payout_request_open_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "payout_request_open_idx" ON "payout_request" ("team_id","user_id") WHERE status in ('requested');--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_received_check" CHECK ("received_minor" is null or ("received_minor" > 0 and "received_minor" <= "amount_minor"));--> statement-breakpoint
ALTER TABLE "payout_request" DROP CONSTRAINT "payout_request_status_check", ADD CONSTRAINT "payout_request_status_check" CHECK ("status" in ('requested', 'paid', 'rejected'));