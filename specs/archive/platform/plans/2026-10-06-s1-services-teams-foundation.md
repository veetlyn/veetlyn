# S1: Finish W1-D and Build the Services Teams Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Part A finishes W1-D: the landing page presents both products of a Payleor workspace (commerce and payouts) with their pricing, every store gets its default policies, the walkthrough and deploy run, and `w1d-public-site-auth` merges into `main`. Part B builds the services teams foundation (execution doc contract §4.2). A user creates a services team, sees it next to their stores on the workspace home, opens its dashboard at `admin.<domain>/{slug}` with a setup checklist, saves the team's currency, rates, quoting mode and payout mode, and adds existing Payleor users as admins, managers or freelancers.

**Architecture:** A services team is a Better Auth team with `team.product = 'services'`. Stores keep `product = 'store'`, and both share the slug namespace. `@jendal-workspace/core` holds the pure rules: product and role types, the settings types and defaults, percent and basis point conversion, the `canServicesTeam` permission table, and the services setup steps. `packages/db` adds the `product` column and two tables, `services_team_member` and `services_team_settings`, plus a `services-teams` repository. The store repository filters on `product = 'store'`, so services teams never resolve as storefronts or appear in store lists. The Better Auth team hooks validate `product`, word slug errors per product, create the settings row for services teams, and refuse product changes. The `servicesTeam` tRPC router reuses `store.create`'s organization rule through a shared helper. The web app gets "Create your services team", a workspace home that lists both kinds of team, a slug route that picks the dashboard by product, a settings page with accessible validation, and a members page.

**Tech Stack:** Better Auth 1.7.7 (organization plugin with teams), Drizzle ORM 1.0.0-rc.4 and drizzle-kit, tRPC 11 with `@trpc/tanstack-react-query`, zod 4, vinext 1.0.1, React 19, TanStack Query 5, Tailwind 4, lucide-react 1.41, Vitest 5.

**Spec:** [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) §3 (workspace and products), §4.1 (roles), §4.3 (settings), §9 (web surfaces), §10 (changes to W1-D). Contracts: [`2026-10-06-parallel-execution.md`](2026-10-06-parallel-execution.md) §4.1 and §4.2. Landing and pricing: [`../2026-10-04-public-site-auth-onboarding-design.md`](../2026-10-04-public-site-auth-onboarding-design.md) §4 and the platform spec §6.7.

**Builds on:** W1-D Tasks 0–12 and 14, done on branch `w1d-public-site-auth` (last commit `3770b0b`). W1-D Task 13 is replaced by Task A1 below; Tasks 15 and 16 run as Tasks A2 and A3.

**Out of scope (later plans):**
- Connect PayPal for services teams (S3 writes `team.paypal_merchant_id`; its checklist link replaces the "coming soon" note).
- Payout credentials (payouts plan) and Discord linking (S2).
- Projects, quotes, ledger (S4 Part B), payouts, API keys, cases.
- Payouts plan prices and bundle prices (services spec §13); billing.
- Updating the Terms of Service and Privacy Policy to cover the payouts product (see "Risks and open questions" in the report; not assigned to this plan).
- Removing members from a services team.

**Working directories:**
- Part A (Tasks A1–A3): `/home/mouhamed/dev/repos/jendal/jendal-workspace` on branch `w1d-public-site-auth`. Task A4 runs in `/home/mouhamed/dev/repos/jendal/worktrees/main`.
- Part B (Tasks 0–17): `/home/mouhamed/dev/repos/jendal/worktrees/s1` on branch `s1-services-teams`. Task 17's merge step runs in `/home/mouhamed/dev/repos/jendal/worktrees/main`.

**Library sources:** read the pinned clones in `/home/mouhamed/dev/repos/jendal/refs/stack/` (read-only). Load the matching skill before each task:

| Task | Skills |
|---|---|
| A1 | `migrate-to-vinext`, `better-writing`, `better-accessibility`, and `frontend-design` or `hallmark` for the visuals |
| A2 | `migrate-to-vinext`, `better-writing` |
| A3, 17 | `verification-before-completion`, `using-git-worktrees` (17) |
| A4 | `finishing-a-development-branch` |
| 0 | `using-git-worktrees` |
| 1–3 | `vitest`, `test-driven-development` |
| 4, 5 | `drizzle-orm`, `vitest` |
| 6 | `better-auth-best-practices`, `organization-best-practices` |
| 7, 8 | `vitest`, `organization-best-practices` |
| 9 | `vitest`, `better-writing` |
| 10–16 | `migrate-to-vinext`, `better-writing`, `better-accessibility`, `better-layout` |

---

## Facts this plan relies on

Each was checked against the pinned sources or the repository on 2026-10-06. If code fails in a way that contradicts one of them, re-read the cited file before changing the design.

1. **Team additional fields in the create request.** `createTeam`'s body is the base schema plus `toZodSchema({ fields: team.additionalFields, isClientSide: true })` (`refs/stack/better-auth/packages/better-auth/src/plugins/organization/routes/crud-team.ts:34-46`). With `isClientSide`, a field with `input: false` is dropped from the schema, so a client cannot send it (`packages/better-auth/src/db/to-zod.ts:23-25`). A field with `required: false` becomes `.nullish()`, so callers may omit it; any other field is required (`to-zod.ts:38-40`). So `product` must be `input: true, required: false`, or every existing `createTeam` call without `product` would fail validation.
2. **Create hooks.** `createTeam` spreads every additional field from the body into the `team` passed to `beforeCreateTeam`, and merges the hook's returned `data` over the team data (`crud-team.ts:167-202`). `afterCreateTeam` receives the created team (`crud-team.ts:204-213`), whose additional fields are returned unless marked `returned: false` (`plugins/organization/adapter.ts:776-790`). Hook types: `organization/types.ts:678-697`.
3. **Update hook.** `updateTeam` accepts the additional fields as a partial object and passes them to `beforeUpdateTeam` as `updates` (`crud-team.ts:397-431`, `539-560`; types `types.ts:704-714`). A request with `product` therefore reaches the hook, which can reject it.
4. **`addMember` is server-only.** It is created with the path-less `createAuthEndpoint` overload (`crud-members.ts:46-55`; `packages/core/src/api/index.ts:131-167`), so it is reachable only as `auth.api.addMember`, not over HTTP. It takes `userId`, `role` and `organizationId`, checks no caller permission, and throws when the user is already a member (`crud-members.ts:79-125`).
5. **Emails are stored lowercase.** Sign-up lowercases the address (`packages/better-auth/src/api/routes/sign-up.ts:236`), and lookups lowercase too (`packages/better-auth/src/db/internal-adapter.ts:1034-1046`). `findUserByEmail` lowercases its input to match.
6. **tRPC input merging.** Chained `.input()` calls with object schemas are merged (`refs/stack/trpc/www/docs/server/validators.md:42-46`). `servicesTeamProcedure` declares `{ teamSlug }`, and each procedure adds its own fields, as `storeProcedure` does for `{ storeSlug }`.
7. **tRPC GET without batching.** A GET request reads `?input=` as JSON for a non-batch call (`refs/stack/trpc/packages/server/src/unstable-core-do-not-import/http/contentType.ts:100-117`). The web server calls `/trpc/servicesTeam.get?input={"teamSlug":"…"}`.
8. **No tRPC transformer.** `initTRPC.context<Context>().create()` sets no transformer (`packages/api/src/index.ts:5`), so a `Date` reaches the browser as a string. The router returns `settingsSavedAt` as an ISO string or `null`.
9. **Query keys.** The options proxy exposes `queryKey(input)` on each query (`refs/stack/trpc/packages/tanstack-react-query/src/internals/createOptionsProxy.ts:171-173`), used to invalidate after a mutation.
10. **Drizzle.**
    - `text(name, { enum })` accepts a readonly tuple such as `["USD", "EUR"] as const` (`refs/stack/drizzle-orm/drizzle-orm/src/pg-core/columns/text.ts:62-68`).
    - `unique(name).on(a, b)` builds a composite unique constraint (`pg-core/unique-constraint.ts:6-8`, `40-55`).
    - `onConflictDoNothing` and `onConflictDoUpdate` exist on Postgres inserts (`pg-core/query-builders/insert.ts:418-472`).
    - A left-joined nested selection comes back as `null` when nothing matched; the store repository relies on it (`packages/db/src/repositories/stores.ts:93`).
11. **The store repository ignores products today.** `createStoreDirectory`, `findStoreAccess` and `listOrganizationsWithStores` select every team (`packages/db/src/repositories/stores.ts:17-36`, `47-62`, `69-96`). Without a filter, a services team would resolve as a storefront at `{slug}.<store domain>` and show up in the store list. `isStoreSlugTaken` checks every team (`stores.ts:39-42`), which is what makes the namespace shared.
12. **`store.create`'s organization rule.** It picks the first organization in which the user is owner or admin (`hasStoreWideRole`), otherwise it creates one named after the store with slug `org-{uuid}` (`packages/api/src/routers/store.ts:44-70`). Rows come ordered by organization name (`stores.ts:85-86`).
13. **Admin routing.** The proxy rewrites `admin.<domain>/x` to `/admin/x` (`apps/web/src/lib/host-routing.ts:23`). A static segment and the dynamic segment already coexist: `app/admin/new/page.tsx` and `app/admin/[storeSlug]/page.tsx`. `new` and `settings` are reserved slugs (`packages/core/src/tenancy/slug.ts`), so `/new/services-team` and `/{slug}/settings` cannot clash with a team.
14. **Test database.** `vitest.config.ts` loads `.env.test.local` and runs test files one at a time; the global setup drops and re-creates the database from every migration (`packages/db/src/testing/global-setup.ts`). A new migration is therefore applied by simply running the tests.
15. **Task 15's dependencies exist on the branch.** `LegalPage` already takes `subtitle` (`apps/web/src/components/legal/legal-page.tsx`), `prose.tsx` exports `A`, `H2`, `P`, `UL`, `OL`, `LI`, the api serves `/api/store/policy-info` (`apps/server/src/routes/store-info.ts:12-22`), and core exports `STORE_POLICIES` and `isStorePolicy` (`packages/core/src/policies/store-policies.ts`).
16. **Alchemy credentials.** When the Cloudflare login has expired, Alchemy asks for `alchemy profile refresh --profile <name> --provider <provider>` (`refs/stack/alchemy/packages/alchemy/src/Auth/AuthProvider.ts:76`). It opens a browser login, so the user may need to complete it.
17. **Git version.** The machine runs git 2.43. A fixup commit replays non-interactively with `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main`, which is how Task 17 rebuilds the migration commit if `main` gained migrations.

---

## File map

### Part A (branch `w1d-public-site-auth`)

| File | Status | Responsibility |
|---|---|---|
| `apps/web/src/components/site/{site-header,site-footer,pricing,payouts-pricing}.tsx` | Create | Site header and footer, commerce plan cards, payouts pricing |
| `apps/web/src/app/(site)/layout.tsx`, `apps/web/src/app/(site)/page.tsx` | Create | Site layout and landing page for both products |
| `apps/web/src/app/page.tsx` | Delete | Scaffold page |
| `apps/web/src/app/layout.tsx` | Modify | Default description covers both products |
| W1-D Task 15 files | Create, Modify | As listed in the W1-D plan |

### Part B (branch `s1-services-teams`)

| File | Status | Responsibility |
|---|---|---|
| `packages/core/src/tenancy/team-product.ts` (+test) | Create | `TEAM_PRODUCTS`, `TeamProduct`, `isTeamProduct` |
| `packages/core/src/tenancy/slug.ts` (+test) | Modify | `teamSlugProblem` |
| `packages/core/src/services-teams/types.ts` (+test) | Create | Roles, currencies, modes, `ServicesTeamRecord`, `ServicesTeamSettings`, defaults, guards |
| `packages/core/src/services-teams/rates.ts` (+test) | Create | `percentToBps`, `bpsToPercent` |
| `packages/core/src/services-teams/permissions.ts` (+test) | Create | `canServicesTeam`, `effectiveServicesTeamRole` |
| `packages/core/src/services-teams/setup-steps.ts` (+test) | Create | `servicesTeamSetupSteps` |
| `packages/core/src/index.ts` | Modify | Exports |
| `packages/db/src/schema/organization.ts`, `schema/services-teams.ts`, `schema/index.ts` | Modify, Create | `team.product`, the two tables |
| `packages/db/src/migrations/<ts>_s1_services_teams/` | Generate | Migration |
| `packages/db/src/testing/db.ts` | Modify | Truncate list, `seedServicesTeam`, named `addMember` |
| `packages/db/src/repositories/stores.ts` (+test) | Modify | Filter on `product = 'store'` |
| `packages/db/src/repositories/services-teams.ts` (+test) | Create | Services team repository |
| `packages/auth/src/index.ts` (+test) | Modify | `product` field and hooks |
| `packages/api/src/testing.ts` | Create | `makeSession` shared by router tests |
| `packages/api/src/team-creation.ts` | Create | `organizationForNewTeam`, `toTRPCError` |
| `packages/api/src/services-team-procedure.ts` | Create | `servicesTeamProcedure` |
| `packages/api/src/routers/store.ts` (+test) | Modify | Uses the helper, sends `product: 'store'` |
| `packages/api/src/routers/services-team.ts` (+test) | Create | `servicesTeam` router |
| `packages/api/src/routers/index.ts` | Modify | Mounts `servicesTeam` |
| `apps/web/src/lib/slug-status.ts` (+test) | Modify | Product-aware messages |
| `apps/web/src/lib/workspaces.ts` (+test) | Create | Merge store and services lists per workspace |
| `apps/web/src/lib/services-team-settings-form.ts` (+test) | Create | Settings form values and validation |
| `apps/web/src/lib/services-team-labels.ts` | Create | Labels and descriptions for roles, currencies and modes |
| `apps/web/src/lib/server-api.ts` | Modify | `listMyWorkspaces`, `isServicesTeamSlug` |
| `apps/web/src/app/admin/page.tsx` | Modify | Workspace home with both kinds and both create links |
| `apps/web/src/app/admin/new/services-team/{page,create-services-team-form}.tsx` | Create | "Create your services team" |
| `apps/web/src/components/header.tsx` | Modify | "Home" link |
| `apps/web/src/components/setup-checklist.tsx` | Modify | Title prop, internal links |
| `apps/web/src/components/services-team/{coming-soon,team-not-found}.tsx` | Create | Coming soon notes, not-found panel |
| `apps/web/src/app/admin/[storeSlug]/page.tsx` | Modify | Pick the dashboard by product |
| `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx` | Modify | Not-found copy for both kinds |
| `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx` | Create | Services team dashboard |
| `apps/web/src/app/admin/[storeSlug]/settings/{page,services-team-settings}.tsx` | Create | Settings page |
| `apps/web/src/app/admin/[storeSlug]/members/{page,services-team-members}.tsx` | Create | Members page |

---

# Part A: finish W1-D

Every Part A command runs in `/home/mouhamed/dev/repos/jendal/jendal-workspace` on branch `w1d-public-site-auth`, except Task A4. The directory has an untracked `.playwright-mcp/` folder from earlier browser checks; never add it to a commit.

## Task A1: Landing page for both products (revised W1-D Task 13)

Replaces W1-D Task 13 (`2026-10-05-w1d-public-site-auth-onboarding.md`, lines 3561-3889). Its Step 1 (`content/legal/meta.ts`) is dropped because Task 14 already created that file with the same three constants. The header, footer and site layout keep the original code with copy changes; the commerce plan cards keep the original `Pricing` component with two small changes; the landing page is rewritten for two products.

**Files:**
- Create: `apps/web/src/components/site/site-header.tsx`, `apps/web/src/components/site/site-footer.tsx`, `apps/web/src/components/site/pricing.tsx`, `apps/web/src/components/site/payouts-pricing.tsx`, `apps/web/src/app/(site)/layout.tsx`, `apps/web/src/app/(site)/page.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Delete: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Check the starting point**

```bash
git status --short
git log --oneline -1
cat apps/web/src/content/legal/meta.ts
```

Expected: only `?? .playwright-mcp/`; HEAD is `3770b0b feat(web): add the Terms of Service, Privacy Policy and Acceptable Use Policy`; `meta.ts` exports `OPERATOR_NAME`, `CONTACT_EMAIL` and `LEGAL_LAST_UPDATED`.

- [ ] **Step 2: Header, footer and site layout**

`apps/web/src/components/site/site-header.tsx`:

```tsx
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import Link from "next/link";

export default function SiteHeader({ adminOrigin }: { adminOrigin: string }) {
  return (
    <header className="border-b">
      <div className="container mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Payleor
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm sm:gap-5">
          <a href="/#products" className="underline-offset-4 hover:underline">
            Products
          </a>
          <a href="/#pricing" className="underline-offset-4 hover:underline">
            Pricing
          </a>
          <a href={`${adminOrigin}/login`} className="underline-offset-4 hover:underline">
            Log in
          </a>
          <a href={`${adminOrigin}/signup`} className={buttonVariants({ size: "sm" })}>
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}
```

`apps/web/src/components/site/site-footer.tsx` (unchanged from the original Task 13):

```tsx
import Link from "next/link";

import { CONTACT_EMAIL } from "@/content/legal/meta";

export default function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/legal/terms" className="hover:text-foreground">
            Terms of Service
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link href="/legal/acceptable-use" className="hover:text-foreground">
            Acceptable Use Policy
          </Link>
        </nav>
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground">
            {CONTACT_EMAIL}
          </a>{" "}
          · © 2026 Payleor
        </p>
      </div>
    </footer>
  );
}
```

`apps/web/src/app/(site)/layout.tsx` (unchanged from the original Task 13):

```tsx
import SiteFooter from "@/components/site/site-footer";
import SiteHeader from "@/components/site/site-header";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { admin } = await getPlatformOrigins();
  return (
    <>
      <SiteHeader adminOrigin={admin} />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
```

This layout also wraps the legal pages from Task 14, which until now rendered without a header or footer.

- [ ] **Step 3: Commerce plan cards**

`apps/web/src/components/site/pricing.tsx`. Compared with the original Task 13, plan names are `h4` (they now sit under the "Commerce" `h3`), the toggle is labelled "Commerce billing period", and the PayPal fee note moves to the pricing section because it applies to both products:

```tsx
"use client";

import { type BillingInterval, formatOrderFee, formatPlanPrice, PLANS, TRIAL_DAYS } from "@jendal-workspace/core";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Check } from "lucide-react";
import { useState } from "react";

