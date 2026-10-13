# Action registry (run A1) and client contacts (run A2): design

**Date:** 2026-10-13. **Status:** revised after the codebase-fit and security reviews of 2026-10-13 (first version approved section by section in brainstorming). Waiting for Mouhamed's review. Run A is split: A1 (registry) Oct 14–15, A2 (client contacts) Oct 16–17.

**Program:** runs A1 and A2 of the agentic surfaces program (`2026-10-13-agentic-surfaces-program.md`). Runs B (API, webhooks, email), C (client's AI plugin), D (agents and analytics) and E (Discord) call this registry.

**Builds on:** services spec §8.1 (shared use cases) and §6.6 (outbox); the use cases in `packages/api/src/use-cases/`.

## 1. Goal

Every services action the demo and the later surfaces need gets one typed definition. The web, the public API, the MCP plugin, Discord and Payleor's agents call the same `perform`, so they accept and refuse the same things and every action is recorded with who did it, for whom and from where (A1). Clients become contacts with verified identities, so "is this person the client of this project" has one safe answer on every surface (A2).

## 2. Decisions

- A registry of action definitions; tRPC procedures become thin wrappers; REST (B), MCP tools (C) and agent tools (D) are generated from it.
- **A1 changes no behavior the web can see:** same procedure names, inputs, outputs, messages and error codes. The existing suite is the regression net.
- **A2 changes the client model** and the views that show the client.
- Use cases keep throwing what they throw today; `perform` converts to `ActionError` at the boundary. Moving use cases to domain errors is after the hackathon.
- Payout actions and payout events move to run B (nothing reads payout events before B, and the demo's payout is the cron's). `seller.get` and `earnings.get` are dropped (no consumer). `offering.search` comes with run C.
- Agents do not exist yet; the agent policy is defined and enforced by tests, and an agent actor is refused until run D.

## 3. Today (checked against the code on 2026-10-13)

- Project use cases take `db` first and then a `ProjectActor` `{ teamId, role, actorId }` (`use-cases/projects.ts:62`); delivery use cases take `(db, files, actor, input)`; `refundClient` takes `({ db, paypal }, actor, input)`; client actions take only `{ projectId, … }` after the router verified the signed link (`routers/project.ts:67`).
- Logic in routers: `project.get` (seven reads, link signing, the fee calculator, `routers/project.ts:141`), `project.clientGet` (`:324`), `project.list` (`:117`) and `project.requestQuote` (honeypot, per-IP limit from `cf-connecting-ip`, both emails, `:268`). **Project visibility (`canSeeProject`) runs only in the router** (`:81-99`, `:117-129`); `deliveryFileUrl` says callers check access first (`projects.ts:602`).
- Permission messages come from the use cases ("Only admins and managers start projects.", `projects.ts:124`) or router helpers (`requireAction`).
- Router zod schemas are abuse caps; the friendly bounds and messages live in core validators and use cases (`projects.ts:127`).
- Use cases throw `TRPCError` (`fail()`, `projects.ts:65`), including `BAD_GATEWAY` for PayPal failures (`client-refunds.ts:256`) and deliberate `INTERNAL_SERVER_ERROR` messages (`routers/project.ts:299`). `ProjectStateError` is an invariant failure (`unit-of-work.ts:76`).
- Only `runInTransaction` (wrapped as `runProjectTransaction`) writes outbox events, with `max(sequence) + 1` under the project's compare-and-set.
- tRPC has no transformer (`apps/web/src/lib/server-api.ts:157`): dates reach the web as ISO strings.

## 4. A1: the registry

### 4.1 Definitions

Location: `packages/api/src/actions/` (`define.ts`, `perform.ts`, `errors.ts`, `actors.ts`, one file per domain). The name avoids `catalog/`, which holds the product catalog.

```ts
export const acceptQuote = defineAction({
  name: "quote.accept",
  kind: "action",                          // or "query"
  summary: "Accept a quote for a project. Creates the deposit payment the client then pays on the pay page.",
  input: z.object({ projectId: z.uuid(), quoteId: z.uuid() }),
  output: z.object({ paymentId: z.uuid(), payPath: z.string() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  agent: "confirm",
  run: ({ deps, actor, scope }, input) => acceptQuoteUseCase(deps.db, scope.project, input),
});
```

- `name`: stable and dotted; REST paths, MCP tool names and agent tool names derive from it.
- `summary`: one plain sentence, including the limits a caller must respect (agents and OpenAPI read it).
- `input`: **abuse caps only, as today.** The friendly bounds and messages stay in the use cases, so the web keeps its messages.
- `output`: describes the **wire format** (dates as ISO strings). It types the result and produces JSON Schema; `perform` does not parse outputs at runtime. A registry test serializes a fixture result through JSON and parses it.
- `scope(input)`: `{ projectId }`, `{ teamId }` or nothing.
- `allow`: grants (§4.4), each with the refusal message the web shows today.
- `agent`: `free`, `confirm` or `never` (§4.6). The default is `confirm`.
- `run({ deps, actor, scope }, input)`: `scope` carries the loaded team, project and the actor's effective role, so use cases get the `ProjectActor` or team record they need without reloading.

### 4.2 `perform`

`perform({ deps, actor, surface, request, team? }, definition, rawInput)`:

1. Parse the input (failures: `invalid` with field details).
2. Load the scope: the project and its team, or the team. When the adapter passes a pre-resolved `team` (from `teamSlug`), it must equal the project's team, otherwise `not_found` (today's behavior for a slug and project of different teams). The role comes from `servicesTeamRoleFor`, which applies the effective role (workspace owners and admins are team admins).
3. Check `allow`: `not_found` when the actor has no relation to the team or project (not a member, not its client); `forbidden` with the grant's message when they have one but the grant fails.
4. Check the agent policy.
5. Run.
6. Write the action log.
7. Return the result or throw `ActionError`.

