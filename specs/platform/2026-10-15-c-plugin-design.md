# Run C: the client's AI plugin and conversations — design

**Date:** 2026-10-15. **Status:** built and merged as `cc0e08d` (PR #13, 2026-10-21); outcome in the [plan](../archive/platform/plans/2026-10-15-c-plugin.md). Earlier: approved by Mouhamed section by section (data/actions, web surfaces, plugin, packaging/testing) on 2026-10-15, after the spike closed with a go for both clients and a full-corpus re-read.

**Program:** run C of the agentic surfaces program ([`2026-10-13-agentic-surfaces-program.md`](2026-10-13-agentic-surfaces-program.md) §4, §4.1), Oct 20–23. **Builds on:** the approved conversations design ([`2026-10-14-conversations-design.md`](2026-10-14-conversations-design.md)), the spike facts and chosen setup ([`2026-10-14-plugin-spike-facts.md`](2026-10-14-plugin-spike-facts.md) "Setup chosen for run C"), the action registry (run A1, merged `4a27fb6`) and client contacts (run A2, [`2026-10-13-action-catalog-design.md`](2026-10-13-action-catalog-design.md) §5, lands before C).

## 1. Domain model (Mouhamed, 2026-10-15)

- **`veetlyn.com` is the multi-tenant HQ.** Auth, accounts, workspace and the dashboard live here; clients may also sign in at the HQ for their history and holdings across teams. The plugin is a cross-team surface, so it authenticates here (`api.veetlyn.com/mcp`, OAuth issuer on the dash host).
- **`veetlyn.app` is single-tenant seller sites.** Each `{slug}.veetlyn.app` is one team's or one freelancer's own site: storefront or services page, the request form, the client page and the pay page. Client ↔ team ↔ freelancer interaction lives on `.app`.
- **One seller, one slug, one site:** stores and services teams share the `team.slug` unique index (`packages/auth/src/index.ts:71`). A seller with both shows products and services on the same site.
- **Auth is federated** ([`2026-10-06-auth-federation-design.md`](2026-10-06-auth-federation-design.md)): one account works across HQ and every `.app` site. Signed client links stay the no-account path; a signed-in client is a bonus, never a requirement.
- `veetlyn.app` never sends mail (SPF `-all`, null MX). Emails send from `veetlyn.com` purpose addresses and link to `.app` pages. The mall's cross-store checkout lands on the `veetlyn.app` root in run M, not here.

## 2. Goal

A client hires from Claude or ChatGPT — search listed offerings, request a quote, answer the team's questions, accept a quote and pay in PayPal, follow the delivery — with every commitment behind a widget button and every payment behind the person's PayPal approval. Sellers answer requests by quoting, asking questions, or declining with a reason. The same conversations show on the web (freelancer board, staff tabs, client page) and read from one core rule, so every surface agrees.

## 3. Decisions

Carried, proven in the spike: CIMD + rate-limited DCR fallback; JWT access tokens checked against JWKS on the Worker; `legacy: "stateless"` transport serving both protocol eras; own login and consent pages; widget-only accept tools with a single-use confirmation token (HMAC over action, user, project and quote/delivery version, 15 minutes, delivered in `_meta`); Pay button hands the signed pay link to the host's open-link and the model never sees it; complete text content for hosts without widgets.

Settled on 2026-10-15:

- **Listing is default-on with opt-out.** `services_offering.listed` and `services_department.listed` are boolean, default `true`, settable at creation and edit ("List in AI assistants"). Search returns only active offerings that are listed and whose department (if any) is listed, from active teams. This supersedes the amendments proposal's `assistant_hiring` setting (off by default) and the program's "sellers opt in" wording.
- **Audience per quoting mode:** `open` — the department's (or shortlist's) freelancers read, write and quote; `team` — they read and discuss, only staff quote; `assigned` — staff only, the assigned freelancer joins at assignment. The client never reads the request space; their replies relay in masked as "Client". The request space closes to freelancers when a quote is accepted; the winner's history is relayed into the project space.
- **Demo team:** Walk Crew switches to `open` mode and gains 1–2 seeded freelancers in its department, so the demo shows competing quotes on one request.
- **Client and pay pages move to the seller's site:** `{team}.veetlyn.app/c/{token}` and `{team}.veetlyn.app/pay/{token}`. The host's team must match the token's project, else 404. Link building (request email, plugin results, payment router) moves from the site origin to the team subdomain. The tunnel already serves `*.veetlyn.app`, so dev works before run H.
- **Client HQ home:** a minimal signed-in page on `veetlyn.com` lists the client's projects across teams, each linking to the team's `.app` client page. The web equivalent of the plugin's project list.
- **MCP host stays `api.veetlyn.com/mcp`** for the hackathon (registered clients point at it). This supersedes `mcp.veetlyn.app/mcp` (platform design §8.1) and `mcp.veetlyn.com/mcp` (auth federation §6); the reserved `mcp.` slug stays reserved. A move is post-hackathon.
- **Sequencing:** core first (tables, rule, masking, events), then web surfaces, then the plugin on `perform`. A2 merges before C starts; H (Oct 18–19) lands before C ships, so the OAuth issuer is already `dash.veetlyn.com` and connectors are re-registered exactly once.