const INTERVALS: Array<{ id: BillingInterval; label: string }> = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly · save about 25%" },
];

export default function Pricing({ signupUrl }: { signupUrl: string }) {
  const [billing, setBilling] = useState<BillingInterval>("monthly");

  return (
    <div className="space-y-8">
      <div role="group" aria-label="Commerce billing period" className="mx-auto flex w-fit border p-1">
        {INTERVALS.map((interval) => (
          <button
            key={interval.id}
            type="button"
            aria-pressed={billing === interval.id}
            onClick={() => setBilling(interval.id)}
            className="px-4 py-1.5 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {interval.label}
          </button>
        ))}
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <li key={plan.id} className="flex flex-col border p-6">
            <h4 className="text-lg font-semibold">{plan.name}</h4>
            <p className="mt-4">
              <span className="text-4xl font-semibold tabular-nums">{formatPlanPrice(plan.priceCents[billing])}</span>
              <span className="text-muted-foreground"> /month</span>
            </p>
            <p className="mt-1 min-h-5 text-sm text-muted-foreground">
              {billing === "yearly" ? `Billed yearly at ${formatPlanPrice(plan.priceCents.yearly * 12)}` : "Billed monthly"}
            </p>
            <p className="mt-3 text-sm font-medium">+ {formatOrderFee(plan.orderFeeBps)} per order</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {plan.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {highlight}
                </li>
              ))}
            </ul>
            <a href={signupUrl} className={`${buttonVariants({ size: "lg" })} mt-6 w-full`}>
              Start free trial
            </a>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm text-muted-foreground">{TRIAL_DAYS}-day free trial. No setup fee.</p>
    </div>
  );
}
```

- [ ] **Step 4: Payouts pricing**

`apps/web/src/components/site/payouts-pricing.tsx`. The plan prices are not decided (services spec §13), so the card shows only the decided fee and says the plans are coming:

```tsx
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Check } from "lucide-react";

const INCLUDED = [
  "Projects, quotes, amendments and deliveries",
  "Client pay pages with PayPal, no client account needed",
  "Freelancer payouts by approval, by rule or automatically",
  "A public API, outgoing webhooks and a Discord bot",
  "Cases and disputes, with templates you set up",
];

