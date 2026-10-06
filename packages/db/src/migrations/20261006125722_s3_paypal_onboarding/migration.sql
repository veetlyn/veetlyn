CREATE TABLE "paypal_onboarding" (
	"team_id" text PRIMARY KEY,
	"tracking_id" text NOT NULL UNIQUE,
	"action_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"merchant_id" text,
	"payments_receivable" boolean,
	"primary_email_confirmed" boolean,
	"oauth_integrations" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paypal_onboarding" ADD CONSTRAINT "paypal_onboarding_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;