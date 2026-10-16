# R3b: The Seller Page, Publishing and the Admin Preview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A services team's seller page is served at `{slug}.{storeDomain}`. It shows the name, the bio, the active services grouped by department, and a footer with the seller's policies and Payleor's legal pages. Stores and services teams stay drafts until an admin publishes them. Publishing needs PayPal connected and at least one active service (for a store, at least one published product). Members see the page before it goes live through a preview inside the admin. The public host shows nothing for a draft.

**Architecture:**
- `core`: `StoreRecord` gains `product`. "Reachable" becomes "public" (`status === "active"`). New: the publish rules, a publish step in both checklists, and the policy list per product.
- `db`: the storefront directory resolves both products. A `seller-page` repository builds the page data, and `setTeamStatus` publishes and unpublishes.
- `apps/server`: the `/api/store` routes return the product and the page data, and an invalidation hook drops the KV lookups when a team publishes or unpublishes.
- `api`: a `seller` router (`status`, `preview`, `publish`, `unpublish`) behind a `sellerProcedure` that opens stores and services teams alike.
- `web`: one `SellerPage` component, rendered by the store host and by the admin's `/{slug}/preview`; a publish card on both dashboards; policies written for services; a footer that links Payleor's legal pages.

**Tech Stack:** TypeScript, Drizzle ORM 1.0 rc (Postgres), Hono, tRPC 11, Zod 4, TanStack Query 5, vinext (the Next.js API on Vite), Vitest 5, Cloudflare KV.

