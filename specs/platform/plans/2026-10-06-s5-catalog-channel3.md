# S5: Commerce Catalog with Channel3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant opens their store dashboard, manages a catalog (products with variants, prices in minor units, stock and images stored in R2), publishes and unpublishes products, starts a product from a retailer link or a photo through Channel3 (pre-filled draft, price never pre-filled), and sees a market price panel (low, median, high, example offers) next to each product.

**Architecture:** Pure catalog rules, Channel3 ports, prefill mapping and market price math go into `@jendal-workspace/core` (`src/catalog/`). A new `@jendal-workspace/channel3` package implements the `ProductSource` port with plain `fetch` and zod schemas pinned to the Channel3 OpenAPI docs. `packages/db` gains the `products`, `variants` and `product_images` tables plus repositories scoped by `TenantContext`. `packages/api` gains a store-scoped `catalog` tRPC router on the existing `storeProcedure`, with the Channel3 source, an R2 image store, a KV text cache and an image downloader injected through a new `catalog` field on the tRPC context (fakes in tests). `apps/server` wires the real adapters (R2 bucket, KV namespace, `fetch`), serves authenticated image uploads and public image reads, and takes the optional `CHANNEL3_API_KEY` secret. `apps/web` adds the catalog pages under `admin.<domain>/{storeSlug}/products`.

**Tech Stack:** Drizzle ORM 1.0.0-rc.4 (check constraints, unique indexes, transactions), tRPC 11.19 with `@trpc/tanstack-react-query`, Hono 4.13, zod 4.6, Cloudflare R2 and KV through Alchemy 2.0.0-beta.80 (Effect 4 `Config`), Channel3 REST API v1 (`https://api.trychannel3.com`), vinext 1.0.1, React 19, Tailwind 4, Vitest 5.

**Spec:** [`../2026-10-03-payleor-platform-design.md`](../2026-10-03-payleor-platform-design.md) §4.4, §4.7, §6.1 (product flags), §10 (admin catalog row), §11 (catalog tables), §14 and the combined schedule in [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) §12 (Oct 6–12 commerce row: "catalog admin with Channel3"); [`../2026-10-05-sponsor-integrations-design.md`](../2026-10-05-sponsor-integrations-design.md) §3 (Channel3), §8 (Channel3 tests).

**Builds on:** W1-D (branch `w1d-public-site-auth`, merged into `main` before this workstream's first task: `storeProcedure`, tRPC context with `auth` and `headers`, `packages/auth/src/testing.ts`, the store dashboard at `app/admin/[storeSlug]/`, web helpers in `apps/web/src/lib/`, the KV store cache pattern in `apps/server/src/tenant/`).

**Out of scope (later plans):**
- Store settings (support email, branding) and shipping rates: the combined schedule (services spec §12) puts them after this week; they need a store settings page this plan does not build. The catalog form already writes `charge_tax` and `requires_shipping` so the tax plan (platform spec §6.1, checkout weeks) has its product flags.
- Tax registrations, overrides and rate tables (platform spec §6.1): checkout-week work.
- Search re-indexing on catalog change (platform spec §10): belongs to the storefront/AI Search plan (research.md §12.2, one AI Search instance per store).
- Bulk import of up to 100 links on Render Workflows, `catalog_imports*` tables (sponsor spec §4): the Oct 13–19 week.
- Competitor price alerts, `price_watches`, `POST /webhooks/channel3` (sponsor spec §3.3): optional, only if time allows later.
- Storefront display of products and Cloudflare image transformations: the storefront plan.
- Deleting orphaned R2 objects when an image is replaced: noted in Decisions; no admin impact.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/s5-catalog` (a worktree of `/home/mouhamed/dev/repos/jendal/jendal-workspace`).

**Library sources:** read the pinned clones in `/home/mouhamed/dev/repos/jendal/refs/stack/` (read-only). Channel3 has no clone; its source is the online documentation cited in the facts below. Load the matching skill before each task:

| Task | Skills |
|---|---|
| 0, 14 | `using-git-worktrees` |
| 1–2, 4–6, 8, 10–11 | `vitest`, `test-driven-development` |
| 3–4 | `drizzle-orm` |
| 7, 9 | `workers-best-practices`, `effect-ts`, `varlock` |
| 11–12 | `migrate-to-vinext`, `better-writing`, `better-accessibility` |
| 13 | `verification-before-completion` |

---

## Facts this plan relies on

Each was checked against the cited source on 2026-10-06. Channel3 has no pinned clone in `refs/stack/`; its citations are its live documentation pages (fetched the same day). If code fails in a way that contradicts one of these, re-read the cited file or page before changing the design.

1. **Channel3 base URL and auth.** The API is served at `https://api.trychannel3.com` and every v1 endpoint takes the API key in the `x-api-key` header (the `servers` block and `securitySchemes: APIKeyHeader` in the OpenAPI YAML embedded in `https://docs.trychannel3.com/api-reference/v1/lookup-product.md`).
2. **`POST /v1/lookup`.** Body `LookupRequest`: `url` (required), `max_staleness_hours` (default 3). 200 answers `LookupResponse` = `{ product: Product }`. Documented errors: 401 (missing/invalid key), 402 (out of credits), 404 (product not found), 422 (URL is not a product page or is an unsupported domain), 500 (extraction failed), 504 (timeout) (same page as Fact 1).
3. **`POST /v1/image-search`.** Body `ImageSearchRequest`: exactly one of `image_url` or `base64_image` (base64 bytes *without* a data-URI prefix), `limit` (default 20, max 30), `segment` (`"AUTO"` segments and crops the main product). 400 when the `image_url` cannot be fetched, 422 when neither/both image fields are set (`https://docs.trychannel3.com/api-reference/v1/image-search.md`).
4. **`POST /v1/similar`.** Body `SimilarProductsRequest`: `product_id` (required, the canonical product ID), `limit` (default 20, max 30), `config` = `LocaleConfig` with optional `country`, `language`, `currency`. 404 when the product is unknown. Answers `SearchResponse` = `{ products: Product[], next_page_token }` (`https://docs.trychannel3.com/api-reference/v1/similar-products.md`).
5. **`POST /v1/search`.** Body `SearchRequest`: `query` (required unless an image or page token is given), `limit` (max 30), `config` = `SearchConfig`, which also carries `currency`. Answers `SearchResponse` (`https://docs.trychannel3.com/api-reference/v1/search.md`, `SearchRequest` and `SearchConfig` components).
6. **`GET /v1/products/{product_id}`.** Answers the bare `Product` schema (not wrapped), takes `currency` (and other locale fields) as query parameters, 404 for an unknown ID, and is free (no credit cost) (`https://docs.trychannel3.com/api-reference/v1/product-detail.md`; the per-method credit table in `https://docs.trychannel3.com/pricing.md` lists `/products` as "Free").
7. **The `Product` model.** Required: `id`, `title`. Optional/nullable: `description`, `category` (`{ slug, title }`), `variants` (`{ options: [{ name, values: [{ label, exists }] }], selected }`). Arrays: `brands` (`[{ id, name }]`), `images` (`[{ url, cleaned_url?, is_main_image, alt_text? }]`), `offers` (`[{ url, domain, price: { price, compare_at_price?, currency }, availability: "InStock" | "OutOfStock" }]`) (the `Product`, `ProductImage`, `ProductOffer`, `Variants`, `VariantOption`, `OptionValue` components in the lookup page of Fact 1).
8. **Prices and locales.** `Price.price` is a major-unit number with a `currency` code; supported currencies are USD, CAD, AUD, GBP, EUR, SEK, CZK, RON; when no locale is set the API defaults to `en`/`US`/`USD` (the `Price`/`CurrencyCode` components in the image-search page of Fact 3; `https://docs.trychannel3.com/guides/locale.md`).
9. **Caching guidance.** Product IDs are stable and safe to store; prices, availability, image URLs and offer URLs are unstable, and offer URLs are short-lived. Short-lived caches (hours) of presentational data are acceptable (`https://docs.trychannel3.com/guides/caching.md`). We therefore store only the Channel3 product ID on our products and never store or link offer URLs.
10. **Credits.** `/search`, `/lookup`, `/image-search` and `/similar` cost 1 credit per call; `/products`, `/brands`, `/websites`, `/categories` are free (`https://docs.trychannel3.com/pricing.md`). The hackathon key carries 20,000 credits with code `PAYPAL-HACKATHON-2026` (`specs/hackathon/sponsors.md`, Channel3 row).
11. **Alchemy R2.** `Cloudflare.R2.Bucket("ProductImages")` declares a bucket (`refs/stack/alchemy/website/src/content/docs/cloudflare/data/r2.mdx`, lines 15–22). Passing the bucket in a Worker's `env` maps it to an `r2_bucket` binding (`refs/stack/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerAsyncBindings.ts:561`), and `InferEnv` types it as `R2Bucket` (`…/Workers/InferEnv.ts:97`) — the same pattern the repo already uses for `STORE_CACHE: StoreCache` (KV).
12. **The `R2Bucket` binding type.** `put(key, value, options?)` accepts `httpMetadata.contentType`; `get(key)` returns `R2ObjectBody | null` with `arrayBuffer()`; `head(key)` returns `R2Object | null`; `R2Object.httpMetadata` holds the stored content type (`node_modules/@cloudflare/workers-types/index.d.ts:2493-2521` and `2533-2557` in the workspace).
13. **Drizzle 1.0.0-rc.4.** `check(name, sql)` builds a check constraint (`refs/stack/drizzle-orm/drizzle-orm/src/pg-core/checks.ts:30`); `index`/`uniqueIndex` builders at `pg-core/indexes.ts:298-302`; `jsonb(...).$type<T>()` types JSON columns (`column-builder.ts:299`); `sum()` returns `SQL<string | null>` while `min`/`max` on an integer column return `SQL<number | null>` and `count()` returns `SQL<number>` (`sql/functions/aggregate.ts:19-127`). Query failures through postgres-js are wrapped in `DrizzleQueryError` with the driver error as `cause` (`pg-core/async/session.ts:71`), and `postgres.PostgresError` carries `code` and `constraint_name` (`node_modules/postgres/types/index.d.ts:201-221`), which is how a SKU unique violation is recognized.
14. **tRPC input merging and query keys.** Chained `.input()` calls merge object schemas (later wins on conflicts), so procedures built on `storeProcedure` take `{ storeSlug, ...own }` (`refs/stack/trpc/www/docs/server/validators.md:42-46`). `trpc.<router>.<procedure>.queryKey(input)` produces keys for `queryClient.invalidateQueries`/`setQueryData` (`refs/stack/trpc/www/docs/client/tanstack-react-query/usage.mdx:83,285,373`).
15. **Hono bodies and wildcards.** `c.req.parseBody()`/`c.req.formData()` parse `multipart/form-data` and file fields arrive as `File` (`refs/stack/hono/src/request.ts:198-214,329-334`). A route registered as `/api/images/*` also matches deeper paths such as `/api/images/stores/s/images/x.png` (same wildcard semantics as the W1-D plan's Fact 10, `refs/stack/hono/src/router/common.case.test.ts:174-187`).
16. **Effect config and Alchemy secrets.** `Config.X("NAME").pipe(Config.withDefault(fallback))` uses the fallback when the variable is absent (`node_modules/effect/dist/Config.d.ts:648-692`; already used for `SMTP_PORT` in `packages/infra/alchemy.run.ts`). Alchemy deploys a `Redacted` env value as a `secret_text` binding (`refs/stack/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerAsyncBindings.ts:433-436`), and at runtime the binding is a plain string.
17. **zod 4.6 URL validation.** `z.url({ protocol: /^https?$/ })` accepts only HTTP(S) URLs (`node_modules/zod/v4/classic/schemas.d.ts:216`, params type in `node_modules/zod/v4/core/schemas.d.ts:180`).
18. **Repo facts.** Vitest runs with `testTimeout: 20_000`, `fileParallelism: false`, and a global setup that resets any `TEST_DATABASE_URL` database whose name contains `test` and applies every migration (`vitest.config.ts`, `packages/db/src/testing/global-setup.ts`). `storeProcedure` resolves the store, enforces the access rule and adds `store`, `role` and `tenant` (channel `admin`) to the context (`packages/api/src/store-procedure.ts:10-24`). `truncateAll` lists every table (`packages/db/src/testing/db.ts:13-19`). Migrations are generated with `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name <name>`; `drizzle.config.ts` loads `DATABASE_URL` through `varlock/auto-load` (`packages/db/drizzle.config.ts`, `packages/db/package.json`).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/core/src/catalog/product.ts` (+test) | Create | Types, limits, `validateProductDraft`, `publishProblems`, `SkuTakenError` |
| `packages/core/src/catalog/source.ts` | Create | `ProductSource` port, `SourceProduct`, `SourceError`, `SourceMatch` |
| `packages/core/src/catalog/prefill.ts` (+test) | Create | `ProductPrefill`, `buildProductPrefill` |
| `packages/core/src/catalog/market-price.ts` (+test) | Create | `summarizeMarketPrices`, `collectPricedOffers`, cache keys and TTLs |
| `packages/core/src/catalog/images.ts` (+test) | Create | Image type/size rules, R2 key helpers, `ProductImageStore`, `TextCache`, `ImageDownloader`, `encodeBase64` |
| `packages/core/src/catalog/testing.ts` | Create | Fakes for the four ports |
| `packages/core/src/index.ts` | Modify | Export the catalog modules |
| `packages/core/src/onboarding/setup-steps.ts` (+test) | Modify | `SetupProgress`, "Add your first product" step |
| `packages/channel3/**` | Create | `createChannel3Client` (fetch adapter), zod schemas, mapping |
| `packages/db/src/schema/catalog.ts`, `schema/index.ts` | Create, Modify | `products`, `variants`, `product_images` tables |
| `packages/db/src/migrations/<ts>_s5_catalog/` | Generate | Migration |
| `packages/db/src/testing/db.ts` | Modify | Truncate the catalog tables |
| `packages/db/src/repositories/catalog.ts` (+test) | Create | Store-scoped catalog repositories |
| `packages/api/src/catalog/service.ts` (+test) | Create | Catalog use-cases (save, publish, prefill, market price) |
| `packages/api/src/context.ts` | Modify | `CatalogServices` on the context |
| `packages/api/src/testing/catalog.ts` | Create | `createTestCatalogServices` |
| `packages/api/src/routers/catalog.ts` (+test) | Create | The `catalog` router |
| `packages/api/src/routers/index.ts`, `store.test.ts` | Modify | Mount the router; add `catalog` to test contexts (any file that builds a `Context`) |
| `apps/server/src/catalog/image-store.ts`, `text-cache.ts`, `image-downloader.ts` (+tests) | Create | R2, KV and fetch adapters |
| `apps/server/src/routes/catalog-images.ts` (+test) | Create | Image upload (authenticated) and image serving routes |
| `apps/server/src/services.ts`, `context.ts`, `index.ts`, `package.json`, `.env.schema` | Modify | Wiring, `CHANNEL3_API_KEY` |
| `packages/infra/alchemy.run.ts`, `.env.schema`, `turbo.json` | Modify | R2 bucket, KV namespace, secret, globalEnv |
| `apps/web/src/lib/money.ts`, `variant-options.ts`, `image-url.ts`, `product-form-state.ts` (+tests) | Create | Price and option parsing/formatting, image URLs, form state |
| `apps/web/src/components/catalog/product-form.tsx` | Create | Shared create/edit form |
| `apps/web/src/components/catalog/market-price-panel.tsx` | Create | Market price panel |
| `apps/web/src/app/admin/[storeSlug]/products/**` | Create | List, new (with "Start from a link or photo"), edit pages |
| `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`, `components/setup-checklist.tsx` | Modify | Catalog card, checklist step, internal step links |

---

## Task 0: Worktree and setup

**Files:** none (setup only)

- [ ] **Step 1: Confirm W1-D is on `main`**

```bash
git -C /home/mouhamed/dev/repos/jendal/jendal-workspace log --oneline -3 main
git -C /home/mouhamed/dev/repos/jendal/jendal-workspace show main:packages/email/package.json > /dev/null
```

Expected: no error. If `packages/email/package.json` does not exist on `main`, W1-D has not merged yet: stop and report to the controller; this plan's baseline (the `storeProcedure`, the auth testing helpers, the store dashboard) comes from W1-D.

- [ ] **Step 2: Create the worktree and install**

```bash
WS=s5-catalog; WT=/home/mouhamed/dev/repos/jendal/worktrees/$WS; SRC=/home/mouhamed/dev/repos/jendal/jendal-workspace
git -C $SRC worktree add $WT -b s5-catalog main
cp $SRC/apps/server/.env $WT/apps/server/.env
cp $SRC/packages/infra/.env $WT/packages/infra/.env
sed -E "s#(/jendal_test)([^/?]*)#\1_${WS}#" $SRC/.env.test.local > $WT/.env.test.local
docker exec jendal-pg createdb -U postgres "jendal_test_${WS}" 2>/dev/null || true
cd $WT && pnpm install --frozen-lockfile
```

- [ ] **Step 3: Verify the green baseline**

Run: `pnpm test && pnpm check-types`
Expected: all W1-A/W1-D tests pass; no type errors. Everything below happens in this worktree; there is no commit for this task.

---

## Task 1: Catalog rules, ports, prefill mapping and market price math in core

**Files:**
- Create: `packages/core/src/catalog/product.ts`, `source.ts`, `prefill.ts`, `market-price.ts`, `images.ts`, `testing.ts`
- Test: `packages/core/src/catalog/product.test.ts`, `prefill.test.ts`, `market-price.test.ts`, `images.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/catalog/product.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { MAX_IMAGES, MAX_VARIANTS, publishProblems, validateProductDraft, type ProductDraft } from "./product";

function validDraft(): ProductDraft {
  return {
    title: "Desk lamp",
    description: "A lamp.",
    brand: "Acme",
    category: "Lighting",
    chargeTax: true,
    requiresShipping: true,
    variants: [{ options: [], sku: "LAMP-1", priceMinor: 4200, stock: 8 }],
    images: [{ imageKey: "stores/store-1/images/a.png", alt: "" }],
  };
}

describe("validateProductDraft", () => {
  it("accepts a valid draft", () => {
    expect(validateProductDraft(validDraft())).toEqual([]);
  });

  it("requires a title of at most 200 characters", () => {
    expect(validateProductDraft({ ...validDraft(), title: "  " })).toEqual([
      { field: "title", message: "Add a title." },
    ]);
    expect(validateProductDraft({ ...validDraft(), title: "x".repeat(201) })).toEqual([
      { field: "title", message: "Keep the title under 200 characters." },
    ]);
  });

  it("caps the description, brand and category lengths", () => {
    expect(validateProductDraft({ ...validDraft(), description: "x".repeat(5001) })[0]?.message).toBe(
      "Keep the description under 5,000 characters.",
    );
    expect(validateProductDraft({ ...validDraft(), brand: "x".repeat(121) })[0]?.message).toBe(
      "Keep the brand under 120 characters.",
    );
    expect(validateProductDraft({ ...validDraft(), category: "x".repeat(121) })[0]?.message).toBe(
      "Keep the category under 120 characters.",
    );
  });

  it("requires between 1 and 100 variants", () => {
    expect(validateProductDraft({ ...validDraft(), variants: [] })).toEqual([
      { field: "variants", message: "Add at least one variant." },
    ]);
    const many = Array.from({ length: MAX_VARIANTS + 1 }, () => ({ options: [], sku: "", priceMinor: 1, stock: 0 }));
    expect(validateProductDraft({ ...validDraft(), variants: many })).toEqual([
      { field: "variants", message: "A product can have up to 100 variants." },
    ]);
  });

  it("validates option count and content", () => {
    const options = Array.from({ length: 6 }, (_, i) => ({ name: `Option ${i}`, value: "x" }));
    const draft = { ...validDraft(), variants: [{ options, sku: "", priceMinor: 1, stock: 0 }] };
    expect(validateProductDraft(draft)[0]?.message).toBe("A variant can have up to 5 options.");

    const empty = { ...validDraft(), variants: [{ options: [{ name: "", value: "Red" }], sku: "", priceMinor: 1, stock: 0 }] };
    expect(validateProductDraft(empty)[0]?.message).toBe("Every option needs a name and a value.");
  });

  it("rejects duplicate SKUs within the product and SKUs over 64 characters", () => {
    const variant = { options: [], sku: "DUP", priceMinor: 1, stock: 0 };
    expect(validateProductDraft({ ...validDraft(), variants: [variant, variant] })[0]?.message).toBe(
      'SKU "DUP" is used twice.',
    );
    const long = { ...validDraft(), variants: [{ options: [], sku: "x".repeat(65), priceMinor: 1, stock: 0 }] };
    expect(validateProductDraft(long)[0]?.message).toBe("Keep the SKU under 64 characters.");
  });

  it("validates price and stock", () => {
    const variant = { options: [], sku: "", priceMinor: -1, stock: 0 };
    expect(validateProductDraft({ ...validDraft(), variants: [variant] })[0]?.message).toBe("Enter a valid price.");
    const badStock = { options: [], sku: "", priceMinor: 1, stock: 1.5 };
    expect(validateProductDraft({ ...validDraft(), variants: [badStock] })[0]?.message).toBe(
      "Enter a valid stock quantity.",
    );
  });

  it("caps the image count and requires a key or source URL per image", () => {
    const images = Array.from({ length: MAX_IMAGES + 1 }, () => ({ imageKey: "stores/s1/images/a.png", alt: "" }));
    expect(validateProductDraft({ ...validDraft(), images })[0]?.message).toBe("A product can have up to 20 images.");
    expect(validateProductDraft({ ...validDraft(), images: [{ alt: "" }] })[0]?.message).toBe(
      "Add every image again before saving.",
    );
  });
});

describe("publishProblems", () => {
  it("requires a priced variant before publishing", () => {
    const free = { ...validDraft(), variants: [{ options: [], sku: "", priceMinor: 0, stock: 3 }] };
    expect(publishProblems(free)).toEqual([{ field: "variants", message: "Set a price above zero before publishing." }]);
    expect(publishProblems(validDraft())).toEqual([]);
  });

  it("reports draft problems first", () => {
    expect(publishProblems({ ...validDraft(), title: "" })[0]?.message).toBe("Add a title.");
  });
});
```

`packages/core/src/catalog/prefill.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildProductPrefill } from "./prefill";
import type { SourceProduct } from "./source";

function sourceProduct(overrides: Partial<SourceProduct> = {}): SourceProduct {
  return {
    id: "c3-1",
    title: "Trail Runner",
    description: "A shoe.",
    brands: ["Acme"],
    images: [
      { url: "https://cdn.example.com/back.jpg", cleanedUrl: null, altText: "Back view", isMain: false },
      { url: "https://cdn.example.com/front.jpg", cleanedUrl: "https://cdn.example.com/front-clean.png", altText: null, isMain: true },
    ],
    category: "Running shoes",
    variantOptions: [],
    offers: [],
    ...overrides,
  };
}

describe("buildProductPrefill", () => {
  it("maps the product and puts the main image first, without prices", () => {
    const prefill = buildProductPrefill(sourceProduct());

    expect(prefill).toEqual({
      channel3ProductId: "c3-1",
      title: "Trail Runner",
      description: "A shoe.",
      brand: "Acme",
      category: "Running shoes",
      variants: [{ options: [] }],
      images: [
        { sourceUrl: "https://cdn.example.com/front.jpg", alt: "Trail Runner" },
        { sourceUrl: "https://cdn.example.com/back.jpg", alt: "Back view" },
      ],
    });
  });

  it("builds one variant per existing option combination", () => {
    const prefill = buildProductPrefill(
      sourceProduct({
        variantOptions: [
          { name: "Color", values: [{ label: "Red", exists: true }, { label: "Blue", exists: true }] },
          { name: "Size", values: [{ label: "M", exists: true }, { label: "L", exists: false }] },
        ],
      }),
    );

    expect(prefill.variants).toEqual([
      { options: [{ name: "Color", value: "Red" }, { name: "Size", value: "M" }] },
      { options: [{ name: "Color", value: "Blue" }, { name: "Size", value: "M" }] },
    ]);
  });

  it("falls back to one empty variant when no option has existing values", () => {
    const prefill = buildProductPrefill(
      sourceProduct({ variantOptions: [{ name: "Color", values: [{ label: "Red", exists: false }] }] }),
    );

    expect(prefill.variants).toEqual([{ options: [] }]);
  });

  it("caps the variants at 100", () => {
    const prefill = buildProductPrefill(
      sourceProduct({
        variantOptions: [
          { name: "Color", values: Array.from({ length: 11 }, (_, i) => ({ label: `C${i}`, exists: true })) },
          { name: "Size", values: Array.from({ length: 11 }, (_, i) => ({ label: `S${i}`, exists: true })) },
        ],
      }),
    );

    expect(prefill.variants).toHaveLength(100);
  });

  it("handles missing optional fields", () => {
    const prefill = buildProductPrefill(sourceProduct({ description: null, brands: [], category: null, images: [] }));

    expect(prefill).toMatchObject({ description: "", brand: "", category: "", images: [] });
  });
});
```

`packages/core/src/catalog/market-price.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  MARKET_PRICE_REFRESH_TTL_SECONDS,
  MARKET_PRICE_TTL_SECONDS,
  collectPricedOffers,
  marketPriceCacheKey,
  marketPriceRefreshKey,
  summarizeMarketPrices,
  toMinorUnits,
} from "./market-price";
import type { SourceProduct } from "./source";

const at = new Date("2026-10-06T12:00:00Z");

function productWithOffers(offers: SourceProduct["offers"]): SourceProduct {
  return {
    id: "c3-1",
    title: "Lamp",
    description: null,
    brands: [],
    images: [],
    category: null,
    variantOptions: [],
    offers,
  };
}

describe("toMinorUnits", () => {
  it("converts major units to minor units", () => {
    expect(toMinorUnits(12)).toBe(1200);
    expect(toMinorUnits(12.5)).toBe(1250);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });
});

describe("collectPricedOffers", () => {
  it("keeps in-stock offers in the requested currency, mapped to minor units", () => {
    const offers = collectPricedOffers(
      [
        productWithOffers([
          { retailer: "shop-a.com", price: 10, currency: "USD", inStock: true },
          { retailer: "shop-b.com", price: 9.99, currency: "EUR", inStock: true },
          { retailer: "shop-c.com", price: 8, currency: "USD", inStock: false },
        ]),
        productWithOffers([{ retailer: "shop-d.com", price: 11.5, currency: "USD", inStock: true }]),
      ],
      "USD",
    );

    expect(offers).toEqual([
      { retailer: "shop-a.com", priceMinor: 1000 },
      { retailer: "shop-d.com", priceMinor: 1150 },
    ]);
  });
});

describe("summarizeMarketPrices", () => {
  it("answers no_offers for an empty set", () => {
    expect(summarizeMarketPrices([], "USD", at)).toEqual({
      status: "no_offers",
      currency: "USD",
      fetchedAt: "2026-10-06T12:00:00.000Z",
    });
  });

  it("computes low, median and high for an odd count", () => {
    const report = summarizeMarketPrices(
      [
        { retailer: "b.com", priceMinor: 300 },
        { retailer: "a.com", priceMinor: 100 },
        { retailer: "c.com", priceMinor: 200 },
      ],
      "USD",
      at,
    );

    expect(report).toEqual({
      status: "ok",
      currency: "USD",
      offerCount: 3,
      low: 100,
      median: 200,
      high: 300,
      examples: [
        { retailer: "a.com", priceMinor: 100 },
        { retailer: "c.com", priceMinor: 200 },
        { retailer: "b.com", priceMinor: 300 },
      ],
      fetchedAt: "2026-10-06T12:00:00.000Z",
    });
  });

  it("rounds the median half up for an even count and shows at most three examples", () => {
    const report = summarizeMarketPrices(
      [100, 201, 400, 800].map((priceMinor, i) => ({ retailer: `shop-${i}.com`, priceMinor })),
      "USD",
      at,
    );

    expect(report).toMatchObject({ status: "ok", low: 100, median: 301, high: 800, offerCount: 4 });
    expect(report.status === "ok" && report.examples).toHaveLength(3);
  });

  it("ignores offers without a positive price", () => {
    expect(
      summarizeMarketPrices([{ retailer: "a.com", priceMinor: 0 }], "USD", at).status,
    ).toBe("no_offers");
  });
});

describe("cache keys", () => {
  it("builds the report and refresh keys with the documented TTLs", () => {
    expect(marketPriceCacheKey("store-1", "prod-1")).toBe("market-price:store-1:prod-1");
    expect(marketPriceRefreshKey("store-1", "prod-1")).toBe("market-price:store-1:prod-1:refreshed");
    expect(MARKET_PRICE_TTL_SECONDS).toBe(86_400);
    expect(MARKET_PRICE_REFRESH_TTL_SECONDS).toBe(3_600);
  });
});
```

`packages/core/src/catalog/images.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { encodeBase64, imageExtensionFor, isProductImageKeyOf, newProductImageKey } from "./images";

describe("imageExtensionFor", () => {
  it("maps the supported types and rejects the rest", () => {
    expect(imageExtensionFor("image/jpeg")).toBe("jpg");
    expect(imageExtensionFor("image/png")).toBe("png");
    expect(imageExtensionFor("image/webp")).toBe("webp");
    expect(imageExtensionFor("image/gif")).toBe("gif");
    expect(imageExtensionFor("image/avif")).toBe("avif");
    expect(imageExtensionFor("image/svg+xml")).toBeNull();
    expect(imageExtensionFor(null)).toBeNull();
  });
});

describe("product image keys", () => {
  it("builds keys under the store's image prefix", () => {
    const key = newProductImageKey("store-1", "png");

    expect(key).toMatch(/^stores\/store-1\/images\/[0-9a-f-]{36}\.png$/);
    expect(isProductImageKeyOf("store-1", key)).toBe(true);
    expect(isProductImageKeyOf("store-2", key)).toBe(false);
    expect(isProductImageKeyOf("store-1", "other/key.png")).toBe(false);
  });
});

describe("encodeBase64", () => {
  it("encodes bytes without a data-URI prefix", () => {
    expect(encodeBase64(new TextEncoder().encode("hi").buffer as ArrayBuffer)).toBe("aGk=");
  });

  it("encodes buffers larger than one chunk", () => {
    const bytes = new Uint8Array(100_000).fill(97);
    expect(atob(encodeBase64(bytes.buffer as ArrayBuffer))).toHaveLength(100_000);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test packages/core/src/catalog`
Expected: FAIL, cannot resolve the `./product` (etc.) modules.

- [ ] **Step 3: Implement the product rules**

`packages/core/src/catalog/product.ts`:

```ts
export type ProductStatus = "draft" | "published";

export type VariantOption = { name: string; value: string };

export type VariantDraft = {
  id?: string;
  options: VariantOption[];
  sku: string;
  priceMinor: number;
  stock: number;
};

export type ProductImageDraft = {
  id?: string;
  imageKey?: string;
  sourceUrl?: string;
  alt: string;
};

export type ProductDraft = {
  title: string;
  description: string;
  brand: string;
  category: string;
  chargeTax: boolean;
  requiresShipping: boolean;
  variants: VariantDraft[];
  images: ProductImageDraft[];
};

export const MAX_VARIANTS = 100;
export const MAX_IMAGES = 20;
export const MAX_OPTIONS_PER_VARIANT = 5;
export const MAX_PRICE_MINOR = 99_999_999;
export const MAX_STOCK = 1_000_000;

export type ProductProblem = { field: string; message: string };

export class SkuTakenError extends Error {
  constructor() {
    super("That SKU is already in use in this store.");
    this.name = "SkuTakenError";
  }
}

function isIntegerIn(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

// The same rules run in the browser before submit and in the API as a backstop.
export function validateProductDraft(draft: ProductDraft): ProductProblem[] {
  const problems: ProductProblem[] = [];
  if (!draft.title.trim()) problems.push({ field: "title", message: "Add a title." });
  else if (draft.title.length > 200) problems.push({ field: "title", message: "Keep the title under 200 characters." });
  if (draft.description.length > 5_000) {
    problems.push({ field: "description", message: "Keep the description under 5,000 characters." });
  }
  if (draft.brand.length > 120) problems.push({ field: "brand", message: "Keep the brand under 120 characters." });
  if (draft.category.length > 120) {
    problems.push({ field: "category", message: "Keep the category under 120 characters." });
  }

  if (draft.variants.length === 0) problems.push({ field: "variants", message: "Add at least one variant." });
  if (draft.variants.length > MAX_VARIANTS) {
    problems.push({ field: "variants", message: `A product can have up to ${MAX_VARIANTS} variants.` });
  }
  const seenSkus = new Set<string>();
  for (const variant of draft.variants) {
    if (variant.options.length > MAX_OPTIONS_PER_VARIANT) {
      problems.push({ field: "variants", message: `A variant can have up to ${MAX_OPTIONS_PER_VARIANT} options.` });
    }
    for (const option of variant.options) {
      if (!option.name.trim() || !option.value.trim() || option.name.length > 60 || option.value.length > 120) {
        problems.push({ field: "variants", message: "Every option needs a name and a value." });
        break;
      }
    }
    const sku = variant.sku.trim();
    if (sku.length > 64) problems.push({ field: "variants", message: "Keep the SKU under 64 characters." });
    if (sku) {
      const key = sku.toLowerCase();
      if (seenSkus.has(key)) problems.push({ field: "variants", message: `SKU "${sku}" is used twice.` });
      seenSkus.add(key);
    }
    if (!isIntegerIn(variant.priceMinor, MAX_PRICE_MINOR)) {
      problems.push({ field: "variants", message: "Enter a valid price." });
    }
    if (!isIntegerIn(variant.stock, MAX_STOCK)) {
      problems.push({ field: "variants", message: "Enter a valid stock quantity." });
    }
  }

  if (draft.images.length > MAX_IMAGES) {
    problems.push({ field: "images", message: `A product can have up to ${MAX_IMAGES} images.` });
  }
  for (const image of draft.images) {
    if (!image.imageKey && !image.sourceUrl) {
      problems.push({ field: "images", message: "Add every image again before saving." });
      break;
    }
  }
  return problems;
}

// Publishing adds one rule on top of the draft rules: something must be for sale at a real price.
export function publishProblems(draft: ProductDraft): ProductProblem[] {
  const problems = validateProductDraft(draft);
  if (problems.length > 0) return problems;
  if (!draft.variants.some((variant) => variant.priceMinor > 0)) {
    return [{ field: "variants", message: "Set a price above zero before publishing." }];
  }
  return [];
}
```

- [ ] **Step 4: Implement the source port**

`packages/core/src/catalog/source.ts`:

```ts
// Port for an external product catalog (Channel3 in v1). Adapters live outside core.
export type SourceImage = { url: string; cleanedUrl: string | null; altText: string | null; isMain: boolean };

export type SourceOffer = { retailer: string; price: number; currency: string; inStock: boolean };

export type SourceVariantOption = { name: string; values: Array<{ label: string; exists: boolean }> };

export type SourceProduct = {
  id: string;
  title: string;
  description: string | null;
  brands: string[];
  images: SourceImage[];
  category: string | null;
  variantOptions: SourceVariantOption[];
  offers: SourceOffer[];
};

// "not_found" and "no_match" both mean the merchant gets an empty form; "unavailable" means try again later.
export type SourceErrorKind = "not_found" | "no_match" | "unavailable";

export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export interface ProductSource {
  lookupByUrl(url: string): Promise<SourceProduct>;
  searchByImage(input: { base64Image: string; limit: number }): Promise<SourceProduct[]>;
  getProduct(id: string): Promise<SourceProduct>;
  similarProducts(input: { productId: string; currency: string; limit: number }): Promise<SourceProduct[]>;
  searchProducts(input: { query: string; currency: string; limit: number }): Promise<SourceProduct[]>;
}

export type SourceMatch = { productId: string; title: string; brand: string | null; imageUrl: string | null };

export function toSourceMatch(product: SourceProduct): SourceMatch {
  return {
    productId: product.id,
    title: product.title,
    brand: product.brands[0] ?? null,
    imageUrl: product.images.find((image) => image.isMain)?.url ?? product.images[0]?.url ?? null,
  };
}
```

- [ ] **Step 5: Implement the prefill mapping**

`packages/core/src/catalog/prefill.ts`:

```ts
import { MAX_IMAGES, MAX_VARIANTS, type VariantOption } from "./product";
import type { SourceProduct } from "./source";

// Everything Channel3 can fill for the merchant. Prices and stock are never pre-filled (sponsor spec §3.1).
export type ProductPrefill = {
  channel3ProductId: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  variants: Array<{ options: VariantOption[] }>;
  images: Array<{ sourceUrl: string; alt: string }>;
};

function prefillVariants(product: SourceProduct): Array<{ options: VariantOption[] }> {
  const axes = product.variantOptions
    .map((option) => ({ name: option.name, values: option.values.filter((value) => value.exists) }))
    .filter((option) => option.values.length > 0);
  if (axes.length === 0) return [{ options: [] }];

  let combinations: VariantOption[][] = [[]];
  for (const axis of axes) {
    const next: VariantOption[][] = [];
    for (const combination of combinations) {
      for (const value of axis.values) {
        next.push([...combination, { name: axis.name, value: value.label }]);
      }
    }
    combinations = next;
    if (combinations.length > MAX_VARIANTS) break;
  }
  return combinations.slice(0, MAX_VARIANTS).map((options) => ({ options }));
}

export function buildProductPrefill(product: SourceProduct): ProductPrefill {
  const images = [...product.images].sort((a, b) => Number(b.isMain) - Number(a.isMain));
  return {
    channel3ProductId: product.id,
    title: product.title,
    description: product.description ?? "",
    brand: product.brands[0] ?? "",
    category: product.category ?? "",
    variants: prefillVariants(product),
    images: images.slice(0, MAX_IMAGES).map((image) => ({ sourceUrl: image.url, alt: image.altText ?? product.title })),
  };
}
```

- [ ] **Step 6: Implement the market price math**

`packages/core/src/catalog/market-price.ts`:

```ts
import type { SourceProduct } from "./source";

export type PricedOffer = { retailer: string; priceMinor: number };

export type MarketPriceReport =
  | {
      status: "ok";
      currency: string;
      offerCount: number;
      low: number;
      median: number;
      high: number;
      examples: PricedOffer[];
      fetchedAt: string;
    }
  | { status: "no_offers"; currency: string; fetchedAt: string };

// "unavailable" is added by the caller when the source cannot be reached or is not configured.
export type MarketPriceResult = MarketPriceReport | { status: "unavailable" };

// Sponsor spec §3.2: results are cached for 24 hours; "Refresh" bypasses the cache at most once an hour.
export const MARKET_PRICE_TTL_SECONDS = 86_400;
export const MARKET_PRICE_REFRESH_TTL_SECONDS = 3_600;

export function marketPriceCacheKey(storeId: string, productId: string): string {
  return `market-price:${storeId}:${productId}`;
}

export function marketPriceRefreshKey(storeId: string, productId: string): string {
  return `${marketPriceCacheKey(storeId, productId)}:refreshed`;
}

export function toMinorUnits(price: number): number {
  return Math.round(price * 100);
}

export function collectPricedOffers(products: readonly SourceProduct[], currency: string): PricedOffer[] {
  return products.flatMap((product) =>
    product.offers
      .filter((offer) => offer.inStock && offer.currency === currency)
      .map((offer) => ({ retailer: offer.retailer, priceMinor: toMinorUnits(offer.price) })),
  );
}

export function summarizeMarketPrices(
  offers: readonly PricedOffer[],
  currency: string,
  fetchedAt: Date,
): MarketPriceReport {
  const priced = offers.filter((offer) => offer.priceMinor > 0).sort((a, b) => a.priceMinor - b.priceMinor);
  const iso = fetchedAt.toISOString();
  if (priced.length === 0) return { status: "no_offers", currency, fetchedAt: iso };
  const prices = priced.map((offer) => offer.priceMinor);
  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 1 ? prices[middle]! : Math.round((prices[middle - 1]! + prices[middle]!) / 2);
  return {
    status: "ok",
    currency,
    offerCount: priced.length,
    low: prices[0]!,
    median,
    high: prices[prices.length - 1]!,
    examples: priced.slice(0, 3),
    fetchedAt: iso,
  };
}
```

- [ ] **Step 7: Implement the image helpers and ports**

`packages/core/src/catalog/images.ts`:

```ts
export const MAX_IMAGE_BYTES = 5_000_000;

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// SVG is excluded on purpose: it can carry scripts, and we serve these files back to browsers.
export function imageExtensionFor(contentType: string | null): string | null {
  return contentType ? (IMAGE_CONTENT_TYPES[contentType.toLowerCase()] ?? null) : null;
}

export function newProductImageKey(storeId: string, extension: string): string {
  return `stores/${storeId}/images/${crypto.randomUUID()}.${extension}`;
}

export function isProductImageKeyOf(storeId: string, key: string): boolean {
  return key.startsWith(`stores/${storeId}/images/`);
}

export type StoredImage = { bytes: ArrayBuffer; contentType: string };

export interface ProductImageStore {
  put(key: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredImage | null>;
  has(key: string): Promise<boolean>;
}

export interface ImageDownloader {
  download(url: string): Promise<StoredImage | null>;
}

export interface TextCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// Chunked because String.fromCharCode(...bytes) overflows the call stack on large images.
export function encodeBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
```

- [ ] **Step 8: Implement the test fakes**

`packages/core/src/catalog/testing.ts`:

```ts
import type { ImageDownloader, ProductImageStore, StoredImage, TextCache } from "./images";
import { SourceError, type ProductSource } from "./source";

export function createFakeProductSource(overrides: Partial<ProductSource> = {}): ProductSource & { calls: string[] } {
  const calls: string[] = [];
  const notFound = async (): Promise<never> => {
    throw new SourceError("not_found", "No match found");
  };
  return {
    calls,
    lookupByUrl: async (url) => {
      calls.push(`lookupByUrl:${url}`);
      return overrides.lookupByUrl ? overrides.lookupByUrl(url) : notFound();
    },
    searchByImage: async (input) => {
      calls.push("searchByImage");
      return overrides.searchByImage ? overrides.searchByImage(input) : [];
    },
    getProduct: async (id) => {
      calls.push(`getProduct:${id}`);
      return overrides.getProduct ? overrides.getProduct(id) : notFound();
    },
    similarProducts: async (input) => {
      calls.push(`similarProducts:${input.productId}`);
      return overrides.similarProducts ? overrides.similarProducts(input) : [];
    },
    searchProducts: async (input) => {
      calls.push(`searchProducts:${input.query}`);
      return overrides.searchProducts ? overrides.searchProducts(input) : [];
    },
  };
}

export function createFakeImageStore(): ProductImageStore & { objects: Map<string, StoredImage> } {
  const objects = new Map<string, StoredImage>();
  return {
    objects,
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async has(key) {
      return objects.has(key);
    },
  };
}

// A virtual clock so TTL behavior can be tested without waiting.
export function createFakeTextCache(): TextCache & { advanceTime(ms: number): void } {
  let now = 0;
  const entries = new Map<string, { value: string; expiresAt: number }>();
  return {
    advanceTime(ms) {
      now += ms;
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(key);
      }
    },
    async get(key) {
      return entries.get(key)?.value ?? null;
    },
    async put(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
    },
  };
}

export function createFakeImageDownloader(
  results: Record<string, StoredImage | null> = {},
): ImageDownloader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async download(url) {
      calls.push(url);
      if (url in results) return results[url] ?? null;
      return { bytes: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, contentType: "image/png" };
    },
  };
}
```

- [ ] **Step 9: Export the modules**

Append to `packages/core/src/index.ts`:

```ts
export * from "./catalog/images";
export * from "./catalog/market-price";
export * from "./catalog/prefill";
export * from "./catalog/product";
export * from "./catalog/source";
export * from "./catalog/testing";
```

- [ ] **Step 10: Run the tests and type check**

Run: `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types`
Expected: all pass, including the 24 new catalog tests; no type errors.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add catalog rules, source ports, prefill mapping and market price summaries" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 2: The Channel3 package

**Files:**
- Create: `packages/channel3/package.json`, `tsconfig.json`, `src/index.ts`, `src/schemas.ts`, `src/map.ts`, `src/client.ts`
- Test: `packages/channel3/src/client.test.ts`
- Modify: `pnpm-lock.yaml`

Channel3 is called only from the api Worker (sponsor spec §3). This is a plain `fetch` adapter behind the core `ProductSource` port — not `@channel3/sdk` — so the contract is pinned by zod schemas built from the OpenAPI docs (Facts 1–8) and testable without network access. The zod schemas validate only the fields we use; unknown fields are stripped, so new Channel3 fields never break us, while a changed shape turns into `SourceError("unavailable")`.

- [ ] **Step 1: Write the failing test**

`packages/channel3/src/client.test.ts`:

```ts
import { SourceError } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { CHANNEL3_BASE_URL, createChannel3Client } from "./client";

const productJson = {
  id: "c3-1",
  title: "Trail Runner",
  description: "A shoe.",
  brands: [{ id: "b1", name: "Acme" }],
  images: [
    { url: "https://cdn.example.com/front.jpg", cleaned_url: "https://cdn.example.com/front-clean.png", is_main_image: true, alt_text: "Front" },
  ],
  category: { slug: "running-shoes", title: "Running shoes", has_children: false },
  variants: {
    options: [
      { name: "Size", values: [{ label: "M", exists: true, available: null, thumbnail_url: null, product_id: null }] },
    ],
    selected: [],
  },
  offers: [
    {
      url: "https://shop.example.com/buy",
      domain: "shop.example.com",
      price: { price: 129.99, compare_at_price: 149.99, currency: "USD" },
      availability: "InStock",
      max_commission_rate: 0,
      condition: "new",
      dimensions: null,
    },
    {
      url: "https://other.example.com/buy",
      domain: "other.example.com",
      price: { price: 119, compare_at_price: null, currency: "USD" },
      availability: "OutOfStock",
      max_commission_rate: 0,
      condition: null,
      dimensions: null,
    },
  ],
  structured_attributes: {},
};

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("createChannel3Client", () => {
  it("posts the lookup with the API key and maps the product", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { product: productJson });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    const product = await client.lookupByUrl("https://shop.example.com/product/1");

    expect(calls).toEqual([
      {
        url: `${CHANNEL3_BASE_URL}/v1/lookup`,
        init: {
          method: "POST",
          headers: { "x-api-key": "test-key", "content-type": "application/json" },
          body: JSON.stringify({ url: "https://shop.example.com/product/1" }),
        },
      },
    ]);
    expect(product).toEqual({
      id: "c3-1",
      title: "Trail Runner",
      description: "A shoe.",
      brands: ["Acme"],
      images: [
        { url: "https://cdn.example.com/front.jpg", cleanedUrl: "https://cdn.example.com/front-clean.png", altText: "Front", isMain: true },
      ],
      category: "Running shoes",
      variantOptions: [{ name: "Size", values: [{ label: "M", exists: true }] }],
      offers: [
        { retailer: "shop.example.com", price: 129.99, currency: "USD", inStock: true },
        { retailer: "other.example.com", price: 119, currency: "USD", inStock: false },
      ],
    });
  });

  it.each([404, 422])("maps a %d lookup answer to not_found", async (status) => {
    const { fetchImpl } = fakeFetch(status, { detail: "Product not found" });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    await expect(client.lookupByUrl("https://example.com")).rejects.toMatchObject({
      name: "SourceError",
      kind: "not_found",
    });
  });

  it.each([401, 402, 500, 504])("maps a %d answer to unavailable", async (status) => {
    const { fetchImpl } = fakeFetch(status, { detail: "error" });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    await expect(client.lookupByUrl("https://example.com")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("maps network failures and unexpected shapes to unavailable", async () => {
    const throwing = (async () => {
      throw new Error("socket hangup");
    }) as typeof fetch;
    await expect(createChannel3Client({ apiKey: "k", fetch: throwing }).lookupByUrl("https://example.com")).rejects.toMatchObject(
      { kind: "unavailable" },
    );

    const { fetchImpl } = fakeFetch(200, { product: { title: "No id" } });
    await expect(
      createChannel3Client({ apiKey: "k", fetch: fetchImpl }).lookupByUrl("https://example.com"),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("searches by base64 image with a limit and AUTO segmentation", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { products: [productJson], next_page_token: null });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    const products = await client.searchByImage({ base64Image: "aGk=", limit: 10 });

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ base64_image: "aGk=", limit: 10, segment: "AUTO" });
    expect(calls[0]?.url).toBe(`${CHANNEL3_BASE_URL}/v1/image-search`);
    expect(products).toHaveLength(1);
    expect(products[0]?.id).toBe("c3-1");
  });

  it("gets a product by ID with a GET", async () => {
    const { fetchImpl, calls } = fakeFetch(200, productJson);
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    const product = await client.getProduct("c3-1");

    expect(calls[0]?.url).toBe(`${CHANNEL3_BASE_URL}/v1/products/c3-1`);
    expect(calls[0]?.init.method).toBe("GET");
    expect(product.title).toBe("Trail Runner");
  });

  it("finds similar products with the requested currency", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { products: [], next_page_token: null });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    await client.similarProducts({ productId: "c3-1", currency: "EUR", limit: 30 });

    expect(calls[0]?.url).toBe(`${CHANNEL3_BASE_URL}/v1/similar`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      product_id: "c3-1",
      limit: 30,
      config: { currency: "EUR" },
    });
  });

  it("searches by text with the requested currency", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { products: [], next_page_token: null });
    const client = createChannel3Client({ apiKey: "test-key", fetch: fetchImpl });

    await client.searchProducts({ query: "Acme Trail Runner", currency: "USD", limit: 30 });

    expect(calls[0]?.url).toBe(`${CHANNEL3_BASE_URL}/v1/search`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: "Acme Trail Runner",
      limit: 30,
      config: { currency: "USD" },
    });
  });

  it("throws a typed SourceError", async () => {
    const { fetchImpl } = fakeFetch(500, {});
    const client = createChannel3Client({ apiKey: "k", fetch: fetchImpl });

    await expect(client.lookupByUrl("https://example.com")).rejects.toBeInstanceOf(SourceError);
  });
});
```

Run: `pnpm test packages/channel3`
Expected: FAIL, cannot resolve `./client` (the workspace does not know the package yet either; that is fixed below).

- [ ] **Step 2: Create the package**

`packages/channel3/package.json`:

```json
{
  "name": "@jendal-workspace/channel3",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "scripts": {
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@jendal-workspace/core": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@jendal-workspace/config": "workspace:*",
    "typescript": "catalog:"
  }
}
```

`packages/channel3/tsconfig.json`:

```json
{
  "extends": "@jendal-workspace/config/tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src"]
}
```

Run: `pnpm install`
Expected: the lockfile gains the new workspace package.

- [ ] **Step 3: Implement the schemas**

`packages/channel3/src/schemas.ts` (field names follow the OpenAPI components of Facts 2–7):

```ts
import { z } from "zod";

const priceSchema = z.object({
  price: z.number(),
  compare_at_price: z.number().nullable().optional(),
  currency: z.string(),
});

const offerSchema = z.object({
  url: z.string(),
  domain: z.string(),
  price: priceSchema,
  availability: z.enum(["InStock", "OutOfStock"]).nullable(),
});

const imageSchema = z.object({
  url: z.string(),
  cleaned_url: z.string().nullable().optional(),
  is_main_image: z.boolean().optional(),
  alt_text: z.string().nullable().optional(),
});

const variantOptionSchema = z.object({
  name: z.string(),
  values: z.array(z.object({ label: z.string(), exists: z.boolean() })),
});

export const channel3ProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  brands: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  images: z.array(imageSchema).default([]),
  category: z.object({ slug: z.string(), title: z.string() }).nullable().optional(),
  variants: z.object({ options: z.array(variantOptionSchema) }).nullable().optional(),
  offers: z.array(offerSchema).default([]),
});

export const lookupResponseSchema = z.object({ product: channel3ProductSchema });

export const searchResponseSchema = z.object({ products: z.array(channel3ProductSchema) });
```

- [ ] **Step 4: Implement the mapping**

`packages/channel3/src/map.ts`:

```ts
import type { SourceProduct } from "@jendal-workspace/core";
import type { z } from "zod";

import type { channel3ProductSchema } from "./schemas";

type Channel3Product = z.infer<typeof channel3ProductSchema>;

export function toSourceProduct(product: Channel3Product): SourceProduct {
  return {
    id: product.id,
    title: product.title,
    description: product.description ?? null,
    brands: product.brands.map((brand) => brand.name),
    images: product.images.map((image) => ({
      url: image.url,
      cleanedUrl: image.cleaned_url ?? null,
      altText: image.alt_text ?? null,
      isMain: image.is_main_image ?? false,
    })),
    category: product.category?.title ?? null,
    variantOptions: (product.variants?.options ?? []).map((option) => ({
      name: option.name,
      values: option.values.map((value) => ({ label: value.label, exists: value.exists })),
    })),
    offers: product.offers.map((offer) => ({
      retailer: offer.domain,
      price: offer.price.price,
      currency: offer.price.currency,
      inStock: offer.availability !== "OutOfStock",
    })),
  };
}
```

- [ ] **Step 5: Implement the client**

`packages/channel3/src/client.ts`:

```ts
import { SourceError, type ProductSource } from "@jendal-workspace/core";
import type { z } from "zod";

import { toSourceProduct } from "./map";
import { channel3ProductSchema, lookupResponseSchema, searchResponseSchema } from "./schemas";

export const CHANNEL3_BASE_URL = "https://api.trychannel3.com";

export type Channel3Config = { apiKey: string; baseUrl?: string; fetch?: typeof fetch };

function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new SourceError("unavailable", "Channel3 returned an unexpected response shape");
  return result.data as z.infer<S>;
}

export function createChannel3Client(config: Channel3Config): ProductSource {
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = config.baseUrl ?? CHANNEL3_BASE_URL;

  async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          "x-api-key": config.apiKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SourceError("unavailable", "Channel3 could not be reached");
    }
    // 404 (unknown product) and 422 (not a product page / not a product image) both mean "no match".
    if (response.status === 404 || response.status === 422) {
      throw new SourceError("not_found", "No match found");
    }
    if (!response.ok) throw new SourceError("unavailable", `Channel3 answered ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new SourceError("unavailable", "Channel3 returned an unreadable response");
    }
  }

  return {
    async lookupByUrl(url) {
      const data = parseWith(lookupResponseSchema, await request("POST", "/v1/lookup", { url }));
      return toSourceProduct(data.product);
    },
    async searchByImage({ base64Image, limit }) {
      const data = parseWith(
        searchResponseSchema,
        await request("POST", "/v1/image-search", { base64_image: base64Image, limit, segment: "AUTO" }),
      );
      return data.products.map(toSourceProduct);
    },
    async getProduct(id) {
      const data = parseWith(channel3ProductSchema, await request("GET", `/v1/products/${encodeURIComponent(id)}`));
      return toSourceProduct(data);
    },
    async similarProducts({ productId, currency, limit }) {
      const data = parseWith(
        searchResponseSchema,
        await request("POST", "/v1/similar", { product_id: productId, limit, config: { currency } }),
      );
      return data.products.map(toSourceProduct);
    },
    async searchProducts({ query, currency, limit }) {
      const data = parseWith(
        searchResponseSchema,
        await request("POST", "/v1/search", { query, limit, config: { currency } }),
      );
      return data.products.map(toSourceProduct);
    },
  };
}
```

`packages/channel3/src/index.ts`:

```ts
export * from "./client";
export * from "./map";
export * from "./schemas";
```

- [ ] **Step 6: Run the tests and type check**

Run: `pnpm test packages/channel3 && pnpm -F @jendal-workspace/channel3 check-types`
Expected: the 9 client tests pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/channel3 pnpm-lock.yaml
git commit -m "feat(channel3): add the Channel3 product source client" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 3: Catalog schema and migration

**Files:**
- Create: `packages/db/src/schema/catalog.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/testing/db.ts`
- Create: `packages/db/src/migrations/<timestamp>_s5_catalog/migration.sql`, `packages/db/src/migrations/<timestamp>_s5_catalog/snapshot.json`

- [ ] **Step 1: Define the tables**

`packages/db/src/schema/catalog.ts`:

```ts
import type { VariantOption } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { team } from "./organization";

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A store is a Better Auth team, so store scoping is a FK to team.id (see packages/db/src/schema/organization.ts).
    storeId: text("store_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    brand: text("brand").notNull().default(""),
    category: text("category").notNull().default(""),
    // Tax and shipping behavior is defined by the services workstream; the catalog already records the flags.
    chargeTax: boolean("charge_tax").notNull().default(true),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    channel3ProductId: text("channel3_product_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_products_store_status").on(table.storeId, table.status),
    check("products_status_check", sql`${table.status} IN ('draft', 'published')`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: text("store_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    options: jsonb("options").$type<VariantOption[]>().notNull().default([]),
    sku: text("sku"),
    // Minor units (platform spec §3); the store currency arrives with store settings in a later workstream.
    priceMinor: integer("price_minor").notNull().default(0),
    stock: integer("stock").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_variants_product").on(table.productId),
    uniqueIndex("uq_variants_store_sku")
      .on(table.storeId, sql`lower(${table.sku})`)
      .where(sql`${table.sku} IS NOT NULL AND ${table.sku} <> ''`),
    check("variants_price_check", sql`${table.priceMinor} BETWEEN 0 AND 99999999`),
    check("variants_stock_check", sql`${table.stock} BETWEEN 0 AND 1000000`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: text("store_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    imageKey: text("image_key").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_images_product").on(table.productId)],
);
```

`defineRelations(schema)` in `packages/db/src/relations.ts` derives relations from these `.references()` declarations automatically, so `relations.ts` does not change.

- [ ] **Step 2: Register the tables and extend truncateAll**

Append to `packages/db/src/schema/index.ts`:

```ts
export * from "./catalog";
```

In `packages/db/src/testing/db.ts`, replace the `truncateAll` table list with (catalog children first, then parents, then the existing list):

```ts
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql.raw(
      'truncate table "product_images", "product_variants", "products", "rate_limit", "store_domains", "team_member", "team", "invitation", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
    ),
  );
}
```

- [ ] **Step 3: Generate the migration and guard it with a test**

Run: `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name s5_catalog`
Expected: `packages/db/src/migrations/<timestamp>_s5_catalog/migration.sql` and `snapshot.json` appear (this drizzle-kit version writes one folder per migration, no top-level journal). Inspect the SQL: three `CREATE TABLE` statements, the `products_status_check` constraint, the two `BETWEEN` checks, and a `CREATE UNIQUE INDEX "uq_variants_store_sku" ... lower("sku") ... WHERE`.

`packages/db/src/schema/catalog.test.ts`:

```ts
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
    expect(sql).toContain("'draft','published'");
    expect(sql).toContain('"price_minor" BETWEEN 0 AND 99999999');
    expect(sql).toContain('"stock" BETWEEN 0 AND 1000000');
  });

  it("creates the case-insensitive per-store SKU unique index", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "uq_variants_store_sku"[^;]*lower\("sku"\)/s);
  });
});
```

Run: `pnpm test packages/db/src/schema/catalog.test.ts`
Expected: PASS. If an assertion trips only on drizzle-kit's formatting (quoting, spacing), adjust the assertion to the generated text — but do not weaken the coverage: the three tables, both `BETWEEN` checks, the status check and the unique index must all appear in the SQL.

- [ ] **Step 4: Commit**

```bash
git add packages/db
git commit -m "feat(db): add catalog tables and migration" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 4: Catalog repositories

**Files:**
- Create: `packages/db/src/repositories/catalog.ts`
- Test: `packages/db/src/repositories/catalog.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/db/src/repositories/catalog.test.ts` (same test-database pattern as the api router tests):

```ts
import type { TenantContext } from "@jendal-workspace/core";
import { createTestDb, hasTestDatabase, seedOrganization, seedStore, truncateAll } from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  deleteImages,
  deleteVariants,
  getProduct,
  insertImages,
  insertProduct,
  insertVariants,
  listImages,
  listProducts,
  listVariants,
  setProductStatus,
  updateProduct,
  updateVariantStock,
} from "./catalog";

async function makeStore(db: ReturnType<typeof createTestDb>): Promise<TenantContext> {
  const { organizationId } = await seedOrganization(db);
  const store = await seedStore(db, { organizationId, slug: `shop-${crypto.randomUUID().slice(0, 8)}` });
  return {
    storeId: store.id,
    organizationId,
    slug: store.slug,
    paypalMerchantId: null,
    channel: "admin",
    environment: "sandbox",
  };
}

function otherTenant(tenant: TenantContext): TenantContext {
  return { ...tenant, storeId: "other-store" };
}

describe.skipIf(!hasTestDatabase)("catalog repositories", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  describe("products", () => {
    it("inserts a product and reads it back, scoped to the store", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });

      expect(await getProduct(db, tenant, product.id)).toMatchObject({
        id: product.id,
        title: "Lamp",
        status: "draft",
        chargeTax: true,
        requiresShipping: true,
      });
      expect(await getProduct(db, otherTenant(tenant), product.id)).toBeNull();
    });

    it("lists only the store's own products", async () => {
      const tenant = await makeStore(db);
      await insertProduct(db, tenant, { title: "A" });
      await insertProduct(db, tenant, { title: "B" });

      const rows = await listProducts(db, tenant);
      expect(rows.map((row) => row.title).sort()).toEqual(["A", "B"]);
      expect(await listProducts(db, otherTenant(tenant))).toEqual([]);
    });

    it("updates the fields it is given", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });

      const updated = await updateProduct(db, tenant, product.id, { title: "Big lamp", chargeTax: false });
      expect(updated).toMatchObject({ title: "Big lamp", chargeTax: false });
    });

    it("publishes with a timestamp and unpublishes back to draft", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });

      const published = await setProductStatus(db, tenant, product.id, "published");
      expect(published?.status).toBe("published");
      expect(published?.publishedAt).toBeInstanceOf(Date);

      const unpublished = await setProductStatus(db, tenant, product.id, "draft");
      expect(unpublished?.status).toBe("draft");
    });
  });

  describe("variants", () => {
    it("replaces a product's variants", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });
      await insertVariants(db, tenant, product.id, [
        { options: [{ name: "Color", value: "Red" }], sku: "LAMP-RED", priceMinor: 4200, stock: 3 },
      ]);

      await deleteVariants(db, tenant, product.id);
      await insertVariants(db, tenant, product.id, [{ options: [], sku: "LAMP-1", priceMinor: 4500, stock: 5 }]);

      const variants = await listVariants(db, tenant, product.id);
      expect(variants).toHaveLength(1);
      expect(variants[0]).toMatchObject({ sku: "LAMP-1", priceMinor: 4500, stock: 5 });
    });

    it("clamps stock at zero instead of going negative", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });
      const [variant] = await insertVariants(db, tenant, product.id, [
        { options: [], sku: "", priceMinor: 100, stock: 3 },
      ]);

      const updated = await updateVariantStock(db, tenant, variant!.id, -10);
      expect(updated?.stock).toBe(0);
    });

    it("enforces one SKU per store, case-insensitively, but allows it in another store", async () => {
      const tenant = await makeStore(db);
      const other = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });
      const otherProduct = await insertProduct(db, other, { title: "Lamp" });
      await insertVariants(db, tenant, product.id, [{ options: [], sku: "LAMP-1", priceMinor: 1, stock: 0 }]);

      // Drizzle wraps the postgres error; the 23505 code and constraint name live on the cause.
      const failure = await insertVariants(db, tenant, product.id, [
        { options: [], sku: "lamp-1", priceMinor: 1, stock: 0 },
      ]).catch((error: unknown) => error);
      expect(failure).toMatchObject({ cause: { code: "23505", constraint_name: "uq_variants_store_sku" } });

      const [otherVariant] = await insertVariants(db, other, otherProduct.id, [
        { options: [], sku: "lamp-1", priceMinor: 1, stock: 0 },
      ]);
      expect(otherVariant?.sku).toBe("lamp-1");
    });
  });

  describe("images", () => {
    it("replaces a product's images and keeps their order", async () => {
      const tenant = await makeStore(db);
      const product = await insertProduct(db, tenant, { title: "Lamp" });
      await insertImages(db, tenant, product.id, [
        { imageKey: `stores/${tenant.storeId}/images/a.png`, alt: "front" },
        { imageKey: `stores/${tenant.storeId}/images/b.png`, alt: "" },
      ]);

      await deleteImages(db, tenant, product.id);
      await insertImages(db, tenant, product.id, [
        { imageKey: `stores/${tenant.storeId}/images/c.png`, alt: "back" },
        { imageKey: `stores/${tenant.storeId}/images/d.png`, alt: "side" },
      ]);

      const images = await listImages(db, tenant, product.id);
      expect(images.map((image) => [image.alt, image.position])).toEqual([
        ["back", 0],
        ["side", 1],
      ]);
    });
  });
});
```

Run: `pnpm test packages/db/src/repositories/catalog.test.ts`
Expected: FAIL, cannot resolve `./catalog`.

- [ ] **Step 2: Implement the repositories**

`packages/db/src/repositories/catalog.ts`:

```ts
import type { TenantContext, VariantOption } from "@jendal-workspace/core";
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../index";
import { productImages, products, productVariants } from "../schema/catalog";

export type ProductRow = typeof products.$inferSelect;
export type VariantRow = typeof productVariants.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;

export type ProductFields = {
  title: string;
  description: string;
  brand: string;
  category: string;
  chargeTax: boolean;
  requiresShipping: boolean;
  channel3ProductId: string | null;
};

export type NewVariant = { options: VariantOption[]; sku: string; priceMinor: number; stock: number };
export type NewImage = { imageKey: string; alt: string };

export async function insertProduct(
  db: Database,
  tenant: TenantContext,
  fields: ProductFields,
): Promise<ProductRow> {
  const [row] = await db
    .insert(products)
    .values({ storeId: tenant.storeId, ...fields })
    .returning();
  if (!row) throw new Error("Insert into products returned no row");
  return row;
}

export async function getProduct(db: Database, tenant: TenantContext, id: string): Promise<ProductRow | null> {
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.storeId, tenant.storeId)))
    .limit(1);
  return row ?? null;
}

export async function listProducts(db: Database, tenant: TenantContext): Promise<ProductRow[]> {
  return db.select().from(products).where(eq(products.storeId, tenant.storeId)).orderBy(products.createdAt);
}

export async function updateProduct(
  db: Database,
  tenant: TenantContext,
  id: string,
  fields: Partial<ProductFields>,
): Promise<ProductRow | null> {
  const [row] = await db
    .update(products)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.storeId, tenant.storeId)))
    .returning();
  return row ?? null;
}

export async function setProductStatus(
  db: Database,
  tenant: TenantContext,
  id: string,
  status: "draft" | "published",
): Promise<ProductRow | null> {
  const [row] = await db
    .update(products)
    .set({ status, ...(status === "published" ? { publishedAt: new Date() } : {}), updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.storeId, tenant.storeId)))
    .returning();
  return row ?? null;
}

export async function listVariants(db: Database, tenant: TenantContext, productId: string): Promise<VariantRow[]> {
  return db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.storeId, tenant.storeId)))
    .orderBy(productVariants.createdAt);
}

export async function insertVariants(
  db: Database,
  tenant: TenantContext,
  productId: string,
  variants: NewVariant[],
): Promise<VariantRow[]> {
  if (variants.length === 0) return [];
  return db
    .insert(productVariants)
    .values(
      variants.map((variant) => ({
        storeId: tenant.storeId,
        productId,
        options: variant.options,
        sku: variant.sku.trim() || null,
        priceMinor: variant.priceMinor,
        stock: variant.stock,
      })),
    )
    .returning();
}

export async function deleteVariants(db: Database, tenant: TenantContext, productId: string): Promise<void> {
  await db
    .delete(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.storeId, tenant.storeId)));
}

// Stock never goes below zero; an oversell clamps to 0 (platform spec §6.1).
export async function updateVariantStock(
  db: Database,
  tenant: TenantContext,
  variantId: string,
  delta: number,
): Promise<VariantRow | null> {
  const [row] = await db
    .update(productVariants)
    .set({ stock: sql`greatest(0, ${productVariants.stock} + ${delta})`, updatedAt: new Date() })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, tenant.storeId)))
    .returning();
  return row ?? null;
}

export async function listImages(db: Database, tenant: TenantContext, productId: string): Promise<ProductImageRow[]> {
  return db
    .select()
    .from(productImages)
    .where(and(eq(productImages.productId, productId), eq(productImages.storeId, tenant.storeId)))
    .orderBy(productImages.position);
}

export async function insertImages(
  db: Database,
  tenant: TenantContext,
  productId: string,
  images: NewImage[],
): Promise<ProductImageRow[]> {
  if (images.length === 0) return [];
  return db
    .insert(productImages)
    .values(
      images.map((image, position) => ({
        storeId: tenant.storeId,
        productId,
        imageKey: image.imageKey,
        alt: image.alt,
        position,
      })),
    )
    .returning();
}

export async function deleteImages(db: Database, tenant: TenantContext, productId: string): Promise<void> {
  await db
    .delete(productImages)
    .where(and(eq(productImages.productId, productId), eq(productImages.storeId, tenant.storeId)));
}
```

- [ ] **Step 3: Run the tests and type check**

Run: `pnpm test packages/db && pnpm -F @jendal-workspace/db check-types`
Expected: all db tests pass, including the catalog suites; no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db
git commit -m "feat(db): add store-scoped catalog repositories" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 5: Catalog use-cases in the api package

**Files:**
- Create: `packages/api/src/catalog/service.ts`
- Test: `packages/api/src/catalog/service.test.ts`
- Create: `packages/api/src/testing/catalog.ts`

The use-cases sit in the api package (not core): they orchestrate the db repositories and the core ports. The tRPC router in Task 6 stays a thin adapter over them.

- [ ] **Step 1: Write the test helper**

`packages/api/src/testing/catalog.ts`:

```ts
import {
  createFakeImageDownloader,
  createFakeImageStore,
  createFakeProductSource,
  createFakeTextCache,
} from "@jendal-workspace/core";

import type { CatalogServices } from "../catalog/service";

export type { CatalogServices } from "../catalog/service";

// The default source is a fake that answers not_found; tests override the pieces they exercise.
export function createTestCatalogServices(overrides: Partial<CatalogServices> = {}): CatalogServices {
  return {
    source: createFakeProductSource(),
    images: createFakeImageStore(),
    imageDownloader: createFakeImageDownloader(),
    textCache: createFakeTextCache(),
    currency: "USD",
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/api/src/catalog/service.test.ts`:

```ts
import {
  SkuTakenError,
  SourceError,
  buildProductPrefill,
  createFakeImageDownloader,
  createFakeProductSource,
  type ProductDraft,
  type SourceProduct,
  type TenantContext,
} from "@jendal-workspace/core";
import { createTestDb, hasTestDatabase, seedOrganization, seedStore, truncateAll } from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestCatalogServices } from "../testing/catalog";
import {
  CatalogValidationError,
  createProduct,
  getMarketPrice,
  getProductDetail,
  listProductSummaries,
  prefillFromMatch,
  prefillFromPhoto,
  prefillFromUrl,
  publishProduct,
  unpublishProduct,
  updateProduct,
} from "./service";

const db = createTestDb();

async function makeTenant(): Promise<TenantContext> {
  const { organizationId } = await seedOrganization(db);
  const store = await seedStore(db, { organizationId, slug: `shop-${crypto.randomUUID().slice(0, 8)}` });
  return {
    storeId: store.id,
    organizationId,
    slug: store.slug,
    paypalMerchantId: null,
    channel: "admin",
    environment: "sandbox",
  };
}

function draft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    title: "Desk lamp",
    description: "",
    brand: "",
    category: "",
    chargeTax: true,
    requiresShipping: true,
    variants: [{ options: [], sku: "LAMP-1", priceMinor: 4200, stock: 5 }],
    images: [],
    ...overrides,
  };
}

function sourceProduct(overrides: Partial<SourceProduct> = {}): SourceProduct {
  return {
    id: "c3-1",
    title: "Trail Runner",
    description: "A shoe.",
    brands: ["Acme"],
    images: [],
    category: null,
    variantOptions: [],
    offers: [],
    ...overrides,
  };
}

describe.skipIf(!hasTestDatabase)("catalog service", () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  describe("createProduct", () => {
    it("stores the product with its variants", async () => {
      const tenant = await makeTenant();
      const detail = await createProduct(db, tenant, createTestCatalogServices(), draft());

      expect(detail.product).toMatchObject({ title: "Desk lamp", status: "draft" });
      expect(detail.variants).toHaveLength(1);
      expect(detail.variants[0]).toMatchObject({ sku: "LAMP-1", priceMinor: 4200, stock: 5 });
    });

    it("rejects an invalid draft with the core problems", async () => {
      const tenant = await makeTenant();
      await expect(
        createProduct(db, tenant, createTestCatalogServices(), draft({ title: "" })),
      ).rejects.toThrow(CatalogValidationError);
    });

    it("maps a duplicate SKU to SkuTakenError", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      await createProduct(db, tenant, services, draft());

      await expect(createProduct(db, tenant, services, draft())).rejects.toBeInstanceOf(SkuTakenError);
    });

    it("keeps uploaded image keys and downloads source-URL images into the image store", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const detail = await createProduct(
        db,
        tenant,
        services,
        draft({
          images: [
            { imageKey: `stores/${tenant.storeId}/images/uploaded.png`, alt: "mine" },
            { sourceUrl: "https://cdn.example.com/found.jpg", alt: "found" },
          ],
        }),
      );

      expect(detail.images.map((image) => [image.imageKey, image.alt])).toEqual([
        [`stores/${tenant.storeId}/images/uploaded.png`, "mine"],
        [expect.stringMatching(new RegExp(`^stores/${tenant.storeId}/images/[0-9a-f-]{36}\\.png$`)), "found"],
      ]);
      expect(services.images.objects.size).toBe(1);
    });

    it("drops an image whose download fails instead of failing the save", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices({
        imageDownloader: createFakeImageDownloader({ "https://cdn.example.com/broken.jpg": null }),
      });
      const detail = await createProduct(
        db,
        tenant,
        services,
        draft({ images: [{ sourceUrl: "https://cdn.example.com/broken.jpg", alt: "" }] }),
      );

      expect(detail.images).toEqual([]);
    });

    it("refuses an image key that belongs to another store", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const detail = await createProduct(
        db,
        tenant,
        services,
        draft({ images: [{ imageKey: "stores/someone-else/images/a.png", alt: "" }] }),
      );

      expect(detail.images).toEqual([]);
    });
  });

  describe("updateProduct", () => {
    it("replaces fields, variants and images", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const created = await createProduct(db, tenant, services, draft());

      const updated = await updateProduct(db, tenant, created.product.id, services, {
        ...draft({ title: "Floor lamp", variants: [{ options: [], sku: "FLOOR-1", priceMinor: 9900, stock: 2 }] }),
        channel3ProductId: "c3-9",
      });

      expect(updated?.product).toMatchObject({ title: "Floor lamp", channel3ProductId: "c3-9" });
      expect(updated?.variants[0]).toMatchObject({ sku: "FLOOR-1", priceMinor: 9900 });
    });

    it("returns null for a product outside the store", async () => {
      const tenant = await makeTenant();
      const created = await createProduct(db, tenant, createTestCatalogServices(), draft());
      const stranger = { ...tenant, storeId: "other-store" };

      expect(await updateProduct(db, stranger, created.product.id, createTestCatalogServices(), draft())).toBeNull();
    });
  });

  describe("publish and unpublish", () => {
    it("refuses to publish without a priced variant", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const created = await createProduct(
        db,
        tenant,
        services,
        draft({ variants: [{ options: [], sku: "", priceMinor: 0, stock: 1 }] }),
      );

      await expect(publishProduct(db, tenant, created.product.id, services)).rejects.toThrow(CatalogValidationError);
    });

    it("publishes a valid product and unpublishes it again", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      const created = await createProduct(db, tenant, services, draft());

      const published = await publishProduct(db, tenant, created.product.id, services);
      expect(published?.product.status).toBe("published");

      const unpublished = await unpublishProduct(db, tenant, created.product.id);
      expect(unpublished?.product.status).toBe("draft");
    });
  });

  describe("listProductSummaries", () => {
    it("summarizes price range, stock and image", async () => {
      const tenant = await makeTenant();
      const services = createTestCatalogServices();
      await createProduct(
        db,
        tenant,
        services,
        draft({
          images: [{ imageKey: `stores/${tenant.storeId}/images/a.png`, alt: "" }],
          variants: [
            { options: [], sku: "A", priceMinor: 100, stock: 2 },
            { options: [], sku: "B", priceMinor: 300, stock: 4 },
          ],
        }),
      );

      const [summary] = await listProductSummaries(db, tenant);
      expect(summary).toMatchObject({
        title: "Desk lamp",
        status: "draft",
        variantCount: 2,
        priceLow: 100,
        priceHigh: 300,
        totalStock: 6,
        imageKey: `stores/${tenant.storeId}/images/a.png`,
      });
    });
  });

  describe("prefillFromUrl", () => {
    it("maps the looked-up product into a prefill with search alternatives", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({
          lookupByUrl: async () => sourceProduct(),
          searchProducts: async () => [sourceProduct(), sourceProduct({ id: "c3-2", title: "Trail Runner 2" })],
        }),
      });

      const result = await prefillFromUrl(services, "https://shop.example.com/product/1");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.prefill).toEqual(buildProductPrefill(sourceProduct()));
      expect(result.alternatives).toEqual([
        { productId: "c3-2", title: "Trail Runner 2", brand: "Acme", imageUrl: null },
      ]);
    });

    it("answers no_match when the source finds nothing", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({
          lookupByUrl: async () => {
            throw new SourceError("not_found", "No match");
          },
        }),
      });

      expect(await prefillFromUrl(services, "https://example.com")).toEqual({ status: "no_match" });
    });

    it("answers unavailable when the source fails or is not configured", async () => {
      const failing = createTestCatalogServices({
        source: createFakeProductSource({
          lookupByUrl: async () => {
            throw new SourceError("unavailable", "Channel3 answered 500");
          },
        }),
      });
      expect(await prefillFromUrl(failing, "https://example.com")).toEqual({ status: "unavailable" });

      const unconfigured = createTestCatalogServices({ source: null });
      expect(await prefillFromUrl(unconfigured, "https://example.com")).toEqual({ status: "unavailable" });
    });

    it("still answers ok when the alternatives search fails", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({
          lookupByUrl: async () => sourceProduct(),
          searchProducts: async () => {
            throw new SourceError("unavailable", "boom");
          },
        }),
      });

      const result = await prefillFromUrl(services, "https://example.com/p/1");
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.alternatives).toEqual([]);
    });
  });

  describe("prefillFromPhoto and prefillFromMatch", () => {
    it("lists photo matches as compact choices", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({
          searchByImage: async () => [sourceProduct()],
        }),
      });

      expect(await prefillFromPhoto(services, "aGk=")).toEqual({
        status: "ok",
        matches: [{ productId: "c3-1", title: "Trail Runner", brand: "Acme", imageUrl: null }],
      });
    });

    it("answers no_match for an empty photo result", async () => {
      expect(await prefillFromPhoto(createTestCatalogServices(), "aGk=")).toEqual({ status: "no_match" });
    });

    it("builds a prefill from a chosen match", async () => {
      const services = createTestCatalogServices({
        source: createFakeProductSource({ getProduct: async () => sourceProduct() }),
      });

      const result = await prefillFromMatch(services, "c3-1");
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.prefill.channel3ProductId).toBe("c3-1");
    });
  });

  describe("getMarketPrice", () => {
    async function linkedProduct(services = createTestCatalogServices()) {
      const tenant = await makeTenant();
      const created = await createProduct(db, tenant, services, {
        ...draft(),
        channel3ProductId: "c3-1",
      });
      return { tenant, created };
    }

    it("summarizes similar-product offers and caches them per store and product", async () => {
      const source = createFakeProductSource({
        similarProducts: async () => [
          sourceProduct({
            offers: [
              { retailer: "a.com", price: 10, currency: "USD", inStock: true },
              { retailer: "b.com", price: 30, currency: "USD", inStock: true },
            ],
          }),
        ],
      });
      const services = createTestCatalogServices({ source });
      const { tenant, created } = await linkedProduct(services);

      const first = await getMarketPrice(db, tenant, services, created.product.id, false);
      expect(first).toMatchObject({ status: "ok", low: 1000, median: 2000, high: 3000, offerCount: 2 });

      const second = await getMarketPrice(db, tenant, services, created.product.id, false);
      expect(second).toEqual(first);
      expect(source.calls.filter((call) => call.startsWith("similarProducts"))).toHaveLength(1);
    });

    it("lets one explicit refresh bypass the cache, then enforces the hourly cap", async () => {
      const source = createFakeProductSource({ similarProducts: async () => [] });
      const services = createTestCatalogServices({ source });
      const { tenant, created } = await linkedProduct(services);

      await getMarketPrice(db, tenant, services, created.product.id, false);
      await getMarketPrice(db, tenant, services, created.product.id, true);
      expect(source.calls.filter((call) => call.startsWith("similarProducts"))).toHaveLength(2);

      await getMarketPrice(db, tenant, services, created.product.id, true);
      expect(source.calls.filter((call) => call.startsWith("similarProducts"))).toHaveLength(2);
    });

    it("falls back to a text search when the product has no Channel3 ID", async () => {
      const source = createFakeProductSource({
        searchProducts: async () => [
          sourceProduct({ offers: [{ retailer: "a.com", price: 12, currency: "USD", inStock: true }] }),
        ],
      });
      const services = createTestCatalogServices({ source });
      const tenant = await makeTenant();
      const created = await createProduct(db, tenant, services, { ...draft(), brand: "Acme" });

      const report = await getMarketPrice(db, tenant, services, created.product.id, false);
      expect(report).toMatchObject({ status: "ok", low: 1200 });
      expect(source.calls.some((call) => call.startsWith("searchProducts:Acme Desk lamp"))).toBe(true);
    });

    it("answers unavailable when the source is not configured, without hitting the cache", async () => {
      const services = createTestCatalogServices({ source: null });
      const { tenant, created } = await linkedProduct(services);

      expect(await getMarketPrice(db, tenant, services, created.product.id, false)).toEqual({ status: "unavailable" });
    });

    it("answers no_offers when nothing is priced", async () => {
      const services = createTestCatalogServices({ source: createFakeProductSource() });
      const { tenant, created } = await linkedProduct(services);

      expect(await getMarketPrice(db, tenant, services, created.product.id, false)).toMatchObject({
        status: "no_offers",
      });
    });

    it("returns null for a product outside the store", async () => {
      const services = createTestCatalogServices();
      const { tenant, created } = await linkedProduct(services);

      expect(await getMarketPrice(db, { ...tenant, storeId: "other-store" }, services, created.product.id, false)).toBeNull();
    });
  });

  describe("getProductDetail", () => {
    it("returns the product with variants and images", async () => {
      const tenant = await makeTenant();
      const created = await createProduct(db, tenant, createTestCatalogServices(), draft());

      const detail = await getProductDetail(db, tenant, created.product.id);
      expect(detail?.variants).toHaveLength(1);
      expect(await getProductDetail(db, { ...tenant, storeId: "other-store" }, created.product.id)).toBeNull();
    });
  });
});
```

Run: `pnpm test packages/api/src/catalog`
Expected: FAIL, cannot resolve `./service` / `../testing/catalog`.

- [ ] **Step 3: Implement the service**

`packages/api/src/catalog/service.ts`:

```ts
import {
  MARKET_PRICE_REFRESH_TTL_SECONDS,
  MARKET_PRICE_TTL_SECONDS,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  SkuTakenError,
  SourceError,
  buildProductPrefill,
  collectPricedOffers,
  imageExtensionFor,
  isProductImageKeyOf,
  marketPriceCacheKey,
  marketPriceRefreshKey,
  newProductImageKey,
  publishProblems,
  summarizeMarketPrices,
  toSourceMatch,
  validateProductDraft,
  type ImageDownloader,
  type MarketPriceReport,
  type MarketPriceResult,
  type PricedOffer,
  type ProductDraft,
  type ProductImageStore,
  type ProductPrefill,
  type ProductProblem,
  type ProductSource,
  type SourceMatch,
  type TenantContext,
  type TextCache,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  deleteImages,
  deleteVariants,
  getProduct,
  insertImages,
  insertProduct,
  insertVariants,
  listImages,
  listProducts,
  listVariants,
  setProductStatus,
  updateProduct as updateProductRecord,
  type NewImage,
  type ProductImageRow,
  type ProductRow,
  type VariantRow,
} from "@jendal-workspace/db/repositories/catalog";

// Everything the catalog use-cases need from the outside world. `source` is null when
// CHANNEL3_API_KEY is not configured. `currency` is hard-coded to "USD" until the store
// settings workstream lands a per-store currency.
export type CatalogServices = {
  source: ProductSource | null;
  images: ProductImageStore;
  imageDownloader: ImageDownloader;
  textCache: TextCache;
  currency: string;
};

export type ProductInput = ProductDraft & { channel3ProductId?: string | null };

export type ProductDetail = { product: ProductRow; variants: VariantRow[]; images: ProductImageRow[] };

export type ProductSummary = {
  id: string;
  title: string;
  status: "draft" | "published";
  variantCount: number;
  priceLow: number | null;
  priceHigh: number | null;
  totalStock: number;
  imageKey: string | null;
  updatedAt: Date;
};

export class CatalogValidationError extends Error {
  constructor(readonly problems: ProductProblem[]) {
    super(problems[0]?.message ?? "Check the product details.");
    this.name = "CatalogValidationError";
  }
}

// Drizzle wraps driver errors; postgres.js puts the SQLSTATE and constraint name on the cause.
function isSkuConflict(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (typeof cause !== "object" || cause === null) return false;
  const { code, constraint_name } = cause as { code?: string; constraint_name?: string };
  return code === "23505" && constraint_name === "uq_variants_store_sku";
}

async function withSkuMapping<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isSkuConflict(error)) throw new SkuTakenError();
    throw error;
  }
}

// Uploaded images keep their key (only if it belongs to this store); Channel3/source images
// are downloaded and copied into our bucket so the catalog never hotlinks them (sponsor spec §3.1).
async function resolveImages(
  tenant: TenantContext,
  services: CatalogServices,
  images: ProductInput["images"],
): Promise<NewImage[]> {
  const resolved: NewImage[] = [];
  for (const image of images.slice(0, MAX_IMAGES)) {
    if (image.imageKey && isProductImageKeyOf(tenant.storeId, image.imageKey)) {
      resolved.push({ imageKey: image.imageKey, alt: image.alt });
      continue;
    }
    if (!image.sourceUrl) continue;
    const downloaded = await services.imageDownloader.download(image.sourceUrl);
    const extension = downloaded ? imageExtensionFor(downloaded.contentType) : null;
    if (!downloaded || !extension || downloaded.bytes.byteLength > MAX_IMAGE_BYTES) continue;
    const key = newProductImageKey(tenant.storeId, extension);
    await services.images.put(key, downloaded.bytes, downloaded.contentType);
    resolved.push({ imageKey: key, alt: image.alt });
  }
  return resolved;
}

function assertValid(input: ProductInput): void {
  const problems = validateProductDraft(input);
  if (problems.length > 0) throw new CatalogValidationError(problems);
}

export async function createProduct(
  db: Database,
  tenant: TenantContext,
  services: CatalogServices,
  input: ProductInput,
): Promise<ProductDetail> {
  assertValid(input);
  const images = await resolveImages(tenant, services, input.images);
  return withSkuMapping(async () => {
    const product = await insertProduct(db, tenant, {
      title: input.title.trim(),
      description: input.description,
      brand: input.brand,
      category: input.category,
      chargeTax: input.chargeTax,
      requiresShipping: input.requiresShipping,
      channel3ProductId: input.channel3ProductId ?? null,
    });
    await insertVariants(db, tenant, product.id, input.variants);
    await insertImages(db, tenant, product.id, images);
    const detail = await getProductDetail(db, tenant, product.id);
    if (!detail) throw new Error("Product disappeared after insert");
    return detail;
  });
}

export async function updateProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
  services: CatalogServices,
  input: ProductInput,
): Promise<ProductDetail | null> {
  assertValid(input);
  const existing = await getProduct(db, tenant, productId);
  if (!existing) return null;
  const images = await resolveImages(tenant, services, input.images);
  return withSkuMapping(async () => {
    await updateProductRow(db, tenant, productId, input);
    await deleteVariants(db, tenant, productId);
    await insertVariants(db, tenant, productId, input.variants);
    await deleteImages(db, tenant, productId);
    await insertImages(db, tenant, productId, images);
    return getProductDetail(db, tenant, productId);
  });
}

async function updateProductRow(db: Database, tenant: TenantContext, productId: string, input: ProductInput) {
  return updateProductRecord(db, tenant, productId, {
    title: input.title.trim(),
    description: input.description,
    brand: input.brand,
    category: input.category,
    chargeTax: input.chargeTax,
    requiresShipping: input.requiresShipping,
    channel3ProductId: input.channel3ProductId ?? null,
  });
}

export async function getProductDetail(
  db: Database,
  tenant: TenantContext,
  productId: string,
): Promise<ProductDetail | null> {
  const product = await getProduct(db, tenant, productId);
  if (!product) return null;
  const [variants, images] = await Promise.all([
    listVariants(db, tenant, productId),
    listImages(db, tenant, productId),
  ]);
  return { product, variants, images };
}

// One query per product is fine at admin scale (a handful of rows per store).
export async function listProductSummaries(db: Database, tenant: TenantContext): Promise<ProductSummary[]> {
  const rows = await listProducts(db, tenant);
  const summaries: ProductSummary[] = [];
  for (const product of rows) {
    const [variants, images] = await Promise.all([
      listVariants(db, tenant, product.id),
      listImages(db, tenant, product.id),
    ]);
    const prices = variants.map((variant) => variant.priceMinor).filter((price) => price > 0);
    summaries.push({
      id: product.id,
      title: product.title,
      status: product.status as ProductSummary["status"],
      variantCount: variants.length,
      priceLow: prices.length > 0 ? Math.min(...prices) : null,
      priceHigh: prices.length > 0 ? Math.max(...prices) : null,
      totalStock: variants.reduce((total, variant) => total + variant.stock, 0),
      imageKey: images[0]?.imageKey ?? null,
      updatedAt: product.updatedAt,
    });
  }
  return summaries;
}

export async function publishProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
  // Kept for call-site uniformity with createProduct/updateProduct; unused, so it carries the
  // noUnusedParameters underscore prefix.
  _services: CatalogServices,
): Promise<ProductDetail | null> {
  const detail = await getProductDetail(db, tenant, productId);
  if (!detail) return null;
  const problems = publishProblems({
    title: detail.product.title,
    description: detail.product.description,
    brand: detail.product.brand,
    category: detail.product.category,
    chargeTax: detail.product.chargeTax,
    requiresShipping: detail.product.requiresShipping,
    variants: detail.variants,
    images: detail.images.map((image) => ({ imageKey: image.imageKey, alt: image.alt })),
  });
  if (problems.length > 0) throw new CatalogValidationError(problems);
  await setProductStatus(db, tenant, productId, "published");
  return getProductDetail(db, tenant, productId);
}

export async function unpublishProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
): Promise<ProductDetail | null> {
  const updated = await setProductStatus(db, tenant, productId, "draft");
  if (!updated) return null;
  return getProductDetail(db, tenant, productId);
}

export type PrefillResult =
  | { status: "ok"; prefill: ProductPrefill; alternatives: SourceMatch[] }
  | { status: "no_match" }
  | { status: "unavailable" };

export type MatchListResult =
  | { status: "ok"; matches: SourceMatch[] }
  | { status: "no_match" }
  | { status: "unavailable" };

export type SinglePrefillResult =
  | { status: "ok"; prefill: ProductPrefill }
  | { status: "no_match" }
  | { status: "unavailable" };

function sourceFailure(error: unknown): "no_match" | "unavailable" | null {
  if (error instanceof SourceError) return error.kind === "unavailable" ? "unavailable" : "no_match";
  return null;
}

async function findAlternatives(source: ProductSource, currency: string, productTitle: string, brand: string, excludeId: string): Promise<SourceMatch[]> {
  try {
    const query = [brand, productTitle].filter(Boolean).join(" ").trim();
    if (!query) return [];
    const results = await source.searchProducts({ query, currency, limit: 6 });
    return results.filter((result) => result.id !== excludeId).slice(0, 5).map(toSourceMatch);
  } catch {
    // Alternatives are a nice-to-have; a failed search must not fail the lookup.
    return [];
  }
}

export async function prefillFromUrl(services: CatalogServices, url: string): Promise<PrefillResult> {
  if (!services.source) return { status: "unavailable" };
  try {
    const product = await services.source.lookupByUrl(url);
    const alternatives = await findAlternatives(
      services.source,
      services.currency,
      product.title,
      product.brands[0] ?? "",
      product.id,
    );
    return { status: "ok", prefill: buildProductPrefill(product), alternatives };
  } catch (error) {
    const failure = sourceFailure(error);
    if (failure) return { status: failure };
    throw error;
  }
}

export async function prefillFromPhoto(services: CatalogServices, base64Image: string): Promise<MatchListResult> {
  if (!services.source) return { status: "unavailable" };
  try {
    const products = await services.source.searchByImage({ base64Image, limit: 10 });
    if (products.length === 0) return { status: "no_match" };
    return { status: "ok", matches: products.map(toSourceMatch) };
  } catch (error) {
    const failure = sourceFailure(error);
    if (failure) return { status: failure };
    throw error;
  }
}

export async function prefillFromMatch(services: CatalogServices, productId: string): Promise<SinglePrefillResult> {
  if (!services.source) return { status: "unavailable" };
  try {
    const product = await services.source.getProduct(productId);
    return { status: "ok", prefill: buildProductPrefill(product) };
  } catch (error) {
    const failure = sourceFailure(error);
    if (failure) return { status: failure };
    throw error;
  }
}

async function fetchMarketOffers(
  source: ProductSource,
  currency: string,
  product: ProductRow,
): Promise<PricedOffer[]> {
  if (product.channel3ProductId) {
    const similar = await source.similarProducts({ productId: product.channel3ProductId, currency, limit: 30 });
    return collectPricedOffers(similar, currency);
  }
  const query = [product.brand, product.title].filter(Boolean).join(" ").trim();
  if (!query) return [];
  const results = await source.searchProducts({ query, currency, limit: 30 });
  return collectPricedOffers(results, currency);
}

export async function getMarketPrice(
  db: Database,
  tenant: TenantContext,
  services: CatalogServices,
  productId: string,
  refresh: boolean,
): Promise<MarketPriceResult | null> {
  const product = await getProduct(db, tenant, productId);
  if (!product) return null;
  if (!services.source) return { status: "unavailable" };

  const cacheKey = marketPriceCacheKey(tenant.storeId, productId);
  const refreshKey = marketPriceRefreshKey(tenant.storeId, productId);
  const cached = await services.textCache.get(cacheKey);
  const canRefresh = (await services.textCache.get(refreshKey)) === null;
  if (cached && !(refresh && canRefresh)) return JSON.parse(cached) as MarketPriceReport;
  if (refresh && canRefresh) await services.textCache.put(refreshKey, "1", MARKET_PRICE_REFRESH_TTL_SECONDS);

  let report: MarketPriceReport;
  try {
    const offers = await fetchMarketOffers(services.source, services.currency, product);
    report = summarizeMarketPrices(offers, services.currency, new Date());
  } catch (error) {
    if (error instanceof SourceError) return { status: "unavailable" };
    throw error;
  }
  await services.textCache.put(cacheKey, JSON.stringify(report), MARKET_PRICE_TTL_SECONDS);
  return report;
}
```

Note: `publishProduct` keeps its `services` parameter (prefixed `_services`, since it is unused and the repo compiles with `noUnusedParameters`); the tests and the router pass it positionally, so nothing else changes.

- [ ] **Step 4: Run the tests and type check**

Run: `pnpm test packages/api/src/catalog && pnpm -F @jendal-workspace/api check-types`
Expected: all service tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api
git commit -m "feat(api): add catalog use-cases behind the source, image and cache ports" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 6: The `catalog` tRPC router

**Files:**
- Create: `packages/api/src/routers/catalog.ts`
- Test: `packages/api/src/routers/catalog.test.ts`
- Modify: `packages/api/src/context.ts`, `packages/api/src/routers/index.ts`, `packages/api/src/routers/store.test.ts` (context gains a field)

- [ ] **Step 1: Add `catalog` to the context**

`packages/api/src/context.ts` becomes:

```ts
import type { Auth, Session } from "@jendal-workspace/auth";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";

import type { CatalogServices } from "./catalog/service";

export type Context = {
  session: Session | null;
  db: Database;
  environment: TenantEnvironment;
  // Procedures that act through Better Auth (organizations, stores) pass the caller's headers on.
  auth: Auth;
  headers: Headers;
  // Ports the catalog procedures use; fakes in tests, the real adapters from the server app.
  catalog: CatalogServices;
};
```

- [ ] **Step 2: Write the failing router tests**

`packages/api/src/routers/catalog.test.ts`:

```ts
import { createTestAuth } from "@jendal-workspace/auth/testing";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedStore,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestCatalogServices, type CatalogServices } from "../testing/catalog";
import type { Context } from "../context";
import { appRouter } from "./index";

type SessionValue = NonNullable<Context["session"]>;

function makeSession(userId: string): SessionValue {
  const now = new Date();
  return {
    session: {
      id: "session-1",
      token: "token-1",
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Someone",
      email: `${userId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const productInput = {
  title: "Desk lamp",
  description: "",
  brand: "",
  category: "",
  chargeTax: true,
  requiresShipping: true,
  variants: [{ options: [], sku: "LAMP-1", priceMinor: 4200, stock: 5 }],
  images: [],
};

describe.skipIf(!hasTestDatabase)("catalog router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null, catalog: CatalogServices = createTestCatalogServices()) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog,
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  // An owner opens every store of their organization (core canOpenStore); the session is fabricated,
  // so tests never touch the auth flows.
  async function ownerWithStore(slug = "lamp-shop") {
    const { organizationId } = await seedOrganization(db);
    const userId = await addMember(db, { organizationId, role: "owner" });
    await seedStore(db, { organizationId, slug });
    return { userId, organizationId };
  }

  it("creates, reads and lists products inside the caller's store", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);

    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });
    expect(created.product).toMatchObject({ title: "Desk lamp", status: "draft" });

    const fetched = await caller.catalog.get({ storeSlug: "lamp-shop", id: created.product.id });
    expect(fetched.variants[0]).toMatchObject({ sku: "LAMP-1", priceMinor: 4200 });

    const list = await caller.catalog.list({ storeSlug: "Lamp-Shop" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Desk lamp", variantCount: 1, priceLow: 4200 });
  });

  it("rejects anonymous callers", async () => {
    await expect(callerFor(null).catalog.list({ storeSlug: "lamp-shop" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("hides another merchant's store", async () => {
    const { userId } = await ownerWithStore();
    const stranger = await seedUser(db, "Stranger");

    await expect(callerFor(stranger).catalog.list({ storeSlug: "lamp-shop" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Store not found.",
    });
    await callerFor(userId).catalog.create({ storeSlug: "lamp-shop", ...productInput });
    expect(await callerFor(userId).catalog.list({ storeSlug: "lamp-shop" })).toHaveLength(1);
  });

  it("maps a duplicate SKU to CONFLICT", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });

    await expect(caller.catalog.create({ storeSlug: "lamp-shop", ...productInput })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That SKU is already in use in this store.",
    });
  });

  it("maps validation failures to BAD_REQUEST with the first problem message", async () => {
    const { userId } = await ownerWithStore();

    await expect(
      callerFor(userId).catalog.create({ storeSlug: "lamp-shop", ...productInput, title: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Add a title." });
  });

  it("publishes only a priced product and unpublishes it", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });

    const published = await caller.catalog.publish({ storeSlug: "lamp-shop", id: created.product.id });
    expect(published.product.status).toBe("published");

    const unpublished = await caller.catalog.unpublish({ storeSlug: "lamp-shop", id: created.product.id });
    expect(unpublished.product.status).toBe("draft");

    const free = await caller.catalog.create({
      storeSlug: "lamp-shop",
      ...productInput,
      variants: [{ options: [], sku: "FREE", priceMinor: 0, stock: 1 }],
    });
    await expect(caller.catalog.publish({ storeSlug: "lamp-shop", id: free.product.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Set a price above zero before publishing.",
    });
  });

  it("updates a product and reports unknown products as NOT_FOUND", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });

    const updated = await caller.catalog.update({
      storeSlug: "lamp-shop",
      id: created.product.id,
      ...productInput,
      title: "Floor lamp",
      variants: [{ options: [], sku: "FLOOR-1", priceMinor: 9900, stock: 2 }],
    });
    expect(updated.product.title).toBe("Floor lamp");

    await expect(
      caller.catalog.get({ storeSlug: "lamp-shop", id: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers unavailable for Channel3 lookups when the source is not configured", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId, createTestCatalogServices({ source: null }));

    expect(await caller.catalog.lookupFromUrl({ storeSlug: "lamp-shop", url: "https://shop.example.com/p/1" })).toEqual(
      { status: "unavailable" },
    );
    expect(
      await caller.catalog.lookupFromPhoto({ storeSlug: "lamp-shop", base64Image: "aGk=" }),
    ).toEqual({ status: "unavailable" });
  });

  it("returns a market price result for the store's own product only", async () => {
    const { userId } = await ownerWithStore();
    const caller = callerFor(userId);
    const created = await caller.catalog.create({ storeSlug: "lamp-shop", ...productInput });

    const report = await caller.catalog.marketPrice({ storeSlug: "lamp-shop", productId: created.product.id });
    expect(report.status).toBe("no_offers");

    await expect(
      caller.catalog.marketPrice({ storeSlug: "lamp-shop", productId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

Run: `pnpm test packages/api/src/routers/catalog.test.ts`
Expected: FAIL — `appRouter` has no `catalog` and the context has no `catalog` field (type errors).

- [ ] **Step 3: Implement the router**

`packages/api/src/routers/catalog.ts`:

```ts
import { SkuTakenError } from "@jendal-workspace/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  CatalogValidationError,
  createProduct,
  getMarketPrice,
  getProductDetail,
  listProductSummaries,
  prefillFromMatch,
  prefillFromPhoto,
  prefillFromUrl,
  publishProduct,
  unpublishProduct,
  updateProduct,
} from "../catalog/service";
import { router } from "../index";
import { storeProcedure } from "../store-procedure";

// Transport-level bounds only; the real rules live in core's validateProductDraft so the
// browser and the API share them.
const variantSchema = z.object({
  options: z.array(z.object({ name: z.string().max(60), value: z.string().max(120) })).max(5),
  sku: z.string().max(64),
  priceMinor: z.number().int().min(0),
  stock: z.number().int().min(0),
});

const imageSchema = z.object({
  imageKey: z.string().max(300).optional(),
  sourceUrl: z.url({ protocol: /^https?$/ }).optional(),
  alt: z.string().max(300),
});

const productInputSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(5_000),
  brand: z.string().max(120),
  category: z.string().max(120),
  chargeTax: z.boolean(),
  requiresShipping: z.boolean(),
  channel3ProductId: z.string().max(120).nullish(),
  variants: z.array(variantSchema).max(100),
  images: z.array(imageSchema).max(20),
});

const idInput = z.object({ id: z.uuid() });

function rethrowAsTrpcError(error: unknown): never {
  if (error instanceof CatalogValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof SkuTakenError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw error;
}

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
}

export const catalogRouter = router({
  list: storeProcedure.query(({ ctx }) => listProductSummaries(ctx.db, ctx.tenant)),

  get: storeProcedure.input(idInput).query(async ({ ctx, input }) => {
    const detail = await getProductDetail(ctx.db, ctx.tenant, input.id);
    if (!detail) notFound();
    return detail;
  }),

  create: storeProcedure.input(productInputSchema).mutation(async ({ ctx, input }) => {
    const { storeSlug: _storeSlug, ...product } = input;
    try {
      return await createProduct(ctx.db, ctx.tenant, ctx.catalog, product);
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  update: storeProcedure.input(productInputSchema.merge(idInput)).mutation(async ({ ctx, input }) => {
    const { storeSlug: _storeSlug, id, ...product } = input;
    try {
      const detail = await updateProduct(ctx.db, ctx.tenant, id, ctx.catalog, product);
      if (!detail) notFound();
      return detail;
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  publish: storeProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const detail = await publishProduct(ctx.db, ctx.tenant, input.id, ctx.catalog);
      if (!detail) notFound();
      return detail;
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  unpublish: storeProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const detail = await unpublishProduct(ctx.db, ctx.tenant, input.id);
    if (!detail) notFound();
    return detail;
  }),

  // storeProcedure's input ({ storeSlug }) merges with each procedure's own input (tRPC input merging).
  lookupFromUrl: storeProcedure
    .input(z.object({ url: z.url({ protocol: /^https?$/ }) }))
    .mutation(({ ctx, input }) => prefillFromUrl(ctx.catalog, input.url)),

  lookupFromPhoto: storeProcedure
    .input(z.object({ base64Image: z.string().min(1).max(7_000_000) }))
    .mutation(({ ctx, input }) => prefillFromPhoto(ctx.catalog, input.base64Image)),

  prefillFromMatch: storeProcedure
    .input(z.object({ productId: z.string().min(1).max(120) }))
    .mutation(({ ctx, input }) => prefillFromMatch(ctx.catalog, input.productId)),

  marketPrice: storeProcedure
    .input(z.object({ productId: z.uuid(), refresh: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const result = await getMarketPrice(ctx.db, ctx.tenant, ctx.catalog, input.productId, input.refresh ?? false);
      if (!result) notFound();
      return result;
    }),
});
```

Register it in `packages/api/src/routers/index.ts`:

```ts
import { pingDatabase } from "@jendal-workspace/db/health";

import { publicProcedure, router } from "../index";
import { catalogRouter } from "./catalog";
import { storeRouter } from "./store";

export const appRouter = router({
  healthCheck: publicProcedure.query(async ({ ctx }) => {
    await pingDatabase(ctx.db);
    return "OK";
  }),
  store: storeRouter,
  catalog: catalogRouter,
});
export type AppRouter = typeof appRouter;
```

- [ ] **Step 4: Fix the existing callers of the context**

`Context` gained a required `catalog` field, so `packages/api/src/routers/store.test.ts` no longer type-checks. In its `callerFor` helper, add `catalog: createTestCatalogServices()` to the caller context (import the helper from `../testing/catalog`). Do the same in any other file that constructs a `Context` (search: `grep -rn "createCaller" packages/api/src`); the server app is wired in Task 9.

- [ ] **Step 5: Run the tests and type check**

Run: `pnpm test packages/api && pnpm -F @jendal-workspace/api check-types`
Expected: all api tests pass (store router included); no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api
git commit -m "feat(api): expose the catalog through a store-scoped tRPC router" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 7: R2 bucket, CHANNEL3_API_KEY and turbo env wiring

**Files:**
- Modify: `packages/infra/alchemy.run.ts`, `packages/infra/.env.schema`, `apps/server/.env.schema`, `turbo.json`

- [ ] **Step 1: Declare the env var**

Append to `apps/server/.env.schema`:

```
# Channel3 product catalog API key (https://docs.trychannel3.com). Optional: without it the
# "start from a link or photo" and market price features answer "unavailable".
# @required=false @type=string
CHANNEL3_API_KEY=
```

In `packages/infra/.env.schema`, extend the `@import` pick list on line 1 with `CHANNEL3_API_KEY` (add it at the end of the `pick=[...]` list, before the closing `]`).

- [ ] **Step 2: Declare the bucket and bind everything**

In `packages/infra/alchemy.run.ts`, next to `StoreCache`:

```ts
export const ProductImages = Cloudflare.R2.Bucket("ProductImages");
```

In the `server` Worker's `env:` block, add (keeping the existing entries):

```ts
    PRODUCT_IMAGES: ProductImages,
    CHANNEL3_API_KEY: Config.Redacted("CHANNEL3_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
```

`Config.withDefault` keeps the variable optional (Fact 16), so `pnpm dev` works before the key exists; Alchemy infers the Worker env entry as `string` and stores it as `secret_text` (Fact 16), and the bucket as `R2Bucket` (Fact 11). The empty default is why the client adapter treats `""` as "not configured" (Task 9).

- [ ] **Step 3: Let turbo hash the new variable**

In `turbo.json`, add `"CHANNEL3_API_KEY"` to `globalEnv`, keeping the list alphabetically sorted (after `"CI"`).

- [ ] **Step 4: Type check**

Run: `pnpm -F @jendal-workspace/infra check-types && pnpm -F server check-types`
Expected: pass. `apps/server/cloudflare-env.d.ts` infers from `ServerEnv`, so `ENV.PRODUCT_IMAGES: R2Bucket` and `ENV.CHANNEL3_API_KEY: string` appear without touching that file.

- [ ] **Step 5: Commit**

```bash
git add packages/infra turbo.json apps/server/.env.schema
git commit -m "feat(infra): add the product images bucket and optional CHANNEL3_API_KEY" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 8: Server adapters and image routes

**Files:**
- Create: `apps/server/src/catalog/image-store.ts`, `text-cache.ts`, `image-downloader.ts`
- Test: `apps/server/src/catalog/image-store.test.ts`, `text-cache.test.ts`, `image-downloader.test.ts`
- Create: `apps/server/src/routes/catalog-images.ts`
- Test: `apps/server/src/routes/catalog-images.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

`apps/server/src/catalog/image-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createR2ImageStore } from "./image-store";

function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  const bucket = {
    async put(key: string, bytes: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType ?? "application/octet-stream" });
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        httpMetadata: { contentType: object.contentType },
        arrayBuffer: async () => object.bytes,
      };
    },
    async head(key: string) {
      return objects.has(key) ? { key } : null;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

describe("createR2ImageStore", () => {
  it("stores bytes with their content type and reads them back", async () => {
    const { bucket } = fakeBucket();
    const store = createR2ImageStore(bucket);
    const bytes = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;

    await store.put("stores/s1/images/a.png", bytes, "image/png");

    expect(await store.has("stores/s1/images/a.png")).toBe(true);
    expect(await store.has("stores/s1/images/missing.png")).toBe(false);
    const stored = await store.get("stores/s1/images/a.png");
    expect(stored?.contentType).toBe("image/png");
    expect(new Uint8Array(stored!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get("stores/s1/images/missing.png")).toBeNull();
  });
});
```

`apps/server/src/catalog/text-cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createKvTextCache, type TextKv } from "./text-cache";

function fakeKv(): TextKv & { entries: Map<string, { value: string; ttl?: number }> } {
  const entries = new Map<string, { value: string; ttl?: number }>();
  return {
    entries,
    async get(key) {
      return entries.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      entries.set(key, { value, ttl: options?.expirationTtl });
    },
  };
}

describe("createKvTextCache", () => {
  it("round-trips strings and passes the TTL through as expirationTtl", async () => {
    const kv = fakeKv();
    const cache = createKvTextCache(kv);

    expect(await cache.get("k")).toBeNull();
    await cache.put("k", "v", 3600);

    expect(await cache.get("k")).toBe("v");
    expect(kv.entries.get("k")?.ttl).toBe(3600);
  });
});
```

`apps/server/src/catalog/image-downloader.test.ts`:

```ts
import { MAX_IMAGE_BYTES } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { createHttpImageDownloader } from "./image-downloader";

function fetchReturning(status: number, body: ArrayBuffer, contentType = "image/jpeg"): typeof fetch {
  return (async () => new Response(body, { status, headers: { "content-type": contentType } })) as typeof fetch;
}

describe("createHttpImageDownloader", () => {
  it("downloads an image over https", async () => {
    const bytes = new Uint8Array([9, 9]).buffer as ArrayBuffer;
    const downloader = createHttpImageDownloader(fetchReturning(200, bytes));

    const result = await downloader.download("https://cdn.example.com/a.jpg");
    expect(result?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(result!.bytes)).toEqual(new Uint8Array([9, 9]));
  });

  it("refuses non-https URLs without calling fetch", async () => {
    let called = false;
    const downloader = createHttpImageDownloader((async () => {
      called = true;
      return new Response();
    }) as typeof fetch);

    expect(await downloader.download("http://169.254.169.254/latest")).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null on http errors, network failures and oversized bodies", async () => {
    const downloader = createHttpImageDownloader(fetchReturning(404, new ArrayBuffer(1)));
    expect(await downloader.download("https://example.com/a.jpg")).toBeNull();

    const throwing = createHttpImageDownloader((async () => {
      throw new Error("network");
    }) as typeof fetch);
    expect(await throwing.download("https://example.com/a.jpg")).toBeNull();

    const big = createHttpImageDownloader(fetchReturning(200, new ArrayBuffer(MAX_IMAGE_BYTES + 1)));
    expect(await big.download("https://example.com/big.jpg")).toBeNull();
  });
});
```

Run: `pnpm test apps/server/src/catalog`
Expected: FAIL, cannot resolve the modules.

- [ ] **Step 2: Implement the adapters**

`apps/server/src/catalog/image-store.ts`:

```ts
import type { ProductImageStore } from "@jendal-workspace/core";

export function createR2ImageStore(bucket: R2Bucket): ProductImageStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        bytes: await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      };
    },
    async has(key) {
      return (await bucket.head(key)) !== null;
    },
  };
}
```

`apps/server/src/catalog/text-cache.ts`:

```ts
import type { TextCache } from "@jendal-workspace/core";

// The subset of KVNamespace this adapter uses; a real KVNamespace satisfies it.
// Kept separate from tenant/kv-store-cache.ts so the shared JsonKv interface does not change.
export interface TextKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function createKvTextCache(kv: TextKv): TextCache {
  return {
    get: (key) => kv.get(key),
    put: (key, value, ttlSeconds) => kv.put(key, value, { expirationTtl: ttlSeconds }),
  };
}
```

`apps/server/src/catalog/image-downloader.ts`:

```ts
import { MAX_IMAGE_BYTES, type ImageDownloader } from "@jendal-workspace/core";

const FETCH_TIMEOUT_MS = 10_000;

export function createHttpImageDownloader(fetchImpl: typeof fetch = fetch): ImageDownloader {
  return {
    async download(url) {
      // https only: the downloader runs server-side, so plain http would open SSRF to link-local targets.
      if (!url.startsWith("https://")) return null;
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
        return { bytes, contentType };
      } catch {
        return null;
      }
    },
  };
}
```

Run: `pnpm test apps/server/src/catalog`
Expected: PASS (4 tests).

- [ ] **Step 3: Write the failing route tests**

`apps/server/src/routes/catalog-images.test.ts`:

```ts
import type { Auth } from "@jendal-workspace/auth";
import { MAX_IMAGE_BYTES } from "@jendal-workspace/core";
import { createTestDb, hasTestDatabase, seedOrganization, seedStore, addMember, truncateAll } from "@jendal-workspace/db/testing/db";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../app-env";
import { createCatalogImagesRoute } from "./catalog-images";

function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  const bucket = {
    async put(key: string, bytes: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType ?? "application/octet-stream" });
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        httpMetadata: { contentType: object.contentType },
        arrayBuffer: async () => object.bytes,
      };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

function fakeAuth(userId: string | null): Auth {
  return {
    api: {
      getSession: async () => (userId ? { user: { id: userId } } : null),
    },
  } as unknown as Auth;
}

function uploadRequest(storeSlug: string, file?: File, contentType = "image/png") {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request(`http://localhost/api/catalog/images?storeSlug=${storeSlug}`, { method: "POST", body: form });
}

function pngFile(size = 4, type = "image/png") {
  return new File([new Uint8Array(size)], "photo.png", { type });
}

describe.skipIf(!hasTestDatabase)("catalog image routes", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function appFor(userId: string | null) {
    const { bucket, objects } = fakeBucket();
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("auth", fakeAuth(userId));
      await next();
    });
    app.route("/", createCatalogImagesRoute(bucket));
    return { app, objects };
  }

  async function ownerOfStore(slug = "lamp-shop") {
    const { organizationId } = await seedOrganization(db);
    const userId = await addMember(db, { organizationId, role: "owner" });
    const store = await seedStore(db, { organizationId, slug });
    return { userId, store };
  }

  it("uploads an image for a store the caller can open and serves it back", async () => {
    const { userId, store } = await ownerOfStore();
    const { app } = appFor(userId);

    const response = await app.request(uploadRequest("lamp-shop", pngFile()));
    expect(response.status).toBe(200);
    const { key } = (await response.json()) as { key: string };
    expect(key).toMatch(new RegExp(`^stores/${store.id}/images/[0-9a-f-]{36}\\.png$`));

    const served = await app.request(`http://localhost/api/catalog/images/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
  });

  it("rejects anonymous uploads", async () => {
    const { app } = appFor(null);
    const response = await app.request(uploadRequest("lamp-shop", pngFile()));
    expect(response.status).toBe(401);
  });

  it("rejects uploads for stores the caller cannot open", async () => {
    await ownerOfStore();
    const { app } = appFor("someone-else");
    const response = await app.request(uploadRequest("lamp-shop", pngFile()));
    expect(response.status).toBe(404);
  });

  it("rejects missing, unsupported and oversized files", async () => {
    const { userId } = await ownerOfStore();
    const { app } = appFor(userId);

    expect((await app.request(uploadRequest("lamp-shop"))).status).toBe(400);
    expect((await app.request(uploadRequest("lamp-shop", pngFile(4, "image/svg+xml")))).status).toBe(400);
    expect((await app.request(uploadRequest("lamp-shop", pngFile(MAX_IMAGE_BYTES + 1)))).status).toBe(400);
  });

  it("answers 404 for unknown keys and refuses keys outside the image prefix", async () => {
    const { app } = appFor(null);
    expect((await app.request("http://localhost/api/catalog/images/stores/s1/images/missing.png")).status).toBe(404);
    expect((await app.request("http://localhost/api/catalog/images/other/key.png")).status).toBe(404);
  });
});
```

Run: `pnpm test apps/server/src/routes/catalog-images.test.ts`
Expected: FAIL, cannot resolve `./catalog-images`.

- [ ] **Step 4: Implement the routes**

`apps/server/src/routes/catalog-images.ts`:

```ts
import { MAX_IMAGE_BYTES, canOpenStore, imageExtensionFor, newProductImageKey } from "@jendal-workspace/core";
import { findStoreAccess } from "@jendal-workspace/db/repositories/stores";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

const ROUTE_PREFIX = "/api/catalog/images/";

// Image uploads are multipart (tRPC inputs are JSON); the tRPC catalog router stores the keys
// this route returns. Downloads are public: the UUID in the key is the capability.
export function createCatalogImagesRoute(bucket: R2Bucket) {
  return new Hono<AppEnv>()
    .post("/api/catalog/images", async (c) => {
      const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const storeSlug = (c.req.query("storeSlug") ?? "").toLowerCase();
      const access = await findStoreAccess(c.get("db"), { slug: storeSlug, userId: session.user.id });
      if (!access || !canOpenStore(access)) return c.json({ error: "store_not_found" }, 404);

      const body = await c.req.parseBody();
      const file = body["file"];
      if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
      const extension = imageExtensionFor(file.type);
      if (!extension) return c.json({ error: "unsupported_type" }, 400);
      if (file.size > MAX_IMAGE_BYTES) return c.json({ error: "file_too_large" }, 400);

      const key = newProductImageKey(access.store.id, extension);
      await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      return c.json({ key });
    })
    .get("/api/catalog/images/*", async (c) => {
      const key = c.req.path.slice(ROUTE_PREFIX.length);
      if (!key.startsWith("stores/")) return c.json({ error: "not_found" }, 404);
      const object = await bucket.get(key);
      if (!object) return c.json({ error: "not_found" }, 404);
      const bytes = await object.arrayBuffer();
      return c.body(bytes, 200, {
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      });
    });
}
```

Run: `pnpm test apps/server`
Expected: all server tests pass (9 new).

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): add catalog image store, text cache, downloader and image routes" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 9: Wire the catalog services into the server

**Files:**
- Modify: `apps/server/src/services.ts`, `apps/server/src/context.ts`, `apps/server/src/index.ts`, `apps/server/package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Add the dependency**

In `apps/server/package.json`, add `"@jendal-workspace/channel3": "workspace:*"` to `dependencies` (alphabetical, between `@jendal-workspace/auth` and `@jendal-workspace/core`). Run: `pnpm install`

- [ ] **Step 2: Build the catalog services**

In `apps/server/src/services.ts`, add:

```ts
import { createChannel3Client } from "@jendal-workspace/channel3";
import type { CatalogServices } from "@jendal-workspace/api/catalog/service";

import { createHttpImageDownloader } from "./catalog/image-downloader";
import { createR2ImageStore } from "./catalog/image-store";
import { createKvTextCache } from "./catalog/text-cache";

// `source` is null while CHANNEL3_API_KEY is empty (Task 7 makes it optional), so the tRPC
// procedures answer "unavailable" instead of failing.
export function createCatalogServices(): CatalogServices {
  const apiKey = ENV.CHANNEL3_API_KEY;
  return {
    source: apiKey ? createChannel3Client({ apiKey }) : null,
    images: createR2ImageStore(ENV.PRODUCT_IMAGES),
    imageDownloader: createHttpImageDownloader(),
    textCache: createKvTextCache(ENV.STORE_CACHE),
    // Store currency lands with the store settings workstream; everything is USD until then.
    currency: "USD",
  };
}
```

- [ ] **Step 3: Pass them through the tRPC context**

In `apps/server/src/context.ts`, build the services once at module scope and include them:

```ts
import { createCatalogServices } from "./services";

const catalog = createCatalogServices();

export async function createContext(c: HonoContext<AppEnv>, environment: TenantEnvironment): Promise<ApiContext> {
  const auth = c.get("auth");
  const headers = c.req.raw.headers;
  const session = await auth.api.getSession({ headers });
  return { db: c.get("db"), session, environment, auth, headers, catalog };
}
```

(The services are stateless adapters over `ENV` bindings, so one instance per isolate is correct.)

- [ ] **Step 4: Mount the image routes**

In `apps/server/src/index.ts`:

```ts
import { createCatalogImagesRoute } from "./routes/catalog-images";

// after app.route("/", storeInfoRoute);
app.route("/", createCatalogImagesRoute(ENV.PRODUCT_IMAGES));
```

- [ ] **Step 5: Verify**

Run: `pnpm test && pnpm check-types`
Expected: everything passes; no type errors. (`ENV.PRODUCT_IMAGES` and `ENV.CHANNEL3_API_KEY` type-check because `cloudflare-env.d.ts` infers from the `server` Worker's env in `alchemy.run.ts` — Task 7.)

- [ ] **Step 6: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): wire the catalog services and CHANNEL3_API_KEY into the api worker" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 10: Web helpers — money, variant labels, image URLs

**Files:**
- Create: `apps/web/src/lib/money.ts`, `variant-options.ts`, `image-url.ts`
- Test: `apps/web/src/lib/money.test.ts`, `variant-options.test.ts`, `image-url.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatMinor, parsePriceInput } from "./money";

describe("formatMinor", () => {
  it("formats minor units in the given currency", () => {
    expect(formatMinor(4200, "USD")).toBe("$42.00");
    expect(formatMinor(0, "USD")).toBe("$0.00");
    expect(formatMinor(99, "USD")).toBe("$0.99");
  });
});

describe("parsePriceInput", () => {
  it("parses major units into minor units", () => {
    expect(parsePriceInput("42")).toBe(4200);
    expect(parsePriceInput("42.5")).toBe(4250);
    expect(parsePriceInput("42.55")).toBe(4255);
    expect(parsePriceInput(" 0.99 ")).toBe(99);
  });

  it("rejects non-prices without floating-point surprises", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
    expect(parsePriceInput("-1")).toBeNull();
    expect(parsePriceInput("1.999")).toBeNull();
    expect(parsePriceInput("1,5")).toBeNull();
  });
});
```

`apps/web/src/lib/variant-options.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { variantLabel } from "./variant-options";

describe("variantLabel", () => {
  it("labels an option-less variant as Default", () => {
    expect(variantLabel([])).toBe("Default");
  });

  it("joins options with slashes", () => {
    expect(
      variantLabel([
        { name: "Color", value: "Red" },
        { name: "Size", value: "M" },
      ]),
    ).toBe("Color: Red / Size: M");
  });
});
```

`apps/web/src/lib/image-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { productImageUrl } from "./image-url";

describe("productImageUrl", () => {
  it("points at the api worker's image route (forwarded by the web worker)", () => {
    expect(productImageUrl("stores/s1/images/a.png")).toBe("/api/catalog/images/stores/s1/images/a.png");
  });
});
```

Run: `pnpm test apps/web/src/lib/money.test.ts`
Expected: FAIL, cannot resolve `./money`.

- [ ] **Step 2: Implement the helpers**

`apps/web/src/lib/money.ts`:

```ts
export function formatMinor(priceMinor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(priceMinor / 100);
}

// String-split parsing on purpose: Number("12.55") * 100 is 1254.999… and Math.round hides typos.
export function parsePriceInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}
```

`apps/web/src/lib/variant-options.ts`:

```ts
import type { VariantOption } from "@jendal-workspace/core";

export function variantLabel(options: readonly VariantOption[]): string {
  if (options.length === 0) return "Default";
  return options.map((option) => `${option.name}: ${option.value}`).join(" / ");
}
```

`apps/web/src/lib/image-url.ts`:

```ts
// Served by the api worker (Task 8); apps/web/worker/index.ts forwards /api/* there.
export function productImageUrl(key: string): string {
  return `/api/catalog/images/${key}`;
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm test apps/web/src/lib`
Expected: all lib tests pass (old and new).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib
git commit -m "feat(web): add money, variant label and image URL helpers" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 11: Product form state, the product form and the market price panel

**Files:**
- Create: `apps/web/src/lib/product-form-state.ts`
- Test: `apps/web/src/lib/product-form-state.test.ts`
- Create: `apps/web/src/components/catalog/product-form.tsx`, `market-price-panel.tsx`

- [ ] **Step 1: Write the failing state tests**

`apps/web/src/lib/product-form-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { emptyProductForm, productFormToDraft, type ProductFormState } from "./product-form-state";

function formWith(overrides: Partial<ProductFormState>): ProductFormState {
  return { ...emptyProductForm(), ...overrides };
}

describe("emptyProductForm", () => {
  it("starts with one empty variant and no images", () => {
    const form = emptyProductForm();
    expect(form.variants).toEqual([{ options: [], sku: "", price: "", stock: "" }]);
    expect(form.images).toEqual([]);
    expect(form.chargeTax).toBe(true);
    expect(form.requiresShipping).toBe(true);
    expect(form.rightsConfirmed).toBe(false);
    expect(form.channel3ProductId).toBeNull();
  });
});

describe("productFormToDraft", () => {
  it("converts price and stock text into minor units and counts", () => {
    const draft = productFormToDraft(
      formWith({
        title: "Lamp",
        variants: [{ options: [{ name: "Color", value: "Red" }], sku: "LAMP-RED", price: "42.50", stock: "8" }],
      }),
    );

    expect(draft.variants).toEqual([
      { options: [{ name: "Color", value: "Red" }], sku: "LAMP-RED", priceMinor: 4250, stock: 8 },
    ]);
  });

  it("marks unparseable prices and stock as invalid so core validation rejects them", () => {
    const draft = productFormToDraft(
      formWith({ variants: [{ options: [], sku: "", price: "not a price", stock: "1.5" }] }),
    );

    expect(draft.variants[0]?.priceMinor).toBe(-1);
    expect(draft.variants[0]?.stock).toBe(-1);
  });

  it("drops the image preview URLs and keeps keys and source URLs", () => {
    const draft = productFormToDraft(
      formWith({
        images: [
          { imageKey: "stores/s1/images/a.png", alt: "", previewUrl: "/api/catalog/images/stores/s1/images/a.png" },
          { sourceUrl: "https://cdn.example.com/b.jpg", alt: "back", previewUrl: "https://cdn.example.com/b.jpg" },
        ],
      }),
    );

    expect(draft.images).toEqual([
      { imageKey: "stores/s1/images/a.png", alt: "" },
      { sourceUrl: "https://cdn.example.com/b.jpg", alt: "back" },
    ]);
  });

  it("needs the rights confirmation only for imported products", () => {
    expect(productFormToDraft(formWith({})).channel3ProductId).toBeNull();
    const imported = formWith({ channel3ProductId: "c3-1" });
    expect(imported.rightsConfirmed).toBe(false);
  });
});
```

Run: `pnpm test apps/web/src/lib/product-form-state.test.ts`
Expected: FAIL, cannot resolve the module.

- [ ] **Step 2: Implement the form state**

`apps/web/src/lib/product-form-state.ts`:

```ts
import type { ProductDraft, VariantOption } from "@jendal-workspace/core";

import { parsePriceInput } from "./money";

export type VariantFormState = { options: VariantOption[]; sku: string; price: string; stock: string };

export type ImageFormState = { imageKey?: string; sourceUrl?: string; alt: string; previewUrl: string };

export type ProductFormState = {
  title: string;
  description: string;
  brand: string;
  category: string;
  chargeTax: boolean;
  requiresShipping: boolean;
  channel3ProductId: string | null;
  variants: VariantFormState[];
  images: ImageFormState[];
  rightsConfirmed: boolean;
};

export function emptyProductForm(): ProductFormState {
  return {
    title: "",
    description: "",
    brand: "",
    category: "",
    chargeTax: true,
    requiresShipping: true,
    channel3ProductId: null,
    variants: [{ options: [], sku: "", price: "", stock: "" }],
    images: [],
    rightsConfirmed: false,
  };
}

export type ProductDraftInput = ProductDraft & { channel3ProductId: string | null };

export function productFormToDraft(form: ProductFormState): ProductDraftInput {
  return {
    title: form.title,
    description: form.description,
    brand: form.brand,
    category: form.category,
    chargeTax: form.chargeTax,
    requiresShipping: form.requiresShipping,
    channel3ProductId: form.channel3ProductId,
    variants: form.variants.map((variant) => ({
      options: variant.options,
      sku: variant.sku,
      priceMinor: parsePriceInput(variant.price) ?? -1,
      stock: /^-?\d+$/.test(variant.stock.trim()) ? Number(variant.stock.trim()) : -1,
    })),
    images: form.images.map((image) => ({ imageKey: image.imageKey, sourceUrl: image.sourceUrl, alt: image.alt })),
  };
}
```

Run: `pnpm test apps/web/src/lib/product-form-state.test.ts`
Expected: PASS.

- [ ] **Step 3: The product form**

`apps/web/src/components/catalog/product-form.tsx`:

```tsx
"use client";

import {
  MAX_IMAGES,
  MAX_VARIANTS,
  encodeBase64,
  validateProductDraft,
  type ProductPrefill,
  type SourceMatch,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";

import { productImageUrl } from "@/lib/image-url";
import {
  type ImageFormState,
  type ProductFormState,
  type VariantFormState,
  emptyProductForm,
  productFormToDraft,
} from "@/lib/product-form-state";
import { trpc } from "@/utils/trpc";

type Props = {
  storeSlug: string;
  productId?: string;
  initial?: ProductFormState;
  // The Channel3 start section shows only when creating (no productId).
};

async function uploadImage(storeSlug: string, file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/catalog/images?storeSlug=${encodeURIComponent(storeSlug)}`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error("The image upload failed. Try again.");
  return ((await response.json()) as { key: string }).key;
}

export default function ProductForm({ storeSlug, productId, initial }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<ProductFormState>(() => initial ?? emptyProductForm());
  const [link, setLink] = useState("");
  const [matches, setMatches] = useState<SourceMatch[]>([]);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const create = useMutation(trpc.catalog.create.mutationOptions());
  const update = useMutation(trpc.catalog.update.mutationOptions());
  const lookup = useMutation(trpc.catalog.lookupFromUrl.mutationOptions());
  const photoLookup = useMutation(trpc.catalog.lookupFromPhoto.mutationOptions());
  const prefillMatch = useMutation(trpc.catalog.prefillFromMatch.mutationOptions());

  function patch(patch: Partial<ProductFormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setSubmitMessage(null);
  }

  function patchVariant(index: number, patchVariant: Partial<VariantFormState>) {
    patch({ variants: form.variants.map((v, i) => (i === index ? { ...v, ...patchVariant } : v)) });
  }

  function applyPrefill(prefill: ProductPrefill) {
    patch({
      title: prefill.title,
      description: prefill.description,
      brand: prefill.brand,
      category: prefill.category,
      channel3ProductId: prefill.channel3ProductId,
      // Prices and stock are never pre-filled (sponsor spec §3.1); the merchant sets them.
      variants: prefill.variants.map((variant) => ({ options: variant.options, sku: "", price: "", stock: "" })),
      images: prefill.images.map((image) => ({ sourceUrl: image.sourceUrl, alt: image.alt, previewUrl: image.sourceUrl })),
      rightsConfirmed: false,
    });
    setMatches([]);
    setLookupMessage("Details imported. Set your prices and confirm the rights below.");
  }

  async function handleLookup() {
    setLookupMessage(null);
    const result = await lookup.mutateAsync({ storeSlug, url: link.trim() });
    if (result.status === "ok") {
      applyPrefill(result.prefill);
      if (result.alternatives.length > 0) setMatches(result.alternatives);
    } else if (result.status === "no_match") {
      setLookupMessage("We couldn't find a product for that link. Fill in the details yourself.");
    } else {
      setLookupMessage("Product lookup isn't available right now. Fill in the details yourself.");
    }
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLookupMessage(null);
    const result = await photoLookup.mutateAsync({ storeSlug, base64Image: encodeBase64(await file.arrayBuffer()) });
    if (result.status === "ok") {
      setMatches(result.matches);
      setLookupMessage("Pick the matching product to import its details.");
    } else if (result.status === "no_match") {
      setLookupMessage("We couldn't match that photo. Fill in the details yourself.");
    } else {
      setLookupMessage("Photo search isn't available right now. Fill in the details yourself.");
    }
  }

  async function handlePickMatch(productId: string) {
    const result = await prefillMatch.mutateAsync({ storeSlug, productId });
    if (result.status === "ok") applyPrefill(result.prefill);
    else setLookupMessage("That match could not be loaded. Fill in the details yourself.");
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    for (const file of files) {
      try {
        const key = await uploadImage(storeSlug, file);
        patch({ images: [...form.images, { imageKey: key, alt: "", previewUrl: productImageUrl(key) }] });
      } catch (error) {
        setSubmitMessage(error instanceof Error ? error.message : "The image upload failed. Try again.");
      }
    }
  }

  const needsRights = form.channel3ProductId !== null;
  const saving = create.isPending || update.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsRights && !form.rightsConfirmed) {
      setSubmitMessage("Confirm you have the right to use the imported details and images.");
      return;
    }
    const draft = productFormToDraft(form);
    const problems = validateProductDraft(draft);
    if (problems.length > 0) {
      setSubmitMessage(problems[0]!.message);
      return;
    }
    const onError = (error: { message: string }) => setSubmitMessage(error.message);
    const onSuccess = () => router.push(`/${storeSlug}/products`);
    if (productId) update.mutate({ storeSlug, id: productId, ...draft }, { onSuccess, onError });
    else create.mutate({ storeSlug, ...draft }, { onSuccess, onError });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-8">
      {!productId && (
        <section aria-labelledby="import-heading" className="grid gap-3 border p-4">
          <h2 id="import-heading" className="font-medium">
            Start from a link or a photo
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-64 flex-1 gap-1">
              <Label htmlFor="product-link">Product link</Label>
              <Input
                id="product-link"
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://shop.example.com/product/…"
              />
            </div>
            <Button type="button" variant="outline" onClick={handleLookup} disabled={!link.trim() || lookup.isPending}>
              {lookup.isPending ? "Looking up…" : "Look up"}
            </Button>
            <Button type="button" variant="outline" onClick={() => photoInput.current?.click()} disabled={photoLookup.isPending}>
              {photoLookup.isPending ? "Searching…" : "Use a photo"}
            </Button>
            <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          </div>
          {lookupMessage && <p className="text-sm text-muted-foreground">{lookupMessage}</p>}
          {matches.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {matches.map((match) => (
                <li key={match.productId} className="flex items-center gap-3 border p-2">
                  {match.imageUrl && <img src={match.imageUrl} alt="" className="size-12 object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{match.title}</p>
                    {match.brand && <p className="text-sm text-muted-foreground">{match.brand}</p>}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => handlePickMatch(match.productId)}>
                    Use this match
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="grid gap-4">
        <div className="grid gap-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={form.title} onChange={(e) => patch({ title: e.target.value })} maxLength={200} required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" value={form.description} onChange={(e) => patch({ description: e.target.value })} rows={4} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="brand">Brand</Label>
            <Input id="brand" value={form.brand} onChange={(e) => patch({ brand: e.target.value })} maxLength={120} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="category">Category</Label>
            <Input id="category" value={form.category} onChange={(e) => patch({ category: e.target.value })} maxLength={120} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.chargeTax} onCheckedChange={(checked) => patch({ chargeTax: checked === true })} />
          Charge tax on this product
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.requiresShipping}
            onCheckedChange={(checked) => patch({ requiresShipping: checked === true })}
          />
          This product needs shipping
        </label>
      </section>

      <section aria-labelledby="variants-heading" className="grid gap-3">
        <h2 id="variants-heading" className="font-medium">
          Variants
        </h2>
        {form.variants.map((variant, index) => (
          <div key={index} className="grid gap-2 border p-3 sm:grid-cols-[1fr_1fr_7rem_7rem_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor={`variant-options-${index}`}>Options</Label>
              <Input
                id={`variant-options-${index}`}
                value={variant.options.map((option) => `${option.name}: ${option.value}`).join(" / ")}
                onChange={(e) =>
                  patchVariant(index, {
                    options: e.target.value
                      .split("/")
                      .map((part) => part.trim())
                      .filter(Boolean)
                      .map((part) => {
                        const [name, ...rest] = part.split(":");
                        return { name: (name ?? "").trim(), value: rest.join(":").trim() };
                      }),
                  })
                }
                placeholder="Color: Red / Size: M"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`variant-sku-${index}`}>SKU</Label>
              <Input
                id={`variant-sku-${index}`}
                value={variant.sku}
                onChange={(e) => patchVariant(index, { sku: e.target.value })}
                maxLength={64}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`variant-price-${index}`}>Price (USD)</Label>
              <Input
                id={`variant-price-${index}`}
                value={variant.price}
                onChange={(e) => patchVariant(index, { price: e.target.value })}
                inputMode="decimal"
                placeholder="42.00"
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`variant-stock-${index}`}>Stock</Label>
              <Input
                id={`variant-stock-${index}`}
                value={variant.stock}
                onChange={(e) => patchVariant(index, { stock: e.target.value })}
                inputMode="numeric"
                placeholder="0"
                required
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => patch({ variants: form.variants.filter((_, i) => i !== index) })}
              disabled={form.variants.length <= 1}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={form.variants.length >= MAX_VARIANTS}
          onClick={() => patch({ variants: [...form.variants, { options: [], sku: "", price: "", stock: "" }] })}
        >
          Add variant
        </Button>
      </section>

      <section aria-labelledby="images-heading" className="grid gap-3">
        <h2 id="images-heading" className="font-medium">
          Images
        </h2>
        {form.images.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {form.images.map((image: ImageFormState, index: number) => (
              <li key={`${image.previewUrl}-${index}`} className="grid gap-1">
                <img src={image.previewUrl} alt={image.alt} className="aspect-square w-full border object-cover" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ images: form.images.filter((_, i) => i !== index) })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            multiple
            onChange={handleUpload}
            disabled={form.images.length >= MAX_IMAGES}
          />
          <p className="mt-1 text-sm text-muted-foreground">Up to {MAX_IMAGES} images, 5 MB each.</p>
        </div>
      </section>

      {needsRights && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.rightsConfirmed}
            onCheckedChange={(checked) => patch({ rightsConfirmed: checked === true })}
          />
          I have the right to use the imported product details and images.
        </label>
      )}

      {submitMessage && (
        <p role="alert" className="text-sm text-destructive">
          {submitMessage}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : productId ? "Save changes" : "Create product"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/${storeSlug}/products`)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

Two behaviors to note: the edit page hides the import section (`!productId`), and pre-filled `sourceUrl` images preview by hotlinking in the admin only — on save the api downloads and stores its own copy (Task 5), so the catalog never serves a hotlink (sponsor spec §3.1).

- [ ] **Step 4: The market price panel**

`apps/web/src/components/catalog/market-price-panel.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { formatMinor } from "@/lib/money";
import { queryClient, trpc } from "@/utils/trpc";

export default function MarketPricePanel({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  const input = { storeSlug, productId };
  const query = useQuery({ ...trpc.catalog.marketPrice.queryOptions(input), retry: false });
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const fresh = await queryClient.fetchQuery(trpc.catalog.marketPrice.queryOptions({ ...input, refresh: true }));
      // Write the fresh report into the non-refresh cache entry the panel reads.
      queryClient.setQueryData(trpc.catalog.marketPrice.queryKey(input), fresh);
    } finally {
      setRefreshing(false);
    }
  }

  const report = query.data;
  return (
    <section aria-labelledby="market-price-heading" className="grid gap-2 border p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="market-price-heading" className="font-medium">
          Market prices
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={refreshing || query.isPending}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {query.isPending && <p className="text-sm text-muted-foreground">Loading market prices…</p>}
      {query.isError && <p className="text-sm text-muted-foreground">Market prices couldn't be loaded. Try Refresh.</p>}
      {report?.status === "unavailable" && (
        <p className="text-sm text-muted-foreground">Market prices are unavailable right now.</p>
      )}
      {report?.status === "no_offers" && (
        <p className="text-sm text-muted-foreground">No market offers found for this product yet.</p>
      )}
      {report?.status === "ok" && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Low</dt>
              <dd>{formatMinor(report.low, report.currency)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Typical</dt>
              <dd>{formatMinor(report.median, report.currency)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">High</dt>
              <dd>{formatMinor(report.high, report.currency)}</dd>
            </div>
          </dl>
          <ul className="text-sm text-muted-foreground">
            {report.examples.map((offer) => (
              <li key={offer.retailer}>
                {offer.retailer}: {formatMinor(offer.priceMinor, report.currency)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {report.offerCount} offers, checked {new Date(report.fetchedAt).toLocaleString()}.
          </p>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Type check**

Run: `pnpm -F web check-types`
Expected: pass. (The repo's `pnpm -F web build` is known broken from W1-D execution experience, recorded in the W1-D plan's "Changes made during execution" notes — never use it; `check-types` and `test` are the gates.)

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add the product form with Channel3 import and the market price panel" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 12: Catalog pages, dashboard card and setup step

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/products/page.tsx`, `products-list.tsx`, `new/page.tsx`, `new/new-product.tsx`, `[productId]/page.tsx`, `[productId]/edit-product.tsx`
- Modify: `packages/core/src/onboarding/setup-steps.ts`, `packages/core/src/onboarding/setup-steps.test.ts`, `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`

- [ ] **Step 1: Add the "first product" setup step (core, TDD)**

Rewrite `packages/core/src/onboarding/setup-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { countDone, setupSteps } from "./setup-steps";

const links = { storefrontUrl: "https://acme.payleor.site", productsUrl: "/acme/products" };

describe("setupSteps", () => {
  it("starts a new store with only the first step done", () => {
    const steps = setupSteps({ status: "draft", paypalMerchantId: null }, links, { productCount: 0 });

    expect(steps).toEqual([
      { id: "create-store", label: "Create your store", done: true },
      { id: "add-product", label: "Add your first product", done: false, href: "/acme/products" },
      { id: "connect-paypal", label: "Connect PayPal", done: false },
      { id: "visit-storefront", label: "Visit your storefront", done: false, href: "https://acme.payleor.site" },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("marks products done once the store has one, PayPal once a merchant ID is stored, the storefront once live", () => {
    const steps = setupSteps({ status: "active", paypalMerchantId: "MERCHANT1" }, links, { productCount: 2 });

    expect(steps.map((s) => s.done)).toEqual([true, true, true, true]);
    expect(countDone(steps)).toBe(4);
  });
});
```

Run: `pnpm test packages/core/src/onboarding`
Expected: FAIL (type error: `setupSteps` takes 2 arguments).

Update `packages/core/src/onboarding/setup-steps.ts`:

```ts
import type { StoreRecord } from "../tenancy/store";

// Later plans append steps (W1-B links PayPal onboarding; billing adds a plan).
export type SetupStep = { id: string; label: string; done: boolean; href?: string };

export function setupSteps(
  store: Pick<StoreRecord, "status" | "paypalMerchantId">,
  links: { storefrontUrl: string; productsUrl: string },
  progress: { productCount: number },
): SetupStep[] {
  return [
    { id: "create-store", label: "Create your store", done: true },
    { id: "add-product", label: "Add your first product", done: progress.productCount > 0, href: links.productsUrl },
    { id: "connect-paypal", label: "Connect PayPal", done: store.paypalMerchantId !== null },
    // A visit cannot be detected, so the step counts as done once the storefront is live.
    { id: "visit-storefront", label: "Visit your storefront", done: store.status === "active", href: links.storefrontUrl },
  ];
}

export function countDone(steps: readonly SetupStep[]): number {
  return steps.filter((step) => step.done).length;
}
```

The checklist renders step links with `target="_blank"` (`setup-checklist.tsx`), which is wrong for the in-app products link. Update `apps/web/src/components/setup-checklist.tsx`: render internal links (hrefs starting with `/") with next/link and no `target`, external ones as today:

```tsx
{step.href ? (
  step.href.startsWith("/") ? (
    <Link href={step.href} className="underline underline-offset-4">
      {step.label}
    </Link>
  ) : (
    <a href={step.href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
      {step.label}
    </a>
  )
) : (
  <span>{step.label}</span>
)}
```

with `import Link from "next/link";` at the top.

Run: `pnpm test packages/core/src/onboarding && pnpm check-types`
Expected: the onboarding tests pass; type check fails only in `store-dashboard.tsx` (fixed below).

- [ ] **Step 2: The products list**

`apps/web/src/app/admin/[storeSlug]/products/page.tsx`:

```tsx
import { requireSession } from "@/lib/server-api";

import ProductsList from "./products-list";

export default async function ProductsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <ProductsList storeSlug={storeSlug} />;
}
```

`apps/web/src/app/admin/[storeSlug]/products/products-list.tsx`:

```tsx
"use client";

import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { productImageUrl } from "@/lib/image-url";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

export default function ProductsList({ storeSlug }: { storeSlug: string }) {
  const products = useQuery({ ...trpc.catalog.list.queryOptions({ storeSlug }), retry: false });

  if (products.isPending) return <Loader />;

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/${storeSlug}`} className="text-sm text-muted-foreground">
            {storeSlug}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        </div>
        <Link href={`/${storeSlug}/products/new`} className={buttonVariants()}>
          Add product
        </Link>
      </div>

      {products.isError && <p role="alert">The products couldn't be loaded.</p>}

      {products.data?.length === 0 && (
        <section className="grid gap-2 border border-dashed p-8 text-center">
          <p className="font-medium">No products yet</p>
          <p className="text-sm text-muted-foreground">
            Add your first product — start from a link, a photo, or a blank form.
          </p>
        </section>
      )}

      {products.data && products.data.length > 0 && (
        <ul className="divide-y border">
          {products.data.map((product) => (
            <li key={product.id}>
              <Link href={`/${storeSlug}/products/${product.id}`} className="flex items-center gap-4 p-3">
                {product.imageKey ? (
                  <img src={productImageUrl(product.imageKey)} alt="" className="size-12 border object-cover" />
                ) : (
                  <div aria-hidden className="size-12 border bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {product.status === "published" ? "Published" : "Draft"} · {product.variantCount}{" "}
                    {product.variantCount === 1 ? "variant" : "variants"} · {product.totalStock} in stock
                  </p>
                </div>
                <p className="text-sm">
                  {product.priceLow === null
                    ? "No price"
                    : product.priceLow === product.priceHigh
                      ? formatMinor(product.priceLow, "USD")
                      : `${formatMinor(product.priceLow, "USD")}–${formatMinor(product.priceHigh!, "USD")}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: The new-product page**

`apps/web/src/app/admin/[storeSlug]/products/new/page.tsx`:

```tsx
import { requireSession } from "@/lib/server-api";

import NewProduct from "./new-product";

export default async function NewProductPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <NewProduct storeSlug={storeSlug} />;
}
```

`apps/web/src/app/admin/[storeSlug]/products/new/new-product.tsx`:

```tsx
"use client";

import Link from "next/link";

import ProductForm from "@/components/catalog/product-form";

export default function NewProduct({ storeSlug }: { storeSlug: string }) {
  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href={`/${storeSlug}/products`} className="text-sm text-muted-foreground">
          Products
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add a product</h1>
      </div>
      <ProductForm storeSlug={storeSlug} />
    </main>
  );
}
```

- [ ] **Step 4: The edit page with publish/unpublish and market prices**

`apps/web/src/app/admin/[storeSlug]/products/[productId]/page.tsx`:

```tsx
import { requireSession } from "@/lib/server-api";

import EditProduct from "./edit-product";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ storeSlug: string; productId: string }>;
}) {
  await requireSession();
  const { storeSlug, productId } = await params;
  return <EditProduct storeSlug={storeSlug} productId={productId} />;
}
```

`apps/web/src/app/admin/[storeSlug]/products/[productId]/edit-product.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import MarketPricePanel from "@/components/catalog/market-price-panel";
import ProductForm from "@/components/catalog/product-form";
import { productImageUrl } from "@/lib/image-url";
import type { ProductFormState } from "@/lib/product-form-state";
import { queryClient, trpc } from "@/utils/trpc";

export default function EditProduct({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  const detail = useQuery({ ...trpc.catalog.get.queryOptions({ storeSlug, id: productId }), retry: false });
  const publish = useMutation(trpc.catalog.publish.mutationOptions());
  const unpublish = useMutation(trpc.catalog.unpublish.mutationOptions());

  if (detail.isPending) return <Loader />;
  if (detail.isError) {
    return (
      <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">Product not found</h1>
        <Link href={`/${storeSlug}/products`} className="underline">
          Back to products
        </Link>
      </main>
    );
  }

  const { product, variants, images } = detail.data;
  const initial: ProductFormState = {
    title: product.title,
    description: product.description,
    brand: product.brand,
    category: product.category,
    chargeTax: product.chargeTax,
    requiresShipping: product.requiresShipping,
    channel3ProductId: product.channel3ProductId,
    variants: variants.map((variant) => ({
      options: variant.options,
      sku: variant.sku ?? "",
      price: (variant.priceMinor / 100).toFixed(2),
      stock: String(variant.stock),
    })),
    images: images.map((image) => ({
      imageKey: image.imageKey,
      alt: image.alt,
      previewUrl: productImageUrl(image.imageKey),
    })),
    // Editing a product that was already imported does not ask again.
    rightsConfirmed: product.channel3ProductId !== null,
  };

  const statusMutation = product.status === "published" ? unpublish : publish;

  async function toggleStatus() {
    await statusMutation.mutateAsync({ storeSlug, id: productId });
    await Promise.all([
      detail.refetch(),
      queryClient.invalidateQueries({ queryKey: trpc.catalog.list.queryKey({ storeSlug }) }),
    ]);
  }

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/${storeSlug}/products`} className="text-sm text-muted-foreground">
            Products
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{product.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {product.status === "published" ? "Published" : "Draft"}
          </span>
          <Button type="button" variant="outline" onClick={toggleStatus} disabled={statusMutation.isPending}>
            {product.status === "published" ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </div>
      {statusMutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {statusMutation.error.message}
        </p>
      )}
      <MarketPricePanel storeSlug={storeSlug} productId={productId} />
      <ProductForm storeSlug={storeSlug} productId={productId} initial={initial} />
    </main>
  );
}
```

- [ ] **Step 5: Link the catalog from the dashboard**

In `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`, fetch the product count and pass the new arguments to `setupSteps`, and add a Products section:

```tsx
const products = useQuery({ ...trpc.catalog.list.queryOptions({ storeSlug }), retry: false });
```

Replace the `<SetupChecklist … />` line with:

```tsx
      <SetupChecklist
        steps={setupSteps(
          store.data,
          { storefrontUrl: url, productsUrl: `/${storeSlug}/products` },
          { productCount: products.data?.length ?? 0 },
        )}
      />
      <section className="grid gap-2 border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Products</h2>
          <Link href={`/${storeSlug}/products`} className="text-sm underline underline-offset-4">
            {products.data && products.data.length > 0 ? `Manage ${products.data.length} products` : "Add a product"}
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Start from a link or a photo with Channel3, set your prices, and publish when you're ready.
        </p>
      </section>
```

- [ ] **Step 6: Verify**

Run: `pnpm test && pnpm check-types`
Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add apps/web packages/core
git commit -m "feat(web): add the products list, new and edit pages with a dashboard card" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 13: Manual walkthrough, including the live Channel3 check

**Files:**
- Modify: `apps/server/.env` (local only, never committed)

- [ ] **Step 1: Migrate the dev database and start the app**

```bash
pnpm db:migrate:dev
pnpm dev
```

Expected: the migration applies to the `DEV_DATABASE_URL` database; the admin app comes up on the dev URL from `packages/infra` (`admin.localhost:<port>` unless a tunnel is configured).

- [ ] **Step 2: Walk the catalog flow without Channel3**

In the admin app, signed in, on a store you own:

1. The dashboard shows the checklist with "Add your first product" (undone) and the Products card.
2. Open Products → "No products yet" → Add product.
3. "Start from a link or a photo": looking up any link answers "Product lookup isn't available right now. Fill in the details yourself." (no API key configured — this is the intended empty state, not a bug).
4. Fill the form manually, upload two images, add a second variant, set prices and stock, save. The product appears in the list as Draft with the first image, price range and stock.
5. Open the product: the market price panel says "Market prices are unavailable right now."
6. Publish: works once a variant has a price above zero; the list shows Published. Unpublish works too.
7. Try to save a second product reusing the first product's SKU: the form shows "That SKU is already in use in this store."
8. Open one uploaded image URL (`/api/catalog/images/stores/...`) in a fresh browser profile: it loads without a session.

- [ ] **Step 3: Stop and ask for the Channel3 API key**

**Stop and ask the user now: "Please paste a `CHANNEL3_API_KEY` for the live Channel3 check."** (The user can create one at https://trychannel3.com — the hackathon code `PAYPAL-HACKATHON-2026` grants 20,000 credits, per `specs/hackathon/sponsors.md`.)

- If the user provides a key: append `CHANNEL3_API_KEY=<the key>` to `apps/server/.env`, restart `pnpm dev` (varlock reloads the schema'd vars on start), and continue to Step 4. Never print or commit the key; `apps/server/.env` is git-ignored.
- If the user cannot provide a key: skip Step 4, record "live Channel3 check skipped — no API key" under "Changes made during execution", and continue to Task 14. Every Channel3-dependent feature already answers "unavailable" gracefully, so the workstream is still mergeable.

- [ ] **Step 4: Live Channel3 check (only with a key)**

1. Paste a real retailer product URL (e.g. a big retailer's product page) into "Product link" → the form fills title, description, brand, category, images and variant options; prices and stock stay empty; the rights checkbox appears and saving is blocked until it is ticked.
2. Save. The imported images are served from `/api/catalog/images/...` (our R2 copy), not from the retailer's CDN — check the `src` of the thumbnails in the product list.
3. Open the saved product → the market price panel shows low/typical/high with example retailers and a timestamp. Refresh updates the timestamp once; a second refresh within the hour serves the cached report (the timestamp does not move).
4. Upload a product photo via "Use a photo" → a match list appears; picking one pre-fills the form.

If a live answer contradicts Facts 1–8 (a renamed field, a new error shape), the zod schema in `packages/channel3/src/schemas.ts` turns it into "unavailable" — record the mismatch in "Changes made during execution" and fix the schema, citing the live doc page.

- [ ] **Step 5: Commit (only if the walkthrough needed code changes)**

No commit is expected from this task; `.env` is never committed.

---

## Task 14: Rebase, regenerate the migration, final gates, merge

**Files:** none new

- [ ] **Step 1: Rebase onto `main`**

`main` advances locally through the controller's merges (the repo has no remote to pull from):

```bash
git rebase main
```

Shared-file conflicts to expect when `main` already contains other workstreams, each with its resolution:

- `apps/web/src/components/setup-checklist.tsx` — S1 fully rewrites it (title prop, internal `Link` hrefs). If the rebase pulls S1 in, drop S5's Task 12 checklist snippet: S1's version already renders internal step links the way S5 needs. Otherwise apply Task 12's edit as written.
- `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx` — S3 inserts `PayPalConnectCard` directly after the `<SetupChecklist … />` line that Task 12 also edits. Keep BOTH changes: S5's new `setupSteps` arguments and Products section, and S3's card.
- `packages/api/src/context.ts` and `packages/api/src/routers/index.ts` — S5 makes `catalog` a REQUIRED context field; S3 (merging in parallel) adds an optional `paypal` field, its own router, and `paypal.test.ts` with hand-built contexts. After rebasing, add `catalog: createTestCatalogServices()` to EVERY `Context` constructor, including test files that arrived from `main` (e.g. S3's `packages/api/src/routers/paypal.test.ts`), not just the ones Task 6's grep found — and register both routers in `routers/index.ts`.
- `turbo.json` `globalEnv`, both `.env.schema` files, `packages/infra/alchemy.run.ts`, and `apps/server/src/services.ts`, `context.ts`, `index.ts` — union-merge S3's additions with S5's (each workstream keeps its own bindings, env vars and route mounts).
- `packages/db/src/testing/db.ts` `truncateAll` — union-merge the table lists; a wrong resolution here silently breaks every DB test.
- `packages/core/src/index.ts` export lists and the store router test contexts merge as Task 6 already describes. `packages/core/src/onboarding/setup-steps.ts` is edited by S5 ONLY (S3 never touches it; S1's services checklist is a separate sibling module, `packages/core/src/services-teams/setup-steps.ts`), so no conflict is expected there.

After resolving, run `pnpm test && pnpm check-types` before continuing.

- [ ] **Step 2: Regenerate the migration if `main` moved (execution doc §1.5)**

```bash
git diff --name-only main...HEAD -- packages/db/src/migrations
git log --oneline main -- packages/db/src/migrations | head -5
```

If `main` gained migration folders that are not in this branch's history (parallel workstreams sharing `packages/db`), the snapshot chain is stale: delete this branch's `packages/db/src/migrations/<ts>_s5_catalog/` folder, run `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name s5_catalog` again, verify `pnpm test packages/db/src/schema/catalog.test.ts` still passes, and fold the regenerated folder into the Task 3 migration commit (§1.5 requires amending the workstream's own migration commit, not adding a separate chore commit):

```bash
git add packages/db/src/migrations
git commit --fixup <hash-of-the-task-3-migration-commit>
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main
```

Re-run `pnpm test packages/db` after the autosquash to confirm the folded history is still green.

- [ ] **Step 3: Final gates**

Run: `pnpm test && pnpm check-types`
Expected: everything passes from a clean tree. Do not run `pnpm -F web build` (known broken since W1-D execution; see the W1-D plan's execution-changes notes).

- [ ] **Step 4: Merge into `main` in the main worktree (execution doc §1.4)**

```bash
git -C /home/mouhamed/dev/repos/jendal/worktrees/main merge --no-ff s5-catalog -m "Merge branch 's5-catalog'"
```

Then report: the merge commit hash, the final `pnpm test` / `pnpm check-types` output, whether the live Channel3 check ran, and any deviations recorded below.

---

## Decisions made while planning

1. **Scope cut by the combined schedule.** The services spec §12 supersedes the platform spec §14 week plan: this week is "catalog admin with Channel3" only. Store settings, tax registrations/overrides, shipping rates, Render bulk import (`catalog_imports*`), price alerts (`price_watches`), storefront display and AI Search re-indexing are explicitly out (listed in "Out of scope" above). The `charge_tax` and `requires_shipping` columns exist now because the checkout weeks read them.
2. **A store is a Better Auth `team`.** All three catalog tables scope by `store_id text → team.id`, matching `stores.ts`/`store_domains` (no `stores` table exists; `seedStore` inserts into `team`).
3. **Money is integer minor units** (platform spec §3) with a DB `BETWEEN 0 AND 99999999` check; the store currency is deferred to store settings, so the market price panel and forms use USD via `CatalogServices.currency`, one change site when settings land.
4. **SKU uniqueness is per store, case-insensitive, nulls allowed**, enforced by a partial unique index `uq_variants_store_sku` on `(store_id, lower(sku))`; the service maps `DrizzleQueryError.cause` `{ code: "23505", constraint_name }` to core's `SkuTakenError`, and the router maps that to tRPC `CONFLICT`.
5. **Variants and images are replaced wholesale on update** (delete + re-insert). Catalog admin is low-frequency, and diffing adds identity bookkeeping for no user-visible gain. Orphaned R2 objects from removed images are accepted (out of scope above).
6. **Stock clamps at zero** (`greatest(0, stock + delta)`, platform spec §6.1) rather than rejecting oversells; checkout policies belong to the checkout weeks.
7. **Publishing requires one variant with a price above zero** (platform spec §10's "publish ready" state), implemented as `publishProblems` in core so the UI and API share it.
8. **Channel3 is a plain `fetch` adapter, not `@channel3/sdk`**, in a small `@jendal-workspace/channel3` package. zod schemas pin exactly the fields the app uses (unknown fields stripped; a changed shape becomes `SourceError("unavailable")`). This keeps the hackathon-critical external dependency testable without network access and inspectable in one file.
9. **Photo search sends `base64_image`, never `image_url`.** The sponsor spec §3.1 sketch passes a URL, but locally stored images sit in a dev R2 that Channel3 cannot reach, and uploaded images are not public until served. The browser already has the bytes; base64 works everywhere. Recorded here because it deviates from the spec's example.
10. **Only the Channel3 product ID is stored** (Fact 9: prices, image URLs and offer URLs are unstable; offer URLs are short-lived). The market panel shows retailer domains and prices, never offer links.
11. **Market price caching follows the sponsor spec §3.2 exactly**: 24 h KV cache per `(storeId, productId)`; Refresh sets a 1 h key and bypasses the cache only when that key is absent.
12. **Prefill never fills prices or stock** (sponsor spec §3.1) and variant combinations are the cartesian product of `exists: true` option values, capped at 100.
13. **The rights checkbox is client-enforced** (required only when `channel3ProductId` is set). It is an attestation, not data, so nothing is stored.
14. **Image downloads that fail are dropped, not fatal**: the merchant can add images manually, and blocking a whole save because one retailer CDN 404'd is worse than a quiet gap. Uploaded image keys from another store are likewise ignored.
15. **Image downloads are public reads behind unguessable UUID keys**; uploads require a session and store access (same `findStoreAccess` + `canOpenStore` rule as `storeProcedure`). SVG is rejected (scriptable content served back to browsers).
16. **`CHANNEL3_API_KEY` is optional everywhere** (`Config.withDefault(Redacted.make(""))`, `source: null` when empty). A required variable would break `pnpm dev` and CI for every other workstream before the key exists; the UI already has an "unavailable" state.
17. **The tRPC context gains a required `catalog` field** rather than an optional one: required forces every caller (server, tests) to decide, and the fake helper makes tests one line. This touches `store.test.ts`'s caller — a one-line, low-conflict change.
18. **`setup-steps.ts` gains a required `progress` parameter and a `productsUrl` link.** S3 also edits this file; the merge is textual and small, and the alternative (a parallel checklist) would split one user-facing list.
19. **Web components get no new test harness.** The repo tests `apps/web` at the pure-lib level (`lib/*.test.ts`); form state and conversions live in `lib/product-form-state.ts` so the risky logic is unit-tested there, and the walkthrough (Task 13) covers the wiring. Adding testing-library is out of scope.
20. **`lookupFromUrl`, `lookupFromPhoto`, `prefillFromMatch` and `marketPrice` return result objects (`ok`/`no_match`/`unavailable`) instead of throwing tRPC errors**, because "no match" and "temporarily unavailable" are expected states with their own UI copy, not failures.
21. **Prefill drops Channel3 `structured_attributes`.** The sponsor spec §3.1 lists attributes among the pre-fillable fields, but the platform spec's catalog tables have no attributes column — the deviation is deliberate. If a later plan adds attribute storage, `packages/channel3/src/schemas.ts` and `buildProductPrefill` are the two change sites.

## Changes made during execution

_(Filled in by the executor. Record every deviation from this plan here — e.g. migration assertion adjustments, schema mismatches found in the live check, or a skipped live check — with the reason.)_

- …
