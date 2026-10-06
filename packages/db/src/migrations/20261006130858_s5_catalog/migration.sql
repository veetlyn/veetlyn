CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"store_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"image_key" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"store_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"options" jsonb DEFAULT '[]' NOT NULL,
	"sku" text,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variants_price_check" CHECK ("price_minor" BETWEEN 0 AND 99999999),
	CONSTRAINT "variants_stock_check" CHECK ("stock" BETWEEN 0 AND 1000000)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"store_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"charge_tax" boolean DEFAULT true NOT NULL,
	"requires_shipping" boolean DEFAULT true NOT NULL,
	"channel3_product_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_status_check" CHECK ("status" IN ('draft', 'published'))
);
--> statement-breakpoint
CREATE INDEX "idx_images_product" ON "product_images" ("product_id");--> statement-breakpoint
CREATE INDEX "idx_variants_product" ON "product_variants" ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_variants_store_sku" ON "product_variants" ("store_id",lower("sku")) WHERE "sku" IS NOT NULL AND "sku" <> '';--> statement-breakpoint
CREATE INDEX "idx_products_store_status" ON "products" ("store_id","status");--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_store_id_team_id_fkey" FOREIGN KEY ("store_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_store_id_team_id_fkey" FOREIGN KEY ("store_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_team_id_fkey" FOREIGN KEY ("store_id") REFERENCES "team"("id") ON DELETE CASCADE;