`surface` is `web`, `api`, `mcp`, `discord`, `slack`, `cron` or `webhook`. `request` carries `requestId` and `ip` (from `cf-connecting-ip`), so rate limits move into use cases. `deps` holds `db`, `files`, `paypal`, `email` (optional, as today: actions that need it answer `unavailable` without it), `now` and `auth` (link signing).

### 4.3 Actors

```ts
type Actor =
  | { kind: "user"; userId: string }            // a signed-in Payleor user
  | { kind: "client_link"; token: ClientLink }  // a verified client link (A1: { projectId }; A2: { projectId, contactId, version })
  | { kind: "anonymous" }                       // the public request form
  | { kind: "system"; job: string };            // cron, PayPal webhooks
```

Later runs add `{ kind: "api_key"; keyId; teamId }` (B: an explicit permission subset, never a client), `{ kind: "agent"; agentId; onBehalfOf }` (D: on behalf of a human `user` or `client_link`, one level only) and `{ kind: "chat_user"; provider; externalId }` (E: an ID Discord authenticated in the interaction).

### 4.4 Grants

| Grant | Passes when |
|---|---|
| `{ grant: "member", permission, message }` | The actor is a user whose effective services-team role passes `canServicesTeam` |
| `{ grant: "client" }` | A1: the actor holds the client link of the scope's project and is not a member of its team. A2 replaces this with §5.4 |
| `{ grant: "signed_in" }` | Any user; the use case decides (for example a payout request, where the money owed is the authorization) |
| `{ grant: "anyone" }` | Always; rate limits apply inside the use case |
| `{ grant: "system" }` | The actor is `system` |

Use cases keep their detailed checks (quoting mode, self-approval, states). **Project visibility moves into the use cases** of `project.get`, `project.list` and `delivery.file_url` (member branch), so no adapter can skip it.

### 4.5 Errors

`ActionError { code, message, details?, trpcCode? }`. `trpcCode` keeps the original tRPC code so the tRPC adapter returns exactly what the web gets today.

| Code | From |
|---|---|
| `invalid` | `BAD_REQUEST`, zod failures, `CatalogValidationError`, `PayoutsWebError` |
| `not_found` | `NOT_FOUND` |
| `forbidden` | `FORBIDDEN`, `UNAUTHORIZED` |
| `conflict` | `CONFLICT`, `ProjectConflictError` |
| `precondition_failed` | `PRECONDITION_FAILED` |
| `rate_limited` | `TOO_MANY_REQUESTS` |
| `unavailable` | `BAD_GATEWAY`, `SERVICE_UNAVAILABLE` (PayPal and other upstreams) |
| `internal` | `INTERNAL_SERVER_ERROR` and `ProjectStateError`. A deliberate message (the use case marks it) is kept; anything else becomes a generic message and the original is logged |

