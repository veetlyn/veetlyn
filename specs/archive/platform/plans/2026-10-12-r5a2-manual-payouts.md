# R5a-2 Manual Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace R5a's automated payouts (team REST app credentials, Payouts API sends, settle sweep) with a manual route: the owner pays the member in PayPal and marks the request paid in Payleor.

**Architecture:** A member still connects PayPal with Log in with PayPal (verified payer ID and email, 18+ rule) and requests an amount from their available earnings; the request reserves it in the ledger. An admin sees the member's PayPal email and the amount, opens PayPal's send page, pays, and marks the request paid with the amount the member received and an optional PayPal transaction ID. Payleor withholds nothing and makes no PayPal call for payouts. Everything R5a added only for automated sending is removed.

**Tech Stack:** TypeScript monorepo (pnpm, turbo), Hono + tRPC api, Drizzle on Postgres, vinext web app, Vitest with a real test database.

**Base:** main at `2922048`. Branch `r5a2-manual-payouts`, worktree `worktrees/r5a2-manual-payouts`, own test DB (`jendal_test_r5a2`, copy `.env.test.local` and point it there).

---

## Decisions (Mouhamed, 2026-10-12)

- Asking each team owner to create a PayPal developer app is too much friction. The owner pays members in PayPal and marks the request paid. No team credentials.
- Payleor withholds nothing; services teams charge members nothing (they charge clients the management fee). The member's balance is their cut of the quoted price, as now.
- The only fee a member bears is PayPal's: the owner sends the full requested amount as a payment for goods or services, and PayPal takes its receiving fee from what arrives (about 4.99% + $0.49 for an international payment). The owner records the amount the member received; it defaults to the amount sent.
- Checkout fees stay with the team, as now (`payment_fees`, `order_fees` from `team_revenue`). No ledger change at capture or completion.
- The member's destination stays Log in with PayPal (verified). The partner app needs Log in with PayPal on with the return URL `https://admin.payleor.com/api/auth/callback/paypal` (one-time platform setup, not team setup).
- The "To earn $X, quote $Y" calculator moves to 5b.

## Ledger rules (all tasks)

- Request: `payout_requested` (owed available → owed reserved), as now.
- Reject: `payout_released` (reserved → available), as now.
- Mark paid: `payout_succeeded` for the full requested amount (reserved → paid out), posted once with `postIfNew` under the request lock. The received amount is a record for display; it moves no money in Payleor (PayPal's fee came out of the member's side).
- `payout_fees` and `payoutFeesTransfer` are removed (no payout ever posted one; check `select count(*) from ledger_transfer where kind = 'payout_fees'` is 0 in dev before generating the migration).

## Payout request states

`requested` → `paid` (admin marked it paid) or `rejected` (admin; released). `OPEN_PAYOUT_REQUEST_STATUSES = ["requested"]`; the partial unique index keeps one open request per member and team.

## Out of scope

Automatic payouts, payout rules and schedules, Discord notices, the quote calculator (5b). Spending balance inside the team. Store creator shares.

## 5b scope (Mouhamed, 2026-10-12)

- Team payout rules: hold period after completion, minimum payout, payday schedule, approvers (second approver above an amount), auto-approve under a limit.
- Pay runs: due requests grouped on payday; pay one by one or mark the run paid; export in PayPal's Payouts Web CSV format (for teams whose PayPal account has Payouts on; PayPal charges that fee to the team); import PayPal's activity CSV to fill transaction ids and received amounts.
- Books: journal by date range, account balances, per-project results, yearly member earnings statements, CSV exports.
- Payout reserve as a bookkeeping earmark (Payleor holds no money; PayPal offers no sub-balances), with owed-vs-reserve warnings.
- Quote calculator ("To earn $X, quote $Y"). Discord notices.
- Stance: these are records and helpers. Payleor holds no funds and is not responsible for a team's taxes or legal financial duties anywhere; the terms and the export screens say so.
- The team-credentials route is dropped for good. PayPal Payouts on the team's behalf (partner, third-party) plus Transaction Search is the route to ask PayPal for; Hyperwallet (Enterprise Payouts) is not, because the platform funds it and becomes the payer.

