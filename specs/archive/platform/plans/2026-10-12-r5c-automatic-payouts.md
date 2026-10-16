# R5c Automatic Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team turns on automatic payouts with one PayPal consent; Payleor then sends members' payouts from the team's PayPal balance through the Payouts API, and PayPal's payout fee comes off the member's payout.

**Architecture:** PayPal's first-party onboarding ("Build onboarding into your software") shares the team's REST credentials with Payleor after the team consents in a PayPal mini-browser. Payleor seals them (the R5a secret box) and uses R5a's send engine (approve, balance check, claim-guarded send with stable ids, uncertain retries, settle sweep). The manual paste form is gone. R5a-2's manual "Pay and mark paid" route is removed.

**Tech Stack:** TypeScript monorepo (pnpm, turbo), Hono + tRPC api, Drizzle on Postgres, vinext web app, Vitest with a real test database, PayPal REST (Partner Referrals, OAuth authorization code, Payouts, Reporting balances).

**Base:** main at `0458169`. Branch `r5c-automatic-payouts`, worktree `worktrees/r5c-automatic-payouts`, own test DB `jendal_test_r5c`.

---

## Evidence (sandbox, 2026-10-12)

- A Partner Referrals call with `integration_type: "FIRST_PARTY"`, `first_party_details: { features: ["PAYMENT", "REFUND", "PAYOUTS"], seller_nonce }` returns 201 (third-party `PAYOUTS` is refused with `FEATURES_UNAUTHORIZED`).
- Business account 2 connected through the mini-browser (`partner.js`, `data-paypal-onboard-complete`); the callback gave `authCode` and `sharedId`. `POST /v1/oauth2/token` with Basic `sharedId:` and `grant_type=authorization_code&code=…&code_verifier=<seller_nonce>` returned the seller token; `GET /v1/customer/partners/{partner_merchant_id}/merchant-integrations/credentials/` with it returned `client_id`, `client_secret`, `payer_id` (`WNNBV4WSFA5L8`).
- The seller app token carries `https://uri.paypal.com/payments/payouts`. A $1.00 payout to personal account 2 (batch `KYG5BQXPXAFJ4`) went PENDING → SUCCESS in about 20 s with `payout_item_fee` USD 0.25, charged to the sender.
- `GET /v1/customer/partners/{partner}/merchant-integrations/{merchant_id}` returns `country` (walk-crew: `SN`).
- Orders with a member as payee are refused at capture with `PAYEE_NOT_CONSENTED` (so in-app checkout to members needs member onboarding; not used).
- Docs: first-party onboarding includes cart capabilities only (no platform fee, partner reporting or disputes), so it is added next to the team's existing third-party onboarding, not instead of it. Live needs an approved partner, and PayPal may need to enable Payouts on a team's live account.

## Decisions (Mouhamed, 2026-10-12)

- Manual pay-and-mark-paid is too much work; owners stay in Payleor. Team credentials come from PayPal's first-party onboarding, never pasted.
- PayPal's payout fee comes off the member's payout. Teams charge members nothing else; checkout fees stay with the team.
- Without automatic payouts, requests wait and the team's Payouts page prompts an admin to turn them on. No manual record.
- Members keep the Log in with PayPal destination (verified payer ID, 18+ rule). The partner app needs Log in with PayPal on with the return URL `https://admin.payleor.com/api/auth/callback/paypal` and the Full name, Email, Account verification status, Payer ID and Address fields.
- 5b scope is recorded in the R5a-2 plan (rules, pay runs, books, reserve, calculator, Discord; records-and-helpers stance; Hyperwallet not used).

## Fee rule (all tasks)