export default function PayoutsPricing({ signupUrl }: { signupUrl: string }) {
  return (
    <div className="grid gap-8 border p-6 md:grid-cols-2">
      <div>
        <p className="text-4xl font-semibold tabular-nums">0.5% + 0.10</p>
        <p className="mt-1 text-sm text-muted-foreground">
          per client payment, in your team's currency (USD or EUR)
        </p>
        <p className="mt-4 text-sm font-medium">Plus a plan. Plan prices are coming soon.</p>
        <a href={signupUrl} className={`${buttonVariants({ size: "lg" })} mt-6`}>
          Get started
        </a>
      </div>
      <ul className="space-y-2 text-sm">
        {INCLUDED.map((item) => (
          <li key={item} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Landing page**

`apps/web/src/app/(site)/page.tsx`:

```tsx
import { env } from "cloudflare:workers";
import { TRIAL_DAYS } from "@jendal-workspace/core";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Bot, Briefcase, Check, Scale, Store, Wallet } from "lucide-react";
import type { Metadata } from "next";

import PayoutsPricing from "@/components/site/payouts-pricing";
import Pricing from "@/components/site/pricing";
import { getPlatformOrigins, getStoreUrlParts } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

export const metadata: Metadata = {
  title: "Payleor: stores and services teams, paid through PayPal",
  description:
    "Run a store that sells on the web, in ChatGPT and Claude, and to AI shoppers. Or run a services team with quotes, client payments and freelancer payouts. Payments go to your PayPal account.",
};

const PRODUCTS = [
  {
    id: "commerce",
    icon: Store,
    name: "Commerce",
    title: "Agentic stores",
    text: "One catalog, sold on your web storefront, in the ChatGPT and Claude plugins, and to AI shoppers.",
    points: [
      "A web storefront at your own address",
      "ChatGPT and Claude plugins",
      "AI shopper protocols: Store Sync, ACP, UCP and AP2",
      "A dispute agent that drafts your replies for you to approve",
      "Several stores per workspace, with staff access per store",
    ],
    cta: "Create your store",
  },
  {
    id: "payouts",
    icon: Briefcase,
    name: "Payouts",
    title: "Services teams",
    text: "For freelance teams that sell services. Follow each project from quote to final payment, and pay your freelancers from your own PayPal account.",
    points: [
      "Projects with quotes, amendments and deliveries",
      "Clients pay on a pay page, with no account to create",
      "Freelancer payouts by approval, by rule or automatically",
      "A public API and a Discord bot for your ticket channels",
      "Cases and disputes, with templates you set up",
    ],
    cta: "Get started",
  },
];

const STEPS = [
  { title: "Create your workspace", text: "Sign up, then add a store, a services team, or both." },
  { title: "Connect PayPal", text: "Link your PayPal business account. Buyers and clients pay you directly." },
  { title: "Get to work", text: "Sell on every channel, or send quotes and pay your freelancers." },
];

const PRINCIPLES = [
  {
    icon: Wallet,
    title: "Paid straight to you",
    text: "Payments land in your PayPal account. Payleor never holds your money.",
  },
  {
    icon: Bot,
    title: "Agents ask first",
    text: "Agents draft dispute replies and prepare payouts. None of them moves money without a rule you set or your confirmation.",
  },
  {
    icon: Scale,
    title: "One place for disputes",
    text: "Store disputes and services cases share one module, and PayPal disputes sync into it.",
  },
];

export default async function LandingPage() {
  const [{ admin }, urlParts] = await Promise.all([getPlatformOrigins(), getStoreUrlParts()]);
  const signupUrl = `${admin}/signup`;
  const demoUrl = env.DEMO_STORE_SLUG ? storeUrl(env.DEMO_STORE_SLUG, urlParts) : null;

  return (
    <main>
      <section className="container mx-auto max-w-5xl px-4 py-20 text-center sm:py-28">
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Sell products or services, and get paid through PayPal
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground text-pretty">
          A Payleor workspace has two products. Commerce gives you a store that sells to people and to AI shoppers.
          Payouts runs a services team: quotes, client payments and what you owe each freelancer. Use one or both.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <a href={signupUrl} className={buttonVariants({ size: "lg" })}>
            Get started
          </a>
          <a href="#pricing" className={buttonVariants({ size: "lg", variant: "outline" })}>
            See pricing
          </a>
          {demoUrl ? (
            <a href={demoUrl} className={buttonVariants({ size: "lg", variant: "outline" })}>
              See the demo store
            </a>
          ) : null}
        </div>
      </section>

      <section id="products" aria-labelledby="products-heading" className="scroll-mt-16 border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="products-heading" className="text-2xl font-semibold tracking-tight">
            Two products, one workspace
          </h2>
          <ul className="mt-8 grid gap-6 md:grid-cols-2">
            {PRODUCTS.map((product) => (
              <li key={product.id} aria-labelledby={`${product.id}-heading`} className="flex flex-col border p-6">
                <product.icon aria-hidden className="size-5" />
                <p className="mt-4 text-sm font-medium text-muted-foreground">{product.name}</p>
                <h3 id={`${product.id}-heading`} className="text-xl font-semibold">
                  {product.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{product.text}</p>
                <ul className="mt-6 flex-1 space-y-2 text-sm">
                  {product.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <a href={signupUrl} className={`${buttonVariants({ variant: "outline" })} mt-6 self-start`}>
                  {product.cta}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <p className="text-sm font-medium text-muted-foreground tabular-nums">Step {index + 1}</p>
                <h3 className="mt-1 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="principles-heading" className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="principles-heading" className="text-2xl font-semibold tracking-tight">
            Your money, your rules
          </h2>
          <ul className="mt-8 grid gap-8 md:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <li key={principle.title} className="flex gap-4">
                <principle.icon aria-hidden className="mt-0.5 size-5 shrink-0" />
                <div>
                  <h3 className="font-semibold">{principle.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{principle.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-16 border-t">
        <div className="container mx-auto max-w-5xl space-y-16 px-4 py-16">
          <div className="text-center">
            <h2 id="pricing-heading" className="text-2xl font-semibold tracking-tight">
              Pricing
            </h2>
            <p className="mt-2 text-muted-foreground">Each product has its own plan and fees. Pay only for what you use.</p>
          </div>

          <section aria-labelledby="commerce-pricing-heading" className="space-y-6">
            <div>
              <h3 id="commerce-pricing-heading" className="text-xl font-semibold">
                Commerce
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                One plan per store. Pay monthly or yearly. The order fee drops as you grow.
              </p>
            </div>
            <Pricing signupUrl={signupUrl} />
          </section>

          <section aria-labelledby="payouts-pricing-heading" className="space-y-6">
            <div>
              <h3 id="payouts-pricing-heading" className="text-xl font-semibold">
                Payouts
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">A fee on each client payment, plus a plan.</p>
            </div>
            <PayoutsPricing signupUrl={signupUrl} />
          </section>

          <div className="space-y-2 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Using both? Bundles of both products are coming.</p>
            <p>PayPal's processing fees apply and are charged by PayPal.</p>
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Start with one product. Add the other when you need it.</h2>
          <p className="mt-2 text-muted-foreground">Commerce plans start with a {TRIAL_DAYS}-day free trial. No setup fee.</p>
          <a href={signupUrl} className={`${buttonVariants({ size: "lg" })} mt-6`}>
            Get started
          </a>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Default description and scaffold page**

In `apps/web/src/app/layout.tsx`, replace the `metadata` constant:

```ts
export const metadata: Metadata = {
  title: "Payleor",
  description: "Stores and services teams, paid through PayPal",
};
```

Then remove the scaffold page, which would otherwise claim `/` together with `(site)/page.tsx`:

```bash
git rm apps/web/src/app/page.tsx
```

- [ ] **Step 7: Type check and look at it**

Run: `pnpm -F web check-types`
Expected: no errors.

Start the dev stack (see Task A3 Step 1 if Alchemy reports expired Cloudflare credentials) and open `http://localhost:3001/`. Expected:
- Header: Payleor, Products, Pricing, Log in, Get started. "Products" scrolls to the two product cards, "Pricing" to the pricing section.
- Hero, "Two products, one workspace" (Commerce and Payouts cards), "How it works", "Your money, your rules", Pricing, closing call to action, footer with the three legal links.
- Commerce pricing toggle: Starter $12 → $9 yearly with "Billed yearly at $108"; Grow $39 → $29; Scale $129 → $99; fees 2%, 1%, 0.5%.
- Payouts pricing: "0.5% + 0.10", "Plus a plan. Plan prices are coming soon." and no plan price anywhere.
- "Using both? Bundles of both products are coming."
- Every "Get started", "Create your store" and "Start free trial" link goes to `http://admin.localhost:3001/signup`. Without `DEMO_STORE_SLUG`, there is no demo button.
- `http://localhost:3001/legal/terms` now has the header and footer.

- [ ] **Step 8: Refine the visuals, then get the copy approved**

Load the `frontend-design` (or `hallmark`) skill and the `better-writing` skill. Improve the layout, type scale and spacing within the existing tokens. Keep every section, link and number above, and keep the copy unless the user changes it. Check the page at 375 px and 1280 px wide, in light and dark mode. Take a screenshot of each and show them to the user together with the copy in Step 5 and Step 4.

**Stop here and ask the user to approve the copy and the page. Do not commit until they approve** (W1-D spec §4.1). Apply any change they ask for, recheck the type check, and ask again.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/site apps/web/src/app/\(site\)/layout.tsx apps/web/src/app/\(site\)/page.tsx apps/web/src/app/layout.tsx apps/web/src/app/page.tsx
git status --short   # only the files above are staged; .playwright-mcp/ stays untracked
git commit -m "feat(web): add the landing page for both products with commerce and payouts pricing" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task A2: Store policies (W1-D Task 15)

Run W1-D Task 15 exactly as written: `2026-10-05-w1d-public-site-auth-onboarding.md`, lines 4237-4551 (Steps 1–5, ending with the commit "feat(web): add default return, shipping, terms and privacy policies to every store").

Changes needed now that Task 14 ran first and created `apps/web/src/content/legal/meta.ts`: **none to the code.**
- Task 15 does not import `meta.ts`. The only overlap with `meta.ts` was the original Task 13 Step 1, which Task A1 dropped.
- The components Task 15 imports already exist with the props it uses (Fact 15): `LegalPage` with `subtitle`, and `A`, `H2`, `P`, `UL`, `OL`, `LI` from `components/legal/prose.tsx`.
- `app/store/layout.tsx` wraps only the storefront tree; the `(site)` layout from Task A1 does not touch it.

One execution note: Task 15 Step 4 needs the dev stack and a store created through `/new`. If the stack is not running, run the type check, commit, and do the Step 4 checks as part of Task A3 Step 2.

---

## Task A3: Full check, walkthrough and deploy (W1-D Task 16)

Run W1-D Task 16 (`2026-10-05-w1d-public-site-auth-onboarding.md`, lines 4554-4621) with these changes:

- [ ] **Step 1: Refresh the Cloudflare login before starting the dev stack**

The local dev stack runs through Alchemy, whose Cloudflare login expires (Fact 16). If `pnpm dev` reports missing or expired Cloudflare credentials, run:

```bash
cd packages/infra && pnpm exec alchemy profile refresh --profile default --provider Cloudflare
```

It opens a browser login; ask the user to complete it if you cannot. Then start the stack from the repository root with `pnpm dev` (in the background; it never exits).

- [ ] **Step 2: Run Task 16 Step 1, then a local walkthrough before the tunnel**

Task 16 Step 1 as written (`pnpm test && pnpm check-types`; expected: every test passes, no type errors). Then walk through these locally on `http://localhost:3001` and `http://admin.localhost:3001`, because their own walkthrough steps were deferred while the branch was built:

1. W1-D Task 11 Step 7 (lines 3199-3210): sign-up, verification email, sign-out and log in, password reset, invalid reset link, sign-in rate limit, `/login` while signed in. Item 2's note about `/new` showing "Store not found" no longer applies; `/new` exists.
2. W1-D Task 12 Step 6 (lines 3542-3551): redirect to `/new`, slug suggestion, reserved and taken addresses, store creation with "1 of 3 done", the store list.
3. W1-D Task 14 Step 6 (lines 4224-4226): the three legal pages, now with the site header and footer from Task A1.
4. Task A1 Step 7.
5. W1-D Task 15 Step 4 (lines 4541-4544), if it was deferred in Task A2.

Then run Task 16 Step 2 over the tunnel as written. Record each failure as a new task in this plan before fixing it.

- [ ] **Step 3: Task 16 Steps 3–5 as written**

Note in the W1-A plan, `pnpm -F @jendal-workspace/db db:migrate` for Aiven (it migrates `DATABASE_URL`, which `packages/db/.env.schema` imports from `apps/server`), `alchemy deploy`, and the SMTP check with an inbox the user gives you.

- [ ] **Step 4: Record the results (replaces Task 16 Step 6)**

Tick the steps in the W1-D plan and add a "Result" note under its Task 16 (date, test count, deploy outcome, SMTP outcome). `specs/` lives outside the workspace repository, so that edit is not committed. Then:

```bash
git status --short
```

If anything other than `?? .playwright-mcp/` is listed (for example a fix made during the walkthrough that has not been committed yet), stage those paths by name and commit them with a `fix(web): …` or `fix(…): …` message and the trailer. Never use `git add -A` here: it would commit `.playwright-mcp/`. If nothing else is listed, there is nothing to commit.

---

## Task A4: Merge W1-D into `main`

- [ ] **Step 1: Check both trees**

```bash
git -C /home/mouhamed/dev/repos/jendal/jendal-workspace status --short
git -C /home/mouhamed/dev/repos/jendal/worktrees/main status --short --branch
git -C /home/mouhamed/dev/repos/jendal/jendal-workspace diff --stat "$(git -C /home/mouhamed/dev/repos/jendal/jendal-workspace merge-base main w1d-public-site-auth)" main
```

Expected: the first shows only `?? .playwright-mcp/`; the second shows `## main` and nothing else. The third prints nothing when `main` still equals the W1-A commit the branch started from; if another workstream (S3, S4A, S5) has already merged, the diff lists what `main` gained, and Step 2 handles it.

- [ ] **Step 2: Rebase onto main (execution doc §1.4)**

```bash
cd /home/mouhamed/dev/repos/jendal/jendal-workspace
git rebase main
```

If the rebase replayed commits (Step 1's diff was non-empty), rerun the full check before merging: `pnpm test && pnpm check-types`. If it was already up to date, the rebase is a no-op and the earlier checks stand.

- [ ] **Step 3: Merge without fast-forward**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git merge --no-ff w1d-public-site-auth -m "Merge branch 'w1d-public-site-auth': public site, auth, onboarding and legal pages (W1-D)" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
git log --oneline --graph -3
```

Expected: a merge commit on `main` whose second parent is the last W1-D commit. Do not push (there is no remote). Tell the controller that W1-D is merged, so S1 Part B (and S2, S4 Part B later) can start from this `main`.

---
# Part B: services teams foundation

Every Part B command runs in `/home/mouhamed/dev/repos/jendal/worktrees/s1` unless a step says otherwise. Part B starts after Task A4 has merged W1-D into `main`.

## Task 0: Worktree and setup

**Files:** none (local setup only, nothing to commit).

- [ ] **Step 1: Create the worktree from `main`** (execution doc §2)

```bash
WS=s1; WT=/home/mouhamed/dev/repos/jendal/worktrees/$WS; SRC=/home/mouhamed/dev/repos/jendal/jendal-workspace
git -C $SRC log --oneline -1 main
git -C $SRC worktree add $WT -b s1-services-teams main
cp $SRC/apps/server/.env $WT/apps/server/.env
cp $SRC/packages/infra/.env $WT/packages/infra/.env
sed -E "s#(/jendal_test)([^/?]*)#\1_${WS}#" $SRC/.env.test.local > $WT/.env.test.local
docker exec jendal-pg createdb -U postgres "jendal_test_${WS}" 2>/dev/null || true
cd $WT && pnpm install --frozen-lockfile
```

Expected: `main`'s last commit is the W1-D merge from Task A4; the worktree exists on branch `s1-services-teams`; `pnpm install` finishes without changing `pnpm-lock.yaml`.

- [ ] **Step 2: Check the test database name without printing secrets**

```bash
grep -c "/jendal_test_s1" .env.test.local
```

Expected: `1`. The tests now use `jendal_test_s1`, which the global setup is allowed to reset because its name contains `test`.

- [ ] **Step 3: Baseline**

```bash
pnpm test && pnpm check-types
```

Expected: every test passes (database tests run, none skipped) and no type errors. If anything fails here, stop and report it: it is not caused by this plan.

---

## Task 1: Core types for products, services teams and rates

**Files:**
- Create: `packages/core/src/tenancy/team-product.ts`, `packages/core/src/services-teams/types.ts`, `packages/core/src/services-teams/rates.ts`
- Modify: `packages/core/src/tenancy/slug.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/tenancy/team-product.test.ts`, `packages/core/src/tenancy/slug.test.ts`, `packages/core/src/services-teams/types.test.ts`, `packages/core/src/services-teams/rates.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/tenancy/team-product.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isTeamProduct, TEAM_PRODUCTS } from "./team-product";

describe("isTeamProduct", () => {
  it("accepts the two products", () => {
    expect(TEAM_PRODUCTS).toEqual(["store", "services"]);
    expect(isTeamProduct("store")).toBe(true);
    expect(isTeamProduct("services")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isTeamProduct("shop")).toBe(false);
    expect(isTeamProduct(undefined)).toBe(false);
    expect(isTeamProduct(null)).toBe(false);
  });
});
```

In `packages/core/src/tenancy/slug.test.ts`, change the import to:

```ts
import { storeSlugProblem, suggestStoreSlug, teamSlugProblem, validateStoreSlug } from "./slug";
```

and add at the end of the file:

```ts
describe("teamSlugProblem", () => {
  it("speaks of a store address for stores", () => {
    expect(teamSlugProblem("reserved", "store")).toBe("This store address is reserved.");
    expect(teamSlugProblem("taken", "store")).toBe("This store address is already taken.");
  });

  it("speaks of a team address for services teams", () => {
    expect(teamSlugProblem("reserved", "services")).toBe("This team address is reserved.");
    expect(teamSlugProblem("taken", "services")).toBe("This team address is already taken.");
  });

  it("explains the format the same way for both", () => {
    expect(teamSlugProblem("format", "services")).toBe(storeSlugProblem("format"));
  });
});
```

`packages/core/src/services-teams/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  CURRENCIES,
  defaultServicesTeamSettings,
  isCurrency,
  isPayoutMode,
  isQuotingMode,
  isServicesTeamRole,
  PAYOUT_MODES,
  QUOTING_MODES,
  SERVICES_TEAM_ROLES,
} from "./types";

describe("defaultServicesTeamSettings", () => {
  it("starts in USD with a 15% cut, a 10% management fee, assigned quotes and manual payouts", () => {
    expect(defaultServicesTeamSettings("team-1")).toEqual({
      teamId: "team-1",
      currency: "USD",
      teamCutBps: 1500,
      managementFeeBps: 1000,
      quotingMode: "assigned",
      payoutMode: "manual",
      settingsSavedAt: null,
    });
  });
});

describe("value guards", () => {
  it("accept only the listed values", () => {
    expect(SERVICES_TEAM_ROLES.every(isServicesTeamRole)).toBe(true);
    expect(isServicesTeamRole("owner")).toBe(false);
    expect(CURRENCIES.every(isCurrency)).toBe(true);
    expect(isCurrency("GBP")).toBe(false);
    expect(QUOTING_MODES.every(isQuotingMode)).toBe(true);
    expect(isQuotingMode("bidding")).toBe(false);
    expect(PAYOUT_MODES.every(isPayoutMode)).toBe(true);
    expect(isPayoutMode(undefined)).toBe(false);
  });
});
```

`packages/core/src/services-teams/rates.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { bpsToPercent, percentToBps } from "./rates";

describe("percentToBps", () => {
  it("reads whole and decimal percentages", () => {
    expect(percentToBps("15")).toBe(1500);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("12.25")).toBe(1225);
    expect(percentToBps("0.05")).toBe(5);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("100")).toBe(10_000);
  });

  it("accepts spaces, a percent sign and a decimal comma", () => {
    expect(percentToBps(" 15 ")).toBe(1500);
    expect(percentToBps("15%")).toBe(1500);
    expect(percentToBps("12,5 %")).toBe(1250);
  });

  it("rejects empty, negative, oversized and over-precise values", () => {
    for (const input of ["", "abc", "-1", "100.01", "250", "12.255", "1e2", ".5"]) {
      expect(percentToBps(input)).toBeNull();
    }
  });
});

describe("bpsToPercent", () => {
  it("drops trailing zeros", () => {
    expect(bpsToPercent(1500)).toBe("15");
    expect(bpsToPercent(1250)).toBe("12.5");
    expect(bpsToPercent(1225)).toBe("12.25");
    expect(bpsToPercent(5)).toBe("0.05");
    expect(bpsToPercent(0)).toBe("0");
  });

  it("round-trips with percentToBps", () => {
    for (const bps of [0, 1, 10, 99, 150, 1500, 3333, 10_000]) {
      expect(percentToBps(bpsToPercent(bps))).toBe(bps);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test packages/core/src/tenancy packages/core/src/services-teams`
Expected: FAIL. `team-product.test.ts`, `types.test.ts` and `rates.test.ts` cannot resolve their modules; `slug.test.ts` fails with `teamSlugProblem is not a function`.

- [ ] **Step 3: Implement**

`packages/core/src/tenancy/team-product.ts`:

```ts
// Stores and services teams are both Better Auth teams, told apart by team.product (services spec §3).
export const TEAM_PRODUCTS = ["store", "services"] as const;

export type TeamProduct = (typeof TEAM_PRODUCTS)[number];

export function isTeamProduct(value: unknown): value is TeamProduct {
  return TEAM_PRODUCTS.some((product) => product === value);
}
```

In `packages/core/src/tenancy/slug.ts`, add at the top:

```ts
import type { TeamProduct } from "./team-product";
```

and replace the `storeSlugProblem` function at the end of the file with:

```ts
// Stores and services teams share one slug namespace; only the noun in the message differs.
export function teamSlugProblem(problem: StoreSlugProblem, product: TeamProduct): string {
  const noun = product === "store" ? "store" : "team";
  switch (problem) {
    case "format":
      return "Use 3 to 40 lowercase letters, numbers or single hyphens.";
    case "reserved":
      return `This ${noun} address is reserved.`;
    case "taken":
      return `This ${noun} address is already taken.`;
  }
}

export function storeSlugProblem(problem: StoreSlugProblem): string {
  return teamSlugProblem(problem, "store");
}
```

`packages/core/src/services-teams/types.ts`:

```ts
export const SERVICES_TEAM_ROLES = ["admin", "manager", "freelancer"] as const;
export type ServicesTeamRole = (typeof SERVICES_TEAM_ROLES)[number];

export const CURRENCIES = ["USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const QUOTING_MODES = ["open", "assigned", "team"] as const;
export type QuotingMode = (typeof QUOTING_MODES)[number];

export const PAYOUT_MODES = ["manual", "rules", "automatic"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

// A services team is a Better Auth team with product "services"; `id` is the team ID.
export type ServicesTeamRecord = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  paypalMerchantId: string | null;
};

export type ServicesTeamSettings = {
  teamId: string;
  currency: Currency;
  // Basis points: 1500 = 15%.
  teamCutBps: number;
  managementFeeBps: number;
  quotingMode: QuotingMode;
  payoutMode: PayoutMode;
  // Null until an admin saves the settings once; the setup checklist reads it.
  settingsSavedAt: Date | null;
};

export type ServicesTeamSettingsInput = Pick<
  ServicesTeamSettings,
  "currency" | "teamCutBps" | "managementFeeBps" | "quotingMode" | "payoutMode"
>;

export const MAX_RATE_BPS = 10_000;

// Must match the column defaults of services_team_settings in packages/db.
export function defaultServicesTeamSettings(teamId: string): ServicesTeamSettings {
  return {
    teamId,
    currency: "USD",
    teamCutBps: 1500,
    managementFeeBps: 1000,
    quotingMode: "assigned",
    payoutMode: "manual",
    settingsSavedAt: null,
  };
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((v) => v === value);
}

export function isServicesTeamRole(value: unknown): value is ServicesTeamRole {
  return oneOf(SERVICES_TEAM_ROLES, value);
}

export function isCurrency(value: unknown): value is Currency {
  return oneOf(CURRENCIES, value);
}

export function isQuotingMode(value: unknown): value is QuotingMode {
  return oneOf(QUOTING_MODES, value);
}

export function isPayoutMode(value: unknown): value is PayoutMode {
  return oneOf(PAYOUT_MODES, value);
}
```

`packages/core/src/services-teams/rates.ts`:

```ts
import { MAX_RATE_BPS } from "./types";

// A whole percent with at most two decimals; "," is accepted as the decimal mark.
const PERCENT_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

export function percentToBps(input: string): number | null {
  const match = PERCENT_PATTERN.exec(input.trim().replace(/\s*%$/, ""));
  if (!match) return null;
  const [, whole = "", fraction = ""] = match;
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= MAX_RATE_BPS ? bps : null;
}

export function bpsToPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
```

In `packages/core/src/index.ts`, add after the `./tenancy/target` line:

```ts
export * from "./tenancy/team-product";
```

and at the end:

```ts
export * from "./services-teams/types";
export * from "./services-teams/rates";
```

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types`
Expected: all core tests pass, including the existing `storeSlugProblem` test; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add team products, services team settings types and rate conversion" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 2: Services team permission table

**Files:**
- Create: `packages/core/src/services-teams/permissions.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/services-teams/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/services-teams/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { canServicesTeam, effectiveServicesTeamRole, type ServicesTeamAction } from "./permissions";

const ADMIN_ONLY: ServicesTeamAction[] = [
  "manage_settings",
  "manage_members",
  "manage_connections",
  "manage_developers",
  "approve_payouts",
  "resolve_cases",
];
const MANAGER: ServicesTeamAction[] = [
  "view_team",
  "view_members",
  "start_project",
  "quote_for_team",
  "assign_freelancers",
  "file_case",
];
const FREELANCER: ServicesTeamAction[] = ["view_team", "quote", "deliver", "request_payout", "file_case"];
const NOT_FREELANCER: ServicesTeamAction[] = [
  ...ADMIN_ONLY,
  "view_members",
  "start_project",
  "quote_for_team",
  "assign_freelancers",
];

describe("canServicesTeam", () => {
  it("lets admins do everything a manager does, plus settings, members, connections, payouts and cases", () => {
    for (const action of [...MANAGER, ...ADMIN_ONLY]) expect(canServicesTeam("admin", action)).toBe(true);
  });

  it("lets managers run projects but not change the team", () => {
    for (const action of MANAGER) expect(canServicesTeam("manager", action)).toBe(true);
    for (const action of ADMIN_ONLY) expect(canServicesTeam("manager", action)).toBe(false);
  });

  it("lets freelancers quote, deliver, request payouts and file cases, and nothing else", () => {
    for (const action of FREELANCER) expect(canServicesTeam("freelancer", action)).toBe(true);
    for (const action of NOT_FREELANCER) expect(canServicesTeam("freelancer", action)).toBe(false);
  });

  it("allows nothing without a role", () => {
    expect(canServicesTeam(null, "view_team")).toBe(false);
  });
});

describe("effectiveServicesTeamRole", () => {
  it("makes workspace owners and admins admins of every services team", () => {
    expect(effectiveServicesTeamRole("owner", null)).toBe("admin");
    expect(effectiveServicesTeamRole("admin", "freelancer")).toBe("admin");
    expect(effectiveServicesTeamRole("member, admin", null)).toBe("admin");
  });

  it("uses the team role for other workspace members", () => {
    expect(effectiveServicesTeamRole("member", "manager")).toBe("manager");
    expect(effectiveServicesTeamRole("member", null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test packages/core/src/services-teams/permissions.test.ts`
Expected: FAIL, the module `./permissions` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/core/src/services-teams/permissions.ts`:

```ts
import { hasStoreWideRole } from "../tenancy/access";
import type { ServicesTeamRole } from "./types";

// Services spec §4.1. Quoting also depends on the team's quoting mode, which the quote use case checks.
export type ServicesTeamAction =
  | "view_team"
  | "view_members"
  | "manage_members"
  | "manage_settings"
  | "manage_connections"
  | "manage_developers"
  | "approve_payouts"
  | "resolve_cases"
  | "start_project"
  | "quote_for_team"
  | "assign_freelancers"
  | "quote"
  | "deliver"
  | "request_payout"
  | "file_case";

const MANAGER_ACTIONS: readonly ServicesTeamAction[] = [
  "view_team",
  "view_members",
  "start_project",
  "quote_for_team",
  "assign_freelancers",
  "file_case",
];

const ADMIN_ONLY_ACTIONS: readonly ServicesTeamAction[] = [
  "manage_members",
  "manage_settings",
  "manage_connections",
  "manage_developers",
  "approve_payouts",
  "resolve_cases",
];

const FREELANCER_ACTIONS: readonly ServicesTeamAction[] = ["view_team", "quote", "deliver", "request_payout", "file_case"];

const ACTIONS_BY_ROLE: Record<ServicesTeamRole, ReadonlySet<ServicesTeamAction>> = {
  admin: new Set([...MANAGER_ACTIONS, ...ADMIN_ONLY_ACTIONS]),
  manager: new Set(MANAGER_ACTIONS),
  freelancer: new Set(FREELANCER_ACTIONS),
};

export function canServicesTeam(role: ServicesTeamRole | null, action: ServicesTeamAction): boolean {
  return role !== null && ACTIONS_BY_ROLE[role].has(action);
}

// `workspaceRole` is the Better Auth member role in the team's organization (comma-separated when several).
export function effectiveServicesTeamRole(
  workspaceRole: string,
  teamRole: ServicesTeamRole | null,
): ServicesTeamRole | null {
  return hasStoreWideRole(workspaceRole) ? "admin" : teamRole;
}
```

In `packages/core/src/index.ts`, add at the end:

```ts
export * from "./services-teams/permissions";
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add the services team permission table" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 3: Services team setup steps

**Files:**
- Create: `packages/core/src/services-teams/setup-steps.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/services-teams/setup-steps.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/services-teams/setup-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { countDone } from "../onboarding/setup-steps";
import { servicesTeamSetupSteps } from "./setup-steps";

describe("servicesTeamSetupSteps", () => {
  it("starts a new team with only the first step done; steps without a link have no href", () => {
    const steps = servicesTeamSetupSteps(
      { paypalMerchantId: null, settingsSaved: false },
      { settings: "/acme-studio/settings" },
    );

    expect(steps).toEqual([
      { id: "create-team", label: "Create your team", done: true },
      { id: "set-rates", label: "Set your rates", done: false, href: "/acme-studio/settings" },
      { id: "connect-paypal", label: "Connect PayPal", done: false },
      { id: "add-payout-credentials", label: "Add payout credentials", done: false },
      { id: "link-discord", label: "Link Discord", done: false },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("links the steps whose target exists, and marks rates and PayPal done", () => {
    const steps = servicesTeamSetupSteps(
      { paypalMerchantId: "MERCHANT1", settingsSaved: true },
      { settings: "/acme-studio/settings", connectPaypal: "https://www.paypal.com" },
    );

    expect(steps.map((s) => s.done)).toEqual([true, true, true, false, false]);
    expect(steps.find((s) => s.id === "connect-paypal")?.href).toBe("https://www.paypal.com");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test packages/core/src/services-teams/setup-steps.test.ts`
Expected: FAIL, the module `./setup-steps` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/core/src/services-teams/setup-steps.ts`:

```ts
import type { SetupStep } from "../onboarding/setup-steps";

// Later plans add the missing links: S3 Connect PayPal, the payouts plan credentials, S2 Discord.
// A step without a link renders as plain text (the checklist shows it as not yet available).
export type ServicesTeamSetupLinks = {
  settings: string;
  connectPaypal?: string;
  payoutCredentials?: string;
  linkDiscord?: string;
};

function step(id: string, label: string, done: boolean, href?: string): SetupStep {
  return href ? { id, label, done, href } : { id, label, done };
}

export function servicesTeamSetupSteps(
  state: { paypalMerchantId: string | null; settingsSaved: boolean },
  links: ServicesTeamSetupLinks,
): SetupStep[] {
  return [
    step("create-team", "Create your team", true),
    step("set-rates", "Set your rates", state.settingsSaved, links.settings),
    step("connect-paypal", "Connect PayPal", state.paypalMerchantId !== null, links.connectPaypal),
    step("add-payout-credentials", "Add payout credentials", false, links.payoutCredentials),
    step("link-discord", "Link Discord", false, links.linkDiscord),
  ];
}
```

In `packages/core/src/index.ts`, add at the end:

```ts
export * from "./services-teams/setup-steps";
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add the services team setup steps" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 4: Schema, migration, test helpers and store filtering

**Files:**
- Create: `packages/db/src/schema/services-teams.ts`
- Modify: `packages/db/src/schema/organization.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/testing/db.ts`, `packages/db/src/repositories/stores.ts`
- Generate: `packages/db/src/migrations/<timestamp>_s1_services_teams/`
- Test: `packages/db/src/repositories/stores.test.ts`

- [ ] **Step 1: Write the failing store repository tests**

In `packages/db/src/repositories/stores.test.ts`, add `seedServicesTeam` to the `../testing/db` import (keep the list alphabetical), then add inside the `describe` block:

```ts
  it("leaves services teams out of store lookups and lists, but counts their slugs as taken", async () => {
    const { userId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    const acme = await seedStore(db, { organizationId, slug: "acme", name: "Acme" });
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await expect(directory.findById(studio.id)).resolves.toBeNull();
    await expect(directory.findBySlug("acme-studio")).resolves.toBeNull();
    await expect(findStoreAccess(db, { slug: "acme-studio", userId })).resolves.toBeNull();
    await expect(listOrganizationsWithStores(db, userId)).resolves.toEqual([
      {
        organization: { id: organizationId, name: "Acme Inc" },
        role: "owner",
        stores: [{ store: acme, isTeamMember: false }],
      },
    ]);
    await expect(isStoreSlugTaken(db, "acme-studio")).resolves.toBe(true);
  });

  it("keeps an organization that has only services teams in the store list, with no stores", async () => {
    const { userId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await expect(listOrganizationsWithStores(db, userId)).resolves.toEqual([
      { organization: { id: organizationId, name: "Acme Inc" }, role: "owner", stores: [] },
    ]);
  });

  it("gives new stores the store product", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });

    const [row] = await db.select({ product: team.product }).from(team).where(eq(team.id, store.id));
    expect(row?.product).toBe("store");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test packages/db/src/repositories/stores.test.ts`
Expected: FAIL. `seedServicesTeam` is not exported from `../testing/db` (the file fails to load), and `team.product` does not exist.

- [ ] **Step 3: Add the column and the tables**

In `packages/db/src/schema/organization.ts`, replace the comment above `team` and add `product` after `slug`:

```ts
// Each team is a store or a services team (services spec §3). slug, product, status, paypalMerchantId and
// supportEmail are team additionalFields in packages/auth. status and supportEmail only apply to stores.
export const team = pgTable(
  "team",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    product: text("product", { enum: ["store", "services"] })
      .default("store")
      .notNull(),
    status: text("status", { enum: ["draft", "active", "suspended"] })
      .default("draft")
      .notNull(),
    paypalMerchantId: text("paypal_merchant_id").unique(),
    supportEmail: text("support_email"),
    memberCount: integer("member_count").default(0).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (table) => [index("team_organizationId_idx").on(table.organizationId)],
);
```

`packages/db/src/schema/services-teams.ts`:

```ts
import { index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { team } from "./organization";

// Per-team roles for services teams (services spec §4.1). Workspace owners and admins are admins of
// every services team without a row here.
export const servicesTeamMember = pgTable(
  "services_team_member",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "manager", "freelancer"] }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("services_team_member_team_user_unique").on(table.teamId, table.userId),
    index("services_team_member_userId_idx").on(table.userId),
  ],
);

// Services spec §4.3. The defaults must match defaultServicesTeamSettings in @jendal-workspace/core.
export const servicesTeamSettings = pgTable("services_team_settings", {
  teamId: text("team_id")
    .primaryKey()
    .references(() => team.id, { onDelete: "cascade" }),
  currency: text("currency", { enum: ["USD", "EUR"] })
    .default("USD")
    .notNull(),
  teamCutBps: integer("team_cut_bps").default(1500).notNull(),
  managementFeeBps: integer("management_fee_bps").default(1000).notNull(),
  quotingMode: text("quoting_mode", { enum: ["open", "assigned", "team"] })
    .default("assigned")
    .notNull(),
  payoutMode: text("payout_mode", { enum: ["manual", "rules", "automatic"] })
    .default("manual")
    .notNull(),
  settingsSavedAt: timestamp("settings_saved_at"),
});
```

In `packages/db/src/schema/index.ts`, add at the end:

```ts
export * from "./services-teams";
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name s1_services_teams`
Expected: a new folder `packages/db/src/migrations/<timestamp>_s1_services_teams/`. Read its `migration.sql`. It must:
- create `services_team_member` with `id`, `team_id`, `user_id`, `role`, `created_at DEFAULT now() NOT NULL` and the constraint `services_team_member_team_user_unique` on (`team_id`, `user_id`)
- create `services_team_settings` with `team_id` as primary key and the defaults `'USD'`, `1500`, `1000`, `'assigned'`, `'manual'`, plus a nullable `settings_saved_at`
- add `"product" text DEFAULT 'store' NOT NULL` to `team`
- create the index `services_team_member_userId_idx`
- add three foreign keys with `ON DELETE CASCADE` (`services_team_member.team_id`, `services_team_member.user_id`, `services_team_settings.team_id`)
- contain no `DROP`

Existing teams get `product = 'store'` from the default, so stores keep working without a data migration.

- [ ] **Step 5: Test helpers**

Replace `packages/db/src/testing/db.ts`:

```ts
import { sql } from "drizzle-orm";

import { createDb, type Database } from "../index";
import { user } from "../schema/auth";
import { member, organization, team, teamMember } from "../schema/organization";
import { servicesTeamSettings } from "../schema/services-teams";

export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export function createTestDb(): Database {
  return createDb({ DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" });
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql.raw(
      'truncate table "rate_limit", "services_team_settings", "services_team_member", "store_domains", "team_member", "team", "invitation", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
    ),
  );
}

export async function seedUser(db: Database, name = "Owner"): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(user).values({ id, name, email: `${id}@example.com` });
  return id;
}

export async function seedOrganization(
  db: Database,
  options: { role?: string; name?: string } = {},
): Promise<{ userId: string; organizationId: string }> {
  const userId = await seedUser(db);
  const organizationId = crypto.randomUUID();
  await db.insert(organization).values({
    id: organizationId,
    name: options.name ?? "Acme Inc",
    slug: `org-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  });
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role: options.role ?? "owner",
    createdAt: new Date(),
  });
  return { userId, organizationId };
}

export async function addMember(
  db: Database,
  input: { organizationId: string; role: string; name?: string },
): Promise<string> {
  const userId = await seedUser(db, input.name ?? "Staff");
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    userId,
    role: input.role,
    createdAt: new Date(),
  });
  return userId;
}

export async function seedStore(
  db: Database,
  input: { organizationId: string; slug: string; name?: string; status?: "draft" | "active" | "suspended" },
) {
  const [row] = await db
    .insert(team)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      slug: input.slug,
      name: input.name ?? input.slug,
      status: input.status ?? "draft",
      createdAt: new Date(),
    })
    .returning({
      id: team.id,
      organizationId: team.organizationId,
      slug: team.slug,
      name: team.name,
      status: team.status,
      paypalMerchantId: team.paypalMerchantId,
    });
  if (!row) throw new Error("Insert into team returned no row");
  return row;
}