---

### Task 1: core and db — states, columns, removals

**Files:**
- Modify: `packages/core/src/payouts/requests.ts`, `packages/core/src/payouts/requests.test.ts`
- Modify: `packages/core/src/ledger/transfers.ts`, `packages/core/src/ledger/postings.ts`, `packages/core/src/ledger/postings.test.ts`
- Delete: `packages/core/src/crypto/secret-box.ts`, `packages/core/src/crypto/secret-box.test.ts`; modify `packages/core/src/index.ts`, `packages/core/src/web-globals.d.ts` (drop `CryptoKey`, `AesGcmParams`, `importKey`/`encrypt`/`decrypt`, `TextDecoder` if nothing else in core uses them)
- Modify: `packages/core/src/services-teams/setup-steps.ts` and its test (remove the `add-payout-credentials` step, `payoutCredentialsSaved`, `links.payoutCredentials`)
- Modify: `packages/db/src/schema/payouts.ts`; delete `packages/db/src/repositories/payout-credentials.ts`; modify `packages/db/src/repositories/payout-requests.ts` and its test; modify `packages/db/src/testing/db.ts` (drop `team_payout_credentials` from `truncateAll`)
- Create: migration via `pnpm db:generate --name r5a2_manual_payouts`

- [ ] **Step 1: core payout rules.** `PAYOUT_REQUEST_STATUSES = ["requested", "paid", "rejected"]`, `OPEN_PAYOUT_REQUEST_STATUSES = ["requested"]`. Remove `MAX_PAYOUT_MINOR` and its check from `payoutAmountProblem` (it was PayPal's Payouts per-item cap), `PayoutOutcome`, `payoutItemOutcome`, `payoutBatchOutcome`. Add:

```ts
// The owner records what reached the member; PayPal's receiving fee is the difference. More than was sent is a typo.
export function payoutReceivedProblem(input: { receivedMinor: number; amountMinor: number }): string | null {
  assertAmount(input.receivedMinor, "received amount");
  if (input.receivedMinor <= 0) return "Enter the amount the member received.";
  if (input.receivedMinor > input.amountMinor) {
    return `Enter at most ${amountFormatter.format(input.amountMinor / 100)}, the amount requested.`;
  }
  return null;
}
```

Tests: replace the outcome tables with a `payoutReceivedProblem` table (0, equal, one cent over, a normal lower amount) and drop the max-amount rows from the amount table.

- [ ] **Step 2: ledger.** Remove `"payout_fees"` from `LEDGER_TRANSFER_KINDS`, `payoutFeesTransfer` and its test.
- [ ] **Step 3: secret box and setup step removal** as listed in Files. The checklist for a team no longer has a payouts step.
- [ ] **Step 4: schema.** Drop the `teamPayoutCredentials` table. On `payout_request` drop `send_attempt`, `paypal_batch_id`, `paypal_item_id`, `paypal_item_status`, `fee_minor`, `failure_message`, `review_reason`, `uncertain_at`, `sent_at`, `settled_at`; add:

```ts
    // The member's PayPal email when they asked: the admin pays this address.
    receiverEmail: text("receiver_email").notNull(),
    // What reached the member after PayPal's receiving fee, as the admin recorded it.
    receivedMinor: minor("received_minor"),
    paypalTransactionId: text("paypal_transaction_id"),
    paidAt: timestamp("paid_at"),
```

Status check: `in ('requested', 'paid', 'rejected')`. Add `check("payout_request_received_check", sql\`${t.receivedMinor} is null or (${t.receivedMinor} > 0 and ${t.receivedMinor} <= ${t.amountMinor})\`)`. Update the table comment (no PayPal batch ids any more).

- [ ] **Step 5: repository.** `NewPayoutRequest` gains `receiverEmail`; `PayoutRequestPatch` becomes `status | decidedByUserId | decidedAt | receivedMinor | paypalTransactionId | paidAt`. Remove `listSentPayoutRequests`, `touchSentPayoutRequest`, `hasActivePayoutSend`. Keep the existing repository tests passing (add `receiverEmail` to fixtures).
- [ ] **Step 6: migration.** `pnpm db:generate --name r5a2_manual_payouts` in the worktree (with `DATABASE_URL` set to any value if drizzle-kit needs one), read the SQL: it must drop the credentials table and the columns, add the new ones, and replace the two checks. `receiver_email` is `not null` with no default: dev and test have no `payout_request` rows, and nothing is deployed, so a plain add is fine — say so in a comment at the top of the SQL only if drizzle-kit asks. Then `drizzle-kit generate` again must print "No schema changes".
- [ ] **Step 7: checks.** `npx vitest run packages/core packages/db`; types will fail in api/server until Task 2 and 3 — that is expected; commit anyway.
- [ ] **Step 8: commit** `refactor(core,db): manual payout states, drop team payout credentials`.

### Task 2: api — manual payouts, remove credentials and sending

**Files:**
- Modify: `packages/api/src/use-cases/payouts.ts`, `packages/api/src/routers/payouts.ts`, `packages/api/src/routers/payouts.test.ts`
- Delete: `packages/api/src/use-cases/payout-credentials.ts`
- Modify: `packages/api/src/context.ts` (remove `PayoutServices` and `payouts`), `packages/api/src/routers/services-team.ts` (drop `payoutCredentialsSaved`), `packages/api/src/routers/services-team.test.ts`
- Modify: `packages/api/src/use-cases/paypal-amounts.ts` (remove helpers left with no non-test caller, e.g. `payPalErrorLog`, `payPalValueMinor` if unused)
- Delete: `packages/paypal/src/payouts.ts`, `packages/paypal/src/payouts.test.ts`, `packages/paypal/src/reporting.ts`, `packages/paypal/src/reporting.test.ts`; modify `packages/paypal/src/client.ts` (drop `payouts`, `reporting`, the `retry` option and the `maxAttempts` parameter on `send`), `packages/paypal/src/index.ts`, `packages/paypal/src/schemas.ts` (payout and balance schemas), `packages/paypal/src/errors.ts` (drop `links`, the payout batch was its only reader) and their tests

- [ ] **Step 1: request.** `requestPayout` keeps its rules (solo refused, destination and age required, one open request, amount ≤ available, `payout_requested`). New: refuse when the destination has no PayPal email — `PRECONDITION_FAILED` "PayPal did not share your email. Connect your PayPal account again on this page." — and snapshot `receiverEmail: destination.paypalEmail` with `receiverPayerId`.
- [ ] **Step 2: reject** stays as is (from `requested` only, `payout_released`).
- [ ] **Step 3: mark paid.** Replace approve/retry/refresh/claim/send/settle with:

```ts
export async function markPayoutPaid(
  db: Database,
  input: { teamId: string; requestId: string; deciderId: string; received: string | null; paypalTransactionId: string | null },
): Promise<PayoutRequestView>
```

Under `lockTeamRequest`: only `requested` (else "This payout request was already decided."). `receivedMinor` = `parseMajorAmount(received)` when given (null parse → BAD_REQUEST "Enter an amount like 25.00."), else the requested amount; `payoutReceivedProblem` → BAD_REQUEST. Update `status: "paid"`, `decidedByUserId`, `decidedAt` and `paidAt` = now, `receivedMinor`, `paypalTransactionId`; `postIfNew(tx, teamId, payoutSucceededTransfer(postingFor(request)))`.

- [ ] **Step 4: views.** `PayoutRequestView`: `id, userId, currency, amountMinor, status, receiverEmail, receivedMinor, paypalTransactionId, createdAt, decidedAt, paidAt`. `listTeamPayouts` returns `{ sendMoneyUrl, requests }` where `sendMoneyUrl` is `https://www.sandbox.paypal.com/myaccount/transfer/homepage/pay` for `ctx.environment === "sandbox"` and `https://www.paypal.com/myaccount/transfer/homepage/pay` for live (a small exported function in `use-cases/payouts.ts`, `payPalSendMoneyUrl(environment: TenantEnvironment)`).
- [ ] **Step 5: router.** Remove `credentials`, `saveCredentials`, `removeCredentials`, `approve`, `retry`, `refresh`. Add:

```ts
  markPaid: servicesTeamProcedure
    .input(
      requestIdInput.extend({
        received: z.string().trim().max(32).optional(),
        paypalTransactionId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9]{1,40}$/, "Enter the transaction ID as PayPal shows it, letters and digits only.")
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "approve_payouts", PAYOUTS_ONLY);
      return markPayoutPaid(ctx.db, {
        teamId: ctx.servicesTeam.id,
        requestId: input.requestId,
        deciderId: ctx.session.user.id,
        received: input.received || null,
        paypalTransactionId: input.paypalTransactionId || null,
      });
    }),
```

An empty string from the form means "not given" (`|| null`); make the zod regex accept `""` too (`.or(z.literal(""))`).

- [ ] **Step 6: router tests** (`payouts.test.ts`, rewrite; drop the fake PayPal, credentials and settle fixtures). Keep the authoring gate: one owner test per contract.
  - request: reserves the amount and snapshots payer id and email; refused without destination, without age confirmation, without a PayPal email, for a solo team, over the available balance, and when one is already open (keep the existing table shapes).
  - mark paid: an admin marks a request paid with a received amount and transaction id → `paid`, the fields, balances available 0 / reserved 0 / paid out = amount, exactly one `payout_succeeded`; marking again → "already decided" and still one posting; received omitted → defaults to the amount; received over the amount and zero → BAD_REQUEST with no posting; a rejected request cannot be marked paid.
  - reject: releases once (keep).
  - permissions: a freelancer is refused `list`, `reject` and `markPaid` (one table); another team's request → NOT_FOUND.
  - `list` returns the sandbox send URL for a sandbox context.
  - member `mine`: earnings and history (keep what exists, adjust fields).
- [ ] **Step 7: checks.** `npx vitest run packages/api packages/paypal`, `pnpm check-types` may still fail only in apps/server (Task 3).
- [ ] **Step 8: commit** `feat(api): manual payouts — admins mark requests paid; drop team credentials and PayPal payout sends`.

### Task 3: server and infra — remove the payout machinery

**Files:**
- Delete: `apps/server/src/payouts.ts`, `apps/server/src/payouts.test.ts`
- Modify: `apps/server/src/services.ts` (remove `getPayoutServices`, `loadPayoutServices`, unused imports), `apps/server/src/context.ts`, `apps/server/src/index.ts` (scheduled handler back to the four sweeps), `apps/server/src/maintenance.ts` and its test (remove the `payouts` sweep, `settlePayouts`, `payoutsChecked`, `payoutsSettled`, and the "records a failed payouts sweep" test)
- Modify: `apps/server/.env.schema`, `packages/infra/.env.schema` (pick list), `packages/infra/alchemy.run.ts` (remove `PAYOUT_CREDENTIALS_KEY`)

- [ ] **Step 1:** remove as listed; `rg -n "PAYOUT_CREDENTIALS_KEY|PayoutServices|settleSentPayouts|payoutsChecked" apps packages` returns nothing.
- [ ] **Step 2:** `npx vitest run apps/server`, `pnpm check-types` (web may fail until Task 4), `pnpm lint`.
- [ ] **Step 3: commit** `refactor(server): drop the payout credentials key and settle sweep`.

### Task 4: web — pay in PayPal, mark paid

**Files:**
- Delete: `apps/web/src/app/admin/[storeSlug]/payouts/payout-credentials-card.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/payouts/team-payouts.tsx`, `payout-requests-table.tsx`; replace `confirm-dialog.tsx` with `mark-paid-dialog.tsx` if nothing else uses it
- Modify: `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx` (checklist without payouts step)
- Modify: `apps/web/src/app/admin/me/payouts/earnings-section.tsx`, `payout-history.tsx`
- Modify: `apps/web/src/lib/payouts.ts`, `apps/web/src/lib/payouts.test.ts`

- [ ] **Step 1: lib.** Labels for the three states. Admin: `requested` "Waiting for payment", `paid` "Paid", `rejected` "Rejected". Member: `requested` "Waiting for the team to pay", `paid` "Paid", `rejected` "Rejected". Remove `payoutActions` and its test if the table only needs `status === "requested"`; otherwise keep it with two rows (requested → pay, reject; others → none).
- [ ] **Step 2: team page.** Only the requests table for admins (the solo and non-admin messages stay). Copy under the heading: "Pay members in PayPal, then mark the request paid here."
- [ ] **Step 3: requests table.** Columns Member (name, account email), PayPal (the `receiverEmail`), Amount, Requested, Status (for paid: "Paid {date}", "Received {receivedMinor}" when it differs from the amount, "Transaction {id}" when given). For `requested`: "Pay" and "Reject". "Pay" opens a `<dialog>` (same pattern as the current confirm dialog, `showModal`, labelled heading):
  - Heading "Pay {member name} {amount}".
  - Steps: "1. Open PayPal and send {amount} to {receiverEmail} as a payment for goods or services. PayPal takes its fee from what they receive." with an "Open PayPal" link (`sendMoneyUrl`, `target="_blank" rel="noreferrer"`) and copy buttons for the email and the amount (`navigator.clipboard.writeText`, button text changes to "Copied" for 2 s).
  - "2. Mark it paid." Fields "Amount they received ({currency})" prefilled with the amount (`minorToPriceInput`), "PayPal transaction ID (optional)". Submit "Mark as paid" → `payouts.markPaid`; errors shown in the dialog with `role="alert"`; success closes the dialog and invalidates `payouts.list`.
- [ ] **Step 4: member page.** Earnings form: drop `MAX_PAYOUT_MINOR` (prefill the available amount); helper text under the button: "The team pays you in PayPal. PayPal takes its fee when the payment arrives." Success text "Payout requested. {team} pays you in PayPal." History: paid rows show "Paid {date}" and "You received {receivedMinor}" when recorded; no failure messages any more.
- [ ] **Step 5: checks.** `npx vitest run apps/web`, `pnpm check-types`, `pnpm lint`, full `npx vitest run`.
- [ ] **Step 6: commit** `feat(web): pay members in PayPal and mark payouts paid`.

### Task 5: review, merge, walkthrough (controller)

- [ ] Whole-branch review (removal completeness: `rg -n "credentials|payoutFees|sendAttempt|uncertain|paypalBatchId" packages/api/src/use-cases/payouts.ts apps/web/src/app/admin` etc.; money rules; copy).
- [ ] Merge `--no-ff`, `pnpm install`, `pnpm db:migrate:dev`, remove `PAYOUT_CREDENTIALS_KEY` from `worktrees/main/apps/server/.env`, restart the stack.
- [ ] Walkthrough (after Mouhamed turns on Log in with PayPal on the partner app with the return URL): Walk Through connects a sandbox personal PayPal account and confirms 18+; requests $10 → reject → balance back; requests $25 → Pay dialog shows the email, amount and a working sandbox send link; send it in the sandbox as goods and services, read the received amount and transaction id, mark paid → member sees Paid and the received amount; ledger: one `payout_requested`, one `payout_succeeded`, balances add up; marking again refused.

## Outcome

(to fill)
