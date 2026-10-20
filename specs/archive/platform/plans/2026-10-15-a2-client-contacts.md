# A2 Client Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project's client becomes one or more contacts with verified identities (email, user, Discord) instead of three columns on the project row, with revocable client links tied to a contact, the client rule (a team member is never the client), and a safe migration of existing projects.

**Architecture:** One migration adds `client_contact`, `client_identity` and `project_client`; a second drops `project.client_email`, `client_name`, `client_discord_id` and the check constraint after a backfill script moves every existing project onto contacts. Client links gain a v2 format signing `{ projectId, contactId, version }`; v1 links keep working as the primary contact at version 0. A new `resolveClient` implements the client rule (design §5.4) for every client-facing procedure. New use cases and registry actions manage contacts, reissue links and email them; the team project view stops handing out the client link and gains "Email the client link" and "Preview as client".

**Tech Stack:** TypeScript (pnpm, turbo), Drizzle on Postgres, tRPC 11, zod 4.5, Vitest with a real test database.

**Spec:** [`../2026-10-13-action-catalog-design.md`](../../../platform/2026-10-13-action-catalog-design.md) §5 (A2). Program: [`../2026-10-13-agentic-surfaces-program.md`](../../../platform/2026-10-13-agentic-surfaces-program.md) §4. Builds on A1 (merged `4a27fb6`); run C (`2026-10-15-c-plugin-design.md`) consumes the client identity for the plugin.

**Base:** main at `f41c961`. Branch `a2-client-contacts`, worktree `worktrees/a2-client-contacts`, own test database `jendal_test_a2` (`docker exec jendal-pg createdb -U postgres jendal_test_a2`; copy `.env.test.local` into the worktree and point `TEST_DATABASE_URL` at it). Every worker uses only that database, never the dev database, and never pushes to main.

**Conventions:** Conventional Commits ending with `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`. Tests first at the owner boundary, following the test-audit gate (each test names a credible regression; strongest boundary; no duplicate proof). Checks per task: `npx vitest run <paths>`; before each commit `pnpm check-types` and `pnpm lint` (0 findings; zod at boundaries; no `typeof`; `SAFETY:` on assertions; `fromPartial` for fakes). Never edit while Vitest runs. Comments only for non-obvious reasons; never mention runs, tasks or plans in code.

---

## Facts the tasks rely on (main at `f41c961`)

- **Client columns today:** `packages/db/src/schema/projects.ts` — `clientEmail` `:42`, `clientName` `:44`, `clientDiscordId` `:47`, check `project_client_check` `:68` (`client_email is not null or client_discord_id is not null`).
- **Links:** `packages/api/src/client-links.ts` — `signClientLink(secret, projectId)` `:52`, `verifyClientLink` `:56`, `linkSecret(auth)` `:72`; tokens are `{id}.{base64url(hmac)}`, derived per-label keys, constant-time verify. Tests at `client-links.test.ts`.
- **Client procedures (post-A1):** `packages/api/src/actions/trpc.ts` — `projectIdFromToken` `:81-85` (NOT_FOUND "This link is not valid."), `clientProcedureFor` `:88-104` builds the actor `{ kind: "client_link", token: { projectId } }`. Team procedures resolve the effective role via `servicesTeamRoleFor` (`packages/db/src/repositories/services-teams.ts:154`).
- **Request flow:** `packages/api/src/use-cases/requests.ts` — `requestQuote` spends the per-email limit and writes the project (`:31` onward; `countOpenWebRequests` at `:73`); `createQuoteRequest` `:120` does honeypot, per-IP limit, signs the link `:137` and emails it (`{siteOrigin}/c/{token}` `:138`).
- **Views:** `packages/api/src/use-cases/project-views.ts` — `listTeamProjects` maps `clientEmail`/`clientDiscordId` (`:60-77`); `getTeamProjectView` signs and returns `clientPath` (`:98`, `:107`). `project.get`/`project.client_view` are web-only queries (A1).
- **Unit of work:** `packages/db/src/repositories/unit-of-work.ts` — `apply` always bumps `version` (`:48-56`) and appends outbox events with a per-project sequence (`:58-68`); `runInTransaction` throws `ProjectStateError` when nothing was applied (`:71`).
- **Repos:** `countOpenWebRequests` (`packages/db/src/repositories/projects.ts:33`, counts `source: "web"`, open statuses, per team+email — test at `projects.test.ts:14-33`). `seedProject` (`packages/db/src/testing/db.ts:204`) writes the client columns.
- **Web:** admin project page `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx`, list `projects-list.tsx`, refund `refund-section.tsx`, new-project form `new-project-form.tsx` — all read the client fields.
- **Emails:** `packages/email/src/templates.ts` — `quoteRequestLinkEmail({ clientName, teamName, url })`; templates take plain strings and do not read the schema.
- **Migrations:** `pnpm db:generate`; latest is `20261014003246_a1_action_log`. `truncateAll` list: `packages/db/src/testing/db.ts:23`.
- **Outbox events:** `OutboxEventType` in `packages/core`; `project.created` data today carries `clientEmail`/`clientDiscordId` (`requests.ts:107`).

