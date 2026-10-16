# L1: Anti-slop lint cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm lint` (Oxlint with the anti-slop plugin, `.oxlintrc.json`) reports 0 findings on `main`, with no behaviour change.

**Architecture:** Fix each finding at its owner, package by package, so every task leaves its packages at zero. External input (PayPal responses and webhooks, PayPal userinfo, Postgres errors, Cloudflare request metadata, queue bodies) is decoded with zod at the I/O boundary into named types; everything inside takes those types. Test fakes use `fromPartial` from `@total-typescript/shoehorn` instead of `as unknown as X`.

**Tech stack:** TypeScript, zod 4 (`catalog:` → `^4.5.4`), `@total-typescript/shoehorn`, Oxlint 1.87 + `tools/oxlint/anti-slop`, vitest.

**Decisions (Mouhamed, 2026-10-11):** zod in `packages/paypal`, each call passes a schema to `request()`; the same rules apply to tests, and fakes use shoehorn `fromPartial`.

**Baseline (main `124e052`):** 341 findings. By package: paypal 108, server 58, api 56, web 37, core 33, db 16, channel3 11, auth 9, infra 5, email 5, ui 3. 106 are in tests or `testing/` helpers. By rule: SAFETY comment 91, unknown parameters 69, runtime typeof 69, value widening 39, unsafe dictionary 34, chained assertions 12, unknown returns 10, empty-object spread 10, "shape" names 3, plus one each of `triple-slash-reference`, `no-unused-vars`, `no-control-regex`, `no-reflect-get`.

**Conventions:** work in `worktrees/l1-lint-cleanup`. Per package: `npx oxlint <dir>` → `Found 0 warnings and 0 errors.`; `npx vitest run <dir>` (DB tests need `.env.test.local`, copy it from `worktrees/main` if missing); `pnpm check-types`. Never change a test's assertions to make it pass: the existing suite is the behaviour spec for this run. Never silence a rule with `oxlint-disable` or config changes. Comments only for non-obvious reasons; never mention runs or tasks. Commit messages end with the Co-authored-by trailer.

## Fix patterns (all tasks)

Use these; if a finding fits none, pick the smallest owner-level fix and say so in the report.

1. **Error handlers (`no-unknown-parameters` on `error: unknown`).** The rule allows the name `cause`. Rename the parameter to `cause` in catch callbacks and error mappers (`(cause: unknown) => …`, `function rethrowAsTrpcError(cause: unknown): never`). Do not change behaviour.
2. **`error instanceof Error ? error.name : typeof error`** (about 8 copies in api and server). Replace with one helper in core and use it everywhere:
   ```ts
   // packages/core/src/errors.ts (export from packages/core/src/index.ts)
   export function errorName(cause: unknown): string {
     return cause instanceof Error ? cause.name : "NonError";
   }
   ```
   Log fields keep the key `name`; the only visible change is `"NonError"` instead of `"string"`/`"object"` for thrown non-errors.
3. **Postgres errors** (`isUniqueViolation` in `packages/db/src/repositories/services-catalog.ts:48`, `isSkuConflict` in `packages/api/src/catalog/service.ts:81`, `databaseErrorFields` in `packages/api/src/use-cases/payments.ts:229`). One decoder in db, used by all three:
   ```ts
   // packages/db/src/postgres-errors.ts (export via a "./postgres-errors" subpath like the repositories)
   import { z } from "zod";
   const postgresErrorSchema = z.object({ code: z.string(), constraint_name: z.string().optional() });
   export type PostgresErrorFields = z.infer<typeof postgresErrorSchema>;
   // Drizzle wraps the driver error in `cause`; the driver error itself carries the fields.
   export function postgresError(cause: unknown): PostgresErrorFields | null {
     for (const candidate of [cause, cause instanceof Error ? cause.cause : undefined]) {
       const parsed = postgresErrorSchema.safeParse(candidate);
       if (parsed.success) return parsed.data;
     }
     return null;
   }
   ```
   Check each caller's current lookup order (some read `error.cause` only) and keep it.
