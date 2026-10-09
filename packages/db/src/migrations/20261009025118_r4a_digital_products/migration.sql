ALTER TABLE "products" ADD COLUMN "kind" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_upload" ADD COLUMN "product_id" uuid;--> statement-breakpoint
CREATE INDEX "file_upload_productId_idx" ON "file_upload" ("product_id");--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_product_id_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_kind_check" CHECK ("kind" IN ('physical', 'digital'));