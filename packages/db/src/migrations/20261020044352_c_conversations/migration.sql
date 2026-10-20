CREATE TABLE "conversation_message" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"space" text NOT NULL,
	"author_kind" text NOT NULL,
	"author_user_id" text,
	"author_contact_id" text,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"shown_body" text NOT NULL,
	"reply_to_id" text,
	"ref_type" text,
	"ref_id" text,
	"surface" text NOT NULL,
	"discord_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_department" (
	"team_id" text NOT NULL,
	"user_id" text,
	"department_id" text,
	CONSTRAINT "member_department_pkey" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "request_shortlist" (
	"project_id" text,
	"user_id" text,
	CONSTRAINT "request_shortlist_pkey" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "services_department" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "services_offering" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "declined_reason" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "declined_at" timestamp;--> statement-breakpoint
CREATE INDEX "conversation_message_project_idx" ON "conversation_message" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "member_department_team_idx" ON "member_department" ("team_id");--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_author_user_id_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_author_contact_id_client_contact_id_fkey" FOREIGN KEY ("author_contact_id") REFERENCES "client_contact"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_department_id_services_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "services_department"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "request_shortlist" ADD CONSTRAINT "request_shortlist_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "request_shortlist" ADD CONSTRAINT "request_shortlist_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;