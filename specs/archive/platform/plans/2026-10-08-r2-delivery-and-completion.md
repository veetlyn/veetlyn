# Run 2: Delivery, Acceptance, Balance and Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project goes all the way: the assigned freelancer (or staff) submits a delivery with a note and a link; the client accepts it or requests changes on the client page; accepting fixes the final price and opens the balance payment on the pay page (or completes at once when nothing is due); the balance capture completes the project and posts the completion entries (team cut to the team's revenue, the freelancer's earnings to what the team owes them).

**Architecture:** `db` gains a `delivery` table and `project.final_price_minor`. `core` gains a delivery-submit permission, two outbox event types and a pure `completionPostings` helper (completion transfer, plus a refund transfer when amendments left the client overpaid). `api` gains `submitDelivery`, `requestChanges` and `acceptDelivery`, completes the project on the balance capture, lets balance payments start, and exposes deliveries on the staff and client views. The admin project page gains a Deliver form and the delivery list; the client page gains the delivery with Accept delivery / Request changes, and pays the balance through the existing pay page.

**Tech Stack:** TypeScript, Drizzle ORM 1.0 rc, tRPC 11, React 19 on vinext, TanStack Query 5, Vitest 5.

**Spec:** [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) §5.1–5.3, §5.5 (balance rule), §6.3 (completion and refund postings); [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §4.3 and §11 (run 2).

**Builds on:** `main` at `71728fe` (R1c merged; 864 tests).

**Decisions for this run:**
- **Final price = the current quote's total.** Deadline penalties are out of the minimal version (sellers design §4.3), so the penalty is 0.
- **A delivery is a note and/or an `https` link.** The optional file (R2, up to 100 MB) is run 2b: it needs a private bucket, an upload route and signed downloads.
- **Overpaid after a decrease:** when amendments leave the client paid above the final price, accepting completes the project and posts `refund_requested` (client money → `client_refunds`) with a `refund.requested` event; the client page shows the amount owed. The team refunds in PayPal; matching PayPal's refund (the parked `PAYMENT.CAPTURE.REFUNDED`) to it is run 4.
- **Who delivers:** the assigned freelancer, or a manager/admin of the team.
- **Request changes** keeps a note from the client and counts a revision (`project.revisions + 1`).

**Out of scope:** delivery files (2b); penalties and cases; payouts (run 5); notifications from the outbox (later); Discord `/deliver`.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/r2-delivery`, created in Task 0. Tests needing Postgres use `jendal-pg` through `.env.test.local`. The full suite takes about 6 minutes; run targeted tests per task.

## Facts this plan relies on (checked in the code at `71728fe`)

1. `transitionProject` already has `submit_delivery` (in_progress → delivered), `request_changes` (delivered → in_progress), `accept_delivery` (delivered → awaiting_balance, or completed when `facts.balanceDueMinor` is 0; refused while an amendment is pending or a top-up unpaid) and `balance_captured` (awaiting_balance → completed). `packages/core/src/projects/state-machine.ts`.
2. `balanceDue(input)` returns `{ dueMinor, quotePartMinor, managementFeePartMinor, refundMinor, refundQuoteMinor, refundManagementFeeMinor }`; `getProjectFacts(tx, projectId)` returns the `ProjectPaid` sums plus `pendingAmendment` and `unpaidTopUp`. `packages/core/src/projects/pricing.ts`, `packages/db/src/repositories/projects.ts:73-110`.
3. `completionTransfer({ currency, projectId, freelancerId, finalPriceMinor, teamCutBps })` (reference `completion:{projectId}`) and `refundRequestedTransfer({ currency, projectId, refundId, quotePartMinor, managementFeeMinor })` exist in `packages/core/src/ledger/postings.ts`; nothing posts them yet.
4. `paymentLines("balance", split, bps)` labels the quote part "Balance". `payment_balance_idx` allows one balance payment per project.
5. Use-case pattern: `runProjectTransaction(db, (tx, uow) => …)`, `requireProject`, `requireTeamProject`, `checkTransition(status, event, facts)`, `uow.apply({ project, set, transfers, events })`, `fail(code, message)`. `packages/api/src/use-cases/projects.ts` (see `acceptQuote` at ~line 220).
6. The balance hook: `projectChangeOnCapture` in `packages/api/src/use-cases/payments.ts` throws for `kind === "balance"`; `startPayment` refuses balances ("Balance payments open once deliveries can be accepted."); `clientGet` gives no `payPath` to balances; `apps/web/src/lib/pay-page.ts` shows balances as closed.
7. `project` has `assignedFreelancerId`, `teamCutBps`, `managementFeeBps`, `revisions`, `deadlineAt`, `currency`. `outbox.type` is plain text (no database enum).

## Files

| File | Change |
|---|---|
| `packages/db/src/schema/projects.ts` | `delivery` table; `project.finalPriceMinor` |
| `packages/db/src/migrations/<ts>_r2_deliveries/` | Generated |
| `packages/db/src/repositories/projects.ts` | `listProjectDeliveries` |
| `packages/db/src/testing/db.ts` | Truncate `delivery` |
| `packages/core/src/projects/events.ts`, `permissions.ts` (+tests) | Event types; `canSubmitDelivery` |
| `packages/core/src/projects/completion.ts` (+test), `index.ts` | `completionPostings` |
| `packages/api/src/use-cases/projects.ts` | `submitDelivery`, `requestChanges`, `acceptDelivery` |
| `packages/api/src/use-cases/payments.ts` | Balance capture completes; balances can start |
| `packages/api/src/routers/project.ts` (+test) | `deliver`, `clientRequestChanges`, `clientAcceptDelivery`; deliveries in `get` and `clientGet`; balance `payPath` |
| `packages/api/src/routers/payment.test.ts`, `project.test.ts` | Tests |
| `apps/web/src/lib/pay-page.ts` (+test) | Balance is payable |
| `apps/web/src/lib/delivery.ts` (+test) | `deliveryDraftProblem`, labels |
| `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx` | Deliveries section and Deliver form |
| `apps/web/src/app/(site)/c/[token]/client-project.tsx` | Delivery decision, completion and refund notes |

---

### Task 0: Worktree

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git status --short   # must be empty
git worktree add -b r2-delivery ../r2-delivery main
cp .env.test.local ../r2-delivery/.env.test.local
cd ../r2-delivery && pnpm install && pnpm check-types
```

---

### Task 1: Schema, events, permission and completion postings

**Files:** `packages/db/src/schema/projects.ts`, migration, `packages/db/src/repositories/projects.ts`, `packages/db/src/testing/db.ts`, `packages/core/src/projects/events.ts`, `permissions.ts` (+test), `completion.ts` (+test), `packages/core/src/index.ts`.

- [ ] **Step 1: Core tests first.** In `packages/core/src/projects/permissions.test.ts` add:

```ts
  describe("canSubmitDelivery", () => {
    it("lets the assigned freelancer and staff deliver, and no one else", () => {
      const project = { assignedFreelancerId: "u1" };
      expect(canSubmitDelivery({ role: "freelancer", actorId: "u1", ...project })).toBe(true);
      expect(canSubmitDelivery({ role: "freelancer", actorId: "u2", ...project })).toBe(false);
      expect(canSubmitDelivery({ role: "manager", actorId: "u2", ...project })).toBe(true);
      expect(canSubmitDelivery({ role: "admin", actorId: "u3", ...project })).toBe(true);
    });
  });
```

`packages/core/src/projects/completion.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { balanceDue } from "./pricing";
import { completionPostings } from "./completion";

const base = { currency: "USD", projectId: "p1", freelancerId: "f1", teamCutBps: 1_500 } as const;

describe("completionPostings", () => {
  it("splits the final price into the team cut and the freelancer's earnings (§5.3: $1,000 → $150 and $850)", () => {
    const balance = balanceDue({
      quoteMinor: 100_000,
      managementFeeBps: 1_000,
      finalPriceMinor: 100_000,
      paidQuoteMinor: 100_000,
      paidManagementFeeMinor: 10_000,
      managementFeeCreditedMinor: 0,
    });
    const { transfers, refundMinor } = completionPostings({ ...base, finalPriceMinor: 100_000, balance });
    expect(refundMinor).toBe(0);
    expect(transfers.map((t) => t.reference)).toEqual(["completion:p1"]);
    expect(transfers[0]?.entries).toEqual(
      expect.arrayContaining([
        { account: "client_held:p1", currency: "USD", amountMinor: -100_000 },
        { account: "team_revenue", currency: "USD", amountMinor: 15_000 },
        { account: "owed:f1:available", currency: "USD", amountMinor: 85_000 },
      ]),
    );
  });

  it("adds a refund when a decrease left the client overpaid", () => {
    // $1,000 quote, $600 deposit paid, decreased by $700 → quote $300, fee credit $70, refund $270.
    const balance = balanceDue({
      quoteMinor: 30_000,
      managementFeeBps: 1_000,
      finalPriceMinor: 30_000,
      paidQuoteMinor: 50_000,
      paidManagementFeeMinor: 10_000,
      managementFeeCreditedMinor: 7_000,
    });
    const { transfers, refundMinor } = completionPostings({ ...base, finalPriceMinor: 30_000, balance });
    expect(refundMinor).toBe(27_000);
    expect(transfers.map((t) => t.reference)).toEqual(["completion:p1", "refund_requested:completion-p1"]);
  });

  it("posts nothing to complete a project whose final price is zero", () => {
    const balance = balanceDue({
      quoteMinor: 0,
      managementFeeBps: 0,
      finalPriceMinor: 0,
      paidQuoteMinor: 0,
      paidManagementFeeMinor: 0,
      managementFeeCreditedMinor: 0,
    });
    expect(completionPostings({ ...base, finalPriceMinor: 0, balance }).transfers).toEqual([]);
  });
});
```

(`refundRequestedTransfer`'s reference is `refund_requested:{refundId}`; with `refundId: \`completion-${projectId}\`` that gives the expected string. Check `balanceDue`'s asserts accept a 0 quote; if they do not, drop the third test and say so.)

- [ ] **Step 2: Run** `pnpm test packages/core/src/projects` — Expected: FAIL.

- [ ] **Step 3: Implement core.**
  - `events.ts`: add `"delivery.changes_requested"` after `"delivery.submitted"` and `"refund.requested"` after `"project.completed"`.
  - `permissions.ts`:

```ts
// Services spec §5.2 step 5: the assigned freelancer submits the delivery; staff can submit it for them.
export function canSubmitDelivery(input: { role: ServicesTeamRole; actorId: string; assignedFreelancerId: string | null }): boolean {
  return isProjectStaff(input.role) || input.actorId === input.assignedFreelancerId;
}
```

  - `completion.ts`:

```ts
import type { MoneyCurrency } from "../money/money";
import { completionTransfer, refundRequestedTransfer } from "../ledger/postings";
import type { LedgerTransferDraft } from "../ledger/transfers";
import type { Balance } from "./pricing";

// Services spec §6.3: on completion the final price leaves client_held as the team cut and the freelancer's
// earnings; money the client paid above the final price (amendment decreases) is owed back to them.
export function completionPostings(input: {
  currency: MoneyCurrency;
  projectId: string;
  freelancerId: string;
  finalPriceMinor: number;
  teamCutBps: number;
  balance: Balance;
}): { transfers: LedgerTransferDraft[]; refundMinor: number } {
  const transfers: LedgerTransferDraft[] = [];
  if (input.finalPriceMinor > 0) {
    transfers.push(
      completionTransfer({
        currency: input.currency,
        projectId: input.projectId,
        freelancerId: input.freelancerId,
        finalPriceMinor: input.finalPriceMinor,
        teamCutBps: input.teamCutBps,
      }),
    );
  }
  if (input.balance.refundMinor > 0) {
    transfers.push(
      refundRequestedTransfer({
        currency: input.currency,
        projectId: input.projectId,
        refundId: `completion-${input.projectId}`,
        quotePartMinor: input.balance.refundQuoteMinor,
        managementFeeMinor: input.balance.refundManagementFeeMinor,
      }),
    );
  }
  return { transfers, refundMinor: input.balance.refundMinor };
}
```

  (If `completionTransfer` throws on a zero team cut or zero earnings because `transferFromMoves` filters zeros but asserts amounts, check its behaviour with `teamCutBps: 0` in a test and handle it.) Export `completionPostings` and `canSubmitDelivery` the way their neighbours are exported from `packages/core/src/index.ts`.

- [ ] **Step 4: Schema.** In `packages/db/src/schema/projects.ts`, add to `project` after `deadlineAt`:

```ts
    // The price the client accepted the delivery at (services spec §5.3); null until then.
    finalPriceMinor: minor("final_price_minor"),
```

and a table after `payment`:

```ts
export const DELIVERY_STATUSES = ["submitted", "accepted", "changes_requested"] as const;

// Services spec §5.2 step 5: what the freelancer handed over, and the client's answer.
export const delivery = pgTable(
  "delivery",
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
    submittedById: text("submitted_by_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    link: text("link"),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("submitted"),
    // The client's request when they asked for changes.
    clientNote: text("client_note").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [
    index("delivery_projectId_idx").on(t.projectId),
    // One delivery waits for the client at a time.
    uniqueIndex("delivery_open_idx").on(t.projectId).where(sql`status = 'submitted'`),
  ],
);
```

  (Use the imports the file already has for `user`, `team`, `index`, `uniqueIndex`, `sql`, `minor`.) Add `"delivery", ` before `"payment", ` in the truncate list of `packages/db/src/testing/db.ts`.

  In `packages/db/src/repositories/projects.ts` add:

```ts
export async function listProjectDeliveries(tx: DbExecutor, projectId: string) {
  return tx.select().from(delivery).where(eq(delivery.projectId, projectId)).orderBy(asc(delivery.createdAt), asc(delivery.id));
}
```

- [ ] **Step 5: Migration**

```bash
DATABASE_URL="$(sed -n 's/^TEST_DATABASE_URL=//p' .env.test.local)" pnpm -F @jendal-workspace/db db:generate --name r2_deliveries
```

Expected: create `delivery` (with its index and partial unique index) and add `project.final_price_minor`. Nothing else.

- [ ] **Step 6: Run** `pnpm test packages/core packages/db` and check-types for core, db, api. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core packages/db
git commit -m "feat(db,core): deliveries, the final price and completion postings" -m "A delivery table with one open delivery per project, project.final_price_minor, a delivery-submit permission, and completionPostings: the completion transfer plus a refund transfer when amendments left the client overpaid." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 2: Deliver, request changes, accept

**Files:** `packages/api/src/use-cases/projects.ts`, `packages/api/src/routers/project.ts`, `packages/api/src/routers/project.test.ts`.

- [ ] **Step 1: Failing router tests** in `project.test.ts`. Add a helper that runs a project to `in_progress`: create, assign the freelancer, quote `ITEMS` ($1,000), accept with the client token, then capture the deposit with `applyCaptureFact` (import it and build the fact as `payment.test.ts` does: set `paypalOrderId: "ORDER1"` on the payment row first; fact `{ paymentId, orderId: "ORDER1", captureId: "CAPTURE1", status: "COMPLETED", amountMinor: 60_000, currency: "USD", capturedAt: null, paypalFeeMinor: null, platformFeeMinor: null }`). Return `{ userId, freelancer, projectId, token, teamId }`. Tests:

  1. **Delivers and asks the client:** the freelancer calls `project.deliver({ teamSlug: "team", projectId, note: "Here it is", link: "https://example.com/files" })`; the project is `delivered`; `clientGet` returns `deliveries: [{ id, status: "submitted", note: "Here it is", link: "https://example.com/files", clientNote: "", createdAt }]`; the outbox has `delivery.submitted`. A second `deliver` is refused (`BAD_REQUEST`, the transition message).
  2. **Who may deliver:** another freelancer of the team gets `FORBIDDEN`; a manager succeeds. Input rules: neither note nor link → `BAD_REQUEST` "Add a note or a link."; `link: "http://x"` or `"javascript:alert(1)"` → `BAD_REQUEST` "Use an https link.".
  3. **Request changes:** `project.clientRequestChanges({ token, deliveryId, note: "Make the logo bigger" })` → project `in_progress`, `revisions` 1, delivery `changes_requested` with the note and `decidedAt`; outbox `delivery.changes_requested`. The freelancer can deliver again.
  4. **Accept with a balance:** `project.clientAcceptDelivery({ token, deliveryId })` → `{ status: "awaiting_balance", balancePaymentId }`; project `awaiting_balance` with `finalPriceMinor` 100_000; a pending balance payment of `50_000` with lines `[{ kind: "balance", label: "Balance", amountMinor: 50_000 }]` (the $100 fee was paid with the deposit); delivery `accepted`; outbox `delivery.accepted` and `payment.created`; `clientGet` gives the balance a `payPath`.
  5. **Accept with nothing due completes:** set up with the deposit plus a captured balance-sized top-up is awkward, so instead accept a quote of $1,000, capture the deposit, then insert directly a captured `top_up` payment row of `quotePartMinor: 50_000, managementFeeMinor: 0, amountMinor: 50_000` and the matching `paymentCapturedTransfer` through `createPostgresLedger(teamId, tx).post([...])` inside `db.transaction` (the ledger must hold the money the facts say was paid). Deliver, accept → `{ status: "completed", balancePaymentId: null }`; project `completed`; ledger: `client_held:{p}` 0, `team_revenue` 10_000 + 15_000, `owed:{freelancer}:available` 85_000; outbox `delivery.accepted`, `project.completed`.
  6. **Accept is refused while an amendment waits:** propose an amendment after delivering (allowed in `delivered`), then `clientAcceptDelivery` → `BAD_REQUEST` "An amendment is waiting for the client's answer."
  7. **Tokens and ids:** a delivery id from another project, or a delivery already decided → `BAD_REQUEST` "This delivery is not waiting for an answer."

- [ ] **Step 2: Run** `pnpm test packages/api/src/routers/project.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the use-cases** in `packages/api/src/use-cases/projects.ts` (import `canSubmitDelivery`, `balanceDue`, `finalPriceMinor`, `completionPostings`, `paymentLines` from core; `delivery` from the schema; `getProjectFacts`):

```ts
const MAX_NOTE = 5_000;
const MAX_LINK = 2_000;

function deliveryInput(input: { note: string; link: string }): { note: string; link: string | null } {
  const note = input.note.trim();
  const link = input.link.trim();
  if (!note && !link) fail("BAD_REQUEST", "Add a note or a link.");
  if (note.length > MAX_NOTE) fail("BAD_REQUEST", "The note is too long.");
  if (link) {
    let url: URL | null = null;
    try {
      url = new URL(link);
    } catch {
      url = null;
    }
    // The client opens it from the client page, so only web links are allowed.
    if (!url || url.protocol !== "https:" || link.length > MAX_LINK) fail("BAD_REQUEST", "Use an https link.");
  }
  return { note, link: link || null };
}

// Services spec §5.2 step 5.
export async function submitDelivery(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; note: string; link: string },
): Promise<{ deliveryId: string }> {
  const fields = deliveryInput(input);
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    if (!canSubmitDelivery({ role: actor.role, actorId: actor.actorId, assignedFreelancerId: row.assignedFreelancerId })) {
      fail("FORBIDDEN", "Only the assigned freelancer or a manager can deliver.");
    }
    const status = checkTransition(row.status, "submit_delivery");
    const deliveryId = crypto.randomUUID();
    await uow.apply({ project: row, set: { status }, events: [{ type: "delivery.submitted", data: { deliveryId } }] });
    await tx.insert(delivery).values({ id: deliveryId, projectId: row.id, teamId: row.teamId, submittedById: actor.actorId, ...fields });
    return { deliveryId };
  });
}

