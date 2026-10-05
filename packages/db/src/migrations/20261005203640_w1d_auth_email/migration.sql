CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "accepted_terms_at" timestamp;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "support_email" text;