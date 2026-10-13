# B2: Maintenance batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "Maintenance (B)" rows of the sellers design §11.1: solo sellers are one person and created in one piece, side effects after a committed write never fail the request, quote-request limits and races are tight, a published Commerce product stays publishable, the store host does less work, and the store-order rough edges from R4b are fixed.

**Architecture:** Small, independent fixes at their owning layer, each with a regression test at the strongest boundary (router or repository), following the authoring gate of the test-audit skill (one owner test per contract, no tests of test doubles).

**Tech stack:** TypeScript, tRPC, Drizzle/Postgres, vitest, vinext (Next app-router API on Vite), React, TanStack Query.

**Spec:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §11.1 (rows marked "Maintenance (B)").

**Conventions:** tests from the worktree root with `npx vitest run <path>`; `pnpm check-types`; `pnpm lint` exists (anti-slop) but its existing findings belong to the L1 cleanup run — do not add new findings in code you touch. Comments only for non-obvious reasons; never mention runs or tasks. Commit messages end with the Co-authored-by trailer.

## Out of scope

The anti-slop lint findings (run L1), the reconciliation items (run B3), deletion paths, the store-origin duplication between `apps/server/src/store-origin.ts` and `apps/web/src/lib/store-url.ts`.

---

### Task 1: sellers — solo sellers are one person and created in one piece; status side effects never fail a committed write

**Files:** `packages/api/src/team-creation.ts`, `packages/api/src/routers/services-team.ts` (+test), `packages/api/src/routers/seller.ts` (+test), `packages/api/src/paypal/onboarding.ts` (+ its router test `routers/paypal.test.ts`)

Facts: `servicesTeamRoleFor` makes every owner/admin of the team's workspace a team admin (`core/services-teams/permissions.ts` `effectiveServicesTeamRole`). `organizationForNewTeam` (`team-creation.ts:10-24`) reuses the user's first owned workspace, so a solo seller often lands in a shared workspace. `servicesTeam.create` (`routers/services-team.ts:67-91`) calls Better Auth `createTeam`, then, for solo, `findServicesTeamBySlug` + `applySoloTeamDefaults` in a second step. Publish/unpublish (`routers/seller.ts:63-81`) await `ctx.onTeamStatusChanged` after `setTeamStatus`; a KV failure makes the mutation fail although the status is committed. Same for `onTeamMerchantChanged` in `paypal/onboarding.ts:~133`.

- [ ] **Step 1: Failing tests.**
  - `services-team.test.ts`: a user who already owns a workspace with another team creates a solo seller → the new team's organization is a new one where that user is the only member (assert the organization id differs and `member` rows for it = 1). A non-solo team still reuses the existing workspace (existing test may cover it; keep it).
  - `services-team.test.ts`: when the solo step fails (simulate by making `applySoloTeamDefaults` fail — inject via a db trigger is overkill; instead structure the code so the solo defaults are written by a function you can make fail through a unique-conflict or by deleting the settings row hook… if no clean failure injection exists at the router boundary, skip this test and rely on the compensating code path being small; say so in the report).
  - `seller.test.ts`: `seller.publish` with `onTeamStatusChanged` that rejects still resolves `{ status: "active" }` and the team is active; same for `unpublish`.
  - `paypal.test.ts`: the onboarding return with `onTeamMerchantChanged` rejecting still saves the merchant id and answers as before.
- [ ] **Step 2: Implement.**
  - `organizationForNewTeam(…, { solo })`: when solo, always create a fresh workspace for the user (follow how it creates one today when none exists; name it after the team).
  - `servicesTeam.create`: after `createTeam`, wrap the solo step; on failure, remove the team (`ctx.auth.api.removeTeam` or the team repository delete used elsewhere — check what exists) and, if a fresh workspace was created for it, leave the workspace (harmless) — then rethrow.
  - Seller publish/unpublish and onboarding: `try { await callback(...) } catch (error) { log.error({ action: "seller.cache_invalidate", team: { id }, error: { name } }) }` — the cached lookups expire within 300 seconds anyway (comment at `apps/server/src/services.ts:67-68`).
- [ ] **Step 3: Run** `npx vitest run packages/api packages/db`, `pnpm check-types`. **Commit** `fix(api): solo sellers get their own workspace, cache invalidation never fails a committed write`.

---

### Task 2: quote requests — validate before the email limit, no double open request, no support email on the public page

**Files:** `packages/api/src/routers/project.ts` (requestQuote ~247-303, +`project.test.ts`), `packages/api/src/use-cases/requests.ts`, `packages/db/src/repositories/projects.ts` (`countOpenWebRequests`), `packages/db/src/repositories/seller-page.ts` (+test), `apps/web/src/lib/server-api.ts`, `apps/web/src/components/seller-page/seller-page.tsx`, `apps/server/src/routes/store-info.test.ts` (if it asserts the field)

