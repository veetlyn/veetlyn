ALTER TABLE "services_team_settings" ADD COLUMN "agent_quotes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD COLUMN "agent_messages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD COLUMN "agent_payouts" boolean DEFAULT true NOT NULL;