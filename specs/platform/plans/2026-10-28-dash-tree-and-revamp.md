# Dash: missing tree pages, then the Revamp design system

> **For agentic workers:** REQUIRED SUB-SKILL: use subagent-driven-development (recommended) or executing-plans to carry out this plan task by task. Steps use checkboxes (`- [ ]`).

**Goal:** first give every node of the agreed context tree a page in the dash. Then rebuild the dash 1:1 on the Revamp reference screens, and infer from them every component and page shape the reference doesn't show.

**Architecture:**
- **Phase 1** adds the missing nodes in today's styling:
  - Money: payments and PayPal cases.
  - Personal workspace home.
  - Workspace home.
  - Settings, grouping the operating model with PayPal and chat channels.
  - The section nav that follows the tree.

  New reads are registry queries (`defineAction`, kind `query`) so the agent can use them later. Who sees what is decided by role (`canServicesTeam`) and by record.
- **Phase 2** extracts the reference's design system into `packages/ui`: tokens first, then components.
- **Phase 3** moves every dash page onto it. The page shapes come from the reference: list, record, settings, agent.

**Tech stack:**
- vinext (Next.js App Router) on Workers, tRPC with TanStack Query.
- Tailwind v4 with shadcn token names (`packages/ui/src/styles/globals.css`), lucide icons.
- Drizzle and Postgres; tests with Vitest against the real test database.

**Sources:**
- [Context graph inventory](../2026-10-28-context-graph-inventory.md) §1 (the tree) and §5 (decisions).
- Reference screens: the "Revamp inc." dashboard Mouhamed shared, kept outside the repository.

**Base:** `aed6429` on `b1-operating-model`. Phase 1 needs B1's rules pages; if B1 merges first, rebase on `main`.
**Branch / worktree:** `dash-tree-revamp`, `worktrees/dash-tree-revamp`.
**Test database:** `jendal_test_dash` (`docker exec jendal-pg createdb -U postgres jendal_test_dash`, then `TEST_DATABASE_URL` in `.env.test.local`).
**Stories walked:** ACC-08–14, OUT-04–27, PAY-01–16, AGT-46–55, AGT-61–62 (`specs/stories/`).

---

## Facts

- Dash routes are under `apps/web/src/app/dash/`. Seller pages are under `[storeSlug]/`, wrapped by `[storeSlug]/layout.tsx`, which renders `TeamShell` (`apps/web/src/components/team-shell.tsx`).
- `TeamShell` builds two flat lists, `work` and `team_` (`team-shell.tsx:71-87`). `SEGMENT_LABELS` (`:29-42`) names the crumbs.
- **Page pattern:**
  - A server `page.tsx` calls `requireSession()` and checks `isServicesTeamSlug()` (`@/lib/server-api`). It then renders a client component that reads with `trpc.<router>.<proc>.queryOptions`.
  - Example: `[storeSlug]/payouts/page.tsx` → `team-payouts.tsx`.
- **Registry:**
  - Actions are declared with `defineAction` (`packages/api/src/actions/define.ts:38`) and listed in `ACTIONS` (`actions/registry.ts`).
  - They are exposed with `teamProcedureFor(definition)` (`actions/trpc.ts:71`).
  - Queries default to agent policy `free` (`define.ts:45`).
  - `teamActorOf(context)` (`actions/team-actor.ts`) gives `{ teamId, role, actorId }`.
- **Roles:** `canServicesTeam(role, action)` (`packages/core/src/services-teams/permissions.ts:48`). Only admins have `approve_payouts` and `resolve_cases`; freelancers have `file_case`.
- **Payment data:**
  - Payments are table `payment` (`packages/db/src/schema/projects.ts:188`), with fields kind, status, amountMinor, refundedMinor, paypalFeeMinor, capturedAt, projectId and teamId.
  - Kinds are `deposit | top_up | balance`. Statuses are `pending | captured | failed | cancelled | refunded` (`packages/core/src/projects/quotes.ts:10-15`).
- **PayPal case data:**
  - Cases are table `dispute` (`packages/db/src/schema/operating-model.ts:160`), with fields teamId, projectId, orderId, reason, status, amountMinor, currency, openedAt and resolvedAt.
  - Statuses are `open | waiting_for_seller | under_review | resolved_buyer | resolved_seller`.
