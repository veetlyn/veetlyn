# Run B1: the operating model, notices and the engine — design

**Date:** 2026-10-21. **Status:** sections approved by Mouhamed one by one on 2026-10-21; written design awaiting his review.

**Program:** run B of the agentic surfaces program ([`2026-10-13-agentic-surfaces-program.md`](2026-10-13-agentic-surfaces-program.md) §4), split on 2026-10-21 into **B1** (this design: notices and rules) and **B2** (API keys, Standard Webhooks, seller tools on MCP and the API on par, the API skill, AI seller support). B1 starts Oct 21, after the prep run below; B2 follows.

## 0. Decisions (2026-10-21)

| Topic | Decision |
|---|---|
| Split | B1 notices and rules, then B2 agent surfaces; each with its own design, plan, audits and walkthrough |
| Email | `@opencoredev/email-sdk` (already in `packages/email`) with its Resend provider, Brevo as fallback, until Cloudflare Email Sending leaves beta; the SDK's Cloudflare provider then replaces Resend without a new adapter |
| Who gets notices | Both sides: clients (AGT-16) and the team members who must act; each member can turn team emails off |
| Response deadline | A team rule, not a fixed 48 hours: seeded from the team's kind, edited by the team |
| Team rules | A full **operating model** per team: typed rules the platform enforces, plus the client terms and the member agreement as documents people accept. Modelled on real team books (Rollerite's terms and freelancer agreement, Netherix's operations book and commission terms) |
| Storage | A versioned rulebook: a json-render spec validated by zod, plus the two documents; projects pin the version they started under |
| Catalog | Each rule kind is a json-render catalog component with zod props and two renderers (editor, summary); `@json-render/core` and `@json-render/react`, rendered on the dash and client pages; the plugin card shows the summary as text |
| Enforcement | Every rule in §3 is enforced in B1, not just displayed. Money rules propose; a person confirms (PayPal rules: no money movement without a person) |
| AI importer | Reading a team's ToS and operations book into the model goes to run D (intake agent proposals), on the same schema |
| Open source | Generic code is built as OSS packages (§2), in three future projects: the JSON app builder, the operating-model engine (actions, rules, scheduler, outbox), and the agentic React admin. Open core: premium packs plug in from outside; the MIT core holds no licence checks |
| Naming | No "payleor" in source code: code says `platform`; every user-facing mention of the name reads the `PLATFORM_NAME` environment variable (value `Payleor`), and domains come from the existing domain variables. Done in a prep run before B1 (§7) |

## 1. Scope

1. **Delivery pipeline:** an `outbox_delivery` row per event and target; a Cloudflare Queue sends; the 10-minute cron re-queues; a unique key per (event, target) so nothing is sent twice.
2. **Email notices** through `packages/email` (email-sdk, Resend provider now):
   - client: quote sent, question asked, payment due, delivery submitted, request declined or expired, ladder reminders, dispute steps;
   - team: new request (freelancers who can see it), client answered or messaged, deposit or balance paid, delivery accepted or changes requested, response-window reminder, warnings and strikes, refund proposals, dispute steps.
3. **Operating model:** the rulebook, acceptance, templates per team kind, the editor on the dash, summaries on the request form, client page and pay page.
4. **Enforced rules:** §3.
5. **Fulfilment type** on offerings (people, automated, both), shown on the seller page and in plugin results (AGT-19).
6. **Payout events** in the outbox (B2 delivers them as webhooks).
7. **Message rate limit** per author in `postConversationMessage`.

## 2. Packages

Placeholder npm scope `@opmodel/*` until the rename. All under `packages/oss/`; none imports a platform package (lint boundary).

| Package | Contents | Depends on |
|---|---|---|
| `engine-rules` | rule-kind catalog (zod props, json-render definitions), rulebook spec schema, version and acceptance types, pure evaluators (`windowState`, `refundFor`, `tierFor`, `strikeState`, ladders) | zod, `@json-render/core` |
| `engine-scheduler` | due items (rule, subject, step, `dueAt`); `tick(now)` returns what fires; clock and store as interfaces | `engine-rules` |
| `engine-outbox` | events, deliveries, retry and backoff, idempotency; mail target interface; Standard Webhooks signing (used in B2) | zod |
| `engine-drizzle` | Postgres tables and adapters for the three | drizzle |
| `admin-rules` | React editor and summary renderers for the catalog | `@json-render/react`, `engine-rules` |

`actions` (`defineAction`, `perform`, actors, errors, the tRPC, MCP and REST adapters) joins the engine in B2, where the API and MCP parity rewrites those adapters.

Extension points are open: rule kinds and their components register into the catalog, team-kind templates are data packs, mail and queue are interfaces. A premium pack is another package.

**Platform wiring** (our code): team-kind templates, Cloudflare adapters (Queue, cron calling `tick`), the mail target backed by `packages/email` (email-sdk), and hooks that tell the scheduler when a subject started or acted.

## 3. Rules and what they do

