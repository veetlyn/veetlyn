CREATE TABLE "payout_connect_attempt" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"seller_nonce" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "payout_connect_attempt_team_idx" ON "payout_connect_attempt" ("team_id");--> statement-breakpoint
ALTER TABLE "payout_connect_attempt" ADD CONSTRAINT "payout_connect_attempt_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payout_connect_attempt" ADD CONSTRAINT "payout_connect_attempt_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;