- **Test helpers:** `seedOrganization`, `seedServicesTeam`, `seedServicesTeamMember`, `seedProject` and `seedPayment` (`packages/db/src/testing/db.ts:41-323`). Router tests build `appRouter.createCaller(...)` as in `packages/api/src/routers/requests-board.test.ts:28-41`.
- **Personal pages:** `me/projects` (`client-home.tsx`) and `me/payouts` exist; there's no `me` home. `servicesTeam.listMine` (`routers/services-team.ts:52`) lists the caller's teams with their organization. The dash `/` (`dash/page.tsx`) lists workspaces.
- **Theme:** tokens live in `packages/ui/src/styles/globals.css` (Relief: `--background #f6f6f7`, `--primary #1c1c20`, `--brand #1fbf8f`, Cal Sans UI for headings). Components are in `packages/ui/src/components/`.

---

# Phase 1: the missing nodes

### Task 1: `payment.list` registry query

**Files:**
- Create: `packages/db/src/repositories/money.ts`
- Create: `packages/api/src/actions/money.ts`
- Modify: `packages/api/src/actions/registry.ts` (add to `ACTIONS`)
- Create: `packages/api/src/routers/money.ts`, and register it as `money` in `routers/index.ts`
- Test: `packages/api/src/routers/money.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/api/src/routers/money.test.ts
import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import {
  createTestDb, hasTestDatabase, seedOrganization, seedPayment, seedProject, seedServicesTeam,
  seedServicesTeamMember, truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("money", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const callerFor = (userId: string) =>
    appRouter.createCaller({
      db, session: makeSession(userId), environment: "sandbox", platformName: "Platform", auth,
      headers: new Headers(), catalog: createTestCatalogServices(), files: createFakeFileStore(),
    });

  async function setup() {
    const { userId: adminId, organizationId } = await seedOrganization(db);
    const team = await seedServicesTeam(db, { organizationId, slug: "walk-crew", status: "active" });
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId: team.id, role: "freelancer" });
    const projectId = await seedProject(db, { teamId: team.id, title: "Baobab", source: "web", clientEmail: "lina@example.com", clientName: "Lina Haddad" });
    await seedPayment(db, { projectId, teamId: team.id, kind: "deposit", amountMinor: 30_000, capturedAt: new Date("2026-10-20T10:00:00Z") });
    await seedPayment(db, { projectId, teamId: team.id, kind: "balance", amountMinor: 45_000, capturedAt: new Date("2026-10-24T10:00:00Z") });
    return { adminId, freelancer, teamId: team.id };
  }

  it("lists the team's payments newest first for an admin, with the project and client", async () => {
    const { adminId } = await setup();
    const payments = await callerFor(adminId).money.payments({ teamSlug: "walk-crew" });
    expect(payments.map((p) => [p.kind, p.amountMinor, p.projectTitle, p.clientName])).toEqual([
      ["balance", 45_000, "Baobab", "Lina Haddad"],
      ["deposit", 30_000, "Baobab", "Lina Haddad"],
    ]);
  });

  it("refuses a freelancer", async () => {
    const { freelancer } = await setup();
    await expect(callerFor(freelancer).money.payments({ teamSlug: "walk-crew" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Run it and check that it fails.** Run `npx vitest run packages/api/src/routers/money.test.ts`. Expected: FAIL, `money` is not on the router.

- [ ] **Step 3: Add the repository read.**

```ts
// packages/db/src/repositories/money.ts
import { desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { project, payment } from "../schema/projects";

export async function listTeamPayments(db: Database, teamId: string) {
  return db
    .select({
      id: payment.id,
      kind: payment.kind,
      status: payment.status,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      refundedMinor: payment.refundedMinor,
      paypalFeeMinor: payment.paypalFeeMinor,
      capturedAt: payment.capturedAt,
      projectId: payment.projectId,
      projectTitle: project.title,
      clientName: project.clientName,
    })
    .from(payment)
    .innerJoin(project, eq(project.id, payment.projectId))
    .where(eq(payment.teamId, teamId))
    .orderBy(desc(payment.capturedAt), desc(payment.id));
}
```

Check the `Database` import path and the `project.clientName` column against `packages/db/src/schema/projects.ts`. If the client's name lives on `client_contact`, join it the way `listVisibleProjects` does.

- [ ] **Step 4: Add the action and the router.**

```ts
// packages/api/src/actions/money.ts
import { canServicesTeam } from "@jendal-workspace/core";
import { listTeamPayments } from "@jendal-workspace/db/repositories/money";
import { z } from "zod";

import { defineAction } from "./define";
import { ActionError } from "./errors";
import { teamActorOf } from "./team-actor";

export const paymentList = defineAction({
  name: "payment.list",
  kind: "query",
  summary: "List the team's client payments, newest first, with each one's project, client, amount, fee and refunds.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: async (context) => {
    const actor = teamActorOf(context);
    if (!canServicesTeam(actor.role, "approve_payouts")) throw new ActionError("forbidden", "Only an admin can see payments.");
    return listTeamPayments(context.deps.db, actor.teamId);
  },
});
```

```ts
// packages/api/src/routers/money.ts
import { router } from "../index";
import { paymentList } from "../actions/money";
import { teamProcedureFor } from "../actions/trpc";

