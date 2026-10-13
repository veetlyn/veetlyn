# Action and query catalog (run A): design

**Date:** 2026-10-13. **Status:** design approved in brainstorming on 2026-10-13; waiting for Mouhamed's review of this document, then the run A plan.

**Program:** run A of the agentic surfaces program (`2026-10-13-agentic-surfaces-program.md`). Runs B (public API, webhooks, AI sellers), C (client's AI plugin), D (web agents), E (Discord) and F (Slack ops) build on it.

**Builds on:** services spec §8.1 (shared use cases), §6.6 (outbox); the use cases in `packages/api/src/use-cases/`; R5b-1 payouts.

## 1. Goal

Every action and read of the services flow gets one typed definition in a registry. The web, the public API, the MCP plugin, Discord, Slack and Payleor's agents all call the same `perform`, so they accept and refuse the same things. Clients become a real entity, so "is this person a client of this project" has one answer on every surface. Every action is recorded with who did it, for whom, and from where.

## 2. Decisions

- **Registry of action definitions** (approach 1 of three). tRPC procedures for the services flow become thin wrappers; REST (run B), MCP tools (run C) and agent tools (runs D–F) are generated from the registry.
- **Client contacts arrive in this run** and replace `project.client_email`, `client_discord_id` and `client_name`.
- **The generic delivery pipeline** (outbox delivery table, queue, cron catch-up) moves to run B, where webhooks are its first target. This run only writes payout events to the outbox.
- **Use cases keep throwing what they throw today;** `perform` converts to `ActionError` at the boundary. Moving each use case off `TRPCError` is backlog.
- **Agents do not exist yet.** The actor kind and the per-action agent policy are defined; an agent actor is refused until run D adds proposals a person confirms.

## 3. Today (inventory, 2026-10-13)

- Use cases take `db` first, then a `ProjectActor` (`{ teamId, role, actorId }`, `use-cases/projects.ts:62`) for team actions, or only a `projectId` for client actions (the router verifies the signed client link first).
- Significant logic sits in routers: `project.get` (seven reads, link signing, the fee calculator), `project.clientGet` (view mapping, pay links), `project.list` (visibility filter) and `project.requestQuote` (honeypot, per-IP limit, both emails). Services catalog, team settings and members have no use cases at all.
- Use cases throw `TRPCError` (`fail()` in `projects.ts:65`, and directly in payouts, payments, orders, refunds). Domain errors exist in places (`ProjectConflictError`, `PayoutsWebError`, `CatalogValidationError`).
- Router zod schemas are abuse caps only; the real rules live in core validators and use cases.
- Only `runInTransaction` writes outbox events; payout code writes none.

## 4. Registry

### 4.1 Definitions

Location: `packages/api/src/actions/`: `define.ts`, `perform.ts`, `errors.ts`, `actors.ts`, and one file per domain (`requests`, `projects`, `quotes`, `amendments`, `deliveries`, `refunds`, `payouts`, `sellers`). The name avoids `catalog/`, which holds the product catalog.

```ts
export const acceptQuote = defineAction({
  name: "quote.accept",
  kind: "action",                         // or "query"
  summary: "Accept a quote for a project",
  input: z.object({ projectId: z.uuid(), quoteId: z.uuid() }),
  output: z.object({ paymentId: z.uuid(), payPath: z.string() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: ["client"],
  agent: "confirm",
  run: (deps, actor, input) => acceptQuoteUseCase(deps.db, input),
});
```

- `name` is stable and dotted; REST paths, MCP tool names and agent tool names derive from it.
- `summary` is shown to agents and in OpenAPI; one sentence, plain words.
- `input` holds the real bounds (not only abuse caps); use cases keep their friendly messages.
- `scope` names what the authority check loads: a project (and through it the team), a team, a payout request, or nothing.
- `deps` is one object with the ports actions need (`db`, `files`, `paypal`, `email`, `payouts`, `now`, `auth` for link signing), built once per request by each surface.

### 4.2 `perform`

`perform(deps, actor, surface, definition, rawInput)`:

1. Parse the input; failures become `invalid` with field details.
2. Load the scope: the project and team, and the actor's relations to them (team role, client of the project, subject of the payout).
3. Check `allow` (§5.2). Failure is `forbidden`, or `not_found` when the actor may not know the thing exists (same rule as today: a non-member gets NOT_FOUND for a team).
4. Check the agent policy (§5.3).
5. Run the definition.
6. Write the action log (§7.2).
7. Return the output or throw `ActionError`.

### 4.3 Adapters

- **tRPC (this run):** the services procedures listed in §8 call `perform`. They keep their names and inputs (`teamSlug`, client `token`), resolve those to the actor and scope, and convert `ActionError` back to `TRPCError` with the same codes and messages as today, so the web pages and their tests stay as they are.
- **Later runs** generate their adapters from the registry: REST routes and OpenAPI (B), MCP tools (C), agent tools (D–F). Each uses `z.toJSONSchema` (zod 4.5).
- A test checks every definition: unique name, a summary, a policy, and an input and output that export to JSON Schema without errors.

## 5. Actors and authority

### 5.1 Actors and surfaces

```ts
type Actor =
  | { kind: "user"; userId: string }            // a signed-in Payleor user
  | { kind: "client_link"; projectId: string }  // holder of the signed /c/{token} link
  | { kind: "anonymous" }                       // the public request form
  | { kind: "system"; job: string };            // cron, PayPal webhooks
```

Later runs add `{ kind: "api_key"; keyId; teamId }` (B), `{ kind: "agent"; agentId; onBehalfOf: Actor }` (D) and `{ kind: "chat_user"; provider; externalId }` (E). The surface is passed next to the actor: `web`, `api`, `mcp`, `discord`, `slack`, `cron`, `webhook`.

### 5.2 Grants

`allow` lists one or more grants; any one passing is enough.

| Grant | Passes when |
|---|---|
| `{ member: permission }` | The actor is a user whose effective services-team role passes `canServicesTeam` for the scope's team |
| `"client"` | The actor is a client of the scope's project (§6.3) |
| `"self"` | The actor is the subject (their own payout request, their own earnings) |
| `"anyone"` | Always (the request form; rate limits apply inside the use case) |
| `"system"` | The actor is `system` |

Use cases keep their detailed checks: quoting mode, project visibility (`canSeeProject`), self-approval, the payout rules. `allow` is the first gate, not the only one.

### 5.3 Agent policy

Each action declares `agent`: `free` (an agent may run it), `confirm` (an agent may only propose it; a person with the right grant confirms) or `never`. Defaults: queries are `free`; actions that commit the team or the client (quotes, acceptances, deliveries, payout requests) are `confirm`; payout approval is `confirm` and only an admin can confirm it. In this run, an `agent` actor reaching `perform` is refused with `forbidden`.

## 6. Client contacts

### 6.1 Tables

| Table | Columns | Rules |
|---|---|---|
| `client_contact` | `id`, `team_id`, `name`, `created_at` | A contact belongs to one team; a person who hires two teams has two contacts, tied together by their Payleor account |
| `client_identity` | `id`, `contact_id`, `team_id`, `kind` (`email`, `user`, `discord`; `slack` later), `value`, `verified_at` | Unique (`team_id`, `kind`, `value`): one email or Discord ID maps to one contact per team. Emails are stored lowercased |
| `project_client` | `project_id`, `contact_id`, `is_primary`, `added_by_id`, `added_at` | Primary key (`project_id`, `contact_id`). A project keeps at least one contact; exactly one is primary |

### 6.2 Migration

For each project: find the team's contact by the lowercased `client_email`, else by `client_discord_id`, else create one named `client_name` (or the email's local part, or "Client"); add the missing identities; insert a primary `project_client` row. Then drop `project.client_email`, `client_discord_id`, `client_name` and `project_client_check`. The migration runs in one transaction and is checked by a test with projects that have an email only, a Discord ID only, both, and the same email on two projects of one team (one contact).