async function requireOpenDelivery(tx: Transaction, projectId: string, deliveryId: string) {
  const [found] = await tx
    .select()
    .from(delivery)
    .where(and(eq(delivery.id, deliveryId), eq(delivery.projectId, projectId)))
    .limit(1);
  if (!found || found.status !== "submitted") fail("BAD_REQUEST", "This delivery is not waiting for an answer.");
  return found;
}

// Services spec §5.2 step 5: the client sends the work back; each request counts a revision.
export async function requestChanges(
  db: Database,
  input: { projectId: string; deliveryId: string; note: string },
): Promise<void> {
  const note = input.note.trim();
  if (!note) fail("BAD_REQUEST", "Say what should change.");
  if (note.length > MAX_NOTE) fail("BAD_REQUEST", "The note is too long.");
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const found = await requireOpenDelivery(tx, row.id, input.deliveryId);
    const status = checkTransition(row.status, "request_changes");
    await uow.apply({
      project: row,
      set: { status, revisions: row.revisions + 1 },
      events: [{ type: "delivery.changes_requested", data: { deliveryId: found.id } }],
    });
    await tx
      .update(delivery)
      .set({ status: "changes_requested", clientNote: note, decidedAt: new Date() })
      .where(eq(delivery.id, found.id));
  });
}

