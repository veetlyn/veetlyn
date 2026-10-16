# R3a: Seller Setup and the Service Catalog

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seller sets up as "Just me" or "A team" and lists what they sell. Solo sellers get their defaults (team cut 100%, management fee 0, the Solo plan's fee, no assignment before quoting, no Members or payout settings); every services team gets a bio, a support email, member titles, and a service catalog (optional departments, offerings with a price range, usual days and up to five intake questions) managed in the admin. Projects record which service they are for.

**Architecture:** `db` gains three settings columns, a member title, two catalog tables and two project columns. `core` gains the solo defaults, catalog validation and the solo rules in `quoteAuthor`, `sellerPlanFor` and the setup checklist. `api` gains a `servicesCatalog` router, three new `servicesTeam` procedures, and the solo paths in create/settings/quoting/payments. `web` gains the "Just me / A team" question, the catalog admin pages, and the solo-aware settings, members and dashboard.

**Tech Stack:** TypeScript, Drizzle ORM 1.0 rc (Postgres), tRPC 11, Zod 4, TanStack Query 5, vinext (the Next.js API on Vite), Vitest 5.

**Design:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §3 (sellers), §4.1 (catalog), §9 (data model), §11 run 3, §11.1 (solo quoting, pricing copy). Pricing: [`../2026-10-07-seller-pricing-proposal.md`](../../../platform/2026-10-07-seller-pricing-proposal.md) §1 (Solo $9/mo, 2% fee).

**Decisions (2026-10-08, from Mouhamed):**
- **Run 3 is split.** This plan is 3a (setup and catalog, all of it in the admin). Run 3b follows with the seller page at `{slug}.payleor.app`, the publish action, draft visibility and the request form with its emails and limits.
- **Publishing lands in 3b, for stores and services teams alike**: nothing sets `team.status` to `active` today, so drafts become member-only everywhere there. Not in this plan.
- **The seller page footer** (3b) shows the seller's terms and privacy plus Payleor's legal pages, so services teams get a support email now: the create hook sets `team.support_email` from the creator's email for services teams too.
- **Emails stay on Resend** in this run (it sends none). The switch to Cloudflare Email Service is a backlog row for the notifications run.
- **Solo means one person.** `services_team_settings.solo` drives: the defaults (cut 100%, management fee 0), the Solo plan (2% platform fee instead of Team's 1%), quoting without an assignment step, hiding Members and the cut/fee/quoting/payout settings, and a shorter setup checklist. A solo seller can switch to a team; the cut then goes back to 15% and the fee to 10% if they are still at the solo defaults. The switch is one-way here (a team that has members cannot become solo).
- **`store_enabled` is added now** (design §9) but gets no UI: the store section of the seller page and its toggle come with run 4.
- **Catalog writes are admin-only** (`manage_settings`); reads need `view_team`. Departments are optional and one level deep. Names are unique per team, case-insensitively.
- **Projects record `offering_id` and `source`** (`admin` now, `web` in 3b). The admin's New project form gains an optional service picker.
- **Solo quotes do not set `assigned_freelancer_id`.** The quote's `freelancer_id` is the solo seller; delivery and completion already work for staff, and setting the assignment silently would skip the `project.assigned` event.

**Out of scope:** the seller page, publishing and draft visibility, the request form and its limits, all emails, the store toggle UI, digital products, payouts, the intake agent, billing (run 8).

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/r3a-seller-setup`, created in Task 0. Tests needing Postgres use `jendal-pg` through `.env.test.local`. The full suite takes about 5 minutes; run targeted tests per task. Every commit ends with the trailer `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`.

## Facts this plan relies on (checked at `46cb788`)

1. **Services teams.** `team` (`packages/db/src/schema/organization.ts:58-79`) has `product`, `status`, `paypalMerchantId`, `supportEmail`; the comment at `:56-57` says status and supportEmail only apply to stores (update it). `services_team_member` and `services_team_settings` are in `packages/db/src/schema/services-teams.ts`; settings default to cut 1500, fee 1000, quoting `assigned`, payout `manual`. `defaultServicesTeamSettings` (`packages/core/src/services-teams/types.ts:47-58`) must match the column defaults.
2. **Creation.** `servicesTeam.create` (`packages/api/src/routers/services-team.ts:56-73`) validates the slug, picks an organization (`organizationForNewTeam`), calls `ctx.auth.api.createTeam({ body: { name, organizationId, slug, product: "services" } })` and returns `{ slug }`. The hook `beforeCreateTeam` (`packages/auth/src/index.ts:156-176`) claims the slug and sets `status: "draft"` and `supportEmail` **only for stores**; `afterCreateTeam` (`:177-179`) calls `createServicesTeamSettings` (`packages/db/src/repositories/services-teams.ts:55`, `onConflictDoNothing`). The create form (`apps/web/src/app/admin/new/services-team/create-services-team-form.tsx`) asks for a name and a slug only.
3. **Roles.** Workspace owners and admins are team admins without a `services_team_member` row (`effectiveServicesTeamRole`, `packages/core/src/services-teams/permissions.ts:52-58`); `servicesTeamProcedure` (`packages/api/src/services-team-procedure.ts`) resolves the team by slug and the caller's role. `canServicesTeam(role, action)` gates actions; `manage_settings` and `manage_members` are admin-only.
4. **Quoting.** `quoteAuthor` (`packages/core/src/projects/permissions.ts:22-48`) refuses `not_assigned` in `assigned` mode when nothing is assigned, which is every fresh project: that is the solo blocker (§11.1). `addQuote` (`packages/api/src/use-cases/projects.ts:179-232`) reads the settings, calls `quoteAuthor`, then inserts the quote with `freelancerId: author.freelancerId` (a `user.id`, not a member row) and `authorId`.
5. **Completion already handles a 100% cut.** `completionTransfer` (`packages/core/src/ledger/postings.ts:59-80`) moves the cut to `team_revenue` and the rest to `owed:{freelancer}:available`; with cut 10000 the freelancer move is zero and dropped (`packages/core/src/projects/completion.test.ts:39-45`). A solo seller therefore owes no earnings and needs no payout.
6. **Platform fee.** `packages/api/src/use-cases/payments.ts:406` computes `platformFeeMinor(row.amountMinor, sellerPlanFor({ id: row.teamId }).feeBps)`; `requireSeller` (`:308-314`) returns `{ merchantId, name }` from `findTeamById`. `sellerPlanFor` (`packages/core/src/billing/seller-plans.ts:123-127`) returns Team for everyone and its comment says solo sellers move to Solo "once the 'Just me' setting exists". Solo is 200 bps, Team 100 bps.
7. **Catalog shape to copy.** `packages/core/src/catalog/product.ts` validates a draft into `ProductProblem[] = { field, message }[]` and the browser runs the same rules as the API. `apps/web/src/lib/money.ts` has `formatMinor` and `parsePriceInput` (string-split parsing, major units). The store's product list page (`apps/web/src/app/admin/[storeSlug]/products/`) shows the page/list split: a server `page.tsx` that calls `requireSession()` and guards with `isServicesTeamSlug` for services teams (see `members/page.tsx`), plus a `"use client"` list component using `trpc.*.queryOptions`.
8. **Duplicate names.** The repo pre-checks and keeps the unique index as the concurrency guard (`claimTeamSlug`, `packages/auth/src/index.ts:56-69`); Drizzle wraps Postgres errors with `cause.code === "23505"` (`packages/db/src/repositories/catalog.test.ts:122-126`).
9. **Checklist.** `servicesTeamSetupSteps(state, links)` (`packages/core/src/services-teams/setup-steps.ts`) renders in `services-team-dashboard.tsx:22-30`; `add-payout-credentials` is hardcoded `done: false` (run 5). A step without a link renders as plain text.
10. **Migrations.** `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name <name>` writes `packages/db/src/migrations/<timestamp>_<name>/`; `pnpm db:migrate:dev` applies them to the shared dev database; the test database is rebuilt from all migrations in `packages/db/src/testing/global-setup.ts`, and `truncateAll` (`packages/db/src/testing/db.ts:15-21`) must list every table.
11. **Tests.** Router tests build a caller by hand with `{ db, session, environment: "sandbox", auth, headers, catalog: createTestCatalogServices(), files: createFakeFileStore() }` (`packages/api/src/routers/services-team.test.ts:26-49`); seeds come from `packages/db/src/testing/db.ts` (`seedOrganization`, `seedServicesTeam`, `seedServicesTeamMember`, `addServicesTeamMember`, `seedProject`). Run tests with `pnpm test <path filters>` from the worktree root.
12. **Landing copy.** The only PayPal-fee footnote is `apps/web/src/app/(site)/page.tsx:205`: "PayPal's processing fees apply and are charged by PayPal."

---

### Task 0: Worktree (controller)

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git status --short   # must be empty
git worktree add -b r3a-seller-setup ../r3a-seller-setup main
cp .env.test.local ../r3a-seller-setup/.env.test.local
cd ../r3a-seller-setup && pnpm install && pnpm check-types
```

---

### Task 1: Schema, migration, and the solo defaults in core

**Files:**
- Modify: `packages/db/src/schema/services-teams.ts`, `packages/db/src/schema/projects.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/organization.ts:56-57` (comment)
- Create: `packages/db/src/schema/services-catalog.ts`
- Modify: `packages/core/src/services-teams/types.ts`, `packages/core/src/services-teams/types.test.ts`, `packages/core/src/projects/state-machine.ts` (project sources)
- Modify: `packages/db/src/testing/db.ts` (`truncateAll`, `seedServicesTeam`, a new `seedServicesOffering`)
- Test: `packages/core/src/services-teams/types.test.ts`

- [ ] **Step 1: Failing tests** in `packages/core/src/services-teams/types.test.ts` (extend the existing describe):

```ts
it("defaults a team to a 15% cut and a 10% management fee, not solo, no bio", () => {
  expect(defaultServicesTeamSettings("t1")).toEqual({
    teamId: "t1",
    solo: false,
    storeEnabled: false,
    bio: "",
    currency: "USD",
    teamCutBps: 1_500,
    managementFeeBps: 1_000,
    quotingMode: "assigned",
    payoutMode: "manual",
    settingsSavedAt: null,
    discordGuildId: null,
  });
});

it("defaults a solo seller to the whole price (sellers design §3.1)", () => {
  expect(soloServicesTeamSettings("t1")).toEqual({
    ...defaultServicesTeamSettings("t1"),
    solo: true,
    teamCutBps: 10_000,
    managementFeeBps: 0,
  });
});

it("keeps a bio under 280 characters", () => {
  expect(bioProblem("  We design logos.  ")).toBeNull();
  expect(bioProblem("x".repeat(280))).toBeNull();
  expect(bioProblem("x".repeat(281))).toBe("Keep your bio under 280 characters.");
});
```

- [ ] **Step 2: Run** `pnpm test packages/core/src/services-teams/types.test.ts`. Expected: FAIL (the fields and functions do not exist).

- [ ] **Step 3: Core.** In `packages/core/src/services-teams/types.ts`:

```ts
export const MAX_BIO_CHARS = 280;
```

  add to `ServicesTeamSettings`, above `currency`:

```ts
  // Sellers design §3.1: a solo seller is a team of one; its owner does the work and keeps the whole price.
  solo: boolean;
  // Sellers design §3.2: the store section of the seller page. Run 4 fills it; the column exists now.
  storeEnabled: boolean;
  // Sellers design §3.2: up to MAX_BIO_CHARS characters, shown on the seller page.
  bio: string;
```

  add `solo: false, storeEnabled: false, bio: ""` to `defaultServicesTeamSettings`, and after it:

```ts
// Sellers design §3.1: a solo seller keeps the whole price, so completion owes no earnings and no payout runs.
export const SOLO_TEAM_CUT_BPS = 10_000;
export const SOLO_MANAGEMENT_FEE_BPS = 0;

export function soloServicesTeamSettings(teamId: string): ServicesTeamSettings {
  return {
    ...defaultServicesTeamSettings(teamId),
    solo: true,
    teamCutBps: SOLO_TEAM_CUT_BPS,
    managementFeeBps: SOLO_MANAGEMENT_FEE_BPS,
  };
}

export function bioProblem(bio: string): string | null {
  return bio.trim().length > MAX_BIO_CHARS ? `Keep your bio under ${MAX_BIO_CHARS} characters.` : null;
}
```

  Leave `ServicesTeamSettingsInput` as it is (the rates, currency and modes); bio has its own procedure.

  In `packages/core/src/projects/state-machine.ts`, next to `PROJECT_STATUSES`:

```ts
// Where a project came from: the admin, or a request from the seller page (sellers design §4.2, run 3b).
export const PROJECT_SOURCES = ["admin", "web"] as const;
export type ProjectSource = (typeof PROJECT_SOURCES)[number];
```

- [ ] **Step 4: Run** the test again. Expected: PASS.

- [ ] **Step 5: Schema.** `packages/db/src/schema/services-teams.ts` — import `boolean` and `check` from `drizzle-orm/pg-core` and `sql` from `drizzle-orm`; add to `servicesTeamMember` after `role`:

```ts
    // Sellers design §4.1: a free-text label ("Brand designer") shown next to the member's name.
    title: text("title"),
```

  and in `servicesTeamSettings` after `teamId`, plus a check as the table's third argument:

```ts
  // Sellers design §3.1: a team of one; its cut is 100% and its management fee 0.
  solo: boolean("solo").default(false).notNull(),
  // Sellers design §3.2: the store section of the seller page (run 4 fills it).
  storeEnabled: boolean("store_enabled").default(false).notNull(),
  // Sellers design §3.2: shown on the seller page; MAX_BIO_CHARS in core.
  bio: text("bio").default("").notNull(),
```

```ts
  (table) => [check("services_team_settings_bio_check", sql`char_length(bio) <= 280`)],
```

  Create `packages/db/src/schema/services-catalog.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { team } from "./organization";

// Money columns are bigint minor units read as JS numbers; MAX_AMOUNT_MINOR keeps them exact.
const minor = (name: string) => bigint(name, { mode: "number" });

// Sellers design §4.1: one level of grouping, optional, so a solo seller usually has none.
export const servicesDepartment = pgTable(
  "services_department",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("services_department_teamId_idx").on(table.teamId),
    uniqueIndex("services_department_team_name_idx").on(table.teamId, sql`lower(name)`),
  ],
);

// Sellers design §4.1: what the team sells. The price range and the usual days are what the seller page
// shows; the intake questions are what the request form asks (run 3b).
export const servicesOffering = pgTable(
  "services_offering",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    // Deleting a department leaves its offerings ungrouped rather than deleting them.
    departmentId: text("department_id").references(() => servicesDepartment.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceMinMinor: minor("price_min_minor").notNull(),
    priceMaxMinor: minor("price_max_minor").notNull(),
    daysMin: integer("days_min").notNull(),
    daysMax: integer("days_max").notNull(),
    intakeQuestions: jsonb("intake_questions").$type<string[]>().notNull().default([]),
    // An inactive offering stays in the admin and disappears from the seller page.
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("services_offering_teamId_idx").on(table.teamId),
    uniqueIndex("services_offering_team_name_idx").on(table.teamId, sql`lower(name)`),
    check("services_offering_price_check", sql`price_min_minor >= 0 and price_max_minor >= price_min_minor`),
    check("services_offering_days_check", sql`days_min >= 1 and days_max >= days_min`),
    check("services_offering_questions_check", sql`jsonb_array_length(intake_questions) <= 5`),
  ],
);
```

  Export it from `packages/db/src/schema/index.ts` (after `./services-teams`). In `packages/db/src/schema/projects.ts`, import `PROJECT_SOURCES` from `@jendal-workspace/core` and `servicesOffering` from `./services-catalog`, and add after `channelId`:

```ts
    // The catalog service this project is for; null when it matched none (sellers design §4.2).
    offeringId: text("offering_id").references(() => servicesOffering.id, { onDelete: "set null" }),
    // "web" is a request from the seller page (run 3b); everything else starts in the admin.
    source: text("source", { enum: PROJECT_SOURCES }).notNull().default("admin"),
```

  Update the comment in `packages/db/src/schema/organization.ts:56-57`: status applies to stores and services teams alike (publishing, run 3b), and `supportEmail` is the seller's contact address for both.

- [ ] **Step 6: Migration.**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/r3a-seller-setup
DATABASE_URL="$(sed -n 's/^TEST_DATABASE_URL=//p' .env.test.local)" pnpm -F @jendal-workspace/db db:generate --name r3a_seller_setup_and_catalog
```

  Read `packages/db/src/migrations/*_r3a_seller_setup_and_catalog/migration.sql`. Expected: `ALTER TABLE "services_team_settings"` adding `solo`, `store_enabled`, `bio` and the bio check; `ALTER TABLE "services_team_member"` adding `title`; `CREATE TABLE "services_department"` and `"services_offering"` with their indexes and checks; `ALTER TABLE "project"` adding `offering_id` (foreign key `on delete set null`) and `source` defaulting to `'admin'`. It must contain no `DROP`.

- [ ] **Step 7: Test helpers.** `packages/db/src/testing/db.ts`: add `"services_offering", "services_department"` to the `truncateAll` list (before `"services_team_settings"`); give `seedServicesTeam` a `solo?: boolean` option:

```ts
  if (input.withSettings ?? true) {
    await db.insert(servicesTeamSettings).values(
      input.solo ? { teamId: row.id, solo: true, teamCutBps: 10_000, managementFeeBps: 0 } : { teamId: row.id },
    );
  }
```

  and add a seed for offerings (import `servicesOffering` from `../schema/services-catalog`):

```ts
// A catalog service (sellers design §4.1); prices in minor units, days as a range.
export async function seedServicesOffering(
  db: Database,
  input: { teamId: string; name?: string; departmentId?: string; active?: boolean },
): Promise<string> {
  const [row] = await db
    .insert(servicesOffering)
    .values({
      teamId: input.teamId,
      departmentId: input.departmentId ?? null,
      name: input.name ?? "Logo design",
      description: "",
      priceMinMinor: 10_000,
      priceMaxMinor: 40_000,
      daysMin: 2,
      daysMax: 5,
      intakeQuestions: [],
      active: input.active ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: servicesOffering.id });
  if (!row) throw new Error("Insert into services_offering returned no row");
  return row.id;
}
```

- [ ] **Step 8: Run** `pnpm test packages/core packages/db` and `pnpm check-types`. Expected: PASS (the test database is rebuilt from the migrations, so the new columns exist). **Commit** `feat(db,core): solo seller settings and the service catalog schema`.

---

### Task 2: Catalog rules in core

**Files:**
- Create: `packages/core/src/services-teams/catalog.ts`
- Test: `packages/core/src/services-teams/catalog.test.ts`

- [ ] **Step 1: Failing tests** in `packages/core/src/services-teams/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  departmentNameProblem,
  MAX_INTAKE_QUESTIONS,
  type OfferingDraft,
  validateOfferingDraft,
} from "./catalog";

const draft: OfferingDraft = {
  name: "Logo design",
  description: "Three concepts, two rounds of changes.",
  priceMinMinor: 10_000,
  priceMaxMinor: 40_000,
  daysMin: 2,
  daysMax: 5,
  intakeQuestions: ["What is the business called?", "Any colours to avoid?"],
};

const fields = (problems: { field: string }[]) => problems.map((p) => p.field);

describe("validateOfferingDraft", () => {
  it("accepts a complete service", () => {
    expect(validateOfferingDraft(draft)).toEqual([]);
  });

  it("needs a name and trims it", () => {
    expect(fields(validateOfferingDraft({ ...draft, name: "   " }))).toEqual(["name"]);
    expect(validateOfferingDraft({ ...draft, name: " Logo design " })[0]?.field).toBeUndefined();
  });

  it("rejects a name over 80 characters and a description over 1,000", () => {
    expect(fields(validateOfferingDraft({ ...draft, name: "x".repeat(81) }))).toEqual(["name"]);
    expect(fields(validateOfferingDraft({ ...draft, description: "x".repeat(1_001) }))).toEqual(["description"]);
  });

  it("rejects a price range that is the wrong way round, negative, or not a whole minor amount", () => {
    expect(fields(validateOfferingDraft({ ...draft, priceMinMinor: 50_000 }))).toEqual(["price"]);
    expect(fields(validateOfferingDraft({ ...draft, priceMinMinor: -1 }))).toEqual(["price"]);
    expect(fields(validateOfferingDraft({ ...draft, priceMaxMinor: 1.5 }))).toEqual(["price"]);
  });

  it("accepts a fixed price (min equals max)", () => {
    expect(validateOfferingDraft({ ...draft, priceMinMinor: 20_000, priceMaxMinor: 20_000 })).toEqual([]);
  });

  it("rejects days below 1, above 365, or the wrong way round", () => {
    expect(fields(validateOfferingDraft({ ...draft, daysMin: 0 }))).toEqual(["days"]);
    expect(fields(validateOfferingDraft({ ...draft, daysMax: 366 }))).toEqual(["days"]);
    expect(fields(validateOfferingDraft({ ...draft, daysMin: 6, daysMax: 5 }))).toEqual(["days"]);
  });

  it("allows up to five non-empty intake questions", () => {
    expect(validateOfferingDraft({ ...draft, intakeQuestions: [] })).toEqual([]);
    expect(
      validateOfferingDraft({ ...draft, intakeQuestions: Array.from({ length: MAX_INTAKE_QUESTIONS }, (_, i) => `Q${i}`) }),
    ).toEqual([]);
    expect(
      fields(
        validateOfferingDraft({
          ...draft,
          intakeQuestions: Array.from({ length: MAX_INTAKE_QUESTIONS + 1 }, (_, i) => `Q${i}`),
        }),
      ),
    ).toEqual(["intakeQuestions"]);
    expect(fields(validateOfferingDraft({ ...draft, intakeQuestions: ["  "] }))).toEqual(["intakeQuestions"]);
    expect(fields(validateOfferingDraft({ ...draft, intakeQuestions: ["x".repeat(201)] }))).toEqual([
      "intakeQuestions",
    ]);
  });

  it("trims the questions it accepts", () => {
    expect(validateOfferingDraft({ ...draft, intakeQuestions: ["  What is it for?  "] })).toEqual([]);
  });
});

describe("departmentNameProblem", () => {
  it("needs a name of at most 60 characters", () => {
    expect(departmentNameProblem("  Branding  ")).toBeNull();
    expect(departmentNameProblem("   ")).toBe("Give the department a name.");
    expect(departmentNameProblem("x".repeat(61))).toBe("Keep the department name under 60 characters.");
  });
});
```

- [ ] **Step 2: Run** `pnpm test packages/core/src/services-teams/catalog.test.ts`. Expected: FAIL (no such module).

- [ ] **Step 3: Implement** `packages/core/src/services-teams/catalog.ts`:

```ts
// Sellers design §4.1: the service catalog. The same rules run in the browser before submit and in the API
// as a backstop, as validateProductDraft does for stores.

export const MAX_DEPARTMENT_NAME = 60;
export const MAX_OFFERING_NAME = 80;
export const MAX_OFFERING_DESCRIPTION = 1_000;
export const MAX_INTAKE_QUESTIONS = 5;
export const MAX_INTAKE_QUESTION_CHARS = 200;
// A quote's delivery time is capped at the same 365 days (packages/api/src/use-cases/projects.ts).
export const MAX_OFFERING_DAYS = 365;
export const MAX_OFFERING_PRICE_MINOR = 99_999_999;

export type OfferingDraft = {
  name: string;
  description: string;
  priceMinMinor: number;
  priceMaxMinor: number;
  daysMin: number;
  daysMax: number;
  intakeQuestions: string[];
};

export type OfferingProblem = { field: string; message: string };

function isWholeMinor(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_OFFERING_PRICE_MINOR;
}

function isWholeDays(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_OFFERING_DAYS;
}

export function validateOfferingDraft(draft: OfferingDraft): OfferingProblem[] {
  const problems: OfferingProblem[] = [];
  const name = draft.name.trim();
  if (!name) problems.push({ field: "name", message: "Give the service a name." });
  else if (name.length > MAX_OFFERING_NAME) {
    problems.push({ field: "name", message: `Keep the name under ${MAX_OFFERING_NAME} characters.` });
  }
  if (draft.description.length > MAX_OFFERING_DESCRIPTION) {
    problems.push({ field: "description", message: `Keep the description under ${MAX_OFFERING_DESCRIPTION} characters.` });
  }
  if (!isWholeMinor(draft.priceMinMinor) || !isWholeMinor(draft.priceMaxMinor)) {
    problems.push({ field: "price", message: "Enter both prices as whole amounts." });
  } else if (draft.priceMaxMinor < draft.priceMinMinor) {
    problems.push({ field: "price", message: "The top of the range cannot be below its bottom." });
  }
  if (!isWholeDays(draft.daysMin) || !isWholeDays(draft.daysMax)) {
    problems.push({ field: "days", message: `Usual days are whole numbers from 1 to ${MAX_OFFERING_DAYS}.` });
  } else if (draft.daysMax < draft.daysMin) {
    problems.push({ field: "days", message: "The longest time cannot be shorter than the shortest." });
  }
  if (draft.intakeQuestions.length > MAX_INTAKE_QUESTIONS) {
    problems.push({ field: "intakeQuestions", message: `Ask up to ${MAX_INTAKE_QUESTIONS} questions.` });
  } else if (
    draft.intakeQuestions.some((question) => {
      const trimmed = question.trim();
      return !trimmed || trimmed.length > MAX_INTAKE_QUESTION_CHARS;
    })
  ) {
    problems.push({
      field: "intakeQuestions",
      message: `Every question needs text, up to ${MAX_INTAKE_QUESTION_CHARS} characters.`,
    });
  }
  return problems;
}

// The draft with its text fields trimmed, ready to store.
export function normalizeOfferingDraft(draft: OfferingDraft): OfferingDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    intakeQuestions: draft.intakeQuestions.map((question) => question.trim()).filter((question) => question !== ""),
  };
}

export function departmentNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the department a name.";
  if (trimmed.length > MAX_DEPARTMENT_NAME) return `Keep the department name under ${MAX_DEPARTMENT_NAME} characters.`;
  return null;
}
```

- [ ] **Step 4: Run** the test. Expected: PASS. **Commit** `feat(core): service catalog rules`.

---

### Task 3: Catalog repositories

**Files:**
- Create: `packages/db/src/repositories/services-catalog.ts`
- Test: `packages/db/src/repositories/services-catalog.test.ts`

- [ ] **Step 1: Failing tests** in `packages/db/src/repositories/services-catalog.test.ts`. Follow the shape of `packages/db/src/repositories/services-teams.test.ts` (`createTestDb`, `truncateAll` in `beforeEach`, `db.$client.end()` in `afterAll`, `seedOrganization` + `seedServicesTeam`). Cases:

  - `createServicesDepartment` returns the row with `position` 0 for the first and 1 for the second; names are stored trimmed; a second department with the same name in another case returns `null` (the pre-check), and the same name in another team is fine.
  - `listServicesDepartments` returns them ordered by `position`, then name.
  - `renameServicesDepartment` changes the name and returns true; returns false for another team's department; returns `null` when the new name is taken in that team.
  - `deleteServicesDepartment` returns true and leaves its offerings with `departmentId: null`; returns false for another team's department.
  - `createServicesOffering` stores the draft with `active: true` and the next `position`; a duplicate name (different case) returns `null`; a second team can use the same name.
  - `listServicesOfferings` returns offerings ordered by `position`, with `{ activeOnly: true }` returning only the active ones; `findServicesOffering` returns the row for its own team and `null` for another team's id.
  - `updateServicesOffering` changes the fields, sets `updatedAt`, returns the row; returns `null` for another team's offering; moving it to another department works, and `departmentId: null` ungroups it.
  - `setServicesOfferingActive` flips `active` and returns true; false for another team's offering.
  - `deleteServicesOffering` deletes it and returns true; a project referencing it keeps its row with `offering_id` set to null (seed a project with `seedProject`, then `update` its `offeringId`, then delete the offering and read the project back).
  - `countServicesOfferings` counts all of the team's offerings, and only the active ones with `{ activeOnly: true }`.

- [ ] **Step 2: Run** `pnpm test packages/db/src/repositories/services-catalog.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `packages/db/src/repositories/services-catalog.ts`. Shape (keep the column list explicit, as `services-teams.ts` does, so later columns do not change what these return):

```ts
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../index";
import { servicesDepartment, servicesOffering } from "../schema/services-catalog";
import type { OfferingDraft } from "@jendal-workspace/core";

export type ServicesDepartmentRow = { id: string; name: string; position: number };

export type ServicesOfferingRow = OfferingDraft & {
  id: string;
  departmentId: string | null;
  active: boolean;
  position: number;
};

const departmentColumns = {
  id: servicesDepartment.id,
  name: servicesDepartment.name,
  position: servicesDepartment.position,
};

const offeringColumns = {
  id: servicesOffering.id,
  departmentId: servicesOffering.departmentId,
  name: servicesOffering.name,
  description: servicesOffering.description,
  priceMinMinor: servicesOffering.priceMinMinor,
  priceMaxMinor: servicesOffering.priceMaxMinor,
  daysMin: servicesOffering.daysMin,
  daysMax: servicesOffering.daysMax,
  intakeQuestions: servicesOffering.intakeQuestions,
  active: servicesOffering.active,
  position: servicesOffering.position,
};
```

  Functions, all scoped by `teamId` in the `where` clause so one team never reads or writes another's rows:

```ts
export async function listServicesDepartments(db: Database, teamId: string): Promise<ServicesDepartmentRow[]>
export async function createServicesDepartment(
  db: Database,
  input: { teamId: string; name: string },
): Promise<ServicesDepartmentRow | null> // null when the team already has that name (case-insensitive)
export async function renameServicesDepartment(
  db: Database,
  input: { id: string; teamId: string; name: string },
): Promise<boolean | null> // null when the new name is taken, false when the department is not the team's
export async function deleteServicesDepartment(db: Database, input: { id: string; teamId: string }): Promise<boolean>
export async function listServicesOfferings(
  db: Database,
  teamId: string,
  options?: { activeOnly?: boolean },
): Promise<ServicesOfferingRow[]>
export async function findServicesOffering(
  db: Database,
  input: { id: string; teamId: string },
): Promise<ServicesOfferingRow | null>
export async function createServicesOffering(
  db: Database,
  input: { teamId: string; departmentId?: string | null } & OfferingDraft,
): Promise<ServicesOfferingRow | null> // null on a duplicate name in this team
export async function updateServicesOffering(
  db: Database,
  input: { id: string; teamId: string; departmentId?: string | null } & OfferingDraft,
): Promise<ServicesOfferingRow | null> // null when the offering is not the team's, or the name is taken by another
export async function setServicesOfferingActive(
  db: Database,
  input: { id: string; teamId: string; active: boolean },
): Promise<boolean>
export async function deleteServicesOffering(db: Database, input: { id: string; teamId: string }): Promise<boolean>
export async function countServicesOfferings(
  db: Database,
  teamId: string,
  options?: { activeOnly?: boolean },
): Promise<number>
```

  Implementation notes:
  - Trim names before storing and before the duplicate check; compare with `sql`lower(${servicesOffering.name}) = ${name.toLowerCase()}``.
  - `position` on create: `select coalesce(max(position), -1) + 1 from … where team_id = $teamId`.
  - `createServicesOffering` inserts with an explicit `id: crypto.randomUUID()`, `createdAt`/`updatedAt: new Date()`, and returns the row through `offeringColumns`; a name check first (returning `null`), with the unique index as the concurrency guard.
  - `updateServicesOffering` excludes its own id from the name check, sets `updatedAt: new Date()`, and only writes `departmentId` when the input has the key (`"departmentId" in input`).
  - `deleteServicesDepartment` relies on the foreign key's `on delete set null`; `deleteServicesOffering` on `project.offering_id`'s `on delete set null`.
  - Order offerings by `position`, then `name`; departments by `position`, then `name`.

- [ ] **Step 4: Run** the test. Expected: PASS. **Commit** `feat(db): service catalog repositories`.

---

### Task 4: Solo setup in the api

**Files:**
- Modify: `packages/auth/src/index.ts:167-175` (support email), `packages/auth/src/index.test.ts:125`
- Modify: `packages/db/src/repositories/services-teams.ts` (settings columns, `applySoloTeamDefaults`, `saveServicesTeamBio`, `switchToTeam`, member titles)
- Modify: `packages/api/src/routers/services-team.ts` (`create` with `solo`, `updateBio`, `switchToTeam`, `setMemberTitle`, `listMembers` titles, the solo guard in `updateSettings`)
- Modify: `packages/api/src/routers/services-team.test.ts`
- Test: `packages/db/src/repositories/services-teams.test.ts`, `packages/api/src/routers/services-team.test.ts`

- [ ] **Step 1: Failing tests.**
  - `packages/db/src/repositories/services-teams.test.ts`: `applySoloTeamDefaults(db, teamId)` sets `solo: true`, cut 10000, fee 0 and leaves `settingsSavedAt` null; `saveServicesTeamBio(db, teamId, bio)` stores the trimmed bio and leaves the rates and `settingsSavedAt` alone; `switchToTeam(db, teamId)` sets `solo: false` and puts the cut back to 1500 and the fee to 1000 when they are still the solo defaults, but keeps rates the seller changed (save 2000/500 first, then switch, and both stay); `setServicesTeamMemberTitle(db, { teamId, userId, title })` stores the trimmed title, clears it with `null`, returns false for a user with no row, and `listServicesTeamMembers` returns `title`.
  - `packages/api/src/routers/services-team.test.ts`:
    - `create({ name, slug, solo: true })` creates a team whose settings are `{ solo: true, teamCutBps: 10_000, managementFeeBps: 0, settingsSavedAt: null }` and whose `support_email` is the creator's email; `create({ name, slug })` (no `solo`) keeps the team defaults and also gets the support email. Update the existing assertion at `:68` from `supportEmail: null` to the owner's email, and rename that test to "…with default settings and the creator's support email".
    - `updateBio` is admin-only (`FORBIDDEN` for a manager), trims, and refuses 281 characters with `BAD_REQUEST` and the message "Keep your bio under 280 characters."; `get` returns the new bio.
    - `switchToTeam` is admin-only, turns a solo seller into a team (cut 1500, fee 1000, `solo: false`), and refuses a team that is not solo with `BAD_REQUEST` "This seller is already a team.".
    - `updateSettings` on a solo team refuses a cut other than 100% with `BAD_REQUEST` "A solo seller keeps the whole price. Switch to a team to set a team cut and a management fee.", and accepts the same currency/modes with the solo rates unchanged.
    - `setMemberTitle` is admin-only, stores the title, and `listMembers` returns it.
  - `packages/auth/src/index.test.ts:125`: a services team now gets `supportEmail: email`.

- [ ] **Step 2: Run** `pnpm test packages/db/src/repositories/services-teams.test.ts packages/api/src/routers/services-team.test.ts packages/auth`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `packages/auth/src/index.ts`: in `beforeCreateTeam`, `supportEmail: user?.email ?? null` for both products, and adjust the comment above it: the support email is the seller's contact address on its policies and seller page (run 3b).
  - `packages/db/src/repositories/services-teams.ts`: add `solo`, `storeEnabled`, `bio` to `settingsColumns`; import `SOLO_MANAGEMENT_FEE_BPS`, `SOLO_TEAM_CUT_BPS` from core; add:

```ts
// Sellers design §3.1: a solo seller keeps the whole price. Written right after createTeam, which made the
// row with the team defaults; settings_saved_at stays null so the setup checklist still asks for the rates.
export async function applySoloTeamDefaults(db: Database, teamId: string): Promise<void> {
  const values = { solo: true, teamCutBps: SOLO_TEAM_CUT_BPS, managementFeeBps: SOLO_MANAGEMENT_FEE_BPS };
  await db
    .insert(servicesTeamSettings)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: servicesTeamSettings.teamId, set: values });
}

// The bio is not part of the rates, so saving it does not count as "Set your rates" for the checklist.
export async function saveServicesTeamBio(db: Database, teamId: string, bio: string): Promise<void> {
  const values = { bio };
  await db
    .insert(servicesTeamSettings)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: servicesTeamSettings.teamId, set: values });
}

// Sellers design §3.1: a solo seller can become a team; the cut and the fee go back to the team defaults
// unless the seller already set other rates.
export async function switchToTeam(db: Database, teamId: string): Promise<void> {
  await db
    .update(servicesTeamSettings)
    .set({
      solo: false,
      teamCutBps: sql`case when ${servicesTeamSettings.teamCutBps} = ${SOLO_TEAM_CUT_BPS} then 1500 else ${servicesTeamSettings.teamCutBps} end`,
      managementFeeBps: sql`case when ${servicesTeamSettings.managementFeeBps} = ${SOLO_MANAGEMENT_FEE_BPS} then 1000 else ${servicesTeamSettings.managementFeeBps} end`,
    })
    .where(eq(servicesTeamSettings.teamId, teamId));
}

// False when the user has no row in this team.
export async function setServicesTeamMemberTitle(
  db: Database,
  input: { teamId: string; userId: string; title: string | null },
): Promise<boolean>
```

    (`switchToTeam` needs `sql` imported from `drizzle-orm`.) Add `title: servicesTeamMember.title` to the member select in `listServicesTeamMembers` and to `ServicesTeamMemberRow`.
  - `packages/api/src/routers/services-team.ts`:
    - `create`: input `z.object({ name: …, slug: slugInput, solo: z.boolean().default(false) })`; after `createTeam`, when `input.solo` look the team up with `findServicesTeamBySlug(ctx.db, slug.slug)` and call `applySoloTeamDefaults`; if the lookup returns nothing throw `TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The team was not created." })`. Update the comment that mentions the hooks.
    - `updateSettings`: after `requireAction`, read the current settings (`getServicesTeamSettings`) and when `settings?.solo` is true refuse rates other than the solo defaults:

```ts
      if (settings?.solo && (teamCutBps !== SOLO_TEAM_CUT_BPS || managementFeeBps !== SOLO_MANAGEMENT_FEE_BPS)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A solo seller keeps the whole price. Switch to a team to set a team cut and a management fee.",
        });
      }
```

    - `updateBio`: `servicesTeamProcedure`, input `z.object({ bio: z.string().max(2_000) })`, `requireAction(…, "manage_settings", …)`, then `bioProblem(input.bio)` → `BAD_REQUEST` with that message, else `saveServicesTeamBio(ctx.db, ctx.servicesTeam.id, input.bio.trim())` and return `{ bio: input.bio.trim() }`. (The zod max is only a payload guard; `bioProblem` gives the message.)
    - `switchToTeam`: `servicesTeamProcedure`, admin-only via `manage_settings`; read the settings, refuse with `BAD_REQUEST` "This seller is already a team." when `settings` exists and `solo` is false; otherwise `switchToTeam(ctx.db, ctx.servicesTeam.id)` and return the settings read back (with `settingsSavedAt` through `isoOrNull`). Name the repository import differently from the procedure (for example `switchTeamToTeamMode`) to avoid a clash.
    - `setMemberTitle`: input `z.object({ userId: z.string().min(1), title: z.string().trim().max(80) })`, `requireAction(…, "manage_members", "Only an admin can manage members.")`, call `setServicesTeamMemberTitle` with `title: input.title || null`, and throw `NOT_FOUND` "This user is not on the team." when it returns false.

- [ ] **Step 4: Run** `pnpm test packages/db packages/api packages/auth` and `pnpm check-types`. Expected: PASS. **Commit** `feat(api): solo sellers, the bio, member titles`.

---

### Task 5: Solo money and solo quoting

**Files:**
- Modify: `packages/core/src/billing/seller-plans.ts`, `packages/core/src/billing/seller-plans.test.ts`
- Modify: `packages/core/src/projects/permissions.ts`, `packages/core/src/projects/permissions.test.ts`
- Modify: `packages/api/src/use-cases/payments.ts:308-314,406`, `packages/api/src/use-cases/projects.ts` (`addQuote`)
- Test: `packages/api/src/use-cases/payments.test.ts` (or wherever the fee is asserted), `packages/api/src/routers/project.test.ts`

- [ ] **Step 1: Failing tests.**
  - `packages/core/src/billing/seller-plans.test.ts`: replace the "puts every services team on Team until billing ships" case with:

```ts
  it("puts a solo seller on Solo and a team on Team until billing ships", () => {
    expect(sellerPlanFor({ id: "team-1", solo: true })).toBe(getSellerPlan("solo"));
    expect(sellerPlanFor({ id: "team-1", solo: false })).toBe(getSellerPlan("team"));
    expect(sellerPlanFor({ id: "team-1" })).toBe(getSellerPlan("team"));
  });
```

  - `packages/core/src/projects/permissions.test.ts`: a solo seller quotes as themselves in every quoting mode, assigned or not:

```ts
  it("lets a solo seller quote as themselves without an assignment (sellers design §3.1)", () => {
    for (const quotingMode of QUOTING_MODES) {
      expect(quoteAuthor({ ...base, role: "admin", quotingMode, solo: true })).toEqual({ ok: true, freelancerId: "u1" });
    }
    expect(quoteAuthor({ ...base, role: "manager", quotingMode: "assigned", solo: true })).toEqual({
      ok: true,
      freelancerId: "u1",
    });
  });

  it("still refuses a freelancer on a solo team they are not", () => {
    expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "assigned", solo: true })).toEqual({
      ok: false,
      reason: "not_assigned",
    });
  });
```

    (`base` in that file is `{ role: "manager", actorId: "u1", quotingMode: "open", assignedFreelancerId: null }`; check it and import `QUOTING_MODES` from `../services-teams/types`.)
  - `packages/api/src/routers/project.test.ts`: a solo seller (seed with `seedServicesTeam(db, { organizationId, slug: "solo", solo: true })`) starts a project and adds a quote with no assignment and no `freelancerId`; the quote's `freelancer_id` is the owner. The same project on a team seller still fails with "Assign a freelancer first; in this team the assigned freelancer quotes.".

- [ ] **Step 2: Run** `pnpm test packages/core/src/billing packages/core/src/projects/permissions.test.ts packages/api/src/routers/project.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `packages/core/src/billing/seller-plans.ts`:

```ts
// Until billing ships (pricing proposal §6) the plan follows the seller's shape: a solo seller is on Solo,
// a team on Team. Run 8 replaces this with the plan the seller subscribed to.
export function sellerPlanFor(team: { id: string; solo?: boolean }): SellerPlan {
  return getSellerPlan(team.solo ? "solo" : "team");
}
```

  - `packages/core/src/projects/permissions.ts`: `quoteAuthor`'s input gains `solo?: boolean`, and before the `switch`:

```ts
  // Sellers design §3.1: a solo seller is the freelancer, so there is no assignment step (backlog, run 3).
  if (input.solo && staff) return { ok: true, freelancerId: input.actorId };
```

  - `packages/api/src/use-cases/projects.ts`: in `addQuote`, pass `solo: settings.solo` to `quoteAuthor`.
  - `packages/api/src/use-cases/payments.ts`: `requireSeller` also returns `solo`:

```ts
async function requireSeller(db: Database, teamId: string): Promise<{ merchantId: string; name: string; solo: boolean }> {
  const team = await findTeamById(db, teamId);
  if (!team?.paypalMerchantId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This team cannot take PayPal payments yet." });
  }
  // Payleor's fee follows the seller's plan (pricing proposal §1): Solo 2%, Team 1%.
  const settings = await getServicesTeamSettings(db, teamId);
  return { merchantId: team.paypalMerchantId, name: team.name, solo: settings?.solo ?? false };
}
```

    and line 406 becomes `platformFeeMinor(row.amountMinor, sellerPlanFor({ id: row.teamId, solo: seller.solo }).feeBps)`. Import `getServicesTeamSettings` from `@jendal-workspace/db/repositories/services-teams`.

- [ ] **Step 4: Run** `pnpm test packages/core packages/api` and `pnpm check-types`. Expected: PASS. If a payment test asserts a 1% fee on a team that is now solo, fix the seed rather than the assertion. **Commit** `feat(core,api): solo sellers keep the whole price and quote without an assignment`.

---

### Task 6: The catalog router, the offering count, and the checklist

**Files:**
- Create: `packages/api/src/routers/services-catalog.ts`
- Test: `packages/api/src/routers/services-catalog.test.ts`
- Modify: `packages/api/src/routers/index.ts`, `packages/api/src/routers/services-team.ts` (`get` returns `offeringCount`)
- Modify: `packages/core/src/services-teams/setup-steps.ts`, `packages/core/src/services-teams/setup-steps.test.ts`
- Modify: `packages/api/src/routers/services-team.test.ts` (the `get` assertion gains `offeringCount: 0`)

- [ ] **Step 1: Failing tests.**
  - `packages/api/src/routers/services-catalog.test.ts` (copy the caller setup from `services-team.test.ts`):
    - `list` returns `{ departments, offerings }` for an admin, a manager and a freelancer (`view_team`), and `NOT_FOUND` for an outsider and for a store slug.
    - `createDepartment` is admin-only (`FORBIDDEN` for a manager, message "Only an admin can manage the catalog."), trims the name, refuses an empty name and one over 60 characters with `BAD_REQUEST`, and refuses a duplicate (different case) with `CONFLICT` "Your team already has a department with this name.".
    - `renameDepartment` renames; `CONFLICT` on a taken name; `NOT_FOUND` for another team's department id.
    - `deleteDepartment` deletes it and leaves its offerings ungrouped (`list` shows them with `departmentId: null`).
    - `createOffering` stores a service (name trimmed, questions trimmed, `active: true`) and returns the row; refuses a bad range with `BAD_REQUEST` and the rule's message ("The top of the range cannot be below its bottom."); refuses more than five questions; `CONFLICT` "Your team already has a service with this name." on a duplicate; `NOT_FOUND` for a `departmentId` belonging to another team.
    - `updateOffering` changes the fields, can move the offering to a department or ungroup it with `departmentId: null`, and returns `NOT_FOUND` for another team's offering.
    - `setOfferingActive` flips `active`, and `list` with the offering inactive still returns it to the team.
    - `deleteOffering` deletes it; a project that referenced it keeps its row with `offeringId: null` (check through `project.get` or by reading the row).
    - One team's catalog is invisible to another: `list` for a second team returns empty.
  - `packages/core/src/services-teams/setup-steps.test.ts`: rewrite for the new signature — a team gets `create-team`, `add-service` (done when `offeringCount > 0`), `connect-paypal`, `set-rates`, `add-payout-credentials` (not done, no link), `link-discord`; a solo seller gets `create-team`, `add-service`, `connect-paypal`, `link-discord` and neither `set-rates` nor `add-payout-credentials`; the solo `create-team` label is "Create your seller page".

- [ ] **Step 2: Run** `pnpm test packages/api/src/routers/services-catalog.test.ts packages/core/src/services-teams/setup-steps.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `packages/core/src/services-teams/setup-steps.ts`:

```ts
export type ServicesTeamSetupLinks = {
  settings: string;
  services: string;
  connectPaypal?: string;
  payoutCredentials?: string;
  linkDiscord?: string;
};

export function servicesTeamSetupSteps(
  state: {
    paypalMerchantId: string | null;
    settingsSaved: boolean;
    discordGuildId: string | null;
    solo: boolean;
    offeringCount: number;
  },
  links: ServicesTeamSetupLinks,
): SetupStep[] {
  return [
    step("create-team", state.solo ? "Create your seller page" : "Create your team", true),
    // Sellers design §3.2: the seller page needs at least one service or one product.
    step("add-service", "Add your first service", state.offeringCount > 0, links.services),
    step("connect-paypal", "Connect PayPal", state.paypalMerchantId !== null, links.connectPaypal),
    // A solo seller keeps the whole price, so there are no rates and no payouts to set up (run 5).
    ...(state.solo ? [] : [step("set-rates", "Set your rates", state.settingsSaved, links.settings)]),
    ...(state.solo ? [] : [step("add-payout-credentials", "Add payout credentials", false, links.payoutCredentials)]),
    step("link-discord", "Link Discord", state.discordGuildId !== null, links.linkDiscord),
  ];
}
```

  - `packages/api/src/routers/services-catalog.ts`: a `servicesCatalogRouter` on `servicesTeamProcedure`, with the same `requireAction` helper as `services-team.ts` (copy it; it is five lines) and these procedures:

```ts
const offeringInput = z.object({
  name: z.string().trim().min(1).max(MAX_OFFERING_NAME),
  description: z.string().max(MAX_OFFERING_DESCRIPTION),
  priceMinMinor: z.number().int().min(0).max(MAX_OFFERING_PRICE_MINOR),
  priceMaxMinor: z.number().int().min(0).max(MAX_OFFERING_PRICE_MINOR),
  daysMin: z.number().int().min(1).max(MAX_OFFERING_DAYS),
  daysMax: z.number().int().min(1).max(MAX_OFFERING_DAYS),
  intakeQuestions: z
    .array(z.string().trim().min(1).max(MAX_INTAKE_QUESTION_CHARS))
    .max(MAX_INTAKE_QUESTIONS),
});
```

    - `list`: `requireAction(role, "view_team", …)`; `Promise.all([listServicesDepartments, listServicesOfferings])`; return `{ departments, offerings }`.
    - `createDepartment` / `renameDepartment` / `deleteDepartment` / `createOffering` / `updateOffering` / `setOfferingActive` / `deleteOffering`: all `requireAction(role, "manage_settings", "Only an admin can manage the catalog.")`.
    - Department names go through `departmentNameProblem` (`BAD_REQUEST` with its message) before the repository; a `null` from the repository is `CONFLICT` ("Your team already has a department with this name." / "Your team already has a service with this name."), a `false` is `NOT_FOUND` ("This department is not in your team." / "This service is not in your team.").
    - Offerings go through `normalizeOfferingDraft` then `validateOfferingDraft`; the first problem becomes `BAD_REQUEST` with its message. A `departmentId` in the input is checked with `listServicesDepartments` (or a `findServicesDepartment` you add) and refused with `NOT_FOUND` "That department is not in your team.".
    - `updateOffering`'s input is `offeringInput.extend({ offeringId: z.string().min(1), departmentId: z.string().nullish() })`; pass `departmentId: input.departmentId ?? null`.
    - `createOffering`'s input is `offeringInput.extend({ departmentId: z.string().nullish() })`.
  - Register it in `packages/api/src/routers/index.ts` as `servicesCatalog: servicesCatalogRouter` (alphabetical, after `servicesTeam`? keep the list alphabetical: `servicesCatalog` before `servicesTeam`).
  - `packages/api/src/routers/services-team.ts` `get`: also return `offeringCount: await countServicesOfferings(ctx.db, ctx.servicesTeam.id)` (all offerings, active or not: a draft service still counts as "added"). Update the `get` assertion in `services-team.test.ts`.

- [ ] **Step 4: Run** `pnpm test packages/api packages/core` and `pnpm check-types`. Expected: PASS. **Commit** `feat(api,core): the services catalog router and the setup checklist step`.

---

### Task 7: Projects carry their service and their source

**Files:**
- Modify: `packages/api/src/use-cases/projects.ts` (`startProject`), `packages/api/src/routers/project.ts` (`create` input)
- Modify: `packages/api/src/routers/project.test.ts`
- Modify: whatever reads a project back to the admin (`packages/api/src/routers/project.ts` `get`) so the offering's name is visible — check what `get` returns and add `offering: { id, name } | null` only if the query is already there; otherwise return `offeringId` and let Task 11 resolve the name from the catalog list.

- [ ] **Step 1: Failing tests** in `packages/api/src/routers/project.test.ts`:
  - `project.create` with an `offeringId` of the team's own active offering stores it and `source: "admin"` (read the row).
  - An `offeringId` of another team's offering, or of the team's own inactive offering, is refused with `BAD_REQUEST` "That service is not on your team's list.".
  - Without `offeringId` the project's `offering_id` is null and its `source` is `"admin"`.

- [ ] **Step 2: Run** `pnpm test packages/api/src/routers/project.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `startProject` (`packages/api/src/use-cases/projects.ts:109-152`): the input type gains `offeringId?: string | null`; after the settings lookup:

```ts
  const offeringId = input.offeringId?.trim() || null;
  if (offeringId) {
    const offering = await findServicesOffering(db, { id: offeringId, teamId: actor.teamId });
    if (!offering?.active) fail("BAD_REQUEST", "That service is not on your team's list.");
  }
```

  and the insert gains `offeringId` and `source: "admin"`. In `packages/api/src/routers/project.ts` `create`, add `offeringId: z.string().min(1).optional()` to the input and pass it through.

- [ ] **Step 4: Run** `pnpm test packages/api` and `pnpm check-types`. Expected: PASS. **Commit** `feat(api): a project records the service it is for`.

---

### Task 8: The create form asks "Just me" or "A team"

**Files:**
- Modify: `apps/web/src/app/admin/new/services-team/page.tsx`, `apps/web/src/app/admin/new/services-team/create-services-team-form.tsx`

- [ ] **Step 1: Page copy.** In `page.tsx`, the heading becomes "Sell your services" and the paragraph:

```tsx
      <p className="mt-1 text-sm text-muted-foreground">
        A seller is a team of one or a team of many. You can rename it later; its address cannot be changed.
      </p>
```

- [ ] **Step 2: The form.** In `create-services-team-form.tsx`: add `const [solo, setSolo] = useState(true);` (a new seller is most often one person), pass `solo` in `create.mutate({ name: name.trim(), slug, solo })`, change the "Team name" label to "Name", and put this fieldset first in the form:

```tsx
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who is selling?</legend>
        <div className="grid gap-2">
          <label className="flex items-start gap-3 border p-3 has-[:checked]:border-foreground has-[:checked]:bg-accent">
            <input
              type="radio"
              name="seller-kind"
              value="solo"
              checked={solo}
              onChange={() => setSolo(true)}
              className="mt-1 accent-current"
            />
            <span>
              <span className="block font-medium">Just me</span>
              <span className="block text-sm text-muted-foreground">
                You do the work and keep the whole price. No members, no payouts.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 border p-3 has-[:checked]:border-foreground has-[:checked]:bg-accent">
            <input
              type="radio"
              name="seller-kind"
              value="team"
              checked={!solo}
              onChange={() => setSolo(false)}
              className="mt-1 accent-current"
            />
            <span>
              <span className="block font-medium">A team</span>
              <span className="block text-sm text-muted-foreground">
                Members share the price: your team cut and a management fee apply.
              </span>
            </span>
          </label>
        </div>
      </fieldset>
```

  The submit label becomes `{create.isPending ? "Creating…" : solo ? "Create my seller page" : "Create our team"}`. The slug label "Team address" becomes "Address", and its `id`/`htmlFor` stay `team-slug`.

- [ ] **Step 3: Run** `pnpm test apps/web` and `pnpm -F @jendal-workspace/web check-types`. Expected: PASS. **Commit** `feat(web): the seller create form asks "Just me" or "A team"`.

---

### Task 9: Settings and members for a solo seller

**Files:**
- Modify: `apps/web/src/app/admin/[storeSlug]/settings/services-team-settings.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/members/services-team-members.tsx`

- [ ] **Step 1: Settings.** In `services-team-settings.tsx`:
  - Add local state `const [bio, setBio] = useState<string | null>(null);` and read `const solo = current?.solo ?? false;`; `values` gains `bio: bio ?? current?.bio ?? ""`.
  - A bio field before the currency field:

```tsx
        <div className="space-y-2">
          <Label htmlFor="bio">About you</Label>
          <Textarea
            id="bio"
            value={values.bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={1_000}
            placeholder="What you make, for whom, and how you work."
          />
          <p className="text-sm text-muted-foreground">
            Up to {MAX_BIO_CHARS} characters, shown on your seller page. {values.bio.trim().length}/{MAX_BIO_CHARS}
          </p>
        </div>
```

    with its own save button under it (`saveBio` mutation on `trpc.servicesTeam.updateBio`, disabled while pending or when the trimmed bio is unchanged or over `MAX_BIO_CHARS`, showing the mutation's error and "Saved." on success, and invalidating `servicesTeam.get`). Import `MAX_BIO_CHARS` from `@jendal-workspace/core` and `Textarea` from `@jendal-workspace/ui/components/textarea`.
  - When `solo` is true, render none of the team cut, management fee, quoting and payout fields; in their place:

```tsx
        <p className="border p-3 text-sm text-muted-foreground">
          You work alone, so you keep the whole price. Switch to a team to set a team cut, a management fee and
          payouts.
        </p>
```

    The rates form for a solo seller submits only the currency, with the hidden values passed through unchanged (`teamCutBps: current?.teamCutBps ?? SOLO_TEAM_CUT_BPS`, `managementFeeBps: current?.managementFeeBps ?? SOLO_MANAGEMENT_FEE_BPS`, `quotingMode: current?.quotingMode ?? "assigned"`, `payoutMode: current?.payoutMode ?? "manual"`), so `canSave` for a solo seller is `role === "admin" && !save.isPending`.
  - After the rates form, when `solo` is true and `role === "admin"`, a "Switch to a team" section: a short line ("Your team cut becomes 15% and your management fee 10%. You can add members afterwards.") and a button on `trpc.servicesTeam.switchToTeam` that invalidates `servicesTeam.get` on success and shows the error.

- [ ] **Step 2: Members.** In `services-team-members.tsx`:
  - When `team.data.settings?.solo` is true, render instead of the list and the add form:

```tsx
        <div className="mt-6 grid gap-2 border border-dashed p-6">
          <p className="font-medium">You work alone</p>
          <p className="text-sm text-muted-foreground">
            A solo seller has no members and no payouts. Switch to a team in Settings to add people.
          </p>
          <Link href={`/${team.data.team.slug}/settings`} className="text-sm underline underline-offset-4">
            Open settings
          </Link>
        </div>
```

  - Otherwise, in each member row, under the email line, add a title field for admins (a text input, `maxLength={80}`, placeholder "Title (for example Brand designer)", default value `member.title ?? ""`, saving on blur through `trpc.servicesTeam.setMemberTitle` when the trimmed value differs, and invalidating the list), and show the title as plain text for non-admins when there is one.

- [ ] **Step 3: Run** `pnpm test apps/web` and `pnpm -F @jendal-workspace/web check-types`. Expected: PASS. **Commit** `feat(web): solo settings, the bio, and member titles`.

---

### Task 10: The catalog admin pages

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/services/page.tsx`
- Create: `apps/web/src/app/admin/[storeSlug]/services/services-catalog.tsx`
- Create: `apps/web/src/app/admin/[storeSlug]/services/new/page.tsx`
- Create: `apps/web/src/app/admin/[storeSlug]/services/[offeringId]/page.tsx`
- Create: `apps/web/src/app/admin/[storeSlug]/services/offering-form.tsx`

- [ ] **Step 1: Server pages.** `services/page.tsx` follows `members/page.tsx`:

```tsx
import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import ServicesCatalog from "./services-catalog";

export default async function ServicesCatalogPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <ServicesCatalog teamSlug={storeSlug} />;
}
```

  `services/new/page.tsx` renders `<OfferingForm teamSlug={storeSlug} />` with the same guard; `services/[offeringId]/page.tsx` reads both params and renders `<OfferingForm teamSlug={storeSlug} offeringId={offeringId} />`.

- [ ] **Step 2: The list.** `services-catalog.tsx` (`"use client"`), modelled on `products-list.tsx` and `services-team-members.tsx`:
  - `useQuery(trpc.servicesTeam.get.queryOptions({ teamSlug }))` for the role and `useQuery(trpc.servicesCatalog.list.queryOptions({ teamSlug }), { retry: false })` for the catalog; `Loader` while pending, `TeamNotFound` on the team error, `<p role="alert">The services couldn't be loaded.</p>` on the catalog error.
  - Header: the team name link, `h1` "Services", and an "Add service" link (`buttonVariants()`) to `/${teamSlug}/services/new`.
  - A departments block for admins: an inline form (input + "Add department" button) on `createDepartment`, and per department its name, a rename input (saving on blur through `renameDepartment` when changed), a delete button (`deleteDepartment`, with `window.confirm("Delete this department? Its services stay, ungrouped.")`), and the count of its services. Non-admins see the names only. Explain in one line: "Optional groups for your seller page. A service can also stand alone."
  - The offerings, grouped: each department's offerings under its heading, then "Not in a department". Each row links to `/${teamSlug}/services/${offering.id}` and shows the name, the price range with `formatMinor(priceMinMinor, currency)` (or one price when min equals max), `"{daysMin}–{daysMax} days"` (or one number when equal), the question count when there are questions, "Hidden" when inactive, and for admins a hide/show button (`setOfferingActive`) and a delete button (`deleteOffering`, with `window.confirm`). Every mutation invalidates `servicesCatalog.list` and `servicesTeam.get` (the checklist counts offerings).
  - Empty state: "No services yet" with "Add your first service — what you make, what it usually costs and how long it takes." linking to the new page.

- [ ] **Step 3: The form.** `offering-form.tsx` (`"use client"`), used for both new and edit:
  - Reads `servicesTeam.get` (role, currency) and `servicesCatalog.list`; when `offeringId` is set, finds the offering there and renders `TeamNotFound`-style "This service is not in your team." when it is missing after the query settles.
  - Local state as strings for the four numbers (`priceMin`, `priceMax`, `daysMin`, `daysMax`), `name`, `description`, `departmentId` (`""` for none), `active`, and `questions: string[]`. Initialise from the offering when editing, else `priceMin: ""`, `priceMax: ""`, `daysMin: "1"`, `daysMax: "7"`, `questions: []`.
  - Build the draft with `parsePriceInput` from `@/lib/money` for the prices (`null` when the text is not an amount) and `Number.parseInt(…, 10)` for the days (`Number.NaN` → `-1` so the rule fires), then run `validateOfferingDraft` from `@jendal-workspace/core`; show the first problem message under the submit button and disable submit while there are problems, while the mutation is pending, or when the role is not `admin`.
  - Fields: Name, Description (`Textarea`, `maxLength={1_000}`), Department (`select` with "No department" plus the team's departments), "Usually costs" (two inputs labelled From and To, in major units, with a hint that a fixed price is the same number twice), "Usually takes" (two number inputs, days, whole numbers from 1 to 365), "Questions for the client" (the list of question inputs with a remove button each, plus an "Add question" button disabled at `MAX_INTAKE_QUESTIONS`, and the hint "Up to 5. They appear on the request form on your seller page."), and when editing an Active checkbox ("Show this service on your seller page").
  - Submit: `createOffering` (with `departmentId: departmentId || null`) or `updateOffering` (with `offeringId`), then `router.push(`/${teamSlug}/services`)`. Show the mutation error.

- [ ] **Step 4: Run** `pnpm test apps/web` and `pnpm -F @jendal-workspace/web check-types`. Expected: PASS. **Commit** `feat(web): the services catalog admin`.

---

### Task 11: Dashboard, checklist and the new project form

**Files:**
- Modify: `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/projects/new/new-project-form.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/projects/page.tsx` or the projects list nav if it repeats the team nav (check and keep them consistent)

- [ ] **Step 1: Dashboard.** In `services-team-dashboard.tsx`:
  - `servicesTeamSetupSteps` gains `solo: settings?.solo ?? false` and `offeringCount: offeringCount` from the query data, and its links gain `services: `/${team.slug}/services``.
  - The nav gains a Services link (`/${team.slug}/services`) after Projects, and renders the Members link only when `!(settings?.solo ?? false)`.
  - Add a "Services" section next to the Projects one, in the same bordered style:

```tsx
      <section className="grid gap-2 border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Services</h2>
          <Link href={`/${team.slug}/services`} className="text-sm underline underline-offset-4">
            Open services
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          What you sell, with a usual price range and time. Clients pick one when they ask for a quote.
        </p>
      </section>
```

  - The `dl` gains a row: "Selling as" with "Just me" when solo and "A team" otherwise.
  - `<ComingSoon title="Payouts" />` renders only when not solo.

- [ ] **Step 2: New project form.** In `new-project-form.tsx`: `const catalog = useQuery({ ...trpc.servicesCatalog.list.queryOptions({ teamSlug }), retry: false });` and `const [offeringId, setOfferingId] = useState("");`, a select after the title field:

```tsx
        <div className="space-y-2">
          <Label htmlFor="project-offering">Service</Label>
          <select
            id="project-offering"
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            value={offeringId}
            onChange={(e) => setOfferingId(e.target.value)}
          >
            <option value="">Not one of my services</option>
            {(catalog.data?.offerings ?? [])
              .filter((offering) => offering.active)
              .map((offering) => (
                <option key={offering.id} value={offering.id}>
                  {offering.name}
                </option>
              ))}
          </select>
          <p className="text-xs text-muted-foreground">Optional. It tells you later what the client asked for.</p>
        </div>
```

  and `create.mutate({ teamSlug, title, brief, clientEmail, clientDiscordId, channelId: "", offeringId: offeringId || undefined })`.

- [ ] **Step 3: Run** `pnpm test apps/web` and `pnpm -F @jendal-workspace/web check-types`. Expected: PASS. **Commit** `feat(web): the services nav, the checklist step, and the service picker`.

---

### Task 12: Pricing copy, full check, merge (controller)

- [ ] **Step 1:** `apps/web/src/app/(site)/page.tsx:205` becomes:

```tsx
            <p>PayPal's processing fees apply and are charged by PayPal; their rate varies by country.</p>
```

- [ ] **Step 2:** `pnpm test && pnpm check-types` in the worktree. Fix anything that fails.
- [ ] **Step 3:** Merge into `main` with `--no-ff`, a subject naming the run and a paragraph saying what it does, and the Co-authored-by trailer. Then in `main`: `pnpm install`, `pnpm db:migrate:dev` (applies `*_r3a_seller_setup_and_catalog`), restart the dev stack. If the web app shows a blank page or "Invalid hook call" after a merge that touched dependencies, stop dev, delete `apps/web/node_modules/.vite`, restart and clear the browser cache (§11.1 dev note).

---

### Task 13: Walkthrough (controller, no payment needed)

Over the tunnel (`https://admin.<TUNNEL_DOMAIN>`), with the dev stack running. No PayPal popup is needed: starting a payment creates the order server-side, so the fee can be read from the database. Ask Mouhamed before any payment in a popup (working note in `specs/README.md`).

1. **Solo seller.** Sign in as the sandbox seller, open `/admin/new/services-team`, choose "Just me", create "Walk Crew Solo" at `walk-crew-solo`. Check the database: `services_team_settings` has `solo = true`, `team_cut_bps = 10000`, `management_fee_bps = 0`, `settings_saved_at` null; `team.support_email` is the creator's email.
2. **Checklist and nav.** The dashboard shows "Create your seller page", "Add your first service" (not done), "Connect PayPal", "Link Discord" — and no "Set your rates" or "Add payout credentials". The nav has no Members link and no Payouts card.
3. **Catalog.** Add a department "Brand" and two services: "Logo design" ($150–$400, 2–5 days, two questions, in Brand) and "Business cards" ($60 fixed, 1–2 days, no questions, no department). Refuse a duplicate name ("logo design") and a range the wrong way round, and check the messages. The checklist's "Add your first service" is done. Hide "Business cards" and check it is marked Hidden.
4. **Bio and settings.** Save a bio of 300 characters and check the refusal; save a short one and see it stored. The settings page shows no cut, fee, quoting or payout fields for this seller.
5. **Solo quoting.** Start a project "Solo quote check" for a client email, picking "Logo design"; check `project.offering_id` and `source = 'admin'` in the database. Add a quote ($200, 3 days) **without assigning anyone** and check it succeeds with `quote.freelancer_id` = the owner. Repeat on the existing team seller ("Walk Through") and check the refusal "Assign a freelancer first; in this team the assigned freelancer quotes." still appears.
6. **Plan fee.** On the solo project, accept the quote from the client page and start the deposit from the pay page (no popup needed to create the order): `payment.platform_fee_minor` is 2% of the amount (Solo). On the team seller's project the same step gives 1% (Team). Do not pay either; leave both pending.
7. **Switch to a team.** In the solo seller's settings, click "Switch to a team": the cut and fee fields appear at 15% and 10%, Members comes back in the nav, and the checklist shows "Set your rates" and "Add payout credentials" again. `solo = false` in the database.
8. **Member titles.** On the team seller ("Walk Through"), set a title for a member and check it shows in the list and survives a reload.
9. Record the outcome in this plan; update the sellers design §11 run 3 row (3a done, with the commit) and the §11.1 rows for solo quoting and the pricing copy (done, with the commit).

---

## Outcome

**Merged** into `main` on 2026-10-08 as `444c1f4` (branch `r3a-seller-setup`, 15 commits). The full suite went from 979 tests to 1029, all passing, and `check-types` passes 11/11 on a fresh run. The migration `20261008175143_r3a_seller_setup_and_catalog` only adds tables and columns, and it is applied to the dev database.

**Per-task reviews.** Each task got one combined spec and quality review. Only Task 10 needed fixes (`63b71e4`): the Active checkbox on the edit form did nothing because `updateOffering` has no `active` field, so the form now calls `setOfferingActive` after saving; the list flashed "No services yet" while loading; and a failed load showed "Service not found".

**Deviations from the plan.**
- `services-teams/catalog` is also exported from the core index (Task 3).
- `setServicesOfferingActive` also updates `updatedAt`.
- `updateOffering` looks the offering up before saving, so another team's offering gets `NOT_FOUND` rather than `CONFLICT` (the repository returns `null` for both).
- The web package filter is `-F web`, not `@jendal-workspace/web`.
- Native `<select>` elements use the repo's `SELECT_CLASS`, since the UI package has no select component.

**Final whole-branch review** found what the per-task reviews missed. It was fixed in `51d31de` and `c163b3a` and re-reviewed as ready to merge:
- *Critical:* the project page did not know about solo, so a solo seller could not send a quote from the admin. `project.get` now returns `solo`, and the page passes it to `quoteAuthor` and hides the assignment section.
- *Important:* `addMember` refuses a solo team.
- *Important:* the title field is hidden on workspace-admin rows, which have no member row.
- *Minor:* duplicate-name races now return `CONFLICT` instead of a 500 (the `23505` error is caught); `switchToTeam` clears `settings_saved_at` so the checklist asks the new team to confirm its rates; the days fields refuse decimals; "Add service" is shown to admins only.

The rest is backlog in sellers design §11.1, owned by run 3b.

**Walkthrough (2026-10-08, dev stack over the tunnel, no PayPal popup).** All 8 steps passed.
1. **Solo seller.** "Walk Crew Solo" was created as "Just me". In the database: `solo` true, cut 10000, fee 0, `settings_saved_at` null, `draft`, and the support email is the creator's.
2. **Checklist and nav.** The checklist shows four steps ("Create your seller page", "Add your first service", "Connect PayPal", "Link Discord"). There is no Members link and no Payouts card, and the dashboard says "Selling as: Just me".
3. **Catalog.** Created department "Brand", "Logo design" ($150.00 – $400.00, 2–5 days, two questions, in Brand) and "Business cards" ($60.00 fixed, 1–2 days). A reversed range showed "The top of the range cannot be below its bottom." and "logo design" was refused with "Your team already has a service with this name." The checklist step turned done. Hiding Business cards marked it "Hidden" and took it out of the New project picker.
4. **Bio and settings.** A 300-character bio showed 300/280 and Save was disabled; a short bio was stored trimmed. Settings shows only the bio and the currency, plus the solo note. Saving the currency kept the rates at 10000/0.
5. **Solo quoting.** "Solo quote check" was created with "Logo design": `source` admin and `offering_id` set. A $200 quote went out with no assignment. The quote's freelancer is the owner, the project stays unassigned, and the outbox has no `project.assigned` event. On "Walk Crew" the page still shows the Assignment section and "Assign a freelancer first; in this team the assigned freelancer quotes."
6. **Plan fee.** Orders were created through `payment.payStart` on the pay pages, and nothing was paid:
   - Solo deposit: $100.00, no management fee, platform fee $2.00 (2%).
   - Team deposit: $120.00 including the $20 management fee, platform fee $1.20 (1%).

   Walk Crew Solo has no PayPal connection and merchant IDs are unique per team, so Walk Crew's sandbox merchant ID was moved to Walk Crew Solo for the solo order and then moved back. Both payments are left pending.
7. **Switch to a team.** The cut and fee fields came back at 15% and 10%, and Members and Payouts returned. The checklist has six steps, with "Set your rates" and "Add payout credentials" to do. In the database: `solo` false, 1500/1000, `settings_saved_at` null.
8. **Member titles.** `dev-merchant@example.com` was added to Walk Crew as a freelancer and given the title "Brand designer", which survived a reload and is stored in `services_team_member.title`. The workspace owner's row has no title field.

**Found in the walkthrough** (backlog §11.1):
- A solo seller still sees "Set up your team" and "Team settings".
- A bare `cloudflared tunnel run` loads no ingress rules; use `pnpm tunnel` (dev note).

Mouhamed also asked to rename `admin.payleor.com` to `dash.payleor.com` (backlog, before run 7).

**Left in the dev database:** the two walkthrough projects with pending deposits, the Walk Crew Solo team (now a team, with its catalog), and Dev Merchant as a freelancer on Walk Crew.
