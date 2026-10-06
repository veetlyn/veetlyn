CREATE TABLE "services_team_member" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "services_team_member_team_user_unique" UNIQUE("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "services_team_settings" (
	"team_id" text PRIMARY KEY,
	"currency" text DEFAULT 'USD' NOT NULL,
	"team_cut_bps" integer DEFAULT 1500 NOT NULL,
	"management_fee_bps" integer DEFAULT 1000 NOT NULL,
	"quoting_mode" text DEFAULT 'assigned' NOT NULL,
	"payout_mode" text DEFAULT 'manual' NOT NULL,
	"settings_saved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "product" text DEFAULT 'store' NOT NULL;--> statement-breakpoint
CREATE INDEX "services_team_member_userId_idx" ON "services_team_member" ("user_id");--> statement-breakpoint
ALTER TABLE "services_team_member" ADD CONSTRAINT "services_team_member_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "services_team_member" ADD CONSTRAINT "services_team_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD CONSTRAINT "services_team_settings_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;