// Mirrors what the Better Auth create hooks do for a services team: the team row and its default settings.
export async function seedServicesTeam(
  db: Database,
  input: { organizationId: string; slug: string; name?: string; withSettings?: boolean },
) {
  const [row] = await db
    .insert(team)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      slug: input.slug,
      name: input.name ?? input.slug,
      product: "services",
      createdAt: new Date(),
    })
    .returning({
      id: team.id,
      organizationId: team.organizationId,
      slug: team.slug,
      name: team.name,
      paypalMerchantId: team.paypalMerchantId,
    });
  if (!row) throw new Error("Insert into team returned no row");
  if (input.withSettings ?? true) await db.insert(servicesTeamSettings).values({ teamId: row.id });
  return row;
}

export async function addTeamMember(db: Database, input: { teamId: string; userId: string }): Promise<void> {
  await db.insert(teamMember).values({ id: crypto.randomUUID(), ...input, createdAt: new Date() });
}
```

- [ ] **Step 5b: Filter the store repository on `product = 'store'`**

In `packages/db/src/repositories/stores.ts`:

Replace `createStoreDirectory`:

```ts
// Services teams share the team table and the slug namespace, but never resolve as stores.
const isStore = () => eq(team.product, "store");

export function createStoreDirectory(db: Database): StoreDirectory {
  return {
    async findById(id) {
      const [row] = await db
        .select(storeColumns)
        .from(team)
        .where(and(eq(team.id, id), isStore()))
        .limit(1);
      return row ?? null;
    },
    async findBySlug(slug) {
      const [row] = await db
        .select(storeColumns)
        .from(team)
        .where(and(eq(team.slug, slug), isStore()))
        .limit(1);
      return row ?? null;
    },
    async findByHostname(hostname) {
      const [row] = await db
        .select(storeColumns)
        .from(storeDomains)
        .innerJoin(team, eq(storeDomains.storeId, team.id))
        .where(and(eq(storeDomains.hostname, hostname), eq(storeDomains.status, "active"), isStore()))
        .limit(1);
      return row ?? null;
    },
  };
}
```

In `findStoreAccess`, change the `where` line to:

```ts
    .where(and(eq(team.slug, input.slug), isStore()))
```

In `listOrganizationsWithStores`, change the team join to (the condition stays in the join so organizations without stores are still listed):

```ts
    .leftJoin(team, and(eq(team.organizationId, organization.id), isStore()))
```

Leave `isStoreSlugTaken` unchanged: it must keep checking every team, because stores and services teams share the namespace.

- [ ] **Step 6: Run the tests**

Run: `pnpm test packages/db && pnpm -F @jendal-workspace/db check-types`
Expected: all pass (the global setup re-creates `jendal_test_s1` from every migration, including the new one); no type errors.

Then run the packages that use the store repository and the helpers:

Run: `pnpm test packages/api packages/auth apps/server`
Expected: all pass.

- [ ] **Step 7: Commit**

Do not run `pnpm db:migrate:dev` now; the shared dev database gets the final migration in Task 17 (see Decisions).

```bash
git add packages/db/src
git commit -m "feat(db): add team.product, services_team_member and services_team_settings" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

Task 17 finds this commit by its subject; keep it exactly.

---

## Task 5: Services team repository

**Files:**
- Create: `packages/db/src/repositories/services-teams.ts`
- Test: `packages/db/src/repositories/services-teams.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/db/src/repositories/services-teams.test.ts`:

```ts
import { defaultServicesTeamSettings } from "@jendal-workspace/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedStore,
  seedUser,
  truncateAll,
} from "../testing/db";
import {
  addServicesTeamMember,
  createServicesTeamSettings,
  findServicesTeamBySlug,
  findUserByEmail,
  getServicesTeamSettings,
  listOrganizationsWithServicesTeams,
  listServicesTeamMembers,
  saveServicesTeamSettings,
  servicesTeamRoleFor,
  setServicesTeamMemberRole,
  workspaceRoleFor,
} from "./services-teams";

describe.skipIf(!hasTestDatabase)("services team repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("finds a services team by slug, but not a store", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", name: "Acme Studio" });
    await seedStore(db, { organizationId, slug: "acme" });

    expect(studio).toEqual({
      id: expect.any(String),
      organizationId,
      slug: "acme-studio",
      name: "Acme Studio",
      paypalMerchantId: null,
    });
    await expect(findServicesTeamBySlug(db, "acme-studio")).resolves.toEqual(studio);
    await expect(findServicesTeamBySlug(db, "acme")).resolves.toBeNull();
    await expect(findServicesTeamBySlug(db, "missing")).resolves.toBeNull();
  });

  it("reads the default settings, and creating them twice changes nothing", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await createServicesTeamSettings(db, studio.id);

    await expect(getServicesTeamSettings(db, studio.id)).resolves.toEqual(defaultServicesTeamSettings(studio.id));
    await expect(getServicesTeamSettings(db, "missing")).resolves.toBeNull();
  });

  it("saves settings and records when, even without a settings row", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", withSettings: false });
    const input = {
      currency: "EUR",
      teamCutBps: 2000,
      managementFeeBps: 500,
      quotingMode: "open",
      payoutMode: "rules",
    } as const;

    const saved = await saveServicesTeamSettings(db, studio.id, input);

    expect(saved).toEqual({ teamId: studio.id, ...input, settingsSavedAt: expect.any(Date) });
    await expect(getServicesTeamSettings(db, studio.id)).resolves.toEqual(saved);
    const again = await saveServicesTeamSettings(db, studio.id, { ...input, teamCutBps: 2500 });
    expect(again.teamCutBps).toBe(2500);
  });

  it("makes workspace owners and admins team admins, and reads other members' team roles", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const adminId = await addMember(db, { organizationId, role: "admin" });
    const managerId = await addMember(db, { organizationId, role: "member" });
    const plainMemberId = await addMember(db, { organizationId, role: "member" });
    const outsider = await seedOrganization(db);
    await addServicesTeamMember(db, { teamId: studio.id, userId: managerId, role: "manager" });

    await expect(servicesTeamRoleFor(db, studio.id, ownerId)).resolves.toBe("admin");
    await expect(servicesTeamRoleFor(db, studio.id, adminId)).resolves.toBe("admin");
    await expect(servicesTeamRoleFor(db, studio.id, managerId)).resolves.toBe("manager");
    await expect(servicesTeamRoleFor(db, studio.id, plainMemberId)).resolves.toBeNull();
    await expect(servicesTeamRoleFor(db, studio.id, outsider.userId)).resolves.toBeNull();
  });

  it("gives no services team role on a store", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });

    await expect(servicesTeamRoleFor(db, store.id, userId)).resolves.toBeNull();
  });

  it("reads a user's workspace role", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const outsiderId = await seedUser(db);

    await expect(workspaceRoleFor(db, organizationId, userId)).resolves.toBe("owner");
    await expect(workspaceRoleFor(db, organizationId, outsiderId)).resolves.toBeNull();
  });

  it("finds users by email whatever the case and spacing", async () => {
    const id = await seedUser(db, "Bea");

    await expect(findUserByEmail(db, ` ${id.toUpperCase()}@EXAMPLE.COM `)).resolves.toEqual({
      id,
      name: "Bea",
      email: `${id}@example.com`,
    });
    await expect(findUserByEmail(db, "nobody@example.com")).resolves.toBeNull();
  });

  it("lists workspace admins and team members by name, without other workspace members", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const zoeId = await addMember(db, { organizationId, role: "member", name: "Zoe" });
    const bobId = await addMember(db, { organizationId, role: "member", name: "Bob" });
    await addMember(db, { organizationId, role: "member", name: "Carl" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: zoeId, role: "freelancer" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: bobId, role: "manager" });

    await expect(listServicesTeamMembers(db, studio)).resolves.toEqual([
      { userId: bobId, name: "Bob", email: `${bobId}@example.com`, role: "manager", workspaceAdmin: false },
      { userId: ownerId, name: "Owner", email: `${ownerId}@example.com`, role: "admin", workspaceAdmin: true },
      { userId: zoeId, name: "Zoe", email: `${zoeId}@example.com`, role: "freelancer", workspaceAdmin: false },
    ]);
  });

  it("adds a member once and changes the role of members only", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const userId = await addMember(db, { organizationId, role: "member" });
    const strangerId = await seedUser(db);

    await expect(addServicesTeamMember(db, { teamId: studio.id, userId, role: "freelancer" })).resolves.toBe(true);
    await expect(addServicesTeamMember(db, { teamId: studio.id, userId, role: "manager" })).resolves.toBe(false);
    await expect(setServicesTeamMemberRole(db, { teamId: studio.id, userId, role: "manager" })).resolves.toBe(true);
    await expect(servicesTeamRoleFor(db, studio.id, userId)).resolves.toBe("manager");
    await expect(
      setServicesTeamMemberRole(db, { teamId: studio.id, userId: strangerId, role: "admin" }),
    ).resolves.toBe(false);
  });

  it("lists the services teams each user can open, per organization", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    await seedStore(db, { organizationId, slug: "acme" });
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", name: "Acme Studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs", name: "Acme Labs" });
    const freelancerId = await addMember(db, { organizationId, role: "member" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: freelancerId, role: "freelancer" });
    const empty = await seedOrganization(db, { name: "Beta LLC" });

    await expect(listOrganizationsWithServicesTeams(db, ownerId)).resolves.toEqual([
      {
        organization: { id: organizationId, name: "Acme Inc" },
        role: "owner",
        servicesTeams: [
          { team: labs, role: "admin" },
          { team: studio, role: "admin" },
        ],
      },
    ]);
    await expect(listOrganizationsWithServicesTeams(db, freelancerId)).resolves.toEqual([
      {
        organization: { id: organizationId, name: "Acme Inc" },
        role: "member",
        servicesTeams: [{ team: studio, role: "freelancer" }],
      },
    ]);
    await expect(listOrganizationsWithServicesTeams(db, empty.userId)).resolves.toEqual([
      { organization: { id: empty.organizationId, name: "Beta LLC" }, role: "owner", servicesTeams: [] },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test packages/db/src/repositories/services-teams.test.ts`
