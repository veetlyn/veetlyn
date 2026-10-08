CREATE TABLE "paypal_webhook_event" (
	"id" text PRIMARY KEY,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"custom_id" text,
	"order_id" text,
	"merchant_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"note" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "paypal_fee_minor" bigint;--> statement-breakpoint
CREATE INDEX "paypal_webhook_event_status_idx" ON "paypal_webhook_event" ("status","received_at");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_paypal_fee_check" CHECK (paypal_fee_minor is null or (paypal_fee_minor >= 0 and paypal_fee_minor <= amount_minor));