// Services spec §5.2 step 6 and §5.3: accepting fixes the final price. What is still due becomes the balance
// payment; with nothing due the project completes now, and an overpaid client is owed a refund.
export async function acceptDelivery(
  db: Database,
  input: { projectId: string; deliveryId: string },
): Promise<{ status: ProjectStatus; balancePaymentId: string | null }> {
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const found = await requireOpenDelivery(tx, row.id, input.deliveryId);
    const current = await requireCurrentQuote(tx, row);
    const facts = await getProjectFacts(tx, row.id);
    const finalPrice = finalPriceMinor(current.amountMinor, 0);
    const balance = balanceDue({
      quoteMinor: current.amountMinor,
      managementFeeBps: row.managementFeeBps,
      finalPriceMinor: finalPrice,
      paidQuoteMinor: facts.paidQuoteMinor,
      paidManagementFeeMinor: facts.paidManagementFeeMinor,
      managementFeeCreditedMinor: facts.managementFeeCreditedMinor,
    });
    const status = checkTransition(row.status, "accept_delivery", { ...facts, balanceDueMinor: balance.dueMinor });
    await tx.update(delivery).set({ status: "accepted", decidedAt: new Date() }).where(eq(delivery.id, found.id));

    if (status === "awaiting_balance") {
      const balancePaymentId = crypto.randomUUID();
      const split = { quotePartMinor: balance.quotePartMinor, managementFeeMinor: balance.managementFeePartMinor, totalMinor: balance.dueMinor };
      await uow.apply({
        project: row,
        set: { status, finalPriceMinor: finalPrice },
        events: [
          { type: "delivery.accepted", data: { deliveryId: found.id, finalPriceMinor: finalPrice } },
          { type: "payment.created", data: { paymentId: balancePaymentId, kind: "balance", amountMinor: balance.dueMinor } },
        ],
      });
      await tx.insert(payment).values({
        id: balancePaymentId,
        projectId: row.id,
        teamId: row.teamId,
        kind: "balance",
        currency: row.currency,
        quotePartMinor: split.quotePartMinor,
        managementFeeMinor: split.managementFeeMinor,
        amountMinor: split.totalMinor,
        lines: paymentLines("balance", split, row.managementFeeBps),
      });
      return { status, balancePaymentId };
    }

    const freelancerId = row.assignedFreelancerId;
    if (!freelancerId) throw new Error(`Project ${row.id} completes without an assigned freelancer`);
    const { transfers, refundMinor } = completionPostings({
      currency: row.currency,
      projectId: row.id,
      freelancerId,
      finalPriceMinor: finalPrice,
      teamCutBps: row.teamCutBps,
      balance,
    });
    await uow.apply({
      project: row,
      set: { status, finalPriceMinor: finalPrice },
      transfers,
      events: [
        { type: "delivery.accepted", data: { deliveryId: found.id, finalPriceMinor: finalPrice } },
        { type: "project.completed", data: { finalPriceMinor: finalPrice } },
        ...(refundMinor > 0 ? [{ type: "refund.requested" as const, data: { amountMinor: refundMinor } }] : []),
      ],
    });
    return { status, balancePaymentId: null };
  });
}
```

  (Adjust to the file's helpers: `checkTransition`'s facts parameter, the `ProjectStatus` import, `requireCurrentQuote`. If `row.currency` is typed as a string union that `completionPostings` accepts, no cast is needed; check.)

- [ ] **Step 4: Procedures** in `routers/project.ts`:

```ts
  deliver: servicesTeamProcedure
    .input(projectIdInput.extend({ note: z.string().max(5_000).default(""), link: z.string().max(2_000).default("") }))
    .mutation(async ({ ctx, input }) => {
      return submitDelivery(ctx.db, { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id }, input);
    }),