### 4.6 Agent policy

- Queries default to `free`; actions default to `confirm`.
- `project.refund_client` is `never` for agents.
- A registry test fails if any action that creates a payment, completes a project, accepts anything on the client's behalf or moves money is `free`.
- Run D adds proposals. The confirmer is a human principal (`user` or `client_link`) holding the action's grant, never the agent, an API key, or the agent's own `onBehalfOf` through the agent. The confirmation record is written in the same transaction as the action.

### 4.7 Action log

`action_log`:
- **Columns:** `id`, `created_at`, `request_id`, `action`, `surface`, `team_id`, `project_id`, `subject_kind`, `subject_id`, `actor_kind`, `actor_id` (the user ID, or the contact ID for a client link after A2), `on_behalf_of` (JSON), `ip`, `outcome` (`ok` or the error code), `message` (Payleor's message only, never upstream text), `duration_ms`.
- **What is logged:** every action. Queries are logged only from surfaces other than `web`.
- **No inputs:** they are never stored.
- **When it is written:** after the action, best effort. A failed write logs an error. Run D's confirmation records are the durable audit for agent actions.
- **Retention:** the maintenance cron deletes rows older than 180 days (PayPal's dispute window).

### 4.8 Actions in A1

| Domain | Actions | Queries |
|---|---|---|
| Requests | `request.create` (anyone; honeypot, rate limits and emails move from the router into the use case) | |
| Projects | `project.start`, `project.assign`, `project.refund_client` (member `resolve_cases`; agents never) | `project.list`, `project.get`, `project.client_view` |
| Quotes and amendments | `quote.create`, `quote.accept`, `amendment.propose`, `amendment.accept`, `amendment.decline` | |
| Deliveries | `delivery.upload_start`, `delivery.submit`, `delivery.request_changes`, `delivery.accept` | `delivery.file_url` (member or client) |

The tRPC procedures behind these call `perform` and keep their names, inputs and outputs. The router logic of `get`, `clientGet`, `list` and `requestQuote` moves into use cases.

### 4.9 A1 testing

- **Registry:** unique names, summaries, policies (the money test of §4.6), JSON Schema export of every input and output, output fixtures through JSON.
- **`perform`:**
  - each grant against each actor kind
  - `not_found` versus `forbidden`
  - a team slug and project of different teams
  - visibility for an unassigned freelancer
  - error conversion both ways (including `BAD_GATEWAY` and deliberate internal messages)
  - log rows: actions logged, web queries not
- **Regression:** the full suite passes. Any test whose expectation changes is listed in the plan with the reason.

## 5. A2: client contacts

### 5.1 Tables

| Table | Columns | Rules |
|---|---|---|
| `client_contact` | `id`, `team_id`, `name`, `created_at` | A contact belongs to one team |
| `client_identity` | `id`, `contact_id`, `team_id`, `kind` (`email`, `user`, `discord`), `value`, `source` (`typed`, `request`, `migration`, `interaction`, `account`), `verified_at` | Emails lowercased. Unique (`team_id`, `kind`, `value`) **where `verified_at` is not null**: unverified duplicates may exist, a verified identity belongs to one contact |
| `project_client` | `project_id`, `contact_id`, `is_primary`, `link_version`, `added_by_id`, `added_at` | Primary key (`project_id`, `contact_id`). At least one contact per project, exactly one primary |

### 5.2 Verification

- An **email** identity is verified when someone opens a client link that was emailed to that address (the link names the contact). If a verified identity with the same email already exists in the team, the newly verified contact is merged into it.
- A **user** identity is verified by construction (added from a signed-in session).
- A **Discord** identity is verified when that Discord user interacts with Payleor (run E).
- Typed, requested and migrated identities start unverified and give no authority.

### 5.3 Client links

- The token signs `{ projectId, contactId, version }`. It is valid while the contact is attached to the project and the version equals `project_client.link_version`. Removing the contact or reissuing the link invalidates it.
- Links issued before A2 (`{ projectId }` only) are treated as links of the project's primary contact at version 0, so emailed links keep working until the team reissues or removes them.
- The team view no longer returns the client link. Instead, the team gets two actions:
  - **Email the client link** sends it to a contact's email.
  - **Preview as client** shows the client page read-only.

  This closes the path where a member opens the link and acts as the client.

### 5.4 Who is the client of a project

The actor must **not be a member of the project's team** (effective role null). It must also be one of:

- the holder of a valid client link (§5.3);
- a user with a `user` identity on an attached contact;
- a user whose Better Auth email is verified and equals a **verified** email identity of an attached contact;
- (run E) a `chat_user` whose Discord ID is a Discord identity of an attached contact.

### 5.5 Flows

- **`request.create`**
  - Anonymous requests create a new contact with an unverified email identity (source `request`) and email the link. Opening the link verifies it.
  - A signed-in requester (run C) attaches to their verified contact, or creates one.
  - Today's limits stay as they are: per IP, per email per hour, and three open requests per email per team. The three-open count goes through `project_client`.
- **`project.start`**
  - Takes an email and/or a Discord ID and an optional name, and creates a contact with unverified identities (source `typed`).
  - Match-or-create runs under an advisory lock on (team, email), in both this path and `request.create`.
- **`project.client.add` and `project.client.remove`**
  - Add needs the member grant `start_project`. Added identities are unverified.
  - Remove refuses to remove the last contact, and moves primary to another contact when the primary is removed.
  - Both run under the project's row lock and append `project.client_added` and `project.client_removed` events **without bumping the project version**, so concurrent quote or delivery work does not conflict.
- **`project.client_link.reissue`** bumps `link_version` and emails the new link.

### 5.6 Migration

Per project, in one transaction:

1. **Contact by email.** If the project has a client email, reuse the team's contact whose migrated email identity has exactly that lowercased value, or create one.
2. **Contact by Discord ID.** If the project has no email, find the contact by its Discord identity.
3. **Adding the other identity.** Add it only when no other contact already holds it. On a conflict, keep the contacts separate and record the conflict in the migration's output.
4. **Name.** `client_name`, else the email's local part, else "Client".
5. **Link.** Insert a primary `project_client` row with `link_version = 0`.

Then drop `project.client_email`, `client_discord_id`, `client_name` and `project_client_check`. Migrated identities are unverified (source `migration`); opening an old link verifies the primary contact's email.

Tests cover:
- email only
- Discord only
- both
- the same email on two projects
- project 1 with email A, project 2 with Discord D, and project 3 with A and D (no unique violation, no transitive merge)

### 5.7 Views and data

- `project.get` returns the contacts: name, identities, verified or not. It no longer returns `clientEmail`, `clientName` or the client link.
- `project.list` shows the primary contact's name.
- The admin project page gets a Clients section: list, add by email, remove, email the link, preview as client. `project-detail.tsx`, `projects-list.tsx` and `refund-section.tsx` follow.
- `project.created` event data carries the contact IDs and the display name.
- `seedProject` creates a contact.
- `countOpenWebRequests` joins through `project_client`.
- The four new tables join the test truncate list.

### 5.8 A2 testing

- **Client rule:**
  - each path in §5.4
  - a team member holding a link or a matching email is refused
  - unverified identities are refused
- **Client links:**
  - removed contact refused
  - reissued link refused
  - v1 link accepted for the primary contact
- **Abuse case:** an anonymous request with a verified client's email gets a new unverified contact, and the requester gains no authority over the other projects.
- **Migration:** the cases of §5.6.
- **Contacts:** add and remove (last contact refused, primary moved, no version bump).
- **Concurrency:** a match-or-create race.
- **Walkthrough on the tunnel:**
  - a full request, quote, payment, delivery and payout on the web
  - an old project's link still opens
  - an assigned freelancer cannot act through the client page
  - the Clients section works

## 6. Out of scope

Payout actions and payout events (B); REST, webhooks and email delivery (B); MCP and client accounts (C); agents and proposals (D); Discord (E); moving use cases off `TRPCError`; commerce and team admin in the registry.
