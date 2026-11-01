CREATE TABLE "agent_call" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_call_entry" (
	"id" text PRIMARY KEY,
	"call_id" text NOT NULL,
	"kind" text NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"action" text,
	"input" jsonb,
	"status" text,
	"outcome" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_call_team_user_idx" ON "agent_call" ("team_id","user_id","opened_at");--> statement-breakpoint
CREATE INDEX "agent_call_entry_call_idx" ON "agent_call_entry" ("call_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "agent_call_entry" ADD CONSTRAINT "agent_call_entry_call_id_agent_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "agent_call"("id") ON DELETE CASCADE;