export const moneyRouter = router({
  payments: teamProcedureFor(paymentList),
});
```

Add `paymentList` to `ACTIONS` in `actions/registry.ts`. Add `money: moneyRouter` to `routers/index.ts`. Check that `ActionError`'s code `"forbidden"` maps to tRPC `FORBIDDEN` in `actions/errors.ts`.

- [ ] **Step 5: Run the test.** Expected: PASS. Then run `npx vitest run packages/api/src/actions/registry.test.ts` (the registry's own invariants).
- [ ] **Step 6: Commit.** `git add packages/db/src/repositories/money.ts packages/api/src/actions/money.ts packages/api/src/actions/registry.ts packages/api/src/routers/money.ts packages/api/src/routers/index.ts packages/api/src/routers/money.test.ts && git commit -m "feat(api): list a team's payments as a registry query"`

### Task 2: `dispute.list` registry query

**Files:** modify `packages/db/src/repositories/money.ts`, `packages/api/src/actions/money.ts`, `packages/api/src/actions/registry.ts`, `packages/api/src/routers/money.ts`, and the test `packages/api/src/routers/money.test.ts`.

- [ ] **Step 1: Write the failing test.** Add it to the `money` describe block:

```ts
import { dispute } from "@jendal-workspace/db/schema/operating-model";

it("lists open cases first, then resolved ones, for an admin", async () => {
  const { adminId, teamId } = await setup();
  await db.insert(dispute).values([
    { teamId: teamId, paypalDisputeId: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "resolved_seller", amountMinor: 30_000, currency: "USD", openedAt: new Date("2026-10-10T00:00:00Z"), resolvedAt: new Date("2026-10-15T00:00:00Z") },
    { teamId: teamId, paypalDisputeId: "PP-D-2", reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", status: "waiting_for_seller", amountMinor: 45_000, currency: "USD", openedAt: new Date("2026-10-25T00:00:00Z") },
  ]);
  const cases = await callerFor(adminId).money.cases({ teamSlug: "walk-crew" });
  expect(cases.map((c) => [c.paypalDisputeId, c.open])).toEqual([["PP-D-2", true], ["PP-D-1", false]]);
});
```

- [ ] **Step 2: Run it and check that it fails.** Run `npx vitest run packages/api/src/routers/money.test.ts -t cases`. Expected: FAIL, there's no `cases` procedure.
- [ ] **Step 3: Implement.**

```ts
// packages/db/src/repositories/money.ts (append)
import { asc, sql } from "drizzle-orm";
import { dispute } from "../schema/operating-model";

export async function listTeamDisputes(db: Database, teamId: string) {
  const open = sql<boolean>`${dispute.resolvedAt} is null`;
  return db
    .select({
      id: dispute.id,
      paypalDisputeId: dispute.paypalDisputeId,
      reason: dispute.reason,
      status: dispute.status,
      amountMinor: dispute.amountMinor,
      currency: dispute.currency,
      openedAt: dispute.openedAt,
      resolvedAt: dispute.resolvedAt,
      projectId: dispute.projectId,
      projectTitle: project.title,
      open,
    })
    .from(dispute)
    .leftJoin(project, eq(project.id, dispute.projectId))
    .where(eq(dispute.teamId, teamId))
    .orderBy(desc(open), desc(dispute.openedAt));
}
```

```ts
// packages/api/src/actions/money.ts (append)
import { listTeamDisputes } from "@jendal-workspace/db/repositories/money";

export const disputeList = defineAction({
  name: "dispute.list",
  kind: "query",
  summary: "List the team's PayPal cases, open first, with each one's reason, status, amount and project.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: async (context) => {
    const actor = teamActorOf(context);
    if (!canServicesTeam(actor.role, "resolve_cases")) throw new ActionError("forbidden", "Only an admin can see PayPal cases.");
    return listTeamDisputes(context.deps.db, actor.teamId);
  },
});
```

Add `cases: teamProcedureFor(disputeList)` to `moneyRouter`, and `disputeList` to `ACTIONS`. Drop the unused `asc` import if lint flags it.

- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(api): list a team's PayPal cases as a registry query"`

