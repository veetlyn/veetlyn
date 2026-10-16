# R5b-1 Payout Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each services team sets payout rules (approval, automatic payouts per completed project, sending on a payday with a balance floor, a minimum), and Payleor applies them to every payout; plus the quote calculator and the PayPal Payouts Web CSV fallback.

**Architecture:** One rules row per team and one pure decision function in `core` (`decidePayout`) that the request path, approvals, the project sweep and the send sweep all call. The 10-minute maintenance cron gains two sweeps: create payouts for completed projects after the hold, and send queued payouts that are due (payday, backoff, balance floor). The real PayPal balance is read with the team's first-party credentials once the connection asks for `ADVANCED_TRANSACTIONS_SEARCH` and `PAYPAL_BALANCE`.

**Tech Stack:** TypeScript monorepo (pnpm, turbo), Hono + tRPC api, Drizzle on Postgres, vinext web app, Vitest with a real test database.

**Spec:** [`../2026-10-13-payout-rules-design.md`](../2026-10-13-payout-rules-design.md). PayPal facts: research §4 "Team reporting and payouts"; Payouts Web upload format: developer.paypal.com/payouts/use-payouts/send-money/use-web-ui.

**Base:** main at `94e8050`. Branch `r5b1-payout-rules`, worktree `worktrees/r5b1-payout-rules`, own test DB `jendal_test_r5b1` (copy `.env.test.local` and point it there). Every worker uses only that DB, never the dev DB, and never pushes.

**Conventions:** Conventional Commits with the trailer `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`. Tests first at the owner boundary (`packages/api/src/routers/payouts.test.ts` for flows, core tables for pure functions); follow the test-audit authoring gate (no duplicate proof across layers). Checks per task: `npx vitest run <paths>`; before each commit `pnpm check-types` and `pnpm lint`. Never edit while Vitest runs.

---

## Facts the tasks rely on (main at `94e8050`)

- `payout_request` (`packages/db/src/schema/payouts.ts:78-135`) has `send_attempt` (used in PayPal ids), `failure_message` (shown reason), `uncertain_at`, `decided_by_user_id`; status check list at `:130-133`; open index `payout_request_open_idx` on `(team_id, user_id)` where status is open (`:124`, `PAYOUT_REQUEST_OPEN_WHERE` at `:9-11`). `insertPayoutRequest` uses that index as its conflict target (`packages/db/src/repositories/payout-requests.ts:39-49`); `PayoutRequestPatch` (`:13-33`) whitelists updatable columns.
- `requestPayout` (`packages/api/src/use-cases/payouts.ts:186-239`) inserts, checks, reserves, and leaves `requested`. `approvePayoutRequest` (`:269-285`) sets `queued` then calls `sendPayout` synchronously. `sendPayout` (`:476-527`) maps held → `queued` with `failureMessage` and `sendAttempt + 1`. `estimateSendAmounts` (`:148-159`) is the fee estimate.
- There is no send sweep: the cron (`apps/server/src/index.ts:129-143` → `runMaintenance` in `apps/server/src/maintenance.ts`) only settles `sent` payouts (`apps/server/src/payouts.ts:66-90`). The `sweep(name, run)` helper (`maintenance.ts:60-68`) isolates failures.
- Projects have no `completed_at`. Completion posts `completionTransfer` (`packages/core/src/ledger/postings.ts:151-172`): kind `completion`, reference `completion:{projectId}`, one entry to `owed:{freelancerId}:available` for the member's earnings; `ledger_transfer.created_at` is the completion time. Member: `project.assigned_freelancer_id`.
- `services_team_settings.payout_mode` (`packages/db/src/schema/services-teams.ts:53-55`) is read by `updateSettings` (`packages/api/src/routers/services-team.ts:131-159`), `apps/web/src/app/admin/[storeSlug]/settings/services-team-settings.tsx` and `apps/web/src/lib/services-team-labels.ts`; nothing in payouts uses it.
- Admins: `listServicesTeamMembers(db, { id, organizationId })` (`packages/db/src/repositories/services-teams.ts:192-229`) returns `role`, including workspace owners and admins as `admin`.
- The PayPal package has no balance client (removed in `a3c429e`; the old one is `git show a3c429e^:packages/paypal/src/reporting.ts`). `FIRST_PARTY_REFERRAL_FEATURES` is at `packages/paypal/src/partner-referrals.ts:29`. `requirePayoutsScope` (`packages/api/src/use-cases/payout-credentials.ts:172-189`) reads `client.grantedScopes()`.
- No checkout fee estimate exists. Payout fees: `estimatePayoutFeeMinor` (`packages/core/src/payouts/fees.ts:11-21`). Pricing: `managementFeeMinor`, `teamCutMinor`, `freelancerEarningsMinor` (`packages/core/src/projects/pricing.ts`). `MIN_PAYOUT_MINOR = 100` is not exported (`packages/core/src/payouts/requests.ts:19`).
- Test helpers in `packages/api/src/routers/payouts.test.ts`: `fakeTeamPayPal(answers)` (`:71-93`, routes by path, add a balances branch), `teamTokenAnswer(scope)` (`:51`), `payoutTeam(memberCountry)` (`:476-493`), `earn(teamId, freelancerId)` (`:428-442`), `ledgerOf` (`:498`), `callerFor` (`:135-146`). `truncateAll` is a hard-coded table list (`packages/db/src/testing/db.ts:20-26`).

## Decisions during execution (Mouhamed, 2026-10-13)

- Task 0 waits until Task 8 starts.
- The walkthrough's second admin is a new Payleor user with email sign-in through AgentMail, added to walk-crew as admin.
- A team with "pay completed projects" on and automatic payouts off still gets project payouts created and approved; they wait for the Payouts Web export (or for automatic payouts). The send sweep skips approved payouts of teams without credentials instead of retrying them; their table row says "Waiting for export or for automatic payouts."
- Any team member who can be paid (freelancer, manager, admin) can be on the trusted list. An admin cannot add themselves to it (another admin can): `saveRules` refuses with "Another admin has to add you to the trusted list." when the saving admin's id is added and was not already on the list.

## File map

- Create `packages/core/src/payouts/rules.ts` (+ test): rule types, presets, validation, `decidePayout`, `nextPaydayAt`, `retryDelayMs`, `balanceHold`.
- Create `packages/core/src/payouts/checkout-fees.ts` and `packages/core/src/projects/quote-calculator.ts` (+ tests).
- Create `packages/core/src/payouts/payouts-web.ts` (+ test): CSV export rows and results parsing.
- Modify `packages/core/src/payouts/requests.ts`: statuses (`exported`), export `MIN_PAYOUT_MINOR`.
- Modify `packages/db/src/schema/payouts.ts`, `services-teams.ts`; create repository `packages/db/src/repositories/payout-rules.ts`; modify `payout-requests.ts`, `testing/db.ts`.
- Create `packages/paypal/src/reporting.ts` (+ test) again: `balances`.
- Modify `packages/paypal/src/partner-referrals.ts` (first-party features).
- Create `packages/api/src/use-cases/payout-rules.ts`; modify `use-cases/payouts.ts`, `use-cases/payout-credentials.ts`, `routers/payouts.ts`, `routers/services-team.ts`.
- Create `packages/api/src/use-cases/payout-sweeps.ts` (project sweep, send sweep); modify `apps/server/src/maintenance.ts`, `apps/server/src/payouts.ts`, `apps/server/src/index.ts`.
- Web: create `apps/web/src/app/admin/[storeSlug]/payouts/rules/` (page + form), modify the payouts table, credentials card, member history, settings form (drop payout mode), dashboard links, project quote form.

---

### Task 0: capture PayPal's Payouts Web results log (controller with Mouhamed, before Task 8)

- [x] Write a one-row file `/tmp/r5b1-payouts-web.csv`: `<buyer 1 payer id AWVNN2ZZ6ZWT4>,1.00,USD,PLTEST000001,Payleor test,PAYPAL` (no header).
- [x] Mouhamed signs in to sandbox as walk-crew (`sb-h9zfs53161788@business`), Business Tools > Make Payments > Payouts, uploads the file, sends, waits for Processed, opens the payout and downloads the CSV log. Save it as `specs/platform/plans/evidence/r5b1-payouts-web-log.csv` (no secrets in it; check before saving).
- [x] Paste its header row and one data row into this plan under "Payouts Web log (captured)" below, and note which column holds the Customer ID, the transaction id, the status values, the fee and the amount. If Payouts Web is not available in the sandbox account, record that, and Task 8 parses the large-batch report layout (`REF_ID,PAYOUT_ITEM_ID,TRANSACTION_ID,RECIPIENT_NAME,RECIPIENT,CURRENCY_CODE,PAYOUT_AMOUNT,FEE,TOTAL,TRANSACTION_STATUS,ERROR_ENUM,ERROR_MESSAGE,TIME_PROCESSED`) plus the Activity Download names.

