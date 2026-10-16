# S4: Ledger, Projects and Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A services team starts a project for a client (email and/or Discord user), quotes it under the team's quoting mode, and the client accepts quotes and amendments through a signed link. Every price, fee, penalty and credit follows the services spec's money rules exactly; every state change is one database transaction with a status+version compare-and-set, balanced double-entry ledger postings and outbox events. Part A is pure `core` money math, the state machine and the posting builders, and merges into `main` on its own. Part B (after S1 merges) adds the tables, the Postgres ledger, the unit of work, the use cases, the tRPC router and the web pages, ending with the client project page at `/c/{token}`.

**Architecture:** All rules live in `@jendal-workspace/core`, pure TypeScript with no imports: money in integer minor units (`money/`), pricing, penalties and amendment math (`projects/`), the project state machine as a transition table with guards (`projects/state-machine.ts`), and ledger accounts, transfers and one posting builder per services spec §6.3 event (`ledger/`). `Ledger` is a port; `createMemoryLedger` is its in-memory adapter and `createPostgresLedger` (in `packages/db`) the real one, posting inside the caller's transaction and locking per-account balance rows with `SELECT … FOR UPDATE` in a fixed order. `runInTransaction` (`packages/db`) is the services spec §6.1 unit of work: compare-and-set on the project row, ledger writes and outbox writes, all or nothing. Use cases in `packages/api/src/use-cases/projects.ts` hold the orchestration; the `project` tRPC router exposes them to staff (session + services team role) and to clients (signed link token). Web pages: projects list, New project, project detail under `admin.{domain}/{teamSlug}/projects`, and the public client page at `/c/{token}`.

**Tech Stack:** TypeScript strict, Vitest 5, Drizzle ORM 1.0.0-rc.4 (postgres-js) on PostgreSQL 17, tRPC 11, React 19 + TanStack Query 5 on vinext, Tailwind 4, Web Crypto HMAC-SHA256 for the client link tokens.

**Spec:** [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md): §4.3 (settings and quoting modes), §5 (projects, amounts, amendments), §6 (ledger, invariants, outbox), §8.1 (shared use cases), §9 (web surfaces). Contract §4.5 in [`2026-10-06-parallel-execution.md`](2026-10-06-parallel-execution.md) is what this workstream delivers.

**Builds on:** W1-A (merged on `main` as `ae50e45`): workspace, `packages/core`, DB test harness. W1-D (branch `w1d-public-site-auth`, merges before most workstreams start): `createTestAuth`, tRPC context with `auth` and `headers`, `seedStore`/`seedOrganization`. S1 (branch `s1-services-teams`, merges before Part B): contract §4.2 — `team.product`, `services_team_member`, `services_team_settings`, `ServicesTeamRole`, `ServicesTeamSettings`, `Currency`, `canServicesTeam`, `findServicesTeamBySlug`, `getServicesTeamSettings`, `servicesTeamRoleFor`.

