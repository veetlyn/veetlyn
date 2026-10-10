CREATE TABLE "download_grant" (
	"id" text PRIMARY KEY,
	"order_id" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp NOT NULL,
	"downloads_left" integer NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "download_grant_downloads_left_check" CHECK ("downloads_left" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"product_title" text NOT NULL,
	"buyer_email" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"platform_fee_minor" bigint,
	"paypal_fee_minor" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"paypal_order_id" text UNIQUE,
	"paypal_capture_id" text UNIQUE,
	"checkout_secret_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"refunded_at" timestamp,
	CONSTRAINT "orders_amount_positive" CHECK ("amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "paypal_webhook_event" ADD COLUMN "capture_id" text;--> statement-breakpoint
CREATE INDEX "download_grant_order_idx" ON "download_grant" ("order_id");--> statement-breakpoint
CREATE INDEX "orders_team_created_idx" ON "orders" ("team_id","created_at");--> statement-breakpoint
ALTER TABLE "download_grant" ADD CONSTRAINT "download_grant_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT;