# Run 4a: Digital products in the admin and on the seller page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A services team can turn on its store, add digital products (title, description, price, one file up to 100 MB in R2), publish them, and see them on its seller page with a Buy button (the buy page itself is run 4b).

**Architecture:** Digital products reuse the Commerce `products`/`product_variants` tables with a new `kind` column (`physical` default, `digital`); a digital product has exactly one hidden variant holding its price. The product file reuses the R2b `file_upload` table (new purpose `product`, new nullable `product_id`) and its rules, bucket and sweep. The seller page gains a Store section fed by a new `products` field on the seller-page payload. Publishing a services team now needs an active service *or* a published digital product.

**Spec:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §3.2 (store toggle), §3.3 (Store section), §5.1 (products), §8 (file rules), §9 (data model), §11 (run 4), §11.1 (store checklist counting).

**User decisions (2026-10-09):**
1. Run 4 splits into 4a (this plan: products + display) and 4b (checkout, orders, download links, refund webhook).
2. Product images are skipped; cards show title, description and price. Images go to the backlog.
3. The publish rule widens: a services team publishes with PayPal plus an active service *or* a published digital product.

**Controller decisions:**
- `kind` is derived from the team at creation (`services` → `digital`, `store` → `physical`); there is no per-product choice. The digital procedures refuse store teams and vice versa.
- The product file lives in `file_upload` (purpose `product`, `product_id` FK), not a new `product_files` table as the design's §5.1 literally says — the same deviation R2b made for delivery files, so the type/size rules, the presign flow and the unattached-upload sweep all apply unchanged.
- A digital product needs an attached file before it can be published ("Add the file buyers download before publishing."). Replacing the file uploads a new one and deletes the old object; there is no detach button.
- Buy links point at `/buy/{productId}` on the seller host; that page arrives in 4b, so the link 404s until then (dev only — nothing is deployed).
- `SellerPageContent.requestBase` is renamed `pageBase` since it now bases both request and buy links.
- The seller page renders for a `store` team too once it has published digital products (it cannot create any yet, so Commerce stores keep the "This store is getting ready." placeholder for now; the §11.1 note stays open).
- The Commerce store checklist fix from §11.1 ("counts any product while publishing needs a published one") is included — it is one line in the dashboard.

**Baseline:** `main` at `8d51ff2`, 1092 tests green, check-types clean. Work in a fresh worktree `worktrees/r4a-digital-products` branched from `main`: `git worktree add worktrees/r4a-digital-products -b r4a-digital-products main` from the repo root, copy `.env.test.local` into it (same relative path as in main), `pnpm install`, then `pnpm check-types` as the baseline.

---

### Task 1: core — product kind, digital rules, product file purpose

**Files:**
- Create: `packages/core/src/catalog/digital-product.ts`
- Create: `packages/core/src/catalog/digital-product.test.ts`
- Modify: `packages/core/src/files/rules.ts:4` (`FILE_PURPOSES`)
- Modify: `packages/core/src/sellers/publish.ts` (services message)
- Modify: `packages/core/src/services-teams/setup-steps.ts:26-33` (productCount)
- Modify: `packages/core/src/index.ts` (exports)

- [ ] **Step 1: Write the failing tests** — `packages/core/src/catalog/digital-product.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { MAX_PRICE_MINOR } from "./product";
import {
  digitalPublishProblems,
  validateDigitalProductDraft,
  type DigitalProductDraft,
} from "./digital-product";

const good: DigitalProductDraft = { title: "Icon pack", description: "120 icons.", priceMinor: 1900 };

describe("validateDigitalProductDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateDigitalProductDraft(good)).toEqual([]);
  });
  it("accepts a free product at the draft stage", () => {
    expect(validateDigitalProductDraft({ ...good, priceMinor: 0 })).toEqual([]);
  });
  it("refuses an empty or long title", () => {
    expect(validateDigitalProductDraft({ ...good, title: "  " })).toEqual([
      { field: "title", message: "Add a title." },
    ]);
    expect(validateDigitalProductDraft({ ...good, title: "x".repeat(201) })).toEqual([
      { field: "title", message: "Keep the title under 200 characters." },
    ]);
  });
  it("refuses a long description", () => {
    expect(validateDigitalProductDraft({ ...good, description: "x".repeat(5001) })).toEqual([
      { field: "description", message: "Keep the description under 5,000 characters." },
    ]);
  });
  it("refuses a negative, fractional or huge price", () => {
    for (const priceMinor of [-1, 1.5, MAX_PRICE_MINOR + 1]) {
      expect(validateDigitalProductDraft({ ...good, priceMinor })).toEqual([
        { field: "price", message: "Enter a valid price." },
      ]);
    }
  });
});

describe("digitalPublishProblems", () => {
  it("runs the draft rules first", () => {
    expect(digitalPublishProblems({ ...good, title: "" }, true)[0]?.field).toBe("title");
  });
  it("refuses a free product", () => {
    expect(digitalPublishProblems({ ...good, priceMinor: 0 }, true)).toEqual([
      { field: "price", message: "Set a price above zero before publishing." },
    ]);
  });
  it("refuses a product without its file", () => {
    expect(digitalPublishProblems(good, false)).toEqual([
      { field: "file", message: "Add the file buyers download before publishing." },
    ]);
  });
  it("accepts a priced product with its file", () => {
    expect(digitalPublishProblems(good, true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** — `pnpm -F @jendal-workspace/core test -- digital-product` → module not found.

- [ ] **Step 3: Implement** — `packages/core/src/catalog/digital-product.ts`:

```ts
import { MAX_PRICE_MINOR } from "./product";

// Sellers design §5.1: a digital product is a title, a description, one price and one file.
export type DigitalProductDraft = { title: string; description: string; priceMinor: number };
export type DigitalProductProblem = { field: string; message: string };

// The same rules run in the browser before submit and in the API as a backstop.
export function validateDigitalProductDraft(draft: DigitalProductDraft): DigitalProductProblem[] {
  const problems: DigitalProductProblem[] = [];
  if (!draft.title.trim()) problems.push({ field: "title", message: "Add a title." });
  else if (draft.title.length > 200) problems.push({ field: "title", message: "Keep the title under 200 characters." });
  if (draft.description.length > 5_000) {
    problems.push({ field: "description", message: "Keep the description under 5,000 characters." });
  }
  if (!Number.isInteger(draft.priceMinor) || draft.priceMinor < 0 || draft.priceMinor > MAX_PRICE_MINOR) {
    problems.push({ field: "price", message: "Enter a valid price." });
  }
  return problems;
}

