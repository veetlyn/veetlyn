# B1: Maintenance Sweeps, PayPal Token Refresh, Live Project Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the backlog items that need neither a deploy nor another run. A scheduled job every 10 minutes re-queues PayPal webhook events stuck in `received`, deletes expired request-limit rows, and deletes uploads never attached to a delivery (rows and R2 objects). The PayPal client recovers from a revoked token by fetching a new one once. The admin project page and the client page refresh themselves while one side waits on the other.

**Architecture:** `db` gains sweep queries; `core`'s `FileStore` gains `delete`; `paypal`'s token cache gains `clear` and the client retries once on 401. `apps/server` gains `runMaintenance` (each sweep isolated and logged with evlog) and a `scheduled()` handler; `infra` adds `crons: ["*/10 * * * *"]` to the server Worker. The web app adds `refetchInterval` rules from two pure helpers.

**Tech Stack:** TypeScript, Alchemy 2.0.0-beta.80 (`crons`), Cloudflare Queues, R2, Drizzle ORM 1.0 rc, TanStack Query 5, Vitest 5.

**Backlog items (sellers design §11.1):** webhook events whose queue message was lost (run 7 row); PayPal 401 token refresh (run 7 row); `request_limit` cleanup (run 3 row); unattached uploads (run 7 row, the upload half); admin page not refreshing after client actions (run 3 row).

**Builds on:** `main` at `2aac26f` (R2b merged; 946 tests). The account is on Workers Paid (250 cron triggers).