```

  and public `clientRequestChanges` (`{ token, deliveryId: uuid, note: string max 5000 }`) and `clientAcceptDelivery` (`{ token, deliveryId: uuid }`) in the style of `clientAcceptQuote`. Add `deliveries` to `clientGet` (`id, status, note, link, clientNote, createdAt, decidedAt`; never `submittedById`) and `finalPriceMinor` to its `project`. Add deliveries (with `submittedById`) to the staff `get` procedure's result the same way it returns payments. Change `clientGet`'s `payPath` rule to every kind: `p.status === "pending" || p.status === "failed"`, and drop the "Balances open in run 2" comment line.

- [ ] **Step 5: Run** `pnpm test packages/api packages/core`, check-types for api and web. Expected: PASS (the web app may need nothing yet; if `clientGet`'s new fields break its types, report).

- [ ] **Step 6: Commit**

```bash
git add packages/api
git commit -m "feat(api): deliver, request changes and accept the delivery" -m "The assigned freelancer or staff submits a delivery; the client requests changes (a revision) or accepts it, which fixes the final price and opens the balance payment, or completes the project when nothing is due." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 3: The balance capture completes the project

**Files:** `packages/api/src/use-cases/payments.ts`, `packages/api/src/routers/payment.test.ts`, `apps/web/src/lib/pay-page.ts` (+test).

