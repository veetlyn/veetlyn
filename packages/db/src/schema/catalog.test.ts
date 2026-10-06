import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// URL comes from node:url because the global URL resolves to the Workers type, which fileURLToPath rejects
// (same pattern as packages/db/src/testing/global-setup.ts).
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

function catalogMigrationSql(): string {
  const folder = readdirSync(migrationsDir).find((entry) => entry.endsWith("_s5_catalog"));
  if (!folder) throw new Error("No *_s5_catalog migration found; run drizzle-kit generate --name s5_catalog");
  return readFileSync(join(migrationsDir, folder, "migration.sql"), "utf8");
}

describe("s5 catalog migration", () => {
  const sql = catalogMigrationSql();

  it("creates the three catalog tables, each scoped to a store", () => {
    expect(sql).toContain('CREATE TABLE "products"');
    expect(sql).toContain('CREATE TABLE "product_variants"');
    expect(sql).toContain('CREATE TABLE "product_images"');
    expect(sql.match(/"store_id" text NOT NULL/g)).toHaveLength(3);
  });

  it("enforces the status, price and stock checks", () => {
    expect(sql).toContain("\"status\" IN ('draft', 'published')");
    expect(sql).toContain('"price_minor" BETWEEN 0 AND 99999999');
    expect(sql).toContain('"stock" BETWEEN 0 AND 1000000');
  });

  it("creates the case-insensitive per-store SKU unique index", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "uq_variants_store_sku"[^;]*lower\("sku"\)/s);
  });
});