## Decisions for this run

- **Two migrations with a script between.** Migration 1 adds the three tables (old columns stay, so the branch keeps working while code moves). Code switches fully to contacts. A backfill script (`scripts/a2-backfill-contacts.ts`, a bun script taking `DATABASE_URL`) migrates dev data per design §5.6 and prints conflicts. Migration 2 drops the columns and the check. The backfill logic is a tested function over legacy field values (it only writes the new tables, so its tests run after the drop).
- **Token v2 format:** `{projectId}.{contactId}.{version}.{sig}` where `sig` signs the first three segments joined by `.`. A token with one dot is v1 (`{projectId}.{sig}`) and resolves to the project's primary contact when its `link_version` is 0. Resolution is a repository function `resolveClientLink(db, secret, token)` so the validity check (attached, version equal) lives next to the data.
- **Verification happens at link resolution** (design §5.2): resolving a link whose contact has an unverified email identity marks it verified in the same transaction; if another contact in the team already holds that verified email, the contacts merge (the resolving contact's `project_client` rows move, then it is deleted).
- **Events without a version bump:** the unit of work gains `appendEvents(ref, events)` — it takes the project row lock (`select ... for update`) and writes outbox rows without touching `version`. Client add/remove use it (design §5.5).
- **`request.create` stays anonymous-only in A2.** The signed-in attach path is run C (its plan Task 6). A2 builds the contact it needs: the anonymous request creates the contact with an unverified email identity (source `request`).
- **Design §5.7 says "four new tables" join the truncate list; §5.1 defines three** (`client_contact`, `client_identity`, `project_client`). Add the three.

## File map

- Create `packages/db/src/schema/contacts.ts`: the three tables. Modify `packages/db/src/schema/index.ts` (export), `packages/db/src/testing/db.ts` (truncate list in Task 1; `seedProject` creates a contact in Task 10).
- Create `packages/db/src/repositories/contacts.ts` (+ test): `matchOrCreateContact`, `attachContact`, `detachContact`, `listProjectContacts`, `reissueClientLink`, `verifyContactEmail`, `mergeContacts`, `resolveClientLink`, `countOpenRequestsForEmail` (replaces `countOpenWebRequests`).
- Modify `packages/db/src/repositories/unit-of-work.ts` (+ test): `appendEvents`.
- Modify `packages/api/src/client-links.ts` (+ test): v2 sign/verify next to v1.
- Create `packages/api/src/use-cases/clients.ts` (+ test): `resolveClient` (the §5.4 rule), `addProjectClient`, `removeProjectClient`, `emailClientLink`, `previewAsClient` glue; modify `use-cases/requests.ts` (contact on request) and `use-cases/projects.ts` (`createProject` takes email/Discord/name → contact).
- Create `packages/api/src/actions/clients.ts`: `project.client.add`, `project.client.remove`, `project.client_link.email`, `project.client_link.reissue`, `project.client_preview`. Modify `packages/api/src/actions/registry.ts` and `actions/trpc.ts` (`clientProcedureFor` uses `resolveClient`).
- Modify `packages/api/src/use-cases/project-views.ts`: contacts in `project.get`, primary contact name in `project.list`, no `clientPath` in the team view.
- Modify `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx` (Clients section, drop the link display), `projects-list.tsx`, `refund-section.tsx`, `new/new-project-form.tsx`.
- Create `packages/api/src/migrations/backfill-contacts.ts` (+ test): the §5.6 mapping as a function; `scripts/a2-backfill-contacts.ts` runs it over the legacy rows.
- Migration 2 drops the columns.

---

### Task 1: Contact tables

**Files:**
- Create: `packages/db/src/schema/contacts.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/testing/db.ts`

- [ ] **Step 1: Write the schema**

```ts
// packages/db/src/schema/contacts.ts
import { index, pgTable, primaryKey, text, timestamp, uniqueIndex, boolean, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { project, team, user } from "./index";

export const clientContact = pgTable(
  "client_contact",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull().references(() => team.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("client_contact_teamId_idx").on(t.teamId)],
);

export const clientIdentity = pgTable(
  "client_identity",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    contactId: text("contact_id").notNull().references(() => clientContact.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["email", "user", "discord"] }).notNull(),
    value: text("value").notNull(), // emails lowercased
    source: text("source", { enum: ["typed", "request", "migration", "interaction", "account"] }).notNull(),
    verifiedAt: timestamp("verified_at"),
  },
  (t) => [
    index("client_identity_contact_idx").on(t.contactId),
    // A verified identity belongs to one contact; unverified duplicates may exist (design §5.1).
    uniqueIndex("client_identity_verified_unique").on(t.teamId, t.kind, t.value).where(sql`${t.verifiedAt} is not null`),
  ],
);

export const projectClient = pgTable(
  "project_client",
  {
    projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => clientContact.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    linkVersion: integer("link_version").notNull().default(1),
    addedById: text("added_by_id").references(() => user.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.contactId] }), index("project_client_contact_idx").on(t.contactId)],
);
```

Note: `link_version` defaults to 1 for new contacts; the backfill sets 0 for migrated primaries so v1 links keep working (design §5.3). Export all three from `schema/index.ts`; add `"client_identity"`, `"project_client"`, `"client_contact"` to `truncateAll` (`testing/db.ts:23`, identity and project_client before contact).

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm db:generate && pnpm db:migrate:dev`
Expected: one migration adding the three tables; the old client columns untouched.

- [ ] **Step 3: `pnpm check-types && pnpm lint`; commit** `feat(db): client contact, identity and project_client tables`.

### Task 2: `appendEvents` on the unit of work

**Files:**
- Modify: `packages/db/src/repositories/unit-of-work.ts`
- Test: `packages/db/src/repositories/unit-of-work.test.ts`

- [ ] **Step 1: Failing test:** `appendEvents(ref, events)` writes outbox rows with the next per-project sequences and leaves `project.version` unchanged; a quote applied right after sees the same version (no conflict).

- [ ] **Step 2–4:** fail; implement —

```ts
// In UnitOfWork:
appendEvents(ref: ProjectRef, events: readonly OutboxEventInput[]): Promise<void>;
// Implementation: SELECT id FROM project WHERE id = ref.id FOR UPDATE (throws ProjectStateError when
// the row is gone), then the same sequence-then-insert loop apply uses, without the version update.
// Count it toward `applied` so a transaction of only appended events is legal.
```

pass.

- [ ] **Step 5:** checks; commit `feat(db): appendEvents without a version bump`.

### Task 3: Link v2 and `resolveClientLink`

**Files:**
- Modify: `packages/api/src/client-links.ts`, `packages/api/src/client-links.test.ts`
- Create: `packages/db/src/repositories/contacts.ts` (first function), `packages/db/src/repositories/contacts.test.ts`

- [ ] **Step 1: Failing tests (`client-links.test.ts`):** v2 round-trips `{ projectId, contactId, version }`; a tampered segment fails; v1 tokens still verify as `{ projectId }` only; a pay link is never a client link (existing case stays green).

```ts
export type ClientLinkTarget = { projectId: string; contactId: string; version: number };
export async function signClientLink(secret: string, target: ClientLinkTarget): Promise<string> {
  const payload = `${target.projectId}.${target.contactId}.${target.version}`;
  const key = await linkKey(secret, CLIENT_LINK_LABEL);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${base64url(signature)}`;
}
// verifyClientLink(secret, token): 4 segments -> ClientLinkTarget; 2 segments -> { projectId } (v1); else null.
```

- [ ] **Step 2–4:** fail; implement; pass. Keep the old single-id signing as an internal helper the backfill test uses; `signClientLink`'s public shape changes, so update every caller in this task: the test helpers (`routers/project.test.ts:82`, `routers/payment.test.ts`, `use-cases/paypal-webhooks.test.ts`), `routers/payment.ts:42` (sign v2 for the payment project's primary contact — a `primaryContactFor(tx, projectId)` read in `contacts.ts`), `actions/projects.ts:40` and `project-views.ts:98` (both sign for the primary contact; Task 8 removes the team-facing link entirely).

- [ ] **Step 5: Failing test (`contacts.test.ts`) — `resolveClientLink`:** a v2 token for an attached contact at the current version resolves; a removed contact, a reissued (bumped) version and a foreign project all return null; a v1 token resolves to the primary contact while its `link_version` is 0 and stops resolving after a reissue.

- [ ] **Step 6–8:** fail; implement in `packages/db/src/repositories/contacts.ts` (verify the token, load the `project_client` row, check attachment and version; v1 → primary contact with `link_version = 0`); pass.

- [ ] **Step 9:** checks; commit `feat(api,db): client link v2 with revocation and the v1 fallback`.

### Task 4: `resolveClient` — the client rule

**Files:**
- Create: `packages/api/src/use-cases/clients.ts`, `packages/api/src/use-cases/clients.test.ts`
- Modify: `packages/api/src/actions/trpc.ts`

- [ ] **Step 1: Failing tests (design §5.4/§5.8, real database):**
  - link holder resolves to `{ kind: "client_link", contactId, projectId }`;
  - a signed-in user with a `user` identity on an attached contact resolves (`{ kind: "user", ... }` with the contact);
  - a signed-in user whose verified Better Auth email equals an attached contact's **verified** email identity resolves;
  - an unverified email match is refused;
  - a team member holding a valid link is refused (`FORBIDDEN` "Team members act from the project page.");
  - a member whose email matches a verified identity is refused the same way;
  - a stranger with no link and no identity is refused.

```ts
export type ClientResolution =
  | { ok: true; actor: Actor; contactId: string }
  | { ok: false; reason: "invalid_link" | "not_a_client" | "team_member" };
export async function resolveClient(
  db: Database,
  secret: string,
  projectId: string,
  holder: { token?: string; userId?: string },
): Promise<ClientResolution> {
  // effective role via servicesTeamRoleFor: any role -> team_member
  // token -> resolveClientLink; user -> user identity, then verified-email match
}
```

- [ ] **Step 2–4:** fail; implement; pass.

- [ ] **Step 5: Wire `clientProcedureFor`** (`actions/trpc.ts:88-104`): resolve the token to `{ projectId, contactId }` via `resolveClientLink` (keeping NOT_FOUND "This link is not valid."), then refuse when `servicesTeamRoleFor` returns a role for the session user (a member pasting a client link gets FORBIDDEN). The session reaches the client page when C adds signed-in client access; for now the token path carries the rule.

- [ ] **Step 6:** checks; commit `feat(api): the client rule — members never act as the client`.

### Task 5: Verification on link open, with merge

**Files:**
- Modify: `packages/db/src/repositories/contacts.ts` (+ test)

- [ ] **Step 1: Failing tests:** resolving a link marks the contact's unverified `email` identity verified (`verified_at` set, source kept); when another contact in the team already holds that verified email, the resolving contact merges into it (its `project_client` rows move unless already present, its identities move, the empty contact is deleted, resolution returns the surviving contact); the abuse case — an anonymous request carrying a verified client's email creates a new unverified contact and gains no authority over that client's projects.

- [ ] **Step 2–4:** fail; implement `verifyContactEmail(tx, contact)` + `mergeContacts(tx, fromId, intoId)` and call them from `resolveClientLink` (it becomes transactional); pass.

- [ ] **Step 5:** checks; commit `feat(db): email verification and contact merge at link open`.

### Task 6: Contacts in `request.create` and the open-request count

**Files:**
- Modify: `packages/api/src/use-cases/requests.ts`, `packages/db/src/repositories/contacts.ts`, `packages/db/src/repositories/projects.ts`
- Test: `packages/api/src/use-cases/requests.test.ts` (or the router test where requestQuote lives today), `packages/db/src/repositories/contacts.test.ts`

- [ ] **Step 1: Failing tests:** an anonymous request creates a contact named from the form (email local part fallback) with an unverified email identity (source `request`), attaches it as primary with `link_version` 1, and emails a v2 link; the three-open limit counts through `project_client` + the contact's email identities (port the `countOpenWebRequests` cases from `projects.test.ts:14-33`: two open + completed + cancelled + admin + other email + other team = 2); `project.created` event data carries the contact id and display name instead of the client columns.

- [ ] **Step 2–4:** fail; implement `matchOrCreateContact(tx, { teamId, email, name, source })` —

```ts
// Advisory lock serializes match-or-create per (team, email) (design §5.5).
await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${teamId + ":" + email}))`);
// Reuse the team's contact whose email identity (any verification state) matches, else create.
```

`countOpenRequestsForEmail(tx, { teamId, email })` joins `project_client → client_contact → client_identity`; `requestQuote` uses both and writes no client columns; pass.

- [ ] **Step 5:** checks; commit `feat(api): requests create contacts; open count through project_client`.

### Task 7: `project.start` and client add/remove/reissue

**Files:**
- Modify: `packages/api/src/use-cases/clients.ts`, `packages/api/src/use-cases/projects.ts` (`createProject`)
- Test: `packages/api/src/use-cases/clients.test.ts`

- [ ] **Step 1: Failing tests:** `createProject` with an email and/or Discord id and a name match-or-creates the contact (source `typed`, unverified, advisory lock) and attaches it primary; add by email attaches a new unverified contact and appends `project.client_added` **without bumping the version** (a concurrent quote apply does not conflict); remove refuses the last contact, moves primary when the primary is removed, appends `project.client_removed`; reissue bumps `link_version` (old tokens die) and emails the new link; add requires the start-project permission — the use case refuses freelancers with the same check as `createProject` ("Only admins and managers start projects."), the action carries the plain `member` grant (A1's coarse-grant decision).

- [ ] **Step 2–4:** fail; implement in `use-cases/clients.ts` (`addProjectClient`, `removeProjectClient`, `reissueClientLink` — row lock + `appendEvents`; `emailClientLink` sends through `EmailServices` with the v2 token); `createProject` routes its client fields through `matchOrCreateContact`; pass.

- [ ] **Step 5:** checks; commit `feat(api): project contacts — add, remove, reissue, email the link`.

### Task 8: Registry actions and views

**Files:**
- Create: `packages/api/src/actions/clients.ts`
- Modify: `packages/api/src/actions/registry.ts`, `packages/api/src/use-cases/project-views.ts`, `packages/api/src/actions/projects.ts`
- Test: `packages/api/src/actions/registry.test.ts` (extend), `packages/api/src/actions/clients.test.ts`

- [ ] **Step 1: Failing tests:** the four new definitions register with names, summaries and grants; `project.client.add/remove/link.email/link.reissue` are member-granted actions (`agent: "confirm"`) scoped to the project; `project.client_preview` is a member-granted web-only query returning the client view without a token; the team `project.get` output carries `contacts: [{ id, name, identities: [{ kind, value, verified }] }]` and no `clientPath`; `project.list` rows carry `clientName` (the primary contact's name) and no email.

- [ ] **Step 2–4:** fail; implement the definitions and rewire `getTeamProjectView` (drop `signClientLink`/`clientPath` at `project-views.ts:98,107`; load contacts), `listTeamProjects` (join primary contact), and `actions/projects.ts:40`; pass.

- [ ] **Step 5:** checks; commit `feat(api): client contact actions; team views stop handing out the client link`.

### Task 9: Web — Clients section and the follow-ups

**Files:**
- Modify: `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/project-detail.tsx`, `apps/web/src/app/admin/[storeSlug]/projects/projects-list.tsx`, `apps/web/src/app/admin/[storeSlug]/projects/[projectId]/refund-section.tsx`, `apps/web/src/app/admin/[storeSlug]/projects/new/new-project-form.tsx`

- [ ] **Step 1:** the admin project page gains a **Clients** section: the contacts with their identities and verified badges, an add-by-email form, a remove button (confirm), "Email link" per contact with an email identity, "Reissue link" (confirm; warns old links die), and "Preview as client" rendering the client view read-only (action buttons disabled) from `project.client_preview`. The old "client link" display goes away.
- [ ] **Step 2:** `projects-list.tsx` shows the primary contact's name; `refund-section.tsx` reads the primary contact; the new-project form keeps its inputs (email/Discord/name) and needs no shape change beyond the response.
- [ ] **Step 3:** `pnpm check-types && pnpm lint`; manual smoke on the dev stack; commit `feat(web): Clients section on the project page`.

### Task 10: Backfill and the drop migration

**Files:**
- Create: `packages/api/src/migrations/backfill-contacts.ts`, `packages/api/src/migrations/backfill-contacts.test.ts`, `scripts/a2-backfill-contacts.ts`

- [ ] **Step 1: Failing tests for the mapping (design §5.6):** the function takes legacy field values `{ projectId, teamId, clientEmail, clientDiscordId, clientName }` and, in one transaction: email → reuse the team contact with that migrated email or create one; no email → find by Discord identity; the other identity is added only when no other contact holds it (conflict recorded in the return value); name from `clientName`, else the email local part, else "Client"; a primary `project_client` row with `link_version = 0`; identities unverified, source `migration`. Cases: email only; Discord only; both; same email on two projects (one contact, two projects); project 1 email A, project 2 Discord D, project 3 A+D (no unique violation, no transitive merge; conflict recorded).

- [ ] **Step 2–4:** fail; implement; pass.

- [ ] **Step 5: The script and the drop**

`scripts/a2-backfill-contacts.ts` selects the legacy columns from projects that have no `project_client` row, runs the mapping per project in its own transaction, and prints a summary with conflicts. Run it on the dev database, read the summary, then `pnpm db:generate` for the migration dropping `client_email`, `client_name`, `client_discord_id` and `project_client_check`; `pnpm db:migrate:dev`; remove the columns from the schema and every remaining reference (`grep -rn "clientEmail\|client_email\|clientName\|clientDiscordId" packages apps` finds none outside migrations and this plan). Update `seedProject` (`packages/db/src/testing/db.ts:204`) to create a contact with the seeded email/name and a primary `project_client` row (`link_version` 1) instead of the client columns. Delete `countOpenWebRequests` (`repositories/projects.ts:33`) and its test — Task 6's `countOpenRequestsForEmail` replaced it.

- [ ] **Step 6:** `pnpm test` green on the worktree's test database; commit `feat(db): backfill projects onto contacts; drop the client columns`.

### Task 11: Walkthrough on the tunnel

**Files:** this plan's Outcome; story statuses in `specs/stories/`.

- [ ] **Step 1:** stories AGT-01–AGT-06, on the dev stack over the tunnel: a full request → quote → payment → delivery → payout on the web (the R-flow walkthrough), an old (pre-A2) project's emailed link still opens its client page, a freelancer signed in to the team cannot act through that client page, and the Clients section adds, emails, reissues (old link dies) and removes.
- [ ] **Step 2:** record the results here, update story statuses and `PROGRESS.md`, then open the PR.

## Build notes

Built Tasks 1 to 10 on branch `a2-client-contacts` (Claude Code, 2026-10-16). Task 11 is pending on Mouhamed's machine.

**Deviations from the plan**

- **Security review 2026-10-16: a pay link no longer mints a client link.** `payment.payGet` returned `clientPath`, so anyone holding a (forwarded) pay link got the client's powers, and after a reissue an old pay link would keep minting valid links. `clientPath` is gone from `payGet` and the pay page; the page shows "Back to your project" only when `document.referrer` is a same-origin `/c/` URL (`clientPageReferrer` in `apps/web/src/lib/pay-page.ts`). Test: `routers/payment.test.ts` "never hands a client link to a pay link holder".
- **Security review 2026-10-16: verification and revocation in `contacts.ts`.** Findings and fixes, each with a test in `use-cases/clients.test.ts`:
  1. *Identity-verification bypass.* Opening any valid link verified every unverified email of the contact and could merge it into another contact. Now a link proves only the address the server emailed that link version to (`project_client.link_email`, set by the request form, "Email link" and "Reissue"). Links never emailed (the team could have seen them), legacy v1 links (shown in the old team view and pay page) and versions emailed to two different addresses (`link_emailed_at` kept, address cleared) prove nothing. A merge happens only through that proved address, and a team member is refused before any verification (design §5.4).
  2. *Link-revocation bypass.* The first version of the merge kept the merged contact as an alias at contact level (`merged_into_id`), so a contact removed from a project, later merged into a contact still on that project, had its old links working again. Merged contacts are now deleted; a moved `project_client` row keeps the merged contact id in `link_aliases` for that project and version only; a reissue clears the aliases and the address. Resolution locks the `project_client` row (`for update`) and checks the contact belongs to the project's team.
  3. *Rest of `contacts.ts`.* Match-or-create, verification and the open-request count share one advisory lock per (team, email) and (team, `discord:{id}`); emails are lowercased once at match-or-create, in the count and in the user lookup; every contact lookup is scoped to the team or the project's team. A race test covers match-or-create.
- **Design §5.6 said opening an old link verifies the primary's email.** Superseded by finding 1: old links keep working (v1 resolves to the primary at `link_version` 0) but verify nothing; the team emails a new link to verify.
- **`resolveClientLink` lives in the api, not `db/repositories/contacts.ts`**: the db package cannot verify signatures. The db side is `findLinkedContact(tx, claim)`; the api's `resolveClient` (the §5.4 rule) verifies, resolves and verifies the email in one transaction.
- **`request.create` never joins an anonymous request to a contact whose matching email is verified** (abuse case §5.8); it reuses an unverified one or creates one. `project.start` and `project.client.add` (typed by the team) reuse any.
- **Extra events:** `project.client_link_reissued` and `project.client_link_sent` (contact id and version, never the address), both appended without a version bump.
- **All four client actions require admin or manager** in the use case ("Only admins and managers change a project's clients."), not only add.
- **`project.start` no longer returns `clientPath`**; the new-project form gained a client name field.
- **Preview as client** renders the real client page component (`components/client-project-view.tsx`, extracted from `client-project.tsx`) with every action disabled; pay links are stripped (`payPath: null`) and a new `payable` flag drives the disabled "Pay" button.
- **The client columns are not dropped yet.** drizzle applies all pending migrations in one transaction, so a drop migration merged with the backfill script between would drop the columns on the dev database before the script could run. Instead the one A2 migration (`20261016135146_a2_client_contacts`) adds the tables and drops `project_client_check`; nothing writes or returns the columns; only `backfillLegacyProjects` reads them. A follow-up migration drops `client_email`, `client_name` and `client_discord_id` once the backfill has run on dev (and on any deployed database).
- **Migrations were not applied to the dev database** and the backfill script was not run anywhere (instructions); the test database was migrated by the test setup.
- Commit trailer `Co-Authored-By: Claude Opus 5.5` (instructions), not the factory-droid line.

**For the walkthrough (Task 11)**

1. After merging: `pnpm db:migrate:dev`, then `DATABASE_URL=<dev> bun scripts/a2-backfill-contacts.ts` and read the summary (conflicts listed).
2. AGT-01–06 as planned: an old project's emailed link opens its client page; a signed-in freelancer gets "Team members act from the project page." on that link; the Clients section adds, emails, reissues (old link dies) and removes; Preview as client shows the page with disabled buttons; the pay page shows "Back to your project" only when reached from the client page.
3. Then write the follow-up migration that drops the three columns.

## Outcome

Walked by Claude Code on 2026-10-16, on the dev stack over the tunnel (branch before merge, `admin.payleor.com` / `payleor.com` / `walk-crew.payleor.app`).

- **Migration and backfill:** `pnpm db:migrate:dev`, then the backfill on the dev database: 12 projects moved, 6 contacts created, no conflicts.
- **AGT-01 passes.** The Clients section lists each contact, with each email marked verified or not; the page has no client link. Second Client (`tester+client2@example.com`) was added unverified. Removing the primary made Second Client primary, and the last contact has no Remove button. The projects list shows each project's primary contact name.
- **AGT-02 passes.** "Email link" sent Second Client their own link. Opening it signed out showed the client page and marked the email Verified. After "Reissue link" (with a confirmation), the old link shows "This link is not valid" and the new one from the new email works.
- **AGT-03 passes.** "Preview as client" shows the client view with "Pay with PayPal" disabled and no client link anywhere in the page.
- **AGT-04 failed, then fixed (`4b39838`).** Signed in as the walk-crew admin, I opened a client link emailed to the admin's own address and pressed "Accept quote": the quote was accepted. The client page runs on `payleor.com`, where the dashboard's host-only session cookie never arrives, so the member looked signed out and the §5.4 check (which needed a session) never ran. Resolution now refuses a link whose contact names a team member's account (by user identity, or by an email equal to a member's account email, verified or not) before verifying anything. The refusal goes to the action log, and the page shows "This link is for the client" with "Team members act from the project page." Re-walked: the admin's links (the new one and a pre-A2 one) are refused; other clients' links still work. Tests: `use-cases/clients.test.ts` "refuses a link whose contact has a team member's address, without a session" and `routers/project.test.ts` "logs a team member's refused client action", both seen failing before the fix.
- **AGT-05 passes.** An anonymous request on `walk-crew.payleor.app/request` with Second Client's verified email created a new contact "Not Second Client" with an unverified email; the link went only to that address; the verified contact is untouched.
- **AGT-06 passes, as amended by finding 1.** A link emailed on Oct 15 (before A2) opens its client page and acts for the primary contact; it verifies no email (the team emails a new link to verify).
- **Pay page:** reached from the client page it shows "Back to your project"; opened directly it does not, and the PayPal buttons load.
- **R-flow money path (`dc2ab7ca`), pass:** Mouhamed paid the $120 deposit (50% of the quote plus the 10% management fee) as sandbox buyer 2 from the client page; the team submitted a delivery and the client accepted it through the link; the $100 balance was paid the same way and the project closed as `completed`. Both payments are `captured` with PayPal capture ids, platform and PayPal fees recorded. The captures land in the seller's PayPal account directly, so no separate payout step runs for a single-seller project.

Data the walk left on dev: "Something else" (`5f0fc392`) has a quote accepted by the admin-as-client before the fix (awaiting deposit); a request from "Not Second Client".