- [ ] **Step 1: Failing tests.** In `payment.test.ts`:
  1. Replace any test asserting that balances cannot start with: **a balance payment starts and its capture completes the project.** Build a project at `awaiting_balance` (deposit captured through `applyCaptureFact`, deliver, accept → balance payment), connect the team (`markTeamPayPalMerchant`), `payStart` the balance (ORDER1), capture it (fake capture of `"500.00"`): outcome `captured`; project `completed`; ledger `client_held:{p}` 0, `team_revenue` 10_000 + 15_000, `owed:{freelancer}:available` 85_000; outbox `payment.captured` then `project.completed`.
  2. **The completion posts once:** applying the same capture fact again returns `already_applied`; one `completion:{p}` transfer.
  In `apps/web/src/lib/pay-page.test.ts`: a pending balance with PayPal ready → `{ view: "pay" }`; remove the "balance opens once you accept the delivery" expectation from `payPageState`.

- [ ] **Step 2: Run** them — Expected: FAIL.

- [ ] **Step 3: Implement.** In `payments.ts`, `projectChangeOnCapture` returns the change and the postings for the balance; give it this shape:

```ts
type CaptureChange = { set: Partial<typeof project.$inferInsert>; transfers: LedgerTransferDraft[]; events: OutboxEventInput[] };
```

  and for `kind === "balance"`:

