# B3: Payout prerequisites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before payouts (run 5), the ledger matches the PayPal balance for every refund and capture Payleor sees: refunds post the fees PayPal returns, captures refunded before Payleor applied them are recorded, refunds of services payments are posted instead of parked, an overpaid client is refunded from the admin through PayPal's API, and converted funds are flagged for review.

**Architecture:** PayPal facts stay decoded in `packages/paypal` (Task 1). Ledger builders and pure rules live in `packages/core` (Task 2). New columns and a `project_refund` table in `packages/db` (Task 3). Use-cases in `packages/api` apply facts idempotently under row locks, one ledger reference per fact (Tasks 4–6). The admin and client pages show refunds (Task 7).

**Tech stack:** TypeScript, zod 4, tRPC, Drizzle/Postgres, vitest, vinext.

**Spec:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §11.1 rows "From the R4b final review: a refund posts the gross amount…", "Fees in another currency…", "A client left overpaid by a decrease…"; [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) (team bears processing fees; an admin confirms every refund; overpayment refunded on the original captures).

**Decisions (Mouhamed, 2026-10-12):**
1. Overpayment refunds: an admin clicks "Refund client" in Payleor, and Payleor calls PayPal's capture refund API with the seller's auth assertion. The click is the confirmation.
2. Platform fee: Payleor does not ask for its fee back; it records whatever PayPal reports as returned.
3. Converted funds: store PayPal's amounts, log a warning, mark the order or payment "needs review"; no second currency in the ledger.
4. Refunds and reversals of services payments without a refund request are posted and the payment marked refunded, like store orders.