| Rule kind | Props | Enforcement |
|---|---|---|
| Response window | hours (minutes allowed on staging), reminder before | reminder to admins, managers and visible freelancers; then `request.expire`: status `expired`, client emailed; expired requests cannot be quoted; one-click resend copies the brief |
| Member update window | hours | reminder to the freelancer, then a warning mark |
| Revisions | free count, window days | checked by "request changes"; past the limit the client is pointed to a paid amendment |
| Client silence ladder | reminder days, final notice, close day | reminders, then `project.autoComplete`; on a 50% plan with the balance unpaid, `project.abandon` |
| Upfront payment and tiers | rate by order size and by client tier (spend with the team) | computed when the quote is accepted, stored on the payment |
| Late-delivery refund | grace hours, % per day, cap | a refund **proposal** for the admin to confirm; nothing pays out without the press; the member's share shrinks accordingly |
| Quality refund caps | unsatisfactory %, substandard % | ceilings enforced by the refund form |
| Strikes | warnings per strike, strike limit, automatic warnings (missed update, missed deadline, price raised after being picked) | at the limit the member is suspended from new requests and admins are told; admins add or lift marks on a small page |
| Leaving notice | hours | no new requests during notice; open projects flagged for reassignment |
| Dispute steps | discussion window, review days, decision days | a dispute from the client page runs the steps with reminders; PayPal `CUSTOMER.DISPUTE.*` webhooks open or update the case |
| Split | deposit rate, management fee, team cut, manager cut | moved into the model; manager cut is new |

Templates per team kind seed every rule (salon, freelancer, studio or agency, creator, AI seller, enterprise). A team edits its model and publishes a new version.

## 4. Data

- `rulebook (id, owner_id, version, spec jsonb, client_terms, member_agreement, published_at)`, unique `(owner_id, version)`
- `rulebook_acceptance (rulebook_id, principal_kind, principal_id, accepted_at)`
- `schedule_item (id, rulebook_id, rule_key, subject_kind, subject_id, step, due_at, fired_at, cancelled_at)`
- `member_mark (id, owner_id, member_id, kind warning|strike, reason, rule_key, subject_id, created_at, lifted_at)`
- `outbox_delivery (id, event_id, target_kind, target, status, attempts, next_attempt_at, last_error)`, unique `(event_id, target_kind, target)`
- `dispute` (project, opened by, step, due dates, PayPal dispute id when there is one)
- Platform columns: `project.rulebook_id` (pinned at request time), `services_team.kind`, `services_offering.fulfilment`, the member's notice opt-out.

## 5. How it runs

- **Notices:** the action writes its outbox event in its transaction; a dispatcher writes one delivery per recipient who has not opted out and enqueues it; the consumer sends and marks it sent; failures retry at 1 min, 5, 30, 2 h, 12 h, then the row is dead with an error log; the cron re-queues rows past `next_attempt_at`.
- **Scheduler:** a hook writes the items when a subject starts a timed rule and cancels them when the subject acts (a quote, question or decline cancels the response window). The cron calls `tick(now)`, which fires due items in order, once each (`fired_at` under a row lock), each through `perform` with a system actor so it lands in the action log.
- **Rule changes:** running projects keep their pinned version; new requests use the latest; clients accept the terms at request time; members re-accept the agreement at their next sign-in.

## 6. Tests

- Engine packages, with no platform code: evaluator tables; a scheduler contract test every store adapter passes, with a fake clock; outbox retry, backoff and idempotency; Standard Webhooks signing against the spec's published test vectors.
- Platform, at the use case or router with the real test database and PayPal faked at `fetch`: expiry and the client email; a quote cancels the window; warning, strike and suspension from `quote.create`; auto-complete and abandon; a late-refund proposal with no money moved until the confirm; the tier rate fixed at accept; dispute steps and a PayPal dispute webhook opening a case; a project keeping its pinned version; notices once, never to opted-out members, retried after a failed send.
- A lint rule: `packages/oss/*` imports no platform package.

## 7. Prep run: no brand in source

Before B1, one mechanical PR:

- **Identifiers and comments** say `platform` (`payleorFees` → `platformFees`); a migration renames `payleor_fees` to `platform_fees`.
- **The name people read** (UI copy, emails, page titles, MCP tool and widget text, metadata) comes from `PLATFORM_NAME`, set per stage in the Workers' env and the infra config (value `Payleor`), decoded with zod at startup and passed down like the domains; local dev and tests default it in their env files. Renaming the product is then a variable change and a redeploy.
- **Domains** come from `PLATFORM_DOMAIN`, `STORE_DOMAIN` and the other existing variables; fixtures use `platform.test`.
- **External values:** the PayPal attribution variable becomes `PLATFORM_BN`, its value unchanged.
- **A lint rule** rejects "payleor" in source; specs and the plugin manifest keep the name (product docs and the published plugin identity), and the zip build fills the manifest's display name from `PLATFORM_NAME`.
- The PR gets the test and security audits and a smoke on staging.

## 8. Migration and rollout

- Existing teams get rulebook v1 from their current settings plus the studio template, `kind = studio`; existing projects point at v1; new columns have defaults.
- Built in a cloud session task by task from the plan; staging deploy and walkthrough run locally; then the audits and the merge.
- First plan task: confirm PayPal `CUSTOMER.DISPUTE.*` webhooks on the sandbox.

## 9. Stories

AGT-16, AGT-19 and AGT-37 as written, plus a new "B1: operating model" section: the rulebook editor and publish; terms accepted on the request form; the agreement accepted on join; the update-window warning and a strike; client-silence auto-complete; a late-refund proposal confirmed; a tier deposit; the leaving notice; a dispute run; a notice opt-out.

## 10. Out of scope

API keys, webhook delivery, seller MCP tools and the API skill (B2); the AI importer (D); Cloudflare Email Sending until it leaves beta; publishing the OSS packages (after Nov 12, with the rename).