```ts
  if (kind === "balance") {
    // Services spec §5.2 step 7: the balance capture completes the project with the completion postings.
    const result = transitionProject(row.status, "balance_captured");
    if (!result.ok) throw new Error(`Project ${row.id} cannot take its balance: ${transitionRefusalMessage(result.reason)}`);
    const freelancerId = row.assignedFreelancerId;
    if (row.finalPriceMinor === null || !freelancerId) throw new Error(`Project ${row.id} has a balance without a final price or freelancer`);
    const transfer = completionTransfer({
      currency: row.currency,
      projectId: row.id,
      freelancerId,
      finalPriceMinor: row.finalPriceMinor,
      teamCutBps: row.teamCutBps,
    });
    return { set: { status: result.to }, transfers: [transfer], events: [{ type: "project.completed", data: { finalPriceMinor: row.finalPriceMinor } }] };
  }
```

  (`top_up` returns `{ set: {}, transfers: [], events: [] }`; the deposit returns its existing `set` with empty lists.) In `applyInTransaction`, pass `[paymentCapturedTransfer(...), ...change.transfers]` and `[{ type: "payment.captured", … }, ...change.events]` to `uow.apply`. The capture's own transfer must come first: completion moves money out of `client_held` that the balance capture just put in. Remove the balance refusal in `startPayment`.
  In `apps/web/src/lib/pay-page.ts`, delete the balance branch in `payPageState` (keep `paymentKindLabel`).