**Payouts Web log (captured 2026-10-13):** Activity > All transactions > the payout > Download (CSV) gives `MassPayment_Details.csv` ([evidence](evidence/r5b1-payouts-web-log.csv), no secrets). Sent $1.00 to buyer 1 from walk-crew; processed in 40 s; fee $0.02 charged to the sender.

- UTF-8 with a BOM. A preamble comes first: `Transaction Type: Mass Payment`, submission/processing/completed times, `Subject:`, `Note:`, then quoted summary lines (`"Payment Amount: $1,00 USD in 1 payment"`, `"Fee Amount: …"`, `"Total Amount: …"`, and `Completed / Unclaimed / Returned / Denied / Pending / Blocked Amount: … in N payments`), blank lines between groups. The table starts at the first line whose first cell is `Transaction ID`.
- Header: `Transaction ID,Recipient,Recipient Name,Unique Identifier,Amount,Fee,Total,Status,Reason Code,Custom Note,Message`
- Row: `0N1309609K054603L,AWVNN2ZZ6ZWT4,,PLTEST000001,"$1,00 USD","$0,02 USD","$1,02 USD",Completed,,Payleor test,`
- Customer ID → `Unique Identifier`; transaction id → `Transaction ID`; amount → `Amount`; fee → `Fee`; status → `Status`; failure detail → `Reason Code` / `Message`.
- Money cells are formatted in the account's locale: symbol, amount, ISO code (`"$1,00 USD"` here, comma decimal). Parse by taking the ISO code from the cell and treating the last `,` or `.` followed by exactly two digits at the end as the decimal separator; any other `,`/`.`/space is a thousands separator.
- Status values (from the summary lines): `Completed` → succeeded; `Returned`, `Denied`, `Blocked` (and `Failed`, `Refunded`, `Reversed` if seen) → failed; `Unclaimed`, `Pending` (anything else) → pending.
- Task 8's parser keys on these names first and keeps the large-batch names (`REF_ID`, `TRANSACTION_ID`, `PAYOUT_AMOUNT`, `FEE`, `TRANSACTION_STATUS`) as aliases.

---

### Task 1: core rules, decision, payday, backoff

**Files:**
- Create: `packages/core/src/payouts/rules.ts`, `packages/core/src/payouts/rules.test.ts`
- Modify: `packages/core/src/payouts/requests.ts` (export `MIN_PAYOUT_MINOR`), `packages/core/src/index.ts` (export rules)

- [ ] **Step 1: Write the failing tests** (`rules.test.ts`), table-driven:

```ts
import { describe, expect, it } from "vitest";

import { balanceHold, decidePayout, nextPaydayAt, payoutRulesProblem, presetRules, retryDelayMs, type PayoutRules } from "./rules";

const base: PayoutRules = { ...presetRules("manual"), trustedMemberIds: [] };
const now = new Date("2026-10-14T10:00:00Z"); // a Wednesday
const facts = { amountMinor: 5_000, source: "member" as const, memberId: "ada", approverIds: [], balanceMinor: null, now };

describe("decidePayout", () => {
  it.each([
    ["manual: one admin", base, facts, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["below the team minimum", { ...base, minimumPayoutMinor: 10_000 }, facts, { kind: "refused", reason: "Payouts start at $100.00 for this team." }],
    ["auto-approve up to the amount", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "requests" }, facts, { kind: "approved", sendAfter: now }],
    ["auto-approve scope excludes project payouts", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "requests" }, { ...facts, source: "project" }, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["trusted member", { ...base, trustedMemberIds: ["ada"], trustedScope: "both" }, facts, { kind: "approved", sendAfter: now }],
    ["second approver wins over auto-approve", { ...base, autoApproveUpToMinor: 10_000, autoApproveScope: "both", secondApproverAboveMinor: 4_000, secondApproverScope: "both" }, facts, { kind: "needs_approval", approvalsNeeded: 2 }],
    ["one of two approvals", { ...base, secondApproverAboveMinor: 4_000, secondApproverScope: "requests" }, { ...facts, approverIds: ["bea"] }, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["the member's own approval does not count", { ...base, secondApproverAboveMinor: 4_000, secondApproverScope: "requests" }, { ...facts, approverIds: ["ada", "bea"] }, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["two distinct admins", { ...base, secondApproverAboveMinor: 4_000, secondApproverScope: "requests" }, { ...facts, approverIds: ["bea", "cy"] }, { kind: "approved", sendAfter: now }],
    ["floor blocks auto-approval", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "both", balanceFloorMinor: 50_000 }, { ...facts, balanceMinor: 54_000 }, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["floor allows auto-approval", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "both", balanceFloorMinor: 50_000 }, { ...facts, balanceMinor: 55_000 }, { kind: "approved", sendAfter: now }],
    ["unreadable balance blocks auto-approval under a floor", { ...base, autoApproveUpToMinor: 5_000, autoApproveScope: "both", balanceFloorMinor: 1 }, facts, { kind: "needs_approval", approvalsNeeded: 1 }],
    ["approved waits for the weekly payday", { ...base, payday: "weekly", paydayWeekday: 5 }, { ...facts, approverIds: ["bea"] }, { kind: "approved", sendAfter: new Date("2026-10-16T00:00:00Z") }],
  ] as const)("%s", (_name, rules, input, expected) => {
    expect(decidePayout(rules, input)).toEqual(expected);
  });
});

describe("nextPaydayAt", () => {
  it.each([
    ["immediate", { payday: "immediate" }, now],
    ["weekly, today", { payday: "weekly", paydayWeekday: 3 }, now],
    ["weekly, later this week", { payday: "weekly", paydayWeekday: 5 }, new Date("2026-10-16T00:00:00Z")],
    ["weekly, next week", { payday: "weekly", paydayWeekday: 1 }, new Date("2026-10-19T00:00:00Z")],
    ["monthly, today", { payday: "monthly", paydayMonthDay: 14 }, now],
    ["monthly, later this month", { payday: "monthly", paydayMonthDay: 28 }, new Date("2026-10-28T00:00:00Z")],
    ["monthly, next month", { payday: "monthly", paydayMonthDay: 1 }, new Date("2026-11-01T00:00:00Z")],
  ] as const)("%s", (_name, rules, expected) => {
    expect(nextPaydayAt({ ...base, ...rules }, now)).toEqual(expected);
  });
});

describe("retryDelayMs", () => {
  it.each([[0, 15 * 60_000], [1, 3_600_000], [2, 6 * 3_600_000], [3, 24 * 3_600_000], [9, 24 * 3_600_000]])("after %i waits", (count, ms) => {
    expect(retryDelayMs(count)).toBe(ms);
  });
});

describe("balanceHold", () => {
  it.each([
    ["no floor, enough", { ...base }, 10_000, 20_000, null],
    ["no floor, too low", { ...base }, 30_000, 20_000, "The team's PayPal balance is too low. Add funds, then retry."],
    ["under the floor", { ...base, balanceFloorMinor: 15_000 }, 10_000, 20_000, "Waiting until the team's PayPal balance stays above $150.00."],
    ["floor, unreadable", { ...base, balanceFloorMinor: 15_000 }, 10_000, null, "Turn on automatic payouts again so Payleor can read your PayPal balance."],
    ["no floor, unreadable", { ...base }, 10_000, null, null],
  ] as const)("%s", (_name, rules, amount, balance, expected) => {
    expect(balanceHold(rules, { amountMinor: amount, balanceMinor: balance, currency: "USD" })).toBe(expected);
  });
});

describe("payoutRulesProblem", () => {
  it.each([
    ["presets are valid", presetRules("automatic"), 1, null],
    ["minimum under PayPal's", { ...base, minimumPayoutMinor: 99 }, 1, "The minimum payout is at least $1.00."],
    ["auto-approve above the second approver amount", { ...base, autoApproveUpToMinor: 10_000, autoApproveScope: "both", secondApproverAboveMinor: 5_000, secondApproverScope: "requests" }, 2, "Auto-approve at most the second-approver amount."],
    ["second approver with one admin", { ...base, secondApproverAboveMinor: 5_000 }, 1, "Add a second admin before requiring two approvals."],
    ["hold days out of range", { ...base, holdDays: 91 }, 1, "Hold payouts for 0 to 90 days."],
    ["weekly without a weekday", { ...base, payday: "weekly", paydayWeekday: null }, 1, "Choose the payday."],
    ["monthly day 29", { ...base, payday: "monthly", paydayMonthDay: 29 }, 1, "Choose a payday from the 1st to the 28th."],
  ] as const)("%s", (_name, rules, adminCount, expected) => {
    expect(payoutRulesProblem({ ...base, ...rules, trustedMemberIds: [] }, { adminCount, currency: "USD" })).toBe(expected);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run packages/core/src/payouts/rules.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `rules.ts`:

```ts
import { MIN_PAYOUT_MINOR } from "./requests";