**Design:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md): §3.2 (setup), §3.3 (the seller page), §8 (Payleor's role), §11 run 3, and the §11.1 rows owned by 3b.

**Decisions (2026-10-08, from Mouhamed):**

- **Run 3 continues as 3b and 3c.**
  - 3b (this plan): the seller page, publishing, the preview, and policies for services.
  - 3c: the request form with its emails and limits (3 open requests per email per team, per-IP and per-email rate limits, a hidden honeypot field; Turnstile waits for the deploy run).
- **The preview lives inside the admin.**
  - `admin.{platform}/{slug}/preview` renders the same `SellerPage` component as the public host, for members only, through tRPC with the admin session.
  - The public host never shows a draft, because the admin session cookie never reaches it.
- **Publishing rules.**
  - To publish, a seller needs PayPal connected and at least one active service (a store: at least one published product).
  - Admins can publish and unpublish at any time.
  - A suspended seller can do neither.
  - This applies to stores and services teams alike, so the existing draft stores disappear from the public host until they are published (none is a real shop yet).
- **No form yet.** Until 3c builds the request form, "Request a quote" on a service card is a `mailto:` link to the team's support email, with the service in the subject. There is no button when the team has no support email.
- **A live page can go empty.** Publishing checks the rules once. If an admin hides the last service of a live page, the page stays live and shows "No services listed right now." There is no automatic unpublish.

**Also in this run (the §11.1 rows owned by 3b):**
- the solo wording ("Set up your seller page", "Settings");
- `project.assign` refused on a solo team;
- the new-service form shows its first problem only after a field is touched, with clearer price wording.

**Out of scope:**
- the request form, emails and limits (3c);
- the store section of the seller page and digital products (run 4);
- custom domains for services teams;
- the `admin.` → `dash.` rename (backlog, before run 7). Do not add new `admin.` hardcoding; admin links stay relative.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/r3b-seller-page`, created in Task 0.
- Tests that need Postgres use `jendal-pg` through `.env.test.local`.
- The full suite takes about 7 minutes, so run targeted tests per task.
- The web package filter is `-F web`.
- Every commit ends with the trailer `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`.

## Facts this plan relies on (checked at `444c1f4`)

1. **Store host routing.**
   - `routeForHost` (`apps/web/src/lib/host-routing.ts:11-31`) rewrites a store host to the `/store` route tree: `app/store/{layout,page}.tsx` and `app/store/policies/[policy]/page.tsx`.
   - `parseRequestTarget` (`packages/core/src/tenancy/target.ts:58-111`) turns `{slug}.{storeDomain}` into `{ kind: "store", slug }`.
   - Store pages call the api Worker's Hono routes through `callApi` (`apps/web/src/lib/server-api.ts:15-18`), which keeps the original host and sends no cookie. Those routes are `/api/store` and `/api/store/policy-info` (`apps/server/src/routes/store-info.ts`).
2. **Store resolution.**
   - `tenantMiddleware` (`apps/server/src/tenant/middleware.ts:45-51`, mounted on `/api/store/*` at `apps/server/src/index.ts:60-66`) resolves the team through `createStoreDirectory` (`packages/db/src/repositories/stores.ts:20-48`) and a KV cache (`apps/server/src/tenant/kv-store-cache.ts`, keys `store:slug:{slug}`, `store:id:{id}`, `store:host:{host}`, 300 s TTL, zod-parsed).
   - The directory filters `team.product = 'store'` (`stores.ts:17-18`).
   - `isStoreReachable` (`packages/core/src/tenancy/store.ts:26-28`) only blocks `suspended`, so drafts are public today.
3. **Cache invalidation.** `getPayPalServices().onTeamMerchantChanged` (`apps/server/src/services.ts:47-55`) deletes `id:` and `slug:` keys; `host:` keys expire. Nothing else invalidates.
4. **Team status.**
   - `team.status` is `draft | active | suspended`, default `draft` (`packages/db/src/schema/organization.ts:56-73`). It is `input: false` in Better Auth (`packages/auth/src/index.ts:47`), so only our own repository writes it.
   - Nothing writes `active` today.
   - `ServicesTeamRecord` (`packages/core/src/services-teams/types.ts:14-20`) and `servicesTeamColumns` (`packages/db/src/repositories/services-teams.ts:19-25`) have no `status`.
   - `seedStore` takes `status`; `seedServicesTeam` does not (`packages/db/src/testing/db.ts:67-123`).
5. **Access.**
   - `storeProcedure` (`packages/api/src/store-procedure.ts`) opens a store for `canOpenStore` (org owners and admins, or team members) through `findStoreAccess`. `ctx.role` is the org role, and `hasStoreWideRole(role)` means owner or admin.
   - `servicesTeamProcedure` (`packages/api/src/services-team-procedure.ts`) uses `findServicesTeamBySlug` plus `servicesTeamRoleFor`, and `canServicesTeam(role, "manage_settings")` is admin-only.
   - Both report a team the caller cannot open as `NOT_FOUND`.
6. **Counts.**
   - `countServicesOfferings(db, teamId, { activeOnly })` and `listServicesOfferings(db, teamId, { activeOnly })` and `listServicesDepartments` are in `packages/db/src/repositories/services-catalog.ts`.
   - `products` has `store_id` and `status` (`draft | published`) with index `idx_products_store_status` (`packages/db/src/schema/catalog.ts:23-40`).
7. **Checklists.**
   - `setupSteps(store, links, progress)` (`packages/core/src/onboarding/setup-steps.ts`) ends with `visit-storefront` (done when `status === "active"`).
   - `servicesTeamSetupSteps(state, links)` is in `packages/core/src/services-teams/setup-steps.ts`.
   - `SetupChecklist` (`apps/web/src/components/setup-checklist.tsx`) treats a `#…` href as an in-page anchor.
8. **Policies.**
   - `STORE_POLICIES = ["returns", "shipping", "terms", "privacy"]` (`packages/core/src/policies/store-policies.ts`).
   - The TSX templates live in `apps/web/src/content/store-policies/` (`PolicyStore = { name, url, supportEmail }`, `StoreContact`, `StoreLink` in `shared.tsx`). They are written for goods.
   - `team.support_email` is set for both products at creation.
   - The store footer (`app/store/layout.tsx`) links only the store's policies.
   - Payleor's legal pages are `/legal/{terms,privacy,acceptable-use}` on the platform `www` host, so they need absolute URLs from a store host.
   - `getPlatformOrigins()` (`server-api.ts:29-31`) returns `{ site, admin }`.
9. **Dashboards.**
   - `app/admin/[storeSlug]/page.tsx` picks `ServicesTeamDashboard` or `StoreDashboard` (the latter gets `urlParts` from `getStoreUrlParts()`).
   - The store dashboard shows "Draft · Connect PayPal to start selling." (`store-dashboard.tsx:60`).
   - The services dashboard checklist title is "Set up your team" (`services-team-dashboard.tsx:63`).
10. **Formatting helpers.**
    - `apps/web/src/app/admin/[storeSlug]/services/services-catalog.tsx` has local `priceLabel`/`daysLabel` helpers.
    - `formatMinor(minor, currency)` is in `apps/web/src/lib/money.ts`.
11. **Tests.**
    - Router tests: `appRouter.createCaller({ db, session, environment: "sandbox", auth: createTestAuth(db).auth, headers: new Headers(), catalog: createTestCatalogServices(), files: createFakeFileStore() })` (see `packages/api/src/routers/services-team.test.ts`).
    - Seeds: `seedOrganization`, `seedStore`, `seedServicesTeam`, `seedServicesTeamWithAdmin`, `seedServicesTeamMember`, `seedServicesOffering`, `seedProject`.
    - Server route tests: `apps/server/src/tenant/middleware.test.ts` (in-memory directory and cache).
    - KV adapter tests: `kv-store-cache.test.ts`.

---

### Task 0: Worktree (controller)

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git status --short   # must be empty
git worktree add -b r3b-seller-page ../r3b-seller-page main
cp .env.test.local ../r3b-seller-page/.env.test.local
cd ../r3b-seller-page && pnpm install && pnpm check-types
```

---

### Task 1: Core: the product on store records, public visibility, the publish rules, checklists and policy lists

**Files:**
- Modify: `packages/core/src/tenancy/store.ts`, `packages/core/src/services-teams/types.ts`, `packages/core/src/onboarding/setup-steps.ts` (+ test), `packages/core/src/services-teams/setup-steps.ts` (+ test), `packages/core/src/policies/store-policies.ts` (+ test if one exists), `packages/core/src/index.ts`
- Create: `packages/core/src/sellers/publish.ts`, `packages/core/src/sellers/publish.test.ts`

- [ ] **Step 1: Failing tests.**

  `packages/core/src/sellers/publish.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { publishProblem } from "./publish";

const ready = { product: "services" as const, status: "draft" as const, paypalMerchantId: "M1", listedCount: 1 };

describe("publishProblem", () => {
  it("lets a seller with PayPal and something to sell publish", () => {
    expect(publishProblem(ready)).toBeNull();
    expect(publishProblem({ ...ready, status: "active" })).toBeNull();
    expect(publishProblem({ ...ready, product: "store" })).toBeNull();
  });

  it("needs PayPal first", () => {
    expect(publishProblem({ ...ready, paypalMerchantId: null })).toBe("Connect PayPal before you publish.");
  });

  it("needs an active service, or a published product for a store", () => {
    expect(publishProblem({ ...ready, listedCount: 0 })).toBe("Add at least one active service before you publish.");
    expect(publishProblem({ ...ready, product: "store", listedCount: 0 })).toBe(
      "Publish at least one product before you publish your store.",
    );
  });

  it("refuses a suspended seller before anything else", () => {
    expect(publishProblem({ ...ready, status: "suspended", paypalMerchantId: null })).toBe(
      "This seller is suspended. Contact support@payleor.com.",
    );
  });
});
```

  Checklists:
  - `packages/core/src/onboarding/setup-steps.test.ts`: the last store step is now `{ id: "publish", label: "Publish your store", done: false, href: "#publish" }` for a draft, and `done: true` for `status: "active"`. `visit-storefront` is gone.
  - `packages/core/src/services-teams/setup-steps.test.ts`: the state gains `status`. A team's steps are `create-team`, `add-service`, `connect-paypal`, `set-rates`, `add-payout-credentials`, `publish`, `link-discord`. A solo seller's are `create-team`, `add-service`, `connect-paypal`, `publish`, `link-discord`. `publish` is labelled "Publish your seller page" for both, is done when `status === "active"`, and links to `links.publish`.

  Policies, in `packages/core/src/policies/store-policies.test.ts` (create it if missing): `policiesFor("store")` equals `STORE_POLICIES`; `policiesFor("services")` equals `["terms", "privacy"]`.

- [ ] **Step 2: Run** `pnpm test packages/core`. Expected: FAIL.

- [ ] **Step 3: Implement.**

  `packages/core/src/tenancy/store.ts`:

```ts
import type { TeamProduct } from "./team-product";

export type StoreStatus = "draft" | "active" | "suspended";

// A store or a services team (one slug namespace, one storefront host); `id` is the team ID.
export type StoreRecord = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  status: StoreStatus;
  product: TeamProduct;
  paypalMerchantId: string | null;
};
```

  Keep `StoreDirectory` and `StoreLookupCache` as they are. Replace `isStoreReachable` with:

```ts
// Sellers design §3.3: the public host shows only published sellers. Members preview drafts in the admin.
export function isStorePublic(store: StoreRecord): boolean {
  return store.status === "active";
}
```

  `packages/core/src/sellers/publish.ts`:

```ts
import type { StoreStatus } from "../tenancy/store";
import type { TeamProduct } from "../tenancy/team-product";

export type PublishState = {
  product: TeamProduct;
  status: StoreStatus;
  paypalMerchantId: string | null;
  // Active services for a services team, published products for a store.
  listedCount: number;
};

// Sellers design §3.2: a seller publishes once it can take payments and has something to sell.
export function publishProblem(state: PublishState): string | null {
  if (state.status === "suspended") return "This seller is suspended. Contact support@payleor.com.";
  if (state.paypalMerchantId === null) return "Connect PayPal before you publish.";
  if (state.listedCount === 0) {
    return state.product === "services"
      ? "Add at least one active service before you publish."
      : "Publish at least one product before you publish your store.";
  }
  return null;
}
```

  `packages/core/src/services-teams/types.ts`: `ServicesTeamRecord` gains `status: StoreStatus` (import the type from `../tenancy/store`).

  `packages/core/src/onboarding/setup-steps.ts`:
  - `links` becomes `{ productsUrl: string; connectPaypal?: string; publish?: string }`, dropping `storefrontUrl`.
  - Replace the last step with:

```ts
    { id: "publish", label: "Publish your store", done: store.status === "active", ...(links.publish ? { href: links.publish } : {}) },
```

  `packages/core/src/services-teams/setup-steps.ts`:
  - The state gains `status: StoreStatus`, and `ServicesTeamSetupLinks` gains `publish?: string`.
  - Insert before `link-discord`:

```ts
    // Sellers design §3.3: the seller page stays a draft until an admin publishes it.
    step("publish", "Publish your seller page", state.status === "active", links.publish),
```

  `packages/core/src/policies/store-policies.ts`:

```ts
// A services team sells no goods, so it has no return or shipping policy.
export const SERVICES_POLICIES = ["terms", "privacy"] as const satisfies readonly StorePolicy[];

export function policiesFor(product: TeamProduct): readonly StorePolicy[] {
  return product === "services" ? SERVICES_POLICIES : STORE_POLICIES;
}
```

  Export `./sellers/publish` from `packages/core/src/index.ts`, following the file's existing `export *` lines.

- [ ] **Step 4: Run** `pnpm test packages/core`. Expected: PASS.
  - Run `pnpm check-types` and fix every caller the type changes break, without weakening types:
    - `StoreRecord` literals in tests and seeds gain `product`;
    - `isStoreReachable` has one caller (the middleware); switch it to `isStorePublic`;
    - the store dashboard's `setupSteps` call loses `storefrontUrl` and gains `publish: "#publish"`;
    - the services dashboard passes `status: team.status` and `publish: "#publish"`.
  - Task 1 must leave the whole monorepo compiling, so make these minimal additions here too:
    - `product: team.product` in `storeColumns` (keep the `isStore()` filters for now);
    - `status: team.status` in `servicesTeamColumns`;
    - `product: z.enum(TEAM_PRODUCTS)` in the KV `cachedStoreSchema`.

    Tasks 2 and 3 add the behavior and the tests on top.
  - **Commit** `feat(core): public sellers, the publish rules and step, policies per product`.

---

### Task 2: Db: both products in the directory, the seller page data, the team status

**Files:**
- Modify: `packages/db/src/repositories/stores.ts` (+ `stores.test.ts`), `packages/db/src/repositories/services-teams.ts` (+ test), `packages/db/src/testing/db.ts`
- Create: `packages/db/src/repositories/seller-page.ts`, `packages/db/src/repositories/seller-page.test.ts`

- [ ] **Step 1: Failing tests.**
  - `stores.test.ts`:
    - the directory's `findBySlug` and `findById` now return a services team too, with `product: "services"`, and a store with `product: "store"`;
    - `findStoreAccess` and `listOrganizationsWithStores` still return stores only;
    - `setTeamStatus(db, { teamId, status: "active" })` returns `{ slug }` and stores `active`; `"draft"` sets it back;
    - a `suspended` team is left alone and the call returns `null`; an unknown id returns `null`;
    - `countPublishedProducts(db, storeId)` counts only `published` products of that store.
  - `seller-page.test.ts`:
    - `findSellerPage(db, teamId)` for a services team returns name, slug, `product: "services"`, status, the trimmed bio, `supportEmail`, the settings currency, its departments in order, and only the **active** offerings in position order with every field the card needs;
    - for a store it returns `bio: ""`, `currency: "USD"`, `departments: []`, `offerings: []`;
    - an unknown id returns `null`.
  - `services-teams.test.ts`: `findServicesTeamBySlug` returns `status`.

- [ ] **Step 2: Run** `pnpm test packages/db`. Expected: FAIL.

- [ ] **Step 3: Implement.**

  `stores.ts`:
  - `storeColumns` gains `product: team.product`.
  - `createStoreDirectory`'s three finders drop `isStore()`.
  - Rewrite the comment above `isStore`: "The storefront host serves stores and services teams' seller pages; the admin's store lists and store access stay store-only."
  - Keep `isStore()` in `findStoreAccess` and `listOrganizationsWithStores`.
  - Add:

```ts
// team.status is input: false in Better Auth, so publishing writes it here. A suspended team stays suspended.
export async function setTeamStatus(
  db: Database,
  input: { teamId: string; status: "draft" | "active" },
): Promise<{ slug: string } | null> {
  const [row] = await db
    .update(team)
    .set({ status: input.status })
    .where(and(eq(team.id, input.teamId), ne(team.status, "suspended")))
    .returning({ slug: team.slug });
  return row ?? null;
}

export async function countPublishedProducts(db: Database, storeId: string): Promise<number>
```

  (`countPublishedProducts` is `select count(*)::int from products where store_id = $1 and status = 'published'`. Import `products` from `../schema/catalog` and `ne` from `drizzle-orm`.)

  `services-teams.ts`: `servicesTeamColumns` gains `status: team.status`.

  `seller-page.ts`:

```ts
import type { StoreStatus, TeamProduct } from "@jendal-workspace/core";
import { eq } from "drizzle-orm";

import type { Database } from "../index";
import { team } from "../schema/organization";
import { servicesTeamSettings } from "../schema/services-teams";
import {
  listServicesDepartments,
  listServicesOfferings,
  type ServicesDepartmentRow,
  type ServicesOfferingRow,
} from "./services-catalog";

// Sellers design §3.3: what the seller page shows. The same data feeds the public host and the admin preview.
export type SellerPageData = {
  name: string;
  slug: string;
  product: TeamProduct;
  status: StoreStatus;
  bio: string;
  supportEmail: string | null;
  currency: string;
  departments: ServicesDepartmentRow[];
  offerings: ServicesOfferingRow[];
};

export async function findSellerPage(db: Database, teamId: string): Promise<SellerPageData | null>
```

  Implementation of `findSellerPage`:
  - Select the team row (`name`, `slug`, `product`, `status`, `supportEmail`) left-joined with `services_team_settings` (`bio`, `currency`).
  - For `product === "services"`, run `Promise.all([listServicesDepartments(db, teamId), listServicesOfferings(db, teamId, { activeOnly: true })])`.
  - For a store, return empty lists.
  - `bio` is `settings?.bio ?? ""`; `currency` is `settings?.currency ?? "USD"`.

  `testing/db.ts`: `seedServicesTeam` gains `status?: "draft" | "active" | "suspended"` (default `"draft"`).

- [ ] **Step 4: Run** `pnpm test packages/db` and `pnpm check-types`. Expected: PASS. **Commit** `feat(db): services teams on the storefront host, the seller page data, publishing`.

---

### Task 3: Server: the store routes, public visibility, cache invalidation

**Files:**
- Modify: `apps/server/src/tenant/kv-store-cache.ts` (+ test), `apps/server/src/tenant/middleware.ts` (+ test), `apps/server/src/routes/store-info.ts`, `apps/server/src/services.ts`, `apps/server/src/context.ts`, `packages/api/src/context.ts`
- Test: `apps/server/src/tenant/middleware.test.ts`, `apps/server/src/tenant/kv-store-cache.test.ts`, a new `apps/server/src/routes/store-info.test.ts` if none exists (follow the middleware test's in-memory setup and use the test database through `createTestDb` for `/api/store/page`; if the server tests have no database access, test the route with a stubbed `findSellerPage` through a small injected function instead and say so)

- [ ] **Step 1: Failing tests.**
  - Middleware:
    - a `draft` store answers 404 `store_not_found`, and so does a `suspended` one;
    - an `active` store passes;
    - an `active` services team passes, with `product: "services"` in `c.get("store")`.
  - KV cache: a cached entry without `product` reads as `null` (a miss, so the next request refetches), and an entry with `product` round-trips.
  - Routes:
    - `/api/store` returns `{ storeId, slug, name, product }`;
    - `/api/store/policy-info` also returns `product`;
    - `/api/store/page` returns the `findSellerPage` data for the resolved team, with offerings, departments, bio, currency and supportEmail.

- [ ] **Step 2: Run** `pnpm test apps/server`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `kv-store-cache.ts`: `cachedStoreSchema` gains `product: z.enum(TEAM_PRODUCTS)` (import from `@jendal-workspace/core`).
  - `middleware.ts`: `isStorePublic(store)` replaces `isStoreReachable(store)`.
  - `store-info.ts`:
    - add `product: store.product` to both existing responses;
    - add the route:

```ts
  .get("/api/store/page", async (c) => {
    const store = c.get("store");
    if (!store) return c.json({ error: "not_a_store_host" }, 404);
    const page = await findSellerPage(c.get("db"), store.id);
    if (!page) return c.json({ error: "store_not_found" }, 404);
    return c.json(page);
  })
```

  `services.ts`: extract the deletes into one exported function and use it in `onTeamMerchantChanged`:

```ts
// A change to team.paypal_merchant_id or team.status must drop the cached storefront lookups (cacheKeyFor in
// packages/core/src/tenancy/resolve.ts). host: entries cannot be enumerated; they expire within the 300-second TTL.
export async function invalidateStoreLookup(team: { id: string; slug: string }): Promise<void> {
  const cache = createKvStoreCache(ENV.STORE_CACHE);
  await cache.delete(`id:${team.id}`);
  await cache.delete(`slug:${team.slug}`);
}
```

  `packages/api/src/context.ts`: `Context` gains

```ts
  // Called after team.status changes (publishing); the api Worker drops the KV storefront lookups. Absent in tests.
  onTeamStatusChanged?: (team: { id: string; slug: string }) => void | Promise<void>;
```

  `apps/server/src/context.ts` passes `onTeamStatusChanged: invalidateStoreLookup`.

- [ ] **Step 4: Run** `pnpm test apps/server` and `pnpm check-types`. Expected: PASS. **Commit** `feat(server): seller pages on the storefront host, drafts hidden, lookups dropped on publish`.

---

### Task 4: Api: the `seller` router

**Files:**
- Create: `packages/api/src/seller-procedure.ts`, `packages/api/src/routers/seller.ts`, `packages/api/src/routers/seller.test.ts`
- Modify: `packages/api/src/routers/index.ts`

- [ ] **Step 1: Failing tests** in `seller.test.ts`. Copy the caller setup from `services-team.test.ts`, and add `onTeamStatusChanged: vi.fn()` to the context where a test checks it.
  - **Opening a seller.**
    - Every procedure answers `NOT_FOUND` "Seller not found." for an unknown slug, for an outsider, and for a store member who is neither an org owner/admin nor on the store's team.
    - A services team freelancer can read `status` and `preview` but not publish.
  - **`status`** returns `{ product, status, listedCount, problem, canManage }`.
    - A services team counts active services only.
    - A store counts published products.
    - `problem` is `publishProblem(...)`.
    - `canManage` is true for a services admin (`manage_settings`) and for a store org owner/admin, and false for a manager, a freelancer, or a store team member.
  - **`preview`** returns the `findSellerPage` data for any member who can open the seller, whatever the status.
  - **`publish`.**
    - Refuses a non-admin with `FORBIDDEN` "Only an admin can publish or unpublish."
    - Refuses with `BAD_REQUEST` and the rule's message when there is no PayPal ("Connect PayPal before you publish.") and when no service is active ("Add at least one active service before you publish."; hidden services do not count).
    - Refuses a store with no published product ("Publish at least one product before you publish your store.").
    - Otherwise sets `active`, calls `onTeamStatusChanged` with `{ id, slug }`, and returns `{ status: "active" }`.
    - Publishing an already active seller is fine and returns `active`.
  - **`unpublish`** is admin-only, sets `draft`, calls `onTeamStatusChanged`, and returns `{ status: "draft" }`.
  - **Suspended.** A suspended seller gets `BAD_REQUEST` "This seller is suspended. Contact support@payleor.com." from both `publish` and `unpublish`.

- [ ] **Step 2: Run** `pnpm test packages/api/src/routers/seller.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

  `seller-procedure.ts`:

```ts
import { canOpenStore, canServicesTeam, hasStoreWideRole, type StoreRecord } from "@jendal-workspace/core";
import { findStoreAccess } from "@jendal-workspace/db/repositories/stores";
import { findServicesTeamBySlug, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure } from "./index";

// A store or a services team, opened by any member; canManage is who may publish (store: org owner or admin;
// services team: an admin). A seller the caller cannot open reads as missing, like the other procedures.
export const sellerProcedure = protectedProcedure
  .input(z.object({ teamSlug: z.string().trim().toLowerCase().min(1) }))
  .use(async ({ ctx, input, next }) => {
    const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Seller not found." });
    const storeAccess = await findStoreAccess(ctx.db, { slug: input.teamSlug, userId: ctx.session.user.id });
    if (storeAccess) {
      if (!canOpenStore(storeAccess)) throw notFound();
      return next({ ctx: { seller: storeAccess.store, canManage: hasStoreWideRole(storeAccess.role) } });
    }
    const team = await findServicesTeamBySlug(ctx.db, input.teamSlug);
    if (!team) throw notFound();
    const role = await servicesTeamRoleFor(ctx.db, team.id, ctx.session.user.id);
    if (!role) throw notFound();
    const seller: StoreRecord = { ...team, product: "services" };
    return next({ ctx: { seller, canManage: canServicesTeam(role, "manage_settings") } });
  });
```

  `routers/seller.ts`:
  - `listedCount(ctx)`: for `services`, `countServicesOfferings(db, id, { activeOnly: true })`; for a store, `countPublishedProducts(db, id)`.
  - `status`: query. Return `{ product, status, listedCount, problem: publishProblem({ product, status, paypalMerchantId, listedCount }), canManage }`.
  - `preview`: query. `findSellerPage(ctx.db, ctx.seller.id)`, and throw `NOT_FOUND` if null.
  - `publish`:
    1. `if (!canManage) FORBIDDEN "Only an admin can publish or unpublish."`
    2. Compute `problem`; if set, throw `BAD_REQUEST` with it.
    3. `setTeamStatus(db, { teamId, status: "active" })`. A `null` result is the suspended race: throw `BAD_REQUEST` with the suspended message.
    4. `await ctx.onTeamStatusChanged?.({ id, slug })`.
    5. Return `{ status: "active" as const }`.
  - `unpublish`: the same without the rule check. For a suspended status, check first and throw the suspended message.

  Register `seller: sellerRouter` in `routers/index.ts`, alphabetically.

- [ ] **Step 4: Run** `pnpm test packages/api` and `pnpm check-types`. Expected: PASS. **Commit** `feat(api): publish, unpublish and preview a seller`.

---

### Task 5: Web: the `SellerPage` component and the store host

**Files:**
- Create: `apps/web/src/lib/offering-labels.ts` (+ `offering-labels.test.ts`), `apps/web/src/components/seller-page/seller-page.tsx`, `apps/web/src/components/seller-page/store-home.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/services/services-catalog.tsx` (use the shared labels), `apps/web/src/lib/server-api.ts`, `apps/web/src/app/store/page.tsx`

- [ ] **Step 1: The labels.** Move `priceLabel` and `daysLabel` out of `services-catalog.tsx` into `apps/web/src/lib/offering-labels.ts` (same behavior: one price when min equals max, else `"{min} – {max}"` with `formatMinor`; one day count when equal, else `"{min}–{max} days"`, singular "1 day"). Import them back into `services-catalog.tsx`. Test them in `offering-labels.test.ts`: a range, a fixed price, "1 day", "1–3 days".

- [ ] **Step 2: `server-api.ts`.**
  - `storeInfoSchema` and `storePolicyInfoSchema` gain `product: z.enum(["store", "services"])`.
  - Add:

```ts
const offeringSchema = z.object({
  id: z.string(),
  departmentId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  priceMinMinor: z.number(),
  priceMaxMinor: z.number(),
  daysMin: z.number(),
  daysMax: z.number(),
  intakeQuestions: z.array(z.string()),
  active: z.boolean(),
  position: z.number(),
});
const sellerPageSchema = z.object({
  name: z.string(),
  slug: z.string(),
  product: z.enum(["store", "services"]),
  status: z.enum(["draft", "active", "suspended"]),
  bio: z.string(),
  supportEmail: z.string().nullable(),
  currency: z.string(),
  departments: z.array(z.object({ id: z.string(), name: z.string(), position: z.number() })),
  offerings: z.array(offeringSchema),
});
export type SellerPageView = z.infer<typeof sellerPageSchema>;

export async function fetchSellerPage(): Promise<SellerPageView | null> {
  const response = await callApi("/api/store/page");
  if (!response.ok) return null;
  const parsed = sellerPageSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}
```

- [ ] **Step 3: `SellerPage`** (`components/seller-page/seller-page.tsx`, a server-safe component with no hooks, used by the store host and, client-side, by the admin preview).
  - Props: `{ page: SellerPageView }`. The tRPC `seller.preview` output has the same shape; type the prop structurally so both fit.
  - Layout: `main.container.mx-auto.max-w-3xl.px-4.py-10.space-y-10`.
  - **Header:** `h1` with the name (`text-3xl font-semibold tracking-tight`), then the bio paragraph when it is not empty (`text-muted-foreground`).
  - **Services:** `section aria-labelledby="services-heading"` with `h2` "Services".
    - Group the offerings by department in the departments' order. Show a department heading (`h3`) only for departments with at least one offering, then the offerings with no department, under no heading.
    - Each offering is an `article` card (`border p-4 grid gap-2`) with:
      - `h3`/`h4` name;
      - the description as `whitespace-pre-line`, only when not empty;
      - a line `"{priceLabel} · {daysLabel}"`, with "Usually" in front: `Usually {price} · {days}`;
      - a "Request a quote" link when `supportEmail` is set (`buttonVariants({ variant: "outline", size: "sm" })`, `justify-self-start`):

```tsx
<a href={`mailto:${page.supportEmail}?subject=${encodeURIComponent(`Quote request: ${offering.name}`)}`}>Request a quote</a>
```

    - When there are no offerings: `<p className="text-muted-foreground">No services listed right now.</p>`.
  - No store section (run 4).

  `store-home.tsx` holds the current store home markup (`h1` name and "This store is getting ready."), taking `{ name: string }`.

- [ ] **Step 4: The store host.** `app/store/page.tsx`:

```tsx
export default async function StorefrontHome() {
  const store = await fetchStoreInfo();
  if (!store) notFound();
  if (store.product === "services") {
    const page = await fetchSellerPage();
    if (!page) notFound();
    return <SellerPage page={page} />;
  }
  return <StoreHome name={store.name} />;
}
```

- [ ] **Step 5: Run** `pnpm test apps/web` and `pnpm -F web check-types`. Expected: PASS. **Commit** `feat(web): the seller page on the storefront host`.

---

### Task 6: Web: policies for services and the footer

**Files:**
- Create: `apps/web/src/content/seller-policies/terms.tsx`, `apps/web/src/content/seller-policies/privacy.tsx`, `apps/web/src/content/seller-policies/index.ts`
- Modify: `apps/web/src/app/store/layout.tsx`, `apps/web/src/app/store/policies/[policy]/page.tsx`

- [ ] **Step 1: Templates.** Reuse `PolicyStore`, `StoreContact` and `StoreLink` from `@/content/store-policies/shared` and the prose components from `@/components/legal/prose`.

  `seller-policies/terms.tsx`:

```tsx
import { H2, P } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "../store-policies/shared";

export default function SellerTerms({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        These terms apply when you ask {store.name} for a quote or buy their services through <StoreLink store={store} />.
      </P>
      <H2>Who you are working with</H2>
      <P>
        {store.name} provides the services on this page and is responsible for them. Payleor provides the software that
        runs this page, the quotes and the payments, and is not a party to your agreement with {store.name}.
      </P>
      <H2>Quotes</H2>
      <P>
        Prices and delivery times on this page are usual ranges, not offers. {store.name} sends you a quote with the
        price and the delivery time; the agreement starts when you accept it.
      </P>
      <H2>Payment</H2>
      <P>
        You pay a deposit when you accept the quote and the balance when you accept the delivery. Payments are processed
        by PayPal; {store.name} and Payleor never see your card details.
      </P>
      <H2>Delivery and changes</H2>
      <P>
        {store.name} delivers through your private project page. You can accept the delivery or ask for changes there.
      </P>
      <H2>Your rights</H2>
      <P>Nothing in these terms limits the rights you have as a consumer under the law.</P>
      <H2>Contact</H2>
      <P>
        Questions about a quote or a project: <StoreContact store={store} />.
      </P>
    </>
  );
}
```

  `seller-policies/privacy.tsx`:

```tsx
import { H2, LI, P, UL } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "../store-policies/shared";

export default function SellerPrivacy({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        This policy explains how {store.name} handles your personal data when you ask for a quote or work with them
        through <StoreLink store={store} />.
      </P>
      <H2>Who is responsible</H2>
      <P>
        {store.name} controls the personal data you give them. Payleor, the software that runs this page, processes it
        on their behalf.
      </P>
      <H2>What we collect</H2>
      <UL>
        <LI>your name and email address</LI>
        <LI>what you tell us about your project, and the files we exchange</LI>
        <LI>your quotes, payments and deliveries</LI>
      </UL>
      <P>Card and bank details go to PayPal and are not shared with us.</P>
      <H2>Why we use it</H2>
      <P>To quote, do the work, take payment, answer your questions and keep the records the law requires. We do not sell your data.</P>
      <H2>Who we share it with</H2>
      <UL>
        <LI>PayPal, to take your payments</LI>
        <LI>Payleor, which hosts this page and your project page</LI>
      </UL>
      <H2>How long we keep it</H2>
      <P>We keep project and payment records as long as tax and accounting law requires, and delete other data when we no longer need it.</P>
      <H2>Your rights</H2>
      <P>
        You can ask to see, correct or delete your data, or object to how it is used. Contact us at{" "}
        <StoreContact store={store} />.
      </P>
      <H2>Cookies</H2>
      <P>This page uses only the cookies needed to run it. It does not use tracking cookies.</P>
    </>
  );
}
```

  `seller-policies/index.ts`:

```ts
import type { StorePolicy } from "@jendal-workspace/core";

import type { PolicyStore } from "../store-policies/shared";
import SellerPrivacy from "./privacy";
import SellerTerms from "./terms";

export const SELLER_POLICY_PAGES: Partial<
  Record<StorePolicy, { title: string; Body: (props: { store: PolicyStore }) => React.ReactNode }>
> = {
  terms: { title: "Terms of service", Body: SellerTerms },
  privacy: { title: "Privacy policy", Body: SellerPrivacy },
};
```

- [ ] **Step 2: The policy page.** In `app/store/policies/[policy]/page.tsx`:
  - after fetching `info`, refuse a policy the product does not have: `if (!policiesFor(info.product).includes(policy)) notFound();`;
  - pick the pages with `info.product === "services" ? SELLER_POLICY_PAGES[policy] : STORE_POLICY_PAGES[policy]`;
  - call `notFound()` if the entry is missing.

- [ ] **Step 3: The footer.** `app/store/layout.tsx` becomes an async server component:
  - `const info = await fetchStoreInfo();` If it is null, render only the children (the page answers 404).
  - Otherwise the footer has two lines:
    1. The seller's policies, `policiesFor(info.product)`. Titles come from `SELLER_POLICY_PAGES` for services and `STORE_POLICY_PAGES` for stores. Links stay relative (`/policies/{policy}`).
    2. Payleor's legal pages, as absolute links built from `const { site } = await getPlatformOrigins();`. The nav is `aria-label="Payleor"`:
       - `Powered by Payleor` → `site`
       - `Payleor terms` → `${site}/legal/terms`
       - `Payleor privacy` → `${site}/legal/privacy`
       - `Acceptable use` → `${site}/legal/acceptable-use`
  - Keep the current classes and add the second nav.

- [ ] **Step 4: Run** `pnpm test apps/web` and `pnpm -F web check-types`. Expected: PASS. **Commit** `feat(web): seller policies for services and Payleor's legal pages in the footer`.

---

### Task 7: Web: the admin preview, the publish card and the dashboards

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/preview/page.tsx`, `apps/web/src/app/admin/[storeSlug]/preview/seller-preview.tsx`, `apps/web/src/components/seller-page/publish-card.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/page.tsx`, `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`, `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx`, `apps/web/src/app/admin/[storeSlug]/settings/services-team-settings.tsx` (solo heading)

- [ ] **Step 1: The preview page.**
  - `preview/page.tsx` (server):

```tsx
export default async function SellerPreviewPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <SellerPreview teamSlug={storeSlug} urlParts={await getStoreUrlParts()} />;
}
```

  - `seller-preview.tsx` (`"use client"`):
    - Queries: `useQuery({ ...trpc.seller.preview.queryOptions({ teamSlug }), retry: false })`.
    - While pending: `Loader`. On error: `TeamNotFound`.
    - Above the page, a full-width banner `div.border-b.bg-muted.px-4.py-2.text-sm` holding:
      - for a draft, "Preview. This page is a draft; only your team can see it.";
      - for a live seller, "Preview. This page is live at {link}." (the link is `storeUrl(slug, urlParts)`, opening in a new tab);
      - a "Back to the dashboard" link to `/${teamSlug}`.
    - Then `page.product === "services" ? <SellerPage page={data} /> : <StoreHome name={data.name} />`.
    - The preview has no footer.

- [ ] **Step 2: The publish card** (`components/seller-page/publish-card.tsx`, `"use client"`).
  - Props: `{ teamSlug: string; publicUrl: string }`.
  - Data: `useQuery(trpc.seller.status.queryOptions({ teamSlug }))`, and the `publish` and `unpublish` mutations.
  - Every success invalidates `seller.status`, `seller.preview`, `servicesTeam.get` and `store.get` (`queryClient.invalidateQueries({ queryKey: trpc.store.get.queryKey() })` and the same for the others, without input so every slug matches).
  - Render a `section id="publish" className="grid gap-3 border p-4"`:
    - `h2` "Seller page" when `product === "services"`, otherwise "Storefront";
    - the status line: "Draft: only your team can see it." / "Live at {publicUrl link}" / "Suspended";
    - a "Preview" link to `/${teamSlug}/preview` (`buttonVariants({ variant: "outline", size: "sm" })`);
    - when `canManage` and the seller is a draft: a "Publish" button, disabled when `problem` is set, with the problem shown under it as `text-sm text-muted-foreground`;
    - when `canManage` and the seller is live: an "Unpublish" button with `window.confirm("Unpublish? Visitors will see a not-found page until you publish again.")`;
    - when not `canManage`: "An admin publishes the page.";
    - mutation errors in `role="alert"`.

- [ ] **Step 3: The dashboards.**
  - `app/admin/[storeSlug]/page.tsx` passes `urlParts` to `ServicesTeamDashboard` as well.
  - **Store dashboard:**
    - `setupSteps(store.data, { productsUrl, connectPaypal: "#paypal", publish: "#publish" }, …)`;
    - render `<PublishCard teamSlug={storeSlug} publicUrl={url} />` after the checklist;
    - the Status row shows `{ draft: "Draft", active: "Live", suspended: "Suspended" }[store.data.status]`.
  - **Services dashboard:**
    - the steps get `status: team.status` and `publish: "#publish"`;
    - the checklist title is `solo ? "Set up your seller page" : "Set up your team"`;
    - render `<PublishCard teamSlug={team.slug} publicUrl={storeUrl(team.slug, urlParts)} />` after the checklist;
    - the `dl` gains "Seller page" with the public URL link.
  - `services-team-settings.tsx`: the page heading is "Settings" for a solo seller and stays "Team settings" for a team.

- [ ] **Step 4: Run** `pnpm test apps/web` and `pnpm -F web check-types`. Expected: PASS. **Commit** `feat(web): publish and preview from the dashboards`.

---

### Task 8: The 3a leftovers

**Files:**
- Modify: `packages/api/src/use-cases/projects.ts` (the assign use case) + `packages/api/src/routers/project.test.ts`
- Modify: `apps/web/src/app/admin/[storeSlug]/services/offering-form.tsx`

- [ ] **Step 1: Failing test.** `project.assign` on a solo team answers `BAD_REQUEST` "A solo seller does the work; there is no one to assign." Check that the internal assignment made when a client accepts a quote still works on a solo team; the existing solo quote test covers it, so keep it passing.

- [ ] **Step 2: Implement.**
  - In the use case behind `project.assign`, read the settings and refuse when `settings.solo`.
  - Do not touch the path `acceptQuote` uses to assign the quote's author. If both share one helper, put the check in the assign procedure's use case only.

- [ ] **Step 3: The offering form.**
  - Show the first problem only after the admin has changed a field or tried to submit. Add a `touched` boolean, set by `patch` and by the submit handler. Keep submit disabled while there are problems, as now.
  - In `packages/core/src/services-teams/catalog.ts`, change the message "Enter both prices as whole amounts." to "Enter both prices as amounts, for example 150 or 19.99." Update the core test if it asserts the old string.

- [ ] **Step 4: Run** `pnpm test packages/api packages/core apps/web` and `pnpm check-types`. Expected: PASS. **Commit** `fix(api,web): no assignment on a solo team; the service form waits for input`.

---

### Task 9: Full check and merge (controller)

- [ ] `pnpm test && pnpm check-types --force` in the worktree.
- [ ] Final whole-branch review by a fresh reviewer, then fixes and a re-review.
- [ ] Merge into `main` with `--no-ff` and a message file (`git merge --no-ff r3b-seller-page -F <file>`): a subject naming the run, a paragraph, and the trailer.
- [ ] In `main`, run `pnpm install`. There is no migration in this run.
- [ ] Restart the dev stack: stop it, delete `apps/web/node_modules/.vite`, start `pnpm dev`, and clear the browser cache. Start the tunnel with `pnpm tunnel`.

---

### Task 10: Walkthrough (controller, no payment)

Over the tunnel. Find the store domain first: check `packages/infra/dev-hosts.ts` and the dev `.env` (`TUNNEL_STORE_DOMAIN` or equivalent) to get the host where `{slug}` storefronts answer.

1. **Drafts are hidden.** The existing draft stores (`acme`, `walk-store`) and `walk-crew` answer the not-found page on the storefront host.
2. **Publishing is refused until ready.**
   - On Walk Crew Solo (a team since the R3a walkthrough, with no PayPal), the dashboard's publish card shows "Connect PayPal before you publish." and Publish is disabled.
   - The checklist shows "Publish your seller page" to do.
   - Preview shows the bio and "Logo design" under Brand. "Business cards" stays hidden.
3. **Publish a seller.**
   - On Walk Crew (PayPal connected), make sure one active service exists; add one if not ("Brand strategy", $500–$1,500, 5–10 days).
   - Publish. The card says Live with the public URL, the checklist step is done, and `team.status = 'active'` in the database.
   - The storefront host shows the name, the bio, the services with "Usually …" lines and "Request a quote" mailto links, and the footer with Terms of service, Privacy policy and the Payleor links (absolute, to the platform host).
   - `/policies/terms` and `/policies/privacy` render the services texts; `/policies/returns` is not found.
4. **Unpublish.** After an Unpublish, the storefront host answers not found on the next request (no 5-minute wait, because the KV keys were dropped). Publish again for 3c.
5. **Stores.** On `walk-store`, the publish card says "Connect PayPal before you publish." (or the product rule), and the store dashboard Status reads "Draft".
6. **A member who is not an admin.** Add Dev Merchant as a manager on Walk Crew (Members page), or reuse their freelancer row. Signed in as the sandbox seller you cannot sign in as them, so check this rule in the router tests and skip it here unless a second session is available.
7. Record the outcome in this plan, and update the sellers design §11 run 3 row (3b done) and the §11.1 rows this run closes.

---

## Outcome

**Done 2026-10-08, merged into `main` as `29b6188`** (branch head `117be78`). Suite at merge: 117 files, 1069/1069 tests (main had 1029), `check-types --force` clean. No migration in this run.

Tasks 1–7 were implemented by subagents and each reviewed APPROVED (Task 5's controller fix `b7ae990`: `buttonVariants` imported from `lib/button-variants`, not the client-only `components/button`; Task 4 follow-ups `0482287`). Task 8 (`80153b8`) was reviewed as part of the final whole-branch review, which returned READY TO MERGE with six Minor items; two were fixed before the merge (`117be78`: a PayPal re-check now invalidates the `seller` queries so the publish card updates without a reload; a stale checklist comment removed). Deferred Minors: `store/layout.tsx` + `store/page.tsx` each call `fetchStoreInfo` (wrap in React `cache()`); a KV failure after the status write reports an error for a publish that succeeded; the live store home still says "This store is getting ready." (run 4 replaces it); the store checklist counts any product while publishing needs a published one; the offering form's `setTouched` in the submit handler is unreachable while submit is disabled.

**Deviations from the plan:**
- Walkthrough used Walk Crew with two services created through the admin UI ("Landing page design" in a new "Web design" department, standalone "Logo refresh") instead of the suggested "Brand strategy", because Walk Crew had no catalog (the R3a walkthrough built its catalog on walk-crew-solo). Walk Crew's `support_email` was empty (created before the R3a hook); set to `walk-crew@agentmail.to` in the database.
- The "Connect PayPal before you publish." check ran on `walk-store` instead of Walk Crew Solo (same rule, store card).
- Walkthrough step 6 (a member who is not an admin) was covered by the router tests only, as the plan allows.

**Walkthrough (all steps passed, over the tunnel):**
1. Drafts hidden: `acme`, `walk-store` and `walk-crew` answered 404 on the storefront host before publishing.
2. Publish refused until ready: Walk Crew's card showed "Add at least one active service before you publish." with Publish disabled, and the checklist showed "Publish your seller page" to do. The new-service form showed no problem before the first edit, then "Enter both prices as amounts, for example 150 or 19.99." (Task 8 verified in the browser).
3. Published Walk Crew: card "Live at https://walk-crew.payleor.app", `team.status = 'active'`. The public page shows the name, the bio, services grouped under "Web design" plus the standalone one, "Usually $400.00 – $900.00 · 1–7 days" lines, "Request a quote" mailto links with the subject filled, and the footer (Terms of service, Privacy policy, absolute Payleor legal links). `/policies/terms` and `/policies/privacy` render the services texts; `/policies/returns` and `/policies/shipping` are 404.
4. Preview: draft banner before publishing ("only your team can see it"), live banner with the URL after.
5. Unpublish: confirm dialog, card back to Draft, the public host 404s on the next request (KV keys dropped). Republished for 3c; the public page is 200 again.
6. Stores: `walk-store`'s card says "Connect PayPal before you publish." with Publish disabled; its preview renders the store home with the draft banner.

Dev note: the tunnel survived this time (`pnpm tunnel` from a previous session); a stale bare `cloudflared tunnel run jendal-local` (no ingress rules) was found running and killed. The browser needed its cache cleared after the merge (duplicate-React error), per the dev-notes backlog row.
