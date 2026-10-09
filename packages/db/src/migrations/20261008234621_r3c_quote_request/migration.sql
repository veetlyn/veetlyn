ALTER TABLE "project" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "request_answers" jsonb DEFAULT '[]' NOT NULL;