export const PAYOUT_RULE_SCOPES = ["requests", "automatic", "both"] as const;
export type PayoutRuleScope = (typeof PAYOUT_RULE_SCOPES)[number];
export const PAYOUT_RULE_PRESETS = ["manual", "rules", "automatic", "custom"] as const;
export type PayoutRulePreset = (typeof PAYOUT_RULE_PRESETS)[number];
export const PAYDAYS = ["immediate", "weekly", "monthly"] as const;
export type Payday = (typeof PAYDAYS)[number];
export type PayoutSource = "member" | "project";

export type PayoutRules = {
  preset: PayoutRulePreset;
  autoApproveUpToMinor: number | null;
  autoApproveScope: PayoutRuleScope;
  trustedScope: PayoutRuleScope;
  trustedMemberIds: readonly string[];
  secondApproverAboveMinor: number | null;
  secondApproverScope: PayoutRuleScope;
  payCompletedProjects: boolean;
  holdDays: number;
  payday: Payday;
  paydayWeekday: number | null;
  paydayMonthDay: number | null;
  balanceFloorMinor: number | null;
  minimumPayoutMinor: number;
};

export type PayoutRuleSettings = Omit<PayoutRules, "trustedMemberIds">;

const OFF: PayoutRuleSettings = {
  preset: "manual",
  autoApproveUpToMinor: null,
  autoApproveScope: "requests",
  trustedScope: "requests",
  secondApproverAboveMinor: null,
  secondApproverScope: "both",
  payCompletedProjects: false,
  holdDays: 0,
  payday: "immediate",
  paydayWeekday: null,
  paydayMonthDay: null,
  balanceFloorMinor: null,
  minimumPayoutMinor: MIN_PAYOUT_MINOR,
};

// "Any amount" is stored as the largest safe integer, so the automatic preset auto-approves every automatic payout.
export const ANY_AMOUNT_MINOR = Number.MAX_SAFE_INTEGER;

export function presetRules(preset: Exclude<PayoutRulePreset, "custom">): PayoutRuleSettings {
  if (preset === "rules") return { ...OFF, preset, autoApproveUpToMinor: 10_000, autoApproveScope: "requests" };
  if (preset === "automatic") {
    return { ...OFF, preset, payCompletedProjects: true, autoApproveUpToMinor: ANY_AMOUNT_MINOR, autoApproveScope: "automatic" };
  }
  return OFF;
}

const DAY_MS = 86_400_000;
const RETRY_DELAYS_MS = [15 * 60_000, 3_600_000, 6 * 3_600_000] as const;

export function retryDelayMs(waitCount: number): number {
  return RETRY_DELAYS_MS[waitCount] ?? DAY_MS;
}

function applies(scope: PayoutRuleScope, source: PayoutSource): boolean {
  return scope === "both" || (scope === "requests" ? source === "member" : source === "project");
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Payday is a UTC calendar day; on the payday itself a payout goes at once.
export function nextPaydayAt(rules: PayoutRuleSettings, now: Date): Date {
  const today = startOfUtcDay(now);
  if (rules.payday === "weekly" && rules.paydayWeekday !== null) {
    const ahead = (rules.paydayWeekday - today.getUTCDay() + 7) % 7;
    return ahead === 0 ? now : new Date(today.getTime() + ahead * DAY_MS);
  }
  if (rules.payday === "monthly" && rules.paydayMonthDay !== null) {
    const day = rules.paydayMonthDay;
    if (today.getUTCDate() === day) return now;
    const month = today.getUTCDate() < day ? today.getUTCMonth() : today.getUTCMonth() + 1;
    return new Date(Date.UTC(today.getUTCFullYear(), month, day));
  }
  return now;
}

export type PayoutFacts = {
  amountMinor: number;
  source: PayoutSource;
  memberId: string;
  approverIds: readonly string[];
  balanceMinor: number | null;
  now: Date;
};

export type PayoutDecision =
  | { kind: "refused"; reason: string }
  | { kind: "needs_approval"; approvalsNeeded: number }
  | { kind: "approved"; sendAfter: Date };

const usd = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);

export function decidePayout(rules: PayoutRules, facts: PayoutFacts, currency = "USD"): PayoutDecision {
  if (facts.amountMinor < rules.minimumPayoutMinor) {
    return { kind: "refused", reason: `Payouts start at ${usd(rules.minimumPayoutMinor, currency)} for this team.` };
  }
  const required =
    rules.secondApproverAboveMinor !== null &&
    applies(rules.secondApproverScope, facts.source) &&
    facts.amountMinor > rules.secondApproverAboveMinor
      ? 2
      : 1;
  const approvals = new Set(facts.approverIds.filter((id) => id !== facts.memberId)).size;
  const floorAllows =
    rules.balanceFloorMinor === null ||
    (facts.balanceMinor !== null && facts.balanceMinor - facts.amountMinor >= rules.balanceFloorMinor);
  const autoApproved =
    required === 1 &&
    floorAllows &&
    ((rules.autoApproveUpToMinor !== null &&
      applies(rules.autoApproveScope, facts.source) &&
      facts.amountMinor <= rules.autoApproveUpToMinor) ||
      (applies(rules.trustedScope, facts.source) && rules.trustedMemberIds.includes(facts.memberId)));
  if (!autoApproved && approvals < required) return { kind: "needs_approval", approvalsNeeded: required - approvals };
  return { kind: "approved", sendAfter: nextPaydayAt(rules, facts.now) };
}

// Checked before every send, after approval.
export function balanceHold(
  rules: PayoutRuleSettings,
  input: { amountMinor: number; balanceMinor: number | null; currency: string },
): string | null {
  if (input.balanceMinor === null) {
    return rules.balanceFloorMinor === null
      ? null
      : "Turn on automatic payouts again so Payleor can read your PayPal balance.";
  }
  if (input.balanceMinor < input.amountMinor) return "The team's PayPal balance is too low. Add funds, then retry.";
  if (rules.balanceFloorMinor !== null && input.balanceMinor - input.amountMinor < rules.balanceFloorMinor) {
    return `Waiting until the team's PayPal balance stays above ${usd(rules.balanceFloorMinor, input.currency)}.`;
  }
  return null;
}