### 6.3 Who is a client of a project

- The holder of the project's client link (`client_link` actor for that project).
- A user with a `user` identity on one of the project's contacts.
- A user whose verified email (Better Auth `emailVerified`) equals an `email` identity of one of the project's contacts. No linking step is needed when a client signs in later (run C).

### 6.4 Behavior that follows

- Client emails go to every contact of the project with an email identity (today one).
- "Three open requests per email per team" becomes per contact.
- `startProject` takes contacts instead of the loose fields: an email and/or a Discord ID and an optional name, matched or created as in §6.2. The New project form keeps its fields.
- `request.create` matches or creates the contact by the form's email.
- `project.client.add` takes an email, a Discord ID or a user ID (and an optional name); `project.client.remove` refuses to remove the last contact and moves primary to another contact when the primary is removed. Both are allowed for `{ member: "start_project" }` and write `project.client_added` and `project.client_removed` outbox events.
- The admin project page gets a Clients section (list, add by email, remove). Views that showed the client email or name show the primary contact.

## 7. Errors and the action log

### 7.1 `ActionError`

`code` and a user-facing `message`, plus `details` (field errors) for `invalid`.

| Code | From today's errors |
|---|---|
| `invalid` | `BAD_REQUEST`, zod failures, `CatalogValidationError` |
| `not_found` | `NOT_FOUND` |
| `forbidden` | `FORBIDDEN`, `UNAUTHORIZED` (no actor where one is needed) |
| `conflict` | `CONFLICT`, `ProjectConflictError` |
| `precondition_failed` | `PRECONDITION_FAILED`, `ProjectStateError`, `PayoutsWebError` |
| `rate_limited` | `TOO_MANY_REQUESTS` |
| `unavailable` | PayPal or other upstream outages surfaced as such |
| `internal` | Anything else (message replaced by a generic one; the original is logged) |