Expected: FAIL, the module `./services-teams` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/db/src/repositories/services-teams.ts`:

```ts
import {
  effectiveServicesTeamRole,
  hasStoreWideRole,
  type ServicesTeamRecord,
  type ServicesTeamRole,
  type ServicesTeamSettings,
  type ServicesTeamSettingsInput,
} from "@jendal-workspace/core";
import { and, eq } from "drizzle-orm";

import type { Database } from "../index";
import { user } from "../schema/auth";
import { member, organization, team } from "../schema/organization";
import { servicesTeamMember, servicesTeamSettings } from "../schema/services-teams";

const servicesTeamColumns = {
  id: team.id,
  organizationId: team.organizationId,
  slug: team.slug,
  name: team.name,
  paypalMerchantId: team.paypalMerchantId,
};

// Listed explicitly so columns added by later plans do not change what these functions return.
const settingsColumns = {
  teamId: servicesTeamSettings.teamId,
  currency: servicesTeamSettings.currency,
  teamCutBps: servicesTeamSettings.teamCutBps,
  managementFeeBps: servicesTeamSettings.managementFeeBps,
  quotingMode: servicesTeamSettings.quotingMode,
  payoutMode: servicesTeamSettings.payoutMode,
  settingsSavedAt: servicesTeamSettings.settingsSavedAt,
};

export async function findServicesTeamBySlug(db: Database, slug: string): Promise<ServicesTeamRecord | null> {
  const [row] = await db
    .select(servicesTeamColumns)
    .from(team)
    .where(and(eq(team.slug, slug), eq(team.product, "services")))
    .limit(1);
  return row ?? null;
}

export async function getServicesTeamSettings(db: Database, teamId: string): Promise<ServicesTeamSettings | null> {
  const [row] = await db
    .select(settingsColumns)
    .from(servicesTeamSettings)
    .where(eq(servicesTeamSettings.teamId, teamId))
    .limit(1);
  return row ?? null;
}

export async function createServicesTeamSettings(db: Database, teamId: string): Promise<void> {
  await db.insert(servicesTeamSettings).values({ teamId }).onConflictDoNothing();
}

// An upsert, so a team whose settings row is missing can still save.
export async function saveServicesTeamSettings(
  db: Database,
  teamId: string,
  input: ServicesTeamSettingsInput,
): Promise<ServicesTeamSettings> {
  const values = { ...input, settingsSavedAt: new Date() };
  const [row] = await db
    .insert(servicesTeamSettings)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: servicesTeamSettings.teamId, set: values })
    .returning(settingsColumns);
  if (!row) throw new Error("Upsert into services_team_settings returned no row");
  return row;
}

// Null when the team is not a services team, or the user is not in its organization or has no role in it.
export async function servicesTeamRoleFor(
  db: Database,
  teamId: string,
  userId: string,
): Promise<ServicesTeamRole | null> {
  const [row] = await db
    .select({ workspaceRole: member.role, teamRole: servicesTeamMember.role })
    .from(team)
    .innerJoin(member, and(eq(member.organizationId, team.organizationId), eq(member.userId, userId)))
    .leftJoin(servicesTeamMember, and(eq(servicesTeamMember.teamId, team.id), eq(servicesTeamMember.userId, userId)))
    .where(and(eq(team.id, teamId), eq(team.product, "services")))
    .limit(1);
  if (!row) return null;
  return effectiveServicesTeamRole(row.workspaceRole, row.teamRole);
}