**Sandbox facts (checked 2026-10-12 on order `0CU35641GK123520K`):** `GET /v2/checkout/orders/{id}` returns `purchase_units[0].payments.refunds[].seller_payable_breakdown` (same as `GET /v2/payments/refunds/{id}`). The $5.00 partial refund of the $19.00 Icon pack returned `paypal_fee` $0.19 and `platform_fees[0].amount` $0.05 (PayPal returned Payleor's fee in proportion on its own), `net_amount` $4.76, `total_refunded_amount` $5.00. So the seller's balance dropped by $4.76: buyer +5.00, PayPal fee −0.19, Payleor fee −0.05.

**Conventions:** work in `worktrees/b3-payout-prerequisites`. Checks per task: `npx vitest run <paths>` (DB tests use `.env.test.local`), `pnpm check-types`, `pnpm lint` (0 findings; anti-slop rules apply to new code: decode at boundaries, no `typeof`, no `unknown` params except `cause`, `SAFETY:` comments on any assertion, `fromPartial` for fakes). Tests at the strongest boundary (router or use-case with the real database, PayPal faked at `fetch`), following the test-audit authoring gate: each new test names a credible regression and does not duplicate an existing one; extend tables where they exist. Comments only for non-obvious reasons; never mention runs or tasks. Commit messages end with the Co-authored-by trailer.

## Ledger rules (all tasks)

Accounts and builders are in `packages/core/src/ledger/` (`accounts.ts`, `postings.ts`, `transfers.ts`). One currency per transfer; `client_held`, `owed:*`, `paid_out:*` and `client_refunds` never go negative (DB CHECK); `team_revenue` may.

| Fact | Reference | Moves |
|---|---|---|
| Fees a refund returns (orders and payments) | `refund_fees:{paypalRefundId}` | `paypal_fees → team_revenue` (returned PayPal fee), `payleor_fees → team_revenue` (returned platform fees); no transfer when both are 0 |
| Refund of a services payment without a request | `payment_refunded:refund:{paypalRefundId}` | `paypal_clearing ← client_held:{project}` up to that account's balance, the rest `← team_revenue` |
| Reversal (chargeback) of a services payment | `payment_refunded:reversal:{captureId}` | same split, amount = captured − already refunded |
| Requested overpayment refund confirmed | `refund_confirmed:{paypalRefundId}` (existing `refundConfirmedTransfer`) | `client_refunds → paypal_clearing` |

Existing and unchanged: `order_refunded:refund:{id}` (gross, `team_revenue → paypal_clearing`), `order_refunded:reversal:{captureId}`, `refund_requested:completion-{projectId}` (`client_held → client_refunds` for the quote part, `team_revenue → client_refunds` for the management fee).

Why `client_held` first for unrequested services refunds: money for an open project sits in `client_held:{project}` until completion releases it to members; refunding from `team_revenue` alone would leave `client_held` overstated and completion would release money the client already got back.

## Out of scope

Payouts, the reconciliation job, a second ledger currency, disputes UI, refunds of store orders from the admin (sellers refund store orders in PayPal; the webhook handles them).

---

### Task 1: packages/paypal — refund breakdowns, converted receivables, capture refunds

**Files:** `packages/paypal/src/schemas.ts`, `packages/paypal/src/orders.ts` (+ `orders.test.ts`), new `packages/paypal/src/payments.ts` (+ `payments.test.ts`), `packages/paypal/src/client.ts` (wire `payments`), `packages/paypal/src/index.ts`.

Facts: `refundSchema` (`schemas.ts:64`) decodes `id`, `status`, `amount` only. `captureBreakdownSchema` (`schemas.ts:48-52`) decodes `paypal_fee` and `platform_fees`; the Orders v2 spec also has `net_amount`, `receivable_amount`, `exchange_rate`, `paypal_fee_in_receivable_currency` (`refs/paypal/paypal-rest-api-specifications/openapi/checkout_orders_v2.json:11946-12029`, refund breakdown `:12306-12370`). Capture refund: `POST /v2/payments/captures/{capture_id}/refund` with `PayPal-Auth-Assertion`, `PayPal-Request-Id`, `Prefer: return=representation`; body `{ amount: { value, currency_code }, note_to_payer? }`; answers a refund object (`refs/.../payments_payment_v2.json`).

- [ ] **Step 1:** refund items gain `seller_payable_breakdown` with `paypal_fee`, `platform_fees[]`, `net_amount`, decoded strict-or-undefined like `captureBreakdownSchema` (a present but unreadable fee makes the breakdown `undefined`, never 0). `PayPalRefund` gains `breakdown?: { paypalFee?: PayPalMoney; platformFees: PayPalMoney[]; net?: PayPalMoney }` (match existing naming in `orders.ts`).
- [ ] **Step 2:** the capture breakdown also decodes `net_amount`, `receivable_amount`, `exchange_rate` (`{ value, source_currency, target_currency }`), all optional and lenient.
- [ ] **Step 3:** `payments.refundCapture({ captureId, merchantId, requestId, amount, noteToPayer? }): Promise<PayPalRefund>` using `request(options, refundSchema)`; no `payment_instruction` (decision 2).
- [ ] **Step 4:** tests: extend `orders.test.ts`'s `refundsFromOrder` table with the sandbox breakdown above (and one unreadable fee → `breakdown` undefined); `payments.test.ts` asserts the request (path, method, the three headers, body) and the decoded refund for a fake 201. Run `npx vitest run packages/paypal`, `pnpm check-types`, `pnpm lint`. Commit `feat(paypal): refund breakdowns, converted receivables, capture refunds`.

### Task 2: packages/core — builders and review rule

**Files:** `packages/core/src/ledger/postings.ts`, `transfers.ts` (`LEDGER_TRANSFER_KINDS`), `postings.test.ts`; new `packages/core/src/payments/review.ts` (+ test) or the closest existing module for capture facts (check `packages/core/src/` for where `CaptureFact` lives).

- [ ] **Step 1:** `refundFeesTransfer({ teamId, refundId, currency, paypalFeeMinor, platformFeeMinor })` → `LedgerTransfer | null` (kind `refund_fees`).
- [ ] **Step 2:** `paymentRefundedTransfer({ teamId, projectId, reference, currency, fromClientHeldMinor, fromTeamRevenueMinor })` (kind `payment_refunded`); the caller computes the split from the `client_held:{project}` balance (read it with the ledger repository inside the same transaction). A pure helper `splitServicesRefund({ amountMinor, clientHeldMinor })` returns the two parts.
- [ ] **Step 3:** `captureReviewReason(breakdown, captureCurrency): string | null` returns `"converted_receivable"` when `receivable_amount` is in another currency than the capture, `"fee_currency"` when a fee's currency differs, else null.
- [ ] **Step 4:** tests: one table in `postings.test.ts` for the two builders (balanced, zero parts dropped, null when both fees are 0); one table for `splitServicesRefund` (held covers all, part, none); one table for `captureReviewReason`. Commit `feat(core): refund fee, services refund and review rules`.

### Task 3: packages/db — columns, project refunds, repositories

**Files:** `packages/db/src/schema/orders.ts`, the services payment schema (`rg "pgTable\(\"payment\"" packages/db/src/schema`), new `packages/db/src/schema/project-refunds.ts`, a migration via `pnpm --filter @jendal-workspace/db db:generate` (check the script name in `packages/db/package.json`), repositories and their tests.

Schema:
- `orders.review_reason text null`.
- `payment.refunded_minor bigint not null default 0`, `payment.review_reason text null`, and allow status `refunded` if `payment.status` has a CHECK or enum (`packages/core/src/projects/quotes.ts:13` lists `pending | captured | failed | cancelled`; add `refunded` there too and keep `captured` for partial refunds).
- `project_refund`: `id text pk` (the existing completion refund id, `completion-{projectId}`), `team_id`, `project_id` (fk, restrict), `currency`, `amount_minor bigint check > 0`, `status text check in ('requested','issuing','completed','failed')`, `created_at`, `completed_at null`.
- `project_refund_part`: `id uuid pk`, `project_refund_id` fk, `payment_id` fk, `capture_id text`, `amount_minor bigint check > 0`, `paypal_refund_id text unique null`, `status text check in ('pending','completed','failed')`, `created_at`; unique `(project_refund_id, payment_id)`.

Repositories (names are suggestions; match the existing style in `packages/db/src/repositories/`): `createProjectRefund(tx, …)`, `findProjectRefundForProject`, `lockProjectRefund`, `upsertRefundPart`, `findRefundPartByPayPalRefundId`, `markRefundPart…`, `addPaymentRefunded(tx, paymentId, amountMinor)`, `setOrderReviewReason`, `setPaymentReviewReason`.

- [ ] **Step 1:** schema + migration; check constraints in the migration; run it against the test database (the test setup applies migrations; check `packages/db/src/testing`).
- [ ] **Step 2:** repositories with tests only where they hold logic (locking, uniqueness, the check constraints); no tests for pass-through inserts.
- [ ] **Step 3:** `npx vitest run packages/db`, `pnpm check-types`, `pnpm lint`. Commit `feat(db): project refunds, payment refunds and review reasons`.

### Task 4: store orders — returned fees, early refunds, review (reviewed)

**Files:** `packages/api/src/use-cases/orders.ts`, `packages/api/src/use-cases/paypal-webhooks.ts`, tests in `packages/api/src/use-cases/paypal-webhooks.test.ts` and `packages/api/src/routers/checkout.test.ts`, the admin orders list (`apps/web/src/app/admin/[storeSlug]/orders/orders-list.tsx`) and its router output.

Facts: `applyOrderRefund` (`orders.ts:530-599`) posts `order_refunded` per completed refund with `postOnce` (`:518-525`) and skips other-currency refunds with a warning. `captureAndApply` (`:456-472`) throws `refunded()` for a REFUNDED/PARTIALLY_REFUNDED/REVERSED capture before applying it; `processOrderEvent` (`paypal-webhooks.ts:139`) routes a refunded capture to the refund path, which answers "not paid" for a pending order; `recordOrderFees` (`:333-350`) returns early unless the fact is COMPLETED. `checkout.test.ts:394-409` asserts today's early-refund behaviour (order stays pending).

- [ ] **Step 1 (returned fees):** in the refund loop, after `order_refunded`, post `refundFeesTransfer` from the refund's breakdown with `postOnce`; a refund with no readable breakdown posts nothing for fees and logs `order.refund_fees` with `posted: false`. Test: extend the refund-by-capture-id test (`paypal-webhooks.test.ts:577`) with the sandbox breakdown and assert both transfers once after a second delivery.
- [ ] **Step 2 (early refunds):** a capture already refunded when Payleor first sees it is applied, then refunded, under the order lock, with no grant and no email: record the capture id, mark paid with `paid_at` from the capture, post `order_paid`, record fees from the capture's breakdown (let `recordOrderFees` accept the refunded capture), then run the refund path. Use it from `captureAndApply` (the browser still gets the existing "refunded" refusal message) and from `processOrderEvent` when the order is pending. Keep the amount/currency conflict check. Update `checkout.test.ts:394-409` to the new behaviour (this is the one assertion change B3 makes, because the behaviour changes by decision); add a webhook-path case to the existing refunded-capture test (`paypal-webhooks.test.ts:736`).
- [ ] **Step 3 (review):** when the capture's `captureReviewReason` is non-null, store it on the order and log `order.fees` `{ review: reason }`; the fee posting still runs when the fees are in the capture currency. Admin orders list shows "Needs review" next to the status. Test: one case in the existing fees test table with a converted receivable.
- [ ] **Step 4:** `npx vitest run packages/api apps/server apps/web`, `pnpm check-types`, `pnpm lint`. Commit `fix(api): store refunds post returned fees, early refunds are recorded, converted funds flagged`.

### Task 5: services payments — refunds and reversals posted (reviewed)

**Files:** `packages/api/src/use-cases/paypal-webhooks.ts` (`:101-110`, `:166`, `:192-194`), `packages/api/src/use-cases/payments.ts` (`applyCaptureFact` `:242-245`, `recordCaptureFees`, `captureFact` `:345-361`), new `packages/api/src/use-cases/payment-refunds.ts`, tests in `paypal-webhooks.test.ts` (replace the "project refunds parked" case at `:338`) and `routers/payment.test.ts`.

- [ ] **Step 1:** `applyPaymentRefunds(deps, { payment, order })` mirrors `applyOrderRefund`: for each completed refund in the re-fetched PayPal order, under the payment row lock:
  - if `findRefundPartByPayPalRefundId` matches a requested overpayment part → post `refund_confirmed:{id}` (amount) and `refund_fees:{id}`; mark the part completed; when every part of the project refund is completed, mark it completed;
  - otherwise → `payment_refunded:refund:{id}` with the `client_held` / `team_revenue` split, `refund_fees:{id}`, and `addPaymentRefunded`; when `refunded_minor` reaches the captured amount, status `refunded`.
  A REVERSED capture posts `payment_refunded:reversal:{captureId}` for captured − refunded. Other-currency refunds are skipped with a warning, as for orders.
- [ ] **Step 2:** route the three parked branches and the REVERSED capture status to it (no more parking or retry-until-failed for these); a refund whose payment row cannot be found is still `ignored`.
- [ ] **Step 3:** services capture fees get the same review rule as Task 4 Step 3 (`payment.review_reason`).
- [ ] **Step 4:** tests (use-case level, real DB, PayPal faked): unrequested partial refund on an open project (split from `client_held`, fees returned, second delivery posts nothing new); refund on a completed project (all from `team_revenue`); reversal after a partial refund; a matched overpayment part (`refund_confirmed`, part and refund completed). Commit `fix(api): post refunds and reversals of services payments`.

### Task 6: overpayment refunds issued from the admin (reviewed)

**Files:** `packages/api/src/use-cases/projects.ts` (`acceptDelivery` `:705-728`), `payment-refunds.ts`, `packages/api/src/routers/project.ts` (new `refundClient` mutation, `clientGet` `:303-377`, the staff project query), tests in `routers/project.test.ts`.

- [ ] **Step 1:** `acceptDelivery` creates the `project_refund` row (status `requested`) in the same unit of work as `refund_requested` when the completion leaves an overpayment.
- [ ] **Step 2:** `project.refundClient({ teamSlug, projectId })`, allowed for the team's admins (`requireAction(ctx.servicesTeamRole, "manage_settings", …)` or the action the payouts spec names; check `core/services-teams/permissions.ts`). Under the project refund lock: status `requested` or `failed` → `issuing`; split the amount across the project's captured payments newest first by `captured − refunded_minor` (pure helper in core, tested by table); for each part create or reuse the `project_refund_part` row, call `payments.refundCapture` with request id `project-refund:{refundId}:{paymentId}` (stable, so a retry never refunds twice); store the PayPal refund id and status; a COMPLETED answer applies the same confirmation as Task 5 Step 1 (idempotent with the webhook); a PENDING answer waits for the webhook. Any PayPal failure marks the part and refund `failed` with the PayPal error logged, and the admin may retry.
- [ ] **Step 3:** `clientGet` returns `refund: { amountMinor, currency, status, completedAt } | null`; the staff project query returns the same plus the parts.
- [ ] **Step 4:** tests (router level, PayPal faked at `fetch`): refund across two captures (requests carry the stable request ids and the auth assertion; transfers `refund_confirmed` and `refund_fees` per part; `client_refunds` back to 0); retry after a failed second part refunds only the second; a freelancer gets FORBIDDEN; no project refund → BAD_REQUEST with a plain message. Commit `feat(api): refund an overpaid client through PayPal`.

### Task 7: web — refund on the client and admin project pages

**Files:** `apps/web/src/app/(site)/c/[token]/client-project.tsx`, the admin project page (`apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx`), payments rows on both.

- [ ] Client page: "Refund of $X: on its way" (requested, issuing) / "Refunded $X on {date}" (completed) / nothing when there is no refund; a failed refund shows "on its way" too (the team retries). Refunded payments show "Refunded" or "Partly refunded $Y".
- [ ] Admin project page: a "Refund to the client" section with the amount, the parts and their status, and a "Refund $X to the client" button for admins, behind a confirmation dialog ("Refund $X to {client}? PayPal sends it from your PayPal account. This cannot be undone."); failed parts show the PayPal message and "Try again" (which opens the same dialog). "Needs review" on payments with a review reason.
- [ ] Follow the existing dialog and mutation patterns (see the store "Turn off" confirmation from R4b). `npx vitest run apps/web`, `pnpm check-types`, `pnpm lint`. Commit `feat(web): show and issue client refunds`.

### Task 8: final review, merge, walkthrough (controller)

- [ ] Full `npx vitest run`, `pnpm check-types`, `pnpm lint`; whole-branch review (money: every PayPal fact posts once, `client_held`/`client_refunds` never negative, locks, request ids); merge `--no-ff`; `pnpm install`; `pnpm db:migrate:dev`; restart the dev stack.
- [ ] Walkthrough over the tunnel in the sandbox:
  1. Re-queue walk-crew's `PAYMENT.CAPTURE.REFUNDED` event → `refund_fees:96J18915S7072594A` posts paypal_fees −19, payleor_fees −5, team_revenue +24 once; a second re-queue posts nothing.
  2. A services project on walk-crew: quote, the client pays the deposit in the sandbox (Mouhamed pays in the popup), deliver, lower the final price below the deposit, the client accepts → the client page shows "Refund of $X: on its way", the admin shows the Refund section.
  3. "Refund $X to the client" → PayPal refund COMPLETED, transfers `refund_confirmed` and `refund_fees`, `client_refunds` 0, client page "Refunded $X on …"; the `PAYMENT.CAPTURE.REFUNDED` webhook arrives and posts nothing new.
  4. A partial refund of another services payment through the API (as in the R4b walkthrough) → `payment_refunded:refund:{id}` split from `client_held`, payment "Partly refunded".
  5. Ledger check: for walk-crew, `−paypal_clearing − paypal_fees − payleor_fees` equals the sum of PayPal net amounts for its captures minus refunds' net amounts (compute from the sandbox API).
- [ ] Record the outcome here, close the §11.1 rows (refund fees, early refunds, overpayment refunds; converted funds: flagged, posting left to reconciliation), update `specs/README.md`.

## Outcome

Done 2026-10-12, merged as `0060728` (branch `b3-payout-prerequisites`, 1268 tests, `pnpm lint` 0). Commits: `c1d3879` (paypal), `c3f69e3` (core), `646e957` (db), `4f20250` + `6e61dc6` (store refunds), `c5c917a` + `27ba0a5` (services refunds), `8cb146d`, `653e0cc`, `ce67d27`, `2e6929f` (admin refunds, migration `20261012052419_b3_refund_part_uncertain`), `2b62875` (web), `1827c2a` (final review: retry of a refund stuck in `issuing` with an unsent part, "This refund is being sent." guard).

Walkthrough over the tunnel in the sandbox:

1. Re-queued `WH-0KH43553NC381154B-8CR35458A7329015W` posted `refund_fees:96J18915S7072594A` (paypal_fees −19, payleor_fees −5, team_revenue +24) once.
2. walk-crew "Landing page redesign" (deposit $180 = $150 + $30 fee, capture `5K696237F8772480U`): an amendment replaced the $300 line with a $100 one, the client accepted it ($20 of the fee credited back), the team delivered and the client accepted. Completion released $100 and posted `refund_requested` for $70. The client page said "Completed · Final price $100.00" and "Refund of $70.00: on its way"; the admin showed "The client overpaid by $70.00." and "Refund $70.00 to the client".
3. The button opened "Refund $70.00 to mdbm-agent@agentmail.to? PayPal sends it from your PayPal account. This cannot be undone."; confirming refunded $70 (`62475237UE3580138`, COMPLETED). Posted `refund_confirmed` (client_refunds −7000) and `refund_fees` (paypal_fees −273, payleor_fees −70); `client_refunds` and the project's `client_held` are 0; the part and the refund are `completed`; the payment shows `refunded_minor` 7000. The admin said "Refunded $70.00 on 10/12/2026 · Deposit · $70.00 · Sent", the client page "Refunded $70.00 on 10/12/2026". The `PAYMENT.CAPTURE.REFUNDED` webhook arrived 20 seconds later and posted nothing.
4. Every walk-crew project with a capture was completed, so the outside refund took the completed-project path instead of `client_held` (the `client_held` split is covered by the use-case tests): a $3.00 API refund of "Pay page checks"' balance capture `65Y63297WW733263J` (`42N5417244170894V`) posted `payment_refunded:refund:42N5417244170894V` (team_revenue → paypal_clearing 300) and `refund_fees` (−12, −3); the admin shows "Partly refunded $3.00". A re-queue of its webhook posted nothing.
5. Ledger check: `−paypal_clearing − paypal_fees − payleor_fees` = $343.41; PayPal's net amounts (6 captures minus 3 refunds) = $343.55. Every services capture and every refund matches; the $0.14 is the Icon pack capture `7PF4242403213591M`, whose breakdown now says a $0.05 platform fee where PayPal reported $0.19 at capture (R4b walkthrough, and the PayPal order's `payment_instruction`). Left open in §11.1 for the payouts run.