### Task 3: Payments page

**Files:**
- Create: `apps/web/src/app/dash/[storeSlug]/payments/page.tsx` and `team-payments.tsx`.

- [ ] **Step 1: Write the server page** (same guard as payouts):

```tsx
import { isServicesTeamSlug, requireSession } from "@/lib/server-api";
import TeamNotFound from "@/components/services-team/team-not-found";
import TeamPayments from "./team-payments";

export default async function TeamPaymentsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <TeamPayments teamSlug={storeSlug} />;
}
```

- [ ] **Step 2: Write the client list.** It's a table with these columns: Date, Project (link to `projects/[id]`), Client, Kind, Amount, PayPal fee, Refunded, Status.
  - Money is formatted with the existing currency helper used in `payout-requests-table.tsx`; reuse it, and don't add a second one.
  - The empty state is "No client payments yet."
  - A `FORBIDDEN` error shows "Only an admin can see payments."
- [ ] **Step 3: Check it.** Run `pnpm check-types && pnpm lint`. Then open `dash.localhost:3001/walk-crew/payments` as the admin and as a freelancer.
- [ ] **Step 4: Commit.** `feat(web): payments page under Money`

### Task 4: PayPal cases page

**Files:**
- Create: `apps/web/src/app/dash/[storeSlug]/cases/page.tsx` and `team-cases.tsx`.