- [ ] **Step 1: Failing tests** (`project.test.ts` `describe("requestQuote")`):
  - five submissions with a valid email but an invalid description (too short) do not consume that email's budget: a sixth, valid submission with the same email succeeds (today the per-email limit of 5/hour is spent first).
  - two concurrent valid requests for the same email and team when that email already has 2 open requests → exactly one succeeds and the other gets "You already have 3 open requests with this team. Wait for an answer before sending another." (use `Promise.allSettled` on two caller calls).
  - `seller-page.test.ts`: the seller page data has no `supportEmail` key.
- [ ] **Step 2: Implement.**
  - Router: keep honeypot and the per-IP limit first; then run the pure validation (`validateQuoteRequest` from core, plus the email normalisation the use-case does) and only then `hitRequestLimit` for the email key. Do not duplicate messages: if the use-case already returns the validation error, extract a small exported `quoteRequestProblems(input)` used by both, or move the email limit into the use-case after validation and the seller lookup — pick whichever keeps one validation path.
  - Use-case: move `countOpenWebRequests` inside `runProjectTransaction` and serialise per (team, email) first with `await tx.execute(sql\`select pg_advisory_xact_lock(hashtext(${team.id} || ':' || ${email}))\`)`.
  - Drop `supportEmail` from `SellerPageData`, its select, the web zod schema `sellerPageSchema`, and `SellerPageContent`. The policy pages read it from `/api/store/policy-info` and keep working.
- [ ] **Step 3: Run** `npx vitest run packages/api packages/db apps/server apps/web`, `pnpm check-types`. **Commit** `fix: quote request limits after validation, one open-request check at a time, no support email on the seller page payload`.

---

### Task 3: catalog — a published Commerce product stays publishable when edited

**Files:** `packages/api/src/catalog/service.ts` (`updateProduct` ~154-173), `packages/api/src/routers/catalog.test.ts`

- [ ] **Step 1: Failing router test:** publish a priced physical product on a store, then `catalog.update` with every variant at price 0 → BAD_REQUEST "Set a price above zero before publishing." and the stored variants are unchanged (still priced). Editing a published product with valid prices still works (an existing test may cover it).
- [ ] **Step 2: Implement:** in `updateProduct`, after loading the existing product, `if (existing.status === "published")` run `publishProblems(...)` on the new input (the same shape `publishProduct` passes) and throw `CatalogValidationError(problems)` before any write.
- [ ] **Step 3: Run** `npx vitest run packages/api`, `pnpm check-types`. **Commit** `fix(api): editing a published product keeps it publishable`.

---

### Task 4: store orders — sweep abandoned orders, tie order links to their store, check the secret before the limit, say a payment may have gone through

**Files:** `packages/db/src/repositories/orders.ts` (+test), `apps/server/src/maintenance.ts` (+test); `packages/api/src/routers/order.ts`, `packages/api/src/use-cases/orders.ts`, `packages/api/src/routers/order.test.ts`, `apps/web/src/app/store/orders/[token]/page.tsx`, `order-page.tsx`; `packages/api/src/routers/checkout.ts` (+test); `packages/api/src/use-cases/payments.ts` (+`routers/payment.test.ts`); `apps/web` clients unchanged (they show the server message).

- [ ] **Step 1: Failing tests.**
  - `orders.test.ts`: `deleteAbandonedOrders(db, { createdBefore })` deletes pending orders with no capture id created before the cutoff and returns the count; keeps a pending order with a capture id, a paid order, and a recent pending order.
  - `maintenance.test.ts`: the run reports `ordersDeleted` and a failing order sweep does not stop the other sweeps (extend the existing "keeps sweeping" pattern; reuse the existing fixtures).
  - `order.test.ts`: `order.get`, `order.download`, `order.sendNewLink` take `{ token, slug }`; the right slug works; another team's slug → NOT_FOUND "This link is not valid." (one table-driven test over the three procedures is enough).
  - `checkout.test.ts`: 25 capture calls with a wrong secret for a real PayPal order id all answer NOT_FOUND "This checkout is not valid." and the buyer's own capture (right secret) still succeeds afterwards (today the wrong-secret calls burn the 20-attempt limit first).
  - `payment.test.ts` (update "keeps the capture's own error when the order lookup fails too") and a matching case in `checkout.test.ts`: when the capture fails with a non-decline PayPal error and the order lookup shows no capture (or fails), the error message is "We could not confirm your payment. It may have gone through; check your email before trying again." (code INTERNAL_SERVER_ERROR).
