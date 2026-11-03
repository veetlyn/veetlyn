// Billing design §3: makes the stage's Polar catalog hold exactly one live product per plan choice, at its price.
// Prints the changes; writes only with --apply. Reads POLAR_ACCESS_TOKEN and POLAR_SERVER (sandbox | production).
//   bun packages/api/scripts/sync-polar-catalog.ts            # dry run
//   bun packages/api/scripts/sync-polar-catalog.ts --apply
import { BILLING_PRODUCTS } from "@jendal-workspace/core";

import { type CatalogChange, type CatalogProduct, createPolarClient, planCatalogChanges, PRODUCT_KEY_FIELD, polarInterval, productKeyOf } from "../src/billing/polar";

const token = process.env.POLAR_ACCESS_TOKEN;
const server = process.env.POLAR_SERVER;
if (!token || (server !== "sandbox" && server !== "production")) {
  console.error("Set POLAR_ACCESS_TOKEN and POLAR_SERVER (sandbox or production).");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const polar = createPolarClient({ accessToken: token, server });

async function liveCatalog(): Promise<CatalogProduct[]> {
  const products: CatalogProduct[] = [];
  for (let page = 1; ; page++) {
    const result = await polar.products.list({ is_archived: false, is_recurring: true, limit: 100, page });
    for (const p of result.items) {
      const fixed = p.prices.filter(
        (price) => !price.is_archived && "amount_type" in price && price.amount_type === "fixed" && price.price_currency === "usd",
      );
      const only = fixed.length === 1 ? fixed[0] : undefined;
      products.push({
        id: p.id,
        key: productKeyOf(p.metadata),
        isArchived: p.is_archived,
        recurringInterval: p.recurring_interval,
        priceCents: only && "price_amount" in only ? only.price_amount : null,
      });
    }
    if (page >= result.pagination.max_page) return products;
  }
}

function describe(change: CatalogChange): string {
  const cents = (n: number | null) => (n === null ? "?" : `$${(n / 100).toFixed(2)}`);
  if (change.kind === "create") return `create  ${change.product.key.padEnd(22)} ${cents(change.product.chargeCents)} / ${polarInterval(change.product)}`;
  if (change.kind === "replace") {
    return `replace ${change.product.key.padEnd(22)} ${cents(change.fromCents)} -> ${cents(change.product.chargeCents)} / ${polarInterval(change.product)}`;
  }
  return `archive ${change.key.padEnd(22)} (${change.id})`;
}

async function run(change: CatalogChange): Promise<void> {
  if (change.kind === "archive" || change.kind === "replace") {
    await polar.products.update(change.kind === "archive" ? change.id : change.archiveId, { is_archived: true });
  }
  if (change.kind === "create" || change.kind === "replace") {
    const { product } = change;
    await polar.products.create({
      name: product.name,
      recurring_interval: polarInterval(product),
      prices: [{ amount_type: "fixed", price_amount: product.chargeCents, price_currency: "usd" }],
      metadata: { [PRODUCT_KEY_FIELD]: product.key },
    });
  }
}

const changes = planCatalogChanges(await liveCatalog(), BILLING_PRODUCTS);
console.log(`Polar ${server}: ${changes.length} change(s)${apply ? "" : " (dry run; pass --apply to write)"}`);
for (const change of changes) {
  console.log(`  ${describe(change)}`);
  if (apply) await run(change);
}
if (apply && changes.length > 0) {
  const left = planCatalogChanges(await liveCatalog(), BILLING_PRODUCTS);
  console.log(left.length === 0 ? "Catalog matches the plans." : `Still ${left.length} change(s) to make; run again.`);
}
