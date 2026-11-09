ALTER TABLE "outbox" ADD COLUMN "agent_drafts_processed_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_call" ADD COLUMN "draft_started_at" timestamp;--> statement-breakpoint
CREATE INDEX "outbox_agent_drafts_pending_idx" ON "outbox" ("created_at") WHERE "agent_drafts_processed_at" is null and "type" in ('project.created', 'project.assigned');--> statement-breakpoint
CREATE UNIQUE INDEX "agent_call_one_draft_idx" ON "agent_call" ("user_id","project_id") WHERE "draft_started_at" is not null;--> statement-breakpoint
-- Everything already in the outbox has been answered or is left to Home.
UPDATE "outbox" SET "agent_drafts_processed_at" = now() WHERE "type" IN ('project.created', 'project.assigned');
