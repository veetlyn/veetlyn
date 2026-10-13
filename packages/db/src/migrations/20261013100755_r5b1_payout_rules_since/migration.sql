ALTER TABLE "team_payout_rules" ADD COLUMN "pay_completed_projects_since" timestamp with time zone;--> statement-breakpoint
-- Teams already paying completed projects (carried over as automatic) start from now: no backlog is paid out.
UPDATE "team_payout_rules" SET "pay_completed_projects_since" = now() WHERE "pay_completed_projects";--> statement-breakpoint
ALTER TABLE "team_payout_rules" ADD CONSTRAINT "team_payout_rules_pay_completed_since_check" CHECK ("pay_completed_projects" = ("pay_completed_projects_since" is not null));