- [ ] **Step 4: Run** `pnpm test packages/api apps/web`, check-types for api and web. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api apps/web/src/lib
git commit -m "feat(api): complete the project when the balance is captured" -m "The balance payment can be paid on the pay page; its capture moves the project to completed and posts the team cut and the freelancer's earnings in the same transaction." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 4: The admin Deliver form and the client's decision

**Files:** `apps/web/src/lib/delivery.ts` (+test), `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx`, `apps/web/src/app/(site)/c/[token]/client-project.tsx`.

- [ ] **Step 1: Failing tests** — `apps/web/src/lib/delivery.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deliveryDraftProblem, deliveryStatusLabel } from "./delivery";

describe("deliveryDraftProblem", () => {
  it("needs a note or an https link", () => {
    expect(deliveryDraftProblem({ note: "", link: "" })).toBe("Add a note or a link.");
    expect(deliveryDraftProblem({ note: "Done", link: "" })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: "https://figma.com/file/1" })).toBeNull();
    expect(deliveryDraftProblem({ note: "", link: "http://figma.com" })).toBe("Use an https link.");
    expect(deliveryDraftProblem({ note: "", link: "not a url" })).toBe("Use an https link.");
  });
});

describe("deliveryStatusLabel", () => {
  it("names each state for the client", () => {
    expect(deliveryStatusLabel("submitted")).toBe("Waiting for your answer");
    expect(deliveryStatusLabel("accepted")).toBe("Accepted");
    expect(deliveryStatusLabel("changes_requested")).toBe("Changes requested");
  });
});
```

- [ ] **Step 2: Run** `pnpm test apps/web/src/lib/delivery.test.ts` — Expected: FAIL. **Step 3:** implement `delivery.ts` with the same rules as the server's `deliveryInput` (trimmed; `new URL`, protocol `https:`).

- [ ] **Step 4: Admin page** (`project-detail.tsx`). Read the file first and follow its patterns (sections with `h2`, `useMutation` with `trpc.project.*.mutationOptions`, invalidating the `get` query, `Label`/`Input`/`Button` from `@jendal-workspace/ui`). Add a **Deliveries** section after Amendments:
  - Each delivery: date, status, the note (whitespace kept), the link as an external link (`target="_blank" rel="noopener noreferrer"`), and the client's note when changes were requested.
  - When the project is `in_progress` and the viewer may deliver (staff, or the assigned freelancer: `canSubmitDelivery` with the role and session user id the page already has), a **Deliver** form: a textarea "Note for the client", an input "Link" (placeholder `https://`), the `deliveryDraftProblem` message under the form, and a **Submit delivery** button disabled while the draft has a problem or the mutation runs. Show the mutation's error message.
  - When the project is `delivered`: "Waiting for the client to accept the delivery or ask for changes."
  - Show the final price on the page header line once `finalPriceMinor` is set, and "Completed" status as the existing status label does.

- [ ] **Step 5: Client page** (`client-project.tsx`). Add a **Delivery** section before Payments, listing deliveries newest first:
  - The note and the link as above, and the status label.
  - For the delivery with status `submitted` while the project is `delivered`: **Accept delivery** (primary) and **Request changes** (outline), which opens a textarea "What should change?" with **Send request** (disabled while empty). Both mutations refresh `clientGet`.
  - After accepting with a balance, the Payments section shows the balance with **Pay with PayPal** (its `payPath` now exists). Remove the "The balance opens once you accept the delivery." branch.
  - When `project.status === "completed"`: "This project is complete. Thank you." Showing a refund owed to an overpaid client is deferred to run 4 (refunds); do not add a field for it now.
  - Update "Nothing is waiting for you right now." so a submitted delivery counts as waiting.

