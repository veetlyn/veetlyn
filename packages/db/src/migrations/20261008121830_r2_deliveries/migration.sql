CREATE TABLE "delivery" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"submitted_by_id" text,
	"note" text DEFAULT '' NOT NULL,
	"link" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"client_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "final_price_minor" bigint;--> statement-breakpoint
CREATE INDEX "delivery_projectId_idx" ON "delivery" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_open_idx" ON "delivery" ("project_id") WHERE status = 'submitted';--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_submitted_by_id_user_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "user"("id") ON DELETE SET NULL;