## 4. Data (one migration)

From the conversations design §5, unchanged:

- `conversation_message`: `id`, `project_id`, `space` (`request` | `project`), `author_kind` (`client` | `member` | `system`), `author_user_id`, `author_contact_id`, `kind` (`text` | `question` | `answer` | `event`), `body`, `shown_body` (masked copy for pre-acceptance messages), `reply_to_id`, `ref_type`/`ref_id` (quote, decline, delivery, amendment), `surface` (`web` | `mcp` | `discord` | `api` | `email`), `discord_message_id`, `created_at`. Indexed by project and creation time.
- `member_department` (`team_id`, `user_id`, `department_id`; unique per user and department).
- `request_shortlist` (`project_id`, `user_id`; rows replace the department rule).
- `project`: + `declined_reason`, `declined_at`; new closed statuses `declined` and `expired` (only B's cron produces `expired`; C's UI tolerates the state from day one).
- New: `services_offering.listed` and `services_department.listed`, boolean not null default true.

`text[]` columns the MCP layer touches are jsonb at the boundary (spike lesson).

## 5. Core (packages/core, pure)

- `conversationAccess(viewer, project, facts)` returns the spaces a viewer reads and writes, with facts: role and departments, quoting mode, shortlist, project status, accepted freelancer, whether the viewer is the project's client (never a team member, A2 §5.4). Every surface and the API call it; tests are a table of cases (role × mode × department/shortlist × before/after acceptance).
- `maskContactDetails(body)` hides emails, phone numbers (≥7 digits with common separators) and deny-listed messaging/social/freelance links (WhatsApp, Telegram, Signal, Discord invites, LinkedIn, Instagram, Facebook, X, TikTok, Fiverr, Upwork, Malt, Calendly) as "[hidden until a quote is accepted]". File links pass. Applies to messages posted while quoting, in both spaces, from every surface; `body` keeps the original for admins.

## 6. Actions and events

Registry actions through `perform`, logged with actor and surface: `conversation.post` (eligible freelancers, staff, the client, the accepted freelancer), `conversation.answer` (the client), `request.decline` (staff, reason required, sets `declined` with the reason and tells the client), `request.shortlist` (staff, while open), `member.departments` (team admins). Quote proposal/acceptance, decline, expiry, delivery, changes and amendments write their `event` message in the same transaction as the change. Each message emits `message.posted` to the outbox (run B delivers email/webhooks, run E Discord).

`offering.search` joins the registry in C (A1 deferred it). `project.client_view` gets its output schema for the plugin (A1 plan note).

## 7. Web surfaces