- [ ] **Step 6: Run** `pnpm test apps/web`, `pnpm -F web check-types`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): deliver from the admin, accept or request changes on the client page" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 5: Full check and merge (controller)

`pnpm test && pnpm check-types` in the worktree; merge into `main` with `--no-ff`; `pnpm install`; `pnpm db:migrate:dev`; restart the dev stack.

### Task 6: Sandbox walkthrough (controller)

On the dev stack, as Walk Through (admin and assigned freelancer of Walk Crew), with the sandbox buyer accounts from `packages/infra/.env` (read in a local script under `varlock run`, never printed):

1. New project, quote $200 (two lines), client accepts, deposit $120 paid as buyer 2.
2. Deliver with a note and a link; client requests changes; deliver again; client accepts.
3. The client page shows the balance ($100); pay it as buyer 2 on the pay page.
4. Check: project `completed`, `final_price_minor` 20000, ledger `client_held:{p}` 0, `team_revenue` up by the management fee plus the team cut (`team_cut_bps` of $200), `owed:{owner}:available` up by $200 minus the team cut; balance fees recorded by the webhook; outbox `delivery.*`, `payment.captured`, `project.completed`.
5. Record the outcome here; update the sellers design §11 and §11.1.

---

## Outcome (2026-10-08)

Merged into `main` as `722e1e3` (894 tests, check-types clean). Commits: `e57237c`, `5498c33` (schema, events, permission, completion postings; review fixes: statuses in core, more tests), `4c88493`, `eececf6` (deliver, request changes, accept; review fixes: refund branch test, failed top-ups now block acceptance and new amendments, friendly length errors, `completionRefundId` shared by the posting and the `refund.requested` event), `9faef76`, `214781e` (balance capture completes; balance fee test), `a064e81`, `01cdc07` (admin and client UI; review fixes: stale payment copy, error reset, focus, `safeHttpsLink`/`DeliveryLink`, request note limit). Migration `20261008121830_r2_deliveries` applied to the dev database.

Deviations from the plan:
- Step 1 used the existing "Logo refresh" project (quote $200 in two lines, $120 deposit already paid in R1b) instead of a new one.
- The reviewer showed the refund branch of `acceptDelivery` is reachable (a decrease amendment after the deposit), so it has a router test.

### Sandbox walkthrough

Walk Crew, as Walk Through (admin and assigned freelancer), over the tunnel:

1. **Logo refresh:** delivered (note and link); the client page showed "Waiting for your answer" with Accept delivery / Request changes. The client requested changes ("Go with concept 2, but use the darker blue."): project back to in progress, revisions 1, the admin page showed the request (after a reload). Delivered again; the client accepted: "Awaiting balance · Final price $200.00", a pending $100 balance with Pay with PayPal.
2. **Balance through the webhook:** the button created order `30L13981Y1455851T`, but no popup opened (twice). Approved as sandbox buyer 2 on PayPal's checkout page in its own tab; the `CHECKOUT.ORDER.APPROVED` webhook captured it (capture `9H5226636D334272V`, fees 420/100). Project `completed`, `final_price_minor` 20000; ledger `client_held:{p}` 100 → 0, `owed:{Walk Through}:available` 0 → 170.00, `team_revenue` +24.80 (team cut 30.00 − PayPal fee 4.20 − Payleor fee 1.00), `paypal_fees` +4.20, `payleor_fees` +1.00. Transfers `payment_captured`, `completion`, `payment_fees` for the balance. Outbox: `delivery.submitted`, `delivery.changes_requested`, `delivery.submitted`, `delivery.accepted`, `payment.created`, `payment.captured`, `project.completed`. Pay page "Paid. Thank you."; client page "Completed · Final price $200.00" and "This project is complete. Thank you."
3. **Balance through the popup:** "Pay page checks" delivered and accepted ($10 balance). The popup opened this time; Mouhamed paid in it. The pay page captured it (fees 69/10), project completed with `final_price_minor` 2000, `client_held` 0, owed +17.00, `team_revenue` +2.21. The webhooks then recorded "nothing to do" (approval) and `already_applied` (capture); one `completion` transfer.

Gaps logged in the sellers design §11.1: delivery files (2b), admin page not refreshing after client actions, notifications from the outbox, refund owed not shown, cancellation must cancel a pending balance, the one-off missing popup.
