CREATE TABLE "action_log" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"action" text NOT NULL,
	"surface" text NOT NULL,
	"team_id" text,
	"project_id" text,
	"subject_kind" text,
	"subject_id" text,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"on_behalf_of" jsonb,
	"ip" text,
	"outcome" text NOT NULL,
	"message" text,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "action_log_created_at_idx" ON "action_log" ("created_at");--> statement-breakpoint
CREATE INDEX "action_log_team_created_idx" ON "action_log" ("team_id","created_at");