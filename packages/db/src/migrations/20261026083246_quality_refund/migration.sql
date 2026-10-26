ALTER TABLE "project" ADD COLUMN "quality_refund_minor" bigint;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "quality_refund_set_by" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "quality_refund_set_at" timestamp;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_quality_refund_set_by_user_id_fkey" FOREIGN KEY ("quality_refund_set_by") REFERENCES "user"("id") ON DELETE SET NULL;