// Publishing adds two rules: a real price, and the file buyers download.
export function digitalPublishProblems(draft: DigitalProductDraft, fileAttached: boolean): DigitalProductProblem[] {
  const problems = validateDigitalProductDraft(draft);
  if (problems.length > 0) return problems;
  if (draft.priceMinor === 0) return [{ field: "price", message: "Set a price above zero before publishing." }];
  if (!fileAttached) return [{ field: "file", message: "Add the file buyers download before publishing." }];
  return [];
}

```

(`MAX_PRICE_MINOR` stays exported only from `catalog/product.ts`; the test imports it from there.)

Also in `rules.ts` change line 4 to `export const FILE_PURPOSES = ["delivery", "product"] as const;`

In `publish.ts` change the services message to `"Add at least one active service or product before you publish."` and the `listedCount` comment to `// Active services plus published digital products for a services team, published products for a store.`

In `services-teams/setup-steps.ts`: add `productCount: number;` to the state type and change the add-service step to:
```ts
    // Sellers design §3.2: the seller page needs at least one service or one product.
    step("add-service", "Add a service or a product", state.offeringCount + state.productCount > 0, links.services),
```

In `index.ts` export the new module (`export * from "./catalog/digital-product";` next to the other catalog export — check how `catalog/product` is exported and mirror it).

- [ ] **Step 4: Fix the existing callers of the changed pieces.**
  - `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx` passes `servicesTeamSetupSteps({...})` — it will fail type-check until Task 4 adds `productCount`; for now the api's `servicesTeam.get` does not return it either. Do NOT touch the web app in this task; instead run `pnpm -F @jendal-workspace/core test` only. The repo-wide `check-types` will fail until Task 3/4 — that is expected; the reviewers check types from Task 3 on. (If you prefer, you may already add `productCount: 0` in the dashboard call — Task 4 replaces it with the real value.)
  - `packages/core/src/sellers/publish.test.ts` (or wherever `publishProblem` is tested) has a case asserting the old message — update it to the new message.
  - Any test snapshotting `servicesTeamSetupSteps` needs `productCount: 0` added to the state and the new label.

- [ ] **Step 5: Run tests** — `pnpm -F @jendal-workspace/core test` all pass.

- [ ] **Step 6: Commit** — `feat(core): digital product rules, the product file purpose, wider publish wording` (body: DigitalProductDraft with validation and publish rules (price above zero, file attached); FILE_PURPOSES gains "product"; the services publish message and checklist say "service or product"). Co-authored-by trailer.

---

### Task 2: db — kind column, product file ownership, seller-page products

**Files:**
- Modify: `packages/db/src/schema/catalog.ts` (`products` gains `kind`)
- Modify: `packages/db/src/schema/files.ts` (`fileUpload` gains `productId`)
- Create: migration via `pnpm -F db db:generate`, folder name `r4a_digital_products`
- Modify: `packages/db/src/repositories/catalog.ts` (kind on insert; digital queries)
- Modify: `packages/db/src/repositories/files.ts` (product attach helpers)
- Modify: `packages/db/src/repositories/services-teams.ts` (storeEnabled setter)
- Modify: `packages/db/src/repositories/seller-page.ts` (products field)
- Modify: `packages/db/src/testing/db.ts` (`seedProduct`)
- Test: `packages/db/src/repositories/catalog.test.ts`, `files.test.ts` (extend existing test files)

- [ ] **Step 1: Failing repository tests.** In `packages/db/src/repositories/catalog.test.ts` (append to the existing file; follow its setup pattern — it uses the test DB and `seedStore`):

```ts
describe("digital products", () => {
  it("insertProduct stores the kind and listPublishedDigitalProducts returns title, description and price", async () => {
    const store = await seedStore(db, { organizationId: org.id, slug: "digital-shop" });
    const product = await insertProduct(db, tenantFor(store.id), {
      kind: "digital",
      title: "Icon pack",
      description: "120 icons.",
      brand: "",
      category: "",
      chargeTax: true,
      requiresShipping: false,
      channel3ProductId: null,
    });
    await insertVariants(db, tenantFor(store.id), product.id, [
      { options: [], sku: "", priceMinor: 1900, stock: 0 },
    ]);
    await setProductStatus(db, tenantFor(store.id), product.id, "published");

    const listed = await listPublishedDigitalProducts(db, store.id);
    expect(listed).toEqual([
      { id: product.id, title: "Icon pack", description: "120 icons.", priceMinor: 1900 },
    ]);
    expect(await countPublishedDigitalProducts(db, store.id)).toBe(1);
    expect(await countDigitalProducts(db, store.id)).toBe(1);
  });

  it("ignores drafts and physical products", async () => {
    // seed a draft digital product and a published physical one; both lists stay empty
  });
});
```

In `packages/db/src/repositories/files.test.ts` (follow its existing delivery-file tests):

```ts
it("locks an unattached product upload, finds the attached file, deletes by id", async () => {
  // seed a team + a product first (the FK needs it): const product = await seedProduct(db, { storeId, kind: "digital" });
  // insert a file_upload row with teamId, productId: product.id, purpose "product", attachedAt null
  // lockProductFileUploadForAttach returns it; with attachedAt set it returns null
  // findAttachedProductFile returns the attached row for that product
  // deleteFileUpload removes it
});
```

Also a `seedProduct` test next to the other seed tests in `testing/db.test.ts` if one exists (check; if the file has no seed tests, skip).

(What `tenantFor` is called in this file: look at how existing catalog tests build the `TenantContext` — reuse that helper verbatim.)

- [ ] **Step 2: Run to fail** — `pnpm -F @jendal-workspace/db test -- catalog` → `listPublishedDigitalProducts is not a function` (type error or runtime fail).

- [ ] **Step 3: Schema changes.**

`packages/db/src/schema/catalog.ts`, in `products` after `status`:
```ts
    // physical (Commerce stores) or digital (sellers, run 4a); derived from the team at creation.
    kind: text("kind").notNull().default("physical"),
```
and add to the table constraints:
```ts
    check("products_kind_check", sql`${table.kind} IN ('physical', 'digital')`),
```

`packages/db/src/schema/files.ts`: import `products` from `./catalog` and add to `fileUpload` after `projectId`:
```ts
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
```
(add `uuid` to the pg-core import) and add `index("file_upload_productId_idx").on(t.productId)` to the indexes. Update the leading comment: "attached once to what it belongs to (a delivery or a digital product)".

- [ ] **Step 4: Generate the migration** — `pnpm -F db db:generate`, name `r4a_digital_products`. Read the SQL: one ADD COLUMN `kind` with default and NOT NULL, one CHECK, one ADD COLUMN `product_id` uuid with FK cascade, one index. Do NOT apply it to the dev database (the controller does at merge).

