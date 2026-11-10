CREATE TABLE "client_rating" (
	"project_id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"rating" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"rated_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_rating_rating_check" CHECK (rating between 1 and 5),
	CONSTRAINT "client_rating_note_check" CHECK (char_length(note) <= 500)
);
--> statement-breakpoint
CREATE TABLE "portfolio_item" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_item_url_check" CHECK (url like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "seller_review" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL UNIQUE,
	"team_id" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"reviewer_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"hidden_at" timestamp,
	CONSTRAINT "seller_review_rating_check" CHECK (rating between 1 and 5),
	CONSTRAINT "seller_review_body_check" CHECK (char_length(body) <= 1000)
);
--> statement-breakpoint
CREATE INDEX "portfolio_item_team_idx" ON "portfolio_item" ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "seller_review_team_idx" ON "seller_review" ("team_id","created_at");--> statement-breakpoint
ALTER TABLE "client_rating" ADD CONSTRAINT "client_rating_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client_rating" ADD CONSTRAINT "client_rating_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client_rating" ADD CONSTRAINT "client_rating_rated_by_id_user_id_fkey" FOREIGN KEY ("rated_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "portfolio_item" ADD CONSTRAINT "portfolio_item_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seller_review" ADD CONSTRAINT "seller_review_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seller_review" ADD CONSTRAINT "seller_review_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;