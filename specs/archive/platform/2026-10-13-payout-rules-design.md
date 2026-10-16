# Payout rules (run 5b-1): design

> **Archived:** Built and walked through (R5b-1, `a4cf6a8`, `2f2cb35`); archived 2026-10-16. The stories in `../../stories/07-payouts.md` describe the current behaviour.

**Date:** 2026-10-13. **Status:** built and walked through in the sandbox on 2026-10-13 (merged as `a4cf6a8` and `2f2cb35`); see the plan's Outcome.

**Builds on:** R5c automatic payouts (`plans/2026-10-12-r5c-automatic-payouts.md`), services spec §6.5 (payouts) and the team settings "Payout mode" and "Payout rules" rows, sellers design §5 run 5, research §4 "Team reporting and payouts".

**Run 5b order (decided):** 5b-1 payout rules and automation (this document, with the quote calculator and the CSV fallback), then 5b-2 Discord, then 5b-3 books (journal, balances, per-project results, statements, exports, reserve earmark, reconciliation).

## 1. Goal

Each services team sets the rules that describe how it pays its members: who approves what, whether completed projects pay out on their own, when payouts are sent, and how much must stay in the team's PayPal balance. Payleor applies those rules to every payout, whether a member asked for it or a project completed.

## 2. Decisions

- A team defines its payout operating model with rules grouped in categories (approval, automatic payouts, sending, limits). Each approval rule says whether it covers member requests, automatic payouts, or both. The three modes in the services spec (`manual`, `rules`, `automatic`) become presets that fill the rules; any change after a preset makes the team "Custom".
- Automatic payouts pay each completed project's earnings as their own payout (one payout per completed project).
- The hold period delays only automatic payouts. Earnings are available to member requests at once, as today.
- Approval rules: auto-approve at or under an amount; auto-approve every request from trusted members; a second admin above an amount. A team minimum payout, never below PayPal's 1.00.
- Balance floor: rules skip auto-approval when the payout would leave the team's PayPal balance under the floor, and approved payouts wait in the queue until the balance stays above it.
- Payouts are sent right away by default; a team can choose a payday instead (a weekday each week, or a day of the month).
- Waiting payouts retry on a backoff: 15 minutes, 1 hour, 6 hours, then daily. An admin can always retry now.
- The balance is the real PayPal balance, read with the team's first-party credentials once the connection asks for `ADVANCED_TRANSACTIONS_SEARCH` and `PAYPAL_BALANCE` (proven in the sandbox, research §4). The third-party connection cannot read it.
- The "To earn $X, quote $Y" calculator sits on the project quote form, for admins and members.
- The PayPal Payouts Web CSV export and import is in this run, as the route for teams without automatic payouts.
- Later, not in this run: a general "when … then …" rule engine, and an agent that reads a team's uploaded terms and freelancer agreements and proposes rule settings for an admin to confirm. The rules row and the decision function are the seam both will use. Inference comes after the core features.

## 3. Rules and data

### 3.1 `team_payout_rules` (one row per services team)

| Group | Column | Meaning |
|---|---|---|
| Preset | `preset` | `manual`, `rules`, `automatic` or `custom` (display only; the columns decide) |
| Approval | `auto_approve_up_to_minor` (nullable) | Auto-approve when the amount is at most this |
| Approval | `auto_approve_scope` | `requests`, `automatic`, `both` |
| Approval | `trusted_auto_approve_scope` | Scope for trusted members (the list is a join table, `team_payout_trusted_member`) |
| Approval | `second_approver_above_minor` (nullable) | Above this, two different admins must approve |
| Approval | `second_approver_scope` | `requests`, `automatic`, `both` |
| Automatic | `pay_completed_projects` | Create a payout for each completed project's earnings |
| Automatic | `hold_days` | 0–90; days after completion before the automatic payout is created |
| Sending | `payday` | `immediate`, `weekly`, `monthly` |
| Sending | `payday_weekday` / `payday_month_day` | 0–6 (Sunday = 0) / 1–28 |
| Sending | `balance_floor_minor` (nullable) | Keep at least this in the team's PayPal balance |
| Limits | `minimum_payout_minor` | At least PayPal's 1.00 |

Amounts are in the team's currency. The unused `services_team_settings.payout_mode` column is migrated into `preset` (and the matching columns) and then dropped.

**Presets:** Manual = every rule off. Rules = auto-approve up to 100.00 for requests. Automatic = pay completed projects (hold 0) and auto-approve automatic payouts. Applying a preset overwrites the columns; saving any other change sets `preset = custom`.

### 3.2 Decision function (core)

`decidePayout(rules, facts)` is pure. Facts: amount, currency, source (`member` or `project`), whether the member is trusted, approvals so far (admin ids), the requester's id, the balance (or "unreadable"), the current time. It returns one of:

