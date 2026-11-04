ALTER TABLE "agent_call" ADD COLUMN "node_kind" text;--> statement-breakpoint
ALTER TABLE "agent_call" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "agent_call" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "agent_call" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
-- Calls so far were opened at a services team or on one of its projects.
UPDATE "agent_call" SET
  "node_kind" = CASE WHEN "project_id" IS NULL THEN 'seller' ELSE 'record' END,
  "organization_id" = (SELECT "organization_id" FROM "team" WHERE "team"."id" = "agent_call"."team_id");--> statement-breakpoint
ALTER TABLE "agent_call" ALTER COLUMN "node_kind" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_call_user_org_idx" ON "agent_call" ("user_id","organization_id","opened_at");--> statement-breakpoint
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_node_check" CHECK (case "node_kind"
        when 'account' then "organization_id" is null and "team_id" is null and "section" is null and "project_id" is null
        when 'workspace' then "organization_id" is not null and "team_id" is null and "section" is null and "project_id" is null
        when 'seller' then "organization_id" is not null and "team_id" is not null and "section" is null and "project_id" is null
        when 'section' then "organization_id" is not null and "team_id" is not null and "section" is not null and "project_id" is null
        when 'record' then "organization_id" is not null and "team_id" is not null and "section" is null
        else false end);