- **Estimate at send.** `estimatePayoutFeeMinor({ currency, amountMinor, senderCountry, receiverCountry })` in `packages/core/src/payouts/fees.ts`: when both countries are `US`, PayPal's US Payouts API flat fee (USD 25, EUR 22 minor); otherwise 2% of the amount rounded up to the cent, capped at the international cap (USD 2000, EUR 1600 minor). A null country counts as international. The comment cites PayPal's merchant fees page (Payouts section) and says the estimate is corrected at settle.
- **Send** `amountMinor - estimateMinor` to PayPal; refuse to approve when that is below 1.00 ("This payout is too small to cover PayPal's fee."). Store `fee_estimate_minor` and `sent_minor` on the request at claim time (same values on an uncertain retry; a held send, where PayPal made no payout, recomputes them on the next attempt). Requests that could never be approved are refused when the member asks, and a held request with no uncertain send can be rejected to release the member's funds.
- **Settle succeeded** (actual fee `F` from `payout_item_fee`, same currency; otherwise the R5a review reason applies and the estimate stands as `F`):
  - `payout_succeeded`: owed reserved → paid out, `sent_minor`.
  - `payout_fees`: team revenue → PayPal fees, `F` (the team's balance paid it).
  - `payout_fee_recovered` (new kind): owed reserved → team revenue, `min(F, estimate)`.
  - If `F < estimate`: `payout_released` for `estimate - F` (back to the member's available).
  - If `F > estimate`: the team absorbs `F - estimate` (no member debit; a member's available can be zero).
  - All once, by reference, under the request lock (R5a pattern).
- **Settle failed / rejected:** release the whole reserved amount (R5a).
- **Member display:** before requesting, "You'll receive about {amount − estimate} after PayPal's fee of about {estimate}." using the team's country and the member's destination country; history shows "Sent {sent}" and, once settled, "PayPal's fee {F}".

## Out of scope

5b items. In-app checkout payouts to members (needs member onboarding). Hyperwallet.

---

### Task 1: restore the R5a engine on top of main

**Files:** the whole R5a payout surface (revert of merge `0458169`), plus a new migration.

- [ ] **Step 1:** `git revert -m 1 0458169 --no-commit` in the worktree. Keep the R5a-2 migration directory `packages/db/src/migrations/20261012193445_r5a2_manual_payouts/` (it is applied in dev; restore it with `git checkout 0458169 -- packages/db/src/migrations/20261012193445_r5a2_manual_payouts`). Resolve conflicts in favour of the R5a code; keep audit-5's changes (`MIN_PAYOUT_MINOR` not exported, the trimmed maintenance test).
- [ ] **Step 2:** `pnpm db:generate --name r5c_automatic_payouts` (answer the rename prompts as new columns, `--hints` if needed): it must recreate `team_payout_credentials` and R5a's `payout_request` columns and drop `receiver_email`, `received_minor`, `paypal_transaction_id`, `paid_at`. Re-run → "No schema changes". Status set back to R5a's seven states.
- [ ] **Step 3:** `npx vitest run`, `pnpm check-types`, `pnpm lint` all green (this is R5a as merged, tests included).
- [ ] **Step 4: commit** `revert: restore the R5a payout engine (manual payouts superseded)`.

### Task 2: credentials from PayPal's first-party onboarding

**Files:**
- Modify: `packages/paypal/src/partner-referrals.ts` (+ test): `createFirstParty({ requestId, returnUrl, sellerNonce, features })` building the `FIRST_PARTY` body with `first_party_details: { features, seller_nonce }`, products `EXPRESS_CHECKOUT`, `SHARE_DATA_CONSENT`.
- Create: `packages/paypal/src/seller-credentials.ts` (+ test): `exchangeSellerAuthCode({ sharedId, authCode, codeVerifier })` (Basic `sharedId:`, `grant_type=authorization_code`) and `getSellerCredentials(sellerToken, partnerMerchantId)` → `{ clientId, clientSecret, payerId }`. These use a raw fetch with the client's base URL and the seller token, not the partner token; never log the secret or tokens.
- Modify: `packages/db/src/schema/payouts.ts` + repository: `payout_connect_attempt` (`id`, `team_id` FK cascade, `seller_nonce` text, `created_by_user_id`, `created_at`, `used_at`); one row per started connect; valid one hour, used once.
- Modify: `packages/api/src/use-cases/payout-credentials.ts`, `packages/api/src/routers/payouts.ts` (+ tests): remove `saveCredentials` (paste). Add `connectStart` (`manage_settings`; requires the team's PayPal connected; creates the attempt with a 64-byte base64url nonce and the referral with features `PAYMENT`, `REFUND`, `PAYOUTS`, return URL `/{slug}/payouts`; returns `{ actionUrl, attemptId }`) and `connectComplete({ attemptId, authCode, sharedId })` (`manage_settings`; attempt must belong to the team, be unused and under an hour old; exchange, fetch credentials; `payerId` must equal the team's `paypal_merchant_id` else PRECONDITION_FAILED "Connect the PayPal account this team already uses ({masked merchant id})."; verify with the balances call as R5a did; seal and save with R5a's rules (same-account replacement during active sends, row locks); mark the attempt used). `removeCredentials` stays ("Turn off automatic payouts").
- Tests: router tests with the fake PayPal fetch for start (attempt stored, referral body is first-party with the three features and the nonce), complete (credentials sealed and opened back equal; wrong account refused and nothing saved; expired/used/other team's attempt refused; PayPal refusing the exchange → BAD_GATEWAY "PayPal did not confirm the connection. Try again.").

- [ ] Steps: failing tests, implement, pass, commit `feat(api): automatic payouts connect through PayPal's first-party onboarding`.

### Task 3: fee estimate, member country, settle postings

**Files:**
- Create: `packages/core/src/payouts/fees.ts` (+ table test) with `estimatePayoutFeeMinor` per the Fee rule.
- Modify: `packages/core/src/ledger/transfers.ts` (`payout_fee_recovered`), `postings.ts` (+ test) `payoutFeeRecoveredTransfer`; `payoutSucceededTransfer` takes the sent amount.
- Modify: `packages/db/src/schema/payouts.ts`: `payout_request.fee_estimate_minor`, `sent_minor` (nullable until claimed); `payout_destination.paypal_country` (nullable); `services_team_settings` or `team`: `paypal_country` (nullable) filled when onboarding refreshes the merchant integration (`country` field) and backfilled on the next refresh. Migration `r5c_payout_fees`.
- Modify: `packages/api/src/paypal-userinfo.ts` and the destination connect: read `address.country` when PayPal sends it. Add `address` to `PAYPAL_LOGIN_SCOPES` in `packages/auth/src/paypal.ts` (and its two tests): today's request asks only `openid profile email …/paypalattributes`, so PayPal sends no address even with the app's Address field on (checked 2026-10-12).
- Modify: `packages/api/src/use-cases/payouts.ts`: claim computes and stores estimate and sent amount (fresh sends only), sends `sent_minor`; approve refuses when the sent amount would be under 1.00; settle posts per the Fee rule.
- Tests (router): a succeeded payout with fee equal to the estimate (US→US, USD 0.25): balances and the four references exactly once; fee below estimate releases the difference; fee above estimate: team absorbs; unknown member country uses the international estimate; too-small payout refused at approve.

- [ ] Steps: failing tests, implement, pass, commit `feat: PayPal's payout fee comes off the member's payout`.

### Task 4: web

- Team Payouts page: "Automatic payouts" card. Off: "Turn on automatic payouts" opens PayPal's mini-browser (`<a data-paypal-button="true" data-paypal-onboard-complete="onPayPalConnected" href="{actionUrl}&displayMode=minibrowser" target="PPFrame">` with `partner.js` from `www.sandbox.paypal.com` or `www.paypal.com` per environment, loaded once; the callback calls `payouts.connectComplete`). Explain in one line: "Payleor sends members' payouts from this team's PayPal balance. PayPal's fee comes off each payout." On: "On. Payouts are sent from {masked account}." with "Turn off".
- Requests table: approve disabled with "Turn on automatic payouts to pay requests." when off. R5a's statuses, retry and refresh stay. Show sent amount and fee.
- Dashboard checklist step: "Turn on automatic payouts" (done when credentials are saved).
- Member page: the "You'll receive about …" line under the amount (recomputes as the amount changes), history with sent amount and fee.
- Checks and commit `feat(web): turn on automatic payouts and show what members receive`.

### Task 5: review, merge, walkthrough (controller)

- Whole-branch review; merge `--no-ff`; `pnpm install`; `pnpm db:migrate:dev`; add `PAYOUT_CREDENTIALS_KEY` back to `worktrees/main/apps/server/.env` (`openssl rand -base64 32`, never print); restart.
- Clean the dev DB first: delete the R5a-2 test payout requests and their ledger postings for Walk Through (restore available to 272.00) and the temporary `WALKTESTPAYER` destination.
- Walkthrough: walk-crew turns on automatic payouts (first-party consent on an account already onboarded third-party; wrong account refused); Walk Through connects a sandbox personal account with Log in with PayPal (after Mouhamed's app settings) and confirms 18+; sees the estimate; requests $10 → reject; requests $25 → approve → sent → settle succeeded; balances and postings; turn off then approve → waits with the prompt.

## Outcome

Done 2026-10-13. Merged as `b437e78` (Tasks 1–4 and the review fixes), `0f0f58a` (connect fix found in the walkthrough) and `abc93b0` (clearer Log in with PayPal errors). 1412 tests, types and lint green before the last merge; the last merge ran the web tests (143), types and lint.

**Review fixes before merge** (`858cbb4`, `5446021`, `ef6e6c5`, `0743360`): the r5c migration maps R5a-2 `paid` rows to `succeeded` between dropping and re-adding the status check (so the planned manual dev DB cleanup was not needed: the old $10 and $25 rows and their postings stay); a held `queued` request with no uncertain send can be rejected; requests too small to cover PayPal's fee are refused when the member asks, and the member card says so; "Sent" shows only for sending, sent and succeeded; the member's fee line is the smaller of PayPal's fee and the estimate; a connect attempt is bound to the admin who started it; the return URL is checked against PayPal's 127-character limit and the attempt row is written only after PayPal answers.

**Found in the walkthrough and fixed** (`a3c429e`, `d213065`, `7fe28bf`):
- First-party seller credentials cannot read the team's balance: `GET /v1/reporting/balances` answered 403 NOT_AUTHORIZED, so the first connect saved nothing. Connecting now checks the payer id and that the seller token's scope includes `https://uri.paypal.com/payments/payouts`. The pre-send balance check is gone; PayPal's `INSUFFICIENT_FUNDS` on the batch already holds the request as "balance too low". A 401 or 403 on a send now holds the request (funds stay reserved) instead of failing it.
- PayPal called `onPayPalConnected` twice for one consent; the second exchange got 401 because the code works once. Each attempt now completes once.
- PayPal's consent screen shows the partner app's name ("Test Store" in the sandbox) and no permission list. Rename the sandbox partner app to Payleor in the developer dashboard.

**Also fixed** (`eb78ea7`, `61ec68b`): the member's Payouts page said "PayPal did not confirm the connection" for every Log in with PayPal error. It now names `account_already_linked_to_different_user` (the browser was still signed in to PayPal as walk-crew's business account, which belongs to another Payleor user; Payleor refused it correctly) and `state_mismatch` (Better Auth's state cookie lasts 5 minutes; a 6-minute sign-in came back without it). The team table says "Sent" for succeeded payouts.

**Walkthrough** (sandbox, over the tunnel, 2026-10-13):
1. walk-crew (merchant `TR4W3HLBT75MG`, `sb-h9zfs53161788@business`, country SN) turned on automatic payouts through the mini-browser: one `connectComplete`, credentials saved, card "On. Payouts are sent from ••••75MG."
2. Walk Through connected buyer 1 (`sb-fbw0i53251250@personal`, payer `AWVNN2ZZ6ZWT4`, country US from the new `address` scope) and confirmed 18+.
3. $10 request: estimate "about $9.80 after PayPal's fee of about $0.20" (2%, international because the team is SN); reserved; rejected and released.
4. $25 request: estimate $24.50 after about $0.50; approved ("Send $25.00 to Walk Through?"), batch `PCGMAVTPE2FC4`, settled succeeded after a refresh. Sent 2450, estimate 50, PayPal's fee 49. Postings, each balanced: `payout_succeeded` 2450 to paid out, `payout_fee_recovered` 49 from the member's reservation to team revenue, `payout_fees` 49 team revenue to PayPal fees, `payout_released` 1 back to available. Member: available $222.01, paid out $49.50, history "Sent $24.50" and "PayPal's fee $0.49".
5. Turned off: a $5 request waited with Approve disabled and "Turn on automatic payouts to pay requests."; rejected to release it. walk-crew is left off (turning it on again needs another consent).

**Notes:**
- The estimate is 2% of the requested amount while PayPal takes 2% of what is sent, so the estimate runs about 2% high on the fee and the difference returns at settle (1¢ here). Computing the estimate on the sent amount (amount ÷ 1.02) would make it exact; left as is.
- The $0.14 Icon pack question (§11.1) stays open for now. Follow-up probe (2026-10-13, research §4): adding `ADVANCED_TRANSACTIONS_SEARCH` and `PAYPAL_BALANCE` to the first-party features gives the team's credentials balance and transaction search (both 200 for walk-crew), so 5b can bring back a real balance check and reconcile against PayPal. The third-party connection with the same features still gets 403 on reporting.
- Live: Payleor must be an approved PayPal partner for first-party onboarding, and PayPal may need to enable Payouts per team account (walk-crew is SN).
