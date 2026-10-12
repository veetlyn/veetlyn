CREATE TABLE "project_refund" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "project_refund_amount_positive" CHECK ("amount_minor" > 0),
	CONSTRAINT "project_refund_status_check" CHECK ("status" in ('requested', 'issuing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "project_refund_part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_refund_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paypal_refund_id" text UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_refund_part_payment_unique" UNIQUE("project_refund_id","payment_id"),
	CONSTRAINT "project_refund_part_amount_positive" CHECK ("amount_minor" > 0),
	CONSTRAINT "project_refund_part_status_check" CHECK ("status" in ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "refunded_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "review_reason" text;--> statement-breakpoint
CREATE INDEX "project_refund_project_idx" ON "project_refund" ("project_id");--> statement-breakpoint
ALTER TABLE "project_refund" ADD CONSTRAINT "project_refund_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "project_refund" ADD CONSTRAINT "project_refund_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "project_refund_part" ADD CONSTRAINT "project_refund_part_project_refund_id_project_refund_id_fkey" FOREIGN KEY ("project_refund_id") REFERENCES "project_refund"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "project_refund_part" ADD CONSTRAINT "project_refund_part_payment_id_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_refunded_check" CHECK (refunded_minor >= 0 and refunded_minor <= amount_minor);