- [ ] **Step 1: Write the page.** Copy Task 3's guard and swap the component.
- [ ] **Step 2: Write the client list.** It has two groups, Open and Resolved, with these columns: Opened, Project, Reason (plain words mapped from PayPal's codes), Amount, Status, PayPal case ID.
  - Every open row says "Payouts on this project are held while the case is open." This is the rule in `use-cases/disputes.ts:209`.
- [ ] **Step 3: Check it.** Run `pnpm check-types && pnpm lint`, then load the page.
- [ ] **Step 4: Commit.** `feat(web): PayPal cases page under Money`

### Task 5: Seller nav follows the tree

**Files:**
- Modify: `apps/web/src/components/team-shell.tsx:71-87` and `SEGMENT_LABELS` (`:29-42`).

- [ ] **Step 1: Replace the two flat lists with grouped sections.**

```ts
type NavGroup = { label: string; items: NavItem[] };
const groups: NavGroup[] = [
  { label: "Work", items: [
    { href: `/${slug}`, label: "Overview", icon: LayoutGrid },
    { href: `/${slug}/requests`, label: "Requests", icon: HandCoins, show: kind === "services" && !solo },
    { href: `/${slug}/projects`, label: "Projects", icon: FolderKanban, show: kind === "services" },
  ] },
  { label: "Money", items: [
    { href: `/${slug}/payments`, label: "Payments", icon: ArrowDownToLine, show: kind === "services" && admin },
    { href: `/${slug}/payouts`, label: "Payouts", icon: ArrowUpFromLine, show: kind === "services" && !solo },
    { href: `/${slug}/cases`, label: "PayPal cases", icon: ShieldCheck, show: kind === "services" && admin },
  ] },
  { label: "Storefront", items: [
    { href: `/${slug}/services`, label: "Services", icon: Tag, show: kind === "services" },
    { href: `/${slug}/products`, label: "Products", icon: Package, show: storeEnabled },
    { href: `/${slug}/orders`, label: "Orders", icon: Inbox, show: storeEnabled && admin },
    { href: `/${slug}/preview`, label: "Seller page", icon: Store, show: admin },
  ] },
  { label: "Team", items: [
    { href: `/${slug}/members`, label: "Members", icon: Users, show: kind === "services" && !solo },
  ] },
];
const footer: NavItem[] = [{ href: `/${slug}/settings`, label: "Settings", icon: Settings, show: kind === "services" }];
```

  Add `["payments", "Payments"]`, `["cases", "PayPal cases"]` and `["requests", "Requests"]` to `SEGMENT_LABELS`. Import `ArrowDownToLine`, `ShieldCheck` and `Store` from lucide. Hide a group when all its items are hidden.
- [ ] **Step 2: Check it.** The admin, freelancer and store views each show the right items. Run `pnpm check-types && pnpm lint`.
- [ ] **Step 3: Commit.** `feat(web): seller nav grouped by the context tree`

### Task 6: Settings holds the operating model, PayPal and channels

**Files:**
- Create: `apps/web/src/app/dash/[storeSlug]/settings/layout.tsx`. It's the sub-nav: General, Operating model, PayPal and channels.
- Move: `[storeSlug]/rules/*` → `[storeSlug]/settings/operating-model/*`.
- Move: `[storeSlug]/discord/*` → `[storeSlug]/settings/channels/*`.
- Create: `[storeSlug]/rules/page.tsx` and `[storeSlug]/discord/page.tsx` as `redirect()`s to the new paths, so links in sent emails keep working.
- Modify: `grep -rn '/rules\b\|/discord\b' apps/web/src packages/api/src` (links in notices and the setup checklist).

- [ ] **Step 1:** Run `git mv` on both folders and fix the relative imports.
- [ ] **Step 2: Write the sub-nav layout.** It's a horizontal tab row of three `Link`s with `aria-current`, the same visual as today's in-page nav (`components/page-sections-nav.tsx`).
- [ ] **Step 3:** Add the redirect pages (`import { redirect } from "next/navigation"`), then update the links found by the grep.
- [ ] **Step 4: Check it.** Run `pnpm check-types && pnpm lint && pnpm test`. Open the old URLs and check that they redirect.
- [ ] **Step 5: Commit.** `refactor(web): operating model and channels under Settings`

### Task 7: Personal workspace home

**Files:**
- Create: `apps/web/src/app/dash/me/page.tsx` and `me/personal-home.tsx`.

- [ ] **Step 1: Write the page.** It has two summary blocks:
  - **My purchases:** count of projects waiting on the person, and the latest three. The data is the query `client-home.tsx` already uses.
  - **My earnings:** owed, held and sent, from `trpc.payouts.mine`.

  Each block links to `me/projects` and `me/payouts`. No new API is needed.
- [ ] **Step 2: Check it.** Run `pnpm check-types && pnpm lint`. Load the page as a person who is both client and payee (AGT-62).
- [ ] **Step 3: Commit.** `feat(web): personal workspace home`

### Task 8: Account and workspace homes

**Files:**
- Modify: `apps/web/src/app/dash/page.tsx`. It becomes the Account home, with Personal workspace first and then each workspace.
- Create: `apps/web/src/app/dash/w/[organizationId]/page.tsx`. It's the Workspace home, listing its sellers with role and status, and actions to create a store or a team.
- Modify: `apps/web/src/lib/host-routing.ts` only if `w` collides with a seller slug. Check the reserved slugs list (`grep -rn "RESERVED" packages/core/src`) and add `w` and `me` there.

- [ ] **Step 1:** Add `w` to the reserved slugs and test it there (the existing reserved-slug test file).
- [ ] **Step 2: Write the Workspace page.** It reads `servicesTeam.listMine` and filters it to the organization. A person outside the organization gets `notFound()`.
- [ ] **Step 3: Change `/`.** Show a Personal workspace card linking to `/me`, and one row per workspace linking to `/w/[id]`. Don't send someone with one workspace straight through; the account level must exist.
- [ ] **Step 4: Check and commit.** Run `pnpm check-types && pnpm lint && pnpm test`. Commit as `feat(web): account and workspace homes`.

**Phase 1 checkpoint:** every node in the inventory's §1 has a route. Walk ACC-08–14, AGT-61 and AGT-62 locally, then push.

---

# Phase 2: the Revamp design system

Copy the reference 1:1. The token values below were measured from it. Where the reference is silent, infer from the nearest component it does show.

### Task 9: Tokens

**Files:**
- Modify: `packages/ui/src/styles/globals.css` (`:root` and `.dark`).
- Doc: none beyond this plan; the token table below holds every value.

| Token | Value | Reference |
|---|---|---|
| `--frame` (app canvas, sidebar) | `#ececee` | sidebar background |
| `--panel` (main content) | `#ffffff`, `1px solid #e6e6e9`, radius 20px, inset 8px from the frame | right panel |
| `--card-shell` | `#f5f5f6`, border `#e8e8eb`, radius 16px, padding 4px | stat and chart card outer |
| `--card` (inner) | `#ffffff`, border `#ececef`, radius 12px, shadow `0 1px 2px rgb(16 16 20 / .04)` | inner white body |
| `--foreground` | `#0f0f12` | titles, numbers |
| `--muted-foreground` | `#8b8b94` | breadcrumb parent, sublabels, axis |
| `--label` | `#9a9aa3`, 11px, uppercase, `letter-spacing .08em`, weight 500 | "DATE GROUPING", table headers |
| `--primary` | `#141416`, gradient `linear-gradient(#2a2a2e,#0e0e10)`, inner highlight `inset 0 1px 0 rgb(255 255 255 / .12)` | "Upgrade plan", "Export reports" |
| `--chart-1` | `#1b9cf2` → `#38bdf8` | line, highlighted bar |
| `--chart-soft` | `#cfe6fb`, `#c9d3e6`, `#bfc6d4` | stacked bar segments |
| `--positive` | text `#16a34a`, wash `#e8f8ee` | "↗ 20%" pill |
| `--negative` | text `#dc2626`, wash `#fdecec` | "↘ 12%" pill |
| Radius | 8 (controls), 10 (nav item), 12 (inner card), 16 (card shell), 20 (panel), 24 (app window) | |
| Type | Inter: 13px body, 14px nav, 15px card titles 500, 20px section heading 600, 28px stat numbers 600 with tabular numerals | |
| Row heights | nav item 36px, control 40px, table row 64px | |

- [ ] **Step 1:** Write the tokens as CSS variables on shadcn's names: `--background` = `--frame`, `--card`, `--primary`, `--muted-foreground`, `--border`, plus the new `--panel`, `--card-shell`, `--label`, `--positive*`, `--negative*` and `--chart-*`. Expose them to Tailwind in the existing `@theme inline` block.
- [ ] **Step 2: Fonts.** The reference uses one grotesk for both titles and body, so headings move to Inter 600. Cal Sans UI stays on the marketing site only. This replaces the brand memory's dash rule; Mouhamed asked for 1:1.
- [ ] **Step 3: Accent.** The reference blue becomes the dash's `--chart-1`, and its focus ring and selected states use it too. Mint (`--brand`) stays on the site.
- [ ] **Step 4:** Run `pnpm check-types && pnpm lint`. Screenshot `/walk-crew/payouts` before and after to catch token regressions.
- [ ] **Step 5: Commit.** `feat(ui): Revamp tokens`

### Task 10: Components seen in the reference

One file per component in `packages/ui/src/components/`. Each one is written to the reference's measurements, has a usage entry written with the component-docs skill, and is checked in a scratch page `apps/web/src/app/dash/_kit/page.tsx` (removed in Task 14).

| Component | Anatomy (from the reference) |
|---|---|
| `AppFrame` | Frame canvas; sidebar (fluid `clamp(13rem, 18vw, 16rem)`); `--panel` inset with radius 20; the panel scrolls, the sidebar doesn't |
| `WorkspaceSwitcher` | 40px dark rounded-square mark with a white glyph, name 17px 600, `chevrons-up-down`; separate 28px white collapse button `chevrons-left` |
| `SidebarItem` | 36px, 20px icon in muted grey, 14px label; active: white fill, radius 10, `0 1px 2px rgb(0 0 0 / .06)`, icon and label in `--foreground`, filled icon |
| `SidebarGroup` | `--label` heading with a `+` icon button on the right; items with coloured folder icons; 1px divider between groups |
| `QuickFind` | 40px grey field (`#e2e2e5`), search icon, placeholder "Quick find", `⌘` kbd chip in a white 24px box |
| `SetupCard` | White card at the sidebar's foot: "Getting started" in blue and a percentage; a segmented progress bar of about 30 ticks (blue done, grey left); divider; user row with 40px avatar, name, email and a `chevrons-up-down` button |
| `PageHeader` | 56px bar with a bottom border: back chevron, crumbs (parent in muted grey, `/`, current in 600) |
| `Banner` | Full-width card, radius 16, dithered landscape (an image plus a dot overlay `radial-gradient(rgb(0 0 0 / .08) 1px, transparent 1px) 0 0 / 3px 3px`); dark mark, title 22px 600 with a small dark badge, two lines of text; primary dark button with an icon and a white secondary with `arrow-up-right`; "Close ×" top right |
| `Field` | `--label` above the control |
| `Segmented` | Grey track `#f1f1f3`, radius 10; active segment white with a shadow and 600 text; inactive muted |
| `Select` / `DateRange` | 40px white bordered control, chevron; the range shows dates and a clear `×` |
| `Button` | `primary` (dark gradient), `secondary` (white, border, shadow), `ghost`; 40px and 32px sizes; optional leading icon |
| `StatCard` | Card shell; header row in the shell (24px gradient icon tile, 15px title, `info` icon); inner card with a 28px value, a delta pill, a muted sublabel ("188 Meeting Booked" style: number in foreground, words muted); a right visual: four 16px-wide mini bars (grey, the last coloured with a dither texture) or a sparkline |
| `DeltaPill` | 20px, radius 999, `↗` or `↘` with the percentage, positive or negative colours |
| `ChartCard` | Card shell; header with a title and `info` icon, actions on the right (`Filter` with an icon, `See details`, or an icon toggle pair); the inner card holds the chart |
| `LineChart` | Area line in `--chart-1` with a soft gradient fill, dashed grid, percent y-axis, month x-axis; hover shows a vertical guide, a ring dot and a dark tooltip (uppercase label, icon and value) |
| `StackedBarChart` | Horizontal rows, 4–5 segments with 2px gaps, radius 4; one highlighted segment in `--chart-1`; the dark tooltip as above |
| `DataTable` | Inside a card shell: header actions (`Filter`, `Export`); `--label` column headers; 64px rows; cell kinds: toggle, title with an avatar meta line ("Name on date"), a step badge (grey, uppercase, radius 6), right-aligned numbers, and a `…` menu button |
| `Toggle` | 36×22, blue track with a dither, white knob |
| `Avatar` | 20 / 28 / 40, round; initials on `#e8e8eb` when there's no photo |
| `Tooltip` | Dark `#151517`, radius 8, 12px text, uppercase caption |

- [ ] **Step 1:** Build `AppFrame`, `SidebarItem`, `SidebarGroup`, `WorkspaceSwitcher`, `QuickFind`, `SetupCard`, `PageHeader`. Commit as `feat(ui): Revamp frame and navigation`.
- [ ] **Step 2:** Build `Button`, `Field`, `Segmented`, `Select`, `DateRange`, `Toggle`, `Avatar`, `DeltaPill`, `Tooltip`, then commit them.
- [ ] **Step 3:** Build `Banner`, `StatCard`, `ChartCard`, `LineChart`, `StackedBarChart` (inline SVG, no chart library; width follows the container through a `ResizeObserver`), then commit them.
- [ ] **Step 4:** Build `DataTable` (column defs with `kind`), then commit it.
- [ ] **Step 5: Compare.** Recreate the reference screen in `_kit` with its own sample text. Compare it with the reference side by side at the same width, and fix every difference before going on.

### Task 11: Components inferred from the reference

The reference shows no forms, records, empty states, dialogs or agent views. Derive them from the same tokens:

| Component | Inferred from |
|---|---|
| `RecordHeader` (title, status word, facts row, actions) | `PageHeader` + the Banner's title and buttons |
| `Section` (heading, `info`, actions, inner card) | `ChartCard` shell |
| `FormRow`, `Input`, `Textarea` | `Field` and `Select` (40px, white, border, radius 8) |
| `Tabs` | `Segmented` on a 1px bottom border |
| `EmptyState` | Banner without the image: mark, title, one line, one button |
| `Dialog` / `Sheet` | Panel (radius 20, white, border) on a `--scrim` |
| `StatusWord` | `DeltaPill` colours, without the arrow |
| `ActivityRow` | Table row meta line (avatar, "who on date") |
| `AgentComposer` | `QuickFind` field grown to a textarea with a primary send button |
| `AgentTurn` | `Section` with a mark and the who line; widgets inside are the same `StatCard`, `DataTable` and `Banner` |

- [ ] **Step 1:** Build them, add them to `_kit`, and write their docs entries. Commit as `feat(ui): Revamp inferred components`.

---

# Phase 3: every page on the new system

### Task 12: Shell

- [ ] Replace `TeamShell`'s frame with `AppFrame`, filled as follows:
  - **Switcher:** the seller, inside the workspace.
  - **Top items:** "Overview" and "Veetlyn" (the agent's page, under its own route `[storeSlug]/agent`; empty for now with the `AgentComposer`).
  - **`QuickFind`:** jumps to sections and records.
  - **Groups:** Phase 1's groups as `SidebarGroup`s.
  - **Footer:** Settings, Support (link to contact).
  - **`SetupCard`:** fed by the existing setup checklist (`components/setup-checklist.tsx`).
  - **Header:** `PageHeader` from `SEGMENT_LABELS`.
- [ ] Use the same frame for `/`, `/me` and `/w/[id]`. Their switcher shows the account and their groups list workspaces and personal pages.
- [ ] Commit as `feat(web): Revamp shell`.

### Task 13: Page shapes

Every page takes one of four shapes. The list shape is the reference itself.

| Shape | Composition | Pages |
|---|---|---|
| **List** | `PageHeader` → `Banner` (what Veetlyn prepared here, or setup) → filter row (`Segmented` period, `DateRange`, `Select`; actions on the right) → section heading → `StatCard` row (auto-fit, `minmax(14rem, 1fr)`) → `ChartCard` row (2fr / 1fr) → `DataTable` | Requests, Projects, Payments, Payouts, PayPal cases, Services, Products, Orders, Members, My purchases, My earnings |
| **Record** | `PageHeader` → `RecordHeader` → `StatCard` row for the record's figures → `Tabs` of `Section`s | A project (split `project-detail.tsx` into one section per child: quote, amendments, deliveries, conversation, clients, refunds, case), a product, a service, a member, a rulebook version |
| **Summary** | `PageHeader` → `Banner` → `StatCard` row per child node → one `Section` per child with its top rows | Account home, Personal workspace home, Workspace home, seller Overview |
| **Settings** | `PageHeader` → `Tabs` → `Section`s of `FormRow`s | Settings: General, Operating model, PayPal and channels; account |
| **Agent** | `PageHeader` → `AgentTurn`s → `AgentComposer` | `[storeSlug]/agent` (filled by the agent plan, not this one) |

Each page's figures come from data the page already loads. Where a chart has no data source yet, the page shows the `StatCard` row and the table without the chart, and the missing series goes in the outcome as a backlog row. Don't put fake data into real pages.

For each page in the table, in this order:
1. Payouts.
2. Payments.
3. PayPal cases.
4. Requests.
5. Projects.
6. A project.
7. Services.
8. Products.
9. Orders.
10. Members.
11. Settings tabs.
12. Seller Overview.
13. The three homes.
14. Account.

- [ ] Rebuild the page from its shape's components.
- [ ] Keep every existing action and test id. Run `pnpm check-types && pnpm lint`. Run the page's router tests if the page's queries changed.
- [ ] Screenshot it at the browser's own width; never resize the window. Compare it with the reference for spacing, type and colour.
- [ ] Commit as `feat(web): <page> on Revamp`.

### Task 14: Clean-up and checks

- [ ] Delete `_kit` and the old Relief-only classes that nothing uses any more (`grep` each token).
- [ ] Run the `ui-review` skill on Payouts, a project, Settings and the Account home, and fix its findings.
- [ ] Run the `test-audit` skill over the tests in Tasks 1, 2 and 8.
- [ ] Run the `security-audit` skill (quick profile) on `origin/main...dash-tree-revamp`, with output in `~/security-audit-skill/veetlyn/run-dash-revamp`.
- [ ] Deploy to staging (Mouhamed runs it), then walk the stories listed above. Record the outcome below, set the stories' statuses, and update `PROGRESS.md`.

## Outcome

Not started.