**Decisions (2026-10-08):**
- **One cron, every 10 minutes**, running three independent sweeps; one failing sweep does not stop the others, and the handler never throws (each failure is logged), so Cloudflare does not retry the whole run.
- **Webhook events:** an event `received` for more than 15 minutes is re-sent to the queue (`{ eventId }`, the same body the route sends; the consumer skips events no longer `received`, so duplicates are harmless). The normal path finishes within about 6 minutes (60 s approval delay plus retries of 30, 60, 90, 120 s). An event still `received` after 3 days (PayPal's own redelivery window) is marked `failed` with the note "Stuck in received for 3 days." so a person sees it instead of the sweeper retrying it forever. At most 100 events per run (one `sendBatch`).
- **Request limits:** rows whose window started more than a day ago are deleted (every caller's window is 10 minutes).
- **Uploads:** `file_upload` rows never attached and created more than a day ago are deleted together with their R2 objects, at most 500 per run. In one transaction: select them `for update skip locked` (so a delivery attaching one at that moment wins), delete the objects, delete the rows. If R2 fails, the transaction rolls back and the next run retries, so no row points at a deleted object and no object is left without a row.
- **PayPal 401:** on a 401 from any API call (not the token call itself), the client clears the cached token, fetches a new one and repeats the request once. A second 401 is returned as the error it is.
- **Live pages:** the admin project page refetches every 15 seconds while the team waits on the client (status `awaiting_deposit`, `delivered` or `awaiting_balance`, a quote `proposed`, or an amendment `pending`); the client page refetches every 15 seconds while the client waits on the team (status `quoting` with no proposed quote, or `in_progress` with no pending amendment). TanStack Query already pauses intervals in background tabs and refetches on focus.

**Out of scope:** objects of deleted projects (no project deletion exists yet); a dead-letter queue (the sweeper covers lost messages); file retention after completion; notifications.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/b1-maintenance`, created in Task 0. Tests needing Postgres use `jendal-pg` through `.env.test.local`. The full suite takes about 4 to 6 minutes; run targeted tests per task.

## Facts this plan relies on (checked at `2aac26f`)

1. `paypal_webhook_event` (`packages/db/src/schema/paypal-webhooks.ts`): statuses `received, processed, ignored, parked, failed`; index `(status, received_at)`. Repository `packages/db/src/repositories/paypal-webhooks.ts`: `recordWebhookEvent`, `findWebhookEvent`, `finishWebhookEvent(db, id, { status, note })` (only while `received`), `noteWebhookAttempt`.
2. The route enqueues `{ eventId }` with `ENV.PAYPAL_WEBHOOKS.send(...)` (`apps/server/src/index.ts:89`). The consumer (`apps/server/src/paypal-webhook-queue.ts`) acks events no longer `received`, retries with `30 * attempts` seconds, and marks `failed` after 5 queue attempts. Events stay `received` only when the event table was unreachable for all 10 queue deliveries, or the route's `send` failed and PayPal stopped redelivering.
3. `request_limit` (`packages/db/src/schema/limits.ts`): `key`, `window_start` (epoch ms), `count`. Callers use 10-minute windows (`routers/payment.ts`, `use-cases/projects.ts` upload limit).
4. `file_upload` (`packages/db/src/schema/files.ts`): `attached_at` null until attached; `lockFileUploadForAttach` selects `for update` where `attached_at is null`. `FileStore` (`packages/core/src/files/store.ts`) has `presignPut`, `presignGet`, `head`; the R2 adapter (`apps/server/src/files/file-store.ts`) takes a narrow `SizedBucket { head }`; `R2Bucket.delete(keys: string | string[])` takes up to 1000 keys. Fakes: `createFakeFileStore` (`packages/core/src/files/testing.ts`), `fakeBucket` in `file-store.test.ts`.
5. `apps/server/src/index.ts` exports `{ fetch, queue }` (`satisfies ExportedHandler<Env>`); `queue()` creates the db with `getDb()` and ends it in `ctx.waitUntil(db.$client.end())`. `ENV` comes from `cloudflare:workers`. Background logging uses `import { log } from "evlog"` with `{ action, … }` objects and only error names or database codes (`paypal-webhook-queue.ts`).
6. Alchemy: `crons?: string[]` on `Cloudflare.Worker` props; async Workers export `scheduled(controller, env, ctx)`. `alchemy dev` fires crons with Node-side timers and exposes `GET /cdn-cgi/handler/scheduled?cron=<expr>` on the Worker's port (`refs/stack/alchemy/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts:866-868`, `cloudflare-runtime/src/core/RuntimeWorker.ts:30-37`).
7. PayPal client (`packages/paypal/src/client.ts`): `accessToken()` reuses the cached token until 60 s before expiry; `request<T>()` builds headers with one token; `send()` retries only 429 and 5xx. `PayPalTokenCache` (`packages/paypal/src/token.ts`) has `get` and `set`; `createMemoryTokenCache` and `createKvTokenCache(kv, key)` (`JsonKv` has `get` and `put`); the server uses KV (`apps/server/src/services.ts:41`). Tests: `fakeFetch`, `jsonResponse`, `FAKE_TOKEN_RESPONSE` from `packages/paypal/src/testing.ts`.
8. Web: one `QueryClient` with default options (`apps/web/src/utils/trpc.ts`). Admin page `project-detail.tsx` line ~137 `useQuery({ ...trpc.project.get.queryOptions(...), retry: false })`; client page `client-project.tsx` line ~20 `useQuery({ ...trpc.project.clientGet.queryOptions({ token }), retry: false })`. The pay page already polls with `refetchInterval: (query) => (… ? 5_000 : false)`.

---

### Task 0: Worktree

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git status --short   # must be empty
git worktree add -b b1-maintenance ../b1-maintenance main
cp .env.test.local ../b1-maintenance/.env.test.local
cd ../b1-maintenance && pnpm install && pnpm check-types
```

---

### Task 1: Sweep queries and FileStore.delete

- [ ] **Step 1: Tests first.**
  - `packages/db/src/repositories/paypal-webhooks.test.ts` (create or extend): `listStaleWebhookEvents(db, { receivedBefore, limit })` returns ids of `received` events older than the cutoff, oldest first, up to the limit, and none of the other statuses; `failStuckWebhookEvents(db, { receivedBefore, note })` marks `received` events older than the cutoff `failed` with the note and `processed_at`, returns how many, and leaves newer ones alone.
  - `packages/db/src/repositories/request-limits.test.ts`: `deleteExpiredRequestLimits(db, { windowStartedBefore })` deletes rows whose `window_start` is older and returns the count; a row hit after the cutoff stays.
  - `packages/db/src/repositories/files.test.ts`: `sweepUnattachedUploads(db, { createdBefore, limit }, deleteObjects)` deletes unattached rows older than the cutoff, calls `deleteObjects` once with their `r2Key`s before deleting them, returns the count; attached rows and newer rows stay; when `deleteObjects` throws, no row is deleted and the error propagates; a row locked by another transaction (`lockFileUploadForAttach` held open in a parallel transaction) is skipped.
  - `packages/core/src/files/testing.test.ts`: the fake store's `delete(keys)` removes them from `objects` and records the call.

- [ ] **Step 2: Run** the four test files. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `paypal-webhooks.ts` repository: the two functions (use the `(status, received_at)` index; `failStuckWebhookEvents` uses `update … where status = 'received' and received_at < $cutoff`).
  - `request-limits.ts`: `deleteExpiredRequestLimits`.
  - `files.ts`:

```ts
// Uploads never attached are leftovers (the browser stopped, or the delivery failed). Rows are locked with
// SKIP LOCKED so a delivery attaching one right now keeps it, and objects go first so a failure leaves both.
export async function sweepUnattachedUploads(
  db: Database,
  input: { createdBefore: Date; limit: number },
  deleteObjects: (keys: string[]) => Promise<void>,
): Promise<number>
```

  (One transaction: `select id, r2_key … where attached_at is null and created_at < $cutoff order by created_at limit $limit for update skip locked`; if none, return 0; `await deleteObjects(keys)`; `delete … where id in (…)`; return the count. Match how other repository functions open transactions.)
  - `FileStore.delete(keys: string[]): Promise<void>` in `packages/core/src/files/store.ts`; the fake; the R2 adapter: `SizedBucket` gains `delete(keys: string[]): Promise<void>`, and `delete` sends the keys in chunks of 1000 (no-op for an empty list). Adapter test: `delete` passes the keys to the bucket, chunks 1001 keys into 1000 + 1.

- [ ] **Step 4: Run** `pnpm test packages/db packages/core apps/server/src/files`, check-types for core, db, api, server. **Commit** `feat(db,core): sweep queries and deleting stored files`. Co-authored-by trailer.

---

### Task 2: The maintenance job and the cron

- [ ] **Step 1: Tests first** in `apps/server/src/maintenance.test.ts` with the test database (follow how `paypal-webhook-queue.test.ts` or other server tests reach Postgres; if server tests have no database access, put `runMaintenance` in `packages/api/src/use-cases/maintenance.ts` instead and test it there):

```ts
export type MaintenanceDeps = {
  db: Database;
  enqueueWebhookEvents: (eventIds: string[]) => Promise<void>;
  files: Pick<FileStore, "delete">;
  now?: () => Date;
};
export type MaintenanceReport = {
  webhookEventsRequeued: number;
  webhookEventsFailed: number;
  requestLimitsDeleted: number;
  uploadsDeleted: number;
  errors: string[]; // names of the sweeps that failed
};
export async function runMaintenance(deps: MaintenanceDeps): Promise<MaintenanceReport>
```

  Cases: a `received` event 20 minutes old is re-enqueued and one 5 minutes old is not; one 4 days old is marked failed with "Stuck in received for 3 days." and not re-enqueued; an expired request-limit row is deleted; an unattached upload 2 days old is deleted and its key passed to `files.delete`; an attached one stays; when `enqueueWebhookEvents` throws, the report lists `"webhooks"` in `errors` and the other two sweeps still ran; when `files.delete` throws, `"uploads"` is listed and the upload row is still there. Each sweep logs one evlog line `{ action: "maintenance.<sweep>", maintenance: { … counts } }`, and failures log `{ error: { name } }` only (assert through evlog's test helpers if the repo has them; otherwise skip log assertions).

- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement** `runMaintenance` with the constants from "Decisions" (`STALE_WEBHOOK_MS = 15 * 60_000`, `STUCK_WEBHOOK_MS = 3 * 24 * 3_600_000`, `WEBHOOK_BATCH = 100`, `REQUEST_LIMIT_MAX_AGE_MS = 24 * 3_600_000`, `UPLOAD_MAX_AGE_MS = 24 * 3_600_000`, `UPLOAD_BATCH = 500`). Order inside the webhook sweep: mark stuck events failed first, then list stale ones and enqueue them.

- [ ] **Step 4: Wire it.** `apps/server/src/index.ts`:

```ts
  async scheduled(_controller, _env, ctx) {
    const db = getDb();
    try {
      await runMaintenance({
        db,
        enqueueWebhookEvents: (ids) => ENV.PAYPAL_WEBHOOKS.sendBatch(ids.map((eventId) => ({ body: { eventId } }))),
        files: createFileStore(),
      });
    } finally {
      ctx.waitUntil(db.$client.end());
    }
  },
```

  (`sendBatch` with an empty list: skip the call.) `packages/infra/alchemy.run.ts`: `crons: ["*/10 * * * *"]` on the `server` Worker, with a one-line comment naming what it runs.

- [ ] **Step 5: Run** the tests, check-types for server, api, infra. **Commit** `feat(server): a maintenance job every 10 minutes`. Co-authored-by trailer.

---

### Task 3: PayPal token refresh on 401

- [ ] **Step 1: Tests first** in `packages/paypal/src/client.test.ts` and `token.test.ts`:
  - An API call that gets 401 once clears the cache, fetches a second token (`token-2`), repeats the call with `Bearer token-2`, and returns its result; the token endpoint was called twice.
  - Two 401s in a row: the second is thrown as the usual PayPal error; no third token fetch.
  - A 401 from the token endpoint itself is not retried this way.
  - `createKvTokenCache(...).clear()` deletes the key; `createMemoryTokenCache().clear()` forgets the token.
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** `PayPalTokenCache` gains `clear(): Promise<void>`; `JsonKv` gains `delete(key)` (Workers KV has it; update the server wiring only if the type needs it). In `request<T>()`, build headers from a token variable; after `send()`, if the response is 401 and this is the first try, `await tokenCache.clear()`, fetch a new token, rebuild and send once more. Keep the 429/5xx retries inside `send()` as they are.
- [ ] **Step 4: Run** `pnpm test packages/paypal apps/server packages/api`, check-types. **Commit** `fix(paypal): fetch a new token and retry once on 401`. Co-authored-by trailer.

---

### Task 4: Live project pages

- [ ] **Step 1: Tests first** in `apps/web/src/lib/project-refresh.test.ts`:
  - `teamWaitsOnClient(project)`: true for `awaiting_deposit`, `delivered`, `awaiting_balance`, or when a quote is `proposed` or an amendment `pending`; false for `in_progress` with nothing pending and for `completed`/`cancelled`.
  - `clientWaitsOnTeam(project)`: true for `quoting` with no proposed quote and for `in_progress` with no pending amendment; false otherwise.
  (Take the minimal input shape both pages already have: `{ status, quotes: { status }[], amendments: { status }[] }`; check the real field names in `get` and `clientGet`.)
- [ ] **Step 2: Implement** `apps/web/src/lib/project-refresh.ts` with `PROJECT_REFRESH_MS = 15_000`, and in both pages add `refetchInterval: (query) => (query.state.data && teamWaitsOnClient(query.state.data.project …) ? PROJECT_REFRESH_MS : false)` (and `clientWaitsOnTeam` on the client page). Do not reset form state on refetch (check that the Deliver form and amendment form keep their local state when the query data changes).
- [ ] **Step 3: Run** `pnpm test apps/web`, `pnpm -F web check-types`. **Commit** `feat(web): project pages refresh while waiting on the other side`. Co-authored-by trailer.

---

### Task 5: Full check and merge (controller)

`pnpm test && pnpm check-types` in the worktree; merge into `main` with `--no-ff`; `pnpm install`; restart the dev stack (it registers the cron). No migration.

### Task 6: Walkthrough (controller, no payment)

1. **Cron registered:** the dev log shows the server with the cron; trigger it by hand with `curl "http://localhost:3000/cdn-cgi/handler/scheduled?cron=*/10+*+*+*+*"` and read the `maintenance.*` log lines.
2. **Stuck webhook:** insert a `paypal_webhook_event` row in the dev database with an unhandled type (for example `BILLING.SUBSCRIPTION.CREATED`), status `received`, `received_at` 20 minutes ago; trigger the cron; within a minute the row is `ignored` ("event type not handled"). A second row with `received_at` 4 days ago ends `failed` with "Stuck in received for 3 days.".
3. **Request limits:** insert a row with `window_start` two days ago and one now; after the cron only the new one remains.
4. **Uploads:** the UI uploads and delivers in one step, so insert an unattached `file_upload` row dated two days ago for "Landing page redesign" (key under `deliveries/…`; no object needed, deleting a missing key is a no-op); after the cron the row is gone. The two attached uploads from R2b stay.
5. **Live pages:** deliver on "Landing page redesign" and keep the admin page open (status `delivered`); request changes from the client page in another tab; the admin page shows "In progress" and the request within 15 seconds without a reload. Then deliver again from the admin and check the client page shows the new delivery within 15 seconds. No payment is involved.
6. **401:** covered by unit tests; no live check (it would need a revoked token).
7. Record the outcome here; update the sellers design §11.1 rows (done, with the commit).

---

## Outcome (2026-10-08)

Merged into `main` as `46cb788` (979 tests, check-types clean). Commits: `dd41b0f` (sweep queries, `FileStore.delete`), `e7b58a9` (`runMaintenance`, `scheduled()`, `crons: ["*/10 * * * *"]`), `05543df` (review fixes: stuck events named in an error log `maintenance.webhooks.failed`, readable sweep error notes, partial index `file_upload_unattached_idx`), `11002a3` (PayPal token refresh on 401; webhook verification benefits through `request()`), `0fcce9c`, `c825cce` (live project pages; quiet background refetch errors via typed query meta, also on the pay page; a failed poll keeps the page instead of showing the error screen; polling stops after a NOT_FOUND). Migration `20261008162826_b1_upload_sweep_index` applied to the dev database.

Deviations from the plan:
- A migration after all (the partial index for the upload sweep, suggested in review).
- `failStuckWebhookEvents` returns the events, not a count, so the sweep can log their ids.
- Both project pages now treat "no data" (not "error") as the error screen, as the pay page already did, because a failed background refetch keeps the old data.

### Walkthrough

1. After the restart, `GET http://localhost:3000/cdn-cgi/handler/scheduled?cron=*/10+*+*+*+*` returned 200 and the server logged `maintenance.webhooks.failed` (naming `WH-B1-STUCK`), `maintenance.webhooks` `{ requeued: 1, failed: 1 }`, `maintenance.requestLimits` `{ deleted: 1 }`, `maintenance.uploads` `{ deleted: 1 }`.
2. Seeded rows: the event `received` 20 minutes ago was re-queued and the consumer finished it as `ignored` ("event type not handled"); the one 4 days old ended `failed` with "Stuck in received for 3 days."; the request-limit row from two days ago was deleted and the fresh one kept; the unattached upload from two days ago was deleted and the two attached R2b uploads kept.
3. Live pages on "Landing page redesign": after a delivery, the client requested changes in another tab and the admin page showed "In progress" and the request 5 seconds later without a reload; the team delivered again and the client page showed the new delivery with Accept delivery / Request changes 13 seconds later. A last change request left the project in progress. The seeded webhook and request-limit rows were deleted afterwards.
4. The 401 refresh has unit tests only (a live check needs a revoked token).

Noticed: the server's evlog lines say `"environment":"production"` in local dev. Logged in the sellers design §11.1.
