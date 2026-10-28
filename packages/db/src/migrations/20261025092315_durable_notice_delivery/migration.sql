ALTER TABLE "outbox" ADD COLUMN "notices_processed_at" timestamp;--> statement-breakpoint
-- Historical events predate the notice consumer; pending deliveries retain their own retry state.
UPDATE "outbox" SET "notices_processed_at" = "created_at";--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD COLUMN "claim_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD COLUMN "first_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD COLUMN "message" jsonb;--> statement-breakpoint
UPDATE "outbox_delivery" SET "first_attempt_at" = "created_at" WHERE "attempts" > 0;--> statement-breakpoint
CREATE INDEX "outbox_notices_pending_idx" ON "outbox" ("notices_processed_at","created_at");