- [ ] **Step 5: Repository functions.** In `repositories/catalog.ts`:
  - `insertProduct` — its values parameter gains `kind: ProductKind` (import the type from core); pass it through.
  - Append:

```ts
// Run 4a: digital products are sold from the seller page; a digital product has exactly one variant.
export type SellerProductRow = { id: string; title: string; description: string; priceMinor: number };

export async function listPublishedDigitalProducts(db: DbExecutor, storeId: string): Promise<SellerProductRow[]> {
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      description: products.description,
      priceMinor: productVariants.priceMinor,
    })
    .from(products)
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(eq(products.storeId, storeId), eq(products.kind, "digital"), eq(products.status, "published")))
    .orderBy(asc(products.createdAt), asc(productVariants.createdAt));
  // One row per variant; digital products have one, but a hand-edited row set still yields one card.
  const byId = new Map<string, SellerProductRow>();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()];
}

export async function countPublishedDigitalProducts(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.kind, "digital"), eq(products.status, "published")));
  return row?.count ?? 0;
}

export async function countDigitalProducts(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.kind, "digital")));
  return row?.count ?? 0;
}
```

(Check how the file imports `count`/`asc`/`and` — mirror existing queries; `countPublishedProducts` in `repositories/stores.ts` shows the count pattern.)

In `repositories/files.ts` append:

```ts
// Product files: same attach-once discipline as deliveries, owned by the product.
export async function lockProductFileUploadForAttach(
  tx: DbExecutor,
  input: { id: string; teamId: string; productId: string; purpose: FilePurpose },
): Promise<FileUploadRow | null> {
  const [row] = await tx
    .select()
    .from(fileUpload)
    .where(
      and(
        eq(fileUpload.id, input.id),
        eq(fileUpload.teamId, input.teamId),
        eq(fileUpload.productId, input.productId),
        eq(fileUpload.purpose, input.purpose),
        isNull(fileUpload.attachedAt),
      ),
    )
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function findAttachedProductFile(tx: DbExecutor, productId: string): Promise<FileUploadRow | null> {
  const [row] = await tx
    .select()
    .from(fileUpload)
    .where(
      and(
        eq(fileUpload.productId, productId),
        eq(fileUpload.purpose, "product"),
        isNotNull(fileUpload.attachedAt),
      ),
    )
    .orderBy(desc(fileUpload.attachedAt))
    .limit(1);
  return row ?? null;
}

export async function deleteFileUpload(tx: DbExecutor, id: string): Promise<void> {
  await tx.delete(fileUpload).where(eq(fileUpload.id, id));
}
```
(add `desc`, `isNotNull` to the drizzle imports).

