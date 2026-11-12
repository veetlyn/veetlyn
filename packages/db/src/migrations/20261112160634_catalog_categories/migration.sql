ALTER TABLE "services_department" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "department_id" text;--> statement-breakpoint
CREATE INDEX "services_department_parentId_idx" ON "services_department" ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_products_department" ON "products" ("department_id");--> statement-breakpoint
ALTER TABLE "services_department" ADD CONSTRAINT "services_department_parent_id_services_department_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "services_department"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_department_id_services_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "services_department"("id") ON DELETE SET NULL;