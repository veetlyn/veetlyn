# R5a: Team payouts (manual) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team pays its members' earnings through PayPal Payouts from its own PayPal account. The team saves its own REST app credentials (encrypted). A member with a verified payout destination who is 18 or older requests a payout of their available earnings on `/me/payouts`. An admin approves or rejects it on the team's Payouts page. Payleor checks the team's balance, sends the payout with the team's credentials, and a cron sweep settles it from PayPal's batch status.

**Architecture:** PayPal Payouts and balance calls are decoded in `packages/paypal` (Task 1). Secret encryption, the age rule and the payout state rules are pure code in `packages/core` (Task 2). New tables in `packages/db` (Task 3). Credentials use-cases with verification (Task 4); payout request, approve, reject, send and settle use-cases under row locks, one ledger reference per fact (Task 5); the age rule on the destination (Task 6). The server wires the key, the per-team client and the settle sweep (Task 7). The admin Payouts page and `/me/payouts` (Task 8).

**Tech stack:** TypeScript, zod 4, tRPC, Drizzle/Postgres, WebCrypto AES-GCM, vitest, vinext, varlock, alchemy.

**Spec:** [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) §6.3 (accounts and postings), §6.5 (payouts), team settings "Payout credentials" and "Payout mode"; [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §2, §5 run 5, §8 (18 or older).

**Decisions (Mouhamed, 2026-10-12):**
1. Run 5 is split: 5a is manual payouts end to end (this plan); 5b adds the rules and automatic modes, the payout automation (cron and queue, no LLM: send approved payouts, retry on insufficient funds with backoff) and Discord.
2. Team credentials, as in the spec: each team pastes the client ID and secret of a REST app on its own PayPal Business account. The partner route (sellers grant `PAYOUTS` to Payleor) needs PayPal to enable third-party payouts for the partner app; checked 2026-10-12: a referral with `PAYOUTS` returns 422 `FEATURES_UNAUTHORIZED` even with Payouts turned on for Payleor's sandbox app, and a payout with the seller's auth assertion returns 403.
3. 18 or older: refuse a destination when PayPal reports an age under 18; when PayPal sends no age (the sandbox userinfo has `user_id, sub, name, payer_id, verified_account, emails` and no `age_range`, checked 2026-10-12), the member confirms "I am 18 or older".

**PayPal facts** (`refs/paypal/paypal-rest-api-specifications/openapi/payments_payouts_batch_v1.json`, `reporting_transactions_v1.json`; https://developer.paypal.com/api/rest/webhooks/event-names):
- `POST /v1/payments/payouts` body `{ sender_batch_header: { sender_batch_id, email_subject, email_message? }, items: [{ recipient_type: "PAYPAL_ID", receiver, amount: { value, currency }, note?, sender_item_id }] }` → 201 `{ batch_header: { payout_batch_id, batch_status, sender_batch_header } }`. A `sender_batch_id` reused within 30 days is rejected; after a 5xx the same `sender_batch_id` may be retried safely, and PayPal pays it once. The client also sends `PayPal-Request-Id` (required on every POST by `packages/paypal/src/client.ts`).
- `GET /v1/payments/payouts/{payout_batch_id}` → `{ batch_header: { payout_batch_id, batch_status }, items: [{ payout_item_id, transaction_id?, transaction_status, payout_item_fee?: { currency, value }, payout_item: { amount, receiver, sender_item_id }, errors?: { name, message } }] }`. `batch_status`: `DENIED | PENDING | PROCESSING | SUCCESS | CANCELED`. `transaction_status`: `SUCCESS | FAILED | PENDING | UNCLAIMED | RETURNED | ONHOLD | BLOCKED | REFUNDED | REVERSED`.
- Payouts money is `{ value, currency }` (not `currency_code`).
- `GET /v1/reporting/balances?currency_code=USD` → `{ balances: [{ currency, primary?, total_balance: { currency_code, value }, available_balance?: {…}, withheld_balance?: {…} }], account_id, as_of_time, last_refresh_time }`. The app must be allowed to read balances; a 403 means the app lacks the feature.
- Payout webhooks (`PAYMENT.PAYOUTS-ITEM.*`, `PAYMENT.PAYOUTSBATCH.*`) go to the team's own REST app, not Payleor's partner webhook, so Payleor settles by polling the batch (Task 7). Per-item maximum $20,000.
- The sender pays the payout fee (`payout_item_fee`); the team bears it like the other PayPal fees.

**Conventions:** work in `worktrees/r5a-team-payouts`. Checks per task: `npx vitest run <paths>` (DB tests use `.env.test.local`), `pnpm check-types`, `pnpm lint` (0 findings; anti-slop rules: decode at boundaries with zod, no `typeof`, no `unknown` params except `cause`, `SAFETY:` comments on any assertion, `fromPartial` for fakes). Tests at the strongest boundary (router or use-case with the real database, PayPal faked at `fetch` with `fakeFetch` from `packages/paypal/src/testing.ts`), following the test-audit authoring gate: each new test names a credible regression and does not duplicate an existing one; extend tables where they exist. Comments only for non-obvious reasons; never mention runs or tasks. Commit messages end with the `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>` trailer. Never print or log a client secret, a decrypted secret, an access token or the platform key.

## Ledger rules (all tasks)

Builders in `packages/core/src/ledger/postings.ts:203-239` already exist and are unused: `payoutRequestedTransfer`, `payoutSucceededTransfer`, `payoutReleasedTransfer` (`PayoutPosting = { currency, payoutRequestId, freelancerId, amountMinor }`, `projectId: null`). `{freelancerId}` is the Better Auth user id (completion posts `owed:{assignedFreelancerId}:available`, `packages/api/src/use-cases/payments.ts:112-133`). `owed:*` and `paid_out:*` never go negative (core invariant and DB CHECK); `team_revenue` and `paypal_fees` may.

| Fact | Reference | Moves |
|---|---|---|
| Payout requested | `payout_requested:{requestId}` | `owed:{u}:available → owed:{u}:reserved` |
| Rejected by an admin, or failed at PayPal | `payout_released:{requestId}` | `owed:{u}:reserved → owed:{u}:available` |
| PayPal item `SUCCESS` | `payout_succeeded:{requestId}` | `owed:{u}:reserved → paid_out:{u}` |
| Fee on a successful item | `payout_fees:{requestId}` (new kind `payout_fees`) | `team_revenue → paypal_fees`; no transfer when the fee is 0 or unreadable |

Each request settles once: a failed or rejected request is final (its reference is used), and the member makes a new request. A request moves only under its row lock (`select … for update`), and the ledger post happens in the same transaction as the status change.

## Payout request states

`requested` (member asked; money reserved) → `rejected` (admin; released) or `queued` (admin approved). `queued` → `sending` (claimed for a PayPal call) → `sent` (PayPal answered 201 with a batch id) or back to `queued` (balance too low, or PayPal answered `INSUFFICIENT_FUNDS`) or `failed` (a settled refusal; released). A `sending` request whose call had an unknown outcome (5xx, timeout, unreadable answer) stays `sending` with `uncertain_at` set; an admin's Retry sends the same `sender_batch_id` and `PayPal-Request-Id`, which PayPal answers with the first batch. `sent` → `succeeded` (item `SUCCESS`), `failed` (item `FAILED`, `RETURNED`, `BLOCKED`, `REFUNDED`, `REVERSED`, or batch `DENIED`/`CANCELED`; released), or stays `sent` (`PENDING`, `ONHOLD`, `UNCLAIMED`, batch `PENDING`/`PROCESSING`).

One open request (`requested`, `queued`, `sending`, `sent`) per member per team. Amount: at least 1.00 and at most the member's available earnings and 20,000.00 (team currency, minor units). The receiver is the member's destination payer ID at request time, stored on the request (what the admin approves is what PayPal pays).

## Out of scope

Rules and automatic modes, automatic retries of queued payouts, the outbox `payout.*` events and emails (notifications run), Discord `/earnings` and `/payout request` and buttons (5b), the reconciliation job, handling a `RETURNED`/`REVERSED` item after `SUCCESS` (logged with `evlog` and shown as "Needs review"; no posting), payout webhooks, the partner route, freelancer cancellation of a request.

---

### Task 1: packages/paypal — payouts and balances

**Files:** new `packages/paypal/src/payouts.ts` (+ `payouts.test.ts`), new `packages/paypal/src/reporting.ts` (+ `reporting.test.ts`), `packages/paypal/src/schemas.ts`, `packages/paypal/src/client.ts` (wire `payouts` and `reporting` like `payments`), `packages/paypal/src/index.ts`.

- [ ] **Step 1:** zod schemas in `schemas.ts`: `payoutMoneySchema = z.object({ value: z.string(), currency: z.string() })`; `payoutBatchCreatedSchema` (`batch_header.payout_batch_id`, `batch_header.batch_status`); `payoutBatchSchema` (`batch_header` + `items[]` with `payout_item_id`, `transaction_status`, `payout_item_fee` optional and lenient, `payout_item.sender_item_id`, `errors` optional with `name`/`message`); `balancesSchema` (`account_id` optional, `balances[]` with `currency`, `total_balance`, `available_balance` optional). Unknown enum values decode as strings (PayPal adds statuses); the use-case treats unknown statuses as still pending.
- [ ] **Step 2:** `payouts.create({ senderBatchId, requestId, emailSubject, item: { receiverPayerId, amount: { value, currency }, note, senderItemId } })` → `{ batchId, batchStatus }` (POST `/v1/payments/payouts`, `recipient_type: "PAYPAL_ID"`, one item). `payouts.getBatch(batchId)` → `{ batchId, batchStatus, items: [{ itemId, status, fee?: { value, currency }, senderItemId?, error?: { name, message } }] }`.
- [ ] **Step 3:** `reporting.balances(currencyCode)` → `{ accountId: string | null, balances: [{ currency, total, available }] }` (GET `/v1/reporting/balances?currency_code=…`; `available` falls back to `total` when `available_balance` is absent).
- [ ] **Step 4:** tests: `payouts.test.ts` asserts the create request (path, method, `PayPal-Request-Id`, exact body) and the decoded 201, and decodes a batch with one `SUCCESS` item and a fee, one `FAILED` item with `errors`, and an unreadable fee (fee undefined, item kept). `reporting.test.ts` asserts the path/query and decodes a balance with and without `available_balance`. Run `npx vitest run packages/paypal`, `pnpm check-types`, `pnpm lint`. Commit `feat(paypal): payouts and balances`.

### Task 2: packages/core — secret box, age rule, payout rules

**Files:** new `packages/core/src/crypto/secret-box.ts` (+ test), `packages/core/src/payouts/destination.ts` (+ test), new `packages/core/src/payouts/requests.ts` (+ test), `packages/core/src/ledger/transfers.ts`, `packages/core/src/ledger/postings.ts` (+ test), `packages/core/src/index.ts`.

- [ ] **Step 1: secret box.** AES-GCM 256 with WebCrypto (`crypto.subtle`, available in Workers and Node; `packages/api/src/client-links.ts:11-15` shows the existing `importKey` style). The platform key is 32 random bytes, base64 in the env (`PAYOUT_CREDENTIALS_KEY`).

  ```ts
  export type SealedSecret = { ciphertext: string; iv: string; keyId: string };
  export async function importSecretKey(base64Key: string): Promise<CryptoKey>; // throws when not 32 bytes
  export async function sealSecret(key: CryptoKey, keyId: string, plaintext: string, context: string): Promise<SealedSecret>;
  export async function openSecret(key: CryptoKey, sealed: SealedSecret, context: string): Promise<string>;
  ```

  A fresh 12-byte IV per seal; `context` (the team id) is the AES-GCM additional data, so a sealed secret copied to another team's row does not open. `keyId` is `"v1"` for now (stored so a later key rotation can tell rows apart). Tests: a round trip; opening with another context or another key throws; two seals of the same text differ; a key of the wrong length is refused.
- [ ] **Step 2: age rule.** `PayPalUserInfo` gains `age_range?: string`. New `payoutAgeFromUserInfo(userInfo): { kind: "adult" } | { kind: "minor" } | { kind: "unknown" }`: the leading integer of `age_range` (formats like `"18-24"`, `"65+"`; PayPal documents only "string") decides; no age, or one without a leading integer, is `unknown`. A range starting below 18 is `minor`. Extend the existing `destination.test.ts` table.
- [ ] **Step 3: payout rules.** In `requests.ts`: `PAYOUT_REQUEST_STATUSES`, `OPEN_PAYOUT_REQUEST_STATUSES`, `MIN_PAYOUT_MINOR = 100`, `MAX_PAYOUT_MINOR = 2_000_000`, `payoutAmountProblem({ amountMinor, availableMinor }): string | null` (messages: "Enter at least 1.00.", "You can request up to {available}.", "PayPal pays at most 20,000.00 at a time."), and `payoutItemOutcome(status: string): "succeeded" | "failed" | "pending"` plus `payoutBatchOutcome(batchStatus)` (`DENIED`/`CANCELED` → failed). One table test per function.
- [ ] **Step 4: fee posting.** Add `payout_fees` to `LEDGER_TRANSFER_KINDS` (TS-only enum; no migration) and `payoutFeesTransfer({ currency, payoutRequestId, feeMinor }): LedgerTransferDraft | null` (`team_revenue → paypal_fees`, null for 0). Add one case to the postings balance property test and one null case. Commit `feat(core): secret box, payout age rule, payout request rules`.

### Task 3: packages/db — credentials, payout requests, destination age

**Files:** `packages/db/src/schema/payouts.ts`, `packages/db/src/schema/index.ts`, new migration via `pnpm -F @jendal-workspace/db db:generate` (then hand-add CHECK constraints in the SQL, as `20261012040312_b3_payout_prerequisites` does), new `packages/db/src/repositories/payout-credentials.ts`, `packages/db/src/repositories/payout-requests.ts` (+ tests), `packages/db/src/repositories/payouts.ts`, `packages/db/src/testing/db.ts` (`truncateAll` list).

- [ ] **Step 1: schema.**
  - `team_payout_credentials`: `team_id` text PK → `team.id` on delete cascade; `client_id` text not null; `secret_ciphertext`, `secret_iv`, `key_id` text not null; `paypal_account_id` text not null (from the balances answer); `verified_at`, `created_at`, `updated_at` timestamps not null.
  - `payout_request`: `id` text PK (uuid); `team_id` → team (restrict); `user_id` → user (restrict; money history); `currency` (`USD`/`EUR`); `amount_minor` bigint not null CHECK > 0; `status` text CHECK in the states above, default `requested`; `receiver_payer_id` text not null; `paypal_batch_id` text unique null; `paypal_item_id` text null; `paypal_item_status` text null; `fee_minor` bigint null; `failure_message` text null; `review_reason` text null; `uncertain_at` timestamptz null; `decided_by_user_id` text → user null; `created_at`, `decided_at`, `sent_at`, `settled_at`, `updated_at`. Indexes `(team_id, status)`, `(user_id, team_id)`, and a partial unique index on `(team_id, user_id)` where `status in ('requested','queued','sending','sent')` (one open request).
  - `payout_destination` gains `age_confirmed_at` timestamp null and `age_source` text null CHECK in (`paypal`, `self`).
- [ ] **Step 2: repositories.** `payout-credentials.ts`: `getTeamPayoutCredentials(db, teamId)`, `saveTeamPayoutCredentials(db, row)` (upsert), `deleteTeamPayoutCredentials(db, teamId)`. `payout-requests.ts`: `insertPayoutRequest(tx, …)`, `lockPayoutRequest(tx, id)` (`for update`), `updatePayoutRequest(tx, id, patch)`, `listTeamPayoutRequests(db, teamId)` (with the member's name and email), `listUserPayoutRequests(db, userId)` (with the team's name and slug), `listSentPayoutRequests(db, { sentBefore, limit })`, `hasActivePayoutSend(db, teamId)` (any `sending` or `sent`). `payouts.ts`: `savePayoutDestination` takes `age: { confirmedAt, source } | null` and keeps an existing confirmation when the new one is null; `confirmPayoutDestinationAge(db, userId)`; `deletePayoutDestination(db, userId)`; `listMemberEarnings(db, userId)` reading `ledger_balance` for `owed:{u}:available`, `owed:{u}:reserved`, `paid_out:{u}` grouped by team and currency, joined with the team name and slug, nonzero rows only (accounts reject ids containing `:`; the user id is safe).
- [ ] **Step 3: tests** (real DB): the one-open-request partial index refuses a second open request and allows one after the first is `rejected`; `listMemberEarnings` returns per-team balances and skips zero rows; `savePayoutDestination` keeps an earlier age confirmation. Add the two new tables to `truncateAll`. Do not run `pnpm db:migrate:dev` (the controller migrates the dev DB at merge); tests apply migrations to the test DB. Commit `feat(db): team payout credentials, payout requests, destination age`.

### Task 4: packages/api — team payout credentials

**Files:** `packages/api/src/context.ts`, new `packages/api/src/use-cases/payout-credentials.ts`, new `packages/api/src/routers/payouts.ts` (credentials procedures here; Task 5 adds the rest), `packages/api/src/routers/index.ts`, `packages/api/src/routers/services-team.ts` (`get` returns `payoutCredentialsSaved`), `packages/core/src/services-teams/setup-steps.ts` (+ test).

- [ ] **Step 1: context.** `Context` gains `payouts?: PayoutServices`:

  ```ts
  export type PayoutServices = {
    secretKey: CryptoKey;
    keyId: string;
    // Builds a PayPal client for one team's own REST app; the server gives it a per-team token cache.
    clientFor(input: { teamId: string; clientId: string; clientSecret: string }): PayPalClient;
  };
  ```

  When `payouts` is undefined (no key configured), credential and send procedures throw `PRECONDITION_FAILED` "Payouts are not set up on this server."
- [ ] **Step 2: save.** `payouts.saveCredentials({ teamSlug, clientId, clientSecret })` (`servicesTeamProcedure`, action `manage_settings`, refused for solo teams and teams without a connected PayPal merchant: "Connect PayPal first."). It builds a client with the submitted values and calls `reporting.balances(team currency)`: a token refusal (401/`invalid_client`) → BAD_REQUEST "PayPal refused these credentials. Check the client ID and secret."; 403 → BAD_REQUEST "These credentials cannot read the PayPal balance. Turn on the app's balance and payouts features in the PayPal developer dashboard."; `account_id` present and different from `team.paypalMerchantId` → BAD_REQUEST "These credentials belong to another PayPal account than the one connected to this team."; other failures → BAD_GATEWAY "PayPal did not answer. Try again." On success it seals the secret with the team id as context and upserts the row with `paypal_account_id` (`account_id`, or the merchant id when PayPal omits it; log that case at warn). Refuse saving while `hasActivePayoutSend` is true ("Wait for the payouts in progress to finish.").
- [ ] **Step 3: get and remove.** `payouts.credentials({ teamSlug })` (`manage_settings`) → `{ clientIdEnding: last 4 characters, accountId, verifiedAt } | null` (the secret is never returned). `payouts.removeCredentials({ teamSlug })` refuses while `hasActivePayoutSend`.
- [ ] **Step 4: checklist.** `servicesTeamSetupSteps` state gains `payoutCredentialsSaved: boolean` and the step uses it; `servicesTeam.get` returns it (exists query on the credentials table).
- [ ] **Step 5: tests** (router, real DB, PayPal faked at `fetch` through a test `clientFor` that wraps `createPayPalClient` with `fakeFetch`): save stores a sealed secret that opens to the submitted secret and is never returned by `credentials`; a 401 token answer, a 403 balance answer and a mismatched `account_id` are refused with their messages and store nothing; a freelancer gets FORBIDDEN; extend the setup-steps table with the saved case. Commit `feat(api): team payout credentials`.

### Task 5: packages/api — payout requests, approval, send, settle

**Files:** new `packages/api/src/use-cases/payouts.ts`, `packages/api/src/routers/payouts.ts`, `packages/api/src/use-cases/payouts.test.ts` or `packages/api/src/routers/payouts.test.ts` (one primary owner per contract).

Mirror the claim/call/record shape of `packages/api/src/use-cases/client-refunds.ts` (claim in a transaction at `:292`, PayPal call outside any transaction at `:217`, record in a transaction at `:239`, settled-vs-uncertain classification with `isSettledPayPalRefusal` from `paypal-amounts.ts`).

- [ ] **Step 1: request.** `payouts.request({ teamSlug, amount })` (`protectedProcedure`; the team is found by slug; refused for solo teams). The amount parses with the existing price parser used by quotes (major units string → minor). Refusals: no destination → "Connect your PayPal account on this page first."; `age_confirmed_at` null → "Confirm you are 18 or older first."; `payoutAmountProblem` against `owed:{u}:available` read inside the transaction; an open request exists → "You already have a payout in progress for this team." (catch the partial unique index too). In one transaction: insert the request (`receiver_payer_id` from the destination), post `payoutRequestedTransfer`. Owed money is the authorization: a removed member can still request what they are owed; nobody else can (the account key uses the session user id).
- [ ] **Step 2: reject and approve.** `payouts.reject({ teamSlug, requestId })` and `payouts.approve(…)` (`servicesTeamProcedure`, action `approve_payouts`, "Only an admin can approve payouts."). Reject: under the lock, only from `requested`; status `rejected`, `decided_*`, post `payoutReleasedTransfer`. Approve: only from `requested`; status `queued`, `decided_*`, then the send step.
- [ ] **Step 3: send.** `sendPayout(deps, requestId)`, used by approve and by `payouts.retry({ teamSlug, requestId })` (`approve_payouts`; allowed from `queued` and from `sending` with `uncertain_at`). Steps: credentials required ("Add the team's payout credentials first." — request stays `queued`); claim under the lock (`queued` or uncertain `sending` → `sending`); outside any transaction: `reporting.balances(currency)` and if `available < amount` → back to `queued` with failure message "The team's PayPal balance is too low. Add funds, then retry." (skip the balance check on an uncertain retry: PayPal may already have paid); `payouts.create` with `senderBatchId = requestId`, `requestId = "payout:" + requestId`, `senderItemId = requestId`, note "Payout from {team name} via Payleor", `emailSubject` "You have a payout from {team name}". Record: 201 → `sent`, `paypal_batch_id`, `sent_at`, clear `uncertain_at`; a settled refusal with `INSUFFICIENT_FUNDS` in name or details → `queued` with the low-balance message; another settled refusal (and `uncertain_at` null) → `failed` with PayPal's name/message and `payoutReleasedTransfer`; an unknown outcome → stays `sending`, `uncertain_at = now`, BAD_GATEWAY "We could not confirm the payout with PayPal. Try again; the member will not be paid twice." Same rule as client refunds: after an unknown outcome no refusal is final (stay uncertain), because PayPal may hold a batch for this id.
- [ ] **Step 4: settle.** `settlePayout(deps, requestId)` for a `sent` request: `payouts.getBatch(paypal_batch_id)` with the team's client; the item whose `senderItemId` equals the request id (or the only item). Under the lock, still `sent`: `succeeded` → status, `paypal_item_id`, `paypal_item_status`, `fee_minor`, `settled_at`, post `payoutSucceededTransfer` and `payoutFeesTransfer` (fee in another currency or unreadable → no fee posting, `review_reason` "Payout fee in another currency" and a warn log); `failed` → status `failed`, failure message from the item error, post `payoutReleasedTransfer`; `pending` → update `paypal_item_status` only. `payouts.refresh({ teamSlug, requestId })` (`approve_payouts`) runs it on demand; Task 7's sweep runs it on a schedule. A missing credentials row or a PayPal failure leaves the request `sent` (logged).
- [ ] **Step 5: reads.** `payouts.list({ teamSlug })` (`approve_payouts`) → requests newest first with member name/email, amount, status, failure message, fee; `payouts.mine()` (protected) → `{ earnings: listMemberEarnings, requests: listUserPayoutRequests }`.
- [ ] **Step 6: tests** (router level, real DB, PayPal faked at `fetch`):
  1. request → approve → `sent` (create request carries `sender_batch_id`, `PayPal-Request-Id`, `PAYPAL_ID` receiver from the destination, the amount) → refresh with a `SUCCESS` item and a $0.25 fee → `succeeded`; owed available/reserved/paid out and `paypal_fees`/`team_revenue` balances are exact; a second refresh posts nothing.
  2. reject releases the reservation; a new request is then allowed.
  3. low balance keeps `queued` with the message and sends nothing; retry after the balance rises sends.
  4. an unknown outcome (500 on create) stays `sending` with `uncertain_at`; then a settled 422 stays uncertain (not `failed`); then 201 → `sent`; every create carried the same `PayPal-Request-Id` and `sender_batch_id`.
  5. a `FAILED` item releases the reservation and stores the error message.
  6. refusals: no destination, no age confirmation, amount above available, a second open request, a freelancer calling approve (FORBIDDEN with the admin message), another user cannot request against someone else's earnings (they have none: amount above available).
  Commit `feat(api): payout requests, approval, sending and settling`.

### Task 6: packages/api — age rule on the payout destination

**Files:** `packages/api/src/paypal-userinfo.ts` (schema gains `age_range` optional), `packages/api/src/routers/payout-destination.ts` (+ test), `packages/core/src/payouts/destination.ts` (Task 2).

- [ ] **Step 1:** `connect` takes `{ confirmAdult: boolean }` (default false). After `payoutDestinationFromUserInfo`: `minor` → delete any existing destination and throw BAD_REQUEST "PayPal says this account belongs to someone under 18. Payouts need a recipient who is 18 or older."; `adult` → save with `{ source: "paypal" }`; `unknown` → save with `{ source: "self" }` when `confirmAdult` is true, else save without an age (the page then asks for the confirmation).
- [ ] **Step 2:** `payoutDestination.confirmAdult()` (protected): requires a destination; sets `age_confirmed_at = now`, `age_source = "self"` unless PayPal already confirmed. `get` returns `ageConfirmed: boolean`.
- [ ] **Step 3: tests:** extend `payout-destination.test.ts`: `age_range "18-24"` saves with source paypal; `"13-17"` refuses and removes an existing destination; no `age_range` with `confirmAdult` saves source self; without it saves with `ageConfirmed: false`, and `confirmAdult` then confirms. Commit `feat(api): payout recipients must be 18 or older`.

### Task 7: apps/server and infra — key, per-team client, settle sweep

**Files:** `apps/server/.env.schema` (+ `pnpm -F server env:generate`), `packages/infra/.env.schema` (pick list), `packages/infra/alchemy.run.ts` (server env), `apps/server/src/services.ts`, `apps/server/src/context.ts`, `apps/server/src/maintenance.ts` (+ `maintenance.test.ts`), `apps/server/src/index.ts`, local `apps/server/.env` (generate a key with `openssl rand -base64 32`; never print it), `README` or dev notes only if the repo documents env vars there.

- [ ] **Step 1:** `PAYOUT_CREDENTIALS_KEY` as an optional sensitive secret (`# @required=false @type=string`), added to the infra pick list and to the server Worker env with `Config.Redacted("PAYOUT_CREDENTIALS_KEY").pipe(Config.withDefault(Redacted.make("")))` (same form as `RESEND_API_KEY`). Empty → `payouts` undefined in the context.
- [ ] **Step 2:** `getPayoutServices()` in `services.ts`: imports the key once per isolate (memoize the promise), `keyId: "v1"`, `clientFor` builds `createPayPalClient({ clientId, clientSecret, environment, tokenCache: createKvTokenCache(ENV.STORE_CACHE, "paypal-token:" + environment + ":team:" + teamId + ":" + clientId) })` (no partner attribution id: these are the team's own calls). `createContext` passes it.
- [ ] **Step 3:** maintenance sweep `"payouts"`: deps gain `settlePayouts?: () => Promise<{ checked: number; settled: number }>`; the sweep runs it when present. The server implementation lists `sent` requests sent more than 1 minute ago (limit 50) and calls `settlePayout` for each (errors per request logged, the sweep continues). Test in `maintenance.test.ts`: the sweep reports the counts and a failure lands in `report.errors` without stopping the other sweeps.
- [ ] **Step 4:** `pnpm check-types`, `pnpm lint`, `npx vitest run apps/server`. Commit `feat(server): payout credentials key, team PayPal clients, payout settle sweep`.

### Task 8: apps/web — Payouts page and /me/payouts

**Files:** new `apps/web/src/app/admin/[storeSlug]/payouts/page.tsx` and components (credentials card, request queue), `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx` (nav link "Payouts" for team sellers; replace the `<ComingSoon title="Payouts" />` placeholder with a link card; pass `payoutCredentials: "/{slug}/payouts"` and `payoutCredentialsSaved` to the checklist), `apps/web/src/app/admin/me/payouts/page.tsx` and `payouts-setup.tsx` (+ new earnings and history components), `apps/web/src/components/user-menu.tsx` (a "Payouts" link to `/me/payouts`), small label helpers in `apps/web/src/lib/payouts.ts` (+ test only for real logic such as which actions a status allows).

Follow the existing patterns: server page guards like `settings/page.tsx` (`requireSession`, `isServicesTeamSlug`), tRPC `useMutation(...mutationOptions({ onSuccess: invalidate }))`, global error toasts, the native `<dialog>` confirmation from `refund-section.tsx`.

- [ ] **Step 1: team Payouts page** (admins; others see "Only an admin can manage payouts."):
  - "Payout credentials" card: when none, a short explanation ("Payleor sends payouts from your PayPal account with a REST app you create at developer.paypal.com. Payleor encrypts the secret and never shows it again.") and a form (Client ID, Secret, "Save credentials"); when saved, "App ending in {xxxx} · PayPal account {accountId} · checked {date}" with "Replace" and "Remove".
  - Requests table: member, amount, requested date, status label (`requested` "Waiting for approval", `queued` "Approved, waiting to send", `sending` "Sending" / "Not confirmed" when uncertain, `sent` "Sent, waiting for PayPal", `succeeded` "Paid", `failed` "Failed", `rejected` "Rejected"), failure message, fee. Actions: Approve (confirmation dialog "Send {amount} to {member}? PayPal sends it from your PayPal account."), Reject, Retry (queued or uncertain), Refresh (sent).
- [ ] **Step 2: /me/payouts:** the destination card shows the age state; when `ageConfirmed` is false, a checkbox "I am 18 or older" and "Confirm"; the connect flow passes `confirmAdult` (checkbox above "Log in with PayPal", carried in the callback URL as `adult=1`). "Earnings" lists each team: available, in progress, paid out, and a request form (amount prefilled with the available amount, "Request payout"). "History" lists requests with team, amount, status and date.
- [ ] **Step 3:** `npx vitest run apps/web`, `pnpm check-types`, `pnpm lint`. Commit `feat(web): team payouts page and member earnings`.

### Task 9: final review, merge, walkthrough (controller)

- [ ] Full `npx vitest run`, `pnpm check-types`, `pnpm lint`; whole-branch review (money: every request posts once per fact, owed accounts never negative, the same `sender_batch_id` and `PayPal-Request-Id` on every retry, no refusal trusted after an unknown outcome, locks; secrets never logged or returned); merge `--no-ff`; `pnpm install`; `pnpm db:migrate:dev`; add `PAYOUT_CREDENTIALS_KEY` to the dev env; restart the dev stack.
- [ ] Walkthrough over the tunnel in the sandbox (Mouhamed creates a sandbox REST app on walk-crew's business account `TR4W3HLBT75MG` with Payouts on, and logs in as the member in the PayPal popup):
  1. Credentials: a wrong secret is refused; the real ones save; the checklist step is done; the database holds only ciphertext.
  2. A walk-crew member with earnings (`owed:vqB1elxY3lUycHZxcxddZlXJnmEeOO7M:available`) connects a payout destination (a sandbox personal account) and confirms 18 or older.
  3. Request $10.00 → admin rejects → released; request $25.00 → admin approves → `sent` (batch id stored) → the sweep (or Refresh) settles `succeeded`; ledger `payout_requested`, `payout_succeeded`, `payout_fees` once; the member sees "Paid"; the recipient's sandbox account shows the payout.
  4. Ledger vs PayPal with the team's own credentials: `GET /v1/reporting/transactions` for walk-crew lists the captures, refunds and the payout; compare with the ledger and settle the $0.14 Icon pack platform-fee question from §11.1.
- [ ] Record the outcome here, update §5 run 5 and §11.1 in the sellers spec, update `specs/README.md`.

## Outcome

(To be filled in by the controller.)