export async function workspaceRoleFor(db: Database, organizationId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

export type UserSummary = { id: string; name: string; email: string };

// Better Auth stores emails in lowercase.
export async function findUserByEmail(db: Database, email: string): Promise<UserSummary | null> {
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export type ServicesTeamMemberRow = {
  userId: string;
  name: string;
  email: string;
  role: ServicesTeamRole;
  // True when the role comes from being a workspace owner or admin; such a role cannot be changed here.
  workspaceAdmin: boolean;
};

export async function listServicesTeamMembers(
  db: Database,
  servicesTeam: Pick<ServicesTeamRecord, "id" | "organizationId">,
): Promise<ServicesTeamMemberRow[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      workspaceRole: member.role,
      teamRole: servicesTeamMember.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      servicesTeamMember,
      and(eq(servicesTeamMember.teamId, servicesTeam.id), eq(servicesTeamMember.userId, member.userId)),
    )
    .where(eq(member.organizationId, servicesTeam.organizationId))
    .orderBy(user.name, user.id);

  return rows.flatMap(({ workspaceRole, teamRole, ...person }) => {
    const role = effectiveServicesTeamRole(workspaceRole, teamRole);
    return role ? [{ ...person, role, workspaceAdmin: hasStoreWideRole(workspaceRole) }] : [];
  });
}

// False when the user already has a row in this team.
export async function addServicesTeamMember(
  db: Database,
  input: { teamId: string; userId: string; role: ServicesTeamRole },
): Promise<boolean> {
  const inserted = await db
    .insert(servicesTeamMember)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoNothing({ target: [servicesTeamMember.teamId, servicesTeamMember.userId] })
    .returning({ id: servicesTeamMember.id });
  return inserted.length > 0;
}

// False when the user has no row in this team.
export async function setServicesTeamMemberRole(
  db: Database,
  input: { teamId: string; userId: string; role: ServicesTeamRole },
): Promise<boolean> {
  const updated = await db
    .update(servicesTeamMember)
    .set({ role: input.role })
    .where(and(eq(servicesTeamMember.teamId, input.teamId), eq(servicesTeamMember.userId, input.userId)))
    .returning({ id: servicesTeamMember.id });
  return updated.length > 0;
}

export type OrganizationServicesTeams = {
  organization: { id: string; name: string };
  role: string;
  servicesTeams: Array<{ team: ServicesTeamRecord; role: ServicesTeamRole }>;
};

// Every organization of the user, with the services teams they can open and their role in each.
export async function listOrganizationsWithServicesTeams(
  db: Database,
  userId: string,
): Promise<OrganizationServicesTeams[]> {
  const rows = await db
    .select({
      organizationId: organization.id,
      organizationName: organization.name,
      role: member.role,
      team: servicesTeamColumns,
      teamRole: servicesTeamMember.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .leftJoin(team, and(eq(team.organizationId, organization.id), eq(team.product, "services")))
    .leftJoin(servicesTeamMember, and(eq(servicesTeamMember.teamId, team.id), eq(servicesTeamMember.userId, userId)))
    .where(eq(member.userId, userId))
    .orderBy(organization.name, organization.id, team.name, team.id);

  const byOrganization = new Map<string, OrganizationServicesTeams>();
  for (const row of rows) {
    let entry = byOrganization.get(row.organizationId);
    if (!entry) {
      entry = { organization: { id: row.organizationId, name: row.organizationName }, role: row.role, servicesTeams: [] };
      byOrganization.set(row.organizationId, entry);
    }
    const role = row.team ? effectiveServicesTeamRole(row.role, row.teamRole) : null;
    if (row.team && role) entry.servicesTeams.push({ team: row.team, role });
  }
  return [...byOrganization.values()];
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test packages/db && pnpm -F @jendal-workspace/db check-types`
Expected: all pass; no type errors. A type error on `currency`, `quotingMode`, `payoutMode` or `role` means the schema's enum literals drifted from the core types; fix the schema.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories
git commit -m "feat(db): add the services team repository" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 6: The `product` field and team hooks in auth

**Files:**
- Modify: `packages/auth/src/index.ts`
- Test: `packages/auth/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/auth/src/index.test.ts`, add `defaultServicesTeamSettings` to the `@jendal-workspace/core` import (create the import if the file has none), add `servicesTeamSettings` to the `@jendal-workspace/db/schema/...` imports via:

```ts
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
```

and add inside the `describe("stores as Better Auth teams")` block, after the existing `createTeam` tests:

```ts
  it("gives a team the store product when none is passed, and a services team its settings", async () => {
    const { headers, organizationId, email } = await ownerWithOrganization();

    const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme" }, headers });
    const studio = await auth.api.createTeam({
      body: { name: "Acme Studio", organizationId, slug: "acme-studio", product: "services" },
      headers,
    });

    const teams = await db.select().from(team).where(eq(team.organizationId, organizationId));
    expect(teams.find((t) => t.id === store.id)).toMatchObject({ product: "store", supportEmail: email });
    expect(teams.find((t) => t.id === studio.id)).toMatchObject({ product: "services", supportEmail: null });
    await expect(
      db.select().from(servicesTeamSettings).where(eq(servicesTeamSettings.teamId, studio.id)),
    ).resolves.toEqual([defaultServicesTeamSettings(studio.id)]);
  });

  it("rejects an unknown product with the same codes the slug rules use", async () => {
    const { headers, organizationId } = await ownerWithOrganization();

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme", product: "shop" as never }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_PRODUCT_INVALID" } });
  });

  it("words slug errors for a services team", async () => {
    const { headers, organizationId } = await ownerWithOrganization();

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "login", product: "services" }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_SLUG_RESERVED", message: "This team address is reserved." } });
  });

  it("rejects a slug that a services team already uses, for a store", async () => {
    const { headers, organizationId } = await ownerWithOrganization();
    await auth.api.createTeam({ body: { name: "Acme Studio", organizationId, slug: "acme-studio", product: "services" }, headers });

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme-studio" }, headers }),
    ).rejects.toMatchObject({ status: "CONFLICT", body: { code: "TEAM_SLUG_TAKEN" } });
  });

  it("refuses to change a team's product, and still allows renaming", async () => {
    const { headers, organizationId } = await ownerWithOrganization();
    const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme" }, headers });

    await expect(
      auth.api.updateTeam({ body: { teamId: store.id, data: { product: "services" } }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_PRODUCT_IMMUTABLE" } });

    const renamed = await auth.api.updateTeam({ body: { teamId: store.id, data: { name: "Acme Goods" } }, headers });
    expect(renamed).toMatchObject({ name: "Acme Goods", product: "store" });
  });
```

The existing test "creates a draft store from a normalized slug" now runs against the new hook; keep it as is — it asserts `status`, `paypalMerchantId` and `supportEmail`, none of which change for stores.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test packages/auth`
Expected: FAIL. The `product` property is not part of the create body type (type error), and the update hook accepts the product change.

- [ ] **Step 3: Implement**

In `packages/auth/src/index.ts`, change the import from `@jendal-workspace/core` to:

```ts
import { isTeamProduct, type TeamProduct, teamSlugProblem, validateStoreSlug } from "@jendal-workspace/core";
```

add an import for the settings repository:

```ts
import { createServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
```

and replace `storeFields` with:

```ts
// A store or a services team is a Better Auth team (services spec §3). Fields with input: false are set by our own
// code only; product must be settable at creation, so it is input: true, and the hooks keep it valid.
const teamFields = {
  slug: { type: "string", required: true, unique: true, input: true },
  product: { type: "string", required: false, defaultValue: "store", input: true },
  status: { type: "string", required: true, defaultValue: "draft", input: false },
  paypalMerchantId: { type: "string", required: false, unique: true, input: false },
  supportEmail: { type: "string", required: false, input: false },
} as const;
```

Replace `claimStoreSlug` with:

```ts
async function claimTeamSlug(database: Database, input: unknown, product: TeamProduct): Promise<string> {
  const result = validateStoreSlug(typeof input === "string" ? input : "");
  if (!result.ok) {
    throw new APIError("BAD_REQUEST", {
      code: result.reason === "reserved" ? "TEAM_SLUG_RESERVED" : "TEAM_SLUG_INVALID",
      message: teamSlugProblem(result.reason, product),
    });
  }
  // The unique index on team.slug still guards against a concurrent claim; stores and services teams share it.
  if (await isStoreSlugTaken(database, result.slug)) {
    throw new APIError("CONFLICT", { code: "TEAM_SLUG_TAKEN", message: teamSlugProblem("taken", product) });
  }
  return result.slug;
}
```

In the organization plugin options, change `schema` to:

```ts
        schema: { team: { additionalFields: teamFields } },
```

and replace the whole `organizationHooks` block with:

```ts
        organizationHooks: {
          beforeCreateTeam: async ({ team, user }) => {
            if (team.product !== undefined && team.product !== null && !isTeamProduct(team.product)) {
              throw new APIError("BAD_REQUEST", {
                code: "TEAM_PRODUCT_INVALID",
                message: "A team's product is 'store' or 'services'.",
              });
            }
            const product: TeamProduct = team.product === "services" ? "services" : "store";
            const slug = await claimTeamSlug(database, team.slug, product);
            // The store columns stay on every team (contract §4.2); services teams never read them.
            return {
              data: {
                slug,
                product,
                status: "draft",
                paypalMerchantId: null,
                supportEmail: product === "store" ? (user?.email ?? null) : null,
              },
            };
          },
          afterCreateTeam: async ({ team }) => {
            if (team.product === "services") await createServicesTeamSettings(database, team.id);
          },
          // Store URLs and the KV cache are keyed by slug, so slugs cannot change until W1-C adds invalidation.
          // A team's product picks its repository filters and dashboard; changing it would strand its data.
          beforeUpdateTeam: async ({ team, updates }) => {
            if (updates.slug !== undefined && updates.slug !== team.slug) {
              throw new APIError("BAD_REQUEST", {
                code: "TEAM_SLUG_IMMUTABLE",
                message: "A team address cannot be changed.",
              });
            }
            if (updates.product !== undefined && updates.product !== team.product) {
              throw new APIError("BAD_REQUEST", {
                code: "TEAM_PRODUCT_IMMUTABLE",
                message: "A team's product cannot be changed.",
              });
            }
          },
        },
```

Then update the existing tests to the renamed error codes:
- "rejects reserved and malformed slugs": `STORE_SLUG_RESERVED` → `TEAM_SLUG_RESERVED`, `STORE_SLUG_INVALID` → `TEAM_SLUG_INVALID`.
- "rejects a slug that another store already uses": `STORE_SLUG_TAKEN` → `TEAM_SLUG_TAKEN`.
- "keeps the slug fixed and allows renaming": `STORE_SLUG_IMMUTABLE` → `TEAM_SLUG_IMMUTABLE`.

Search for leftovers: `rg -n "STORE_SLUG" packages apps` must find nothing. The web forms read the error message, not the code, so no web change is needed.

- [ ] **Step 4: Run the tests**

Run: `pnpm test packages/auth && pnpm -F @jendal-workspace/auth check-types`
Expected: all pass, including the new product tests; no type errors. Then `pnpm test packages/api` — it still passes because the messages for stores are unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src
git commit -m "feat(auth): validate the team product, default it to store and create services team settings" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 7: Shared team creation helper and `store.create` update

**Files:**
- Create: `packages/api/src/testing.ts`, `packages/api/src/team-creation.ts`
- Modify: `packages/api/src/routers/store.ts`
- Test: `packages/api/src/routers/store.test.ts`

- [ ] **Step 1: Extract `makeSession` and add the failing product test**

`packages/api/src/testing.ts`:

```ts
import type { Context } from "./context";

type SessionValue = NonNullable<Context["session"]>;

// A fabricated session for callers whose procedures never touch Better Auth.
export function makeSession(userId: string): SessionValue {
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
```

In `packages/api/src/routers/store.test.ts`, delete the local `makeSession` function and the `type SessionValue` line, and import it instead:

```ts
import { makeSession } from "../testing";
```

Then, in the "store creation" describe, add:

```ts
  it("creates stores with the store product", async () => {
    const caller = await signedInCaller();

    await caller.store.create({ name: "Acme", slug: "acme" });

    const [row] = await db.select().from(team).where(eq(team.slug, "acme"));
    expect(row?.product).toBe("store");
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test packages/api`
Expected: FAIL. `store.create` does not pass `product`, and the auth package's `createTeam` type does not know it yet at the api call site — if Task 6 is committed the hook would default it anyway, so the test may already pass; either way the next step makes the product explicit. (If it already passes, treat it as a guard and continue.)

- [ ] **Step 3: Implement the helper and update the router**

`packages/api/src/team-creation.ts`:

```ts
import { hasStoreWideRole } from "@jendal-workspace/core";
import { listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";

import type { Context } from "./context";

// Store and services team creation share the rule (services spec §3): the first organization where the
// user is owner or admin, else a new organization named after the team.
export async function organizationForNewTeam(
  ctx: Context & { session: NonNullable<Context["session"]> },
  name: string,
): Promise<string> {
  const organizations = await listOrganizationsWithStores(ctx.db, ctx.session.user.id);
  const existing = organizations.find((o) => hasStoreWideRole(o.role))?.organization.id;
  if (existing) return existing;
  // The organization slug is never shown; stores and teams carry the public addresses.
  const created = await ctx.auth.api.createOrganization({
    body: { name, slug: `org-${crypto.randomUUID()}` },
    headers: ctx.headers,
  });
  if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the organization." });
  return created.id;
}

export function toTRPCError(error: unknown): unknown {
  if (!(error instanceof APIError)) return error;
  const code = error.status === "CONFLICT" ? "CONFLICT" : error.status === "FORBIDDEN" ? "FORBIDDEN" : "BAD_REQUEST";
  return new TRPCError({ code, message: error.body?.message ?? error.message, cause: error });
}
```

In `packages/api/src/routers/store.ts`:
- Delete the local `toTRPCError` function and the `APIError` import.
- Remove `listOrganizationsWithStores` and `hasStoreWideRole` from the imports if they become unused (`listMine` still uses both, so they stay).
- Add `import { organizationForNewTeam, toTRPCError } from "../team-creation";`
- In `create`, replace the organization selection block (from `const organizations = …` through the `organizationId = created.id;` lines) with:

```ts
        const organizationId = await organizationForNewTeam(ctx, input.name);
```

and change the `createTeam` call to pass the product:

```ts
        // createTeam runs the slug and product hooks; if it fails, the organization stays for the retry.
        await ctx.auth.api.createTeam({
          body: { name: input.name, organizationId, slug: slug.slug, product: "store" },
          headers: ctx.headers,
        });
```

The surrounding `try { … } catch (error) { throw toTRPCError(error); }` and the slug validation stay.

- [ ] **Step 4: Run the tests**

Run: `pnpm test packages/api && pnpm -F @jendal-workspace/api check-types`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): share team creation between products and create stores with the store product" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 8: `servicesTeam` tRPC router

**Files:**
- Create: `packages/api/src/services-team-procedure.ts`, `packages/api/src/routers/services-team.ts`
- Modify: `packages/api/src/routers/index.ts`
- Test: `packages/api/src/routers/services-team.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routers/services-team.test.ts`:

```ts
import { defaultServicesTeamSettings } from "@jendal-workspace/core";
import { createTestAuth, signUpVerified } from "@jendal-workspace/auth/testing";
import {
  addMember,
  addServicesTeamMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { team } from "@jendal-workspace/db/schema/organization";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("servicesTeam router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
    });

  async function signedInCaller(email: string) {
    const { headers } = await signUpVerified(auth, db, email);
    const session = await auth.api.getSession({ headers });
    return appRouter.createCaller({ db, session, environment: "sandbox", auth, headers });
  }

  it("rejects anonymous callers", async () => {
    await expect(callerFor(null).servicesTeam.listMine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      callerFor(null).servicesTeam.create({ name: "Acme Studio", slug: "acme-studio" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("creates a services team in the owner's organization, with default settings and no support email", async () => {
    const caller = await signedInCaller("owner@example.com");

    await expect(caller.servicesTeam.create({ name: "Acme Studio", slug: " Acme-Studio " })).resolves.toEqual({
      slug: "acme-studio",
    });

    const [row] = await db.select().from(team).where(eq(team.slug, "acme-studio"));
    expect(row).toMatchObject({ product: "services", supportEmail: null, paypalMerchantId: null });

    const mine = await caller.servicesTeam.listMine();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.servicesTeams[0]).toMatchObject({ slug: "acme-studio", name: "Acme Studio", role: "admin" });
  });

  it("shares the slug namespace with stores", async () => {
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });
    const caller = await signedInCaller("second@example.com");

    await expect(caller.servicesTeam.create({ name: "Acme", slug: "acme" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This team address is already taken.",
    });
    await expect(caller.servicesTeam.create({ name: "Acme", slug: "login" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This team address is reserved.",
    });
  });

  it("returns a team and its defaults to an admin, as not found to outsiders and to store slugs", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", name: "Acme Studio" });
    await seedStore(db, { organizationId, slug: "acme" });
    const outsider = await seedOrganization(db);

    await expect(callerFor(userId).servicesTeam.get({ teamSlug: " ACME-STUDIO " })).resolves.toEqual({
      team: studio,
      role: "admin",
      settings: { ...defaultServicesTeamSettings(studio.id), settingsSavedAt: null },
    });
    await expect(callerFor(outsider.userId).servicesTeam.get({ teamSlug: "acme-studio" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Team not found.",
    });
    await expect(callerFor(userId).servicesTeam.get({ teamSlug: "acme" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets only admins save the settings, and records when", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const managerId = await addMember(db, { organizationId, role: "member" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: managerId, role: "manager" });

    const input = {
      teamSlug: "acme-studio",
      currency: "EUR",
      teamCutBps: 2000,
      managementFeeBps: 500,
      quotingMode: "team",
      payoutMode: "automatic",
    } as const;

    await expect(callerFor(managerId).servicesTeam.updateSettings(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only an admin can change the team settings.",
    });

    const ownerCaller = callerFor(ownerId);
    const saved = await ownerCaller.servicesTeam.updateSettings(input);
    expect(saved).toMatchObject({ currency: "EUR", teamCutBps: 2000, payoutMode: "automatic" });
    expect(saved.settingsSavedAt).toEqual(expect.any(String));

    const fetched = await ownerCaller.servicesTeam.get({ teamSlug: "acme-studio" });
    expect(fetched.settings.settingsSavedAt).toBe(saved.settingsSavedAt);
  });

  it("rejects rates above 100%", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await expect(
      callerFor(userId).servicesTeam.updateSettings({
        teamSlug: "acme-studio",
        currency: "USD",
        teamCutBps: 10_001,
        managementFeeBps: 1000,
        quotingMode: "assigned",
        payoutMode: "manual",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lists members, adds an existing user by email, and keeps workspace admins marked", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const admin = callerFor(ownerId);

    await expect(admin.servicesTeam.listMembers({ teamSlug: "acme-studio" })).resolves.toEqual([
      expect.objectContaining({ userId: ownerId, role: "admin", workspaceAdmin: true }),
    ]);

    const added = await signUpVerified(auth, db, "bea@example.com", "Bea");
    await expect(
      admin.servicesTeam.addMember({ teamSlug: "acme-studio", email: " BEA@EXAMPLE.COM ", role: "freelancer" }),
    ).resolves.toEqual({ userId: added.userId, name: "Bea", email: "bea@example.com", role: "freelancer" });

    await expect(admin.servicesTeam.listMembers({ teamSlug: "acme-studio" })).resolves.toHaveLength(2);

    // A second add is a conflict, and an unknown email a not found.
    await expect(
      admin.servicesTeam.addMember({ teamSlug: "acme-studio", email: "bea@example.com", role: "manager" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "This user is already on the team." });
    await expect(
      admin.servicesTeam.addMember({ teamSlug: "acme-studio", email: "nobody@example.com", role: "manager" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No Payleor account uses this email. Ask them to sign up first.",
    });

    // Roles change for team members, not for workspace admins.
    await expect(
      admin.servicesTeam.setMemberRole({ teamSlug: "acme-studio", userId: added.userId, role: "manager" }),
    ).resolves.toEqual({ userId: added.userId, role: "manager" });
    await expect(
      admin.servicesTeam.setMemberRole({ teamSlug: "acme-studio", userId: ownerId, role: "manager" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // A freelancer cannot manage members.
    const beaCaller = callerFor(added.userId);
    await expect(beaCaller.servicesTeam.listMembers({ teamSlug: "acme-studio" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only managers and admins can see the member list.",
    });
    await expect(
      beaCaller.servicesTeam.addMember({ teamSlug: "acme-studio", email: "x@example.com", role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

Note: `addServicesTeamMember` in the imports comes from `@jendal-workspace/db/repositories/services-teams` — add a second import line:

```ts
import { addServicesTeamMember } from "@jendal-workspace/db/repositories/services-teams";
```

(The db package's exports map covers `./repositories/*`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test packages/api/src/routers/services-team.test.ts`
Expected: FAIL. The router has no `servicesTeam` key (type error on `caller.servicesTeam`), so the file does not run.

- [ ] **Step 3: Implement**

`packages/api/src/services-team-procedure.ts`:

```ts
import { findServicesTeamBySlug, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure } from "./index";

// A services team the caller has no role in is reported exactly like a missing one, so slugs do not leak.
export const servicesTeamProcedure = protectedProcedure
  .input(z.object({ teamSlug: z.string().trim().toLowerCase().min(1) }))
  .use(async ({ ctx, input, next }) => {
    const team = await findServicesTeamBySlug(ctx.db, input.teamSlug);
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    const role = await servicesTeamRoleFor(ctx.db, team.id, ctx.session.user.id);
    if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    return next({ ctx: { servicesTeam: team, servicesTeamRole: role } });
  });
```

`packages/api/src/routers/services-team.ts`:

```ts
import {
  canServicesTeam,
  hasStoreWideRole,
  MAX_RATE_BPS,
  SERVICES_TEAM_ROLES,
  type ServicesTeamRole,
  teamSlugProblem,
  validateStoreSlug,
} from "@jendal-workspace/core";
import {
  addServicesTeamMember,
  findUserByEmail,
  getServicesTeamSettings,
  listOrganizationsWithServicesTeams,
  listServicesTeamMembers,
  saveServicesTeamSettings,
  setServicesTeamMemberRole,
  workspaceRoleFor,
} from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { organizationForNewTeam, toTRPCError } from "../team-creation";

const slugInput = z.string().max(100);
const roleInput = z.enum(SERVICES_TEAM_ROLES);

// tRPC has no transformer here, so a Date would reach the browser as a string anyway; make it explicit.
function isoOrNull(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

function requireAction(
  role: ServicesTeamRole,
  action: Parameters<typeof canServicesTeam>[1],
  message: string,
): void {
  if (!canServicesTeam(role, action)) throw new TRPCError({ code: "FORBIDDEN", message });
}

export const servicesTeamRouter = router({
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const organizations = await listOrganizationsWithServicesTeams(ctx.db, ctx.session.user.id);
    return organizations.map(({ organization, role, servicesTeams }) => ({
      id: organization.id,
      name: organization.name,
      role,
      servicesTeams: servicesTeams.map(({ team, role: teamRole }) => ({ ...team, role: teamRole })),
    }));
  }),

  // Same organization rule as store.create (services spec §3).
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(2).max(80), slug: slugInput }))
    .mutation(async ({ ctx, input }) => {
      const slug = validateStoreSlug(input.slug);
      if (!slug.ok) throw new TRPCError({ code: "BAD_REQUEST", message: teamSlugProblem(slug.reason, "services") });

      try {
        const organizationId = await organizationForNewTeam(ctx, input.name);
        // createTeam runs the slug and product hooks and creates the default settings (Task 6).
        await ctx.auth.api.createTeam({
          body: { name: input.name, organizationId, slug: slug.slug, product: "services" },
          headers: ctx.headers,
        });
        return { slug: slug.slug };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  get: servicesTeamProcedure.query(async ({ ctx }) => {
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    return {
      team: ctx.servicesTeam,
      role: ctx.servicesTeamRole,
      settings: settings ? { ...settings, settingsSavedAt: isoOrNull(settings.settingsSavedAt) } : null,
    };
  }),

  updateSettings: servicesTeamProcedure
    .input(
      z.object({
        currency: z.enum(["USD", "EUR"]),
        teamCutBps: z.number().int().min(0).max(MAX_RATE_BPS),
        managementFeeBps: z.number().int().min(0).max(MAX_RATE_BPS),
        quotingMode: z.enum(["open", "assigned", "team"]),
        payoutMode: z.enum(["manual", "rules", "automatic"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", "Only an admin can change the team settings.");
      const { currency, teamCutBps, managementFeeBps, quotingMode, payoutMode } = input;
      const saved = await saveServicesTeamSettings(ctx.db, ctx.servicesTeam.id, {
        currency,
        teamCutBps,
        managementFeeBps,
        quotingMode,
        payoutMode,
      });
      return { ...saved, settingsSavedAt: isoOrNull(saved.settingsSavedAt) };
    }),

  listMembers: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "view_members", "Only managers and admins can see the member list.");
    return listServicesTeamMembers(ctx.db, ctx.servicesTeam);
  }),

  addMember: servicesTeamProcedure
    .input(z.object({ email: z.string().trim().max(320).pipe(z.email()), role: roleInput }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_members", "Only an admin can manage members.");
      const found = await findUserByEmail(ctx.db, input.email);
      if (!found) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No Payleor account uses this email. Ask them to sign up first.",
        });
      }
      const workspaceRole = await workspaceRoleFor(ctx.db, ctx.servicesTeam.organizationId, found.id);
      if (workspaceRole && hasStoreWideRole(workspaceRole)) {
        throw new TRPCError({ code: "CONFLICT", message: "Workspace owners and admins are already team admins." });
      }
      if (!workspaceRole) {
        // The user must be in the workspace before they can hold a team role (services spec §4.1).
        await ctx.auth.api.addMember({
          body: { userId: found.id, organizationId: ctx.servicesTeam.organizationId, role: "member" },
        });
      }
      const inserted = await addServicesTeamMember(ctx.db, {
        teamId: ctx.servicesTeam.id,
        userId: found.id,
        role: input.role,
      });
      if (!inserted) throw new TRPCError({ code: "CONFLICT", message: "This user is already on the team." });
      return { userId: found.id, name: found.name, email: found.email, role: input.role };
    }),

  setMemberRole: servicesTeamProcedure
    .input(z.object({ userId: z.string().min(1), role: roleInput }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_members", "Only an admin can manage members.");
      const workspaceRole = await workspaceRoleFor(ctx.db, ctx.servicesTeam.organizationId, input.userId);
      if (workspaceRole && hasStoreWideRole(workspaceRole)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A workspace owner or admin keeps the admin role in every services team.",
        });
      }
      const updated = await setServicesTeamMemberRole(ctx.db, {
        teamId: ctx.servicesTeam.id,
        userId: input.userId,
        role: input.role,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "This user is not on the team." });
      return { userId: input.userId, role: input.role };
    }),
});
```

In `packages/api/src/routers/index.ts`, add the import:

```ts
import { servicesTeamRouter } from "./services-team";
```

and mount the router between `healthCheck` and `store` — replace only the `appRouter` construction; keep the `export type AppRouter = typeof appRouter;` export that `apps/web/src/utils/trpc.ts` imports:

```ts
export const appRouter = router({
  healthCheck: publicProcedure.query(async ({ ctx }) => {
    await pingDatabase(ctx.db);
    return "OK";
  }),
  servicesTeam: servicesTeamRouter,
  store: storeRouter,
});
```

`checkSlug` stays only on the store router. The services team form calls `trpc.store.checkSlug` for availability and words the result with `teamSlugProblem(…, "services")` (Task 9).

- [ ] **Step 4: Run the tests**

Run: `pnpm test packages/api && pnpm -F @jendal-workspace/api check-types`
Expected: all pass; no type errors. Also run `pnpm test packages/auth packages/db` to catch hook or helper regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): add the servicesTeam router" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 9: Web helpers — product-aware slug status, workspace merge, settings validation, labels

**Files:**
- Create: `apps/web/src/lib/workspaces.ts`, `apps/web/src/lib/services-team-settings-form.ts`, `apps/web/src/lib/services-team-labels.ts`
- Modify: `apps/web/src/lib/slug-status.ts`
- Test: `apps/web/src/lib/slug-status.test.ts`, `apps/web/src/lib/workspaces.test.ts`, `apps/web/src/lib/services-team-settings-form.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/slug-status.test.ts`, add inside `describe("slugStatus")`:

```ts
  it("words the problems for services teams", () => {
    expect(slugStatus("acme", { status: "taken", slug: "acme" }, url, "services")).toEqual({
      tone: "problem",
      text: "This team address is already taken.",
    });
    expect(slugStatus("login", { status: "invalid", reason: "reserved" }, url, "services")).toEqual({
      tone: "problem",
      text: "This team address is reserved.",
    });
  });
```

The format message ("Use 3 to 40 lowercase letters…") is identical for both products, so no test is needed for it beyond the existing one.

`apps/web/src/lib/workspaces.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { mergeWorkspaces, type WorkspaceOrganization, type WorkspaceServicesTeam, type WorkspaceStore } from "./workspaces";

const store: WorkspaceStore = { id: "team-1", slug: "acme", name: "Acme", status: "draft" };
const servicesTeam: WorkspaceServicesTeam = { id: "team-2", slug: "acme-studio", name: "Acme Studio", role: "admin" };

describe("mergeWorkspaces", () => {
  it("keeps organizations that exist on only one side", () => {
    expect(
      mergeWorkspaces([{ id: "org-1", name: "Org One", role: "owner", canCreateStores: true, stores: [store] }], []),
    ).toEqual([
      { id: "org-1", name: "Org One", role: "owner", canCreateStores: true, stores: [store], servicesTeams: [] },
    ] satisfies WorkspaceOrganization[]);

    expect(
      mergeWorkspaces([], [{ id: "org-2", name: "Org Two", role: "owner", servicesTeams: [servicesTeam] }]),
    ).toEqual([
      { id: "org-2", name: "Org Two", role: "owner", canCreateStores: false, stores: [], servicesTeams: [servicesTeam] },
    ] satisfies WorkspaceOrganization[]);
  });

  it("merges stores and services teams for the same organization, in first-seen order", () => {
    const merged = mergeWorkspaces(
      [{ id: "org-1", name: "Org One", role: "owner", canCreateStores: true, stores: [store] }],
      [
        { id: "org-2", name: "Org Two", role: "member", servicesTeams: [] },
        { id: "org-1", name: "Org One", role: "owner", servicesTeams: [servicesTeam] },
      ],
    );

    expect(merged.map((o) => o.id)).toEqual(["org-1", "org-2"]);
    expect(merged[0]).toMatchObject({ stores: [store], servicesTeams: [servicesTeam], canCreateStores: true });
  });
});
```

`apps/web/src/lib/services-team-settings-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { rateField } from "./services-team-settings-form";

describe("rateField", () => {
  it("accepts percents and converts them to basis points", () => {
    expect(rateField("20")).toEqual({ input: "20", problem: null, bps: 2000 });
    expect(rateField("2.5")).toEqual({ input: "2.5", problem: null, bps: 250 });
    expect(rateField("2,5").bps).toBe(250);
    expect(rateField("20 %").bps).toBe(2000);
  });

  it("rejects empty input and out-of-range or over-precise values, with a message", () => {
    expect(rateField("")).toEqual({ input: "", problem: "Enter a percent, like 20 or 2.5.", bps: null });
    for (const bad of ["101", "1.234", "abc"]) {
      expect(rateField(bad).problem).toBe("Use a number from 0 to 100, with at most two decimals.");
      expect(rateField(bad).bps).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -F web exec vitest run src/lib/slug-status.test.ts src/lib/workspaces.test.ts src/lib/services-team-settings-form.test.ts`
Expected: FAIL. `slugStatus` takes no fourth parameter (the new assertions fail), and the `workspaces` and `services-team-settings-form` modules do not exist.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/slug-status.ts`, change the import to:

```ts
import { type TeamProduct, teamSlugProblem } from "@jendal-workspace/core";
```

and update the signature and the two problem branches:

```ts
// `result` must be the check for `slug`, or undefined while that check is still running.
export function slugStatus(
  slug: string,
  result: SlugCheckResult | undefined,
  teamUrl: (slug: string) => string,
  product: TeamProduct = "store",
): SlugStatus | null {
  if (!slug) return null;
  if (!result) return { tone: "pending", text: "Checking the address…" };
  switch (result.status) {
    case "available":
      return { tone: "available", text: `${teamUrl(result.slug)} is available.` };
    case "taken":
      return { tone: "problem", text: teamSlugProblem("taken", product) };
    case "invalid":
      return { tone: "problem", text: teamSlugProblem(result.reason, product) };
  }
}
```

The default keeps the existing store form untouched.

`apps/web/src/lib/workspaces.ts`:

```ts
// The two lists a workspace page needs; both are teams (services spec §3) with different products.
export interface WorkspaceStore {
  id: string;
  slug: string;
  name: string;
  status: string;
}

export interface WorkspaceServicesTeam {
  id: string;
  slug: string;
  name: string;
  role: string;
}

export interface WorkspaceOrganization {
  id: string;
  name: string;
  role: string;
  canCreateStores: boolean;
  stores: WorkspaceStore[];
  servicesTeams: WorkspaceServicesTeam[];
}

type StoreSide = Pick<WorkspaceOrganization, "id" | "name" | "role" | "canCreateStores" | "stores">;
type ServicesSide = Pick<WorkspaceOrganization, "id" | "name" | "role" | "servicesTeams">;

// The workspace home merges the store list and the services team list, one section per organization.
export function mergeWorkspaces(storeSide: StoreSide[], servicesSide: ServicesSide[]): WorkspaceOrganization[] {
  const merged = new Map<string, WorkspaceOrganization>();
  for (const org of storeSide) {
    merged.set(org.id, { ...org, servicesTeams: [] });
  }
  for (const org of servicesSide) {
    const existing = merged.get(org.id);
    if (existing) {
      existing.servicesTeams = org.servicesTeams;
    } else {
      merged.set(org.id, { ...org, canCreateStores: false, stores: [] });
    }
  }
  return [...merged.values()];
}
```

`apps/web/src/lib/services-team-settings-form.ts`:

```ts
import { percentToBps } from "@jendal-workspace/core";

export interface RateFieldValue {
  input: string;
  problem: string | null;
  bps: number | null;
}

// The settings form validates as the admin types; percentToBps accepts "," and a trailing "%".
export function rateField(input: string): RateFieldValue {
  if (!input.trim()) return { input, problem: "Enter a percent, like 20 or 2.5.", bps: null };
  const bps = percentToBps(input);
  if (bps === null) return { input, problem: "Use a number from 0 to 100, with at most two decimals.", bps: null };
  return { input, problem: null, bps };
}
```

`apps/web/src/lib/services-team-labels.ts`:

```ts
import type { PayoutMode, QuotingMode, ServicesTeamRole, TeamProduct } from "@jendal-workspace/core";

export const PRODUCT_LABELS: Record<TeamProduct, string> = {
  store: "Store",
  services: "Services team",
};

export const SERVICES_TEAM_ROLE_LABELS: Record<ServicesTeamRole, string> = {
  admin: "Admin",
  manager: "Manager",
  freelancer: "Freelancer",
};

export const SERVICES_TEAM_ROLE_DESCRIPTIONS: Record<ServicesTeamRole, string> = {
  admin: "Manages members, rates and payouts.",
  manager: "Quotes and confirms, and sees everything.",
  freelancer: "Works on their assignments.",
};

export const QUOTING_MODE_LABELS: Record<QuotingMode, string> = {
  open: "Open quotes",
  assigned: "Assigned quotes",
  team: "Team quotes",
};

export const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = {
  manual: "Manual payouts",
  rules: "Rule-based payouts",
  automatic: "Automatic payouts",
};
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F web exec vitest run src/lib/slug-status.test.ts src/lib/workspaces.test.ts src/lib/services-team-settings-form.test.ts`
Expected: all pass, including the pre-existing `slugStatus` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/slug-status.ts apps/web/src/lib/slug-status.test.ts apps/web/src/lib/workspaces.ts apps/web/src/lib/workspaces.test.ts apps/web/src/lib/services-team-settings-form.ts apps/web/src/lib/services-team-settings-form.test.ts apps/web/src/lib/services-team-labels.ts
git commit -m "feat(web): add product-aware slug status, workspace merge and services team labels" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 10: Server-side workspace list and services team lookup

**Files:**
- Modify: `apps/web/src/lib/server-api.ts`

No unit tests here (this module is integration glue over the api Worker binding); the workspace page (Task 11), the dashboard switch (Task 14) and the walkthrough (Task 17) exercise it.

- [ ] **Step 1: Add `listMyServicesTeams` and `listMyWorkspaces`**

In `apps/web/src/lib/server-api.ts`, first add `role` to the existing `myStoresSchema` organization object (`store.listMine` already returns it — `packages/api/src/routers/store.ts`); the workspace merge needs it:

```ts
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string(),
        canCreateStores: z.boolean(),
        stores: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), status: z.string() })),
      }),
```

Then add the import:

```ts
import { mergeWorkspaces, type WorkspaceOrganization } from "./workspaces";
```

and, after `listMyStores`, add:

```ts
const myServicesTeamsSchema = z.object({
  result: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string(),
        servicesTeams: z.array(
          z.object({ id: z.string(), slug: z.string(), name: z.string(), role: z.string() }),
        ),
      }),
    ),
  }),
});
export type MyServicesTeamOrganization = z.infer<typeof myServicesTeamsSchema>["result"]["data"][number];

export async function listMyServicesTeams(): Promise<MyServicesTeamOrganization[]> {
  const response = await callApiAsUser("/trpc/servicesTeam.listMine");
  if (!response.ok) throw new Error(`servicesTeam.listMine answered ${response.status}`);
  return myServicesTeamsSchema.parse(await response.json()).result.data;
}

// The workspace home shows stores and services teams together (services spec §9).
export async function listMyWorkspaces(): Promise<WorkspaceOrganization[]> {
  const [stores, servicesTeams] = await Promise.all([listMyStores(), listMyServicesTeams()]);
  return mergeWorkspaces(stores, servicesTeams);
}
```

- [ ] **Step 2: Add `findServicesTeamSlug`**

The `/{slug}` page (Task 14) must know which product a slug belongs to before it picks a dashboard. `servicesTeam.get` answers that and doubles as the membership check: it succeeds only for a services team the user belongs to. After `listMyWorkspaces`, add:

```ts
// tRPC speaks plain JSON here (no transformer), so the input is the raw JSON of the procedure input.
export async function isServicesTeamSlug(slug: string): Promise<boolean> {
  const input = encodeURIComponent(JSON.stringify({ teamSlug: slug }));
  const response = await callApiAsUser(`/trpc/servicesTeam.get?input=${input}`);
  // Unknown slugs, stores and outsiders all answer with an error; only "this is your services team" is ok.
  return response.ok;
}
```

- [ ] **Step 3: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors. (`mergeWorkspaces` accepts `MyOrganization[]` because — with the `role` field added in Step 1 — its fields are a superset of the `StoreSide` pick.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server-api.ts
git commit -m "feat(web): add the server-side workspace list and services team lookup" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 11: Workspace home lists services teams

**Files:**
- Modify: `apps/web/src/app/admin/page.tsx`, `apps/web/src/components/header.tsx`

- [ ] **Step 1: Rewrite the admin home**

Replace the body of `apps/web/src/app/admin/page.tsx` (keep the imports minus the ones noted) with:

```tsx
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getStoreUrlParts, listMyWorkspaces, requireSession } from "@/lib/server-api";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { storeUrl } from "@/lib/store-url";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", active: "Live", suspended: "Suspended" };

export default async function AdminHome() {
  await requireSession();
  const organizations = (await listMyWorkspaces()).filter(
    (o) => o.stores.length + o.servicesTeams.length > 0,
  );
  if (organizations.length === 0) redirect("/new");
  const urlParts = await getStoreUrlParts();

  return (
    <main className="container mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your workspace</h1>
        <span className="flex flex-wrap gap-2">
          {organizations.some((o) => o.canCreateStores) ? (
            <Link href="/new" className={buttonVariants({ variant: "outline" })}>
              Create your store
            </Link>
          ) : null}
          {/* servicesTeam.create guarantees a home organization for every signed-in user, so no gate here */}
          <Link href="/new/services-team" className={buttonVariants({ variant: "outline" })}>
            Create your services team
          </Link>
        </span>
      </div>
      {organizations.map((organization) => (
        <section key={organization.id} aria-labelledby={`org-${organization.id}`} className="space-y-3">
          <h2 id={`org-${organization.id}`} className="text-sm font-medium text-muted-foreground">
            {organization.name}
          </h2>
          <ul className="divide-y border">
            {organization.stores.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/${store.slug}`} className="font-medium hover:underline">
                    {store.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">
                    Store · {storeUrl(store.slug, urlParts)}
                  </p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {STATUS_LABEL[store.status] ?? store.status}
                </span>
              </li>
            ))}
            {organization.servicesTeams.map((servicesTeam) => (
              <li key={servicesTeam.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/${servicesTeam.slug}`} className="font-medium hover:underline">
                    {servicesTeam.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">Services team</p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {SERVICES_TEAM_ROLE_LABELS[servicesTeam.role as keyof typeof SERVICES_TEAM_ROLE_LABELS] ??
                    servicesTeam.role}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
```

The `role` on the merged organization and `listMyStores` are unchanged; only the query and the rendering change. If `SERVICES_TEAM_ROLE_LABELS[...]` indexing trips `noUncheckedIndexedAccess`, the `?? servicesTeam.role` fallback already covers it — keep the cast as written.

- [ ] **Step 2: Rename the header link**

In `apps/web/src/components/header.tsx`, change the links array to:

```ts
  const links = [{ to: "/", label: "Home" }] as const;
```

- [ ] **Step 3: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors. (Task 17's walkthrough verifies the rendering against the real API.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/admin/page.tsx apps/web/src/components/header.tsx
git commit -m "feat(web): list services teams on the workspace home" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 12: "Create your services team" page

**Files:**
- Create: `apps/web/src/app/admin/new/services-team/page.tsx`, `apps/web/src/app/admin/new/services-team/create-services-team-form.tsx`

- [ ] **Step 1: The page**

`apps/web/src/app/admin/new/services-team/page.tsx`:

```tsx
import { getPlatformOrigins, requireSession } from "@/lib/server-api";

import CreateServicesTeamForm from "./create-services-team-form";

export default async function NewServicesTeamPage() {
  await requireSession();
  const origins = await getPlatformOrigins();

  return (
    <main className="container mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Create your services team</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You can rename the team later. Its address cannot be changed.
      </p>
      <CreateServicesTeamForm adminOrigin={origins.admin} />
    </main>
  );
}
```

- [ ] **Step 2: The form**

`apps/web/src/app/admin/new/services-team/create-services-team-form.tsx` — the store form's twin, with three differences: the address preview is the admin URL, the wording says "team", and creation goes through `servicesTeam.create`:

```tsx
"use client";

import { suggestStoreSlug } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@jendal-workspace/ui/components/input-group";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { slugStatus } from "@/lib/slug-status";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { trpc } from "@/utils/trpc";

const TONE_CLASS = {
  pending: "text-muted-foreground",
  available: "text-emerald-700 dark:text-emerald-400",
  problem: "text-destructive",
} as const;

export default function CreateServicesTeamForm({ adminOrigin }: { adminOrigin: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  // The address follows the name until the user edits it.
  const slug = (typedSlug ?? suggestStoreSlug(name)).trim().toLowerCase();
  const debouncedSlug = useDebouncedValue(slug, 300);

  // Stores and services teams share the slug namespace, so the store check answers for both.
  const check = useQuery({
    ...trpc.store.checkSlug.queryOptions({ slug: debouncedSlug }),
    enabled: debouncedSlug.length > 0,
  });
  const create = useMutation(
    trpc.servicesTeam.create.mutationOptions({ onSuccess: (team) => router.push(`/${team.slug}`) }),
  );

  const settled = debouncedSlug === slug && !check.isFetching;
  const status = create.error
    ? { tone: "problem" as const, text: create.error.message }
    : slugStatus(slug, settled ? check.data : undefined, (s) => `${adminOrigin}/${s}`, "services");
  const canSubmit = name.trim().length >= 2 && status?.tone === "available" && !create.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) create.mutate({ name: name.trim(), slug });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
      <div className="space-y-2">
        <Label htmlFor="team-name">Team name</Label>
        <Input
          id="team-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            create.reset();
          }}
          required
          minLength={2}
          maxLength={80}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="team-slug">Team address</Label>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>{adminOrigin}/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="team-slug"
            value={typedSlug ?? suggestStoreSlug(name)}
            onChange={(e) => {
              setTypedSlug(e.target.value);
              create.reset();
            }}
            placeholder="acme-studio"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="team-slug-status"
            required
          />
        </InputGroup>
        <p id="team-slug-status" aria-live="polite" className={`min-h-5 text-sm ${status ? TONE_CLASS[status.tone] : ""}`}>
          {status?.text}
        </p>
      </div>
      <Button type="submit" disabled={!canSubmit} className="justify-self-start">
        {create.isPending ? "Creating your team…" : "Create services team"}
      </Button>
    </form>
  );
}
```

`suggestStoreSlug` stays the suggestion source: it validates against the shared reserved list, which is exactly the shared namespace rule.

- [ ] **Step 3: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors. (`trpc.servicesTeam` types flow from the Task 8 router; if `team.slug` is not on the mutation result, adjust the router's return, not the form.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/admin/new/services-team
git commit -m "feat(web): add the create services team page" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 13: Checklist, not-found and coming-soon components

**Files:**
- Modify: `apps/web/src/components/setup-checklist.tsx`
- Create: `apps/web/src/components/services-team/team-not-found.tsx`, `apps/web/src/components/services-team/coming-soon.tsx`

- [ ] **Step 1: Generalize `SetupChecklist`**

Replace `apps/web/src/components/setup-checklist.tsx` with:

```tsx
import { countDone, type SetupStep } from "@jendal-workspace/core";
import { Circle, CircleCheck } from "lucide-react";
import Link from "next/link";

// Internal hrefs navigate in-app; external ones (storefront, PayPal) open in a new tab.
function StepLink({ step }: { step: SetupStep }) {
  if (!step.href) return <span>{step.label}</span>;
  if (step.href.startsWith("/")) {
    return (
      <Link href={step.href} className="underline underline-offset-4">
        {step.label}
      </Link>
    );
  }
  return (
    <a href={step.href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
      {step.label}
    </a>
  );
}

export default function SetupChecklist({
  steps,
  title = "Set up your store",
}: {
  steps: readonly SetupStep[];
  title?: string;
}) {
  return (
    <section aria-labelledby="setup-heading" className="border p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="setup-heading" className="font-medium">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {countDone(steps)} of {steps.length} done
        </p>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-sm">
            {step.done ? (
              <CircleCheck aria-hidden className="size-4 text-emerald-600" />
            ) : (
              <Circle aria-hidden className="size-4 text-muted-foreground" />
            )}
            <span className="sr-only">{step.done ? "Done:" : "To do:"}</span>
            <StepLink step={step} />
          </li>
        ))}
      </ol>
    </section>
  );
}
```

The store dashboard keeps working unchanged (default title, external storefront link).

- [ ] **Step 2: The services team components**

`apps/web/src/components/services-team/team-not-found.tsx`:

```tsx
import Link from "next/link";