export function payoutRulesProblem(rules: PayoutRules, context: { adminCount: number; currency: string }): string | null {
  if (rules.minimumPayoutMinor < MIN_PAYOUT_MINOR) return `The minimum payout is at least ${usd(MIN_PAYOUT_MINOR, context.currency)}.`;
  if (!Number.isInteger(rules.holdDays) || rules.holdDays < 0 || rules.holdDays > 90) return "Hold payouts for 0 to 90 days.";
  if (rules.payday === "weekly" && (rules.paydayWeekday === null || rules.paydayWeekday < 0 || rules.paydayWeekday > 6)) return "Choose the payday.";
  if (rules.payday === "monthly") {
    if (rules.paydayMonthDay === null) return "Choose the payday.";
    if (rules.paydayMonthDay < 1 || rules.paydayMonthDay > 28) return "Choose a payday from the 1st to the 28th.";
  }
  if (rules.secondApproverAboveMinor !== null) {
    if (context.adminCount < 2) return "Add a second admin before requiring two approvals.";
    const overlaps = (["member", "project"] as const).some(
      (source) => applies(rules.autoApproveScope, source) && applies(rules.secondApproverScope, source),
    );
    if (overlaps && rules.autoApproveUpToMinor !== null && rules.autoApproveUpToMinor > rules.secondApproverAboveMinor) {
      return "Auto-approve at most the second-approver amount.";
    }
  }
  if (rules.balanceFloorMinor !== null && rules.balanceFloorMinor < 0) return "The balance floor cannot be negative.";
  return null;
}
```

Use `decidePayout(rules, facts, currency)` with the request's currency everywhere. The UI shows `ANY_AMOUNT_MINOR` as "Any amount". The migration in Task 3 writes the same value (9007199254740991).

- [ ] **Step 4:** export `MIN_PAYOUT_MINOR` from `requests.ts` and `export * from "./payouts/rules"` in `packages/core/src/index.ts`; run the test → PASS.
- [ ] **Step 5: Commit** `feat(core): payout rules, the payout decision, payday and retry backoff`.

---

### Task 2: core checkout fee estimate and quote calculator

**Files:**
- Create: `packages/core/src/payouts/checkout-fees.ts`, `packages/core/src/projects/quote-calculator.ts`, tests next to each
- Modify: `packages/core/src/index.ts`

PayPal Checkout standard rates (paypal.com/us/business/paypal-business-fees, US, 2026): 3.49% + fixed fee (USD 0.49, EUR 0.39); international payers add 1.50%. Payleor shows them as estimates ("about").

- [ ] **Step 1: Failing tests.**

```ts
// checkout-fees.test.ts
it.each([
  ["USD domestic", { currency: "USD", amountMinor: 10_000, international: false }, 398], // 349 + 49
  ["USD international", { currency: "USD", amountMinor: 10_000, international: true }, 548],
  ["EUR domestic rounds up", { currency: "EUR", amountMinor: 1_001, international: false }, 74], // ceil(34.93)+39
] as const)("%s", (_n, input, fee) => expect(estimateCheckoutFeeMinor(input)).toBe(fee));

