CREATE TABLE "billing_account" (
	"organization_id" text PRIMARY KEY,
	"services_tier" text,
	"store_tier" text,
	"interval" text DEFAULT 'monthly' NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"polar_customer_id" text UNIQUE,
	"polar_subscription_id" text UNIQUE,
	"polar_product_id" text,
	"polar_status" text,
	"past_due_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"ends_at" timestamp with time zone,
	"polar_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polar_webhook_event" (
	"id" text PRIMARY KEY,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "billing_account_reconcile_idx" ON "billing_account" ("polar_status","polar_modified_at");--> statement-breakpoint
ALTER TABLE "billing_account" ADD CONSTRAINT "billing_account_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Backfill (billing design §10): every existing workspace starts a 14-day trial on today's implied plans. Solo
-- services teams get Solo, other services teams Team; a workspace with a store team gets Starter.
INSERT INTO "billing_account" ("organization_id", "services_tier", "store_tier", "trial_ends_at")
SELECT
	o."id",
	(
		SELECT CASE WHEN count(*) = 1 AND bool_and(coalesce(s."solo", false)) THEN 'solo' ELSE 'team' END
		FROM "team" t
		LEFT JOIN "services_team_settings" s ON s."team_id" = t."id"
		WHERE t."organization_id" = o."id" AND t."product" = 'services'
		HAVING count(*) > 0
	),
	CASE WHEN EXISTS (SELECT 1 FROM "team" t WHERE t."organization_id" = o."id" AND t."product" = 'store') THEN 'starter' END,
	now() + interval '14 days'
FROM "organization" o
ON CONFLICT ("organization_id") DO NOTHING;