- [ ] **Step 2: Implement.**
  - `deleteAbandonedOrders` (status pending, `paypal_capture_id IS NULL`, `created_at < cutoff`; grants cascade) and a `"orders"` maintenance sweep with `ORDER_MAX_AGE_MS = 24 * 3_600_000`, an `ordersDeleted` report field.
  - Order router input `z.object({ token, slug: z.string().min(1).max(63) })`; `findOrderByToken(db, token, slug)` compares the order's team slug (join `team` in `findGrantByTokenHash` or use `findOrderEmailTeam`) and throws the same NOT_FOUND on mismatch. The order page server component calls `fetchStoreInfo()` (404 when null) and passes `slug={store.slug}` to the client component, which sends it with every call.
  - Checkout capture: export `verifyCheckout(db, { paypalOrderId, secret }): Promise<OrderRow>` from `use-cases/orders.ts`; the router calls it first, then the limit keyed `checkout-capture:${order.id}`, then `captureCheckout` with the verified order (adjust its signature; keep one secret check).
  - Both rethrow points after the lookup fallback (`captureAtPayPal` in orders.ts, `capturePayment` in payments.ts) throw `new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We could not confirm your payment. It may have gone through; check your email before trying again.", cause: error })` (the cause keeps PayPal's `debug_id` in the error log).
- [ ] **Step 3: Run** `npx vitest run packages/api packages/db apps/server`, `pnpm check-types`. **Commit** `fix: sweep abandoned orders, tie order links to their store, check the checkout secret first, say a payment may have gone through`.

---

### Task 5: web — one store lookup per request, no seller-page call for Commerce homes, one price-input helper, noindex, quiet self-handled errors

**Files:** `apps/web/src/lib/server-api.ts`, `apps/web/src/app/store/page.tsx`, `apps/web/src/lib/money.ts` (+test), `apps/web/src/components/catalog/digital-product-form.tsx`, `apps/web/src/app/admin/[storeSlug]/services/offering-form.tsx`, `apps/web/src/app/admin/[storeSlug]/products/[productId]/edit-product.tsx`, `apps/web/src/app/store/buy/[productId]/page.tsx`, `apps/web/src/app/store/orders/[token]/page.tsx`, `apps/web/src/utils/trpc.ts`, the self-handling query sites.

- [ ] **Step 1:** `server-api.ts`: wrap `fetchStoreInfo` and `fetchSellerPage` in React `cache()` (`import { cache } from "react"`; supported by vinext in server components — vinext fixture `tests/fixtures/app-basic/app/slow-use/page.tsx`). Export the cached functions under the same names.
- [ ] **Step 2:** `store/page.tsx`: call `fetchSellerPage()` only in the services branch; Commerce returns `<StoreHome name={store.name} />` directly (Commerce teams never list products since R4b).
- [ ] **Step 3:** `money.ts`: `export function minorToPriceInput(minor: number): string` returning `(minor / 100).toFixed(2)` next to `parsePriceInput` (the two-decimal rule lives here; USD and EUR are the only currencies). Test it round-trips with `parsePriceInput` for 0, 5, 1900, 123456. Use it at the three call sites.
- [ ] **Step 4:** `export const metadata: Metadata = { robots: { index: false, follow: false } }` on the buy and order pages (vinext supports `metadata.robots`).
- [ ] **Step 5:** `utils/trpc.ts`: extend the query meta type with `silent?: boolean` and skip the toast when it is true. Set `meta: { silent: true }` on queries that render their own error state: the order page, the checkout form, and the admin queries that show `TeamNotFound` or an inline error (the list in the B2 code map: store-dashboard, services-team-dashboard, seller-preview, discord-link, services-team-settings, services-catalog, offering-form, services-team-members, products-list, edit-product, new-product, digital-products, digital-product-form, projects-list, orders-list). Leave mutations and other queries unchanged.
- [ ] **Step 6: Run** `npx vitest run apps/web`, `pnpm check-types`. **Commit** `fix(web): cache store lookups, skip the seller page for Commerce homes, one price-input helper, noindex order pages, quiet self-handled errors`.

---

### Task 6: Final review, merge, walkthrough (controller)

- [ ] Full `npx vitest run` and `pnpm check-types`; a final whole-branch review; merge with `--no-ff`; `pnpm install`; restart the dev stack if dependencies changed.
- [ ] Walkthrough over the tunnel:
  1. Create a solo seller as Walk Through (who owns the walk-crew workspace) → it lands in its own new workspace; walk-crew's admin dashboard does not list the new seller's team for other workspace members (check with `member` rows in the database).
  2. Quote request: five too-short submissions with one email, then a valid one with the same email succeeds.
  3. A walk-store product: publish with a price, edit all variants to 0 → "Set a price above zero before publishing.".
  4. Order page: the walk-crew order link opened on `walk-crew-solo.payleor.app/orders/{token}` → "This link is not valid."; on walk-crew's host it works. View source on the order and buy pages shows `<meta name="robots" content="noindex, nofollow">`. An invalid order link shows the page message and no toast.
  5. `walk-store.payleor.app` home still shows the placeholder (server log shows no `/api/store/page` call for it).
  6. Maintenance: insert a pending order older than a day in the dev database, trigger the sweep (or call `deleteAbandonedOrders` via a one-off script / wait for the 10-minute cron) → it is gone.
- [ ] Record the outcome here, update §11.1 (close the B rows this batch fixes), and `specs/README.md`.

---

## Outcome

Merged into `main` as `eed3537` on 2026-10-11 (1196 tests, check-types clean). No migration.

Commits:
- `bd688b5` and `01e00b5`: sellers. A solo seller always gets a new workspace of its own. A team or store skips workspaces that hold a solo seller. If the solo step fails, the new team is deleted and the original error is kept (a cleanup failure is logged as `services_team.create_cleanup`). The slug is checked before any workspace is created. Cache invalidation after publish, unpublish and PayPal onboarding is logged and never fails the committed write (`team-cache.ts`).
- `1c43070`: quote requests. The per-email limit is spent only by valid requests (it moved into the use-case, after validation and the offering check). The open-request count runs inside the insert transaction under `pg_advisory_xact_lock(hashtext(team || ':' || email))`. `supportEmail` left the seller page payload; the policy pages keep it.
- `4b22e78`: editing a published Commerce product re-checks `publishProblems`.
- `67e9c9a` and `a0598bc`: orders. The maintenance cron deletes pending orders with no capture older than 4 days (`STUCK_WEBHOOK_MS` plus a day, so a capture whose reply was lost can still be settled by its webhook), 500 per run. The order router takes `{ token, slug }` and a wrong store answers "This link is not valid.". Capture checks the checkout secret first, then a per-order limit, behind a per-IP limit like `start`. A capture failure with no capture on PayPal's side tells the buyer "We could not confirm your payment. It may have gone through; check your email before trying again." (buyer paths only, so webhook retries are unchanged).
- `d7d1c15`: web. `fetchStoreInfo` and `fetchSellerPage` are wrapped in React `cache()`. The Commerce home no longer calls `/api/store/page`. `minorToPriceInput` replaces four inline conversions. The buy and order pages are `noindex, nofollow`. Queries with their own error state set `meta: { silent: true }` and skip the global toast.
- `303eff4`: final-review fix. The members page shows non-permission errors instead of "Only managers and admins can see the member list.".

Deviations from the plan:
- The test for a failing solo step was skipped: the step cannot be made to fail at the router boundary without a test-only seam.
- The sweep cutoff is 4 days, not 24 hours (see above). The walkthrough seeded orders 5 and 3 days old.
- The "may have gone through" message is raised in `captureCheckout` and around `capturePayment` in the payment router, not inside `captureAtPayPal`/`capturePayment`, which the webhooks share.

Walkthrough on 2026-10-11 over the tunnel. Everything passed:
1. **Solo seller.** The form refuses `walk-crew` ("This team address is already taken."). Two direct `servicesTeam.create` calls with that slug answered 409 and Walk Through's `member` rows stayed at 1. Creating "Walk B2" (`walk-b2-solo`) put it in a new workspace whose only member is Walk Through; walk-crew's workspace (with `dev-merchant@example.com`) does not hold it.
2. **Quote request limits.** Five too-short requests from `walk-crew@agentmail.to` answered "Describe what you need in at least a sentence."; the valid request after them succeeded.
3. **Published product edit.** Men's Tree Runner (walk-store) published at $98.00; setting all 10 variants to 0 and saving showed "Set a price above zero before publishing." and the stored prices stayed 9800. Unpublished again afterwards.
4. **Order links.** The walk-crew order link on `walk-crew-solo` returns 404 (a draft store, so the middleware stops it first); `order.get` with slug `walk-crew-solo` answers 404 "This link is not valid.", and with `walk-crew` the page shows the refunded order. The order and buy pages carry `<meta name="robots" content="noindex, nofollow">`; the seller page carries none. An invalid token shows "This link is not valid. Check the link in your email." with no toast.
5. **Commerce home.** With walk-store briefly set to active, its home showed "This store is getting ready." and the server log had two `/api/store` calls (middleware, then layout and page sharing one) and no `/api/store/page`. Set back to draft.
6. **Order sweep.** Two seeded pending orders, 5 and 3 days old: the 11:50 cron run logged `maintenance.orders` deleted 1 and removed the 5-day-old one. The other was then deleted by hand.

walk-b2-solo stays as a draft solo seller in its own workspace. The quote request from `walk-crew@agentmail.to` stays on walk-crew.
