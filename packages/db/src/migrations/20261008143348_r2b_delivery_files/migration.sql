CREATE TABLE "file_upload" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"project_id" text,
	"purpose" text NOT NULL,
	"r2_key" text NOT NULL UNIQUE,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"attached_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "delivery" ADD COLUMN "file_upload_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_fileUploadId_idx" ON "delivery" ("file_upload_id");--> statement-breakpoint
CREATE INDEX "file_upload_projectId_idx" ON "file_upload" ("project_id");--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_file_upload_id_file_upload_id_fkey" FOREIGN KEY ("file_upload_id") REFERENCES "file_upload"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;