// quote-calculator.test.ts
const team = { teamCutBps: 1_500, managementFeeBps: 1_000, platformFeeBps: 100, currency: "USD" as const, senderCountry: "US", receiverCountry: "US" };
// bpsOf rounds half up. Quote 1000.00: cut 150.00, earnings 850.00, US flat payout fee 0.25 → 849.75.
// Quote 999.99: cut round(149.9985) = 150.00, earnings 849.99 → 849.74, one cent short. So 1000.00 is the smallest.
// Client pays 1000.00 + 100.00; checkout fee ceil(1100.00 × 3.49%) + 0.49 = 38.39 + 0.49 = 38.88; Payleor's fee 1% = 11.00;
// team keeps 150.00 + 100.00 − 38.88 − 11.00 = 200.12.
it("finds the smallest quote that leaves the member at least the target after the payout fee", () => {
  expect(quoteForMemberTarget({ ...team, targetNetMinor: 84_975 })).toEqual({
    quoteMinor: 100_000,
    clientPaysMinor: 110_000,
    checkoutFeeMinor: 3_888,
    platformFeeMinor: 1_100,
    teamKeepsMinor: 20_012,
    payoutFeeMinor: 25,
    memberReceivesMinor: 84_975,
  });
});
it("goes one cent up when the exact quote falls a cent short", () => {
  // Target 849.76 needs earnings 850.01: quote 1000.01 has cut round(150.0015) = 150.00 → earnings 850.01.
  expect(quoteForMemberTarget({ ...team, targetNetMinor: 84_976 }).quoteMinor).toBe(100_001);
});
it.each([0, -1, 1.5])("refuses a target of %s", (target) => {
  expect(() => quoteForMemberTarget({ ...team, targetNetMinor: target })).toThrow("Enter what the member should receive.");
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**

```ts
// checkout-fees.ts
import type { MoneyCurrency } from "../money/money";

const CHECKOUT_PERCENT_BPS = 349;
const INTERNATIONAL_EXTRA_BPS = 150;
const CHECKOUT_FIXED_MINOR = { USD: 49, EUR: 39 } satisfies Record<MoneyCurrency, number>;

// PayPal Checkout's standard rate, as an estimate: the team's real rate can differ by country and volume.
export function estimateCheckoutFeeMinor(input: { currency: MoneyCurrency; amountMinor: number; international: boolean }): number {
  const bps = CHECKOUT_PERCENT_BPS + (input.international ? INTERNATIONAL_EXTRA_BPS : 0);
  return Math.ceil((input.amountMinor * bps) / 10_000) + CHECKOUT_FIXED_MINOR[input.currency];
}
```

```ts
// quote-calculator.ts
import { estimateCheckoutFeeMinor } from "../payouts/checkout-fees";
import { estimatePayoutFeeMinor } from "../payouts/fees";
import { freelancerEarningsMinor, managementFeeMinor, platformFeeMinor, teamCutMinor } from "./pricing";
import type { MoneyCurrency } from "../money/money";

export type QuoteCalculatorInput = {
  targetNetMinor: number;
  teamCutBps: number;
  managementFeeBps: number;
  platformFeeBps: number;
  currency: MoneyCurrency;
  senderCountry: string | null;
  receiverCountry: string | null;
};

export type QuoteBreakdown = {
  quoteMinor: number;
  clientPaysMinor: number;
  checkoutFeeMinor: number;
  platformFeeMinor: number;
  teamKeepsMinor: number;
  payoutFeeMinor: number;
  memberReceivesMinor: number;
};

function breakdown(input: QuoteCalculatorInput, quoteMinor: number): QuoteBreakdown {
  const earnings = freelancerEarningsMinor(quoteMinor, input.teamCutBps);
  const payoutFeeMinor = estimatePayoutFeeMinor({ currency: input.currency, amountMinor: earnings, senderCountry: input.senderCountry, receiverCountry: input.receiverCountry });
  const clientPaysMinor = quoteMinor + managementFeeMinor(quoteMinor, input.managementFeeBps);
  const checkoutFeeMinor = estimateCheckoutFeeMinor({ currency: input.currency, amountMinor: clientPaysMinor, international: false });
  const platform = platformFeeMinor(clientPaysMinor, input.platformFeeBps);
  return {
    quoteMinor,
    clientPaysMinor,
    checkoutFeeMinor,
    platformFeeMinor: platform,
    teamKeepsMinor: teamCutMinor(quoteMinor, input.teamCutBps) + (clientPaysMinor - quoteMinor) - checkoutFeeMinor - platform,
    payoutFeeMinor,
    memberReceivesMinor: earnings - payoutFeeMinor,
  };
}

// Works backwards from what the member should receive; rounding makes the inverse inexact, so it walks up from a
// close lower estimate to the first quote that reaches the target.
export function quoteForMemberTarget(input: QuoteCalculatorInput): QuoteBreakdown {
  if (!Number.isInteger(input.targetNetMinor) || input.targetNetMinor <= 0) throw new Error("Enter what the member should receive.");
  const share = 1 - input.teamCutBps / 10_000;
  let quote = Math.max(1, Math.floor(input.targetNetMinor / share) - 2);
  while (breakdown(input, quote).memberReceivesMinor < input.targetNetMinor) quote += 1;
  return breakdown(input, quote);
}
```

Payleor's platform fee is `platformFeeMinor(payment, planBps)` on each client payment (`pricing.ts:7`), so the calculator takes it on what the client pays. The walk is short because the start is within a few cents; still add a guard of 10 000 steps that throws.

- [ ] **Step 4:** run → PASS; export both from `packages/core/src/index.ts`.
- [ ] **Step 5: Commit** `feat(core): checkout fee estimate and the quote calculator`.

---

### Task 3: schema, migration, repositories

**Files:**
- Modify: `packages/db/src/schema/payouts.ts`, `packages/db/src/schema/services-teams.ts`, `packages/db/src/testing/db.ts`, `packages/db/src/repositories/payout-requests.ts`, `packages/db/src/repositories/services-teams.ts`
- Create: `packages/db/src/repositories/payout-rules.ts` (+ test only for storage rules no router test reaches: the preset migration and trusted members replace)
- Modify: `packages/core/src/payouts/requests.ts` (status `exported`, transitions comment), `packages/core/src/services-teams/types.ts` (drop `payoutMode`)
- Create migration: `pnpm db:generate --name r5b1_payout_rules`

- [ ] **Step 1: core statuses.** `PAYOUT_REQUEST_STATUSES` adds `"exported"`; `OPEN_PAYOUT_REQUEST_STATUSES` adds `"exported"`. Transition comment: `queued → exported` (CSV export), `exported → succeeded|failed|queued` (import or cancel). Update `payoutActions` and labels later in Task 9.
- [ ] **Step 2: schema.**
  - `teamPayoutRules` table `team_payout_rules`: `teamId` text pk → `team.id` on delete cascade; columns per spec §3.1 with these names and types: `preset` text enum `PAYOUT_RULE_PRESETS` default `manual`; `autoApproveUpToMinor` bigint nullable (`mode: "number"`); `autoApproveScope`, `trustedScope`, `secondApproverScope` text enum `PAYOUT_RULE_SCOPES`; `secondApproverAboveMinor` bigint nullable; `payCompletedProjects` boolean default false; `holdDays` integer default 0; `payday` text enum `PAYDAYS` default `immediate`; `paydayWeekday`, `paydayMonthDay` integer nullable; `balanceFloorMinor` bigint nullable; `minimumPayoutMinor` integer default 100; `updatedAt`. Checks: `hold_days between 0 and 90`, `payday_month_day between 1 and 28`, `payday_weekday between 0 and 6`, `minimum_payout_minor >= 100`.
  - `teamPayoutTrustedMember` (`team_payout_trusted_member`): `teamId`, `userId` (→ `user.id` cascade), pk `(team_id, user_id)`.
  - `payoutApproval` (`payout_approval`): `requestId` → `payout_request.id` cascade, `adminUserId` → `user.id`, `createdAt`; pk `(request_id, admin_user_id)`.
  - `payoutRequest` adds: `source` text enum `["member","project"]` default `member` not null; `projectId` text nullable → `project.id` (no cascade; set null on delete); `sendAfter`, `nextAttemptAt` timestamptz nullable; `waitCount` integer default 0; `offlineReference` text nullable unique; `offlineBatchId` text nullable. Unique index `payout_request_project_idx` on `project_id` where `project_id is not null`. Index `payout_request_due_idx` on `(status, send_after, next_attempt_at)`. Status check list gains `'exported'`. The open index becomes `.on(t.teamId, t.userId).where(sql`source = 'member' and ${PAYOUT_REQUEST_OPEN_WHERE}`)` (and `insertPayoutRequest`'s conflict `where` uses the same expression; export it from the schema as `PAYOUT_REQUEST_MEMBER_OPEN_WHERE`).
  - `teamPayoutCredentials` adds `canReadBalance` boolean default false not null.
  - `servicesTeamSettings`: remove `payoutMode`.
- [ ] **Step 3: generate** `pnpm db:generate --name r5b1_payout_rules`. Then hand-edit the generated `migration.sql` so that before `ALTER TABLE "services_team_settings" DROP COLUMN "payout_mode"` it carries the mode over:

```sql
INSERT INTO "team_payout_rules" ("team_id", "preset", "auto_approve_up_to_minor", "auto_approve_scope", "pay_completed_projects")
SELECT "team_id",
       "payout_mode",
       CASE "payout_mode" WHEN 'rules' THEN 10000 WHEN 'automatic' THEN 9007199254740991 ELSE NULL END,
       CASE "payout_mode" WHEN 'automatic' THEN 'automatic' ELSE 'requests' END,
       "payout_mode" = 'automatic'
FROM "services_team_settings";
```

(check the settings table's key column name in the schema; use it). Re-run `pnpm db:generate` → "No schema changes".
- [ ] **Step 4: repositories.**
  - `payout-rules.ts`: `getPayoutRules(db, teamId): Promise<PayoutRules>` (row or `presetRules("manual")` defaults, plus trusted ids), `savePayoutRules(db, teamId, rules: PayoutRules)` (upsert row; replace trusted members in the same transaction), `listTeamsPayingCompletedProjects(db): Promise<string[]>`.
  - `payout-requests.ts`: `NewPayoutRequest` adds optional `source`, `projectId`; `PayoutRequestPatch` adds `sendAfter`, `nextAttemptAt`, `waitCount`, `offlineReference`, `offlineBatchId`; add `insertPayoutApproval(db, { requestId, adminUserId }): Promise<boolean>` (false on conflict), `listPayoutApproverIds(db, requestId)`, `listDuePayoutRequests(db, { now, limit })` (status `queued`, `uncertain_at is null`, `send_after is null or <= now`, `next_attempt_at is null or <= now`, ordered by `coalesce(next_attempt_at, send_after, decided_at)`), `listCompletedProjectsWithoutPayout(db, { teamId, completedBefore, limit })` returning `{ projectId, title, freelancerId, earningsMinor, currency, completedAt }` from `project` join `ledger_transfer` (kind `completion`, reference `'completion:' || project.id`) join `ledger_entry` (account `'owed:' || assigned_freelancer_id || ':available'`), left-anti-join `payout_request` on `project_id`, where `project.team_id = teamId and project.status = 'completed' and ledger_transfer.created_at <= completedBefore`.
  - `services-teams.ts`: drop `payoutMode` from `settingsColumns` and the save.
  - `testing/db.ts` `truncateAll`: add the three new tables.
- [ ] **Step 5: tests.** `payout-rules.test.ts`: (a) a team without a row reads the manual preset; (b) saving rules with trusted members then saving with a different list replaces it. The preset migration is checked once in the controller's migration step on the dev DB (Task 10), not in tests. Run `npx vitest run packages/db` → PASS (update the existing services-teams repository tests that referenced `payoutMode`).
- [ ] **Step 6: Commit** `feat(db): payout rules, approvals, project payouts and the exported status`.

---

### Task 4: PayPal balance client and the connection asking for it

**Files:**
- Create: `packages/paypal/src/reporting.ts`, `packages/paypal/src/reporting.test.ts` (restore from `git show a3c429e^:packages/paypal/src/reporting.ts` and its test; keep only `balances(currencyCode)` → `{ accountId: string | null; balances: { currency; totalMinor; availableMinor }[] }`), schema in `schemas.ts`, wire `client.reporting` and the export in `index.ts`
- Modify: `packages/paypal/src/partner-referrals.ts:29` → `["PAYMENT", "REFUND", "PAYOUTS", "ADVANCED_TRANSACTIONS_SEARCH", "PAYPAL_BALANCE"]`
- Modify: `packages/api/src/use-cases/payout-credentials.ts` (store `canReadBalance`), `packages/db/src/repositories/payout-credentials.ts` (save/read the column), `packages/api/src/routers/payouts.test.ts`

- [ ] **Step 1: failing router tests** in `payouts.test.ts`:
  - the referral asks for the five first-party features (update the existing `referralDetails` assertion at `:178`);
  - connecting with a token whose scope includes `https://uri.paypal.com/services/reporting/search/read` saves `canReadBalance: true` and `payouts.credentials` returns it; without that scope it saves `false` and still connects.
  - Add to `fakeTeamPayPal` an answer `balances?: () => Response` routed for `GET /v1/reporting/balances`, default `jsonResponse(200, { account_id: MERCHANT_ID, balances: [{ currency: "USD", total_balance: { currency_code: "USD", value: "5000.00" }, available_balance: { currency_code: "USD", value: "5000.00" } }] })`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** `requirePayoutsScope` returns the scopes; `completePayoutConnect` saves `canReadBalance: scopes.includes("https://uri.paypal.com/services/reporting/search/read")`. `PayoutCredentialsView` gains `canReadBalance`. Add `readTeamBalanceMinor(deps, team, currency): Promise<number | null>` in `use-cases/payouts.ts`: returns null when there are no credentials, `canReadBalance` is false, or PayPal refuses or fails (log `payout.balance` with `payPalErrorLog`); otherwise the available balance in that currency (0 when the currency is missing; a negative balance reads 0).
- [ ] **Step 4:** run `npx vitest run packages/paypal packages/api/src/routers/payouts.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: automatic payouts ask PayPal for the team's balance and transactions`.

---

### Task 5: rules API and the settings page losing the payout mode

**Files:**
- Create: `packages/api/src/use-cases/payout-rules.ts`
- Modify: `packages/api/src/routers/payouts.ts` (procedures `rules`, `saveRules`, `applyRulesPreset`), `packages/api/src/routers/services-team.ts` (drop `payoutMode` input), web settings form and labels (drop the payout mode select; leave a link "Payout rules" to `/{slug}/payouts/rules`)

- [ ] **Step 1: failing router tests** (`payouts.test.ts`, new `describe("payout rules")`):
  - an admin reads the manual preset for a new team; saves custom rules; reads them back with `preset: "custom"` and the trusted members;
  - `applyRulesPreset({ preset: "automatic" })` stores the preset's settings;
  - refusals come from `payoutRulesProblem` (one example: a second-approver amount on a team with one admin → BAD_REQUEST "Add a second admin before requiring two approvals.");
  - a trusted member who is not on the team → BAD_REQUEST "Trusted members must be on the team.";
  - an admin adding themselves to the trusted list → BAD_REQUEST "Another admin has to add you to the trusted list."; a second admin can add them, and the first admin can then save other changes without removing themselves;
  - a freelancer gets FORBIDDEN "Only an admin can change the team settings." for `saveRules` and `applyRulesPreset`;
  - changing the payday recomputes `sendAfter` for the team's `queued` payouts still waiting for a payday (seed one queued payout with a future `sendAfter`, switch to immediate → `sendAfter` becomes now; it is then picked up by the send sweep). Other decisions already made are kept (spec §6).
  - Update `services-team.test.ts` settings tests to drop `payoutMode`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** Router inputs with zod: amounts as strings parsed by the existing `parsePriceInput`/money helper used by `requestPayout`, scopes and paydays as enums, `trustedMemberIds: z.array(z.string()).max(100)`. `saveRules` sets `preset: "custom"`; `applyRulesPreset` sets the preset's settings and keeps the trusted list. Admin count: `listServicesTeamMembers(...).filter((m) => m.role === "admin").length`. Permission: `manage_settings` (`SETTINGS_ONLY`). The `rules` query also needs `manage_settings`.
- [ ] **Step 4:** run → PASS; `pnpm check-types` (web compiles without `payoutMode`).
- [ ] **Step 5: Commit** `feat(api): teams save payout rules; the payout mode setting moves into them`.

---

### Task 6: requests and approvals follow the rules

**Files:**
- Modify: `packages/api/src/use-cases/payouts.ts`, `packages/api/src/routers/payouts.ts`, `packages/api/src/routers/payouts.test.ts`

- [ ] **Step 1: failing router tests:**
  - **auto-approved request sends at once:** rules auto-approve up to 1000.00 for requests; the member requests 100.00 → the payout is sent (PayPal payout POST seen, status `sent`) with `decidedByUserId: null`.
  - **auto-approved on a payday waits:** weekly payday not today (use a fixed clock through an injected `now` in `PayoutDeps`, default `() => new Date()`) → status `queued`, `sendAfter` = next payday 00:00 UTC, no PayPal call.
  - **below the team minimum:** minimum 50.00, request 20.00 → BAD_REQUEST "Payouts start at $50.00 for this team." and nothing reserved.
  - **floor blocks auto-approval:** floor 4950.00, balance 5000.00 (fake), request 100.00 → stays `requested`.
  - **two admins:** second approver above 500.00; request 600.00; admin A approves → still `requested`, response `{ approvalsNeeded: 1 }`; admin A again → CONFLICT "You already approved this payout."; admin B approves → sent.
  - **no self-approval:** an admin who is also the member requests (seed the admin with a destination and earnings) and approves → FORBIDDEN "You cannot approve a payout to yourself."
  - **payday on manual approval:** monthly payday 28th, today the 14th → approve leaves `queued` with `sendAfter` the 28th; `retry` before then → BAD_REQUEST "This payout goes on payday, {date}." (Retry ignores the backoff, not the payday.)
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.**
  - `PayoutDeps` gains `now?: () => Date`.
  - `requestPayout`: after the reservation, load rules and, when `balanceFloorMinor !== null` and an auto-approve rule could apply, `readTeamBalanceMinor`. Decide with `source: "member"`. `refused` → throw BAD_REQUEST with the reason (inside the transaction, before posting, so nothing is reserved). `approved` → set `queued`, `decidedAt`, `sendAfter`. After commit, when approved and `sendAfter <= now`, call `sendPayout` and swallow its error (the send sweep retries); return the view.
  - `approvePayoutRequest`: refuse self-approval; `insertPayoutApproval` (false → CONFLICT); decide with the approver ids; `needs_approval` → return `{ approvalsNeeded }`; `approved` → `queued`, `decidedByUserId` = this admin, `decidedAt`, `sendAfter`; send now only when due. The router's `approve` output becomes `{ status, approvalsNeeded }`.
  - `retryPayout`: refuse while `sendAfter > now` with the payday message (date formatted `en-US`, UTC).
  - `listTeamPayouts` view adds `source`, `projectId`, `projectTitle`, `approvals` (count), `approvalsNeeded`, `sendAfter`, `nextAttemptAt`; the `payouts.list` output adds `adminCount` so the table can say "Add a second admin or lower the second-approver amount." when a payout needs two approvals and the team has one admin (router test: remove the second admin after a request needing two approvals → `adminCount: 1`, `approvalsNeeded: 2`).
- [ ] **Step 4:** run the payouts router suite → PASS (existing tests keep passing: a team without rules behaves as the manual preset).
- [ ] **Step 5: Commit** `feat(api): payout requests and approvals follow the team's rules`.

---

### Task 7: project sweep and send sweep on the cron

**Files:**
- Create: `packages/api/src/use-cases/payout-sweeps.ts`
- Modify: `packages/api/src/use-cases/payouts.ts` (held branch sets backoff; floor check before send), `apps/server/src/maintenance.ts`, `apps/server/src/payouts.ts`, `apps/server/src/index.ts`, tests in `packages/api/src/routers/payouts.test.ts` (flows through exported sweep functions) and `apps/server/src/maintenance.test.ts` (wiring only)

- [ ] **Step 1: failing tests** (call `createProjectPayouts(deps, { now })` and `sendDuePayouts(deps, { now })` from `payout-sweeps.ts` in the router suite, since they are the owners):
  - **project payout after the hold:** rules pay completed projects, hold 3 days, auto-approve automatic payouts; `earn()` posts completion at T; sweep at T+2d → nothing; at T+3d → one `project` payout for 850.00 linked to the project, sent; a second sweep → still one (unique `project_id`).
  - **capped and skipped:** the member already requested 800.00 → project payout for 50.00; available 0 → no payout.
  - **missing destination:** member without destination → no payout; `payouts.list` returns `waitingForDestination: [{ projectId, title, memberName, earningsMinor }]`.
  - **send sweep honours payday and backoff:** a queued payout with `sendAfter` in the future is not sent; after it passes, it is.
  - **floor at send:** floor 4950.00, balance 5000.00, approved 100.00 → stays `queued`, `failureMessage` "Waiting until the team's PayPal balance stays above $4,950.00.", `nextAttemptAt = now + 15 min`, `waitCount 1`; the next sweep before that time does nothing; at that time with balance 6000.00 → sent, `waitCount` reset to 0, `nextAttemptAt` null.
  - **backoff on PayPal holds:** INSUFFICIENT_FUNDS three times → `nextAttemptAt` steps 15 min, 1 h, 6 h.
  - **balance unreadable with a floor:** credentials with `canReadBalance: false` → held with "Turn on automatic payouts again so Payleor can read your PayPal balance."
  - `maintenance.test.ts`: the report includes `projectPayoutsCreated`, `payoutsSent`, and a failing sweep is recorded in `errors` without stopping the others (extend the existing table-driven wiring test; no flow assertions here).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.**
  - `sendPayout`: before claiming, load rules and `readTeamBalanceMinor`; `balanceHold(...)` non-null → update the row (still `queued`) with `failureMessage`, `waitCount + 1`, `nextAttemptAt = now + retryDelayMs(waitCount)` and return held. The existing held branch also sets `waitCount`/`nextAttemptAt`. The `sent` branch resets `waitCount: 0, nextAttemptAt: null`. Skip the balance read for an uncertain retry (PayPal may already have paid).
  - `createProjectPayouts(deps, { now, limit = 50 })`: for each team from `listTeamsPayingCompletedProjects`, read rules and list completed projects before `now − holdDays`; for each, skip without a qualified destination; in a transaction: lock nothing new, read `owedAvailable`, amount = min(earnings, available), skip at 0, insert `source: "project"`, reserve (`payoutRequestedTransfer`), decide with `source: "project"` (balance read only when a floor is set), set status; after commit, send when approved and due. Return `{ created }`. One project's failure is logged and does not stop the others.
  - `sendDuePayouts(deps, { now, limit = 50 })`: `listDuePayoutRequests` (only teams with saved credentials: join `team_payout_credentials`) → `sendPayout` each, isolated; return `{ sent, held }`. Test: an approved payout on a team without credentials is not attempted and keeps `nextAttemptAt` null; a project payout on such a team is created and approved and waits (`failureMessage` "Waiting for export or for automatic payouts.").
  - `apps/server`: `runMaintenance` gets optional `createProjectPayouts` and `sendPayouts` deps like `settlePayouts`, sweep names `projectPayouts` and `payoutSends`, run before the settle sweep; `index.ts` wires them when payout services exist.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat: completed projects pay out after the hold, and due payouts send on the cron`.

---

### Task 8: PayPal Payouts Web CSV export and import

**Files:**
- Create: `packages/core/src/payouts/payouts-web.ts` (+ test), `packages/api/src/use-cases/payouts-web.ts`
- Modify: `packages/api/src/routers/payouts.ts` (`exportPayoutsWeb`, `importPayoutsWeb`, `cancelExport`), `packages/api/src/use-cases/payouts.ts` (extract the settle postings into `applySettlement(tx, request, outcome)` used by both `settlePayout` and the import)

Depends on Task 0's captured log.

- [ ] **Step 1: core failing tests.**
  - `payoutsWebCsv(rows)`: rows `{ receiverPayerId, sentMinor, currency, reference, note }` → lines `AWVNN2ZZ6ZWT4,24.50,USD,PL7K2M9Q4XR1,Payout from Walk Crew,PAYPAL` joined by `\r\n`, no header; a note with a comma is quoted; more than 5000 rows or mixed currencies throw.
  - `payoutReference()` → `PL` + 12 characters from `[A-Z2-9]` (30-character limit, no spaces); test shape and that 1000 calls are distinct.
  - `parsePayoutsWebLog(text)`: parses the captured sample (`evidence/r5b1-payouts-web-log.csv` copied into the test as a string) into `{ reference, transactionId, status: "succeeded" | "failed" | "pending", feeMinor, amountMinor }[]`; maps columns by header name through an alias table (Task 0 names first; then `REF_ID`/`Reference ID`/`Customer ID`, `TRANSACTION_ID`/`Transaction ID`, `FEE`/`Fee`, `PAYOUT_AMOUNT`/`Amount`/`Gross`, `TRANSACTION_STATUS`/`Status`); status mapping: `SUCCESS`/`Completed` → succeeded, `FAILED`/`RETURNED`/`BLOCKED`/`REFUNDED`/`REVERSED`/`Denied` → failed, anything else (`UNCLAIMED`, `PENDING`, `Processing`) → pending; quoted fields and a BOM handled; a file without a reference column throws "This file has no Customer ID column. Download the payout's CSV log from PayPal."
- [ ] **Step 2: router failing tests:**
  - export: a team without automatic payouts, two approved (`queued`) USD payouts → `{ csv, filename: "payleor-payouts-<date>.csv", count: 2 }`; rows carry amount minus the fee estimate; both become `exported` with `offlineReference`, `offlineBatchId`, `sentMinor`, `feeEstimateMinor`; a team with automatic payouts on → BAD_REQUEST "Automatic payouts send these for you."; requested or uncertain payouts are refused.
  - import: a log row `succeeded` with fee 0.49 → `succeeded`, ledger as the API path (`payout_succeeded`, `payout_fee_recovered`, `payout_fees`, `payout_released` for the estimate difference); a `failed` row → `failed` and released; a `pending` row stays `exported`; unknown references are counted in `unmatched`; importing the same file twice changes nothing (references `postIfNew`).
  - cancel: `cancelExport` puts an `exported` payout back to `queued` and clears the offline fields.
  - freelancer FORBIDDEN on the three procedures (`approve_payouts`).
- [ ] **Step 3: implement.** Export locks each request, requires `queued` with `uncertainAt` null and one currency per export (else BAD_REQUEST "Export one currency at a time."), computes amounts with `estimateSendAmounts`, sets `exported`, `sentAt`. Import parses, then per row in its own transaction locks the request by `offlineReference` within the team, requires `exported`, and calls `applySettlement`. The fee from the log replaces the estimate exactly as the API settle does (fee unreadable → estimate stands, `reviewReason`).
- [ ] **Step 4:** run core and router tests → PASS.
- [ ] **Step 5: Commit** `feat: export approved payouts for PayPal Payouts Web and import the results`.

---

### Task 9: web

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/payouts/rules/page.tsx`, `apps/web/src/app/admin/[storeSlug]/payouts/rules/payout-rules-form.tsx`
- Create: `apps/web/src/app/admin/[storeSlug]/payouts/payouts-web-section.tsx`
- Create: `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/quote-calculator.tsx`
- Modify: `payout-requests-table.tsx`, `payout-credentials-card.tsx`, `team-payouts.tsx`, `apps/web/src/lib/payouts.ts` (+ test), `apps/web/src/app/admin/me/payouts/payout-history.tsx`, `services-team-dashboard.tsx` (link "Payout rules"), `project-detail.tsx` (render the calculator in the "New quote" form), settings form and labels (payout mode removed in Task 5)

- [ ] **Rules page** (server page like `settings/page.tsx`; client form with TanStack Query and the tRPC mutations): preset buttons "Manual", "Rules", "Automatic" with one-line descriptions and a "Custom" badge when `preset === "custom"`; groups as fieldsets with legends: Approval (auto-approve amount with "Any amount" for the unlimited value, scope radio "Member requests / Automatic payouts / Both"; trusted members checklist from `servicesTeam.listMembers` freelancers; second approver amount and scope), Automatic payouts (switch, hold days), Sending (payday radio, weekday select or day 1–28, balance floor with the note "Payleor reads your PayPal balance to apply this." and, when `credentials.canReadBalance` is false, "Turn on automatic payouts again so Payleor can read your balance."), Limits (minimum payout). Save shows the server's message in `role="alert"`; success toasts "Payout rules saved."
- [ ] **Requests table:** a "From" column (`Request` or the project title linking to the project); approvals "1 of 2 approvals" when `approvalsNeeded`; waiting line from `failureMessage` plus "Next try {time}" when `nextAttemptAt`; "Goes on payday, {date}" when `sendAfter` is in the future; status label for `exported` "Sent through PayPal Payouts Web"; actions: `exported` → "Cancel export"; approve button text "Approve" and, after one of two approvals, a note "Waiting for a second admin"; when `approvalsNeeded` is 2 or more than the admins left (`adminCount`), "Add a second admin or lower the second-approver amount." A "Waiting for members" list from `waitingForDestination`: "Waiting for {member} to connect PayPal: {project} ({amount})".
- [ ] **Payouts Web section** (shown when automatic payouts are off and there are approved payouts): checkbox list of approved payouts, "Export for PayPal Payouts Web" downloads the CSV (Blob + `URL.createObjectURL`), the steps in three short lines (PayPal > Business Tools > Make Payments > Payouts, upload, send; then download the payout's CSV log), a file input "Import PayPal's CSV log" that reads the file text and calls `importPayoutsWeb`, and the result "{settled} settled, {failed} failed, {pending} still pending, {unmatched} not matched." Note: "Your PayPal account needs Payouts turned on. PayPal charges its fee to your account; Payleor takes it from the member's payout, as with automatic payouts."
- [ ] **Credentials card:** when on and `canReadBalance` is false: "Reconnect so Payleor can read your PayPal balance." with the existing turn-on flow as "Reconnect".
- [ ] **Member history:** project payouts show "For {project}".
- [ ] **Quote calculator** under the New quote total: input "The member should receive" (money input), shows "Quote {quote}" with a "Use this quote" button that sets a single item's price when the form has one item (otherwise just shows the number), and the breakdown lines: "Client pays {clientPays}", "PayPal's checkout fee (about) {fee}, paid by the team", "Payleor's fee {platform}", "Team keeps {teamKeeps}", "PayPal's payout fee (about) {payoutFee}", "Member receives {memberReceives}". Inputs come from the project detail (team cut, management fee, currency) and the team's plan fee; read how `paymentLines`/orders get the platform fee bps and pass the same value through the project detail query if it is not there yet (add it to the `project.detail` output in this task with a router test asserting the field).
- [ ] **`apps/web/src/lib/payouts.ts`:** `payoutActions` adds `exported → ["cancel_export"]`; labels for `exported`; a helper `waitingLine(request, now)` returning the payday/next-try text, table-tested in `payouts.test.ts` (each branch once).
- [ ] Checks: `npx vitest run apps/web`, `pnpm check-types`, `pnpm lint`.
- [ ] **Commit** `feat(web): payout rules page, rule-aware payouts table, Payouts Web export and the quote calculator`.

---

### Task 10: review, merge, walkthrough (controller)

- [x] Whole-branch review (explorer, heavy) against the spec and this plan; fix findings in the branch.
- [x] Merge `--no-ff` into main with the trailer; `pnpm install`; on the dev DB check `select payout_mode, count(*) from services_team_settings group by 1` before migrating, `pnpm db:migrate:dev`, then check `team_payout_rules` has one row per services team with the carried preset; restart the stack (stop script `/tmp/jendal-stop.sh`, clear `apps/web/node_modules/.vite`, `pnpm dev`); clear the browser cache via CDP.
- [x] Walkthrough over the tunnel in the sandbox (Mouhamed signs in to PayPal where needed):
  1. walk-crew reconnects automatic payouts (first-party consent now lists transaction search and balance); card no longer asks to reconnect; `can_read_balance` true.
  2. Rules page: apply "Automatic", then customise: hold 0 days, second approver above $500 (needs a second admin: add one), balance floor $100, weekly payday today.
  3. A project completes for Walk Through (accept delivery on a seeded project, or run the existing project flow) → within one cron tick a project payout is created and sent; settle; ledger checked as in R5c.
  4. Walk Through requests $600 → needs two approvals; admin A, then admin B → sent.
  5. Raise the floor above the balance → a $20 request auto-approved under "Rules" waits with the floor message and a next try; lower the floor → sent on the next tick or Retry.
  6. Turn off automatic payouts → approve a request → export CSV → Mouhamed uploads it in PayPal Payouts Web and downloads the log → import → settled with PayPal's fee.
  7. Quote calculator on a project: target $85 → quote and breakdown shown; "Use this quote" fills the price.
- [x] Record the outcome here, update the spec status, sellers design §5 run 5 and §11.1, `specs/README.md`; remove the worktree and `jendal_test_r5b1`.

## Outcome

Done 2026-10-13. Merged as `a4cf6a8` (branch `r5b1-payout-rules`) and `2f2cb35` (walkthrough fixes). 1571 tests at merge; types and lint clean.

**Branch.** Tasks 1–9 as planned (`89723ca` … `99c286f`), with fixes during review: former trusted members drop off the list (`99765a4`); a project payout never takes earnings still inside the hold (`5a0a5df`). The whole-branch review found no blockers; its fixes: turning on completed-project payouts records `pay_completed_projects_since` and pays only projects completed after it (new migration `20261013100755_r5b1_payout_rules_since`, `2eed370`); a cancelled export keeps its Customer ID and a new export reuses it, so the cancelled file's log still settles the payout, a cancelled export PayPal shows as pending blocks sends, and a second payment counts as "paid twice" (`0a61a40`); project payouts stop at PayPal's per-item maximum (`3a7dbbe`); former trusted members are not auto-approved (`9f98482`); an admin's own payout that no other admin can approve says so (`b9f9d0b`); a currency missing from PayPal's balances reads as unreadable (`988a94d`); payday fields cleared, amount caps, the request/sweep race returns a 400, the payee's PayPal country only for admins and the payee (`5b6c2da`); no Retry without automatic payouts, quote results announced (`50293cc`). Spec §3.3 now says a project gets one automatic payout attempt.

**Dev migration.** Before: 3 teams, all `manual`. After: one `team_payout_rules` row per team, all `manual`, no `since`.

**Walkthrough (sandbox, over the tunnel).** Second and third admins are new users `mdbm-agent+admin2@agentmail.to` and `mdbm-agent+admin3@agentmail.to` (AgentMail plus addresses reach the `mdbm-agent` inbox; signed up with email, verified through the emailed link, added to walk-crew as admins on the members page). Walk Through is the workspace owner, so it is an admin and the payee.
1. Reconnect: walk-crew turned automatic payouts on again; the card says "On. Payouts are sent from ••••75MG."; `can_read_balance` true.
2. Rules: "Automatic" preset applied ("Pays projects completed since October 13, 2026."), then hold 0, second admin above $500, floor $100, weekly payday Tuesday (today). The first save was refused with "Auto-approve at most the second-approver amount." because "Any amount" for automatic payouts overlapped a second admin on both; with the second admin on member requests only it saved as Custom.
3. Project payout: "Team quote check" ($200 quote) — buyer 2 paid the $120 deposit, Walk Through delivered, the client accepted, buyer 2 paid the $100 balance; completed 12:31 with $170.00 owed to Walk Through. The 12:40 cron tick created one project payout and sent it with no admin (batch `GXDL3KSDUTXPL`, sent $166.60, estimate $3.40); settled at 12:50 with PayPal's $3.33 fee and 7¢ released. The three older completed projects got no payout.
4. Two approvals (lowered to "above $50" because Walk Through had $222.01 available): Walk Through requested $60.00 → "0 of 2 approvals" and, with Walk Admin Two the only other admin, "Add a second admin or lower the second-approver amount."; Walk Through's own Approve → "You cannot approve a payout to yourself."; after adding the third admin the note went away; Walk Admin Two approved → "1 of 2 approvals · Waiting for a second admin", again → 409 "You already approved this payout."; Walk Admin Three approved → sent (`EY5NNDWT3EZPJ`, $58.80, fee $1.18).
5. Floor: auto-approve requests up to $100, floor $10,000 → a $20.00 request waited for approval (floor above the balance); Walk Admin Two approved → held "Waiting until the team's PayPal balance stays above $10,000.00." with "Next try … 1:07 PM" (`wait_count` 1); floor back to $100, Retry → sent $19.60, settled with $0.39, `wait_count` 0.
6. Payouts Web: automatic payouts off; a $10.00 request approved by Walk Admin Two → "Waiting for export or for automatic payouts."; export `payleor-payouts-2026-10-13.csv` (`AWVNN2ZZ6ZWT4,9.80,USD,PLC5WPPSB4JQ35,Payout from Walk Crew via Payleor,PAYPAL`) → "Sent through PayPal Payouts Web"; Mouhamed uploaded it (PayPal refuses automated uploads: its `PAYPAL_PAYOUTS_WEB_UPLOAD` risk check fails under Playwright) → `MPA-PW7TS6NWPPKWG` processed; the downloaded log ([evidence](evidence/r5b1-payouts-web-log-walkthrough.csv)) imported → succeeded, transaction `0S564038PT845535M`, fee $0.20; importing it again: "1 settled, 0 failed, 0 still pending, 0 not matched." and no new postings.
7. Quote calculator (unassigned project): target $85.00 → quote $102.05; client pays $112.26, checkout fee about $4.41, Payleor's fee $1.12, team keeps $19.99, payout fee about $1.74 (international estimate without a payee), member receives $85.00; "Use this quote" filled line 1 with 102.05.

Ledger: every payout posted requested, fee recovered, fees, released (difference) and succeeded; walk-crew's entries sum to 0 and reserved is back to 0.

**Walkthrough fixes (`c9e7d5f`, `44e98fb`).** The member Payouts page blocked a request while a project payout was in flight (it checked reserved money); it now blocks only on the member's own open request, and says whether a new request was approved or waits for an admin. Approve is hidden on the viewer's own payout. Turning off automatic payouts says approved payouts wait for a Payouts Web export. The Payouts Web section stays while automatic payouts are off (settling the last export hid it with the import result) and names PayPal's menus as the sandbox shows them (Pay & Get Paid > Payouts; Download > Download (CSV)).

**Left as is.** walk-crew ends with automatic payouts off and Custom rules (auto-approve up to $100 for both, no second admin, floor $100, weekly Tuesday, completed projects paid since 12:14 UTC); Walk Admin Two and Three stay walk-crew admins (passwords in `/tmp/r5b1-admin{2,3}.pass`).