- **Open requests board** (`{dash}/{team}/requests`): requests the audience rule shows the signed-in freelancer, newest first, with department and the 48-hour countdown (display only in C; reminder and expiry are run B). A request opens to the brief, the request space and the quote form.
- **Staff project page:** a **Request** tab (each freelancer's activity grouped, the shortlist control, Decline with a required reason) and a **Project** tab (the exchange with the client).
- **Team settings:** each freelancer's departments; the "List in AI assistants" checkbox on the offering and department forms (checked by default).
- **Client page** at `{team}.veetlyn.app/c/{token}`: responses grouped by freelancer — their questions with an Answer box, their quote with an Accept button — plus team messages and the event timeline. The composer names its audience: before acceptance "The freelancers looking at your request (contact details are hidden until you accept a quote)" with a "team only" choice; after acceptance "Your freelancer and the team". Declined/expired requests show the reason and a link to request again.
- **Pay page** at `{team}.veetlyn.app/pay/{token}`: same page, new host; the payments flow is unchanged.
- **Client HQ home** (`veetlyn.com`, signed in): the client's projects across teams with status, each linking to the team's `.app` client page.

**Host move mechanics:** the web Worker's host routing resolves `{slug}.veetlyn.app` to the seller route tree (as the seller page today) and gains `/c/[token]` and `/pay/[token]` there; both 404 when the token's project belongs to another team. Link building moves from `siteOrigin` to `https://{teamSlug}.veetlyn.app` in `packages/api/src/use-cases/requests.ts:138`, the payment router's `clientPath`, and the plugin's results; the server joins the project's team slug when building links. Old `{site}/c/{token}` links redirect to the team host so emails sent before the move keep working.

## 8. Plugin

**Endpoint and auth** (ported from the spike branch): `POST /mcp` on the api Worker, streamable HTTP with `legacy: "stateless"`; CIMD with the allowlisted Workers transport (claude.ai, chatgpt.com, no redirects) and rate-limited DCR fallback; JWT access tokens verified against `{issuer}/jwks`. The web Worker gains forwarding for the OAuth discovery paths (today it forwards only `/api/*` and `/trpc/*` — a gap the spike documented). After token check, the user maps to a verified client contact per A2 §5.4/5.5: requesting attaches to their verified contact or creates one (match-or-create under the advisory lock), and a team member is never a client. The project records the AI as the client's home surface; the client-link email still goes out (AI clients cannot receive pushes, AGT-11). Today's request limits apply on the AI path, keyed by contact instead of bare email.

**Tools** (generated from registry definitions; summaries follow the connector-UX guidelines, "Use this when…", next step in every result):

| Tool | Registry action | Notes |
|---|---|---|
| `search_offerings` | `offering.search` | Listed, active offerings only; the fulfilment label arrives with run B (AGT-19) |
| `request_quote` | `request.create` | Creates the project, contact, request space and emails |
| `list_my_projects` | `project.client_view` (list) | Rows carry date and brief start (spike lesson) |
| `get_project` | `project.client_view` | Summary line ("3 freelancers responded: Aïcha quoted $150 in 4 days; Ben asked about the vector file"), open questions with ids, decline/expiry reason |
| `reply` | `conversation.post` / `conversation.answer` as the client | Result says who reads it; the skill has the model confirm wording first |
| `request_changes` | `delivery.request_changes` | As today |
| `accept_quote`, `accept_delivery` | `quote.accept`, `delivery.accept` | App-only; confirmation token required; called by widget buttons only |

**Widget v2:** one MCP Apps resource with versioned URIs (hosts cache by URI); offerings as a carousel; the project card shows one slide per freelancer (their quote with Accept, their questions for the model to relay); status changes call `updateModelContext` (spike lesson); themed to the host's variables with fallbacks, skeleton loading, transparent background; the bridge is bundled or served from our origin, not unpkg; `_meta.ui.csp` includes `*.veetlyn.app` in `redirect_domains` for ChatGPT's `openExternal`. The design pass (states, typography, dark/light) follows functionality within the run.

**Reliability fixes from the spike:** reproduce the streamed-response SSE failure in a test first, then buffer the response or tie the database client's lifetime to the stream.

**Skill** (`hire-a-professional`): the flow gains answering questions and replying (the "no messages" rule is retired), decline/expiry handling with a search-again offer, and the rule that file links go in the brief (no client upload exists). `reference.md` gains the new statuses.

**Packaging:** one `plugins/veetlyn/` folder serves Claude (`.claude-plugin/plugin.json` + `.mcp.json`) and ChatGPT/Codex (`plugin.json` + `mcp.json` with `streamable-http`; `extensions.com.openai.interface` with displayName, shortDescription, a non-transactional default prompt; `onboardingSkill` as the `./`-relative SKILL.md path — a bare name fails ChatGPT's upload). A `pnpm plugin:zip` script builds both zips (Claude's with the folder, ChatGPT's flat). The README's install steps become the judges' testing instructions.

## 9. Errors and edge cases

From the conversations design §8, plus: a `reply` on a closed space is refused with the reason; a masked message's original is never returned by any client-facing read; `get_project` for a foreign or unlinked project says "No project with this id belongs to you" (proven); the confirmation token forgery refusal stays (proven); a client whose contact was removed keeps history but loses action rights; C's UI renders `expired` before B's cron can produce it.

## 10. Testing

- `conversationAccess` as a case table; `maskContactDetails` against the example list.
- Use cases with the real database: post/answer from each actor, decline with and without reason, shortlist replacing the department rule, acceptance moving the winner and closing the request space, events in the same transaction, match-or-create race for the plugin's contact.
- Registry additions follow A1's rules (names, summaries, agent policy: commits stay `confirm` or widget-only; an API key never acts as the client).
- MCP boundary with a scripted client: the spike's `/tmp/spike-oauth-e2e.mjs` becomes a kept script under `apps/server/src/mcp/` tests — OAuth sign-in as a test client, each tool, the token forgery refusal, the SSE streaming case.
- Host move: routing tests for `/c` and `/pay` on the right and wrong team subdomain, and the redirect from the old site URL.
- Golden prompt set in Claude and ChatGPT measures unprompted discovery (memory caveat: prompts must need fresh data).

## 11. Walkthrough (stories)

AGT-09 to AGT-15 on the deployed hosts, with AGT-10 edited for default-listed/opt-out ("another seller's unlisted offering never appears"). New stories in `stories/09-agentic.md` under C: seller questions answered from the plugin and the client page; decline with a reason shown on the card; competing quotes from the open-mode Walk Crew with per-freelancer slides; the client HQ home listing projects across teams. The spike's A1–A19 script is the shape.

## 12. Cut order inside C

1. Request-space free text → questions and answers only (the conversations design's fallback).
2. The shortlist control (department rule remains).
3. The widget design pass trimmed to essentials.

Not cuttable: the pay hand-off, questions, decline, masking — they are the demo.

## 13. Out of scope

The 48-hour reminder and expiry job, email notices and batching, API webhooks (run B); Discord (run E); the mall (run M); the freelancer portal on `.app`; client sign-in on team sites (federation bonus, later); moving the MCP endpoint to `mcp.`; ratings and profiles (run P).