export default function TeamNotFound() {
  return (
    <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Team not found</h1>
      <p className="text-sm text-muted-foreground">
        This address is not one of your stores or services teams.
      </p>
      <Link href="/" className="underline">
        Back to your workspace
      </Link>
    </main>
  );
}
```

`apps/web/src/components/services-team/coming-soon.tsx`:

```tsx
// Placeholder for the services team surfaces later plans deliver (S2 Discord, S3 payouts).
export default function ComingSoon({ title }: { title: string }) {
  return (
    <section aria-label={title} className="border border-dashed p-4">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Coming soon.</p>
    </section>
  );
}
```

- [ ] **Step 3: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors; the existing store dashboard still compiles against the new prop signature.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/setup-checklist.tsx apps/web/src/components/services-team
git commit -m "feat(web): generalize the setup checklist and add services team placeholders" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 14: The slug route picks the dashboard by product

**Files:**
- Modify: `apps/web/src/app/admin/[storeSlug]/page.tsx`, `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`
- Create: `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx`

- [ ] **Step 1: Switch in the page**

Replace `apps/web/src/app/admin/[storeSlug]/page.tsx` with:

```tsx
import { getStoreUrlParts, isServicesTeamSlug, requireSession } from "@/lib/server-api";

import ServicesTeamDashboard from "./services-team-dashboard";
import StoreDashboard from "./store-dashboard";

// Store and services team slugs share one namespace (services spec §9); the product picks the dashboard.
export default async function TeamDashboardPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;

  if (await isServicesTeamSlug(storeSlug)) {
    return <ServicesTeamDashboard teamSlug={storeSlug} />;
  }

  const urlParts = await getStoreUrlParts();
  return <StoreDashboard storeSlug={storeSlug} urlParts={urlParts} />;
}
```

- [ ] **Step 2: The services team dashboard**

`apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx`:

```tsx
"use client";