The tRPC adapter maps back to the original tRPC code, so web behavior does not change.

### 7.2 `action_log`

Columns: `id`, `created_at`, `action`, `team_id`, `project_id`, `actor_kind`, `actor_id`, `on_behalf_of` (JSON, for agents), `surface`, `outcome` (`ok` or the error code), `error_message`, `duration_ms`.

- Every action is logged. Queries are logged only from surfaces other than `web` (API, MCP, agents), so page loads do not flood it.
- Inputs are not stored (they can hold client personal data); the target IDs are enough for an audit. Run B keeps API responses for idempotency in its own table.
- Written after the action, outside its transaction; a failed write is logged as an error and does not fail the action. Run D's confirmations get their own durable records.
- The maintenance cron deletes rows older than 90 days.

## 8. Scope

### 8.1 In the registry

| Domain | Actions | Queries |
|---|---|---|
| Requests | `request.create` (anyone; the honeypot, rate limits and emails move from the router into the use case) | |
| Projects | `project.start`, `project.assign`, `project.client.add`, `project.client.remove` | `project.list`, `project.get` (team view), `project.client_view` (client view), `project.members` |
| Quotes and amendments | `quote.create`, `quote.accept`, `amendment.propose`, `amendment.accept`, `amendment.decline` | |
| Deliveries | `delivery.upload_start`, `delivery.submit`, `delivery.request_changes`, `delivery.accept` | `delivery.file_url` |
| Refunds | `refund.client` | |
| Payouts | `payout.request`, `payout.approve`, `payout.reject`, `payout.retry` | `payout.list` (team), `payout.mine`, `earnings.get` |
| Sellers | | `seller.get` (a published seller's page data and active offerings, for run C) |

The router logic of `project.get`, `project.clientGet`, `project.list` and `project.requestQuote` moves into use cases. Client actions take the `client_link` actor from the verified token, or a `user` actor.

### 8.2 Staying as they are

The pay page and checkout (the payer's PayPal approval is a human web step by design), the commerce store and orders, team settings, members and offering editing, payout rules, payout credentials and the Payouts Web file, PayPal onboarding, Discord linking. They join the registry when a surface needs them.

### 8.3 Payout events

- `outbox` gains `payout_request_id` (nullable). Sequence is per subject: per project for project events (as today), per payout request for payout events, which carry `project_id` null and name the project in `data` when there is one. A unique index on (`payout_request_id`, `sequence`).
- `appendOutboxEvents(tx, subject, events)` is shared by the unit of work and the payout writers.
- `OUTBOX_EVENT_TYPES` gains `project.client_added`, `project.client_removed`, `payout.rejected`, `payout.waiting`, `payout.succeeded`, `payout.exported`.
- The payout writers emit, in their transactions: `payout.requested`; `payout.approved` per approval (with the count so far and the count needed); `payout.rejected`; `payout.queued`; `payout.waiting` when the wait reason is set or changes (not on every retry); `payout.sent`; `payout.succeeded`; `payout.failed`; `payout.exported`.
- Nothing reads them until run B.

## 9. Testing

- **Registry:** unique names, summaries, policies, JSON Schema export of every input and output.
- **`perform`:** each grant against each actor kind; the client rule through the link, a `user` identity and a verified email (and an unverified email refused); agent actors refused; error conversion both ways; log rows for actions and none for web queries.
- **Regression:** the existing suite (1571 tests at `2f2cb35`). The services routers keep their names and inputs, so their tests should pass with few edits; any behavior change in a test is explained in the plan.
- **Contacts:** the migration cases of §6.2; `startProject` and `request.create` matching contacts; per-contact request limit; add and remove (last contact refused, primary moved).
- **Payout events:** each writer emits its event in the same transaction with the right per-subject sequence.
- **Walkthrough** in dev over the tunnel: a full request → quote → payment → delivery → payout on the web, unchanged; `action_log` rows appear; adding and removing a client contact on the admin project page; an old project still opens through its client link after the migration.

## 10. Out of scope

REST and webhooks (B), MCP and client accounts (C), agents and proposals (D), Discord and Slack adapters (E, F), the delivery pipeline (B), moving use cases off `TRPCError`, moving commerce and team admin into the registry.
