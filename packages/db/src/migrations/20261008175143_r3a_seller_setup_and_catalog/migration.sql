CREATE TABLE "services_department" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services_offering" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"department_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_min_minor" bigint NOT NULL,
	"price_max_minor" bigint NOT NULL,
	"days_min" integer NOT NULL,
	"days_max" integer NOT NULL,
	"intake_questions" jsonb DEFAULT '[]' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "services_offering_price_check" CHECK (price_min_minor >= 0 and price_max_minor >= price_min_minor),
	CONSTRAINT "services_offering_days_check" CHECK (days_min >= 1 and days_max >= days_min),
	CONSTRAINT "services_offering_questions_check" CHECK (jsonb_array_length(intake_questions) <= 5)
);
--> statement-breakpoint
ALTER TABLE "services_team_member" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD COLUMN "solo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD COLUMN "store_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "offering_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "source" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
CREATE INDEX "services_department_teamId_idx" ON "services_department" ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_department_team_name_idx" ON "services_department" ("team_id",lower(name));--> statement-breakpoint
CREATE INDEX "services_offering_teamId_idx" ON "services_offering" ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_offering_team_name_idx" ON "services_offering" ("team_id",lower(name));--> statement-breakpoint
ALTER TABLE "services_department" ADD CONSTRAINT "services_department_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "services_offering" ADD CONSTRAINT "services_offering_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "services_offering" ADD CONSTRAINT "services_offering_department_id_services_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "services_department"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_offering_id_services_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "services_offering"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "services_team_settings" ADD CONSTRAINT "services_team_settings_bio_check" CHECK (char_length(bio) <= 280);