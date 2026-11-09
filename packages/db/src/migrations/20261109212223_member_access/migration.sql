ALTER TABLE "services_team_member" ADD COLUMN "hidden_areas" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "services_team_member" ADD COLUMN "hide_project_finances" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services_team_member" ADD COLUMN "money_viewer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services_team_member" ADD COLUMN "access_changed_at" timestamp;