4. **Label and lookup maps (`no-known-value-widening` on `const X: Record<K, V> = {…}`).** Keep inference and check with `satisfies`:
   ```ts
   export const PRODUCT_LABELS = { store: "Store", services: "Services" } satisfies Record<TeamProduct, string>;
   ```
   For `Record<string, string>` lookups indexed by arbitrary strings (`IMAGE_CONTENT_TYPES`, `CONTENT_TYPES`, `STATUS_LABEL`), keep a string-keyed read: `satisfies Record<string, string>` plus an `Object.hasOwn` check or a typed helper at the read site if inference makes indexing fail. Return-object widening (`return { note, link: link || null }` against a declared return type): remove the explicit wide return annotation if the inferred type is as good, otherwise use a named type alias for the return.
5. **Conditional empty-object spreads.** Build the object, then add the property:
   ```ts
   const values: CatalogStatusUpdate = { status, updatedAt: now };
   if (status === "published") values.publishedAt = now;
   ```
6. **Type guards on `unknown`** (`isServicesTeamRole`, `isCurrency`, `isQuotingMode`, `isPayoutMode`, `isTeamProduct`, `oneOf` in core). Their callers pass database text or parsed input, so the parameter becomes `string`: `export function isServicesTeamRole(value: string): value is ServicesTeamRole`. Fix any caller that passed something wider by parsing first.
7. **Unsafe dictionaries.** `Record<string, unknown>` for JSON payloads (outbox `data` in `packages/db/src/schema/outbox.ts:21` and `unit-of-work.ts:24`) becomes a named JSON type in core:
   ```ts
   export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
   export type JsonObject = { [key: string]: JsonValue };
   ```
   `auth: { options: Record<string, unknown> }` (`client-links.ts:69`, `project.ts:64`) takes the named Better Auth options type or only the field it reads (`{ options: { secret?: string } }`).
8. **Unknown returns.** Return the decoded type (`fetchPayPalUserInfo` returns `PayPalUserInfo`, see Task 3) or `Promise<void>` where the caller ignores the value (Discord REST, queue `enqueue`, KV `get` typed through the reader that parses it).
9. **Type assertions in production code.** Prefer removing the assertion (decode with zod, narrow with a real check, or fix the declared type). Keep an assertion only when the invariant is checked nearby, with a comment right above: `// SAFETY: <the checked invariant>`. No chained `as unknown as`.
10. **Test fakes.** Add `@total-typescript/shoehorn` as a root devDependency. Replace `x as unknown as T` and plain `as T` on fakes with `fromPartial<T>(x)` (import `{ fromPartial } from "@total-typescript/shoehorn"`). Other test assertions get the production treatment (pattern 9). Test helpers taking `unknown` take the concrete type they build.
11. **Runtime `typeof` outside parsing.** Branch on a real type instead (`rule.to` in `core/projects/state-machine.ts:107`: make the field a discriminated union or always a function). Search params in the web pages (`verify-email/page.tsx:20`, `reset-password/page.tsx:14`): parse `searchParams` with a small zod schema.
12. **"shape" names** (`shaped` in `packages/api/src/routers/payout-destination.ts`): rename for the role, e.g. `toDestinationView`.

## Out of scope

Behaviour changes, new features, rule configuration changes, and the B3 items. If a fix would change behaviour beyond the `errorName` log value, stop and report it.

---

### Task 1: setup and shared helpers

**Files:** root `package.json`, `packages/paypal/package.json`, `packages/core/src/errors.ts`, `packages/core/src/json.ts`, `packages/core/src/index.ts`, `packages/db/src/postgres-errors.ts`, `packages/db/package.json` (exports).

- [ ] **Step 1:** `pnpm add -Dw @total-typescript/shoehorn`; add `"zod": "catalog:"` to `packages/paypal/package.json` dependencies; `pnpm install`.
- [ ] **Step 2:** add `errorName` (pattern 2) and `JsonValue`/`JsonObject` (pattern 7) to core and export them; add `postgresError` (pattern 3) to db with a subpath export matching the existing `./repositories/*` style.
- [ ] **Step 3:** a repository-level test for `postgresError` only if no existing test reaches it through a real unique violation after Tasks 2–3 (the SKU-conflict and services-catalog conflict tests do); do not add a unit test of the helper.
- [ ] **Step 4:** `pnpm check-types`; `npx oxlint packages/core/src/errors.ts packages/core/src/json.ts packages/db/src/postgres-errors.ts` → 0. Commit `chore: shared error and JSON helpers, shoehorn for test fakes`.