**Out of scope (later plans):**
- S6: payment capture and the real pay page, deliveries, accept delivery, the balance payment, deadlines. This plan creates `payment` rows in `pending`; the client page shows a disabled **Pay with PayPal** button with a "Payment coming soon" note.
- Payouts, payout requests and their tables (only their posting builders are Part A).
- The public `/v1` API, outgoing webhook delivery, Discord commands and buttons (all consume the same use cases later).
- Cases, penalties applied at delivery, refunds and chargebacks (posting builders only).
- Outbox delivery: events are written here; a Queue consumer ships in the shared workstream.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/s4-ledger-projects` (created in Task 0). Merge steps run in `/home/mouhamed/dev/repos/jendal/worktrees/main`.

**Library sources:** read the pinned clones in `/home/mouhamed/dev/repos/jendal/refs/stack/` (read-only). Load the matching skill before each task:

| Task | Skills |
|---|---|
| 1–7, 10 | `vitest`, `test-driven-development` |
| 11–14 | `drizzle-orm`, `vitest` |
| 15–18 | `test-driven-development`, `vitest` |
| 19–21 | `migrate-to-vinext`, `better-writing`, `better-accessibility` |
| 8, 22 | `verification-before-completion` |

---

## Facts this plan relies on

Each was checked against the pinned sources or the repository on 2026-10-06. If code fails in a way that contradicts one of them, re-read the cited file before changing the design.

**Money rules (services spec `/home/mouhamed/dev/repos/jendal/specs/platform/2026-10-05-services-teams-design.md`).** These become test fixtures, never re-derived:

1. **The Payleor fee** is 0.5% + 0.10 in the team currency on each client payment, through PayPal's partner fee (line 29 and line 46).
2. **The §5.3 worked example** (lines 126–148): quote $1,000, management fee 10%, team cut 15%, 3 days late at 5% per day → deposit $600 ($500 + $100 fee), penalty $150, final price $850, balance $350, team cut $127.50, freelancer earnings $722.50, Payleor fee $3.10 on $600 and $1.85 on $350.
3. **Rounding** (line 142): integer minor units everywhere; percentages in basis points; every calculation rounds half-up once, at the line it produces.
4. **Overpayment** (line 144): if the final price is below what the client already paid toward the quote, the difference is refunded on the deposit capture and there is no balance payment; the final price is never below zero.
5. **Deposit** (line 118): 50% of the quote plus the management fee on the full quote.
6. **Amendments** (lines 158–162): proposed by the assigned freelancer or a manager, answered by the client; allowed in `in_progress` and `delivered`; a pending amendment blocks delivery acceptance. Increase: top-up due now = 50% of the increase + the management fee on the increase ($240 on +$400); the other half joins the balance. Decrease (−$300): the overpaid management fee ($30) and the deposit above 50% of the new quote ($150) are credited against the balance. Balance is always "final price + management fee on the current quote − everything already paid toward the project".
7. **States** (line 106): `quoting → awaiting_deposit → in_progress → delivered → awaiting_balance → completed`, plus `cancelled`; `core` owns the transition table and any other move is rejected.
8. **One transaction per state change** (lines 167–173): status plus `version` compare-and-set, balanced ledger entries (each transfer sums to zero), outbox events. Earnings owed (available plus reserved) never go below zero; ledger rows are never updated or deleted.
9. **Accounts** (lines 177–190): `client_held:{projectId}`, `team_revenue`, `owed:{freelancerId}:available`, `owed:{freelancerId}:reserved`, `paid_out:{freelancerId}`, `client_refunds`, `paypal_clearing`, per team in the team currency.
10. **Postings** (§6.3, lines 192–204): one builder per event — capture (split into quote part and management fee), management fee credit, completion, refund requested/confirmed, payout requested/succeeded/released, penalty after completion, chargeback. Penalties before completion are not postings.

**Library and repo facts.**

11. **Row locks in Drizzle:** `.for("update")` on a select emits `FOR UPDATE` (`refs/stack/drizzle-orm/drizzle-orm/src/pg-core/query-builders/select.ts:1037`).
12. **Transactions:** `db.transaction(fn)` maps to postgres-js `begin` and rolls back when `fn` throws; nested transactions use savepoints (`refs/stack/drizzle-orm/drizzle-orm/src/postgres-js/session.ts:78-95` and `113-133`). `tx.rollback()` throws `TransactionRollbackError` (`refs/stack/drizzle-orm/drizzle-orm/src/pg-core/async/session.ts:249`).
13. **One executor type:** `PgAsyncTransaction` extends `PgAsyncDatabase` (`refs/stack/drizzle-orm/drizzle-orm/src/pg-core/async/session.ts:233`), so a `PgAsyncDatabase<PostgresJsQueryResultHKT, AnyRelations>` parameter accepts both `Database` and a transaction handle.
14. **Migration files:** the migrator sorts migration folders by name, takes the date from the first 14 characters, splits the file on `--> statement-breakpoint` and hashes the whole file (`refs/stack/drizzle-orm/drizzle-orm/src/migrator.ts:65-82`). Appending the immutability trigger SQL to the generated file before its first apply is safe; after rebasing onto a `main` that gained migrations, delete and regenerate instead (execution doc §1.5).
15. **Upsert:** `.onConflictDoUpdate({ target: [...columns], set })` (`refs/stack/drizzle-orm/drizzle-orm/src/pg-core/query-builders/insert.ts:426-490`).
16. **tRPC chained inputs accumulate:** each `.input()` appends to `def.inputs` (`refs/stack/trpc/packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:480`, `:510`), so procedures built on `servicesTeamProcedure` add their own fields with a second `.input()` and get the intersection type.
17. **The signing secret is on the auth instance:** `Auth` carries `options: Options` (`refs/stack/better-auth/packages/better-auth/src/types/auth.ts:15`) and `createAuth` sets `secret: env.BETTER_AUTH_SECRET` (`packages/auth/src/index.ts:124`). The client link key is derived from it with a domain-separation label, so this plan adds no env variable and touches no `.env` file.
18. **Core has no DOM or Node types:** `packages/core/tsconfig.json` sets `"types": []` (line 6), so Web Crypto code (`crypto.subtle`, `atob`/`btoa`) lives in `packages/api`, whose tsconfig inherits `["node", "@cloudflare/workers-types"]` from `packages/config/tsconfig.base.json`. Both runtimes provide HMAC-SHA256.
19. **One database connection per `createDb`:** `postgres(env.DATABASE_URL, { max: 1 })` (`packages/db/src/index.ts:9`). The concurrency test opens a second connection with a second `createTestDb()`.
20. **Test harness:** `fileParallelism: false` and `testTimeout: 20_000` (`vitest.config.ts:14-16`); the global setup migrates the test database and refuses any database whose name does not contain `test` (`packages/db/src/testing/global-setup.ts:13`). `packages/api` has `drizzle-orm` as a dev dependency (W1-D execution change); the use cases import it at runtime, so Task 16 moves it to `dependencies` (same `catalog:` pin).
21. **Host routing:** `/c/{token}` is served by the www site host: only the `admin` and `store` route trees are blocked (`apps/web/src/lib/host-routing.ts:11-15`) and the bare platform domain maps to app `www` (`packages/core/src/tenancy/target.ts:44`). The page therefore lives at `apps/web/src/app/(site)/c/[token]/page.tsx`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/core/src/money/money.ts` (+test) | Create | `Money`, minor units, `bpsOf` half-up, `formatMoney`, `parseMajorAmount` |
| `packages/core/src/projects/pricing.ts` (+test) | Create | `payleorFeeMinor`, `managementFeeMinor`, `teamCutMinor`, `freelancerEarningsMinor`, `finalPriceMinor`, `depositDue`, `balanceDue` |
| `packages/core/src/projects/penalty.ts` | Create | `daysLate`, `penaltyMinor` (rate × days × quote, capped) |
| `packages/core/src/projects/amendments.ts` (+test) | Create | `amendmentEffect`: top-up on increase, credits on decrease |
| `packages/core/src/projects/state-machine.ts` (+test) | Create | `PROJECT_TRANSITIONS`, `transitionProject`, guards, status labels |
| `packages/core/src/ledger/accounts.ts` (+test) | Create | §6.2 account keys and the non-negative invariant |
| `packages/core/src/ledger/transfers.ts` (+test) | Create | Transfer drafts, balance check, `transferFromMoves`, `balanceDeltas` |
| `packages/core/src/ledger/postings.ts` (+test) | Create | One builder per §6.3 event; property-style balance tests |
| `packages/core/src/ledger/ledger.ts` (+test) | Create | `Ledger` port, `LedgerError`, `createMemoryLedger` |
| `packages/core/src/testing/random.ts` | Create | Seeded PRNG for property-style tests |
| `packages/core/src/projects/quotes.ts` (+test) | Create (B) | Quote item validation, `amendQuoteItems`, payment line labels |
| `packages/core/src/projects/permissions.ts` (+test) | Create (B) | `canStartProject`, `quoteAuthor` per quoting mode, `canProposeAmendment`, `canSeeProject` |
| `packages/core/src/projects/events.ts` | Create (B) | `OUTBOX_EVENT_TYPES` |
| `packages/core/src/index.ts` | Modify | Exports |
| `packages/db/src/schema/projects.ts` | Create (B) | `project`, `quote`, `quote_item`, `amendment`, `payment` |
| `packages/db/src/schema/ledger.ts` | Create (B) | `ledger_transfer`, `ledger_entry`, `ledger_balance` |
| `packages/db/src/schema/outbox.ts` | Create (B) | `outbox` |
| `packages/db/src/schema/index.ts` | Modify (B) | Export the new tables |
| `packages/db/src/migrations/<ts>_s4_ledger_projects/` | Generate (B) | Migration plus the appended immutability trigger |
| `packages/db/src/executor.ts` | Create (B) | `DbExecutor`, `Transaction` types |
| `packages/db/src/testing/db.ts` | Modify (B) | Truncate the new tables; `seedServicesTeamWithAdmin`, `seedServicesTeamMember`, `seedProject` (built on S1's `seedOrganization`/`seedServicesTeam`) |
| `packages/db/src/repositories/ledger.ts` (+test) | Create (B) | `createPostgresLedger`, `ledgerBalancesFromEntries` |
| `packages/db/src/repositories/unit-of-work.ts` (+test) | Create (B) | `runInTransaction`, `ProjectConflictError` |
| `packages/db/src/repositories/projects.ts` | Create (B) | Project/quote/amendment/payment loaders, `getProjectFacts` |
| `packages/api/src/client-links.ts` (+test) | Create (B) | `signClientLink`, `verifyClientLink` |
| `packages/api/src/services-team-procedure.ts` | From S1 | `servicesTeamProcedure` with `ctx.servicesTeam` / `ctx.servicesTeamRole` (verified in Task 9) |
| `packages/api/src/use-cases/projects.ts` | Create (B) | start project, assign, add quote, accept quote, amendments |
| `packages/api/src/routers/project.ts` (+test) | Create (B) | `project` router: staff and client procedures |
| `packages/api/src/routers/index.ts` | Modify (B) | Register `project` |
| `packages/api/package.json` | Modify (B) | `drizzle-orm` moves to `dependencies` (runtime import in the use cases) |
| `apps/web/src/app/admin/[storeSlug]/projects/**` | Create (B) | List, New project, project detail |
| `apps/web/src/app/(site)/c/[token]/**` | Create (B) | Client project page |

---

# Part A — pure core, no database

Part A touches only `packages/core`. It starts now, from `main`, and merges into `main` at the end of Task 8 as the branch's first `--no-ff` merge.

## Task 0: Worktree and branch

**Files:** none (setup only).

- [ ] **Step 1: Create the worktree and branch (execution doc §2)**

```bash
WS=s4-ledger-projects; WT=/home/mouhamed/dev/repos/jendal/worktrees/$WS; SRC=/home/mouhamed/dev/repos/jendal/jendal-workspace
git -C $SRC worktree add $WT -b s4-ledger-projects main
cp $SRC/apps/server/.env $WT/apps/server/.env
cp $SRC/packages/infra/.env $WT/packages/infra/.env
sed -E "s#(/jendal_test)([^/?]*)#\1_${WS}#" $SRC/.env.test.local > $WT/.env.test.local
docker exec jendal-pg createdb -U postgres "jendal_test_${WS}" 2>/dev/null || true
cd $WT && pnpm install --frozen-lockfile
```

If W1-D has not merged yet, `main` is `ae50e45` (W1-A): fine, Part A needs nothing from W1-D. If it has merged, the worktree starts from the newer `main`.

- [ ] **Step 2: Smoke check**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/s4-ledger-projects && pnpm test packages/core
```

Expected: the existing core tests pass.

## Task 1: Money in integer minor units

**Files:**
- Create: `packages/core/src/money/money.ts`
- Test: `packages/core/src/money/money.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/money/money.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { addMoney, bpsOf, formatMoney, MAX_AMOUNT_MINOR, money, parseMajorAmount, subtractMoney } from "./money";

describe("money", () => {
  it("holds whole minor units only", () => {
    expect(money("USD", 1050)).toEqual({ currency: "USD", minor: 1050 });
    expect(() => money("USD", 10.5)).toThrow(RangeError);
    expect(() => money("EUR", Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it("adds and subtracts within one currency", () => {
    expect(addMoney(money("USD", 600), money("USD", 400))).toEqual(money("USD", 1000));
    expect(subtractMoney(money("EUR", 600), money("EUR", 800))).toEqual(money("EUR", -200));
    expect(() => addMoney(money("USD", 1), money("EUR", 1))).toThrow("Currency mismatch: USD and EUR");
  });

  it.each([
    [100_000, 1_000, 10_000],
    [85_000, 1_500, 12_750],
    [101, 50, 1], // 0.505 rounds up
    [99, 50, 0], // 0.495 rounds down
    [1_001, 5_000, 501], // 500.5 rounds up
    [MAX_AMOUNT_MINOR, 10_000, MAX_AMOUNT_MINOR],
  ])("takes %i × %i bps half-up = %i", (minor, bps, expected) => {
    expect(bpsOf(minor, bps)).toBe(expected);
  });

  it("refuses negative amounts in rate math", () => {
    expect(() => bpsOf(-1, 100)).toThrow(RangeError);
    expect(() => bpsOf(100, -1)).toThrow(RangeError);
  });

  it("formats USD and EUR", () => {
    expect(formatMoney(money("USD", 100_000))).toBe("$1,000.00");
    expect(formatMoney(money("USD", 72_250))).toBe("$722.50");
    expect(formatMoney(money("EUR", 310))).toBe("€3.10");
    expect(formatMoney(money("USD", -15_000))).toBe("-$150.00");
  });

  it.each([
    ["1000", 100_000],
    ["1,000.50", 100_050],
    [" 12.5 ", 1_250],
    ["0.01", 1],
  ])("parses %j as %i minor units", (input, expected) => {
    expect(parseMajorAmount(input)).toBe(expected);
  });

  it.each(["", "0", "0.00", "-5", "1.234", "abc", "1e3", "10000000000"])("rejects %j", (input) => {
    expect(parseMajorAmount(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/core/src/money/money.test.ts`
Expected: FAIL, cannot resolve `./money`.

- [ ] **Step 3: Implement**

`packages/core/src/money/money.ts`:
```ts
export type MoneyCurrency = "USD" | "EUR";

export const MONEY_CURRENCIES = ["USD", "EUR"] as const satisfies readonly MoneyCurrency[];

// Integer minor units (cents). Ledger entries may be negative; prices and payments never are.
export type Money = { readonly currency: MoneyCurrency; readonly minor: number };

// One billion in major units. Forms and use cases reject larger amounts.
export const MAX_AMOUNT_MINOR = 100_000_000_000;

export function assertMinor(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a whole number of minor units, got ${value}`);
  }
}

export function assertAmount(value: number, label = "amount"): void {
  assertMinor(value, label);
  if (value < 0) throw new RangeError(`${label} cannot be negative, got ${value}`);
}

export function assertBps(value: number, label = "rate"): void {
  assertMinor(value, label);
  if (value < 0 || value > 10_000) throw new RangeError(`${label} must be between 0 and 10000 basis points, got ${value}`);
}

export function money(currency: MoneyCurrency, minor: number): Money {
  assertMinor(minor);
  return { currency, minor };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} and ${b.currency}`);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor + b.minor);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor - b.minor);
}

// Basis points of a non-negative amount, rounded half-up once (services spec §5.3).
// BigInt keeps the product exact for any amount up to MAX_AMOUNT_MINOR.
export function bpsOf(minor: number, bps: number): number {
  assertAmount(minor);
  assertAmount(bps, "rate");
  return Number((BigInt(minor) * BigInt(bps) + 5_000n) / 10_000n);
}

const formatters = new Map<MoneyCurrency, Intl.NumberFormat>();

// USD and EUR both have two decimals, so minor / 100 is exact for display.
export function formatMoney(value: Money): string {
  let formatter = formatters.get(value.currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency });
    formatters.set(value.currency, formatter);
  }
  return formatter.format(value.minor / 100);
}

// "1,000.50" or "1000.5" in major units to minor units; null unless it is a positive amount
// with at most two decimals and at most MAX_AMOUNT_MINOR.
export function parseMajorAmount(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}
```

- [ ] **Step 4: Run the test and type check**

Run: `pnpm test packages/core/src/money/money.test.ts && pnpm -F @jendal-workspace/core check-types`
Expected: 22 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/money
git commit -m "feat(core): add money in integer minor units with half-up basis-point rates" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 2: Pricing, deposit, balance and penalties

**Files:**
- Create: `packages/core/src/projects/pricing.ts`, `packages/core/src/projects/penalty.ts`
- Test: `packages/core/src/projects/pricing.test.ts`

The test's first describe block is the services spec §5.3 worked example, line for line.

- [ ] **Step 1: Write the failing test**

`packages/core/src/projects/pricing.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import {
  balanceDue,
  depositDue,
  finalPriceMinor,
  freelancerEarningsMinor,
  managementFeeMinor,
  payleorFeeMinor,
  teamCutMinor,
} from "./pricing";
import { daysLate, penaltyMinor } from "./penalty";

const FEE_BPS = 1_000;
const CUT_BPS = 1_500;
const FIVE_PERCENT_A_DAY = { ratePerDayBps: 500, capBps: 3_500 };

describe("services spec §5.3 worked example", () => {
  // Quote $1,000, management fee 10%, team cut 15%, delivered 3 days late under 5% per day.
  const quote = 100_000;

  it("charges a $600 deposit", () => {
    expect(depositDue(quote, FEE_BPS)).toEqual({ quotePartMinor: 50_000, managementFeeMinor: 10_000, totalMinor: 60_000 });
  });

  it("computes a $150 penalty and an $850 final price", () => {
    const penalty = penaltyMinor({ quoteMinor: quote, daysLate: 3, rule: FIVE_PERCENT_A_DAY });
    expect(penalty).toBe(15_000);
    expect(finalPriceMinor(quote, penalty)).toBe(85_000);
  });

  it("asks for a $350 balance", () => {
    expect(
      balanceDue({
        quoteMinor: quote,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 85_000,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toEqual({
      dueMinor: 35_000,
      quotePartMinor: 35_000,
      managementFeePartMinor: 0,
      refundMinor: 0,
      refundQuoteMinor: 0,
      refundManagementFeeMinor: 0,
    });
  });

  it("gives the team $127.50 and the freelancer $722.50", () => {
    expect(teamCutMinor(85_000, CUT_BPS)).toBe(12_750);
    expect(freelancerEarningsMinor(85_000, CUT_BPS)).toBe(72_250);
    expect(teamCutMinor(85_000, CUT_BPS) + managementFeeMinor(quote, FEE_BPS)).toBe(22_750);
  });

  it("takes $3.10 on $600 and $1.85 on $350", () => {
    expect(payleorFeeMinor(60_000)).toBe(310);
    expect(payleorFeeMinor(35_000)).toBe(185);
  });
});

describe("payleorFeeMinor", () => {
  it.each([
    [1, 10],
    [100, 11], // 0.5 rounds up
    [99, 10], // 0.495 rounds down
    [301, 12], // 1.505 rounds up
  ])("charges %i → %i", (payment, fee) => {
    expect(payleorFeeMinor(payment)).toBe(fee);
  });

  it("rejects zero, negative and fractional payments", () => {
    expect(() => payleorFeeMinor(0)).toThrow(RangeError);
    expect(() => payleorFeeMinor(-100)).toThrow(RangeError);
    expect(() => payleorFeeMinor(10.5)).toThrow(RangeError);
  });
});

describe("rates", () => {
  it("rounds the management fee and team cut half-up once", () => {
    expect(managementFeeMinor(12_345, FEE_BPS)).toBe(1_235); // 1234.5
    expect(teamCutMinor(333, CUT_BPS)).toBe(50); // 49.95
    expect(freelancerEarningsMinor(333, CUT_BPS)).toBe(283);
  });

  it("rejects rates outside 0–10000 bps", () => {
    expect(() => managementFeeMinor(100, 10_001)).toThrow(RangeError);
    expect(() => teamCutMinor(100, -1)).toThrow(RangeError);
  });

  it("splits an odd quote's deposit half-up", () => {
    expect(depositDue(1_001, FEE_BPS)).toEqual({ quotePartMinor: 501, managementFeeMinor: 100, totalMinor: 601 });
    expect(() => depositDue(0, FEE_BPS)).toThrow(RangeError);
  });
});

describe("penalties", () => {
  it("counts a started day as a day late", () => {
    const deadline = new Date("2026-10-10T12:00:00Z");
    expect(daysLate(deadline, new Date("2026-10-10T11:00:00Z"))).toBe(0);
    expect(daysLate(deadline, deadline)).toBe(0);
    expect(daysLate(deadline, new Date("2026-10-10T12:00:01Z"))).toBe(1);
    expect(daysLate(deadline, new Date("2026-10-13T12:00:00Z"))).toBe(3);
  });

  it("caps the penalty", () => {
    expect(penaltyMinor({ quoteMinor: 100_000, daysLate: 7, rule: FIVE_PERCENT_A_DAY })).toBe(35_000);
    expect(penaltyMinor({ quoteMinor: 100_000, daysLate: 30, rule: FIVE_PERCENT_A_DAY })).toBe(35_000);
    expect(penaltyMinor({ quoteMinor: 100_000, daysLate: 0, rule: FIVE_PERCENT_A_DAY })).toBe(0);
  });

  it("never takes the final price below zero", () => {
    const penalty = penaltyMinor({ quoteMinor: 100_000, daysLate: 30, rule: { ratePerDayBps: 500, capBps: 10_000 } });
    expect(penalty).toBe(100_000);
    expect(finalPriceMinor(100_000, penalty)).toBe(0);
    expect(finalPriceMinor(100_000, 150_000)).toBe(0);
  });
});

describe("balanceDue", () => {
  it("refunds the difference when the final price is below what was paid toward the quote (§5.3)", () => {
    // 12 days late at 5% a day with no cap below 100%: penalty $600, final price $400, $500 already paid.
    const penalty = penaltyMinor({ quoteMinor: 100_000, daysLate: 12, rule: { ratePerDayBps: 500, capBps: 10_000 } });
    expect(
      balanceDue({
        quoteMinor: 100_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: finalPriceMinor(100_000, penalty),
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toEqual({
      dueMinor: 0,
      quotePartMinor: 0,
      managementFeePartMinor: 0,
      refundMinor: 10_000,
      refundQuoteMinor: 10_000,
      refundManagementFeeMinor: 0,
    });
  });

  it("asks for management fee still due as its own line", () => {
    expect(
      balanceDue({
        quoteMinor: 100_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 100_000,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 9_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toMatchObject({ dueMinor: 51_000, quotePartMinor: 50_000, managementFeePartMinor: 1_000 });
  });

  it("refunds management fee kept above the fee on the current quote", () => {
    expect(
      balanceDue({
        quoteMinor: 70_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 0,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toEqual({
      dueMinor: 0,
      quotePartMinor: 0,
      managementFeePartMinor: 0,
      refundMinor: 53_000,
      refundQuoteMinor: 50_000,
      refundManagementFeeMinor: 3_000,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/core/src/projects/pricing.test.ts`
Expected: FAIL, cannot resolve `./pricing`.

- [ ] **Step 3: Implement**

`packages/core/src/projects/pricing.ts`:
```ts
import { assertAmount, assertBps, bpsOf } from "../money/money";

export const PAYLEOR_FEE_BPS = 50;
export const PAYLEOR_FEE_FIXED_MINOR = 10;
export const DEPOSIT_BPS = 5_000;

// Services spec §3 goal 7: 0.5% + 0.10 in the team currency on each client payment, taken as PayPal platform_fees.
export function payleorFeeMinor(paymentMinor: number): number {
  assertAmount(paymentMinor, "payment");
  if (paymentMinor === 0) throw new RangeError("A client payment must be positive");
  return bpsOf(paymentMinor, PAYLEOR_FEE_BPS) + PAYLEOR_FEE_FIXED_MINOR;
}

// Services spec §5.3: from the current quote, never reduced by penalties.
export function managementFeeMinor(quoteMinor: number, managementFeeBps: number): number {
  assertBps(managementFeeBps, "management fee");
  return bpsOf(quoteMinor, managementFeeBps);
}

export function teamCutMinor(finalPriceMinor: number, teamCutBps: number): number {
  assertBps(teamCutBps, "team cut");
  return bpsOf(finalPriceMinor, teamCutBps);
}

// The remainder, so the team cut and the earnings always add up to the final price.
export function freelancerEarningsMinor(finalPriceMinor: number, teamCutBps: number): number {
  return finalPriceMinor - teamCutMinor(finalPriceMinor, teamCutBps);
}

export function finalPriceMinor(quoteMinor: number, penaltyMinor: number): number {
  assertAmount(quoteMinor, "quote");
  assertAmount(penaltyMinor, "penalty");
  return Math.max(0, quoteMinor - penaltyMinor);
}

export type PaymentSplit = { quotePartMinor: number; managementFeeMinor: number; totalMinor: number };

// Services spec §5.2 step 3: 50% of the quote plus the management fee on the full quote.
export function depositDue(quoteMinor: number, managementFeeBps: number): PaymentSplit {
  assertAmount(quoteMinor, "quote");
  if (quoteMinor === 0) throw new RangeError("A quote must be positive");
  const quotePartMinor = bpsOf(quoteMinor, DEPOSIT_BPS);
  const fee = managementFeeMinor(quoteMinor, managementFeeBps);
  return { quotePartMinor, managementFeeMinor: fee, totalMinor: quotePartMinor + fee };
}

// What the client has paid toward a project, split the way the ledger holds it (services spec §6.3).
export type ProjectPaid = {
  // Captured quote parts of the deposit, top-ups and balance (client_held).
  paidQuoteMinor: number;
  // Captured management fee lines (team_revenue).
  paidManagementFeeMinor: number;
  // Management fee moved back to client_held by amendment decreases.
  managementFeeCreditedMinor: number;
};

export type BalanceInput = ProjectPaid & {
  quoteMinor: number;
  managementFeeBps: number;
  finalPriceMinor: number;
};

export type Balance = {
  dueMinor: number;
  quotePartMinor: number;
  managementFeePartMinor: number;
  refundMinor: number;
  refundQuoteMinor: number;
  refundManagementFeeMinor: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Services spec §5.5: final price + management fee on the current quote − everything already paid.
// A negative result is refunded and there is no balance payment (§5.3).
export function balanceDue(input: BalanceInput): Balance {
  for (const [label, value] of Object.entries(input)) assertAmount(value, label);
  const fee = managementFeeMinor(input.quoteMinor, input.managementFeeBps);
  const paid = input.paidQuoteMinor + input.paidManagementFeeMinor;
  const net = input.finalPriceMinor + fee - paid;
  const feeKept = input.paidManagementFeeMinor - input.managementFeeCreditedMinor;
  if (net >= 0) {
    const managementFeePartMinor = clamp(fee - feeKept, 0, net);
    return {
      dueMinor: net,
      quotePartMinor: net - managementFeePartMinor,
      managementFeePartMinor,
      refundMinor: 0,
      refundQuoteMinor: 0,
      refundManagementFeeMinor: 0,
    };
  }
  const refundMinor = -net;
  const refundManagementFeeMinor = clamp(feeKept - fee, 0, refundMinor);
  return {
    dueMinor: 0,
    quotePartMinor: 0,
    managementFeePartMinor: 0,
    refundMinor,
    refundQuoteMinor: refundMinor - refundManagementFeeMinor,
    refundManagementFeeMinor,
  };
}
```

`packages/core/src/projects/penalty.ts`:
```ts
import { assertAmount, assertBps, bpsOf } from "../money/money";

const DAY_MS = 86_400_000;

export type PenaltyRule = { ratePerDayBps: number; capBps: number };

// A started day counts as a whole day late.
export function daysLate(deadline: Date, deliveredAt: Date): number {
  const lateMs = deliveredAt.getTime() - deadline.getTime();
  return lateMs <= 0 ? 0 : Math.ceil(lateMs / DAY_MS);
}

// Services spec §5.3 and §7.2: rate per day × days late × quote, capped at capBps of the quote.
export function penaltyMinor(input: { quoteMinor: number; daysLate: number; rule: PenaltyRule }): number {
  assertAmount(input.quoteMinor, "quote");
  assertAmount(input.daysLate, "days late");
  assertBps(input.rule.ratePerDayBps, "penalty rate");
  assertBps(input.rule.capBps, "penalty cap");
  if (input.daysLate === 0) return 0;
  const uncapped = Number(
    (BigInt(input.quoteMinor) * BigInt(input.rule.ratePerDayBps) * BigInt(input.daysLate) + 5_000n) / 10_000n,
  );
  return Math.min(uncapped, bpsOf(input.quoteMinor, input.rule.capBps));
}
```

- [ ] **Step 4: Run the test and type check**

Run: `pnpm test packages/core/src/projects && pnpm -F @jendal-workspace/core check-types`
Expected: 19 pricing tests pass (the money tests keep passing); no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/projects
git commit -m "feat(core): add project pricing, deposit and balance math, and the penalty formula" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 3: Amendment top-ups and decrease credits

**Files:**
- Create: `packages/core/src/projects/amendments.ts`
- Test: `packages/core/src/projects/amendments.test.ts`

The test's first block is the services spec §5.5 worked examples (+$400 → $240 top-up; −$300 → $30 fee credit and $150 deposit credit).

- [ ] **Step 1: Write the failing test**

`packages/core/src/projects/amendments.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { amendmentEffect } from "./amendments";
import { balanceDue, depositDue, managementFeeMinor } from "./pricing";

const FEE_BPS = 1_000;

describe("services spec §5.5 worked examples", () => {
  it("asks for a $240 top-up on a +$400 increase and adds $200 to the balance", () => {
    expect(amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 140_000, managementFeeBps: FEE_BPS })).toEqual({
      kind: "increase",
      deltaMinor: 40_000,
      topUp: { quotePartMinor: 20_000, managementFeeMinor: 4_000, totalMinor: 24_000 },
      addedToBalanceMinor: 20_000,
    });
  });

  it("credits $30 of management fee and $150 of deposit on a −$300 decrease", () => {
    expect(amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 70_000, managementFeeBps: FEE_BPS })).toEqual({
      kind: "decrease",
      deltaMinor: -30_000,
      managementFeeCreditMinor: 3_000,
      depositCreditMinor: 15_000,
    });
  });

  it("takes both credits off the balance payment after a decrease", () => {
    // $1,000 quote, $600 deposit paid, −$300 accepted: $700 + $70 − $600 = $170, which is $350 − $150 − $30.
    expect(
      balanceDue({
        quoteMinor: 70_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 70_000,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 3_000,
      }),
    ).toMatchObject({ dueMinor: 17_000, quotePartMinor: 17_000, managementFeePartMinor: 0, refundMinor: 0 });
  });

  it("adds the other half of an increase to the balance payment", () => {
    // $600 deposit and $240 top-up paid on a $1,400 quote: $1,400 + $140 − $840 = $700 = $500 + $200.
    expect(
      balanceDue({
        quoteMinor: 140_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 140_000,
        paidQuoteMinor: 70_000,
        paidManagementFeeMinor: 14_000,
        managementFeeCreditedMinor: 0,
      }),
    ).toMatchObject({ dueMinor: 70_000, quotePartMinor: 70_000, managementFeePartMinor: 0 });
  });

  it("refunds credits above what is still due", () => {
    // −$800 on a $1,000 quote with $600 paid: $200 + $20 − $600 → $380 refunded, all from the quote part.
    const effect = amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 20_000, managementFeeBps: FEE_BPS });
    expect(effect).toMatchObject({ kind: "decrease", managementFeeCreditMinor: 8_000 });
    expect(
      balanceDue({
        quoteMinor: 20_000,
        managementFeeBps: FEE_BPS,
        finalPriceMinor: 20_000,
        paidQuoteMinor: 50_000,
        paidManagementFeeMinor: 10_000,
        managementFeeCreditedMinor: 8_000,
      }),
    ).toMatchObject({ dueMinor: 0, refundMinor: 38_000, refundQuoteMinor: 38_000, refundManagementFeeMinor: 0 });
  });
});

describe("amendmentEffect", () => {
  it("reports no money movement when the total does not change", () => {
    expect(amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 100_000, managementFeeBps: FEE_BPS })).toEqual({
      kind: "unchanged",
      deltaMinor: 0,
    });
  });

  it("refuses to remove the whole quote", () => {
    expect(() => amendmentEffect({ previousQuoteMinor: 100_000, newQuoteMinor: 0, managementFeeBps: FEE_BPS })).toThrow(
      RangeError,
    );
  });

  it("keeps deposit plus top-ups equal to the deposit on the current quote, whatever the rounding", () => {
    const versions = [1_001, 1_004, 1_333, 2_777, 9_999];
    let paidQuote = depositDue(versions[0] ?? 0, FEE_BPS).quotePartMinor;
    let paidFee = depositDue(versions[0] ?? 0, FEE_BPS).managementFeeMinor;
    for (let i = 1; i < versions.length; i++) {
      const effect = amendmentEffect({
        previousQuoteMinor: versions[i - 1] ?? 0,
        newQuoteMinor: versions[i] ?? 0,
        managementFeeBps: FEE_BPS,
      });
      if (effect.kind !== "increase") throw new Error("expected an increase");
      paidQuote += effect.topUp.quotePartMinor;
      paidFee += effect.topUp.managementFeeMinor;
    }
    expect(paidQuote).toBe(depositDue(9_999, FEE_BPS).quotePartMinor);
    expect(paidFee).toBe(managementFeeMinor(9_999, FEE_BPS));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/core/src/projects/amendments.test.ts`
Expected: FAIL, cannot resolve `./amendments`.

- [ ] **Step 3: Implement**

`packages/core/src/projects/amendments.ts`:
```ts
import { assertAmount, bpsOf } from "../money/money";
import { DEPOSIT_BPS, managementFeeMinor, type PaymentSplit } from "./pricing";

export type AmendmentEffect =
  | { kind: "increase"; deltaMinor: number; topUp: PaymentSplit; addedToBalanceMinor: number }
  | { kind: "decrease"; deltaMinor: number; managementFeeCreditMinor: number; depositCreditMinor: number }
  | { kind: "unchanged"; deltaMinor: 0 };

// Services spec §5.5. Each amount is a difference of rounded totals, not a rounded difference, so the
// deposit, top-ups and credits always add up to exactly what the current quote version requires.
export function amendmentEffect(input: {
  previousQuoteMinor: number;
  newQuoteMinor: number;
  managementFeeBps: number;
}): AmendmentEffect {
  assertAmount(input.previousQuoteMinor, "previous quote");
  assertAmount(input.newQuoteMinor, "new quote");
  if (input.newQuoteMinor === 0) throw new RangeError("An amendment cannot remove the whole quote");
  const deltaMinor = input.newQuoteMinor - input.previousQuoteMinor;
  const half = (quote: number) => bpsOf(quote, DEPOSIT_BPS);
  const fee = (quote: number) => managementFeeMinor(quote, input.managementFeeBps);
  if (deltaMinor > 0) {
    const quotePartMinor = half(input.newQuoteMinor) - half(input.previousQuoteMinor);
    const managementFee = fee(input.newQuoteMinor) - fee(input.previousQuoteMinor);
    return {
      kind: "increase",
      deltaMinor,
      topUp: { quotePartMinor, managementFeeMinor: managementFee, totalMinor: quotePartMinor + managementFee },
      addedToBalanceMinor: deltaMinor - quotePartMinor,
    };
  }
  if (deltaMinor < 0) {
    return {
      kind: "decrease",
      deltaMinor,
      managementFeeCreditMinor: fee(input.previousQuoteMinor) - fee(input.newQuoteMinor),
      depositCreditMinor: half(input.previousQuoteMinor) - half(input.newQuoteMinor),
    };
  }
  return { kind: "unchanged", deltaMinor: 0 };
}
```

- [ ] **Step 4: Run the test and type check**

Run: `pnpm test packages/core/src/projects && pnpm -F @jendal-workspace/core check-types`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/projects
git commit -m "feat(core): add amendment top-up and decrease credit math" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 4: The project state machine

**Files:**
- Create: `packages/core/src/projects/state-machine.ts`
- Test: `packages/core/src/projects/state-machine.test.ts`

Services spec §5.1: `core` owns the transition table; any move not listed is rejected. The test asserts the full status × event table.

- [ ] **Step 1: Write the failing test**

`packages/core/src/projects/state-machine.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import {
  allowedProjectEvents,
  PROJECT_EVENTS,
  PROJECT_STATUSES,
  projectStatusLabel,
  type ProjectEvent,
  type ProjectStatus,
  type TransitionRefusal,
  transitionProject,
  transitionRefusalMessage,
} from "./state-machine";

// Services spec §5.1: the full table, with no pending amendment, no unpaid top-up and a balance due.
const EXPECTED: Record<ProjectStatus, Partial<Record<ProjectEvent, ProjectStatus>>> = {
  quoting: { add_quote: "quoting", assign_freelancer: "quoting", accept_quote: "awaiting_deposit", cancel: "cancelled" },
  awaiting_deposit: { deposit_captured: "in_progress", cancel: "cancelled" },
  in_progress: { submit_delivery: "delivered", propose_amendment: "in_progress", cancel: "cancelled" },
  delivered: {
    request_changes: "in_progress",
    propose_amendment: "delivered",
    accept_delivery: "awaiting_balance",
    cancel: "cancelled",
  },
  awaiting_balance: { balance_captured: "completed", cancel: "cancelled" },
  completed: {},
  cancelled: {},
};

// Allowed in the status but refused by a guard under the facts used for the table.
const GUARDED: Partial<Record<ProjectStatus, Partial<Record<ProjectEvent, TransitionRefusal>>>> = {
  in_progress: { accept_amendment: "no_pending_amendment", decline_amendment: "no_pending_amendment" },
  delivered: { accept_amendment: "no_pending_amendment", decline_amendment: "no_pending_amendment" },
};

describe("project state machine", () => {
  const facts = { pendingAmendment: false, unpaidTopUp: false, balanceDueMinor: 35_000 };

  for (const status of PROJECT_STATUSES) {
    for (const event of PROJECT_EVENTS) {
      const to = EXPECTED[status][event];
      const reason = GUARDED[status]?.[event] ?? "not_allowed_in_status";
      it(`${status} + ${event} → ${to ?? reason}`, () => {
        expect(transitionProject(status, event, facts)).toEqual(to ? { ok: true, to } : { ok: false, reason });
      });
    }
  }

  it("blocks accept delivery while an amendment is pending (§5.5)", () => {
    expect(transitionProject("delivered", "accept_delivery", { pendingAmendment: true, balanceDueMinor: 1 })).toEqual({
      ok: false,
      reason: "pending_amendment",
    });
  });

  it("blocks accept delivery and new amendments while a top-up is unpaid", () => {
    expect(transitionProject("delivered", "accept_delivery", { unpaidTopUp: true })).toEqual({
      ok: false,
      reason: "unpaid_top_up",
    });
    expect(transitionProject("in_progress", "propose_amendment", { unpaidTopUp: true })).toEqual({
      ok: false,
      reason: "unpaid_top_up",
    });
  });

  it("allows one pending amendment at a time and answers only a pending one", () => {
    expect(transitionProject("in_progress", "propose_amendment", { pendingAmendment: true })).toEqual({
      ok: false,
      reason: "pending_amendment",
    });
    expect(transitionProject("in_progress", "accept_amendment", { pendingAmendment: true })).toEqual({
      ok: true,
      to: "in_progress",
    });
    expect(transitionProject("delivered", "decline_amendment", { pendingAmendment: true })).toEqual({
      ok: true,
      to: "delivered",
    });
    expect(transitionProject("in_progress", "accept_amendment")).toEqual({ ok: false, reason: "no_pending_amendment" });
  });

  it("completes on accept delivery when nothing is left to pay (§5.3)", () => {
    expect(transitionProject("delivered", "accept_delivery", { balanceDueMinor: 0 })).toEqual({
      ok: true,
      to: "completed",
    });
  });

  it("lists the events a status allows", () => {
    expect(allowedProjectEvents("quoting")).toEqual(["add_quote", "assign_freelancer", "accept_quote", "cancel"]);
    expect(allowedProjectEvents("in_progress", { pendingAmendment: true })).toEqual([
      "submit_delivery",
      "accept_amendment",
      "decline_amendment",
      "cancel",
    ]);
    expect(allowedProjectEvents("completed")).toEqual([]);
  });

  it("explains refusals in plain words", () => {
    expect(transitionRefusalMessage("pending_amendment")).toBe("An amendment is waiting for the client's answer.");
    expect(transitionRefusalMessage("not_allowed_in_status")).toBe(
      "This action is not available at this stage of the project.",
    );
  });
});

describe("projectStatusLabel", () => {
  it("labels every status", () => {
    for (const status of PROJECT_STATUSES) {
      expect(projectStatusLabel(status)).toMatch(/^[A-Z]/);
    }
    expect(projectStatusLabel("awaiting_deposit")).toBe("Awaiting deposit");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/core/src/projects/state-machine.test.ts`
Expected: FAIL, cannot resolve `./state-machine`.

- [ ] **Step 3: Implement**

`packages/core/src/projects/state-machine.ts`:
```ts
export const PROJECT_STATUSES = [
  "quoting",
  "awaiting_deposit",
  "in_progress",
  "delivered",
  "awaiting_balance",
  "completed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_EVENTS = [
  "add_quote",
  "assign_freelancer",
  "accept_quote",
  "deposit_captured",
  "submit_delivery",
  "request_changes",
  "propose_amendment",
  "accept_amendment",
  "decline_amendment",
  "accept_delivery",
  "balance_captured",
  "cancel",
] as const;

export type ProjectEvent = (typeof PROJECT_EVENTS)[number];

// What the guards need to know beyond the status. Callers read these in the same transaction as the change.
export type ProjectFacts = {
  pendingAmendment: boolean;
  unpaidTopUp: boolean;
  balanceDueMinor: number;
};

export type TransitionRefusal = "not_allowed_in_status" | "pending_amendment" | "unpaid_top_up" | "no_pending_amendment";

export type TransitionResult = { ok: true; to: ProjectStatus } | { ok: false; reason: TransitionRefusal };

type TransitionRule = {
  from: readonly ProjectStatus[];
  to: ProjectStatus | "unchanged" | ((facts: ProjectFacts) => ProjectStatus);
  guard?: (facts: ProjectFacts) => TransitionRefusal | null;
};

const OPEN: readonly ProjectStatus[] = ["quoting", "awaiting_deposit", "in_progress", "delivered", "awaiting_balance"];
const WORKING: readonly ProjectStatus[] = ["in_progress", "delivered"];

// The extra work of an increase starts when its top-up is captured (services spec §5.5), so nothing
// that builds on the current quote may run while a top-up is unpaid.
function noOpenAmendmentMoney(facts: ProjectFacts): TransitionRefusal | null {
  if (facts.pendingAmendment) return "pending_amendment";
  if (facts.unpaidTopUp) return "unpaid_top_up";
  return null;
}

function hasPendingAmendment(facts: ProjectFacts): TransitionRefusal | null {
  return facts.pendingAmendment ? null : "no_pending_amendment";
}

// Services spec §5.1 and §5.2. Any move not listed here is rejected.
export const PROJECT_TRANSITIONS: Readonly<Record<ProjectEvent, TransitionRule>> = {
  add_quote: { from: ["quoting"], to: "unchanged" },
  assign_freelancer: { from: ["quoting"], to: "unchanged" },
  accept_quote: { from: ["quoting"], to: "awaiting_deposit" },
  deposit_captured: { from: ["awaiting_deposit"], to: "in_progress" },
  submit_delivery: { from: ["in_progress"], to: "delivered" },
  request_changes: { from: ["delivered"], to: "in_progress" },
  propose_amendment: { from: WORKING, to: "unchanged", guard: noOpenAmendmentMoney },
  accept_amendment: { from: WORKING, to: "unchanged", guard: hasPendingAmendment },
  decline_amendment: { from: WORKING, to: "unchanged", guard: hasPendingAmendment },
  // With nothing left to pay (penalties or decreases), the project completes without a balance payment (§5.3).
  accept_delivery: {
    from: ["delivered"],
    to: (facts) => (facts.balanceDueMinor > 0 ? "awaiting_balance" : "completed"),
    guard: noOpenAmendmentMoney,
  },
  balance_captured: { from: ["awaiting_balance"], to: "completed" },
  cancel: { from: OPEN, to: "cancelled" },
};

const NO_FACTS: ProjectFacts = { pendingAmendment: false, unpaidTopUp: false, balanceDueMinor: 0 };

export function transitionProject(
  from: ProjectStatus,
  event: ProjectEvent,
  facts: Partial<ProjectFacts> = {},
): TransitionResult {
  const rule = PROJECT_TRANSITIONS[event];
  if (!rule.from.includes(from)) return { ok: false, reason: "not_allowed_in_status" };
  const all = { ...NO_FACTS, ...facts };
  const refusal = rule.guard?.(all) ?? null;
  if (refusal) return { ok: false, reason: refusal };
  if (rule.to === "unchanged") return { ok: true, to: from };
  return { ok: true, to: typeof rule.to === "function" ? rule.to(all) : rule.to };
}

export function allowedProjectEvents(from: ProjectStatus, facts: Partial<ProjectFacts> = {}): ProjectEvent[] {
  return PROJECT_EVENTS.filter((event) => transitionProject(from, event, facts).ok);
}

export function transitionRefusalMessage(reason: TransitionRefusal): string {
  switch (reason) {
    case "not_allowed_in_status":
      return "This action is not available at this stage of the project.";
    case "pending_amendment":
      return "An amendment is waiting for the client's answer.";
    case "unpaid_top_up":
      return "The top-up for the last amendment is not paid yet.";
    case "no_pending_amendment":
      return "There is no amendment waiting for an answer.";
  }
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  quoting: "Quoting",
  awaiting_deposit: "Awaiting deposit",
  in_progress: "In progress",
  delivered: "Delivered",
  awaiting_balance: "Awaiting balance",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function projectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_LABELS[status];
}
```

- [ ] **Step 4: Run the test and type check**

Run: `pnpm test packages/core/src/projects/state-machine.test.ts && pnpm -F @jendal-workspace/core check-types`
Expected: 91 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/projects
git commit -m "feat(core): add the project state machine with amendment and top-up guards" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 5: Ledger accounts and balanced transfers

**Files:**
- Create: `packages/core/src/ledger/accounts.ts`, `packages/core/src/ledger/transfers.ts`
- Test: `packages/core/src/ledger/accounts.test.ts`, `packages/core/src/ledger/transfers.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/ledger/accounts.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { breaksLedgerInvariant, isLedgerAccountKey, ledgerAccountKind, ledgerAccounts } from "./accounts";

describe("ledger accounts", () => {
  it("names the accounts of services spec §6.2", () => {
    expect(ledgerAccounts.clientHeld("p1")).toBe("client_held:p1");
    expect(ledgerAccounts.owedAvailable("u1")).toBe("owed:u1:available");
    expect(ledgerAccounts.owedReserved("u1")).toBe("owed:u1:reserved");
    expect(ledgerAccounts.paidOut("u1")).toBe("paid_out:u1");
    expect([ledgerAccounts.teamRevenue, ledgerAccounts.clientRefunds, ledgerAccounts.paypalClearing]).toEqual([
      "team_revenue",
      "client_refunds",
      "paypal_clearing",
    ]);
  });

  it("rejects ids that would make a key ambiguous", () => {
    expect(() => ledgerAccounts.clientHeld("")).toThrow("Invalid ledger account id");
    expect(() => ledgerAccounts.owedAvailable("a:b")).toThrow("Invalid ledger account id");
  });

  it.each([
    ["client_held:p1", "client_held"],
    ["team_revenue", "team_revenue"],
    ["owed:u1:available", "owed_available"],
    ["owed:u1:reserved", "owed_reserved"],
    ["paid_out:u1", "paid_out"],
    ["client_refunds", "client_refunds"],
    ["paypal_clearing", "paypal_clearing"],
    ["owed:u1:spent", null],
    ["client_held:", null],
    ["cash", null],
  ])("reads %j as %j", (key, kind) => {
    expect(ledgerAccountKind(key)).toBe(kind);
    expect(isLedgerAccountKey(key)).toBe(kind !== null);
  });

  it("keeps earnings, client money, payouts and refunds at or above zero (§6.1)", () => {
    expect(breaksLedgerInvariant("owed:u1:available", -1)).toBe(true);
    expect(breaksLedgerInvariant("owed:u1:reserved", -1)).toBe(true);
    expect(breaksLedgerInvariant("client_held:p1", -1)).toBe(true);
    expect(breaksLedgerInvariant("paid_out:u1", -1)).toBe(true);
    expect(breaksLedgerInvariant("client_refunds", -1)).toBe(true);
    expect(breaksLedgerInvariant("owed:u1:available", 0)).toBe(false);
    expect(breaksLedgerInvariant("team_revenue", -500)).toBe(false);
    expect(breaksLedgerInvariant("paypal_clearing", -60_000)).toBe(false);
  });
});
```

`packages/core/src/ledger/transfers.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import {
  assertBalanced,
  assertUniqueReferences,
  balanceDeltas,
  isBalanced,
  LedgerError,
  type LedgerTransferDraft,
  transferFromMoves,
} from "./transfers";

const transfer = (entries: LedgerTransferDraft["entries"], reference = "t1"): LedgerTransferDraft => ({
  kind: "payment_captured",
  reference,
  projectId: "p1",
  entries,
});

describe("ledger transfers", () => {
  it("accepts transfers that sum to zero in every currency", () => {
    expect(
      isBalanced(
        transfer([
          { account: "paypal_clearing", currency: "USD", amountMinor: -600 },
          { account: "client_held:p1", currency: "USD", amountMinor: 500 },
          { account: "team_revenue", currency: "USD", amountMinor: 100 },
        ]),
      ),
    ).toBe(true);
  });

  it("rejects unbalanced, one-sided, zero, fractional and unknown-account transfers", () => {
    const cases: LedgerTransferDraft["entries"][] = [
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: -600 },
        { account: "client_held:p1", currency: "USD", amountMinor: 500 },
      ],
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: -600 },
        { account: "client_held:p1", currency: "EUR", amountMinor: 600 },
      ],
      [{ account: "paypal_clearing", currency: "USD", amountMinor: 0 }],
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: 0 },
        { account: "client_held:p1", currency: "USD", amountMinor: 0 },
      ],
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: -0.5 },
        { account: "client_held:p1", currency: "USD", amountMinor: 0.5 },
      ],
      [
        { account: "paypal_clearing", currency: "USD", amountMinor: -1 },
        { account: "cash" as "team_revenue", currency: "USD", amountMinor: 1 },
      ],
    ];
    for (const entries of cases) {
      expect(isBalanced(transfer(entries))).toBe(false);
      expect(() => assertBalanced(transfer(entries))).toThrow(LedgerError);
    }
  });

  it("merges moves per account and drops zero amounts", () => {
    expect(
      transferFromMoves({
        kind: "payment_captured",
        reference: "payment_captured:pay1",
        projectId: "p1",
        currency: "USD",
        moves: [
          { from: "paypal_clearing", to: "client_held:p1", amountMinor: 500 },
          { from: "paypal_clearing", to: "team_revenue", amountMinor: 0 },
        ],
      }).entries,
    ).toEqual([
      { account: "paypal_clearing", currency: "USD", amountMinor: -500 },
      { account: "client_held:p1", currency: "USD", amountMinor: 500 },
    ]);
  });

  it("refuses a transfer with nothing to move or a negative move", () => {
    const base = { kind: "payment_captured", reference: "r", projectId: "p1", currency: "USD" } as const;
    expect(() =>
      transferFromMoves({ ...base, moves: [{ from: "paypal_clearing", to: "team_revenue", amountMinor: 0 }] }),
    ).toThrow("needs a non-zero amount");
    expect(() =>
      transferFromMoves({ ...base, moves: [{ from: "paypal_clearing", to: "team_revenue", amountMinor: -1 }] }),
    ).toThrow(RangeError);
  });

  it("sums deltas per account in a fixed lock order", () => {
    const first = transfer(
      [
        { account: "team_revenue", currency: "USD", amountMinor: 100 },
        { account: "paypal_clearing", currency: "USD", amountMinor: -100 },
      ],
      "a",
    );
    const second = transfer(
      [
        { account: "client_held:p1", currency: "USD", amountMinor: 50 },
        { account: "team_revenue", currency: "USD", amountMinor: -50 },
      ],
      "b",
    );
    expect(balanceDeltas([first, second])).toEqual([
      { account: "client_held:p1", currency: "USD", deltaMinor: 50 },
      { account: "paypal_clearing", currency: "USD", deltaMinor: -100 },
      { account: "team_revenue", currency: "USD", deltaMinor: 50 },
    ]);
  });

  it("rejects a reference used twice in one batch", () => {
    const entries = [
      { account: "paypal_clearing", currency: "USD", amountMinor: -1 },
      { account: "team_revenue", currency: "USD", amountMinor: 1 },
    ] as const;
    expect(() => assertUniqueReferences([transfer(entries, "same"), transfer(entries, "same")])).toThrow(
      expect.objectContaining({ code: "duplicate_reference" }),
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test packages/core/src/ledger`
Expected: FAIL, cannot resolve `./accounts`.

- [ ] **Step 3: Implement**

`packages/core/src/ledger/accounts.ts`:
```ts
// Services spec §6.2. Every account belongs to one team and one currency; the key names it within the team.
export type LedgerAccountKey =
  | `client_held:${string}`
  | "team_revenue"
  | `owed:${string}:available`
  | `owed:${string}:reserved`
  | `paid_out:${string}`
  | "client_refunds"
  | "paypal_clearing";

export type LedgerAccountKind =
  | "client_held"
  | "team_revenue"
  | "owed_available"
  | "owed_reserved"
  | "paid_out"
  | "client_refunds"
  | "paypal_clearing";

// IDs are embedded in keys, so a ":" would make a key ambiguous.
function keyPart(id: string): string {
  if (id.length === 0 || id.includes(":")) throw new Error(`Invalid ledger account id: ${JSON.stringify(id)}`);
  return id;
}

export const ledgerAccounts = {
  clientHeld: (projectId: string) => `client_held:${keyPart(projectId)}` as const,
  teamRevenue: "team_revenue",
  owedAvailable: (freelancerId: string) => `owed:${keyPart(freelancerId)}:available` as const,
  owedReserved: (freelancerId: string) => `owed:${keyPart(freelancerId)}:reserved` as const,
  paidOut: (freelancerId: string) => `paid_out:${keyPart(freelancerId)}` as const,
  clientRefunds: "client_refunds",
  paypalClearing: "paypal_clearing",
} as const;

export function ledgerAccountKind(key: string): LedgerAccountKind | null {
  if (key === "team_revenue" || key === "client_refunds" || key === "paypal_clearing") return key;
  const parts = key.split(":");
  if (parts.length === 2 && parts[1]) {
    if (parts[0] === "client_held") return "client_held";
    if (parts[0] === "paid_out") return "paid_out";
  }
  if (parts.length === 3 && parts[0] === "owed" && parts[1]) {
    if (parts[2] === "available") return "owed_available";
    if (parts[2] === "reserved") return "owed_reserved";
  }
  return null;
}

export function isLedgerAccountKey(key: string): key is LedgerAccountKey {
  return ledgerAccountKind(key) !== null;
}

// Services spec §6.1 point 3: earnings owed (available and reserved) never go below zero. Client money held,
// money paid out and refunds in flight cannot be negative either. team_revenue may go negative after a
// chargeback the team absorbs; paypal_clearing is a counterpart and is negative by design.
const NON_NEGATIVE: ReadonlySet<LedgerAccountKind> = new Set([
  "client_held",
  "owed_available",
  "owed_reserved",
  "paid_out",
  "client_refunds",
]);

export function breaksLedgerInvariant(key: LedgerAccountKey, balanceMinor: number): boolean {
  const kind = ledgerAccountKind(key);
  return kind !== null && NON_NEGATIVE.has(kind) && balanceMinor < 0;
}
```

`packages/core/src/ledger/transfers.ts`:
```ts
import { assertAmount, type MoneyCurrency } from "../money/money";
import { isLedgerAccountKey, type LedgerAccountKey } from "./accounts";

export const LEDGER_TRANSFER_KINDS = [
  "payment_captured",
  "management_fee_credit",
  "completion",
  "refund_requested",
  "refund_confirmed",
  "payout_requested",
  "payout_succeeded",
  "payout_released",
  "penalty_after_completion",
  "chargeback",
] as const;

export type LedgerTransferKind = (typeof LEDGER_TRANSFER_KINDS)[number];

// Signed: money leaves an account with a negative amount and enters one with a positive amount.
export type LedgerEntryDraft = { account: LedgerAccountKey; currency: MoneyCurrency; amountMinor: number };

export type LedgerTransferDraft = {
  kind: LedgerTransferKind;
  // Unique per team. A reused reference is rejected, so the same fact is never posted twice.
  reference: string;
  projectId: string | null;
  entries: readonly LedgerEntryDraft[];
};

export type LedgerErrorCode = "unbalanced" | "negative_balance" | "duplicate_reference";

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export function transferSums(transfer: LedgerTransferDraft): Map<MoneyCurrency, number> {
  const sums = new Map<MoneyCurrency, number>();
  for (const entry of transfer.entries) sums.set(entry.currency, (sums.get(entry.currency) ?? 0) + entry.amountMinor);
  return sums;
}

// Balanced: at least two non-zero whole-number entries on known accounts, summing to zero in every currency.
export function isBalanced(transfer: LedgerTransferDraft): boolean {
  if (transfer.entries.length < 2) return false;
  for (const entry of transfer.entries) {
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor === 0) return false;
    if (!isLedgerAccountKey(entry.account)) return false;
  }
  return [...transferSums(transfer).values()].every((sum) => sum === 0);
}

export function assertBalanced(transfer: LedgerTransferDraft): void {
  if (!isBalanced(transfer)) {
    throw new LedgerError("unbalanced", `Transfer ${transfer.reference} is not balanced`);
  }
}

export type LedgerMove = { from: LedgerAccountKey; to: LedgerAccountKey; amountMinor: number };

// Builds one transfer from "from → to" moves: entries on the same account are merged and zero amounts dropped.
export function transferFromMoves(input: {
  kind: LedgerTransferKind;
  reference: string;
  projectId: string | null;
  currency: MoneyCurrency;
  moves: readonly LedgerMove[];
}): LedgerTransferDraft {
  const totals = new Map<LedgerAccountKey, number>();
  for (const move of input.moves) {
    assertAmount(move.amountMinor, `${input.kind} amount`);
    totals.set(move.from, (totals.get(move.from) ?? 0) - move.amountMinor);
    totals.set(move.to, (totals.get(move.to) ?? 0) + move.amountMinor);
  }
  const entries = [...totals]
    .filter(([, amountMinor]) => amountMinor !== 0)
    .map(([account, amountMinor]) => ({ account, currency: input.currency, amountMinor }));
  if (entries.length === 0) throw new RangeError(`A ${input.kind} transfer needs a non-zero amount`);
  const transfer = { kind: input.kind, reference: input.reference, projectId: input.projectId, entries };
  assertBalanced(transfer);
  return transfer;
}

export type LedgerBalanceDelta = { account: LedgerAccountKey; currency: MoneyCurrency; deltaMinor: number };

// Net change per account, sorted by currency then account: the order in which adapters lock balance rows,
// so two transactions touching the same accounts always lock them in the same order.
export function balanceDeltas(transfers: readonly LedgerTransferDraft[]): LedgerBalanceDelta[] {
  const byKey = new Map<string, LedgerBalanceDelta>();
  for (const transfer of transfers) {
    for (const entry of transfer.entries) {
      const key = `${entry.currency} ${entry.account}`;
      const current = byKey.get(key) ?? { account: entry.account, currency: entry.currency, deltaMinor: 0 };
      byKey.set(key, { ...current, deltaMinor: current.deltaMinor + entry.amountMinor });
    }
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, delta]) => delta);
}

export function assertUniqueReferences(transfers: readonly LedgerTransferDraft[]): void {
  const seen = new Set<string>();
  for (const transfer of transfers) {
    if (seen.has(transfer.reference)) {
      throw new LedgerError("duplicate_reference", `Reference ${transfer.reference} is used twice`);
    }
    seen.add(transfer.reference);
  }
}
```

- [ ] **Step 4: Run the tests and type check**

Run: `pnpm test packages/core/src/ledger && pnpm -F @jendal-workspace/core check-types`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ledger
git commit -m "feat(core): add ledger accounts and balanced transfer primitives" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 6: The posting builders

**Files:**
- Create: `packages/core/src/ledger/postings.ts`, `packages/core/src/testing/random.ts`
- Test: `packages/core/src/ledger/postings.test.ts`

One builder per event of services spec §6.3. The second describe block is property-style: 500 random cases per builder, and every output must balance per currency. The random generator is seeded (`testing/random.ts`), so failures reproduce exactly.

- [ ] **Step 1: Write the failing test**

`packages/core/src/ledger/postings.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { randomInt, seededRandom } from "../testing/random";
import {
  chargebackTransfer,
  completionTransfer,
  managementFeeCreditTransfer,
  paymentCapturedTransfer,
  payoutReleasedTransfer,
  payoutRequestedTransfer,
  payoutSucceededTransfer,
  penaltyAfterCompletionTransfer,
  refundConfirmedTransfer,
  refundRequestedTransfer,
} from "./postings";
import { isBalanced, type LedgerTransferDraft, transferSums } from "./transfers";

const base = { currency: "USD", projectId: "p1" } as const;
const payout = { currency: "USD", payoutRequestId: "po1", freelancerId: "f1" } as const;

describe("services spec §6.3 postings for the §5.3 example", () => {
  it("posts the $600 deposit to client money and team revenue", () => {
    expect(paymentCapturedTransfer({ ...base, paymentId: "pay1", quotePartMinor: 50_000, managementFeeMinor: 10_000 })).toEqual({
      kind: "payment_captured",
      reference: "payment_captured:pay1",
      projectId: "p1",
      entries: [
        { account: "paypal_clearing", currency: "USD", amountMinor: -60_000 },
        { account: "client_held:p1", currency: "USD", amountMinor: 50_000 },
        { account: "team_revenue", currency: "USD", amountMinor: 10_000 },
      ],
    });
  });

  it("splits the $850 final price into the team cut and the freelancer's earnings", () => {
    expect(completionTransfer({ ...base, freelancerId: "f1", finalPriceMinor: 85_000, teamCutBps: 1_500 }).entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -85_000 },
      { account: "team_revenue", currency: "USD", amountMinor: 12_750 },
      { account: "owed:f1:available", currency: "USD", amountMinor: 72_250 },
    ]);
  });

  it("moves the $30 fee credit of a decrease back to client money (§5.5)", () => {
    expect(managementFeeCreditTransfer({ ...base, amendmentId: "am1", creditMinor: 3_000 })).toEqual({
      kind: "management_fee_credit",
      reference: "management_fee_credit:am1",
      projectId: "p1",
      entries: [
        { account: "team_revenue", currency: "USD", amountMinor: -3_000 },
        { account: "client_held:p1", currency: "USD", amountMinor: 3_000 },
      ],
    });
  });

  it("refunds in two steps: requested, then confirmed by PayPal", () => {
    expect(refundRequestedTransfer({ ...base, refundId: "r1", quotePartMinor: 10_000, managementFeeMinor: 1_000 }).entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -10_000 },
      { account: "client_refunds", currency: "USD", amountMinor: 11_000 },
      { account: "team_revenue", currency: "USD", amountMinor: -1_000 },
    ]);
    expect(refundConfirmedTransfer({ ...base, refundId: "r1", amountMinor: 11_000 }).entries).toEqual([
      { account: "client_refunds", currency: "USD", amountMinor: -11_000 },
      { account: "paypal_clearing", currency: "USD", amountMinor: 11_000 },
    ]);
  });

  it("reserves, pays out and releases earnings", () => {
    expect(payoutRequestedTransfer({ ...payout, amountMinor: 72_250 }).entries).toEqual([
      { account: "owed:f1:available", currency: "USD", amountMinor: -72_250 },
      { account: "owed:f1:reserved", currency: "USD", amountMinor: 72_250 },
    ]);
    expect(payoutSucceededTransfer({ ...payout, amountMinor: 72_250 }).entries).toEqual([
      { account: "owed:f1:reserved", currency: "USD", amountMinor: -72_250 },
      { account: "paid_out:f1", currency: "USD", amountMinor: 72_250 },
    ]);
    expect(payoutReleasedTransfer({ ...payout, amountMinor: 72_250 }).entries).toEqual([
      { account: "owed:f1:reserved", currency: "USD", amountMinor: -72_250 },
      { account: "owed:f1:available", currency: "USD", amountMinor: 72_250 },
    ]);
  });

  it("moves a penalty after completion to the team or to client refunds", () => {
    const penalty = { ...base, caseId: "c1", freelancerId: "f1", amountMinor: 5_000 };
    expect(penaltyAfterCompletionTransfer({ ...penalty, destination: "team_revenue" }).entries).toEqual([
      { account: "owed:f1:available", currency: "USD", amountMinor: -5_000 },
      { account: "team_revenue", currency: "USD", amountMinor: 5_000 },
    ]);
    expect(penaltyAfterCompletionTransfer({ ...penalty, destination: "client_refunds" }).entries).toEqual([
      { account: "owed:f1:available", currency: "USD", amountMinor: -5_000 },
      { account: "client_refunds", currency: "USD", amountMinor: 5_000 },
    ]);
  });

  it("reverses a capture on a chargeback, or charges the team after completion", () => {
    const chargeback = { ...base, chargebackId: "cb1", quotePartMinor: 50_000, managementFeeMinor: 10_000 };
    expect(chargebackTransfer({ ...chargeback, projectCompleted: false }).entries).toEqual([
      { account: "client_held:p1", currency: "USD", amountMinor: -50_000 },
      { account: "paypal_clearing", currency: "USD", amountMinor: 60_000 },
      { account: "team_revenue", currency: "USD", amountMinor: -10_000 },
    ]);
    expect(chargebackTransfer({ ...chargeback, projectCompleted: true }).entries).toEqual([
      { account: "team_revenue", currency: "USD", amountMinor: -60_000 },
      { account: "paypal_clearing", currency: "USD", amountMinor: 60_000 },
    ]);
  });
});

describe("every posting builder balances (property-style, 500 random cases each)", () => {
  const random = seededRandom(20261006);
  const amount = () => randomInt(random, 1, 100_000_000);
  const maybeZero = () => (random() < 0.2 ? 0 : amount());
  const bps = () => randomInt(random, 0, 10_000);
  const currency = () => (random() < 0.5 ? "USD" : "EUR") as "USD" | "EUR";

  const builders: Record<string, () => LedgerTransferDraft> = {
    paymentCaptured: () =>
      paymentCapturedTransfer({ currency: currency(), projectId: "p1", paymentId: "x", quotePartMinor: amount(), managementFeeMinor: maybeZero() }),
    managementFeeCredit: () =>
      managementFeeCreditTransfer({ currency: currency(), projectId: "p1", amendmentId: "x", creditMinor: amount() }),
    completion: () =>
      completionTransfer({ currency: currency(), projectId: "p1", freelancerId: "f1", finalPriceMinor: amount(), teamCutBps: bps() }),
    refundRequested: () =>
      refundRequestedTransfer({ currency: currency(), projectId: "p1", refundId: "x", quotePartMinor: amount(), managementFeeMinor: maybeZero() }),
    refundConfirmed: () => refundConfirmedTransfer({ currency: currency(), projectId: "p1", refundId: "x", amountMinor: amount() }),
    payoutRequested: () => payoutRequestedTransfer({ ...payout, currency: currency(), amountMinor: amount() }),
    payoutSucceeded: () => payoutSucceededTransfer({ ...payout, currency: currency(), amountMinor: amount() }),
    payoutReleased: () => payoutReleasedTransfer({ ...payout, currency: currency(), amountMinor: amount() }),
    penaltyAfterCompletion: () =>
      penaltyAfterCompletionTransfer({
        currency: currency(),
        projectId: "p1",
        caseId: "x",
        freelancerId: "f1",
        amountMinor: amount(),
        destination: random() < 0.5 ? "team_revenue" : "client_refunds",
      }),
    chargeback: () =>
      chargebackTransfer({
        currency: currency(),
        projectId: "p1",
        chargebackId: "x",
        quotePartMinor: amount(),
        managementFeeMinor: maybeZero(),
        projectCompleted: random() < 0.5,
      }),
  };

  for (const [name, build] of Object.entries(builders)) {
    it(name, () => {
      for (let i = 0; i < 500; i++) {
        const transfer = build();
        expect(isBalanced(transfer)).toBe(true);
        for (const sum of transferSums(transfer).values()) expect(sum).toBe(0);
      }
    });
  }

  it("completion keeps team cut + earnings equal to the final price", () => {
    for (let i = 0; i < 500; i++) {
      const finalPriceMinor = amount();
      const transfer = completionTransfer({ ...base, freelancerId: "f1", finalPriceMinor, teamCutBps: bps() });
      expect(transfer.entries.find((e) => e.account === "client_held:p1")?.amountMinor).toBe(-finalPriceMinor);
    }
  });
});
```

`packages/core/src/testing/random.ts`:
```ts
// Seeded generator (mulberry32) so property-style tests are reproducible without a library.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/core/src/ledger/postings.test.ts`
Expected: FAIL, cannot resolve `./postings`.

- [ ] **Step 3: Implement**

`packages/core/src/ledger/postings.ts`:
```ts
import type { MoneyCurrency } from "../money/money";
import { freelancerEarningsMinor, teamCutMinor } from "../projects/pricing";
import { ledgerAccounts as a } from "./accounts";
import { type LedgerTransferDraft, transferFromMoves } from "./transfers";

// One builder per event of services spec §6.3. Each returns one balanced transfer.

type ProjectPosting = { currency: MoneyCurrency; projectId: string };

// Deposit, amendment top-up or balance captured.
export function paymentCapturedTransfer(
  input: ProjectPosting & { paymentId: string; quotePartMinor: number; managementFeeMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payment_captured",
    reference: `payment_captured:${input.paymentId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      { from: a.paypalClearing, to: a.clientHeld(input.projectId), amountMinor: input.quotePartMinor },
      { from: a.paypalClearing, to: a.teamRevenue, amountMinor: input.managementFeeMinor },
    ],
  });
}

// Amendment decrease: the overpaid management fee now counts toward the project's balance.
export function managementFeeCreditTransfer(
  input: ProjectPosting & { amendmentId: string; creditMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "management_fee_credit",
    reference: `management_fee_credit:${input.amendmentId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [{ from: a.teamRevenue, to: a.clientHeld(input.projectId), amountMinor: input.creditMinor }],
  });
}

// Completion: the team cut and the freelancer's earnings, both from the final price.
export function completionTransfer(
  input: ProjectPosting & { freelancerId: string; finalPriceMinor: number; teamCutBps: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "completion",
    reference: `completion:${input.projectId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      {
        from: a.clientHeld(input.projectId),
        to: a.teamRevenue,
        amountMinor: teamCutMinor(input.finalPriceMinor, input.teamCutBps),
      },
      {
        from: a.clientHeld(input.projectId),
        to: a.owedAvailable(input.freelancerId),
        amountMinor: freelancerEarningsMinor(input.finalPriceMinor, input.teamCutBps),
      },
    ],
  });
}

// Refund on completion or cancel, recorded when Payleor asks PayPal for it.
export function refundRequestedTransfer(
  input: ProjectPosting & { refundId: string; quotePartMinor: number; managementFeeMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "refund_requested",
    reference: `refund_requested:${input.refundId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      { from: a.clientHeld(input.projectId), to: a.clientRefunds, amountMinor: input.quotePartMinor },
      { from: a.teamRevenue, to: a.clientRefunds, amountMinor: input.managementFeeMinor },
    ],
  });
}

// PayPal confirmed the refund.
export function refundConfirmedTransfer(
  input: ProjectPosting & { refundId: string; amountMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "refund_confirmed",
    reference: `refund_confirmed:${input.refundId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [{ from: a.clientRefunds, to: a.paypalClearing, amountMinor: input.amountMinor }],
  });
}

type PayoutPosting = { currency: MoneyCurrency; payoutRequestId: string; freelancerId: string; amountMinor: number };

export function payoutRequestedTransfer(input: PayoutPosting): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payout_requested",
    reference: `payout_requested:${input.payoutRequestId}`,
    projectId: null,
    currency: input.currency,
    moves: [
      { from: a.owedAvailable(input.freelancerId), to: a.owedReserved(input.freelancerId), amountMinor: input.amountMinor },
    ],
  });
}

export function payoutSucceededTransfer(input: PayoutPosting): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payout_succeeded",
    reference: `payout_succeeded:${input.payoutRequestId}`,
    projectId: null,
    currency: input.currency,
    moves: [{ from: a.owedReserved(input.freelancerId), to: a.paidOut(input.freelancerId), amountMinor: input.amountMinor }],
  });
}

// Payout failed, returned, blocked or rejected: the reserved earnings become available again.
export function payoutReleasedTransfer(input: PayoutPosting): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payout_released",
    reference: `payout_released:${input.payoutRequestId}`,
    projectId: null,
    currency: input.currency,
    moves: [
      { from: a.owedReserved(input.freelancerId), to: a.owedAvailable(input.freelancerId), amountMinor: input.amountMinor },
    ],
  });
}

// Case outcome after completion: earnings move to the team, or to client refunds when the client is refunded.
export function penaltyAfterCompletionTransfer(
  input: ProjectPosting & {
    caseId: string;
    freelancerId: string;
    amountMinor: number;
    destination: "team_revenue" | "client_refunds";
  },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "penalty_after_completion",
    reference: `penalty_after_completion:${input.caseId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      {
        from: a.owedAvailable(input.freelancerId),
        to: input.destination === "team_revenue" ? a.teamRevenue : a.clientRefunds,
        amountMinor: input.amountMinor,
      },
    ],
  });
}

// Reverses a capture's entries. After completion the client money has already become the team cut and
// earnings, so team_revenue absorbs the whole amount; changing earnings needs a case outcome.
export function chargebackTransfer(
  input: ProjectPosting & {
    chargebackId: string;
    quotePartMinor: number;
    managementFeeMinor: number;
    projectCompleted: boolean;
  },
): LedgerTransferDraft {
  const moves = input.projectCompleted
    ? [{ from: a.teamRevenue, to: a.paypalClearing, amountMinor: input.quotePartMinor + input.managementFeeMinor }]
    : [
        { from: a.clientHeld(input.projectId), to: a.paypalClearing, amountMinor: input.quotePartMinor },
        { from: a.teamRevenue, to: a.paypalClearing, amountMinor: input.managementFeeMinor },
      ];
  return transferFromMoves({
    kind: "chargeback",
    reference: `chargeback:${input.chargebackId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves,
  });
}
```

- [ ] **Step 4: Run the test and type check**

Run: `pnpm test packages/core/src/ledger && pnpm -F @jendal-workspace/core check-types`
Expected: all pass, including the 500-case property tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ledger packages/core/src/testing
git commit -m "feat(core): add the ledger posting builders for every money event" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 7: The Ledger port and the in-memory ledger

**Files:**
- Create: `packages/core/src/ledger/ledger.ts`
- Test: `packages/core/src/ledger/ledger.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/ledger/ledger.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { createMemoryLedger } from "./ledger";
import { completionTransfer, paymentCapturedTransfer, payoutRequestedTransfer, refundRequestedTransfer } from "./postings";

const base = { currency: "USD", projectId: "p1" } as const;

describe("memory ledger", () => {
  it("runs the §5.3 example to the balances of §6.2", async () => {
    const ledger = createMemoryLedger();
    await ledger.post([paymentCapturedTransfer({ ...base, paymentId: "dep", quotePartMinor: 50_000, managementFeeMinor: 10_000 })]);
    await ledger.post([paymentCapturedTransfer({ ...base, paymentId: "bal", quotePartMinor: 35_000, managementFeeMinor: 0 })]);
    await ledger.post([completionTransfer({ ...base, freelancerId: "f1", finalPriceMinor: 85_000, teamCutBps: 1_500 })]);

    expect(await ledger.balance("client_held:p1", "USD")).toBe(0);
    expect(await ledger.balance("team_revenue", "USD")).toBe(22_750);
    expect(await ledger.balance("owed:f1:available", "USD")).toBe(72_250);
    expect(await ledger.balance("paypal_clearing", "USD")).toBe(-95_000);
  });

  it("refuses a payout above the available earnings and writes nothing", async () => {
    const ledger = createMemoryLedger();
    await ledger.post([paymentCapturedTransfer({ ...base, paymentId: "dep", quotePartMinor: 1_000, managementFeeMinor: 0 })]);
    await ledger.post([completionTransfer({ ...base, freelancerId: "f1", finalPriceMinor: 1_000, teamCutBps: 0 })]);

    await expect(
      ledger.post([payoutRequestedTransfer({ currency: "USD", payoutRequestId: "po1", freelancerId: "f1", amountMinor: 1_001 })]),
    ).rejects.toMatchObject({ code: "negative_balance" });
    expect(await ledger.balance("owed:f1:available", "USD")).toBe(1_000);
    expect(await ledger.balance("owed:f1:reserved", "USD")).toBe(0);
  });

  it("refuses to refund more client money than it holds", async () => {
    const ledger = createMemoryLedger();
    await expect(
      ledger.post([refundRequestedTransfer({ ...base, refundId: "r1", quotePartMinor: 1, managementFeeMinor: 0 })]),
    ).rejects.toMatchObject({ code: "negative_balance" });
  });

  it("posts a batch all or nothing and never twice", async () => {
    const ledger = createMemoryLedger();
    const deposit = paymentCapturedTransfer({ ...base, paymentId: "dep", quotePartMinor: 500, managementFeeMinor: 100 });
    const tooMuch = refundRequestedTransfer({ ...base, refundId: "r1", quotePartMinor: 501, managementFeeMinor: 0 });

    await expect(ledger.post([deposit, tooMuch])).rejects.toMatchObject({ code: "negative_balance" });
    expect(ledger.posted()).toEqual([]);

    await ledger.post([deposit]);
    await expect(ledger.post([deposit])).rejects.toMatchObject({ code: "duplicate_reference" });
    expect(ledger.posted()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/core/src/ledger/ledger.test.ts`
Expected: FAIL, cannot resolve `./ledger`.

- [ ] **Step 3: Implement**

`packages/core/src/ledger/ledger.ts`:
```ts
import type { MoneyCurrency } from "../money/money";
import { breaksLedgerInvariant, type LedgerAccountKey } from "./accounts";
import {
  assertBalanced,
  assertUniqueReferences,
  balanceDeltas,
  LedgerError,
  type LedgerTransferDraft,
} from "./transfers";

// The ledger of one team (services spec §6). Adapters post every transfer of a call or none of them.
export interface Ledger {
  // Rejects unbalanced transfers (`unbalanced`), a reference already posted (`duplicate_reference`) and any
  // balance that would break the §6.1 invariants (`negative_balance`), all with LedgerError, and posts
  // nothing. Both adapters behave identically. A caller that may retry a posting (S6's applyPayPalFact
  // consumer) treats `duplicate_reference` as "already applied" — that is the §6.4 at-most-once guarantee.
  post(transfers: readonly LedgerTransferDraft[]): Promise<void>;
  balance(account: LedgerAccountKey, currency: MoneyCurrency): Promise<number>;
}

// Checks a batch before an adapter writes it; shared by the memory and Postgres ledgers.
export function validateTransfers(transfers: readonly LedgerTransferDraft[]): void {
  for (const transfer of transfers) assertBalanced(transfer);
  assertUniqueReferences(transfers);
}

export function negativeBalanceError(account: LedgerAccountKey, currency: MoneyCurrency, balanceMinor: number) {
  return new LedgerError("negative_balance", `${account} (${currency}) would go to ${balanceMinor}`);
}

// In-memory ledger for core tests and for use cases tested without a database.
export function createMemoryLedger(): Ledger & { posted(): readonly LedgerTransferDraft[] } {
  const balances = new Map<string, number>();
  const posted: LedgerTransferDraft[] = [];
  const references = new Set<string>();
  const keyOf = (account: LedgerAccountKey, currency: MoneyCurrency) => `${currency} ${account}`;

  return {
    async post(transfers) {
      validateTransfers(transfers);
      for (const transfer of transfers) {
        if (references.has(transfer.reference)) {
          throw new LedgerError("duplicate_reference", `Reference ${transfer.reference} was already posted`);
        }
      }
      const next = balanceDeltas(transfers).map((delta) => ({
        ...delta,
        after: (balances.get(keyOf(delta.account, delta.currency)) ?? 0) + delta.deltaMinor,
      }));
      const broken = next.find((row) => breaksLedgerInvariant(row.account, row.after));
      if (broken) throw negativeBalanceError(broken.account, broken.currency, broken.after);
      for (const row of next) balances.set(keyOf(row.account, row.currency), row.after);
      for (const transfer of transfers) {
        posted.push(transfer);
        references.add(transfer.reference);
      }
    },
    async balance(account, currency) {
      return balances.get(keyOf(account, currency)) ?? 0;
    },
    posted: () => posted,
  };
}
```

Append to `packages/core/src/index.ts` (after whatever the current last export is):

```ts
export * from "./money/money";
export * from "./projects/pricing";
export * from "./projects/penalty";
export * from "./projects/amendments";
export * from "./projects/state-machine";
export * from "./ledger/accounts";
export * from "./ledger/transfers";
export * from "./ledger/postings";
export * from "./ledger/ledger";
```

- [ ] **Step 4: Run the full core suite and type check**

Run: `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types`
Expected: all pass; no type errors; no export name clashes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add the Ledger port and an in-memory ledger" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 8: Part A check and merge into main

**Files:** none (git only).

- [ ] **Step 1: Rebase onto main**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/s4-ledger-projects
git rebase main
```

Expected: clean, or a trivial append conflict in `packages/core/src/index.ts` (keep both blocks of exports). Part A added no migration, so §1.5 of the execution doc does not apply.

- [ ] **Step 2: Full check**

```bash
pnpm test && pnpm check-types
```

Expected: every test in the workspace passes; no type errors.

- [ ] **Step 3: Merge into main**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git merge --no-ff s4-ledger-projects -m "Merge branch 's4-ledger-projects': money math, project state machine and ledger postings (S4 part A)" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

The branch and worktree stay alive; Part B continues on them.

---

# Part B — database, use cases and web pages

Part B starts after S1 (`s1-services-teams`) has merged into `main`. It delivers contract §4.5 Part B: the tables, the Postgres ledger, the unit of work, the use cases, the tRPC router and the web pages.

## Task 9: Rebase onto main with S1 and verify the contract

**Files:** none (git and inspection only).

- [ ] **Step 1: Rebase**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/s4-ledger-projects
git rebase main
pnpm install --frozen-lockfile
pnpm test packages/core && pnpm -F @jendal-workspace/core check-types
```

Expected: clean rebase (or the trivial `packages/core/src/index.ts` append conflict; keep both); Part A tests still pass on the new baseline.

- [ ] **Step 2: Verify contract §4.2 exists**

```bash
ls packages/db/src/schema/services-teams.ts packages/db/src/repositories/services-teams.ts
grep -n "canServicesTeam\|ServicesTeamRole\|ServicesTeamSettings\|Currency" packages/core/src/index.ts packages/core/src/services-teams/*.ts
grep -n "product" packages/db/src/schema/organization.ts
```

Expected: the S1 schema, repository and core types exist, with the signatures this plan relies on (checked against S1's plan and code):

```ts
findServicesTeamBySlug(db, slug): Promise<ServicesTeamRecord | null>
getServicesTeamSettings(db, teamId): Promise<ServicesTeamSettings | null>
servicesTeamRoleFor(db, teamId, userId): Promise<ServicesTeamRole | null>  // "admin" for workspace owner/admin
```

`ServicesTeamSettings` carries `currency`, `teamCutBps`, `managementFeeBps` and `quotingMode: QuotingMode` (`"open" | "assigned" | "team"`); the use cases in Tasks 16–18 read exactly those fields. S1 also ships `packages/api/src/services-team-procedure.ts` with `ctx.servicesTeam` and `ctx.servicesTeamRole` — Tasks 16–18 build on it; this plan does not recreate it.

If S1 merged differently than its plan (names, settings fields, procedure ctx), adapt the call sites in Tasks 10–18 and record the difference under "Changes made during execution".

- [ ] **Step 3: Migrate the test database**

```bash
pnpm test packages/db
```

Expected: S1's migration applies and the existing db tests pass.

---

## Task 10: Core quote items, permissions and outbox event types

**Files:**
- Create: `packages/core/src/projects/quotes.ts`, `packages/core/src/projects/permissions.ts`, `packages/core/src/projects/events.ts`
- Test: `packages/core/src/projects/quotes.test.ts`, `packages/core/src/projects/permissions.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/projects/quotes.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { depositDue } from "./pricing";
import {
  amendmentProblemMessage,
  amendQuoteItems,
  paymentLines,
  type QuoteItem,
  quoteItemsProblem,
  quoteItemsProblemMessage,
  quoteTotalMinor,
} from "./quotes";

const design = { description: "Design", amountMinor: 40_000, extraDays: 0 };
const build = { description: "Build", amountMinor: 60_000, extraDays: 0 };
const base: QuoteItem[] = [
  { id: "i1", ...design },
  { id: "i2", ...build },
];

describe("quote items", () => {
  it("totals the lines", () => {
    expect(quoteTotalMinor(base)).toBe(100_000);
  });

  it("accepts valid lines and names the first problem otherwise", () => {
    expect(quoteItemsProblem([design])).toBeNull();
    expect(quoteItemsProblem([])).toBe("empty");
    expect(quoteItemsProblem(Array.from({ length: 21 }, () => design))).toBe("too_many");
    expect(quoteItemsProblem([{ ...design, description: "  " }])).toBe("description");
    expect(quoteItemsProblem([{ ...design, amountMinor: 0 }])).toBe("amount");
    expect(quoteItemsProblem([{ ...design, amountMinor: 10.5 }])).toBe("amount");
    expect(quoteItemsProblem([{ ...design, extraDays: -1 }])).toBe("extra_days");
    expect(quoteItemsProblem([{ ...design, amountMinor: 100_000_000_000 }, design])).toBe("total");
  });

  it("explains problems in plain words", () => {
    expect(quoteItemsProblemMessage("empty")).toBe("A quote needs at least one line.");
    expect(amendmentProblemMessage("empty")).toBe("An amendment cannot remove every line. Cancel the project instead.");
    expect(amendmentProblemMessage("no_change")).toBe("Add or remove at least one line.");
  });
});

describe("amendQuoteItems", () => {
  it("adds lines and extends the deadline by their extra days (§5.5 +$400)", () => {
    const result = amendQuoteItems(base, { add: [{ description: " Blog ", amountMinor: 40_000, extraDays: 3 }], removeItemIds: [] });
    expect(result).toEqual({
      ok: true,
      items: [design, build, { description: "Blog", amountMinor: 40_000, extraDays: 3 }],
      extraDays: 3,
    });
    if (result.ok) expect(quoteTotalMinor(result.items)).toBe(140_000);
  });

  it("removes lines without shortening the deadline", () => {
    expect(amendQuoteItems(base, { add: [], removeItemIds: ["i1"] })).toEqual({ ok: true, items: [build], extraDays: 0 });
  });

  it("rejects empty, unknown, repeated and whole-quote removals", () => {
    expect(amendQuoteItems(base, { add: [], removeItemIds: [] })).toEqual({ ok: false, problem: "no_change" });
    expect(amendQuoteItems(base, { add: [], removeItemIds: ["nope"] })).toEqual({ ok: false, problem: "unknown_item" });
    expect(amendQuoteItems(base, { add: [], removeItemIds: ["i1", "i1"] })).toEqual({ ok: false, problem: "unknown_item" });
    expect(amendQuoteItems(base, { add: [], removeItemIds: ["i1", "i2"] })).toEqual({ ok: false, problem: "empty" });
  });
});

describe("paymentLines", () => {
  it("shows the §5.3 deposit as two lines", () => {
    expect(paymentLines("deposit", depositDue(100_000, 1_000), 1_000)).toEqual([
      { kind: "deposit", label: "Deposit (50% of the quote)", amountMinor: 50_000 },
      { kind: "management_fee", label: "Management fee (10%)", amountMinor: 10_000 },
    ]);
  });

  it("labels top-ups and leaves out zero lines", () => {
    expect(paymentLines("top_up", { quotePartMinor: 20_000, managementFeeMinor: 0, totalMinor: 20_000 }, 1_250)).toEqual([
      { kind: "top_up", label: "Top-up (50% of the increase)", amountMinor: 20_000 },
    ]);
    expect(paymentLines("deposit", { quotePartMinor: 1, managementFeeMinor: 1, totalMinor: 2 }, 1_250)[1]?.label).toBe(
      "Management fee (12.5%)",
    );
  });
});
```

`packages/core/src/projects/permissions.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import {
  canAssignFreelancer,
  canProposeAmendment,
  canSeeProject,
  canStartProject,
  quoteAuthor,
  quoteAuthorRefusalMessage,
} from "./permissions";

describe("project permissions", () => {
  it("lets admins and managers start projects and assign freelancers (§4.1)", () => {
    expect([canStartProject("admin"), canStartProject("manager"), canStartProject("freelancer")]).toEqual([true, true, false]);
    expect([canAssignFreelancer("admin"), canAssignFreelancer("manager"), canAssignFreelancer("freelancer")]).toEqual([
      true,
      true,
      false,
    ]);
  });

  describe("quoteAuthor (§4.3 quoting modes)", () => {
    const base = { actorId: "u1", assignedFreelancerId: null };

    it("open: freelancers quote for themselves; staff name the freelancer", () => {
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "open" })).toEqual({ ok: true, freelancerId: "u1" });
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "open", freelancerId: "u2" })).toEqual({
        ok: false,
        reason: "not_allowed",
      });
      expect(quoteAuthor({ ...base, role: "manager", quotingMode: "open", freelancerId: "u2" })).toEqual({
        ok: true,
        freelancerId: "u2",
      });
      expect(quoteAuthor({ ...base, role: "admin", quotingMode: "open" })).toEqual({
        ok: false,
        reason: "freelancer_required",
      });
    });

    it("assigned: only the assigned freelancer quotes", () => {
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "assigned" })).toEqual({ ok: false, reason: "not_assigned" });
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "assigned", assignedFreelancerId: "u1" })).toEqual({
        ok: true,
        freelancerId: "u1",
      });
      expect(quoteAuthor({ ...base, role: "manager", quotingMode: "assigned", assignedFreelancerId: "u2" })).toEqual({
        ok: false,
        reason: "not_allowed",
      });
    });

    it("team: staff quote and name the freelancer", () => {
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "team" })).toEqual({ ok: false, reason: "not_allowed" });
      expect(quoteAuthor({ ...base, role: "manager", quotingMode: "team", freelancerId: "u2" })).toEqual({
        ok: true,
        freelancerId: "u2",
      });
      expect(quoteAuthor({ ...base, role: "manager", quotingMode: "team" })).toEqual({ ok: false, reason: "freelancer_required" });
    });

    it("explains refusals", () => {
      expect(quoteAuthorRefusalMessage("not_assigned")).toBe(
        "Assign a freelancer first; in this team the assigned freelancer quotes.",
      );
    });
  });

  it("lets the assigned freelancer or staff propose amendments (§5.5)", () => {
    expect(canProposeAmendment({ role: "freelancer", actorId: "u1", assignedFreelancerId: "u1" })).toBe(true);
    expect(canProposeAmendment({ role: "freelancer", actorId: "u2", assignedFreelancerId: "u1" })).toBe(false);
    expect(canProposeAmendment({ role: "manager", actorId: "u2", assignedFreelancerId: "u1" })).toBe(true);
  });

  it("shows freelancers their projects and open quoting projects", () => {
    const project = { assignedFreelancerId: "u1", status: "in_progress", quotingMode: "assigned" } as const;
    expect(canSeeProject({ ...project, role: "freelancer", actorId: "u1" })).toBe(true);
    expect(canSeeProject({ ...project, role: "freelancer", actorId: "u2" })).toBe(false);
    expect(canSeeProject({ ...project, role: "manager", actorId: "u2" })).toBe(true);
    expect(
      canSeeProject({ role: "freelancer", actorId: "u2", assignedFreelancerId: null, status: "quoting", quotingMode: "open" }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test packages/core/src/projects/quotes.test.ts packages/core/src/projects/permissions.test.ts`
Expected: FAIL, cannot resolve `./quotes` and `./permissions`.

- [ ] **Step 3: Implement**

`packages/core/src/projects/quotes.ts`:
```ts
import { assertBps, MAX_AMOUNT_MINOR } from "../money/money";
import type { PaymentSplit } from "./pricing";

export const QUOTE_STATUSES = ["proposed", "accepted", "superseded", "rejected"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const AMENDMENT_STATUSES = ["pending", "accepted", "declined"] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

export const PAYMENT_KINDS = ["deposit", "top_up", "balance"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ["pending", "captured", "failed", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type QuoteItemDraft = { description: string; amountMinor: number; extraDays: number };
export type QuoteItem = QuoteItemDraft & { id: string };

export const MAX_QUOTE_ITEMS = 20;
export const MAX_ITEM_DESCRIPTION = 200;
export const MAX_DAYS = 365;

export function quoteTotalMinor(items: readonly { amountMinor: number }[]): number {
  return items.reduce((sum, item) => sum + item.amountMinor, 0);
}

export type QuoteItemsProblem = "empty" | "too_many" | "description" | "amount" | "extra_days" | "total";

export function quoteItemsProblem(items: readonly QuoteItemDraft[]): QuoteItemsProblem | null {
  if (items.length === 0) return "empty";
  if (items.length > MAX_QUOTE_ITEMS) return "too_many";
  for (const item of items) {
    const description = item.description.trim();
    if (description.length === 0 || description.length > MAX_ITEM_DESCRIPTION) return "description";
    if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0 || item.amountMinor > MAX_AMOUNT_MINOR) {
      return "amount";
    }
    if (!Number.isSafeInteger(item.extraDays) || item.extraDays < 0 || item.extraDays > MAX_DAYS) return "extra_days";
  }
  return quoteTotalMinor(items) > MAX_AMOUNT_MINOR ? "total" : null;
}

export function quoteItemsProblemMessage(problem: QuoteItemsProblem): string {
  switch (problem) {
    case "empty":
      return "A quote needs at least one line.";
    case "too_many":
      return `A quote can have at most ${MAX_QUOTE_ITEMS} lines.`;
    case "description":
      return `Describe each line in 1 to ${MAX_ITEM_DESCRIPTION} characters.`;
    case "amount":
      return "Each line needs an amount above zero.";
    case "extra_days":
      return `Extra days must be a whole number from 0 to ${MAX_DAYS}.`;
    case "total":
      return "The quote total is too large.";
  }
}

export type AmendmentChange = { add: readonly QuoteItemDraft[]; removeItemIds: readonly string[] };

export type AmendedItems =
  | { ok: true; items: QuoteItemDraft[]; extraDays: number }
  | { ok: false; problem: "no_change" | "unknown_item" | QuoteItemsProblem };

// Services spec §5.5: an amendment adds or removes line items of the current quote version.
// Removing items does not shorten the deadline; added items extend it by their extra days.
export function amendQuoteItems(base: readonly QuoteItem[], change: AmendmentChange): AmendedItems {
  if (change.add.length === 0 && change.removeItemIds.length === 0) return { ok: false, problem: "no_change" };
  const removed = new Set(change.removeItemIds);
  if (removed.size !== change.removeItemIds.length) return { ok: false, problem: "unknown_item" };
  const baseIds = new Set(base.map((item) => item.id));
  if ([...removed].some((id) => !baseIds.has(id))) return { ok: false, problem: "unknown_item" };
  const items = [
    ...base
      .filter((item) => !removed.has(item.id))
      .map(({ description, amountMinor, extraDays }) => ({ description, amountMinor, extraDays })),
    ...change.add.map((item) => ({ ...item, description: item.description.trim() })),
  ];
  const problem = quoteItemsProblem(items);
  if (problem) return { ok: false, problem };
  return { ok: true, items, extraDays: change.add.reduce((sum, item) => sum + item.extraDays, 0) };
}

export function amendmentProblemMessage(problem: "no_change" | "unknown_item" | QuoteItemsProblem): string {
  if (problem === "no_change") return "Add or remove at least one line.";
  if (problem === "unknown_item") return "One of the lines to remove is not on the current quote.";
  if (problem === "empty") return "An amendment cannot remove every line. Cancel the project instead.";
  return quoteItemsProblemMessage(problem);
}

export type PaymentLineKind = PaymentKind | "management_fee";
export type PaymentLine = { kind: PaymentLineKind; label: string; amountMinor: number };

const QUOTE_PART_LABELS: Record<PaymentKind, string> = {
  deposit: "Deposit (50% of the quote)",
  top_up: "Top-up (50% of the increase)",
  balance: "Balance",
};

// The lines shown on the client page and the pay page; zero lines are left out.
export function paymentLines(kind: PaymentKind, split: PaymentSplit, managementFeeBps: number): PaymentLine[] {
  assertBps(managementFeeBps, "management fee");
  const lines: PaymentLine[] = [
    { kind, label: QUOTE_PART_LABELS[kind], amountMinor: split.quotePartMinor },
    { kind: "management_fee", label: `Management fee (${managementFeeBps / 100}%)`, amountMinor: split.managementFeeMinor },
  ];
  return lines.filter((line) => line.amountMinor > 0);
}
```

`packages/core/src/projects/permissions.ts`:
```ts
import type { QuotingMode } from "../services-teams/types";
import type { ServicesTeamRole } from "../services-teams/types";
import type { ProjectStatus } from "./state-machine";

// Same values as the services team setting `quoting_mode` (services spec §4.3).

export function isProjectStaff(role: ServicesTeamRole): boolean {
  return role === "admin" || role === "manager";
}

// Services spec §4.1: managers (and admins) start projects and assign freelancers.
export function canStartProject(role: ServicesTeamRole): boolean {
  return isProjectStaff(role);
}

export function canAssignFreelancer(role: ServicesTeamRole): boolean {
  return isProjectStaff(role);
}

export type QuoteAuthorRefusal = "not_allowed" | "not_assigned" | "freelancer_required";
export type QuoteAuthorResult = { ok: true; freelancerId: string } | { ok: false; reason: QuoteAuthorRefusal };

// Services spec §4.3: in `open` any freelancer quotes for their own work and staff quote for a named
// freelancer; in `assigned` only the assigned freelancer quotes; in `team` staff quote, naming the freelancer.
export function quoteAuthor(input: {
  role: ServicesTeamRole;
  actorId: string;
  quotingMode: QuotingMode;
  assignedFreelancerId: string | null;
  freelancerId?: string | null;
}): QuoteAuthorResult {
  const staff = isProjectStaff(input.role);
  const named = input.freelancerId ?? null;
  switch (input.quotingMode) {
    case "open":
      if (!staff) {
        return named === null || named === input.actorId
          ? { ok: true, freelancerId: input.actorId }
          : { ok: false, reason: "not_allowed" };
      }
      return named ? { ok: true, freelancerId: named } : { ok: false, reason: "freelancer_required" };
    case "assigned":
      if (!input.assignedFreelancerId) return { ok: false, reason: "not_assigned" };
      return input.actorId === input.assignedFreelancerId
        ? { ok: true, freelancerId: input.assignedFreelancerId }
        : { ok: false, reason: "not_allowed" };
    case "team":
      if (!staff) return { ok: false, reason: "not_allowed" };
      return named ? { ok: true, freelancerId: named } : { ok: false, reason: "freelancer_required" };
  }
}

export function quoteAuthorRefusalMessage(reason: QuoteAuthorRefusal): string {
  switch (reason) {
    case "not_allowed":
      return "Your role cannot quote on this project in this team's quoting mode.";
    case "not_assigned":
      return "Assign a freelancer first; in this team the assigned freelancer quotes.";
    case "freelancer_required":
      return "Choose the freelancer who will do the work.";
  }
}

// Services spec §5.5: the assigned freelancer or a manager proposes amendments.
export function canProposeAmendment(input: {
  role: ServicesTeamRole;
  actorId: string;
  assignedFreelancerId: string | null;
}): boolean {
  return isProjectStaff(input.role) || input.actorId === input.assignedFreelancerId;
}

// Freelancers see the projects assigned to them, and quoting projects when anyone in the team may quote.
export function canSeeProject(input: {
  role: ServicesTeamRole;
  actorId: string;
  assignedFreelancerId: string | null;
  status: ProjectStatus;
  quotingMode: QuotingMode;
}): boolean {
  if (isProjectStaff(input.role) || input.actorId === input.assignedFreelancerId) return true;
  return input.quotingMode === "open" && input.status === "quoting";
}
```

`packages/core/src/projects/events.ts`:
```ts
// Services spec §6.6, plus `project.assigned` (an assignment is a committed change the team's bot shows).
export const OUTBOX_EVENT_TYPES = [
  "project.created",
  "project.assigned",
  "quote.created",
  "quote.accepted",
  "amendment.proposed",
  "amendment.accepted",
  "amendment.declined",
  "payment.created",
  "payment.captured",
  "payment.failed",
  "delivery.submitted",
  "delivery.accepted",
  "project.completed",
  "project.cancelled",
  "payout.requested",
  "payout.approved",
  "payout.queued",
  "payout.sent",
  "payout.failed",
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];
```

Append to `packages/core/src/index.ts`:

```ts
export * from "./projects/quotes";
export * from "./projects/permissions";
export * from "./projects/events";
```

(`ServicesTeamRole`, `ServicesTeamSettings`, `Currency`, `QuotingMode` and `canServicesTeam` come from S1; `permissions.ts` imports `QuotingMode` from S1's `services-teams/types`, and none of S1's types are redefined here.)

- [ ] **Step 4: Run the tests and type check**

Run: `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add quote items, amendment shapes, project permissions and outbox event types" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 11: Schema, migration and test seeds

**Files:**
- Create: `packages/db/src/schema/projects.ts`, `packages/db/src/schema/ledger.ts`, `packages/db/src/schema/outbox.ts`, `packages/db/src/executor.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/testing/db.ts`
- Generate: `packages/db/src/migrations/<timestamp>_s4_ledger_projects/`

Design notes behind the schema (these are decisions, listed again at the end):

- Money columns are `bigint` with `{ mode: "number" }` — integer minor units, bounded by `MAX_AMOUNT_MINOR` in core, always exact.
- `ledger_transfer` and `ledger_entry` are append-only: no cascade deletes point into them, and a trigger (added to the migration below) rejects UPDATE and DELETE (services spec §6.1 point 3). `team` deletions are blocked by `restrict` foreign keys on the money tables; only `outbox` and `quote`/`amendment` rows cascade with their project/team.
- One accepted quote per project and one pending amendment per project are partial unique indexes, so the guarantees hold even under a bug in a use case.
- `project` snapshots the team's currency and rates at creation, so later settings changes never rewrite a running project's math.
- `amendment.management_fee_credit_minor` is set when a decrease is accepted; `getProjectFacts` sums it for `balanceDue`.

- [ ] **Step 1: Write the schema**

`packages/db/src/schema/projects.ts`:
```ts
import {
  AMENDMENT_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_STATUSES,
  type PaymentLine,
  PROJECT_STATUSES,
  QUOTE_STATUSES,
  type QuoteItemDraft,
} from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";

const CURRENCIES = ["USD", "EUR"] as const;

// Money columns are bigint minor units read as JS numbers; MAX_AMOUNT_MINOR keeps them exact.
const minor = (name: string) => bigint(name, { mode: "number" });

// Services spec §5. Teams with projects cannot be deleted: their money history must stay.
export const project = pgTable(
  "project",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    brief: text("brief").notNull().default(""),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("quoting"),
    // Compare-and-set token: every change bumps it (services spec §6.1).
    version: integer("version").notNull().default(0),
    clientEmail: text("client_email"),
    clientDiscordId: text("client_discord_id"),
    channelId: text("channel_id"),
    assignedFreelancerId: text("assigned_freelancer_id").references(() => user.id, { onDelete: "set null" }),
    // Copied from the team settings when the project starts, so later settings changes leave it alone.
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    managementFeeBps: integer("management_fee_bps").notNull(),
    teamCutBps: integer("team_cut_bps").notNull(),
    revisions: integer("revisions").notNull().default(0),
    deadlineAt: timestamp("deadline_at"),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("project_teamId_idx").on(t.teamId),
    check("project_client_check", sql`client_email is not null or client_discord_id is not null`),
  ],
);

export const quote = pgTable(
  "quote",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    // 1 for proposals; each accepted amendment adds a version (services spec §5.5).
    version: integer("version").notNull().default(1),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("proposed"),
    freelancerId: text("freelancer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    amountMinor: minor("amount_minor").notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    previousQuoteId: text("previous_quote_id"),
    amendmentId: text("amendment_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at"),
  },
  (t) => [
    index("quote_projectId_idx").on(t.projectId),
    // The accepted quote is the current version; there is at most one.
    uniqueIndex("quote_current_idx").on(t.projectId).where(sql`status = 'accepted'`),
    check("quote_amount_check", sql`amount_minor > 0`),
    check("quote_delivery_days_check", sql`delivery_days >= 0`),
  ],
);

export const quoteItem = pgTable(
  "quote_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    extraDays: integer("extra_days").notNull().default(0),
  },
  (t) => [
    unique("quote_item_position_unique").on(t.quoteId, t.position),
    check("quote_item_amount_check", sql`amount_minor > 0`),
    check("quote_item_extra_days_check", sql`extra_days >= 0`),
  ],
);

export const amendment = pgTable(
  "amendment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    baseQuoteId: text("base_quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "restrict" }),
    status: text("status", { enum: AMENDMENT_STATUSES }).notNull().default("pending"),
    proposedById: text("proposed_by_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    addItems: jsonb("add_items").$type<QuoteItemDraft[]>().notNull(),
    removeItemIds: jsonb("remove_item_ids").$type<string[]>().notNull(),
    deltaMinor: minor("delta_minor").notNull(),
    // Set when a decrease is accepted: the management fee moved back to client_held (services spec §6.3).
    managementFeeCreditMinor: minor("management_fee_credit_minor").notNull().default(0),
    newAmountMinor: minor("new_amount_minor").notNull(),
    extraDays: integer("extra_days").notNull().default(0),
    resultingQuoteId: text("resulting_quote_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [
    index("amendment_projectId_idx").on(t.projectId),
    uniqueIndex("amendment_pending_idx").on(t.projectId).where(sql`status = 'pending'`),
    check("amendment_new_amount_check", sql`new_amount_minor > 0`),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: PAYMENT_KINDS }).notNull(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("pending"),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    // The ledger posts these two parts to different accounts (services spec §6.3).
    quotePartMinor: minor("quote_part_minor").notNull(),
    managementFeeMinor: minor("management_fee_minor").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    lines: jsonb("lines").$type<PaymentLine[]>().notNull(),
    amendmentId: text("amendment_id").references(() => amendment.id, { onDelete: "restrict" }),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    capturedAt: timestamp("captured_at"),
  },
  (t) => [
    index("payment_projectId_idx").on(t.projectId),
    uniqueIndex("payment_deposit_idx").on(t.projectId).where(sql`kind = 'deposit'`),
    uniqueIndex("payment_balance_idx").on(t.projectId).where(sql`kind = 'balance'`),
    check("payment_parts_check", sql`quote_part_minor >= 0 and management_fee_minor >= 0`),
    check("payment_amount_check", sql`amount_minor > 0 and amount_minor = quote_part_minor + management_fee_minor`),
  ],
);
```

`packages/db/src/schema/ledger.ts`:
```ts
import { LEDGER_TRANSFER_KINDS } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

import { team } from "./organization";
import { project } from "./projects";

const CURRENCIES = ["USD", "EUR"] as const;

// Services spec §6. ledger_transfer and ledger_entry are append-only: a trigger added in the
// s4_ledger_projects migration rejects UPDATE and DELETE. No foreign key cascades into them.
export const ledgerTransfer = pgTable(
  "ledger_transfer",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    kind: text("kind", { enum: LEDGER_TRANSFER_KINDS }).notNull(),
    reference: text("reference").notNull(),
    projectId: text("project_id").references(() => project.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_transfer_reference_unique").on(t.teamId, t.reference),
    index("ledger_transfer_projectId_idx").on(t.projectId),
  ],
);

export const ledgerEntry = pgTable(
  "ledger_entry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    transferId: text("transfer_id")
      .notNull()
      .references(() => ledgerTransfer.id),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    account: text("account").notNull(),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entry_account_idx").on(t.teamId, t.account, t.currency),
    index("ledger_entry_transferId_idx").on(t.transferId),
    check("ledger_entry_amount_check", sql`amount_minor <> 0`),
  ],
);

// One row per account: the running balance the adapter locks (SELECT … FOR UPDATE) to check invariants.
// The check mirrors breaksLedgerInvariant in core as a last line of defence.
export const ledgerBalance = pgTable(
  "ledger_balance",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    account: text("account").notNull(),
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    balanceMinor: bigint("balance_minor", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "ledger_balance_pk", columns: [t.teamId, t.account, t.currency] }),
    check(
      "ledger_balance_non_negative_check",
      sql`balance_minor >= 0 or not (starts_with(account, 'client_held:') or starts_with(account, 'owed:') or starts_with(account, 'paid_out:') or account = 'client_refunds')`,
    ),
  ],
);
```

`packages/db/src/schema/outbox.ts`:
```ts
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { team } from "./organization";
import { project } from "./projects";

// Services spec §6.6: events written in the same transaction as the change they describe.
export const outbox = pgTable(
  "outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    // Per project, from 1, with no gaps; subscribers order by it.
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex("outbox_project_sequence_idx").on(t.projectId, t.sequence),
    index("outbox_teamId_createdAt_idx").on(t.teamId, t.createdAt),
  ],
);
```

`packages/db/src/executor.ts`:
```ts
import type { AnyRelations } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

import type { relations } from "./relations";

// A Database or a transaction handle: PgAsyncTransaction extends PgAsyncDatabase (drizzle-orm
// pg-core/async/session.ts), so every query written against this type runs in both.
export type DbExecutor = PgAsyncDatabase<PostgresJsQueryResultHKT, AnyRelations>;
export type Transaction = Parameters<Parameters<DbExecutor["transaction"]>[0]>[0];
export type ProjectRelations = typeof relations;
```

Append to `packages/db/src/schema/index.ts`:

```ts
export * from "./projects";
export * from "./ledger";
export * from "./outbox";
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name s4_ledger_projects`
Expected: a new folder `packages/db/src/migrations/<timestamp>_s4_ledger_projects/` whose `migration.sql` creates `project`, `quote`, `quote_item`, `amendment`, `payment`, `ledger_transfer`, `ledger_entry`, `ledger_balance` and `outbox` with the foreign keys, partial unique indexes (`quote_current_idx`, `amendment_pending_idx`, `payment_deposit_idx`, `payment_balance_idx`) and check constraints from the schema. Read the SQL; it must contain no `DROP` and no changes to S1's tables.

- [ ] **Step 3: Append the immutability trigger**

Append to the generated `migration.sql` (Fact 14 makes this safe before the migration is first applied):

```sql
--> statement-breakpoint
CREATE FUNCTION "ledger_rows_are_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: ledger rows are immutable', TG_OP, TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_transfer_immutable" BEFORE UPDATE OR DELETE ON "ledger_transfer" FOR EACH ROW EXECUTE FUNCTION "ledger_rows_are_immutable"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entry_immutable" BEFORE UPDATE OR DELETE ON "ledger_entry" FOR EACH ROW EXECUTE FUNCTION "ledger_rows_are_immutable"();
```

- [ ] **Step 4: Truncate the new tables and add seeds**

In `packages/db/src/testing/db.ts`, add `project` from `../schema/projects` to the schema imports (`member`, `servicesTeamMember` and `servicesTeamSettings` are already imported by S1's helpers).

Make the truncate list (merging with whatever S1 added — keep every table):

```ts
      'truncate table "outbox", "ledger_balance", "ledger_entry", "ledger_transfer", "payment", "amendment", "quote_item", "quote", "project", "services_team_settings", "services_team_member", "rate_limit", "store_domains", "team_member", "team", "invitation", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
```

S1 already ships `seedServicesTeam(db, { organizationId, slug, name?, withSettings? })` (team row plus default settings, no members) and `seedOrganization(db)` (workspace with an owner). S4's helpers build on them and are named so they cannot clash:

```ts
// A services team with its workspace and an owner, whose servicesTeamRoleFor is "admin"
// (S1's effectiveServicesTeamRole maps workspace owner/admin to "admin").
export async function seedServicesTeamWithAdmin(
  db: Database,
  options: { slug?: string } = {},
): Promise<{ userId: string; organizationId: string; teamId: string }> {
  const { userId, organizationId } = await seedOrganization(db);
  const teamRow = await seedServicesTeam(db, { organizationId, slug: options.slug ?? "team" });
  return { userId, organizationId, teamId: teamRow.id };
}

// Adds a freelancer or manager: the workspace member row (role "member") that S1's
// servicesTeamRoleFor inner-joins, plus the services_team_member row that carries the role.
export async function seedServicesTeamMember(
  db: Database,
  input: { organizationId: string; teamId: string; role: "manager" | "freelancer"; name?: string },
): Promise<string> {
  const userId = await seedUser(db, input.name ?? input.role);
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    userId,
    role: "member",
    createdAt: new Date(),
  });
  await db.insert(servicesTeamMember).values({
    id: crypto.randomUUID(),
    teamId: input.teamId,
    userId,
    role: input.role,
    createdAt: new Date(),
  });
  return userId;
}

export async function seedProject(
  db: Database,
  input: { teamId: string; title?: string; clientEmail?: string },
): Promise<string> {
  const [row] = await db
    .insert(project)
    .values({
      teamId: input.teamId,
      title: input.title ?? "Website",
      clientEmail: input.clientEmail ?? "client@example.com",
      currency: "USD",
      managementFeeBps: 1_000,
      teamCutBps: 1_500,
    })
    .returning({ id: project.id });
  if (!row) throw new Error("Insert into project returned no row");
  return row.id;
}
```

- [ ] **Step 5: Run the db tests**

Run: `pnpm test packages/db`
Expected: all pass; the global setup re-creates the test database from all migrations, including the trigger.

The dev database is migrated once, in Task 22, after any regeneration (execution doc §1.5; S1 Task 17 does the same).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src
git commit -m "feat(db): add project, quote, payment, ledger and outbox tables" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 12: The Postgres ledger adapter

**Files:**
- Create: `packages/db/src/repositories/ledger.ts`
- Test: `packages/db/src/repositories/ledger.test.ts`

The adapter implements the core `Ledger` port over the caller's transaction, with exactly the memory ledger's behaviour: a reference the team already posted is **rejected** with `LedgerError("duplicate_reference")`, not skipped — the posting builders key every transfer by reference, so a duplicate is a bug, and a retrying caller (S6's `applyPayPalFact` consumer) treats `duplicate_reference` as "already applied" (services spec §6.4, at most once). Invariants are enforced twice: `breaksLedgerInvariant` before writing and the `ledger_balance` check constraint as the last line of defence. Each balance row is first created with `insert … on conflict do nothing` and then read with `select … for update`, in the fixed sorted order `balanceDeltas` returns, so the row always exists to lock and two postings touching the same accounts lock in the same order and cannot deadlock.

- [ ] **Step 1: Write the failing test**

`packages/db/src/repositories/ledger.test.ts`:
```ts
import { paymentCapturedTransfer, payoutRequestedTransfer, completionTransfer } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "../testing/db";
import { ledgerBalance, ledgerEntry, ledgerTransfer } from "../schema/ledger";
import { createPostgresLedger, ledgerBalancesFromEntries } from "./ledger";

describe.skipIf(!hasTestDatabase)("postgres ledger", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("posts a transfer, its entries and the account balances", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    await db.transaction(async (tx) => {
      await createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 50_000, managementFeeMinor: 10_000 }),
      ]);
    });

    const transfers = await db.select().from(ledgerTransfer);
    expect(transfers).toEqual([
      expect.objectContaining({ teamId, kind: "payment_captured", reference: "payment_captured:pay1", projectId }),
    ]);
    const entries = await db.select().from(ledgerEntry);
    expect(entries).toHaveLength(3);
    expect(entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
    const balances = await db.select().from(ledgerBalance);
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: `client_held:${projectId}`, balanceMinor: 50_000 }),
        expect.objectContaining({ account: "team_revenue", balanceMinor: 10_000 }),
        expect.objectContaining({ account: "paypal_clearing", balanceMinor: -60_000 }),
      ]),
    );
    await db.transaction(async (tx) => {
      expect(await ledgerBalancesFromEntries(tx, teamId)).toEqual(
        (await tx.select().from(ledgerBalance)).map((b) => ({
          account: b.account,
          currency: b.currency,
          balanceMinor: b.balanceMinor,
        })),
      );
    });
  });

  it("rejects a reference the team already posted, like the memory ledger", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const transfer = paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 100, managementFeeMinor: 0 });

    await db.transaction((tx) => createPostgresLedger(teamId, tx).post([transfer]));
    await expect(db.transaction((tx) => createPostgresLedger(teamId, tx).post([transfer]))).rejects.toMatchObject({
      name: "LedgerError",
      code: "duplicate_reference",
    });

    // Nothing doubled: the balance still reflects the first posting only.
    expect(await db.select().from(ledgerTransfer)).toHaveLength(1);
    await db.transaction(async (tx) => {
      expect(await createPostgresLedger(teamId, tx).balance(`client_held:${projectId}`, "USD")).toBe(100);
    });
  });

  it("refuses earnings below zero and rolls the transfer back", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    await expect(
      db.transaction((tx) =>
        createPostgresLedger(teamId, tx).post([
          payoutRequestedTransfer({ currency: "USD", payoutRequestId: "po1", freelancerId: "f1", amountMinor: 5 }),
        ]),
      ),
    ).rejects.toMatchObject({ code: "negative_balance" });
    expect(await db.select().from(ledgerTransfer)).toHaveLength(0);
    expect(await db.select().from(ledgerBalance)).toHaveLength(0);
  });

  it("rejects updates and deletes of ledger rows", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    await db.transaction((tx) =>
      createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 100, managementFeeMinor: 0 }),
      ]),
    );
    // drizzle wraps Postgres errors; the trigger message is on the cause.
    const updated = await db.execute(sql`update ledger_entry set amount_minor = 1`).then(
      () => null,
      (error: unknown) => error,
    );
    const deleted = await db.execute(sql`delete from ledger_transfer`).then(
      () => null,
      (error: unknown) => error,
    );
    for (const error of [updated, deleted]) {
      expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(/immutable/);
    }
    // The failed statements rolled back; the rows are unchanged.
    expect(await db.select().from(ledgerEntry)).toHaveLength(2);
  });

  it("serializes concurrent posts to the same account", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    await db.transaction((tx) =>
      createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 100, managementFeeMinor: 0 }),
        completionTransfer({ currency: "USD", projectId, freelancerId: "f1", finalPriceMinor: 100, teamCutBps: 0 }),
      ]),
    );

    // Two connections race to reserve 60 of the 100 available; exactly one may succeed.
    const reserve = () =>
      createTestDb().transaction((tx) =>
        createPostgresLedger(teamId, tx).post([
          payoutRequestedTransfer({ currency: "USD", payoutRequestId: `po-${crypto.randomUUID()}`, freelancerId: "f1", amountMinor: 60 }),
        ]),
      );
    const results = await Promise.allSettled([reserve(), reserve()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await db.transaction(async (tx) => {
      expect(await createPostgresLedger(teamId, tx).balance("owed:f1:available", "USD")).toBe(40);
      expect(await createPostgresLedger(teamId, tx).balance("owed:f1:reserved", "USD")).toBe(60);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/db/src/repositories/ledger.test.ts`
Expected: FAIL, cannot resolve `./ledger`.

- [ ] **Step 3: Implement**

`packages/db/src/repositories/ledger.ts`:
```ts
import {
  balanceDeltas,
  breaksLedgerInvariant,
  LedgerError,
  negativeBalanceError,
  validateTransfers,
  type Ledger,
  type LedgerAccountKey,
} from "@jendal-workspace/core";
import { and, asc, eq, sql } from "drizzle-orm";

import { ledgerBalance, ledgerEntry, ledgerTransfer } from "../schema/ledger";
import type { Transaction } from "../executor";

// The Postgres adapter of the Ledger port. post() must run inside a transaction (it uses
// SELECT … FOR UPDATE); runInTransaction is the caller.
export function createPostgresLedger(teamId: string, tx: Transaction): Ledger {
  return {
    async post(transfers) {
      validateTransfers(transfers);

      // Like the memory ledger, a reference this team already posted is rejected, not skipped:
      // the posting builders key every transfer by reference, so a duplicate is a bug. Retrying
      // callers (S6's applyPayPalFact) catch duplicate_reference as "already applied".
      for (const transfer of transfers) {
        const [existing] = await tx
          .select({ id: ledgerTransfer.id })
          .from(ledgerTransfer)
          .where(and(eq(ledgerTransfer.teamId, teamId), eq(ledgerTransfer.reference, transfer.reference)))
          .limit(1);
        if (existing) throw new LedgerError("duplicate_reference", `Reference ${transfer.reference} was already posted`);
      }

      const deltas = balanceDeltas(transfers);
      // Lock the balance rows in the fixed order balanceDeltas returns, so two transactions
      // touching the same accounts lock in the same order and cannot deadlock. The insert makes
      // sure the row exists before it is locked; on conflict the concurrent insert wins and this
      // transaction's lock read sees it.
      const after = new Map<string, number>();
      for (const delta of deltas) {
        await tx
          .insert(ledgerBalance)
          .values({ teamId, account: delta.account, currency: delta.currency, balanceMinor: 0 })
          .onConflictDoNothing();
        const [row] = await tx
          .select({ balanceMinor: ledgerBalance.balanceMinor })
          .from(ledgerBalance)
          .where(
            and(
              eq(ledgerBalance.teamId, teamId),
              eq(ledgerBalance.account, delta.account),
              eq(ledgerBalance.currency, delta.currency),
            ),
          )
          .for("update")
          .limit(1);
        const balanceMinor = (row?.balanceMinor ?? 0) + delta.deltaMinor;
        if (breaksLedgerInvariant(delta.account, balanceMinor)) {
          throw negativeBalanceError(delta.account, delta.currency, balanceMinor);
        }
        after.set(`${delta.currency} ${delta.account}`, balanceMinor);
      }

      for (const transfer of transfers) {
        const [row] = await tx
          .insert(ledgerTransfer)
          .values({ teamId, kind: transfer.kind, reference: transfer.reference, projectId: transfer.projectId })
          .returning({ id: ledgerTransfer.id });
        if (!row) throw new Error("Insert into ledger_transfer returned no row");
        await tx.insert(ledgerEntry).values(
          transfer.entries.map((entry) => ({
            transferId: row.id,
            teamId,
            account: entry.account,
            currency: entry.currency,
            amountMinor: entry.amountMinor,
          })),
        );
      }

      for (const delta of deltas) {
        await tx
          .update(ledgerBalance)
          .set({ balanceMinor: after.get(`${delta.currency} ${delta.account}`) ?? 0, updatedAt: new Date() })
          .where(
            and(
              eq(ledgerBalance.teamId, teamId),
              eq(ledgerBalance.account, delta.account),
              eq(ledgerBalance.currency, delta.currency),
            ),
          );
      }
    },
    async balance(account: LedgerAccountKey, currency) {
      const [row] = await tx
        .select({ balanceMinor: ledgerBalance.balanceMinor })
        .from(ledgerBalance)
        .where(
          and(eq(ledgerBalance.teamId, teamId), eq(ledgerBalance.account, account), eq(ledgerBalance.currency, currency)),
        )
        .limit(1);
      return row?.balanceMinor ?? 0;
    },
  };
}

export type LedgerBalanceRow = { account: string; currency: string; balanceMinor: number };

// Sums from ledger_entry, to compare with ledger_balance in reconciliation tests.
export async function ledgerBalancesFromEntries(tx: Transaction, teamId: string): Promise<LedgerBalanceRow[]> {
  return tx
    .select({
      account: ledgerEntry.account,
      currency: ledgerEntry.currency,
      balanceMinor: sql<number>`sum(${ledgerEntry.amountMinor})`.mapWith(Number),
    })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.teamId, teamId))
    .groupBy(ledgerEntry.account, ledgerEntry.currency)
    .orderBy(asc(ledgerEntry.account));
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test packages/db/src/repositories/ledger.test.ts`
Expected: 5 tests pass. The concurrency test opens a second connection (Fact 19); exactly one of the two racing reservations succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/ledger.ts packages/db/src/repositories/ledger.test.ts
git commit -m "feat(db): add the Postgres ledger adapter with locked balance rows" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 13: The project unit of work

**Files:**
- Create: `packages/db/src/repositories/unit-of-work.ts`
- Test: `packages/db/src/repositories/unit-of-work.test.ts`

Services spec §6.1 made code: `runInTransaction(db, (tx, uow) => …)` runs one state change in one transaction. `uow.apply` does the status+version compare-and-set first (a stale version throws `ProjectConflictError` and rolls back), then posts the ledger transfers, then appends outbox events with per-project gapless sequences. Any failure anywhere rolls everything back.

- [ ] **Step 1: Write the failing test**

`packages/db/src/repositories/unit-of-work.test.ts`:
```ts
import { paymentCapturedTransfer } from "@jendal-workspace/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { outbox } from "../schema/outbox";
import { project } from "../schema/projects";
import { ledgerEntry, ledgerTransfer } from "../schema/ledger";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "../testing/db";
import { ProjectConflictError, ProjectStateError, runInTransaction } from "./unit-of-work";
import { findProjectById } from "./projects";

describe.skipIf(!hasTestDatabase)("project unit of work", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("applies the compare-and-set, the ledger and the outbox in one transaction", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    await runInTransaction(db, async (tx, uow) => {
      const row = await findProjectById(tx, projectId);
      if (!row) throw new Error("missing project");
      await uow.apply({
        project: row,
        set: { status: "awaiting_deposit" },
        transfers: [
          paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 500, managementFeeMinor: 100 }),
        ],
        events: [
          { type: "quote.accepted", data: { quoteId: "q1" } },
          { type: "payment.created", data: { paymentId: "pay1" } },
        ],
      });
    });

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ status: "awaiting_deposit", version: 1 });
    expect(await db.select().from(ledgerTransfer)).toHaveLength(1);
    expect(await db.select().from(ledgerEntry)).toHaveLength(3);
    const events = await db.select().from(outbox);
    expect(events.map((e) => [e.type, e.sequence])).toEqual([
      ["quote.accepted", 1],
      ["payment.created", 2],
    ]);
    expect(events[0]).toMatchObject({ teamId, projectId, data: { quoteId: "q1" } });
  });

  it("rejects a stale version and writes nothing", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    await db.update(project).set({ status: "cancelled", version: 7 }).where(eq(project.id, projectId));

    await expect(
      runInTransaction(db, async (_tx, uow) => {
        // Read at version 0, then someone else changed the row before apply runs.
        const row = { id: projectId, teamId, version: 0, status: "quoting" as const };
        await uow.apply({ project: row, set: { status: "awaiting_deposit" }, events: [{ type: "quote.accepted", data: {} }] });
      }),
    ).rejects.toBeInstanceOf(ProjectConflictError);

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ status: "cancelled", version: 7 });
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("rolls everything back when any step fails", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    await expect(
      runInTransaction(db, async (tx, uow) => {
        const row = await findProjectById(tx, projectId);
        if (!row) throw new Error("missing project");
        await uow.apply({
          project: row,
          set: { status: "awaiting_deposit" },
          transfers: [
            paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 500, managementFeeMinor: 0 }),
          ],
          events: [{ type: "payment.created", data: {} }],
        });
        // A later statement fails: the status change, the transfer and the event must all disappear.
        await tx.execute("select * from no_such_table");
      }),
    ).rejects.toThrow();

    expect(await findProjectById(db, projectId)).toMatchObject({ status: "quoting", version: 0 });
    expect(await db.select().from(ledgerTransfer)).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("requires at least one applied change", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    await seedProject(db, { teamId });
    await expect(runInTransaction(db, async () => "done")).rejects.toBeInstanceOf(ProjectStateError);
  });

  it("numbers outbox events per project without gaps", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const first = await seedProject(db, { teamId, title: "One" });
    const second = await seedProject(db, { teamId, title: "Two" });

    for (const [projectId, types] of [
      [first, ["project.created", "quote.created"]],
      [second, ["project.created"]],
      [first, ["quote.accepted"]],
    ] as const) {
      await runInTransaction(db, async (tx, uow) => {
        const row = await findProjectById(tx, projectId);
        if (!row) throw new Error("missing project");
        await uow.apply({ project: row, set: {}, events: types.map((type) => ({ type, data: {} })) });
      });
    }

    const events = (await db.select().from(outbox)).sort((a, b) =>
      a.projectId === b.projectId ? a.sequence - b.sequence : a.projectId === first ? -1 : 1,
    );
    expect(events.map((e) => [e.projectId === first ? "first" : "second", e.sequence])).toEqual([
      ["first", 1],
      ["first", 2],
      ["first", 3],
      ["second", 1],
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/db/src/repositories/unit-of-work.test.ts`
Expected: FAIL, cannot resolve `./unit-of-work`.

- [ ] **Step 3: Implement**

`packages/db/src/repositories/unit-of-work.ts`:
```ts
import type { LedgerTransferDraft, OutboxEventType, ProjectStatus } from "@jendal-workspace/core";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { ProjectRelations, Transaction } from "../executor";
import { createPostgresLedger } from "./ledger";
import { outbox } from "../schema/outbox";
import { project } from "../schema/projects";

export class ProjectConflictError extends Error {
  constructor() {
    super("The project changed; refresh and try again.");
    this.name = "ProjectConflictError";
  }
}

export class ProjectStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectStateError";
  }
}

export type OutboxEventInput = { type: OutboxEventType; data: Record<string, unknown> };

export type ProjectRef = { id: string; teamId: string; version: number; status: ProjectStatus };

export type ProjectStateChange = {
  // The row read in this transaction; the compare-and-set matches its version and status.
  project: ProjectRef;
  set: Partial<typeof project.$inferInsert>;
  transfers?: readonly LedgerTransferDraft[];
  events: readonly OutboxEventInput[];
};

export type UnitOfWork = {
  // One §6.1 state change: status+version compare-and-set, ledger writes, outbox events, all or nothing.
  apply(change: ProjectStateChange): Promise<void>;
};

// Services spec §6.1: one database transaction per state change. The callback receives the transaction
// for its own reads and writes and the unit of work for the compare-and-set + ledger + outbox part.
// Throwing (or tx.rollback()) rolls back everything.
export async function runInTransaction<T>(
  db: PostgresJsDatabase<ProjectRelations>,
  run: (tx: Transaction, uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    let applied = 0;
    const uow: UnitOfWork = {
      async apply({ project: ref, set, transfers = [], events }) {
        const [updated] = await tx
          .update(project)
          .set({ ...set, version: ref.version + 1, updatedAt: new Date() })
          .where(and(eq(project.id, ref.id), eq(project.version, ref.version), eq(project.status, ref.status)))
          .returning({ id: project.id });
        if (!updated) throw new ProjectConflictError();
        applied += 1;
        if (transfers.length > 0) await createPostgresLedger(ref.teamId, tx).post(transfers);
        for (const event of events) {
          const [row] = await tx
            .select({ next: sql<number>`coalesce(max(${outbox.sequence}), 0) + 1`.mapWith(Number) })
            .from(outbox)
            .where(eq(outbox.projectId, ref.id));
          await tx.insert(outbox).values({
            teamId: ref.teamId,
            type: event.type,
            projectId: ref.id,
            sequence: row?.next ?? 1,
            data: event.data,
          });
        }
      },
    };
    const result = await run(tx, uow);
    if (applied === 0) throw new ProjectStateError("The transaction applied no change to a project");
    return result;
  });
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test packages/db/src/repositories/unit-of-work.test.ts`
Expected: 5 tests pass: compare-and-set conflict writes nothing, a later failure rolls back status + ledger + outbox, outbox sequences are per-project without gaps.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/unit-of-work.ts packages/db/src/repositories/unit-of-work.test.ts
git commit -m "feat(db): add the project unit of work with compare-and-set and outbox" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 14: The projects repository

**Files:**
- Create: `packages/db/src/repositories/projects.ts`

The loaders used by the use cases and the web pages. `getProjectFacts` reads what the state-machine guards and `balanceDue` need, inside the transaction. (Its callers are exercised end to end by the router tests in Tasks 16–18, so this repository gets no test file of its own.)

- [ ] **Step 1: Implement**

`packages/db/src/repositories/projects.ts`:
```ts
import type { ProjectPaid } from "@jendal-workspace/core";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { amendment, payment, project, quote, quoteItem } from "../schema/projects";

export type ProjectRow = typeof project.$inferSelect;
export type QuoteRow = typeof quote.$inferSelect;
export type QuoteItemRow = typeof quoteItem.$inferSelect;
export type AmendmentRow = typeof amendment.$inferSelect;
export type PaymentRow = typeof payment.$inferSelect;
export type QuoteWithItems = QuoteRow & { items: QuoteItemRow[] };

export async function findProjectById(tx: DbExecutor, id: string): Promise<ProjectRow | null> {
  const [row] = await tx.select().from(project).where(eq(project.id, id)).limit(1);
  return row ?? null;
}

export async function listTeamProjects(tx: DbExecutor, teamId: string): Promise<ProjectRow[]> {
  // id breaks created_at ties so the list is stable.
  return tx.select().from(project).where(eq(project.teamId, teamId)).orderBy(desc(project.createdAt), asc(project.id));
}

async function withItems(tx: DbExecutor, quotes: QuoteRow[]): Promise<QuoteWithItems[]> {
  const result: QuoteWithItems[] = [];
  for (const row of quotes) {
    const items = await tx
      .select()
      .from(quoteItem)
      .where(eq(quoteItem.quoteId, row.id))
      .orderBy(asc(quoteItem.position));
    result.push({ ...row, items });
  }
  return result;
}

export async function getCurrentQuote(tx: DbExecutor, projectId: string): Promise<QuoteWithItems | null> {
  const [row] = await tx
    .select()
    .from(quote)
    .where(and(eq(quote.projectId, projectId), eq(quote.status, "accepted")))
    .limit(1);
  if (!row) return null;
  const [withItemRows] = await withItems(tx, [row]);
  return withItemRows ?? null;
}

export async function listProjectQuotes(tx: DbExecutor, projectId: string): Promise<QuoteWithItems[]> {
  const rows = await tx
    .select()
    .from(quote)
    .where(eq(quote.projectId, projectId))
    .orderBy(asc(quote.version), asc(quote.createdAt), asc(quote.id));
  return withItems(tx, rows);
}

export async function listProjectAmendments(tx: DbExecutor, projectId: string): Promise<AmendmentRow[]> {
  return tx
    .select()
    .from(amendment)
    .where(eq(amendment.projectId, projectId))
    .orderBy(asc(amendment.createdAt), asc(amendment.id));
}

export async function listProjectPayments(tx: DbExecutor, projectId: string): Promise<PaymentRow[]> {
  return tx
    .select()
    .from(payment)
    .where(eq(payment.projectId, projectId))
    .orderBy(asc(payment.createdAt), asc(payment.id));
}

export type ProjectFactsRow = ProjectPaid & { pendingAmendment: boolean; unpaidTopUp: boolean };

// What the state machine guards and the money math need, read inside the transaction (§6.1).
export async function getProjectFacts(tx: DbExecutor, projectId: string): Promise<ProjectFactsRow> {
  const [paid] = await tx
    .select({
      paidQuoteMinor: sql<number>`coalesce(sum(${payment.quotePartMinor}), 0)`.mapWith(Number),
      paidManagementFeeMinor: sql<number>`coalesce(sum(${payment.managementFeeMinor}), 0)`.mapWith(Number),
    })
    .from(payment)
    .where(and(eq(payment.projectId, projectId), eq(payment.status, "captured")));
  const [credit] = await tx
    .select({
      managementFeeCreditedMinor: sql<number>`coalesce(sum(${amendment.managementFeeCreditMinor}), 0)`.mapWith(Number),
    })
    .from(amendment)
    .where(and(eq(amendment.projectId, projectId), eq(amendment.status, "accepted")));
  const [pendingAmendment] = await tx
    .select({ id: amendment.id })
    .from(amendment)
    .where(and(eq(amendment.projectId, projectId), eq(amendment.status, "pending")))
    .limit(1);
  const [unpaidTopUp] = await tx
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.projectId, projectId), eq(payment.kind, "top_up"), eq(payment.status, "pending")))
    .limit(1);
  return {
    paidQuoteMinor: paid?.paidQuoteMinor ?? 0,
    paidManagementFeeMinor: paid?.paidManagementFeeMinor ?? 0,
    managementFeeCreditedMinor: credit?.managementFeeCreditedMinor ?? 0,
    pendingAmendment: pendingAmendment !== undefined,
    unpaidTopUp: unpaidTopUp !== undefined,
  };
}
```

- [ ] **Step 2: Type check**

Run: `pnpm -F @jendal-workspace/db check-types`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/repositories/projects.ts
git commit -m "feat(db): add the projects repository" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 15: Signed client links

**Files:**
- Create: `packages/api/src/client-links.ts`
- Test: `packages/api/src/client-links.test.ts`
- Uses (from S1): `packages/api/src/services-team-procedure.ts`

The client link is an HMAC-SHA256 token over the project id, keyed by a key derived from the Better Auth secret with a domain-separation label (Fact 17). No new env variable. The spec defines no expiry or revocation for client links (§5.2), so S4 ships none; if revocation is wanted later, a token-version column on `project` can invalidate old links without changing the format. The Decisions section records this.

- [ ] **Step 1: Write the failing test**

`packages/api/src/client-links.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { signClientLink, verifyClientLink } from "./client-links";

const SECRET = "test-secret-that-is-at-least-32-characters";

describe("client links", () => {
  it("round-trips a project id", async () => {
    const token = await signClientLink(SECRET, "proj-123");
    expect(token.startsWith("proj-123.")).toBe(true);
    await expect(verifyClientLink(SECRET, token)).resolves.toBe("proj-123");
  });

  it("rejects forged, truncated and foreign tokens", async () => {
    const token = await signClientLink(SECRET, "proj-123");
    await expect(verifyClientLink(SECRET, token.replace("proj-123", "proj-999"))).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, token.slice(0, -4))).resolves.toBeNull();
    await expect(verifyClientLink("another-secret-that-is-at-least-32-chars", token)).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, "")).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, "proj-123.!!!not-base64!!!")).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/api/src/client-links.test.ts`
Expected: FAIL, cannot resolve `./client-links`.

- [ ] **Step 3: Implement**

`packages/api/src/client-links.ts`:
```ts
// Signed client links (services spec §5.2): `/c/{token}` names one project and proves the bearer
// followed the link the team sent. The key is derived from the Better Auth secret, so no new secret
// is needed; it is domain-separated so a client token can never be a session token.
const encoder = new TextEncoder();

async function clientLinkKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode("payleor client link v1"));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function unbase64url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function signClientLink(secret: string, projectId: string): Promise<string> {
  const key = await clientLinkKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(projectId));
  return `${projectId}.${base64url(signature)}`;
}

// The project id when the signature verifies, otherwise null. `subtle.verify` compares in constant time.
export async function verifyClientLink(secret: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const projectId = token.slice(0, dot);
  let signature: Uint8Array;
  try {
    signature = unbase64url(token.slice(dot + 1));
  } catch {
    return null;
  }
  const key = await clientLinkKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, signature as BufferSource, encoder.encode(projectId));
  return ok ? projectId : null;
}
```

The router procedures in Tasks 16–18 are built on S1's `servicesTeamProcedure`, whose `ctx.servicesTeamRole` is a `ServicesTeamRole` where workspace owners and admins count as `"admin"` (verified in Task 9 step 2).

- [ ] **Step 4: Run the test and type check**

Run: `pnpm test packages/api/src/client-links.test.ts && pnpm -F @jendal-workspace/api check-types`
Expected: pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/client-links.ts packages/api/src/client-links.test.ts
git commit -m "feat(api): add signed client link tokens" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 16: Use cases 1/3 and the staff project router

**Files:**
- Create: `packages/api/src/use-cases/projects.ts`, `packages/api/src/routers/project.ts`
- Modify: `packages/api/src/routers/index.ts`, `packages/api/package.json`
- Test: `packages/api/src/routers/project.test.ts`

This task ships starting a project, assigning a freelancer and adding a quote — the staff side. Every use case loads the project row, checks the state machine with `transitionProject`, and writes status + ledger + outbox through `runProjectTransaction`, a wrapper on `runInTransaction` that maps a lost compare-and-set race (`ProjectConflictError`) to a tRPC `CONFLICT` error instead of a 500.

- [ ] **Step 1: Write the failing test**

`packages/api/src/routers/project.test.ts`:
```ts
import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import {
  createTestDb,
  hasTestDatabase,
  seedServicesTeamWithAdmin,
  seedServicesTeamMember,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { findProjectById, listProjectQuotes } from "@jendal-workspace/db/repositories/projects";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink } from "../client-links";
import type { Context } from "../context";
import { appRouter } from "./index";

type SessionValue = NonNullable<Context["session"]>;

function makeSession(userId: string): SessionValue {
  const now = new Date();
  return {
    session: {
      id: "session-1",
      token: "token-1",
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Someone",
      email: `${userId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const ITEMS = [
  { description: "Design", amountMinor: 40_000, extraDays: 0 },
  { description: "Build", amountMinor: 60_000, extraDays: 0 },
];

async function clientToken(projectId: string): Promise<string> {
  return signClientLink(TEST_AUTH_CONFIG.BETTER_AUTH_SECRET, projectId);
}

describe.skipIf(!hasTestDatabase)("project router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function createProject(userId: string) {
    const caller = callerFor(userId);
    return caller.project.create({ teamSlug: "team", title: "Website redesign", clientEmail: "client@example.com" });
  }

  it("starts a project with a project.created outbox event and a signed client link", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId, clientPath } = await createProject(userId);

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({
      title: "Website redesign",
      status: "quoting",
      clientEmail: "client@example.com",
      currency: "USD",
      managementFeeBps: 1_000,
      teamCutBps: 1_500,
    });
    expect(clientPath).toBe(`/c/${await clientToken(projectId)}`);
    expect(await db.select().from(outbox)).toEqual([
      expect.objectContaining({ type: "project.created", projectId, sequence: 1 }),
    ]);
  });

  it("refuses freelancers and anonymous callers to start projects, and projects without a client", async () => {
    const { organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    await expect(
      callerFor(freelancer).project.create({ teamSlug: "team", title: "Nope", clientEmail: "c@example.com" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerFor(null).project.create({ teamSlug: "team", title: "Nope", clientEmail: "c@example.com" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const { userId } = await seedServicesTeamWithAdmin(db, { slug: "other" });
    await expect(callerFor(userId).project.create({ teamSlug: "other", title: "No client" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Add the client's email or Discord user.",
    });
  });

  it("quotes in assigned mode only through the assigned freelancer", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);

    await expect(
      callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 14 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Assign a freelancer first; in this team the assigned freelancer quotes." });

    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });

    await expect(
      callerFor(userId).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 14 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 14,
    });
    const quotes = await listProjectQuotes(db, projectId);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ id: quoteId, amountMinor: 100_000, deliveryDays: 14, freelancerId: freelancer, status: "proposed" });
    expect(quotes[0]?.items.map((i) => [i.description, i.amountMinor])).toEqual([
      ["Design", 40_000],
      ["Build", 60_000],
    ]);
  });

  it("lets any freelancer quote in open mode, and staff quote for a named freelancer in team mode", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);
    const { quoteId } = await callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 7 });
    expect(quoteId).toBeTruthy();

    await db.update(servicesTeamSettings).set({ quotingMode: "team" }).where(eq(servicesTeamSettings.teamId, teamId));
    const { projectId: second } = await createProject(userId);
    await expect(
      callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId: second, items: ITEMS, deliveryDays: 7 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { quoteId: staffQuote } = await callerFor(userId).project.addQuote({
      teamSlug: "team",
      projectId: second,
      items: ITEMS,
      deliveryDays: 7,
      freelancerId: freelancer,
    });
    const quotes = await listProjectQuotes(db, second);
    expect(quotes.find((q) => q.id === staffQuote)).toMatchObject({ freelancerId: freelancer, authorId: userId });
  });

  it("lists and shows projects only to members who may see them", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);
    const outsider = await seedServicesTeamWithAdmin(db, { slug: "other" });

    await expect(callerFor(outsider.userId).project.list({ teamSlug: "team" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerFor(outsider.userId).project.get({ teamSlug: "team", projectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const list = await callerFor(userId).project.list({ teamSlug: "team" });
    expect(list).toEqual([expect.objectContaining({ id: projectId, title: "Website redesign", status: "quoting" })]);
    const detail = await callerFor(userId).project.get({ teamSlug: "team", projectId });
    expect(detail.project.id).toBe(projectId);
    expect(detail.clientPath).toBe(`/c/${await clientToken(projectId)}`);
    expect(detail.quotes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/api/src/routers/project.test.ts`
Expected: FAIL, `project` is not a key of the router (or cannot resolve `./project`).

- [ ] **Step 3: Implement the use cases**

`packages/api/src/use-cases/projects.ts`:
```ts
import {
  canAssignFreelancer,
  canStartProject,
  quoteAuthor,
  quoteAuthorRefusalMessage,
  quoteItemsProblem,
  quoteItemsProblemMessage,
  quoteTotalMinor,
  transitionProject,
  transitionRefusalMessage,
  type ProjectEvent,
  type ProjectFacts,
  type ProjectStatus,
  type QuoteItemDraft,
  type ServicesTeamRole,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import {
  ProjectConflictError,
  runInTransaction,
  type UnitOfWork,
} from "@jendal-workspace/db/repositories/unit-of-work";
import { project, quote, quoteItem } from "@jendal-workspace/db/schema/projects";
import { servicesTeamMember } from "@jendal-workspace/db/schema/services-teams";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export type ProjectActor = { teamId: string; role: ServicesTeamRole; actorId: string };

function fail(code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST", message: string): never {
  throw new TRPCError({ code, message });
}

// A lost compare-and-set race is a client-visible conflict, not a server error.
async function runProjectTransaction<T>(
  db: Database,
  run: (tx: Transaction, uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  try {
    return await runInTransaction(db, run);
  } catch (error) {
    if (error instanceof ProjectConflictError) {
      throw new TRPCError({ code: "CONFLICT", message: "The project changed while you worked. Reload and try again." });
    }
    throw error;
  }
}

function checkTransition(status: ProjectStatus, event: ProjectEvent, facts?: Partial<ProjectFacts>): ProjectStatus {
  const result = transitionProject(status, event, facts);
  if (!result.ok) fail("BAD_REQUEST", transitionRefusalMessage(result.reason));
  return result.to;
}

async function requireProject(tx: Transaction, projectId: string): Promise<ProjectRow> {
  const row = await findProjectById(tx, projectId);
  if (!row) fail("NOT_FOUND", "Project not found.");
  return row;
}

async function requireTeamProject(tx: Transaction, actor: ProjectActor, projectId: string): Promise<ProjectRow> {
  const row = await requireProject(tx, projectId);
  // An id from another team is reported exactly like a missing one.
  if (row.teamId !== actor.teamId) fail("NOT_FOUND", "Project not found.");
  return row;
}

async function requireTeamMember(tx: Transaction, teamId: string, userId: string): Promise<void> {
  const [membership] = await tx
    .select({ id: servicesTeamMember.id })
    .from(servicesTeamMember)
    .where(and(eq(servicesTeamMember.teamId, teamId), eq(servicesTeamMember.userId, userId)))
    .limit(1);
  if (!membership) fail("BAD_REQUEST", "That person is not a member of this team.");
}

const MAX_TITLE = 120;
const MAX_DELIVERY_DAYS = 365;

// Services spec §5.2 step 1: a manager starts a project with the client's email and/or Discord user.
export async function startProject(
  db: Database,
  actor: ProjectActor,
  input: { title: string; brief?: string; clientEmail?: string; clientDiscordId?: string; channelId?: string },
): Promise<{ projectId: string }> {
  if (!canStartProject(actor.role)) fail("FORBIDDEN", "Only admins and managers start projects.");
  const title = input.title.trim();
  if (title.length < 3 || title.length > MAX_TITLE) {
    fail("BAD_REQUEST", `Give the project a title of 3 to ${MAX_TITLE} characters.`);
  }
  const clientEmail = input.clientEmail?.trim().toLowerCase() || null;
  if (clientEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) {
    fail("BAD_REQUEST", "That email address does not look right.");
  }
  const clientDiscordId = input.clientDiscordId?.trim() || null;
  if (!clientEmail && !clientDiscordId) fail("BAD_REQUEST", "Add the client's email or Discord user.");
  const settings = await getServicesTeamSettings(db, actor.teamId);
  if (!settings) fail("NOT_FOUND", "Services team settings not found.");

  return runProjectTransaction(db, async (tx, uow) => {
    const [row] = await tx
      .insert(project)
      .values({
        teamId: actor.teamId,
        title,
        brief: input.brief?.trim() ?? "",
        clientEmail,
        clientDiscordId,
        channelId: input.channelId?.trim() || null,
        currency: settings.currency,
        managementFeeBps: settings.managementFeeBps,
        teamCutBps: settings.teamCutBps,
        createdById: actor.actorId,
      })
      .returning();
    if (!row) throw new Error("Insert into project returned no row");
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "project.created",
          data: { projectId: row.id, title, clientEmail, clientDiscordId, channelId: row.channelId },
        },
      ],
    });
    return { projectId: row.id };
  });
}

// Managers assign the freelancer before quoting in `assigned` mode (services spec §4.3).
export async function assignFreelancer(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; freelancerId: string },
): Promise<void> {
  if (!canAssignFreelancer(actor.role)) fail("FORBIDDEN", "Only admins and managers assign freelancers.");
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    checkTransition(row.status, "assign_freelancer");
    await requireTeamMember(tx, actor.teamId, input.freelancerId);
    await uow.apply({
      project: row,
      set: { assignedFreelancerId: input.freelancerId },
      events: [{ type: "project.assigned", data: { projectId: row.id, freelancerId: input.freelancerId } }],
    });
  });
}

// Services spec §5.2 step 2 and §4.3: a quote is line items and a delivery time, made by whoever the
// team's quoting mode allows.
export async function addQuote(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; items: QuoteItemDraft[]; deliveryDays: number; freelancerId?: string },
): Promise<{ quoteId: string }> {
  const settings = await getServicesTeamSettings(db, actor.teamId);
  if (!settings) fail("NOT_FOUND", "Services team settings not found.");
  const items = input.items.map((item) => ({ ...item, description: item.description.trim() }));
  const problem = quoteItemsProblem(items);
  if (problem) fail("BAD_REQUEST", quoteItemsProblemMessage(problem));
  if (!Number.isSafeInteger(input.deliveryDays) || input.deliveryDays < 1 || input.deliveryDays > MAX_DELIVERY_DAYS) {
    fail("BAD_REQUEST", `Delivery time must be a whole number of days from 1 to ${MAX_DELIVERY_DAYS}.`);
  }

  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    checkTransition(row.status, "add_quote");
    const author = quoteAuthor({
      role: actor.role,
      actorId: actor.actorId,
      quotingMode: settings.quotingMode,
      assignedFreelancerId: row.assignedFreelancerId,
      freelancerId: input.freelancerId ?? null,
    });
    if (!author.ok) {
      fail(author.reason === "not_allowed" ? "FORBIDDEN" : "BAD_REQUEST", quoteAuthorRefusalMessage(author.reason));
    }
    if (author.freelancerId !== actor.actorId) await requireTeamMember(tx, actor.teamId, author.freelancerId);
    const quoteId = crypto.randomUUID();
    const amountMinor = quoteTotalMinor(items);
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "quote.created",
          data: { quoteId, projectId: row.id, amountMinor, deliveryDays: input.deliveryDays, freelancerId: author.freelancerId },
        },
      ],
    });
    await tx.insert(quote).values({
      id: quoteId,
      projectId: row.id,
      teamId: actor.teamId,
      freelancerId: author.freelancerId,
      authorId: actor.actorId,
      amountMinor,
      deliveryDays: input.deliveryDays,
    });
    await tx.insert(quoteItem).values(items.map((item, position) => ({ quoteId, position, ...item })));
    return { quoteId };
  });
}
```

- [ ] **Step 4: Implement the router and register it**

`packages/api/src/routers/project.ts`:
```ts
import { MAX_QUOTE_ITEMS } from "@jendal-workspace/core";
import {
  listProjectAmendments,
  listProjectPayments,
  listProjectQuotes,
  listTeamProjects,
} from "@jendal-workspace/db/repositories/projects";
import { canSeeProject, type QuotingMode } from "@jendal-workspace/core";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { user } from "@jendal-workspace/db/schema/auth";
import { servicesTeamMember } from "@jendal-workspace/db/schema/services-teams";
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { signClientLink } from "../client-links";
import { router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { addQuote, assignFreelancer, startProject } from "../use-cases/projects";

const quoteItemInput = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive(),
  extraDays: z.number().int().min(0).max(365).default(0),
});

const projectIdInput = z.object({ projectId: z.string().uuid() });

// The client link token is signed with the Better Auth secret (see client-links.ts).
function clientLinkSecret(auth: { options: Record<string, unknown> }): string {
  const secret = auth.options.secret;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The client link secret is not configured." });
  }
  return secret;
}

export const projectRouter = router({
  list: servicesTeamProcedure.query(async ({ ctx }) => {
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    const rows = await listTeamProjects(ctx.db, ctx.servicesTeam.id);
    return rows
      .filter((row) =>
        canSeeProject({
          role: ctx.servicesTeamRole,
          actorId: ctx.session.user.id,
          assignedFreelancerId: row.assignedFreelancerId,
          status: row.status,
          quotingMode: (settings?.quotingMode ?? "assigned") as QuotingMode,
        }),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        currency: row.currency,
        clientEmail: row.clientEmail,
        clientDiscordId: row.clientDiscordId,
        createdAt: row.createdAt,
      }));
  }),

  get: servicesTeamProcedure.input(projectIdInput).query(async ({ ctx, input }) => {
    const [settings, projects] = await Promise.all([
      getServicesTeamSettings(ctx.db, ctx.servicesTeam.id),
      listTeamProjects(ctx.db, ctx.servicesTeam.id),
    ]);
    const row = projects.find((p) => p.id === input.projectId);
    if (
      !row ||
      !canSeeProject({
        role: ctx.servicesTeamRole,
        actorId: ctx.session.user.id,
        assignedFreelancerId: row.assignedFreelancerId,
        status: row.status,
        quotingMode: (settings?.quotingMode ?? "assigned") as QuotingMode,
      })
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
    }
    const [quotes, amendments, payments] = await Promise.all([
      listProjectQuotes(ctx.db, row.id),
      listProjectAmendments(ctx.db, row.id),
      listProjectPayments(ctx.db, row.id),
    ]);
    const clientToken = await signClientLink(clientLinkSecret(ctx.auth), row.id);
    return {
      project: row,
      quotes,
      amendments,
      payments,
      clientPath: `/c/${clientToken}`,
      role: ctx.servicesTeamRole,
      quotingMode: settings?.quotingMode ?? "assigned",
      viewerId: ctx.session.user.id,
    };
  }),

  members: servicesTeamProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: user.id, name: user.name, email: user.email, role: servicesTeamMember.role })
      .from(servicesTeamMember)
      .innerJoin(user, eq(user.id, servicesTeamMember.userId))
      .where(eq(servicesTeamMember.teamId, ctx.servicesTeam.id))
      .orderBy(asc(user.name), asc(user.id));
  }),

  create: servicesTeamProcedure
    .input(
      z.object({
        title: z.string().max(200),
        brief: z.string().max(5000).default(""),
        clientEmail: z.string().max(200).default(""),
        clientDiscordId: z.string().max(64).default(""),
        channelId: z.string().max(64).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id };
      const { projectId } = await startProject(ctx.db, actor, input);
      const clientToken = await signClientLink(clientLinkSecret(ctx.auth), projectId);
      return { projectId, clientPath: `/c/${clientToken}` };
    }),

  assign: servicesTeamProcedure
    .input(projectIdInput.extend({ freelancerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assignFreelancer(ctx.db, { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id }, input);
    }),

  addQuote: servicesTeamProcedure
    .input(
      projectIdInput.extend({
        items: z.array(quoteItemInput).min(1).max(MAX_QUOTE_ITEMS),
        deliveryDays: z.number().int().min(1).max(365),
        freelancerId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return addQuote(ctx.db, { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id }, input);
    }),
});
```

In `packages/api/src/routers/index.ts`, add `import { projectRouter } from "./project";` and a `project: projectRouter,` entry in the `appRouter` record.

- [ ] **Step 5: Move `drizzle-orm` to runtime dependencies**

The use cases import `and`/`eq` from `drizzle-orm` at runtime, so in `packages/api/package.json` move `"drizzle-orm": "catalog:"` from `devDependencies` to `dependencies` (the catalog pin stays; W1-D added it as a dev dependency for its transaction types only). Then run `pnpm install` so the lockfile records the move.

- [ ] **Step 6: Run the test and type check**

Run: `pnpm test packages/api/src/routers/project.test.ts && pnpm -F @jendal-workspace/api check-types`
Expected: 5 tests pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/use-cases packages/api/src/routers packages/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add start-project, assign and add-quote use cases with the staff router" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 17: The client accepts the quote

**Files:**
- Modify: `packages/api/src/use-cases/projects.ts`, `packages/api/src/routers/project.ts`
- Modify: `packages/api/src/routers/project.test.ts`

Services spec §5.2 step 3: the client opens the signed link and accepts the quote; accepting creates the `deposit` payment with its amount lines (50% of the quote + the management fee), assigns the freelancer the quote names, and moves the project to `awaiting_deposit`, all in one transaction. The capture itself is S6's.

- [ ] **Step 1: Extend the test**

Add `payment` to the schema import in `packages/api/src/routers/project.test.ts`:

```ts
import { payment } from "@jendal-workspace/db/schema/projects";
```

Append before the closing `});`:
```ts
  it("accepts a quote through the client link and creates the $600 deposit payment (§5.3)", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 14,
    });

    const token = await clientToken(projectId);
    const result = await callerFor(null).project.clientAcceptQuote({ token, quoteId });
    expect(result).toEqual({ paymentId: expect.any(String), amountMinor: 60_000 });

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ status: "awaiting_deposit" });
    const payments = await db.select().from(payment);
    expect(payments).toEqual([
      expect.objectContaining({
        id: result.paymentId,
        kind: "deposit",
        status: "pending",
        quotePartMinor: 50_000,
        managementFeeMinor: 10_000,
        amountMinor: 60_000,
        lines: [
          { kind: "deposit", label: "Deposit (50% of the quote)", amountMinor: 50_000 },
          { kind: "management_fee", label: "Management fee (10%)", amountMinor: 10_000 },
        ],
      }),
    ]);
    const quotes = await listProjectQuotes(db, projectId);
    expect(quotes.find((q) => q.id === quoteId)).toMatchObject({ status: "accepted", acceptedAt: expect.any(Date) });
    expect((await db.select().from(outbox)).map((e) => e.type)).toEqual([
      "project.created",
      "project.assigned",
      "quote.created",
      "quote.accepted",
      "payment.created",
    ]);
  });

  it("rejects a forged or missing client token", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);
    await expect(callerFor(null).project.clientGet({ token: `${projectId}.forged` })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(callerFor(null).project.clientAcceptQuote({ token: "nope", quoteId: crypto.randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("assigns the freelancer the quote names when the client accepts (open and team modes)", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });

    // Open mode: the quoting freelancer.
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const { projectId } = await createProject(userId);
    const { quoteId } = await callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 7 });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(projectId), quoteId });
    expect((await findProjectById(db, projectId))?.assignedFreelancerId).toBe(freelancer);

    // Team mode: the freelancer the staff member named.
    await db.update(servicesTeamSettings).set({ quotingMode: "team" }).where(eq(servicesTeamSettings.teamId, teamId));
    const { projectId: second } = await createProject(userId);
    const { quoteId: staffQuote } = await callerFor(userId).project.addQuote({
      teamSlug: "team",
      projectId: second,
      items: ITEMS,
      deliveryDays: 7,
      freelancerId: freelancer,
    });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(second), quoteId: staffQuote });
    expect((await findProjectById(db, second))?.assignedFreelancerId).toBe(freelancer);
  });
  it("rolls everything back when the client accepts a quote on a project that changed underneath", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 7,
    });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(projectId), quoteId });

    // Accepting again is refused by the state machine and changes nothing.
    await expect(
      callerFor(null).project.clientAcceptQuote({ token: await clientToken(projectId), quoteId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const payments = await db.select().from(payment).where(eq(payment.projectId, projectId));
    expect(payments).toHaveLength(1);
    const quotes = await listProjectQuotes(db, projectId);
    expect(quotes.filter((q) => q.status === "accepted")).toHaveLength(1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/api/src/routers/project.test.ts`
Expected: FAIL, `clientAcceptQuote` does not exist on the router.

- [ ] **Step 3: Extend the use cases**

In `packages/api/src/use-cases/projects.ts`, add `depositDue,` to the core import (alphabetically after `canStartProject`), `paymentLines,` before `transitionRefusalMessage,`, and change the schema import to `import { payment, project, quote, quoteItem } from "@jendal-workspace/db/schema/projects";`. Append:
```ts
// Services spec §5.2 step 3: only the project's client accepts a quote (the router checks the client
// token). Accepting moves the project to awaiting_deposit and creates the deposit payment.
export async function acceptQuote(
  db: Database,
  input: { projectId: string; quoteId: string },
): Promise<{ paymentId: string; amountMinor: number }> {
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const status = checkTransition(row.status, "accept_quote");
    const [found] = await tx
      .select()
      .from(quote)
      .where(and(eq(quote.id, input.quoteId), eq(quote.projectId, row.id)))
      .limit(1);
    if (!found || found.status !== "proposed") fail("BAD_REQUEST", "This quote is not waiting for an answer.");
    const deposit = depositDue(found.amountMinor, row.managementFeeBps);
    const paymentId = crypto.randomUUID();
    await uow.apply({
      project: row,
      // The quote names the freelancer who does the work; accepting it assigns them (§5.2 step 3).
      set: { status, assignedFreelancerId: found.freelancerId },
      events: [
        { type: "quote.accepted", data: { quoteId: found.id, version: found.version, amountMinor: found.amountMinor } },
        { type: "payment.created", data: { paymentId, kind: "deposit", amountMinor: deposit.totalMinor } },
      ],
    });
    await tx.update(quote).set({ status: "accepted", acceptedAt: new Date() }).where(eq(quote.id, found.id));
    await tx
      .update(quote)
      .set({ status: "superseded" })
      .where(and(eq(quote.projectId, row.id), eq(quote.status, "proposed")));
    await tx.insert(payment).values({
      id: paymentId,
      projectId: row.id,
      teamId: row.teamId,
      kind: "deposit",
      currency: row.currency,
      quotePartMinor: deposit.quotePartMinor,
      managementFeeMinor: deposit.managementFeeMinor,
      amountMinor: deposit.totalMinor,
      lines: paymentLines("deposit", deposit, row.managementFeeBps),
    });
    return { paymentId, amountMinor: deposit.totalMinor };
  });
}
```

- [ ] **Step 4: Extend the router**

In `packages/api/src/routers/project.ts`: add `findProjectById,` to the repositories import, change the client-links import to `import { signClientLink, verifyClientLink } from "../client-links";`, the index import to `import { publicProcedure, router } from "../index";`, and the use-cases import to include `acceptQuote`. Add the helper after `clientLinkSecret`:
```ts
async function projectIdFromToken(auth: { options: Record<string, unknown> }, token: string): Promise<string> {
  const projectId = await verifyClientLink(clientLinkSecret(auth), token);
  if (!projectId) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return projectId;
}
```

Append these procedures to the router (after `addQuote`, before the closing `});`):
```ts
  // The client project page (services spec §5.2): signed link, no account. Internal user ids
  // (freelancerId, authorId, proposedById) and the PayPal ids stay server-side; the link holder
  // sees only what the page renders.
  clientGet: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ ctx, input }) => {
    const projectId = await projectIdFromToken(ctx.auth, input.token);
    const row = await findProjectById(ctx.db, projectId);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
    const [quotes, amendments, payments] = await Promise.all([
      listProjectQuotes(ctx.db, projectId),
      listProjectAmendments(ctx.db, projectId),
      listProjectPayments(ctx.db, projectId),
    ]);
    return {
      project: {
        id: row.id,
        title: row.title,
        brief: row.brief,
        status: row.status,
        currency: row.currency,
        managementFeeBps: row.managementFeeBps,
      },
      quotes: quotes.map((q) => ({
        id: q.id,
        version: q.version,
        status: q.status,
        amountMinor: q.amountMinor,
        deliveryDays: q.deliveryDays,
        createdAt: q.createdAt,
        acceptedAt: q.acceptedAt,
        items: q.items.map((item) => ({
          id: item.id,
          description: item.description,
          amountMinor: item.amountMinor,
          extraDays: item.extraDays,
        })),
      })),
      amendments: amendments.map((a) => ({
        id: a.id,
        status: a.status,
        note: a.note,
        addItems: a.addItems,
        deltaMinor: a.deltaMinor,
        newAmountMinor: a.newAmountMinor,
        extraDays: a.extraDays,
        createdAt: a.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        amountMinor: p.amountMinor,
        lines: p.lines,
        createdAt: p.createdAt,
      })),
    };
  }),

  clientAcceptQuote: publicProcedure
    .input(z.object({ token: z.string().min(1), quoteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return acceptQuote(ctx.db, { projectId, quoteId: input.quoteId });
    }),
```

- [ ] **Step 5: Run the test and type check**

Run: `pnpm test packages/api/src/routers/project.test.ts && pnpm -F @jendal-workspace/api check-types`
Expected: 9 tests pass; no type errors. The "$600 deposit (§5.3)" test checks the payment's amount lines, the pending status and the `quote.accepted` outbox event; the forged-token test checks the token verification; the open/team-mode test checks that accepting assigns the freelancer the quote names.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): let the client accept a quote through the signed link, creating the deposit payment" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 18: Amendments

**Files:**
- Modify: `packages/api/src/use-cases/projects.ts`, `packages/api/src/routers/project.ts`
- Modify: `packages/api/src/routers/project.test.ts`

Services spec §5.5: a manager or the assigned freelancer proposes an amendment; the client answers through the link. Accepting an increase writes a new accepted quote version and a `top_up` payment (50% of the increase + fee on the increase). Accepting a decrease writes the new quote version and posts the management-fee credit; the deposit credit lowers the balance through `balanceDue` (§5.5: "balance is always final price + fee on the current quote − everything already paid").

- [ ] **Step 1: Extend the test**

In `packages/api/src/routers/project.test.ts`, extend the imports:

```ts
import { paymentCapturedTransfer } from "@jendal-workspace/core";
```

```ts
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
```

```ts
import { getProjectFacts } from "@jendal-workspace/db/repositories/projects";
```

(add `getProjectFacts` to the existing `findProjectById, listProjectQuotes` import instead of a new line)

```ts
import { ledgerBalance } from "@jendal-workspace/db/schema/ledger";
```

Append before the closing `});`:
```ts
  async function projectInProgress(userId: string, organizationId: string, teamId: string, items = ITEMS) {
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items,
      deliveryDays: 14,
    });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(projectId), quoteId });
    // The deposit capture is S6's; here the payment_captured posting moves the project along.
    const [deposit] = await db.select().from(payment).where(eq(payment.projectId, projectId));
    await runInTransaction(db, async (tx, uow) => {
      const row = await findProjectById(tx, projectId);
      if (!row || !deposit) throw new Error("missing rows");
      await tx.update(payment).set({ status: "captured", capturedAt: new Date() }).where(eq(payment.id, deposit.id));
      await uow.apply({
        project: row,
        set: { status: "in_progress" },
        transfers: [
          paymentCapturedTransfer({
            currency: "USD",
            projectId,
            paymentId: deposit.id,
            quotePartMinor: deposit.quotePartMinor,
            managementFeeMinor: deposit.managementFeeMinor,
          }),
        ],
        events: [{ type: "payment.captured", data: { paymentId: deposit.id } }],
      });
    });
    return { projectId, freelancer };
  }

  it("runs an increase amendment: top-up payment, new quote version (§5.5 +$400)", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await projectInProgress(userId, organizationId, teamId);

    const { amendmentId } = await callerFor(userId).project.proposeAmendment({
      teamSlug: "team",
      projectId,
      add: [{ description: "Blog", amountMinor: 40_000, extraDays: 3 }],
      removeItemIds: [],
    });

    const token = await clientToken(projectId);
    const result = await callerFor(null).project.clientAcceptAmendment({ token, amendmentId });
    expect(result).toEqual({ quoteVersion: 2, topUpPaymentId: expect.any(String) });

    const quotes = await listProjectQuotes(db, projectId);
    expect(quotes.map((q) => [q.version, q.status, q.amountMinor])).toEqual([
      [1, "superseded", 100_000],
      [2, "accepted", 140_000],
    ]);
    expect(quotes[1]?.items.map((i) => i.description)).toEqual(["Design", "Build", "Blog"]);
    const payments = await db.select().from(payment).where(eq(payment.projectId, projectId));
    const topUp = payments.find((p) => p.kind === "top_up");
    expect(topUp).toMatchObject({
      amendmentId,
      quotePartMinor: 20_000,
      managementFeeMinor: 4_000,
      amountMinor: 24_000,
      status: "pending",
    });
    const facts = await getProjectFacts(db, projectId);
    expect(facts.unpaidTopUp).toBe(true);
    expect((await db.select().from(outbox)).map((e) => e.type)).toContain("amendment.accepted");
  });

  it("runs the §5.5 decrease amendment: −$300 on the $1,000 quote credits the $30 fee", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    // §5.5's example: a $1,000 quote (Design $300 + Build $700) loses the $300 item.
    const { projectId } = await projectInProgress(userId, organizationId, teamId, [
      { description: "Design", amountMinor: 30_000, extraDays: 0 },
      { description: "Build", amountMinor: 70_000, extraDays: 0 },
    ]);
    const quotes = await listProjectQuotes(db, projectId);
    const designItem = quotes[0]?.items.find((i) => i.description === "Design");
    if (!designItem) throw new Error("missing item");

    const { amendmentId } = await callerFor(userId).project.proposeAmendment({
      teamSlug: "team",
      projectId,
      add: [],
      removeItemIds: [designItem.id],
    });
    const result = await callerFor(null).project.clientAcceptAmendment({ token: await clientToken(projectId), amendmentId });
    expect(result).toEqual({ quoteVersion: 2, topUpPaymentId: null });

    const versions = await listProjectQuotes(db, projectId);
    expect(versions.map((q) => [q.version, q.status, q.amountMinor])).toEqual([
      [1, "superseded", 100_000],
      [2, "accepted", 70_000],
    ]);
    const balances = await db.select().from(ledgerBalance);
    // The $30 overpaid management fee moved from team_revenue back to client_held (§5.5).
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: "team_revenue", balanceMinor: 7_000 }),
        expect.objectContaining({ account: `client_held:${projectId}`, balanceMinor: 53_000 }),
      ]),
    );
    const facts = await getProjectFacts(db, projectId);
    expect(facts.managementFeeCreditedMinor).toBe(3_000);
    const payments = await db.select().from(payment).where(eq(payment.projectId, projectId));
    expect(payments.filter((p) => p.kind === "top_up")).toHaveLength(0);
  });

  it("blocks a second pending amendment and declines the first", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await projectInProgress(userId, organizationId, teamId);
    const input = {
      teamSlug: "team",
      projectId,
      add: [{ description: "Extra", amountMinor: 5_000, extraDays: 0 }],
      removeItemIds: [],
    };
    await callerFor(userId).project.proposeAmendment(input);
    await expect(callerFor(userId).project.proposeAmendment(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "An amendment is waiting for the client's answer.",
    });

    const token = await clientToken(projectId);
    const page = await callerFor(null).project.clientGet({ token });
    const pending = page.amendments.find((a) => a.status === "pending");
    if (!pending) throw new Error("no pending amendment");
    await callerFor(null).project.clientDeclineAmendment({ token, amendmentId: pending.id });
    // After the decline another amendment can be proposed.
    await callerFor(userId).project.proposeAmendment(input);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/api/src/routers/project.test.ts`
Expected: FAIL, `proposeAmendment` does not exist on the router.

- [ ] **Step 3: Extend the use cases**

In `packages/api/src/use-cases/projects.ts`, add to the imports: `amendmentEffect, amendmentProblemMessage, amendQuoteItems, canProposeAmendment, managementFeeCreditTransfer` (core), `getCurrentQuote, getProjectFacts` and `type QuoteWithItems` (repositories), `type OutboxEventInput` (unit-of-work), and `amendment` (schema). Append:
```ts
async function requireCurrentQuote(tx: Transaction, row: ProjectRow): Promise<QuoteWithItems> {
  const current = await getCurrentQuote(tx, row.id);
  // The status guard already proved the project is past acceptance, so this cannot be missing.
  if (!current) throw new Error(`Project ${row.id} is ${row.status} without an accepted quote`);
  return current;
}

// Services spec §5.5: the assigned freelancer or a manager proposes an amendment in in_progress or
// delivered; a pending amendment or unpaid top-up blocks a new one.
export async function proposeAmendment(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; add: QuoteItemDraft[]; removeItemIds: string[]; note?: string },
): Promise<{ amendmentId: string }> {
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    if (!canProposeAmendment({ role: actor.role, actorId: actor.actorId, assignedFreelancerId: row.assignedFreelancerId })) {
      fail("FORBIDDEN", "Only the assigned freelancer or a manager proposes amendments.");
    }
    const facts = await getProjectFacts(tx, row.id);
    checkTransition(row.status, "propose_amendment", facts);
    const current = await requireCurrentQuote(tx, row);
    const amended = amendQuoteItems(current.items, { add: input.add, removeItemIds: input.removeItemIds });
    if (!amended.ok) fail("BAD_REQUEST", amendmentProblemMessage(amended.problem));
    const amendmentId = crypto.randomUUID();
    const newAmountMinor = quoteTotalMinor(amended.items);
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "amendment.proposed",
          data: { amendmentId, projectId: row.id, deltaMinor: newAmountMinor - current.amountMinor, newAmountMinor },
        },
      ],
    });
    await tx.insert(amendment).values({
      id: amendmentId,
      projectId: row.id,
      teamId: actor.teamId,
      baseQuoteId: current.id,
      proposedById: actor.actorId,
      note: input.note?.trim() ?? "",
      addItems: input.add,
      removeItemIds: input.removeItemIds,
      deltaMinor: newAmountMinor - current.amountMinor,
      newAmountMinor,
      extraDays: amended.extraDays,
    });
    return { amendmentId };
  });
}

// The client accepts an amendment (§5.5): it becomes the current quote version; an increase creates
// the top-up payment, a decrease credits the overpaid management fee to the project.
export async function acceptAmendment(
  db: Database,
  input: { projectId: string; amendmentId: string },
): Promise<{ quoteVersion: number; topUpPaymentId: string | null }> {
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const facts = await getProjectFacts(tx, row.id);
    checkTransition(row.status, "accept_amendment", facts);
    const [found] = await tx
      .select()
      .from(amendment)
      .where(and(eq(amendment.id, input.amendmentId), eq(amendment.projectId, row.id)))
      .limit(1);
    if (!found || found.status !== "pending") fail("BAD_REQUEST", "This amendment is not waiting for an answer.");
    const current = await requireCurrentQuote(tx, row);
    if (found.baseQuoteId !== current.id) {
      throw new Error(`Amendment ${found.id} is based on quote ${found.baseQuoteId}, not the current ${current.id}`);
    }
    const effect = amendmentEffect({
      previousQuoteMinor: current.amountMinor,
      newQuoteMinor: found.newAmountMinor,
      managementFeeBps: row.managementFeeBps,
    });
    const amended = amendQuoteItems(current.items, { add: found.addItems, removeItemIds: found.removeItemIds });
    if (!amended.ok) throw new Error(`Amendment ${found.id} no longer applies: ${amended.problem}`);

    const events: OutboxEventInput[] = [
      {
        type: "amendment.accepted",
        data: { amendmentId: found.id, projectId: row.id, quoteVersion: current.version + 1, newAmountMinor: found.newAmountMinor },
      },
    ];
    let topUpPaymentId: string | null = null;
    if (effect.kind === "increase") {
      topUpPaymentId = crypto.randomUUID();
      events.push({
        type: "payment.created",
        data: { paymentId: topUpPaymentId, kind: "top_up", amountMinor: effect.topUp.totalMinor },
      });
    }
    await uow.apply({
      project: row,
      set: {},
      transfers:
        effect.kind === "decrease" && effect.managementFeeCreditMinor > 0
          ? [
              managementFeeCreditTransfer({
                currency: row.currency,
                projectId: row.id,
                amendmentId: found.id,
                creditMinor: effect.managementFeeCreditMinor,
              }),
            ]
          : [],
      events,
    });
    await tx.update(quote).set({ status: "superseded" }).where(eq(quote.id, current.id));
    const [newQuote] = await tx
      .insert(quote)
      .values({
        projectId: row.id,
        teamId: row.teamId,
        version: current.version + 1,
        status: "accepted",
        freelancerId: current.freelancerId,
        authorId: found.proposedById,
        amountMinor: found.newAmountMinor,
        deliveryDays: current.deliveryDays,
        previousQuoteId: current.id,
        amendmentId: found.id,
        acceptedAt: new Date(),
      })
      .returning({ id: quote.id });
    if (!newQuote) throw new Error("Insert into quote returned no row");
    await tx.insert(quoteItem).values(amended.items.map((item, position) => ({ quoteId: newQuote.id, position, ...item })));
    await tx
      .update(amendment)
      .set({
        status: "accepted",
        decidedAt: new Date(),
        resultingQuoteId: newQuote.id,
        managementFeeCreditMinor: effect.kind === "decrease" ? effect.managementFeeCreditMinor : 0,
      })
      .where(eq(amendment.id, found.id));
    if (effect.kind === "increase" && topUpPaymentId) {
      await tx.insert(payment).values({
        id: topUpPaymentId,
        projectId: row.id,
        teamId: row.teamId,
        kind: "top_up",
        currency: row.currency,
        amendmentId: found.id,
        quotePartMinor: effect.topUp.quotePartMinor,
        managementFeeMinor: effect.topUp.managementFeeMinor,
        amountMinor: effect.topUp.totalMinor,
        lines: paymentLines("top_up", effect.topUp, row.managementFeeBps),
      });
    }
    return { quoteVersion: current.version + 1, topUpPaymentId };
  });
}

export async function declineAmendment(db: Database, input: { projectId: string; amendmentId: string }): Promise<void> {
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const facts = await getProjectFacts(tx, row.id);
    checkTransition(row.status, "decline_amendment", facts);
    const [found] = await tx
      .select()
      .from(amendment)
      .where(and(eq(amendment.id, input.amendmentId), eq(amendment.projectId, row.id)))
      .limit(1);
    if (!found || found.status !== "pending") fail("BAD_REQUEST", "This amendment is not waiting for an answer.");
    await uow.apply({
      project: row,
      set: {},
      events: [{ type: "amendment.declined", data: { amendmentId: found.id, projectId: row.id } }],
    });
    await tx.update(amendment).set({ status: "declined", decidedAt: new Date() }).where(eq(amendment.id, found.id));
  });
}
```

- [ ] **Step 4: Extend the router**

Add `proposeAmendment, acceptAmendment, declineAmendment` to the use-cases import (keeping it alphabetical) and append these procedures before the closing `});`:
```ts
  proposeAmendment: servicesTeamProcedure
    .input(
      projectIdInput.extend({
        add: z.array(quoteItemInput).max(MAX_QUOTE_ITEMS).default([]),
        removeItemIds: z.array(z.string().uuid()).max(MAX_QUOTE_ITEMS).default([]),
        note: z.string().max(2000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return proposeAmendment(
        ctx.db,
        { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id },
        input,
      );
    }),

  // The client project page (services spec §5.2): signed link, no account. Internal user ids
  // (freelancerId, authorId, proposedById) and the PayPal ids stay server-side; the link holder,

  clientAcceptAmendment: publicProcedure
    .input(z.object({ token: z.string().min(1), amendmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return acceptAmendment(ctx.db, { projectId, amendmentId: input.amendmentId });
    }),

  clientDeclineAmendment: publicProcedure
    .input(z.object({ token: z.string().min(1), amendmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      await declineAmendment(ctx.db, { projectId, amendmentId: input.amendmentId });
    }),
```

- [ ] **Step 5: Run the test and type check**

Run: `pnpm test packages/api/src/routers/project.test.ts && pnpm -F @jendal-workspace/api check-types`
Expected: 12 tests pass; no type errors. The increase test checks the $240 top-up payment and the v2 quote; the decrease test mirrors §5.5 exactly (a $1,000 quote of $300 + $700 items loses the $300 item: the $30 overpaid fee moves `team_revenue` 10_000 → 7_000 and `client_held` 50_000 → 53_000, and no payment row is created); the third checks the pending-amendment block and the decline path.

- [ ] **Step 6: Run the whole workspace**

Run: `pnpm test && pnpm check-types`
Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): add amendment propose, accept and decline" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 19: The projects list and New project pages

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/projects/page.tsx`, `apps/web/src/app/admin/[storeSlug]/projects/projects-list.tsx`
- Create: `apps/web/src/app/admin/[storeSlug]/projects/new/page.tsx`, `apps/web/src/app/admin/[storeSlug]/projects/new/new-project-form.tsx`

The services spec §9 project list: status pill, title, client, amounts come later (capture is S6); actions on each row come from the detail page. Keep labels sentence case, every status filter reachable by keyboard, and every async action with a visible pending and error state (skills `better-writing`, `better-accessibility`).

- [ ] **Step 1: Create the pages**

`apps/web/src/app/admin/[storeSlug]/projects/page.tsx`:
```tsx
import { requireSession } from "@/lib/server-api";

import ProjectsList from "./projects-list";

export default async function ProjectsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <ProjectsList teamSlug={storeSlug} />;
}
```

`apps/web/src/app/admin/[storeSlug]/projects/projects-list.tsx`:
```tsx
"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { trpc } from "@/utils/trpc";

export default function ProjectsList({ teamSlug }: { teamSlug: string }) {
  const projects = useQuery({ ...trpc.project.list.queryOptions({ teamSlug }), retry: false });

  if (projects.isPending) return <Loader />;
  if (projects.isError) {
    return (
      <main className="container mx-auto max-w-4xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">Projects unavailable</h1>
        <p className="text-sm text-muted-foreground">{projects.error.message}</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/${teamSlug}`} className="text-sm text-muted-foreground">
            Team dashboard
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        </div>
        <Link href={`/${teamSlug}/projects/new`} className={buttonVariants()}>
          New project
        </Link>
      </div>
      {projects.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet. Start one for your next client.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {projects.data.map((project) => (
            <li key={project.id}>
              <Link href={`/${teamSlug}/projects/${project.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50">
                <div>
                  <p className="font-medium">{project.title}</p>
                  <p className="text-sm text-muted-foreground">{project.clientEmail ?? project.clientDiscordId ?? "No client contact"}</p>
                </div>
                <span className="text-sm text-muted-foreground">{projectStatusLabel(project.status)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

`apps/web/src/app/admin/[storeSlug]/projects/new/page.tsx`:
```tsx
import { requireSession } from "@/lib/server-api";

import NewProjectForm from "./new-project-form";

export default async function NewProjectPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <NewProjectForm teamSlug={storeSlug} />;
}
```

`apps/web/src/app/admin/[storeSlug]/projects/new/new-project-form.tsx`:
```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { trpc } from "@/utils/trpc";

export default function NewProjectForm({ teamSlug }: { teamSlug: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientDiscordId, setClientDiscordId] = useState("");
  const [brief, setBrief] = useState("");

  const create = useMutation(
    trpc.project.create.mutationOptions({
      // The detail page the redirect lands on shows the client link with a copy button.
      onSuccess: ({ projectId }) => router.push(`/${teamSlug}/projects/${projectId}`),
    }),
  );

  const hasClient = clientEmail.trim() !== "" || clientDiscordId.trim() !== "";
  const canSubmit = title.trim().length >= 3 && hasClient && !create.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    create.mutate({ teamSlug, title, brief, clientEmail, clientDiscordId, channelId: "" });
  }

  return (
    <main className="container mx-auto max-w-xl px-4 py-6">
      <div className="space-y-1">
        <Link href={`/${teamSlug}/projects`} className="text-sm text-muted-foreground">
          Projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-muted-foreground">
          The client gets a private link to follow the project, accept quotes and pay. No account needed.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
        <div className="space-y-2">
          <Label htmlFor="project-title">Title</Label>
          <Input id="project-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={120} autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client-email">Client email</Label>
          <Input id="client-email" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="client@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client-discord">Client Discord user ID</Label>
          <Input id="client-discord" value={clientDiscordId} onChange={(e) => setClientDiscordId(e.target.value)} placeholder="Optional" />
          <p className="text-xs text-muted-foreground">Add the email, the Discord user, or both.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-brief">Brief</Label>
          <Textarea id="project-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="What the client asked for" />
        </div>
        {create.error ? <p className="text-sm text-destructive">{create.error.message}</p> : null}
        <Button type="submit" disabled={!canSubmit}>
          {create.isPending ? "Starting…" : "Start project"}
        </Button>
      </form>
    </main>
  );
}
```

Note: the route folder keeps S1's admin param name (`[storeSlug]`, the team slug). If S1 merged with a different name, use S1's folder name and record it under "Changes made during execution".

- [ ] **Step 2: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin
git commit -m "feat(web): add the projects list and New project pages" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 20: The project detail page

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/page.tsx`, `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx`

The detail page is the staff cockpit: status and timeline, the assign form, the quote editor (item rows), the amendment proposal form, the payments list, and the client link with a copy button. The detail client component reads `project.get` output via `inferRouterOutputs<AppRouter>`.

- [ ] **Step 1: Create the pages**

`apps/web/src/app/admin/[storeSlug]/projects/[projectId]/page.tsx`:
```tsx
import { getPlatformOrigins, requireSession } from "@/lib/server-api";

import ProjectDetail from "./project-detail";

export default async function ProjectPage({ params }: { params: Promise<{ storeSlug: string; projectId: string }> }) {
  await requireSession();
  const { storeSlug, projectId } = await params;
  const origins = await getPlatformOrigins();
  return <ProjectDetail teamSlug={storeSlug} projectId={projectId} siteOrigin={origins.site} />;
}
```

`apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx`:
```tsx
"use client";

import {
  canAssignFreelancer,
  canProposeAmendment,
  formatMoney,
  money,
  parseMajorAmount,
  projectStatusLabel,
  quoteAuthor,
  quoteTotalMinor,
  type MoneyCurrency,
  type QuoteItemDraft,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

type Detail = inferRouterOutputs<AppRouter>["project"]["get"];

type ItemRow = { description: string; amount: string; extraDays: string };

const EMPTY_ROW: ItemRow = { description: "", amount: "", extraDays: "0" };

function parseRows(rows: ItemRow[]): QuoteItemDraft[] | null {
  const items: QuoteItemDraft[] = [];
  for (const row of rows) {
    const amountMinor = parseMajorAmount(row.amount);
    const extraDays = Number(row.extraDays || "0");
    if (row.description.trim() === "" || amountMinor === null || !Number.isInteger(extraDays)) return null;
    items.push({ description: row.description.trim(), amountMinor, extraDays });
  }
  return items;
}

function ItemRowsEditor({ rows, onChange }: { rows: ItemRow[]; onChange: (rows: ItemRow[]) => void }) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={`Line ${index + 1} description`}
            placeholder="What this line covers"
            value={row.description}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, description: e.target.value } : r)))}
          />
          <Input
            aria-label={`Line ${index + 1} amount`}
            placeholder="0.00"
            inputMode="decimal"
            className="w-28"
            value={row.amount}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))}
          />
          <Input
            aria-label={`Line ${index + 1} extra days`}
            placeholder="Days"
            inputMode="numeric"
            className="w-20"
            value={row.extraDays}
            onChange={(e) => onChange(rows.map((r, i) => (i === index ? { ...r, extraDays: e.target.value } : r)))}
          />
          <Button type="button" variant="ghost" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => onChange([...rows, { ...EMPTY_ROW }])}>
        Add a line
      </Button>
    </div>
  );
}

function QuoteCard({ quote, currency }: { quote: Detail["quotes"][number]; currency: MoneyCurrency }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">
          Quote v{quote.version} · {formatMoney(money(currency, quote.amountMinor))}
        </p>
        <span className="text-sm text-muted-foreground">{quote.status}</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {quote.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4">
            <span>
              {item.description}
              {item.extraDays > 0 ? ` (+${item.extraDays} days)` : ""}
            </span>
            <span>{formatMoney(money(currency, item.amountMinor))}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">Delivery in {quote.deliveryDays} days after the deposit.</p>
    </div>
  );
}

export default function ProjectDetail({
  teamSlug,
  projectId,
  siteOrigin,
}: {
  teamSlug: string;
  projectId: string;
  siteOrigin: string;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({ ...trpc.project.get.queryOptions({ teamSlug, projectId }), retry: false });
  const members = useQuery({ ...trpc.project.members.queryOptions({ teamSlug }), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.project.get.queryOptions({ teamSlug, projectId }).queryKey });

  const [freelancerId, setFreelancerId] = useState("");
  const [quoteRows, setQuoteRows] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);
  const [deliveryDays, setDeliveryDays] = useState("14");
  const [quoteFreelancerId, setQuoteFreelancerId] = useState("");
  const [note, setNote] = useState("");
  const [addRows, setAddRows] = useState<ItemRow[]>([]);
  const [removeItemIds, setRemoveItemIds] = useState<string[]>([]);

  const assign = useMutation(trpc.project.assign.mutationOptions({ onSuccess: refresh }));
  const addQuote = useMutation(trpc.project.addQuote.mutationOptions({ onSuccess: refresh }));
  const proposeAmendment = useMutation(trpc.project.proposeAmendment.mutationOptions({ onSuccess: refresh }));

  if (detail.isPending) return <Loader />;
  if (detail.isError) {
    return (
      <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">Project not found</h1>
        <Link href={`/${teamSlug}/projects`} className="underline">
          Back to projects
        </Link>
      </main>
    );
  }

  const { project, quotes, amendments, payments, clientPath, role, quotingMode, viewerId } = detail.data;
  const currency = project.currency as MoneyCurrency;
  const currentQuote = quotes.find((q) => q.status === "accepted");
  const proposedQuotes = quotes.filter((q) => q.status === "proposed");
  const pendingAmendment = amendments.find((a) => a.status === "pending");
  const days = Number(deliveryDays);
  const quoteItems = parseRows(quoteRows);
  const canQuote =
    project.status === "quoting" &&
    quoteAuthor({
      role,
      actorId: viewerId,
      quotingMode,
      assignedFreelancerId: project.assignedFreelancerId,
      freelancerId: quoteFreelancerId || null,
    }).ok;
  // Staff name the freelancer in team mode and in open mode; only assigned mode implies them.
  const needsFreelancerName = role !== "freelancer" && quotingMode !== "assigned";

  function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (freelancerId) assign.mutate({ teamSlug, projectId, freelancerId });
  }

  function handleQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quoteItems || !Number.isInteger(days) || days < 1 || !canQuote) return;
    addQuote.mutate({
      teamSlug,
      projectId,
      items: quoteItems,
      deliveryDays: days,
      ...(quoteFreelancerId ? { freelancerId: quoteFreelancerId } : {}),
    });
  }

  function handleAmend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const add = parseRows(addRows) ?? undefined;
    if (addRows.length > 0 && !add) return;
    if ((add?.length ?? 0) === 0 && removeItemIds.length === 0) return;
    proposeAmendment.mutate({ teamSlug, projectId, add: add ?? [], removeItemIds, note });
  }

  return (
    <main className="container mx-auto max-w-3xl space-y-8 px-4 py-6">
      <div className="space-y-1">
        <Link href={`/${teamSlug}/projects`} className="text-sm text-muted-foreground">
          Projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground">
          {projectStatusLabel(project.status)} · {project.clientEmail ?? project.clientDiscordId ?? "No client contact"}
        </p>
        {project.brief ? <p className="text-sm">{project.brief}</p> : null}
        <p className="text-sm">
          Client link:{" "}
          <a href={`${siteOrigin}${clientPath}`} className="underline underline-offset-4 break-all">
            {siteOrigin}
            {clientPath}
          </a>
        </p>
      </div>

      {canAssignFreelancer(role) && project.status === "quoting" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Assignment</h2>
          <form onSubmit={handleAssign} className="flex items-end gap-2">
            <div className="space-y-2">
              <Label htmlFor="assign-freelancer">Freelancer</Label>
              <select
                id="assign-freelancer"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={freelancerId}
                onChange={(e) => setFreelancerId(e.target.value)}
              >
                <option value="">Choose a member…</option>
                {(members.data ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.role})
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={!freelancerId || assign.isPending}>
              Assign
            </Button>
          </form>
          {assign.error ? <p className="text-sm text-destructive">{assign.error.message}</p> : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Quotes</h2>
        {quotes.length === 0 ? <p className="text-sm text-muted-foreground">No quotes yet.</p> : null}
        {quotes.map((quote) => (
          <QuoteCard key={quote.id} quote={quote} currency={currency} />
        ))}
        {project.status === "quoting" && (role !== "freelancer" || quotingMode !== "team") ? (
          <form onSubmit={handleQuote} className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">New quote</h3>
            <ItemRowsEditor rows={quoteRows} onChange={setQuoteRows} />
            <div className="flex items-end gap-2">
              <div className="space-y-2">
                <Label htmlFor="delivery-days">Delivery days</Label>
                <Input id="delivery-days" inputMode="numeric" className="w-24" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} />
              </div>
              {needsFreelancerName ? (
                <div className="space-y-2">
                  <Label htmlFor="quote-freelancer">Freelancer</Label>
                  <select
                    id="quote-freelancer"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={quoteFreelancerId}
                    onChange={(e) => setQuoteFreelancerId(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {(members.data ?? []).map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Button type="submit" disabled={!quoteItems || !Number.isInteger(days) || days < 1 || !canQuote || addQuote.isPending}>
                Send quote
              </Button>
            </div>
            {quoteItems ? (
              <p className="text-sm text-muted-foreground">Total {formatMoney(money(currency, quoteTotalMinor(quoteItems)))}</p>
            ) : (
              <p className="text-sm text-destructive">Each line needs a description and an amount above zero.</p>
            )}
            {addQuote.error ? <p className="text-sm text-destructive">{addQuote.error.message}</p> : null}
          </form>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Amendments</h2>
        {amendments.length === 0 ? <p className="text-sm text-muted-foreground">No amendments.</p> : null}
        {amendments.map((amendment) => (
          <div key={amendment.id} className="rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {amendment.deltaMinor > 0 ? "+" : ""}
                {formatMoney(money(currency, amendment.deltaMinor))} → {formatMoney(money(currency, amendment.newAmountMinor))}
              </p>
              <span className="text-muted-foreground">{amendment.status}</span>
            </div>
            {amendment.note ? <p className="mt-1">{amendment.note}</p> : null}
          </div>
        ))}
        {(project.status === "in_progress" || project.status === "delivered") &&
        !pendingAmendment &&
        canProposeAmendment({ role, actorId: viewerId, assignedFreelancerId: project.assignedFreelancerId }) &&
        currentQuote ? (
          <form onSubmit={handleAmend} className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">Propose an amendment</h3>
            <p className="text-sm text-muted-foreground">Remove lines from the current quote, or add new ones.</p>
            {currentQuote.items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={removeItemIds.includes(item.id)}
                  onCheckedChange={(checked) =>
                    setRemoveItemIds((ids) => (checked === true ? [...ids, item.id] : ids.filter((id) => id !== item.id)))
                  }
                />
                Remove “{item.description}” ({formatMoney(money(currency, item.amountMinor))})
              </label>
            ))}
            {addRows.length > 0 ? <ItemRowsEditor rows={addRows} onChange={setAddRows} /> : null}
            {addRows.length === 0 ? (
              <Button type="button" variant="outline" onClick={() => setAddRows([{ ...EMPTY_ROW }])}>
                Add a line
              </Button>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="amendment-note">Note for the client</Label>
              <Textarea id="amendment-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="submit" disabled={proposeAmendment.isPending || (addRows.length === 0 && removeItemIds.length === 0)}>
              Propose amendment
            </Button>
            {proposeAmendment.error ? <p className="text-sm text-destructive">{proposeAmendment.error.message}</p> : null}
          </form>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Payments</h2>
        {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet. The deposit is created when the client accepts a quote.</p> : null}
        {payments.map((payment) => (
          <div key={payment.id} className="rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium capitalize">{payment.kind.replace("_", "-")}</p>
              <span className="text-muted-foreground">{payment.status}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {payment.lines.map((line, index) => (
                <li key={index} className="flex justify-between gap-4">
                  <span>{line.label}</span>
                  <span>{formatMoney(money(currency, line.amountMinor))}</span>
                </li>
              ))}
            </ul>
            {payment.status === "pending" ? (
              <p className="mt-2 text-muted-foreground">Waiting for the client. Payment capture ships in a later plan.</p>
            ) : null}
          </div>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin
git commit -m "feat(web): add the project detail page with assign, quote and amendment forms" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 21: The client project page

**Files:**
- Create: `apps/web/src/app/(site)/c/[token]/page.tsx`, `apps/web/src/app/(site)/c/[token]/client-project.tsx`

Served by the www host (Fact 21). The client sees the project, the quotes and the pending amendment, and can accept the quote or answer the amendment. Payment rows show a disabled **Pay with PayPal** button with the note "Payment coming soon" — capture is S6's.

- [ ] **Step 1: Create the pages**

`apps/web/src/app/(site)/c/[token]/page.tsx`:
```tsx
import ClientProject from "./client-project";

export default async function ClientProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientProject token={token} />;
}
```

`apps/web/src/app/(site)/c/[token]/client-project.tsx`:
```tsx
"use client";

import { formatMoney, money, projectStatusLabel, type MoneyCurrency } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

// The client project page (services spec §5.2): the signed link is the credential, so this page
// works without an account. Accepting a quote or an amendment is one click from here.
export default function ClientProject({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const view = useQuery({ ...trpc.project.clientGet.queryOptions({ token }), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.project.clientGet.queryOptions({ token }).queryKey });

  const acceptQuote = useMutation(trpc.project.clientAcceptQuote.mutationOptions({ onSuccess: refresh }));
  const acceptAmendment = useMutation(trpc.project.clientAcceptAmendment.mutationOptions({ onSuccess: refresh }));
  const declineAmendment = useMutation(trpc.project.clientDeclineAmendment.mutationOptions({ onSuccess: refresh }));

  if (view.isPending) return <Loader />;
  if (view.isError) {
    return (
      <main className="container mx-auto max-w-2xl space-y-4 px-4 py-16">
        <h1 className="text-2xl font-semibold">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">Ask the team to send you the project link again.</p>
      </main>
    );
  }

  const { project, quotes, amendments, payments } = view.data;
  const currency = project.currency as MoneyCurrency;
  const pendingPayments = payments.filter((p) => p.status === "pending");
  const actionError = acceptQuote.error ?? acceptAmendment.error ?? declineAmendment.error;

  return (
    <main className="container mx-auto max-w-2xl space-y-8 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground">{projectStatusLabel(project.status)}</p>
        {project.brief ? <p className="text-sm">{project.brief}</p> : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Quotes</h2>
        {quotes.length === 0 ? <p className="text-sm text-muted-foreground">The team is preparing your quote.</p> : null}
        {quotes.map((quote) => (
          <div key={quote.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {formatMoney(money(currency, quote.amountMinor))} · delivery in {quote.deliveryDays} days
              </p>
              <span className="text-sm text-muted-foreground">{quote.status === "proposed" ? "Waiting for you" : quote.status}</span>
            </div>
            <ul className="space-y-1 text-sm">
              {quote.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4">
                  <span>{item.description}</span>
                  <span>{formatMoney(money(currency, item.amountMinor))}</span>
                </li>
              ))}
            </ul>
            {quote.status === "proposed" && project.status === "quoting" ? (
              <Button
                disabled={acceptQuote.isPending}
                onClick={() => acceptQuote.mutate({ token, quoteId: quote.id })}
              >
                Accept quote
              </Button>
            ) : null}
          </div>
        ))}
      </section>

      {amendments.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Amendments</h2>
          {amendments.map((amendment) => (
            <div key={amendment.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {amendment.deltaMinor > 0 ? "+" : ""}
                  {formatMoney(money(currency, amendment.deltaMinor))} → new total{" "}
                  {formatMoney(money(currency, amendment.newAmountMinor))}
                </p>
                <span className="text-sm text-muted-foreground">{amendment.status === "pending" ? "Waiting for you" : amendment.status}</span>
              </div>
              {amendment.addItems.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {amendment.addItems.map((item, index) => (
                    <li key={index} className="flex justify-between gap-4">
                      <span>+ {item.description}</span>
                      <span>{formatMoney(money(currency, item.amountMinor))}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {amendment.note ? <p className="text-sm">{amendment.note}</p> : null}
              {amendment.status === "pending" ? (
                <div className="flex gap-2">
                  <Button
                    disabled={acceptAmendment.isPending || declineAmendment.isPending}
                    onClick={() => acceptAmendment.mutate({ token, amendmentId: amendment.id })}
                  >
                    Accept amendment
                  </Button>
                  <Button
                    variant="outline"
                    disabled={acceptAmendment.isPending || declineAmendment.isPending}
                    onClick={() => declineAmendment.mutate({ token, amendmentId: amendment.id })}
                  >
                    Decline
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {payments.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Payments</h2>
          {payments.map((payment) => (
            <div key={payment.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between text-sm">
                <p className="font-medium capitalize">{payment.kind.replace("_", "-")}</p>
                <span className="text-muted-foreground">{payment.status}</span>
              </div>
              <ul className="space-y-1 text-sm">
                {payment.lines.map((line, index) => (
                  <li key={index} className="flex justify-between gap-4">
                    <span>{line.label}</span>
                    <span>{formatMoney(money(currency, line.amountMinor))}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-4 font-medium">
                  <span>Total</span>
                  <span>{formatMoney(money(currency, payment.amountMinor))}</span>
                </li>
              </ul>
              {payment.status === "pending" ? (
                <div className="space-y-1">
                  <Button disabled>Pay with PayPal</Button>
                  <p className="text-xs text-muted-foreground">Payment coming soon — the team will share the pay link shortly.</p>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {pendingPayments.length === 0 && quotes.every((q) => q.status !== "proposed") && amendments.every((a) => a.status !== "pending") ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting for you right now.</p>
      ) : null}
      {actionError ? <p className="text-sm text-destructive">{actionError.message}</p> : null}
    </main>
  );
}
```

- [ ] **Step 2: Type check and full suite**

Run: `pnpm check-types && pnpm test`
Expected: everything passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): add the client project page at /c/{token}" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 22: Final check, dev migration and merge

**Files:** none (git only, plus the manual browser pass).

- [ ] **Step 1: Rebase onto main**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/s4-ledger-projects
git rebase main
```

Expected: a clean rebase. If it conflicts, another workstream landed — stop and report instead of resolving blind.

- [ ] **Step 2: Regenerate the migration if main gained one (execution doc §1.5)**

Check `ls packages/db/src/migrations`. If a migration newer than Task 11's appeared on `main`:

1. Delete the branch's migration folder: `rm -r packages/db/src/migrations/<timestamp>_s4_ledger_projects` (confirm the folder name with `ls` first).
2. Regenerate: `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name s4_ledger_projects`. Re-append the immutability trigger block from Task 11 step 3. Read the SQL: it must create S4's tables and nothing else (no drops, no unrelated alters).
3. Rebuild the migration commit: `git add packages/db/src/migrations packages/db/src/schema`, then `git commit --fixup <sha>` where `<sha>` is the Task 11 commit `feat(db): add project, quote, payment, ledger and outbox tables` (find it with `git log --oneline main..HEAD`), then `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main` (S1 Task 17 uses the same pattern; git 2.43 replays the fixup non-interactively).

- [ ] **Step 3: Migrate the dev database**

```bash
pnpm db:migrate:dev
```

The shared dev database takes the final migration shape exactly once, here — after any regeneration (S1's "Migration timing" decision).

- [ ] **Step 4: Full check**

```bash
pnpm install --frozen-lockfile && pnpm test && pnpm check-types
```

Expected: everything passes on the rebased tree.

- [ ] **Step 5: Manual browser pass (scheduled by the controller)**

Only one dev stack runs at a time, so the controller schedules this pass; it may run right before the merge or after it. With `pnpm dev` running (API on port 3000, web on 3001):

1. Open `http://admin.localhost:3001/team/projects`, create a project with a client email, and confirm the redirect lands on the project detail page, which shows the client link with a copy button.
2. On `http://admin.localhost:3001/team/projects/<projectId>`: assign a freelancer, add a quote with two items, propose an amendment, and confirm each action refreshes the data.
3. Open the copied link at `http://localhost:3001/c/<token>`, accept the quote, and confirm the deposit payment appears with the disabled **Pay with PayPal** button and the "Payment coming soon" note.

- [ ] **Step 6: Merge into main**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git merge --no-ff s4-ledger-projects -m "Merge branch 's4-ledger-projects': projects, quotes and the ledger (S4 part B)" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

- [ ] **Step 7: Clean up**

```bash
git -C /home/mouhamed/dev/repos/jendal/jendal-workspace worktree remove /home/mouhamed/dev/repos/jendal/worktrees/s4-ledger-projects
git -C /home/mouhamed/dev/repos/jendal/jendal-workspace branch -d s4-ledger-projects
```

---

## Decisions made while planning

| Decision | Rationale |
|---|---|
| Money is `number` integer minor units, capped by `MAX_AMOUNT_MINOR` | Matches `bigint … { mode: "number" }` columns; percentages in basis points; `bpsOf` uses BigInt internally so the multiply never overflows |
| Every percentage rounds half-up once, at the line it produces (§5.3) | The §5.3 worked example ($3.10 fee on $600, $127.50 cut) pins the rounding; tests assert it |
| `balanceDue` credits the overpaid **management fee** first, then the quote part | §5.5's decrease example credits the overpaid management fee ($30) before the deposit remainder ($150), and §5.3 line 144 refunds the difference on the deposit capture; the management fee exists only while its quote version does, so it unwinds first |
| `amendmentEffect` is a difference of rounded totals, not a rounded difference — **accepted by the controller on 2026-10-06** | §5.5's $240 example is round-numbered, so both readings agree there; they differ on odd amounts. Quote 1,001 → 1,004 (Δ3): this plan's top-up is 502 − 501 plus 100 − 100 = **1**, while "50% of the increase + fee on the increase" read literally gives round(1.5) + round(0.3) = **2**. The difference-of-rounded-totals reading keeps deposit + top-ups + balance summing to exactly what the current quote version requires; the test suite pins the 1,001 → 1,004 case (`amendments.test.ts`). If the controller prefers the literal reading, Task 3 changes |
| Guards live in the transition table, not in use cases | `accept_delivery`/`balance_captured` refuse with a pending amendment or unpaid top-up no matter which surface calls them |
| `projectStatusLabel` lives in core | The admin and client pages and future Discord messages share one label source |
| Seeded PRNG (`testing/random.ts`, mulberry32) instead of fast-check | No new dependency; failures print the seed and reproduce |
| `Ledger` port with `createMemoryLedger` in core and `createPostgresLedger` in db | Part A is DB-free; Part B swaps the adapter, and both share `validateTransfers` |
| A duplicate `reference` is rejected, never skipped — both adapters | The posting builders key every transfer by reference, so a duplicate is a bug a skip would hide. The §6.4 at-most-once guarantee still holds: a retrying caller (S6's `applyPayPalFact` consumer) catches `LedgerError("duplicate_reference")` as "already applied". The memory and Postgres ledgers behave identically and both are tested |
| Per-account `ledger_balance` rows (a table beyond the contract's list) | Balances must be locked to enforce "owed never below zero" under concurrency; a table of current balances is the lockable, cheap-to-read form. Derived: `ledgerBalancesFromEntries` rebuilds it from `ledger_entry`, and a test asserts they match |
| Balance rows are created `insert … on conflict do nothing` then read `select … for update`, in the sorted order `balanceDeltas` returns | The insert guarantees a row exists to lock on first use; the fixed order makes concurrent postings on overlapping accounts serialize without deadlocks; the concurrency test proves exactly one of two racing reservations succeeds |
| Ledger rows immutable via trigger; **all** ledger-table FKs are `restrict` (no cascade anywhere in `ledger.ts`) | §6.1 point 3 bans UPDATE/DELETE on transfers and entries; a team with ledger history cannot be deleted at all. `ledger_balance` is a derived cache, but gets the same `restrict` treatment — deleting a team must never silently discard money state |
| `uow.apply` order: compare-and-set → ledger → outbox | A version conflict fails before any ledger lock is taken; outbox sequences are per project and gapless |
| Client link = HMAC-SHA256(projectId) with a key derived from `auth.options.secret` and the label `payleor client link v1` | No new env var, no token table. The spec defines no expiry or revocation for client links (§5.2), so S4 ships none; a token-version column on `project` can add revocation later without changing the token format |
| `/c/{token}` lives in the `(site)` tree on the www host | The client has no account and no store context; host routing already passes it through (Fact 21) |
| `payment` enum value is `top_up` | Contract §4.2-style snake case in DB values; prose says "top-up" |
| `project.assigned` added to `OUTBOX_EVENT_TYPES` | The assign use case emits it; the spec's event list is a minimum |
| `paymentLines` label strings come from core | The deposit/top-up/balance amount lines must read identically in the admin, client page and emails |
| `amendment` stores its full shape (base quote, `add_items` / `remove_item_ids` jsonb, `delta_minor`, `new_amount_minor`, `management_fee_credit_minor`) | The client page renders a pending amendment without replaying item math, and `getProjectFacts` sums accepted fee credits for `balanceDue` without joining quotes |
| A lost compare-and-set race maps to tRPC `CONFLICT` | `ProjectConflictError` is a db-layer signal; `runProjectTransaction` translates it at the use-case boundary so web and bot callers get a 409 with "reload and try again", not a 500 |
| `clientGet` returns only what the client page renders | Link holders are anonymous; internal user ids (`freelancerId`, `authorId`, `proposedById`) and the PayPal order/capture ids stay server-side |
| Route folder stays `[storeSlug]` under `admin/` | S1 owns the admin shell and its param name; S4 follows it |
| Quoting permissions read S1's `QuotingMode` | One source for the three quoting modes; duplicating the type would drift the moment S1 extends it |

## Changes made during execution

| Task | Change | Why |
|---|---|---|
| 8 | The merge into `main` was not run; Part A ends at `dd7ec924c60d870aa6d202626aa859d7313ed728` (Task 7) | The controller merges Part A at that SHA |
| 9 | No rebase: the branch was created from `main` at `6e79775`, which already held S1. `main` later moved (S3, S5, a ui fix) and the branch was not rebased onto it | The controller asked for no rebase during execution; Task 22 rebases |
| 9 | S1's real code matches the contract this plan relies on: `findServicesTeamBySlug`, `getServicesTeamSettings`, `servicesTeamRoleFor` (taking `Database`), `ServicesTeamSettings` with `currency`, `teamCutBps`, `managementFeeBps`, `quotingMode`; `servicesTeamProcedure` with `ctx.servicesTeam` and `ctx.servicesTeamRole`; admin route folder `[storeSlug]` | No call site needed adapting |
| 11 | Added `servicesTeamMember` to the `../schema/services-teams` import in `packages/db/src/testing/db.ts` | S1's helpers import only `servicesTeamSettings`; `seedServicesTeamMember` needs both |
| 13, 14 | Task 14 (`projects.ts`) was committed before Task 13 (unit of work) | Task 13's test imports `findProjectById` from `./projects`, so it cannot pass before Task 14's file exists |
| 17, 18 | The core import in `use-cases/projects.ts` is kept in alphabetical order (`paymentLines` after `managementFeeCreditTransfer`) | Task 17 places `paymentLines` before `transitionRefusalMessage`; Task 18's additions re-sort the list |
| 18 | `proposeAmendment` is inserted after `addQuote`, before `clientGet`; `clientAcceptAmendment` and `clientDeclineAmendment` are appended at the end. The two-line comment fragment in the Task 18 router block is not copied | The fragment is the start of `clientGet`'s existing comment, so it marks where `proposeAmendment` goes; copying it would leave a broken duplicate comment |