In `repositories/services-teams.ts` append (mirror `saveServicesTeamBio`'s upsert style — read it first):
```ts
export async function setServicesTeamStoreEnabled(db: Database, teamId: string, enabled: boolean): Promise<void> {
  // same upsert shape as saveServicesTeamBio, setting storeEnabled and updatedAt
}
```

In `repositories/seller-page.ts`: import `listPublishedDigitalProducts`, add `products: SellerProductRow[]` to `SellerPageData`, and in `findSellerPage` fetch them for every team alongside the services queries:
```ts
  const [departments, offerings, products] = await Promise.all([
    row.product === "services" ? listServicesDepartments(db, teamId) : [],
    row.product === "services" ? listServicesOfferings(db, teamId, { activeOnly: true }) : [],
    listPublishedDigitalProducts(db, teamId),
  ]);
```
(return `products` in the result).

In `testing/db.ts` add (mirror `seedServicesOffering`'s style):
```ts
export async function seedProduct(
  db: Database,
  input: { storeId: string; title?: string; kind?: "physical" | "digital"; status?: "draft" | "published"; priceMinor?: number },
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.insert(products).values({
    id,
    storeId: input.storeId,
    kind: input.kind ?? "physical",
    status: input.status ?? "draft",
    title: input.title ?? "Test product",
  });
  await db.insert(productVariants).values({
    id: crypto.randomUUID(),
    storeId: input.storeId,
    productId: id,
    priceMinor: input.priceMinor ?? 0,
  });
  return { id };
}
```

- [ ] **Step 6: Run tests** — `pnpm -F @jendal-workspace/db test` all pass (new cases included).

- [ ] **Step 7: Commit** — `feat(db): product kind, product files, digital product queries` (body: migration r4a_digital_products; file_upload.product_id; seller page carries published digital products). Co-authored-by trailer.

---

### Task 3: api — digital product procedures, file upload/attach, publish rule, store toggle

**Files:**
- Create: `packages/api/src/catalog/digital.ts`
- Modify: `packages/api/src/catalog/service.ts` (`publishProduct` branches on kind)
- Modify: `packages/api/src/routers/catalog.ts` (digital procedures)
- Modify: `packages/api/src/routers/seller.ts` (`listedCount`)
- Modify: `packages/api/src/routers/services-team.ts` (`setStoreEnabled`, `get` gains `productCount`)
- Test: `packages/api/src/routers/catalog.test.ts` (extend), `packages/api/src/routers/services-team.test.ts` (extend), `packages/api/src/routers/seller.test.ts` (extend)

Context you need: `CatalogServices` lives in `catalog/service.ts`; router tests build a caller with `appRouter.createCaller({ db, session: makeSession(userId), environment: "sandbox", auth, headers: new Headers(), catalog: createTestCatalogServices(), files: createFakeFileStore(), onTeamStatusChanged })` — copy an existing catalog test's setup. `Context.files` is the `FileStore` (fake in tests). `hitRequestLimit(db, { key, max, windowMs })` is the limiter. `requireAction(ctx.servicesTeamRole, "manage_settings", "...")` gates admin-only services mutations.

- [ ] **Step 1: Failing tests** in `packages/api/src/routers/catalog.test.ts`:

```ts
describe("digital products", () => {
  it("creates, updates, lists and publishes a digital product", async () => {
    // seedServicesTeamWithAdmin + session; create via caller.catalog.digitalCreate
    // { title: "Icon pack", description: "120 icons.", priceMinor: 1900 }
    // digitalList shows it as draft with priceMinor 1900 and fileName null
    // publish without a file → BAD_REQUEST "Add the file buyers download before publishing."
    // fileUploadStart → presigned PUT recorded by the fake; fakeFileStore.put(key, bytes)
    // fileAttach → digitalGet shows fileName
    // publish → status "published"
  });

  it("refuses a digital create on a store team", async () => {
    // seedStore; caller.catalog.digitalCreate → PRECONDITION_FAILED
  });

  it("reads a physical product as missing through the digital procedures", async () => {
    // seedProduct kind "physical" on a store; digitalGet → NOT_FOUND
  });

  it("replaces the file: the old row and object are deleted", async () => {
    // attach file A, then upload+attach file B; the fake store records a delete of A's key;
    // digitalGet shows B's name
  });
});
```

In `services-team.test.ts`: `setStoreEnabled` flips the flag (admin), refuses a non-admin (FORBIDDEN), and `get` returns `productCount` (seed two digital products, one physical → `2`).

In `seller.test.ts`: the publish tests — extend the existing "refuses without an active service" case and add: a services team with PayPal, no services, and one published digital product publishes fine (`seller.publish` succeeds); with only a *draft* digital product it still refuses with "Add at least one active service or product before you publish."

- [ ] **Step 2: Run to fail** — `pnpm -F @jendal-workspace/api test -- catalog` → `digitalCreate is not a function`-style errors.

- [ ] **Step 3: The digital service** — `packages/api/src/catalog/digital.ts`:

```ts
import {
  checkUploadFile,
  digitalPublishProblems,
  validateDigitalProductDraft,
  type DigitalProductDraft,
  type FileStore,
  type TenantContext,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  getProduct,
  insertProduct,
  insertVariants,
  listProducts,
  listVariants,
  updateProduct as updateProductRecord,
} from "@jendal-workspace/db/repositories/catalog";
import {
  deleteFileUpload,
  findAttachedProductFile,
  findFileUpload,
  insertFileUpload,
  lockProductFileUploadForAttach,
  markFileUploadAttached,
} from "@jendal-workspace/db/repositories/files";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";

import { CatalogValidationError } from "./errors";

export type DigitalProductDetail = {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published";
  priceMinor: number;
  fileName: string | null;
};

export class DigitalProductMissing extends Error {} // mapped to NOT_FOUND in the router
export class UploadLimitedError extends Error {
  constructor() {
    super("Too many uploads. Wait a few minutes and try again.");
    this.name = "UploadLimitedError";
  }
} // mapped to TOO_MANY_REQUESTS in the router

async function requireDigitalProduct(db: Database, tenant: TenantContext, productId: string) {
  const product = await getProduct(db, tenant, productId);
  if (!product || product.kind !== "digital") throw new DigitalProductMissing();
  return product;
}

export async function createDigitalProduct(
  db: Database,
  tenant: TenantContext,
  input: DigitalProductDraft,
): Promise<DigitalProductDetail> {
  const problems = validateDigitalProductDraft(input);
  if (problems.length > 0) throw new CatalogValidationError(problems);
  const product = await insertProduct(db, tenant, {
    kind: "digital",
    title: input.title.trim(),
    description: input.description,
    brand: "",
    category: "",
    chargeTax: true,
    requiresShipping: false,
    channel3ProductId: null,
  });
  await insertVariants(db, tenant, product.id, [
    { options: [], sku: "", priceMinor: input.priceMinor, stock: 0 },
  ]);
  return getDigitalProduct(db, tenant, product.id);
}

export async function updateDigitalProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
  input: DigitalProductDraft,
): Promise<DigitalProductDetail> {
  const problems = validateDigitalProductDraft(input);
  if (problems.length > 0) throw new CatalogValidationError(problems);
  const product = await requireDigitalProduct(db, tenant, productId);
  await updateProductRecord(db, tenant, productId, {
    title: input.title.trim(),
    description: input.description,
    brand: product.brand,
    category: product.category,
    chargeTax: product.chargeTax,
    requiresShipping: product.requiresShipping,
    channel3ProductId: product.channel3ProductId,
  });
  const [variant] = await listVariants(db, tenant, productId);
  if (variant) {
    // one hidden variant holds the price; update it in place (there is no updateVariant yet — add a
    // small updateVariantPrice(tx, tenant, variantId, priceMinor) to repositories/catalog.ts)
    await updateVariantPrice(db, tenant, variant.id, input.priceMinor);
  } else {
    await insertVariants(db, tenant, productId, [{ options: [], sku: "", priceMinor: input.priceMinor, stock: 0 }]);
  }
  return getDigitalProduct(db, tenant, productId);
}

export async function getDigitalProduct(db, tenant, productId): Promise<DigitalProductDetail> {
  const product = await requireDigitalProduct(db, tenant, productId);
  const [variants, file] = await Promise.all([
    listVariants(db, tenant, productId),
    findAttachedProductFile(db, productId),
  ]);
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    status: product.status as "draft" | "published",
    priceMinor: variants[0]?.priceMinor ?? 0,
    fileName: file?.fileName ?? null,
  };
}

export async function listDigitalProducts(db: Database, tenant: TenantContext): Promise<DigitalProductDetail[]> {
  const rows = (await listProducts(db, tenant)).filter((product) => product.kind === "digital");
  // One query per product is fine at admin scale (the same choice listProductSummaries makes).
  return Promise.all(rows.map((product) => getDigitalProduct(db, tenant, product.id)));
}

// Sellers design §5.1: the browser uploads straight to the bucket; the row records what was announced.
export async function startProductFileUpload(
  db: Database,
  files: FileStore,
  tenant: TenantContext,
  userId: string,
  input: { productId: string; fileName: string; sizeBytes: number },
): Promise<{ uploadId: string; url: string; headers: Record<string, string> }> {
  await requireDigitalProduct(db, tenant, input.productId);
  const checked = checkUploadFile({ name: input.fileName, sizeBytes: input.sizeBytes });
  if (!checked.ok) throw new CatalogValidationError([{ field: "file", message: checked.problem }]);
  const allowed = await hitRequestLimit(db, { key: `product-upload:${userId}`, max: 20, windowMs: 600_000 });
  if (!allowed) throw new UploadLimitedError();
  const uploadId = crypto.randomUUID();
  const key = `products/${tenant.storeId}/${input.productId}/${uploadId}`;
  await insertFileUpload(db, {
    id: uploadId,
    teamId: tenant.storeId,
    productId: input.productId,
    purpose: "product",
    r2Key: key,
    fileName: checked.fileName,
    contentType: checked.contentType,
    sizeBytes: input.sizeBytes,
    createdById: userId,
  });
  const { url, headers } = await files.presignPut({
    key,
    contentType: checked.contentType,
    sizeBytes: input.sizeBytes,
    expiresInSeconds: 900,
  });
  return { uploadId, url, headers };
}

// The bucket is asked before the transaction so no row lock waits on the network; replacing deletes the old file.
export async function attachProductFile(
  db: Database,
  files: FileStore,
  tenant: TenantContext,
  input: { productId: string; uploadId: string },
): Promise<{ fileName: string }> {
  await requireDigitalProduct(db, tenant, input.productId);
  const upload = await findFileUpload(db, input.uploadId);
  if (!upload || upload.teamId !== tenant.storeId || upload.productId !== input.productId || upload.purpose !== "product") {
    throw new CatalogValidationError([{ field: "file", message: "This file cannot be used for this product." }]);
  }
  const stored = await files.head(upload.r2Key);
  if (!stored || stored.sizeBytes !== upload.sizeBytes) {
    throw new CatalogValidationError([{ field: "file", message: "The file did not finish uploading." }]);
  }
  const replacedKey = await db.transaction(async (tx) => {
    const locked = await lockProductFileUploadForAttach(tx, {
      id: input.uploadId,
      teamId: tenant.storeId,
      productId: input.productId,
      purpose: "product",
    });
    if (!locked) throw new CatalogValidationError([{ field: "file", message: "This file cannot be used for this product." }]);
    await markFileUploadAttached(tx, locked.id);
    const previous = await findAttachedProductFile(tx, input.productId);
    if (previous && previous.id !== locked.id) {
      await deleteFileUpload(tx, previous.id);
      return previous.r2Key;
    }
    return null;
  });
  if (replacedKey) {
    try {
      await files.delete([replacedKey]);
    } catch {
      // The sweep or a later cleanup gets it; the product already points at the new file.
    }
  }
  return { fileName: upload.fileName };
}

// Used by publishProduct in service.ts: the publish rules for a digital product.
export async function digitalPublishProblemsFor(
  db: Database,
  tenant: TenantContext,
  productId: string,
): Promise<{ field: string; message: string }[] | null> {
  // null when the product is not digital (the caller takes the physical path)
  const product = await getProduct(db, tenant, productId);
  if (!product || product.kind !== "digital") return null;
  const [variants, file] = await Promise.all([
    listVariants(db, tenant, productId),
    findAttachedProductFile(db, productId),
  ]);
  return digitalPublishProblems(
    { title: product.title, description: product.description, priceMinor: variants[0]?.priceMinor ?? 0 },
    file !== null,
  );
}
```

Note for the implementer: `updateVariantPrice` does not exist — add it to `repositories/catalog.ts` (Task 3 may touch that file; it belongs with the other variant functions):
```ts
export async function updateVariantPrice(db: DbExecutor, tenant: TenantContext, variantId: string, priceMinor: number) {
  await db.update(productVariants).set({ priceMinor, updatedAt: sql`now()` })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, tenant.storeId)));
}
```
(check how `updateProduct` sets `updatedAt` and mirror it). Also add a small test for it in the db package's catalog.test.ts.

- [ ] **Step 4: publishProduct branches on kind.** First move `CatalogValidationError` out of `catalog/service.ts` into a new tiny module `packages/api/src/catalog/errors.ts` (same class definition, unchanged) and update the imports in `service.ts` and `routers/catalog.ts` — `digital.ts` imports the error from `./errors`, so there is no service↔digital cycle. Then in `catalog/service.ts` `publishProduct`, right after `getProductDetail`:

```ts
  const digitalProblems = await digitalPublishProblemsFor(db, tenant, productId);
  if (digitalProblems) {
    if (digitalProblems.length > 0) throw new CatalogValidationError(digitalProblems);
    await setProductStatus(db, tenant, productId, "published");
    return getProductDetail(db, tenant, productId);
  }
  // …existing physical path unchanged
```
(import `digitalPublishProblemsFor` from `./digital`.)

- [ ] **Step 5: Router procedures** — in `routers/catalog.ts`:

```ts
const digitalInputSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(5_000),
  priceMinor: z.number().int().min(0),
});

function requireServicesTeam(ctx: { store: { product: string } }) {
  if (ctx.store.product !== "services") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Digital products are managed from a seller team." });
  }
}
```

```ts
  digitalList: storeProcedure.query(({ ctx }) => {
    requireServicesTeam(ctx);
    return listDigitalProducts(ctx.db, ctx.tenant);
  }),

  digitalGet: storeProcedure.input(idInput).query(async ({ ctx, input }) => {
    requireServicesTeam(ctx);
    try {
      return await getDigitalProduct(ctx.db, ctx.tenant, input.id);
    } catch (error) {
      if (error instanceof DigitalProductMissing) notFound();
      throw error;
    }
  }),

  digitalCreate: storeProcedure.input(digitalInputSchema).mutation(async ({ ctx, input }) => {
    requireServicesTeam(ctx);
    const { storeSlug: _storeSlug, ...draft } = input;
    try {
      return await createDigitalProduct(ctx.db, ctx.tenant, draft);
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  digitalUpdate: storeProcedure.input(digitalInputSchema.merge(idInput)).mutation(async ({ ctx, input }) => {
    requireServicesTeam(ctx);
    const { storeSlug: _storeSlug, id, ...draft } = input;
    try {
      return await updateDigitalProduct(ctx.db, ctx.tenant, id, draft);
    } catch (error) {
      if (error instanceof DigitalProductMissing) notFound();
      rethrowAsTrpcError(error);
    }
  }),

  fileUploadStart: storeProcedure
    .input(z.object({ productId: z.uuid(), fileName: z.string().max(300), sizeBytes: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      requireServicesTeam(ctx);
      try {
        return await startProductFileUpload(ctx.db, ctx.files, ctx.tenant, ctx.session.user.id, input);
      } catch (error) {
        if (error instanceof DigitalProductMissing) notFound();
        if (error instanceof UploadLimitedError) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
        }
        rethrowAsTrpcError(error);
      }
    }),

  fileAttach: storeProcedure
    .input(z.object({ productId: z.uuid(), uploadId: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      requireServicesTeam(ctx);
      try {
        return await attachProductFile(ctx.db, ctx.files, ctx.tenant, input);
      } catch (error) {
        if (error instanceof DigitalProductMissing) notFound();
        rethrowAsTrpcError(error);
      }
    }),
```

(Verify `ctx.files` is the Context's FileStore field name — the project router's `deliveryUploadStart` procedure uses it; copy that call's shape. Also verify `updateProductRecord` is exported from repositories/catalog.ts — `updateProductRow` in service.ts calls it, so it is.)

- [ ] **Step 6: The publish rule** — in `routers/seller.ts`:

```ts
import { countPublishedDigitalProducts } from "@jendal-workspace/db/repositories/catalog";

async function listedCount(db: Database, seller: StoreRecord): Promise<number> {
  if (seller.product === "services") {
    const [offerings, products] = await Promise.all([
      countServicesOfferings(db, seller.id, { activeOnly: true }),
      countPublishedDigitalProducts(db, seller.id),
    ]);
    return offerings + products;
  }
  return countPublishedProducts(db, seller.id);
}
```

- [ ] **Step 7: The store toggle and productCount** — in `routers/services-team.ts`:

```ts
  // Sellers design §3.2: store_enabled turns the store (digital products) on for a services team.
  setStoreEnabled: servicesTeamProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", "Only an admin can change the team settings.");
      await setServicesTeamStoreEnabled(ctx.db, ctx.servicesTeam.id, input.enabled);
      return { storeEnabled: input.enabled };
    }),
```
and in `get`, add to the Promise.all `countDigitalProducts(ctx.db, ctx.servicesTeam.id)` and return `productCount`.

- [ ] **Step 8: Run tests** — `pnpm -F @jendal-workspace/api test` and `pnpm -F @jendal-workspace/db test` pass; `pnpm check-types` passes now (the web dashboard still passes `productCount` — Task 1 note: if you added a temporary `productCount: 0` there, Task 4 replaces it).

- [ ] **Step 9: Commit** — `feat(api): digital product procedures, product file upload, the wider publish rule` (body: catalog.digital* and fileUploadStart/fileAttach for services teams; publishProduct requires the file for digital; seller publish accepts a published digital product; servicesTeam.setStoreEnabled and productCount). Co-authored-by trailer.

---

### Task 4: web admin — store toggle, digital product pages

**Files:**
- Create: `apps/web/src/components/catalog/digital-products.tsx` (list + enable card)
- Create: `apps/web/src/components/catalog/digital-product-form.tsx` (new + edit incl. file upload)
- Modify: `apps/web/src/app/admin/[storeSlug]/products/products-list.tsx` (branch by team kind)
- Modify: `apps/web/src/app/admin/[storeSlug]/products/new/new-product.tsx` (branch)
- Modify: `apps/web/src/app/admin/[storeSlug]/products/[productId]/edit-product.tsx` (branch)
- Modify: `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx` (Products nav, Store card, productCount)
- Modify: `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx` (checklist counts published only — §11.1 fix)

Context: `trpc.store.get` (`{ storeSlug }`) returns `{ ...store, role }` for both team kinds (`storeProcedure` resolves any team the caller can open; `store.product` is `"services" | "store"`). `trpc.servicesTeam.get` returns `{ team, role, settings, offeringCount, productCount }` where `settings.storeEnabled` gates the digital UI. Money: `formatMinor(minor, currency)` and `parsePriceInput(text)` in `@/lib/money`. Uploads: `uploadToPresignedUrl` in `@/lib/upload`, and the deliver form in `app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx` (lines ~155-190) shows the exact upload-with-progress pattern, including the remount-the-file-input trick (`fileInputKey`). Raw mutations use `trpcClient` from `@/utils/trpc` (see project-detail) when several calls chain in one handler.

- [ ] **Step 1: The digital list + enable card** — `components/catalog/digital-products.tsx`:

```tsx
"use client";

// imports: useQuery/useMutation/useQueryClient, Link, Button (@jendal-workspace/ui/components/button),
// buttonVariants (@jendal-workspace/ui/lib/button-variants) for the "Add product" link, Loader, formatMinor, trpc

export default function DigitalProducts({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false });
  const products = useQuery({
    ...trpc.catalog.digitalList.queryOptions({ storeSlug: teamSlug }),
    enabled: team.data?.settings?.storeEnabled === true,
    retry: false,
  });
  const enable = useMutation(
    trpc.servicesTeam.setStoreEnabled.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    }),
  );

  if (team.isPending) return <Loader />;
  if (team.isError || !team.data) return <p role="alert">The products couldn&apos;t be loaded.</p>;

  const { settings, role } = team.data;
  const currency = settings?.currency ?? "USD";

  if (!settings?.storeEnabled) {
    return (
      <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div className="space-y-1">
          <Link href={`/${teamSlug}`} className="text-sm text-muted-foreground">{teamSlug}</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        </div>
        <section className="grid gap-2 border border-dashed p-8 text-center">
          <p className="font-medium">Sell digital downloads</p>
          <p className="text-sm text-muted-foreground">
            Turn on the store to sell files — presets, templates, icons — from your seller page.
          </p>
          <Button
            type="button"
            className="justify-self-center"
            onClick={() => enable.mutate({ teamSlug, enabled: true })}
            disabled={role !== "admin" || enable.isPending}
          >
            {enable.isPending ? "Turning on…" : "Turn on the store"}
          </Button>
          {role !== "admin" ? (
            <p className="text-sm text-muted-foreground">Only an admin can turn on the store.</p>
          ) : null}
          {enable.error ? <p role="alert" className="text-sm text-destructive">{enable.error.message}</p> : null}
        </section>
      </main>
    );
  }

  // enabled: the list (title, Published/Draft, price, file name) + "Add product" → /{slug}/products/new
  // mirror the existing ProductsList markup (border divide-y list linking to /{slug}/products/{id}),
  // minus image/variant/stock columns: "{status} · {formatMinor(priceMinor, currency)} · {fileName ?? 'No file'}"
}
```

- [ ] **Step 2: The digital form** — `components/catalog/digital-product-form.tsx`. One client component with two modes, mirroring how `ProductForm` is shared by new/edit (read `components/catalog/product-form.tsx` first for the mutation wiring style):

```tsx
"use client";

// props: { teamSlug: string; productId?: string }
// New mode: title, description, price text fields; Save calls catalog.digitalCreate, then
//   router.push(`/${teamSlug}/products/${created.id}`) so the file is uploaded on the edit page.
// Edit mode: loads catalog.digitalGet; same fields + Publish/Unpublish button (copy the pattern
//   from edit-product.tsx: one statusMutation, labels "Published"/"Draft") + the file section:
//
//   <section className="grid gap-2 border p-4">
//     <h2 className="font-medium">File buyers download</h2>
//     {fileName ? <p className="text-sm">{fileName}</p> : <p className="text-sm text-muted-foreground">No file yet.</p>}
//     <input key={fileInputKey} type="file" onChange={…} />
//     upload button: disabled without a picked file or while uploading; shows
//     {uploadProgress === null ? "Upload" : `Uploading… ${Math.round(uploadProgress * 100)}%`}
//   </section>
//
// Upload handler (async): start = await trpcClient.catalog.fileUploadStart.mutate({ storeSlug, productId, fileName: file.name, sizeBytes: file.size });
//   await uploadToPresignedUrl({ url: start.url, headers: start.headers, file, onProgress: setUploadProgress });
//   await trpcClient.catalog.fileAttach.mutate({ storeSlug, productId, uploadId: start.uploadId });
//   then invalidate digitalGet and clear the picked file (fileInputKey + 1).
// Price field: value string, parsed with parsePriceInput; invalid → inline problem
//   "Enter the price as an amount, for example 150 or 19.99." and Save disabled; use the same
//   problem wording for both modes. Validation runs through validateDigitalProductDraft from core
//   before submit; show the first problem in a <p role="alert"> like the request form does.
```

- [ ] **Step 3: Branch the three product pages by team kind.**

`products-list.tsx`: at the top, `const store = useQuery({ ...trpc.store.get.queryOptions({ storeSlug }), retry: false });` — while pending render `<Loader />`; when `store.data?.product === "services"` render `<DigitalProducts teamSlug={storeSlug} />`; otherwise the existing Commerce markup unchanged. (`store.get` in `routers/store.ts` returns `{ ...ctx.store, role }`, so the field is `store.data.product` directly.)

`new-product.tsx`: same `store.get` query; services → `<DigitalProductForm teamSlug={storeSlug} />` (keep the "Add a product" heading + back link), store → existing `<ProductForm storeSlug={storeSlug} />`.

`edit-product.tsx`: same query; services → `<DigitalProductForm teamSlug={storeSlug} productId={productId} />` inside the existing page shell, store → existing form.

- [ ] **Step 4: Dashboard** — `services-team-dashboard.tsx`:
  - `servicesTeamSetupSteps({...})` gains `productCount` from `result.data.productCount`.
  - Nav: after the Services link, when `settings?.storeEnabled`, `<Link href={\`/${team.slug}/products\`}>Products</Link>`.
  - After the Services section card, add:

```tsx
      <section className="grid gap-2 border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Store</h2>
          {settings?.storeEnabled ? (
            <Link href={`/${team.slug}/products`} className="text-sm underline underline-offset-4">
              Open products
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Sell digital downloads from your seller page — presets, templates, icons, any file up to 100 MB.
        </p>
        {!settings?.storeEnabled ? (
          <div>
            <button … enable.mutate({ teamSlug: team.slug, enabled: true }) …>Turn on the store</button>
          </div>
        ) : null}
      </section>
```
  (Wire the same `setStoreEnabled` mutation as the products page; admin-only, error in `role="alert"`.)

- [ ] **Step 5: The Commerce checklist fix (§11.1)** — `store-dashboard.tsx`: where it passes `productCount: products.data?.length ?? 0`, change to count only published:
```ts
productCount: products.data?.filter((product) => product.status === "published").length ?? 0,
```

- [ ] **Step 6: Type-check and tests** — `pnpm check-types` and `pnpm test` (root) pass. There are no web component tests; the pages are covered by the walkthrough. If you extracted any pure helper (you should not need one), test it in `apps/web/src/lib`.

- [ ] **Step 7: Commit** — `feat(web): digital products in the admin, the store toggle` (body: products pages branch on the team kind; dashboard Store card and Products nav; the Commerce checklist counts published products only). Co-authored-by trailer.

---

### Task 5: web storefront — the Store section on the seller page

**Files:**
- Modify: `apps/web/src/components/seller-page/seller-page.tsx` (`pageBase`, products section)
- Modify: `apps/web/src/app/store/page.tsx` (store teams with products get the seller page)
- Modify: `apps/web/src/app/admin/[storeSlug]/preview/seller-preview.tsx` (same branching, `pageBase`)
- Modify: `apps/web/src/lib/server-api.ts` — `fetchSellerPage` parses with a local zod `sellerPageSchema` (around line 60); add to it:

```ts
  products: z.array(
    z.object({ id: z.string(), title: z.string(), description: z.string(), priceMinor: z.number() }),
  ),
```

- [ ] **Step 1: SellerPage changes** — in `seller-page.tsx`:

```tsx
export type SellerPageProduct = { id: string; title: string; description: string; priceMinor: number };

export type SellerPageContent = {
  name: string;
  product: "services" | "store";
  bio: string;
  supportEmail: string | null;
  currency: string;
  // Base for on-page links: "" on the store host (relative), the absolute public origin in the admin preview.
  pageBase: string;
  departments: { id: string; name: string }[];
  offerings: SellerPageOffering[];
  products: SellerPageProduct[];
};
```

- Rename `requestBase` → `pageBase` everywhere in the component (request links become `${page.pageBase}/request…`).
- The Services section renders only when `page.product === "services"` (wrap the existing `<section aria-labelledby="services-heading">` in the condition).
- After it, the Store section:

```tsx
      {page.products.length > 0 ? (
        <section aria-labelledby="store-heading" className="space-y-6">
          <h2 id="store-heading" className="text-xl font-semibold">
            Store
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {page.products.map((product) => (
              <article key={product.id} className="border p-4 grid gap-2">
                <h3 className="font-medium">{product.title}</h3>
                {product.description ? <p className="whitespace-pre-line">{product.description}</p> : null}
                <p className="text-sm text-muted-foreground">{formatMinor(product.priceMinor, page.currency)}</p>
                <a
                  href={`${page.pageBase}/buy/${product.id}`}
                  aria-label={`Buy ${product.title}`}
                  className={buttonVariants({ variant: "outline", size: "sm", className: "justify-self-start" })}
                >
                  Buy
                </a>
              </article>
            ))}
          </div>
        </section>
      ) : null}
```
(import `formatMinor` from `@/lib/money`.)

- [ ] **Step 2: The store home** — `app/store/page.tsx`:

```tsx
export default async function StorefrontHome() {
  const store = await fetchStoreInfo();
  if (!store) notFound();
  const page = await fetchSellerPage();
  if (!page) notFound();
  if (store.product === "services" || page.products.length > 0) {
    return <SellerPage page={{ ...page, pageBase: "" }} />;
  }
  return <StoreHome name={store.name} />;
}
```
(Note: this changes the services path to also go through `fetchSellerPage` unconditionally — same call as before, just hoisted.)

- [ ] **Step 3: The preview** — `seller-preview.tsx`: replace the final line's ternary with:

```tsx
      {page.product === "services" || page.products.length > 0 ? (
        <SellerPage page={{ ...page, pageBase: url }} />
      ) : (
        <StoreHome name={page.name} />
      )}
```
(`trpc.seller.preview` returns `findSellerPage`'s row, which now carries `products` — the api change from Task 3/2 makes both call sites compile.)

- [ ] **Step 4: Run checks** — `pnpm check-types` and `pnpm test` (root) pass.

- [ ] **Step 5: Commit** — `feat(web): the Store section on the seller page` (body: products cards with Buy; the page renders for store teams once they have digital products; requestBase is now pageBase). Co-authored-by trailer.

---

### Task 6: Final review, merge, walkthrough (controller)

- [ ] **Step 1: Full verification in the worktree** — `pnpm test && pnpm check-types` (whole repo, from a clean install state: `pnpm install` first if lockfile changed).

- [ ] **Step 2: Final whole-branch review** — a fresh reviewer subagent reads the entire diff against this plan and the sellers design §3.2/§3.3/§5.1, plus a quality pass (error paths, race on file replace, FK cascade behavior, the renamed `pageBase` everywhere). Apply trivial fixes directly; loop the implementer for anything bigger.

- [ ] **Step 3: Merge** — apply the migration to the dev database (`pnpm db:migrate:dev` from the main worktree), merge into `main` with `--no-ff` and a message file, `pnpm install`, restart the dev stack (kill the dev PIDs found with `ss -tlnp`, `rm -rf apps/web/node_modules/.vite`, `pnpm dev` with fireAndForget; the tunnel keeps running).

- [ ] **Step 4: Walkthrough** (over the tunnel, signed in as Walk Through; walk-crew is published with two services, PayPal connected, support email walk-crew@example.com):
  1. walk-crew dashboard: no Products nav yet; the Store card offers "Turn on the store". Click it → Products nav appears.
  2. Products → Add product: "Icon pack", description, price 19 → Save lands on the edit page. Publish now → "Add the file buyers download before publishing."
  3. Upload a small allowed file (a `.zip` made on the spot) — progress shows, then the file name appears. Publish → Published.
  4. `https://walk-crew.payleor.app` shows the Store section: "Icon pack", description, $19.00, a Buy link to `/buy/{id}` (the target 404s until 4b — expected). The admin preview shows the same.
  5. Product-only publish rule: in the dev database give walk-crew-solo a PayPal merchant id (copy walk-crew's) and deactivate its services (`update services_offering set active=false …`). Its dashboard publish card first says "Add at least one active service or product before you publish."; add + publish a digital product (with a file) → publish works; unpublish afterwards and restore walk-crew-solo (delete the product, reactivate its services, clear the merchant id) unless the next run wants it published.
  6. Refusals: `fileUploadStart` with an `.exe` → "This file type is not allowed."; the products pages of a Commerce store (walk-store) still show the Commerce UI unchanged.
  7. Checklist: walk-crew's "Add a service or a product" is done; the store checklist on walk-store counts only published products.
- [ ] **Step 5: Record the outcome** in this plan (merge commit, test count, deviations, walkthrough results) and update the sellers design §11 run 4 row (4a done) and §11.1 (close the store-checklist row; add: product images skipped to backlog, store teams still show the placeholder home, Buy links dead until 4b). Update `specs/README.md`.

### Out of scope (run 4b, already designed)

`/buy/{productId}` checkout with the PayPal buttons (reuse `paypal-checkout.tsx`), the `orders` and `download_grants` tables, capture → paid + download grant, the buyer email from `stores@payleor.com`, the order page with the download button and "email me a new link", the admin orders list, and the `PAYMENT.CAPTURE.REFUNDED` webhook (currently parked in `paypal-webhooks.ts` with the note "refunds and reversals need a person (run 4)").

---

## Outcome

Merged into `main` as `2df314e` on 2026-10-10 (1124 tests, check-types clean). Migration `20261009025118_r4a_digital_products` applied to the dev database.

Commits:
- `51033df`: core. Digital product rules, the `product` file purpose, the wider publish wording, and the "Add a service or a product" step.
- `57036ee` and `9894d4e`: db. `products.kind`, `file_upload.product_id`, the digital queries and `seedProduct`.
- `29ea201` and `ce7c0f8`: api. The digital procedures, upload and attach, the publish branch, `setStoreEnabled` and `productCount`. The review fix locks the product row so concurrent attaches leave exactly one file. Task 3's first worker ran out of usage midway; its uncommitted work passed checks and was finished in place.
- `6cf2f57` and `8ac91c1`: web admin. The review fix keeps Save disabled after a create, so a second click cannot create a duplicate.
- `9ee5adc` and `119e64e`: web storefront.
- `fc258a6`: final-review fixes.

Deviations from the plan:
- **Team access in `storeProcedure`.** It now resolves services teams the way `servicesTeamProcedure` does (services-team roles, org owners and admins count as team admins). Commerce stores keep `findStoreAccess`. Each procedure checks the team kind: `requireCommerceStore` guards the physical procedures (list, get, create, update, lookups, market price) and `requireServicesTeam` guards the digital ones. Managing products needs `manage_settings` ("Only an admin can manage products."), including publish and unpublish on a services team.
- **Editing a published digital product re-checks the publish rules.** A save that would break them (for example price 0) is refused.
- **The client also checks files.** The form checks type and size before uploading, and the file input only offers allowed types.
- **The seller page empty state.** A services team with products but no active services still shows the Services heading with the "Request a quote for custom work." link, because the request form works without services.

Walkthrough on 2026-10-10 over the tunnel, signed in as Walk Through. Everything passed:
1. **walk-crew dashboard.** There was no Products link, and the Store card offered "Turn on the store". After turning it on, the Products link and "Open products" appeared.
2. **New product.** Add product: "Icon pack", $19, saved, and landed on the edit page. Publishing refused with "Add the file buyers download before publishing."
3. **Upload and publish.** Uploading `icon-pack.zip` showed the file name, and Publish then succeeded. The list shows "Published · $19.00 · icon-pack.zip". The first upload hung at 0% until the Playwright context was granted `local-network-access` for `admin.payleor.com` (the R2b dev note; Mouhamed allowed it in his Chrome too). The hung attempt left one unattached upload row, which the maintenance sweep removes.
4. **Seller page.** `walk-crew.payleor.app` shows the Store section under Services with Icon pack, its description, $19.00, and Buy linking to `/buy/{id}` (aria-label "Buy Icon pack"). The admin preview shows the same, with an absolute link. Screenshot: `specs/platform/walkthroughs/r4a-seller-page.png`.
5. **Product-only publish (walk-crew-solo).** I gave it a placeholder merchant id `WALKSOLOTEST1`, because merchant ids are unique and walk-crew's could not be copied, and deactivated its active service. The publish card said "Add at least one active service or product before you publish." Then I turned on the store and added "Brush set" ($9.50) with a file. Publishing the product, then the seller page, worked, and the public page showed the Store section. Afterwards I restored walk-crew-solo in the database: draft, no merchant id, Logo design active again, store off, product deleted.
6. **Refusals and the Commerce store.** An `.exe` was refused in the form ("This file type is not allowed.", Upload disabled) and by `catalog.fileUploadStart` (BAD_REQUEST, same message). walk-store's products page still shows the Commerce list ("Men's Tree Runner · Draft · 10 variants").
7. **Checklists.** walk-crew's "Add a service or a product" is done. walk-store's "Add your first product" is still to do, because its only product is a draft.

walk-crew keeps "Icon pack" published (store on) for the run 4b checkout walkthrough.