- `refused` with a reason (below the team minimum, too small to cover PayPal's fee);
- `needs_approval` with the number still needed (1 or 2);
- `approved` with `send_after` (now, or the next payday) and whether the balance floor holds it (`wait_for_balance`).

The request path, the project sweep, approval and the send sweep all call it, so they never disagree. A later rule engine or rules agent produces the same rules row or calls this function.

### 3.3 Payout request changes

- `source` (`member`, `project`) and `project_id` (unique when set), so a project pays out once. A project gets one automatic payout attempt. If PayPal refuses it or an admin rejects it, the money goes back to the member's available balance and they request it themselves.
- `payout_approval` table: request, admin, time; unique per (request, admin).
- `send_after` (payday or hold end), `next_attempt_at` (backoff), `attempts` for the backoff step, and `wait_reason` (shown to admins).
- The "one open request per member and team" index applies to `source = member` only.
- A new status `exported` (sent through PayPal Payouts Web, waiting for the results import) and `offline_batch_id` naming the export it belongs to (§5.2). It counts as open, like `sent`.

## 4. Flows

### 4.1 Member request

Check the minimum and that the amount covers PayPal's fee, reserve as today, then decide. Auto-approved requests join the queue with `send_after`; others wait for one or two admins. When auto-approval depends on the floor, read the balance at request time; unreadable counts as "not above the floor".

### 4.2 Completed project

The 10-minute maintenance cron finds completed projects with no payout once `completed_at + hold_days` has passed and the team has `pay_completed_projects` on. It creates a `project` payout for that project's earnings (`completion:{projectId}`), capped at the member's available balance and skipped when that is 0, then decides. A member without a verified PayPal destination or the 18+ confirmation gets no payout yet; the team's table shows "Waiting for {member} to connect PayPal" and a later run creates it.

### 4.3 Approval

Approving records a `payout_approval`. The same admin cannot approve twice, and an admin cannot approve a payout to themselves. When enough approvals exist the payout joins the queue with its `send_after`. Reject releases the reservation, as today.

### 4.4 Sending

The cron sends queued payouts whose `send_after` and `next_attempt_at` have passed (and Retry sends one now). Before each send, read the balance with the team's credentials:

- the send would drop the balance under the floor, or the balance is lower than the amount: wait, set `wait_reason` and `next_attempt_at`;
- PayPal 5xx, 401 or 403, insufficient funds: held as today, with the backoff;
- otherwise send through the R5c engine (fee estimate, stable ids, settle sweep).

Backoff after each held attempt: 15 minutes, 1 hour, 6 hours, then every 24 hours. Retry ignores `next_attempt_at` but not the floor.

### 4.5 Payday

Dates are UTC. Weekly: from 00:00 on the chosen weekday. Monthly: from 00:00 on the chosen day (1–28). `send_after` is set when the payout is approved.

### 4.6 Credentials that cannot read the balance

Connections made before this run (walk-crew today) lack the reporting permission. With a floor set, payouts wait with "Turn on automatic payouts again so Payleor can read your PayPal balance." Without a floor they send, and PayPal's insufficient-funds refusal still holds them.

## 5. Other parts

### 5.1 Connection

`FIRST_PARTY_REFERRAL_FEATURES` adds `ADVANCED_TRANSACTIONS_SEARCH` and `PAYPAL_BALANCE`. At connect Payleor records `can_read_balance` from the token's scopes (`reporting/search/read`); the payouts scope stays required. The card shows "Reconnect so Payleor can read your PayPal balance" when it is false.

### 5.2 CSV fallback (PayPal Payouts Web)

For teams without automatic payouts. An admin selects approved payouts and exports them in PayPal's Payouts Web CSV format: the member's PayPal ID, the amount minus the fee estimate (same fee rule as API sends), the currency, and the payout id as the reference. Exported payouts become "Sent through PayPal Payouts Web" (reserved, not yet settled). Importing PayPal's results CSV matches rows by the reference, fills the transaction id, status and actual fee, and settles with the same postings as the API path (succeeded, fee recovered, released difference; failed releases the reservation). The team's PayPal account needs Payouts turned on; the export screen says so and that PayPal charges the fee to the team. The plan checks both CSV formats against PayPal's documentation before building.

### 5.3 Quote calculator

On the project quote form, for admins and members. Input: what the member should receive. Output: the smallest quote whose member share after the team cut and the payout fee estimate is at least that, with the breakdown: client pays (quote plus management fee), PayPal's checkout fee paid by the team (about), the team keeps, the member receives. Checkout fee estimates come from a fee table in core, like `estimatePayoutFeeMinor`, and are labelled as estimates.

### 5.4 Screens

- Team "Payout rules" page: preset picker, the four groups, trusted members.
- Payout requests table: source (request or project), approvals ("1 of 2"), wait reason and next try, CSV export and import.
- Member history: project payouts show the project.
- Quote form: the calculator.

## 6. Errors and edge cases

- A rules change applies to payouts decided after it; queued payouts keep their decision except `send_after` for payday changes (recomputed) and the floor (checked at every send).
- Removing an admin who approved does not undo the approval.
- The second-approver rule wins over auto-approval: a payout above `second_approver_above_minor` is never auto-approved, and the rules page refuses an auto-approve amount above the second-approver amount for the same scope.
- The rules page refuses a second-approver amount while the team has fewer than two admins. If admins later drop to one, payouts that need two approvals wait with "Add a second admin or lower the second-approver amount."
- A project refunded or penalised after its automatic payout is created: the payout uses the earnings available when it is created; later adjustments follow the existing ledger rules.
- Rules belong to services teams with members; solo sellers have no payouts.

## 7. Testing

- Core table tests: `decidePayout` (each rule, scopes, floor, minimum), next payday dates, backoff steps, the calculator (rounding, minimum quote).
- Router tests (owner boundary): request auto-approval and floor, two-admin approval and self-approval refusal, the project sweep (hold, missing destination, idempotency), payday and backoff in the send sweep, balance unreadable, CSV export and import settling the ledger, permission checks for the rules and CSV routes.
- Server tests: the cron runs the project sweep and the send sweep with failure isolation.
- Sandbox walkthrough: walk-crew reconnects (balance permission), sets a floor and payday, a project completes and pays automatically after the hold, a request above the second-approver amount needs two admins, a payout waits under the floor then sends, a CSV export and import round trip.

## 8. Out of scope

The general rule engine, the rules agent from uploaded agreements, Discord (5b-2), books and reconciliation (5b-3), email and in-app notifications, team time zones, store creator shares.
