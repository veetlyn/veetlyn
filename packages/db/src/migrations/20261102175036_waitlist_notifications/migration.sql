CREATE TABLE "waitlist_notification" (
	"email" text PRIMARY KEY,
	"id" text NOT NULL,
	"recipient" text NOT NULL,
	"platform_name" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "waitlist_notification_due_idx" ON "waitlist_notification" ("sent_at","next_attempt_at");--> statement-breakpoint
ALTER TABLE "waitlist_notification" ADD CONSTRAINT "waitlist_notification_email_launch_waitlist_email_fkey" FOREIGN KEY ("email") REFERENCES "launch_waitlist"("email") ON DELETE CASCADE;