import { servicesTeamSetupSteps } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import ComingSoon from "@/components/services-team/coming-soon";
import TeamNotFound from "@/components/services-team/team-not-found";
import SetupChecklist from "@/components/setup-checklist";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";

export default function ServicesTeamDashboard({ teamSlug }: { teamSlug: string }) {
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false });

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;
  const steps = servicesTeamSetupSteps(
    { paypalMerchantId: team.paypalMerchantId, settingsSaved: settings?.settingsSavedAt != null },
    { settings: `/${team.slug}/settings` },
  );

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href="/" className="text-sm text-muted-foreground">
          Your workspace
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
      </div>
      <nav aria-label="Services team" className="flex gap-4 text-sm">
        <Link href={`/${team.slug}/settings`} className="underline underline-offset-4">
          Settings
        </Link>
        <Link href={`/${team.slug}/members`} className="underline underline-offset-4">
          Members
        </Link>
      </nav>
      <SetupChecklist steps={steps} title="Set up your team" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Your role</dt>
        <dd>{SERVICES_TEAM_ROLE_LABELS[role] ?? role}</dd>
        <dt className="text-muted-foreground">PayPal</dt>
        <dd>{team.paypalMerchantId ?? "Not connected"}</dd>
      </dl>
      <ComingSoon title="Projects" />
      <ComingSoon title="Payouts" />
    </main>
  );
}
```

- [ ] **Step 3: Shared not-found copy for the store dashboard**

In `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`, the error branch currently says "Store not found / Back to your stores". Replace that `return (...)` with:

```tsx
  if (store.isError) return <TeamNotFound />;
```

add the import `import TeamNotFound from "@/components/services-team/team-not-found";`, and keep the `Link` import — the "All stores" breadcrumb still uses it. Rationale: once slugs are shared, a failed `store.get` can mean "this slug is a services team you are not part of" as much as "no such store".

- [ ] **Step 4: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/admin/[storeSlug]"
git commit -m "feat(web): pick the dashboard by team product" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 15: Services team settings page

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/settings/page.tsx`, `apps/web/src/app/admin/[storeSlug]/settings/services-team-settings.tsx`

- [ ] **Step 1: The page**

`apps/web/src/app/admin/[storeSlug]/settings/page.tsx`:

```tsx
import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import ServicesTeamSettings from "./services-team-settings";

// Only services teams have settings; a store slug here is a wrong turn.
export default async function ServicesTeamSettingsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <ServicesTeamSettings teamSlug={storeSlug} />;
}
```

- [ ] **Step 2: The settings form**

`apps/web/src/app/admin/[storeSlug]/settings/services-team-settings.tsx`. Percent fields validate as the admin types (`rateField` from Task 9); invalid fields get `aria-invalid` and a described error; the mutation refreshes the dashboard query:

```tsx
"use client";

import { bpsToPercent, CURRENCIES, PAYOUT_MODES, QUOTING_MODES } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { PAYOUT_MODE_LABELS, QUOTING_MODE_LABELS } from "@/lib/services-team-labels";
import { rateField } from "@/lib/services-team-settings-form";
import { trpc } from "@/utils/trpc";

const SELECT_CLASS = "h-9 w-full rounded-md border bg-transparent px-3 text-sm";

function RateInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const field = rateField(value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-invalid={field.problem !== null}
        aria-describedby={`${id}-problem`}
        required
      />
      <p id={`${id}-problem`} className="min-h-5 text-sm text-destructive">
        {field.problem}
      </p>
    </div>
  );
}

export default function ServicesTeamSettings({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false });

  const [currency, setCurrency] = useState<string | null>(null);
  const [teamCut, setTeamCut] = useState<string | null>(null);
  const [managementFee, setManagementFee] = useState<string | null>(null);
  const [quotingMode, setQuotingMode] = useState<string | null>(null);
  const [payoutMode, setPayoutMode] = useState<string | null>(null);

  const save = useMutation(
    trpc.servicesTeam.updateSettings.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    }),
  );

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;
  const current = settings ?? undefined;
  const values = {
    currency: currency ?? current?.currency ?? "USD",
    teamCut: teamCut ?? (current ? bpsToPercent(current.teamCutBps) : "15"),
    managementFee: managementFee ?? (current ? bpsToPercent(current.managementFeeBps) : "10"),
    quotingMode: quotingMode ?? current?.quotingMode ?? "assigned",
    payoutMode: payoutMode ?? current?.payoutMode ?? "manual",
  };

  const teamCutField = rateField(values.teamCut);
  const managementFeeField = rateField(values.managementFee);
  const canSave =
    role === "admin" && teamCutField.bps !== null && managementFeeField.bps !== null && !save.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || teamCutField.bps === null || managementFeeField.bps === null) return;
    save.mutate({
      teamSlug,
      currency: values.currency as "USD" | "EUR",
      teamCutBps: teamCutField.bps,
      managementFeeBps: managementFeeField.bps,
      quotingMode: values.quotingMode as "open" | "assigned" | "team",
      payoutMode: values.payoutMode as "manual" | "rules" | "automatic",
    });
  }

  return (
    <main className="container mx-auto max-w-lg px-4 py-10">
      <Link href={`/${team.slug}`} className="text-sm text-muted-foreground">
        {team.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Team settings</h1>
      {role !== "admin" ? (
        <p className="mt-2 text-sm text-muted-foreground">Only an admin can change the team settings.</p>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <select
            id="currency"
            className={SELECT_CLASS}
            value={values.currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <RateInput id="team-cut" label="Team cut (%)" value={values.teamCut} onChange={setTeamCut} />
        <RateInput
          id="management-fee"
          label="Management fee (%)"
          value={values.managementFee}
          onChange={setManagementFee}
        />
        <div className="space-y-2">
          <Label htmlFor="quoting-mode">Quoting</Label>
          <select
            id="quoting-mode"
            className={SELECT_CLASS}
            value={values.quotingMode}
            onChange={(e) => setQuotingMode(e.target.value)}
          >
            {QUOTING_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {QUOTING_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="payout-mode">Payouts</Label>
          <select
            id="payout-mode"
            className={SELECT_CLASS}
            value={values.payoutMode}
            onChange={(e) => setPayoutMode(e.target.value)}
          >
            {PAYOUT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PAYOUT_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
        {save.isSuccess ? <p className="text-sm text-emerald-700 dark:text-emerald-400">Settings saved.</p> : null}
        <Button type="submit" disabled={!canSave} className="justify-self-start">
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </form>
    </main>
  );
}
```

Type notes: `trpc.servicesTeam.updateSettings` input types make the `as` casts above redundant — remove any cast the compiler flags as unnecessary rather than keeping all four.

- [ ] **Step 3: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/admin/[storeSlug]/settings"
git commit -m "feat(web): add the services team settings page" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 16: Services team members page

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/members/page.tsx`, `apps/web/src/app/admin/[storeSlug]/members/services-team-members.tsx`

- [ ] **Step 1: The page**

`apps/web/src/app/admin/[storeSlug]/members/page.tsx`:

```tsx
import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import ServicesTeamMembers from "./services-team-members";

export default async function ServicesTeamMembersPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <ServicesTeamMembers teamSlug={storeSlug} />;
}
```

- [ ] **Step 2: The members view**

`apps/web/src/app/admin/[storeSlug]/members/services-team-members.tsx`:

```tsx
"use client";

import { SERVICES_TEAM_ROLES } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";

const SELECT_CLASS = "h-9 rounded-md border bg-transparent px-2 text-sm";

export default function ServicesTeamMembers({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false });
  const members = useQuery({ ...trpc.servicesTeam.listMembers.queryOptions({ teamSlug }), retry: false });

  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<string>("freelancer");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.listMembers.queryKey({ teamSlug }) });

  const add = useMutation(
    trpc.servicesTeam.addMember.mutationOptions({
      onSuccess: () => {
        setEmail("");
        void invalidate();
      },
    }),
  );
  const setRole = useMutation(trpc.servicesTeam.setMemberRole.mutationOptions({ onSuccess: invalidate }));

  if (team.isPending) return <Loader />;
  if (team.isError) return <TeamNotFound />;

  const isAdmin = team.data.role === "admin";
  // Managers see the list; only admins change it. Freelancers get a FORBIDDEN from listMembers.
  const listForbidden = members.isError;

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim()) add.mutate({ teamSlug, email: email.trim(), role: newRole as "admin" | "manager" | "freelancer" });
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-10">
      <Link href={`/${team.data.team.slug}`} className="text-sm text-muted-foreground">
        {team.data.team.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Members</h1>

      {listForbidden ? (
        <p className="mt-6 text-sm text-muted-foreground">Only managers and admins can see the member list.</p>
      ) : (
        <>
          <ul className="mt-6 divide-y border">
            {(members.data ?? []).map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                </div>
                {member.workspaceAdmin ? (
                  <span className="shrink-0 text-sm text-muted-foreground" title="Set by the workspace">
                    Admin · workspace
                  </span>
                ) : isAdmin ? (
                  <select
                    aria-label={`Role for ${member.name}`}
                    className={SELECT_CLASS}
                    value={member.role}
                    disabled={setRole.isPending}
                    onChange={(e) =>
                      setRole.mutate({
                        teamSlug,
                        userId: member.userId,
                        role: e.target.value as "admin" | "manager" | "freelancer",
                      })
                    }
                  >
                    {SERVICES_TEAM_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {SERVICES_TEAM_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {SERVICES_TEAM_ROLE_LABELS[member.role] ?? member.role}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {isAdmin ? (
            <form onSubmit={handleAdd} className="mt-8 grid gap-4">
              <h2 className="font-medium">Add a member</h2>
              <p className="text-sm text-muted-foreground">
                They need a Payleor account already; ask them to sign up first.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-60 grow space-y-2">
                  <Label htmlFor="member-email">Email</Label>
                  <Input
                    id="member-email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      add.reset();
                    }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-role">Role</Label>
                  <select
                    id="member-role"
                    className={SELECT_CLASS}
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                  >
                    {SERVICES_TEAM_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {SERVICES_TEAM_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={!email.trim() || add.isPending}>
                  {add.isPending ? "Adding…" : "Add member"}
                </Button>
              </div>
              {add.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {add.error.message}
                </p>
              ) : null}
            </form>
          ) : null}
        </>
      )}
    </main>
  );
}
```

Type notes: `member.role` is `ServicesTeamRole` from the router types, so the `as` casts on mutation inputs should be unnecessary — drop any the compiler flags. The `title` attribute on the workspace badge is a hint only; the text "Admin · workspace" carries the meaning.

- [ ] **Step 3: Type check**

Run: `pnpm -F web check-types`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/admin/[storeSlug]/members"
git commit -m "feat(web): add the services team members page" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---
## Task 17: Rebase, regenerate the migration if needed, full checks, walkthrough, merge

**Files:** none (branch hygiene and verification)

- [ ] **Step 1: Rebase onto main**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/s1
git rebase main
```

Expected: a clean rebase. `main` has not moved since Task 0 created the branch (Part A merged before Part B started), so this is a fast-forward of the base with no conflicts. If it does conflict, another workstream landed — stop and report instead of resolving blind.

- [ ] **Step 2: Regenerate the migration if main gained one**

Execution doc §1.5. Check whether `main` gained migrations since the branch started:

```bash
git diff --stat main...HEAD -- packages/db/src/migrations
git log main --oneline -- packages/db/src/migrations | head -5
```

Compare with the migrations that existed at the merge base (`git merge-base main HEAD`). If `main` gained none (expected), skip to Step 3. Otherwise:

1. Delete the branch's migration folder: `rm -r packages/db/src/migrations/<timestamp>_s1_services_teams` (confirm the folder name with `ls packages/db/src/migrations` first; it is the folder Task 4 generated).
2. Regenerate: `pnpm db:generate` — answer the prompt with the name `s1-services-teams` if asked. Read the SQL: it must add `team.product` (default `'store'`), `services_team_member`, `services_team_settings`, and nothing else (no drops, no unrelated alters).
3. Rebuild the migration commit: `git add packages/db/src/migrations packages/db/src/schema`, then `git commit --fixup <sha>` where `<sha>` is the Task 4 commit `feat(db): add team.product, services_team_member and services_team_settings` (find it with `git log --oneline main..HEAD`), then `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main`.

- [ ] **Step 3: Full checks**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm check-types
```

Expected: everything passes, including the pre-existing web, api, db, auth and core suites.

- [ ] **Step 4: Apply the migration to the dev database**

```bash
pnpm db:migrate:dev
```

Expected: the S1 migration applies to the local Postgres (`jendal-pg` container). Verify with `pnpm -F @jendal-workspace/db exec drizzle-kit` studio or a quick query: `team.product` exists and every existing team reads `store`.

- [ ] **Step 5: Local walkthrough**

Run `pnpm dev`, sign in at the admin host, and walk the new surface:

1. Workspace home shows the "Create your store" and "Create your services team" links.
2. Create a services team "Acme Studio" (slug `acme-studio`); land on `/acme-studio`, which shows the services team dashboard (checklist "Set up your team", Settings and Members links, the coming-soon sections).
3. The workspace home now lists the team with the "Services team" label and the Admin role.
4. `/acme-studio/settings`: change the team cut to `12.5`, save; the checklist on the dashboard now shows "Set your rates" as done.
5. `/acme-studio/members`: the signed-in user is listed as "Admin · workspace"; add a second account (sign up in another browser profile first) as a freelancer; change the role to manager.
6. The existing store from Part A still opens at `/<store-slug>` with the store dashboard, and creating a store with slug `acme-studio` is refused with "This store address is already taken."

- [ ] **Step 6: Merge into main**

In the main worktree (never in the S1 worktree):

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git merge --no-ff s1-services-teams -m "Merge branch 's1-services-teams': services teams foundation (S1)" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

Expected: a merge commit on `main`; `git log --oneline -5` shows it on top of the W1-D merge from Task A4. Do not push (no remote). The S1 worktree stays for the next workstream to build on.

---
## Decisions made while planning

| Decision | Choice | Why |
| --- | --- | --- |
| Where `product` lives | Better Auth team `additionalFields` with `input: true, required: false, defaultValue: "store"`, guarded by the team hooks | `createTeam` must accept it; `toZodSchema` turns `required: false` into an optional field, and the hooks reject anything but `store`/`services` and later changes |
| Slug errors | Rename `STORE_SLUG_*` codes to `TEAM_SLUG_*`, worded per product by `teamSlugProblem` | The codes were only referenced inside the auth package's own tests; messages reach the forms unchanged for stores |
| Shared namespace | One `team.slug` unique index serves both products; the services form reuses `store.checkSlug` | Contract §4.2: store and team slugs share one namespace; the check's messages are re-worded at the call site |
| Store data isolation | The store repository filters every query on `product = 'store'`; `isStoreSlugTaken` deliberately does not | Services teams must never resolve as storefronts, but their slugs must block store creation |
| Settings storage | `services_team_settings` row created by `afterCreateTeam`, updated by upsert | Guarantees a row for every services team without a migration backfill |
| Membership | Workspace owners/admins count as services team admins (`hasStoreWideRole`); `services_team_member` holds the rest | Contract §4.2 and spec §4.1 |
| `checkSlug` placement | Stays on the store router only | Both forms share it; adding a `servicesTeam.checkSlug` alias would duplicate a public procedure for wording only |
| Router errors for outsiders | `servicesTeamProcedure` answers NOT_FOUND for missing teams and non-members alike | Slugs must not leak which teams exist |
| Web routes | `/new/services-team`, `/{slug}` (product switch), `/{slug}/settings`, `/{slug}/members` | Contract §4.2 and spec §9; `new` and `settings` are reserved slugs so no clash is possible |
| Product detection on `/{slug}` | Server-side `servicesTeam.get` probe (`isServicesTeamSlug`) before rendering | It answers product and membership in one call; errors fall through to the store dashboard, which shows the shared not-found panel |
| Setup checklist links | `SetupChecklist` gained a `title` prop and renders `/…` hrefs with next/link; unavailable later steps carry no href | The services checklist mixes internal links (settings) with steps whose target later plans deliver |
| Landing copy gate | Task A1 Step 8 stops for user approval of the landing copy before committing | The copy introduces the payouts product publicly; prices for it stay "coming soon" until decided |
| Migration timing | `db:migrate:dev` runs once, in Task 17 after rebase and possible regeneration | Execution doc §1.5: one migration chain on `main`; the shared dev database only takes the final shape |
| Scope guard | Terms/Privacy pages still cover commerce only; extending them to payouts is not in S1 | Spec §9 asks for both eventually, but the contract assigns S1 only the foundation; flagged as an open question |
| Create-link gating | "Create your store" stays gated on `canCreateStores`; "Create your services team" renders unconditionally | `servicesTeam.create` has no such gate: `organizationForNewTeam` guarantees a home organization for every signed-in user (first owned/admin org, else a new one), so hiding the link would only strand users the API would happily serve |

## Execution notes (controller)

| Date | Change | Why |
|---|---|---|
| 2026-10-06 | A2 committed `417042c`, A1 committed `f041555` (copy approved by the user). A3's full check passed (26 files, 225 tests; 9/9 type checks), then A4 merged W1-D into `main` as `a8e5260` **before** A3's walkthrough, Aiven migration and deploy | The Cloudflare login for Alchemy is expired, so the dev stack cannot run. Merging unblocked S1 Part B, S3 and S5. A3 Steps 1–4 run later from `main` once the login is renewed; fixes found there go on their own branch |
| 2026-10-06 | Env names follow the user's `.env`: `DISCORD_APP_ID`, `PAYPAL_PARTNER_ID`, `PAYPAL_ATTRIBUTION_ID` | The values already exist under those names; plans adapt instead of renaming the user's secrets |
