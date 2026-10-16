CREATE TABLE "client_contact" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_identity" (
	"id" text PRIMARY KEY,
	"contact_id" text NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"verified_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "project_client" (
	"project_id" text,
	"contact_id" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"link_version" integer DEFAULT 1 NOT NULL,
	"link_email" text,
	"link_emailed_at" timestamp,
	"link_aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"added_by_id" text,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_client_pkey" PRIMARY KEY("project_id","contact_id")
);
--> statement-breakpoint
CREATE INDEX "client_contact_teamId_idx" ON "client_contact" ("team_id");--> statement-breakpoint
CREATE INDEX "client_identity_contact_idx" ON "client_identity" ("contact_id");--> statement-breakpoint
CREATE INDEX "client_identity_lookup_idx" ON "client_identity" ("team_id","kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "client_identity_verified_unique" ON "client_identity" ("team_id","kind","value") WHERE verified_at is not null;--> statement-breakpoint
CREATE INDEX "project_client_contact_idx" ON "project_client" ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_client_primary_idx" ON "project_client" ("project_id") WHERE is_primary;--> statement-breakpoint
ALTER TABLE "client_contact" ADD CONSTRAINT "client_contact_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "client_identity" ADD CONSTRAINT "client_identity_contact_id_client_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client_identity" ADD CONSTRAINT "client_identity_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_client" ADD CONSTRAINT "project_client_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_client" ADD CONSTRAINT "project_client_contact_id_client_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_client" ADD CONSTRAINT "project_client_added_by_id_user_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "user"("id") ON DELETE SET NULL;