### Task 2: packages/paypal — responses decoded with zod (reviewed)

**Files:** `packages/paypal/src/{client,orders,merchant-integrations,partner-referrals,webhooks,errors,token}.ts`, a new `packages/paypal/src/schemas.ts`, and their tests (`orders.test.ts` has 22 findings, `client.test.ts` 6).

Facts: `request<T>()` (`client.ts:140-170`) returns `(await response.json()) as T`. `orders.ts:118-180` hand-parses captures, refunds, money and the fee breakdown, with deliberate leniency: an unreadable capture is skipped, an unreadable fee makes the whole breakdown `undefined` (so a fee is never recorded as zero), refunds without id/status are dropped. `fetchToken` (`client.ts:105-126`) hand-parses the token. `errors.ts` (12 findings) parses PayPal error bodies; `merchant-integrations.ts` (14) parses the seller status; `webhooks.ts` (9) parses events.

- [ ] **Step 1:** `request` takes a schema: `request<S extends z.ZodType>(options: PayPalRequestOptions, schema: S): Promise<z.infer<S>>`. A 204 needs `z.undefined()` or a dedicated `requestNoContent`. A body that fails the schema throws a `PayPalError` (read its constructor in `errors.ts`) with the HTTP status and name `UNEXPECTED_RESPONSE`, so callers' existing PayPalError handling applies (the buyer capture path maps it to "We could not confirm your payment…"). Update `PayPalClient`'s `request` type; callers outside the package (`rg "\.request\(" packages apps`) pass a schema.
- [ ] **Step 2:** `schemas.ts`: top-level response schemas use `z.looseObject` and mark optional every field PayPal may omit, so a valid response never fails. Keep the exported types (`PayPalOrder`, `PayPalCapture`, `PayPalMoney`, …) as the package's public contract: either derive them with `z.infer` or annotate schemas `z.ZodType<PayPalOrder>`; pick one and use it throughout. Reproduce the leniency exactly: captures and refunds are arrays of `unknown` items, each item `safeParse`d and skipped on failure; the breakdown is `safeParse`d as a whole and `undefined` on failure.
- [ ] **Step 3:** token, error bodies, merchant integrations and webhook events go through schemas too (`fetchToken`: `z.object({ access_token: z.string(), expires_in: z.number().optional() })`, keeping the "no access_token" error and the 3600 default).
- [ ] **Step 4:** tests: fakes via `fromPartial`; no assertion changes. Add a test only for the new failure path (a 200 body that fails its schema gives `PayPalError` `UNEXPECTED_RESPONSE`), extending the existing client test table if there is one.
- [ ] **Step 5:** `npx oxlint packages/paypal` → 0; `npx vitest run packages/paypal packages/api apps/server`; `pnpm check-types`. Commit `refactor(paypal): decode PayPal responses with zod at the client`.

### Task 3: packages/api, with core payouts and PayPal userinfo (reviewed)

**Files:** everything `npx oxlint packages/api` lists (56), plus `packages/core/src/payouts/destination.ts` (7) and `packages/api/src/paypal-userinfo.ts`.

