ALTER TABLE "team" ADD COLUMN "paypal_country" text;--> statement-breakpoint
ALTER TABLE "payout_destination" ADD COLUMN "paypal_country" text;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "fee_estimate_minor" bigint;--> statement-breakpoint
ALTER TABLE "payout_request" ADD COLUMN "sent_minor" bigint;--> statement-breakpoint
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_sent_check" CHECK (("sent_minor" is null and "fee_estimate_minor" is null) or ("sent_minor" > 0 and "fee_estimate_minor" >= 0 and "sent_minor" + "fee_estimate_minor" = "amount_minor"));