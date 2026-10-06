CREATE TABLE "discord_link_code" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"code" text NOT NULL UNIQUE,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_destination" (
	"user_id" text PRIMARY KEY,
	"paypal_payer_id" text NOT NULL,
	"paypal_email" text,
	"verified_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD COLUMN "discord_guild_id" text;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD CONSTRAINT "services_team_settings_discord_guild_id_key" UNIQUE("discord_guild_id");--> statement-breakpoint
CREATE INDEX "discord_link_code_teamId_idx" ON "discord_link_code" ("team_id");--> statement-breakpoint
ALTER TABLE "discord_link_code" ADD CONSTRAINT "discord_link_code_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payout_destination" ADD CONSTRAINT "payout_destination_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;