Facts: `fetchPayPalUserInfo` (`paypal-userinfo.ts:10`) returns `unknown`, and core `payouts/destination.ts:17-34` parses it with `typeof`. `use-cases/orders.ts:515-517` re-parses captures from a PayPal order (use the paypal package's decoded types instead). `paypal-webhooks.ts:114,166` check `typeof merchantId`. `team-creation.ts:33` `toTRPCError(error: unknown): unknown`.

- [ ] **Step 1:** a zod `payPalUserInfoSchema` next to `fetchPayPalUserInfo`, which returns `PayPalUserInfo` (named type exported from core, no zod in core); core `destination.ts` takes `PayPalUserInfo` and keeps its rules (verified email, confirmed entry, `PAYER_ID_PATTERN`).
- [ ] **Step 2:** apply patterns 1–9 and 12 to the rest. `toTRPCError(error: unknown): unknown` becomes `toTRPCError(cause: unknown): Error` (it returns a `TRPCError` or the original error; wrap a non-Error cause in an `Error`), after reading its callers.
- [ ] **Step 3:** tests in `packages/api`: pattern 10.
- [ ] **Step 4:** `npx oxlint packages/api packages/core/src/payouts` → 0; `npx vitest run packages/api packages/core`; `pnpm check-types`. Commit `refactor(api): decode inputs at their boundary, typed error helpers`.

### Task 4: small packages — core (rest), db, auth, channel3, email, infra, ui

**Files:** what `npx oxlint packages/core packages/db packages/auth packages/channel3 packages/email packages/infra packages/ui` lists after Task 3.

Notes: core `services-teams/types.ts` guards (pattern 6); `state-machine.ts:107` (pattern 11); `catalog/images.ts`, `files/rules.ts`, label maps (pattern 4); `onboarding/setup-steps.ts:18` (pattern 5); the `no-control-regex` finding: replace the regex with an explicit code-point check or a named character class that the rule accepts, keeping behaviour (read the existing test first). db: `services-catalog.ts:48,234`, `catalog.ts:86`, outbox types (pattern 7). auth `index.ts:56` `claimTeamSlug(…, input: unknown, …)`: take `string` and parse at the hook. channel3: drop `parseWith(schema, data: unknown)` and `request(): Promise<unknown>`; `request` takes the schema and returns the parsed type (as in Task 2), and builds headers and init without empty spreads. infra `scripts/tunnel.ts:46-48`: zod schema for the `cloudflared tunnel list` JSON.

- [ ] **Step 1:** fix production findings by pattern.
- [ ] **Step 2:** fix test findings (pattern 10).
- [ ] **Step 3:** oxlint on those dirs → 0; `npx vitest run packages`; `pnpm check-types`. Commit `refactor: anti-slop fixes in core, db, auth, channel3, email, infra and ui`.

### Task 5: apps/server

**Files:** what `npx oxlint apps/server` lists (58; 25 are SAFETY comments, many in route tests).

Notes: `tenant/middleware.ts:22-26` reads `request.cf.hostMetadata.storeId` with `Reflect.get` and `typeof`: Workers types declare `request.cf` (`IncomingRequestCfProperties`, `hostMetadata` is typed loosely); decode `hostMetadata` with `z.object({ storeId: z.string() })`. `paypal-webhook-queue.ts:28-29`: zod for the queue body. `email-log.ts`, `discord/route.ts`, `paypal-webhook-queue.ts`: `errorName`. `discord/rest.ts` and `routes/paypal-webhooks.ts:13`: `Promise<void>` where callers ignore the value. `tenant/kv-store-cache.ts:6`: type `get` with the parsed cache entry. The `triple-slash-reference` finding: replace with a `tsconfig` `types` entry or an `import type` (check what it references).

- [ ] **Step 1:** production findings. **Step 2:** tests (pattern 10). **Step 3:** `npx oxlint apps/server` → 0; `npx vitest run apps/server`; `pnpm check-types`. Commit `refactor(server): decode request metadata and queue bodies, typed fakes`.

### Task 6: apps/web

**Files:** what `npx oxlint apps/web` lists (37: 16 widening, 11 SAFETY, 6 unknown parameters).

Notes: `lib/services-team-labels.ts`, `lib/delivery.ts`, `content/*-policies/index.ts`, `admin/page.tsx` (pattern 4); `checkout-form.tsx:20,129,199,206,218` (patterns 1 and 4: `startError` gets a named type such as `Error | null` built from the caught value via a decoder); `project-detail.tsx:251` (pattern 5); the auth pages' search params (pattern 11); the `no-unused-vars` finding. Read `apps/web/AGENTS.md`.

- [ ] **Step 1:** fix. **Step 2:** `npx oxlint apps/web` → 0; `npx vitest run apps/web`; `pnpm check-types`. Commit `refactor(web): anti-slop fixes`.

### Task 7: final review, merge, smoke check (controller)

- [ ] `pnpm lint` → 0 findings; full `npx vitest run`; `pnpm check-types`; whole-branch review focused on behaviour preservation (PayPal leniency, webhook retry semantics, error mapping, log fields).
- [ ] Merge `--no-ff`; `pnpm install`; restart the dev stack.
- [ ] Smoke over the tunnel (PayPal decoding is the risk): the walk-crew order page and `order.get`; the admin PayPal status for walk-crew (merchant integrations); create a PayPal order from `/buy/{id}` up to the popup (orders create, token); re-enqueue one stored `PAYMENT.CAPTURE.COMPLETED` event for walk-crew's order and check it is processed as `already_applied` (orders get, captures, breakdown); the maintenance cron log has no errors.
- [ ] Record the outcome here and in `specs/README.md`; add `pnpm lint` to the verification line of future plans.

## Outcome

Merged into `main` as `ae192c0` on 2026-10-12. `pnpm lint` reports 0 findings (469 files, 111 rules), 1195 tests pass, check-types is clean. No migration.

Commits:
- `92f5f16`: `errorName` and `JsonValue`/`JsonObject` in core, `postgresError` in `@jendal-workspace/db/postgres-errors` (it reads the driver fields from `error.cause`, as every caller did), shoehorn, zod in packages/paypal.
- `d80a1cc` and `b364f60`: packages/paypal. `request(options, schema)` decodes every response; a body that fails its schema throws `PayPalError` `UNEXPECTED_RESPONSE` with the HTTP status (retried by the webhook queue, "could not confirm" on buyer paths). Schemas live in `packages/paypal/src/schemas.ts`, use loose objects and keep the old leniency (unreadable captures and refunds skipped, an unreadable fee makes the breakdown unknown, odd order and integration bodies read as "nothing there"). The review fix also answers a verify-signature 200 bad body with `verification_unavailable` (502) instead of `verification_rejected`.
- `7292dcc`: packages/api and core payouts. PayPal userinfo is decoded next to `fetchPayPalUserInfo`; core's payout destination takes a typed `PayPalUserInfo`. `teamMerchant` returns a discriminated result; `toTRPCError` returns `Error`.
- `9df824b`: core, db, auth, channel3, email, infra and ui. Core guards take `string`; every state-machine `to` is a function; content-type lookups use `Map`; `\p{Cc}` replaces the control-character range; outbox `data` is `JsonObject`; channel3's `request` takes its schema.
- `02576bf`: apps/server. `request.cf.hostMetadata` and queue bodies decoded with zod, no `Reflect.get`; typed fakes.
- `3ff87ae`: apps/web. `satisfies` label maps, `Map` lookups for status and seller policies, zod-parsed search params on the auth pages, typed select state, no `as` on currencies.
- `c5a60b9`: final-review fixes (Discord REST releases response bodies; a missing `permissions` value is refused instead of reaching `BigInt`).

Visible differences, all on malformed input or logs: thrown non-Errors log `name: "NonError"`; an email error `code` that is not a string or number is not logged; a userinfo body with a null email entry saves the destination with no email instead of failing with a 500; a 200 PayPal body that is not an order object fails as `UNEXPECTED_RESPONSE` instead of reading as "no capture".

Kept assertions, each with a `// SAFETY:` comment: `product.status` (×2, the `products_status_check` constraint; typing the column as an enum breaks the db test that inserts `archived` on purpose), the cached `MarketPriceReport` (written only by the same function), the Discord interaction body (after the signature check; option values can be numbers or booleans), and the catalog image upload answer in `product-form.tsx` (zod stays out of the client bundle). `fromAny` wraps Better Auth's generic `getSession` in two server test fakes.

Smoke on 2026-10-12 over the tunnel, all passed: the walk-crew order page and the admin dashboard ("PayPal payments: Connected"); `checkout.start` created sandbox order `1H843868F75356400` (token and orders create decoded); capturing it unapproved logged PayPal's 422 `UNPROCESSABLE_ENTITY` with debug id and the `ORDER_NOT_APPROVED` issue and showed the buyer the "could not confirm" message; re-queued `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` events for the walk-crew order were processed as "already refunded" (orders get, captures, refunds decoded) and the ledger stayed at 41 entries. The dev stack had to be restarted once: the machine slept during startup and left the web worker's binding to the api worker answering 503.

From here on, plans list `pnpm lint` next to `pnpm check-types` in their checks.
