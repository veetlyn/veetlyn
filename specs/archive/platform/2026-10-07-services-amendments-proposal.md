# Services amendments: catalog, records and hiring from AI assistants

> **Archived:** Superseded by the agentic surfaces program (`../../platform/2026-10-13-agentic-surfaces-program.md`, §4 and §4.1); never approved as written. Archived 2026-10-16.

- **Status:** proposal written on 2026-10-07, awaiting review. It changes no approved spec until it is approved; §13 lists the edits that approval makes
- **Amends:** [`2026-10-05-services-teams-design.md`](2026-10-05-services-teams-design.md) (the services spec), [`2026-10-03-payleor-platform-design.md`](../../platform/2026-10-03-payleor-platform-design.md) (products line, §8 MCP, §9.1 agents), [`2026-10-06-auth-federation-design.md`](../../platform/2026-10-06-auth-federation-design.md) (§6 MCP clients, §10 phasing)
- **Depends on:** the auth federation spec (written, awaiting review): the auth host (A1) and its §6 authorization server for MCP clients
- **Inputs:** the founder's voice note of 2026-10-06, restated in §3, and the decisions taken on 2026-10-07 (§2)
- **Milestone:** PayPal AI Hackathon submission, Nov 12, 2026, 12:00 pm PST ([`../hackathon/README.md`](../../hackathon/README.md))

## 1. Why the direction changes

- **Demand for commissions has moved to AI assistants.** The founder reports not having worked a ticket in a long time. Studies of freelance platforms point the same way: eight months after ChatGPT, job posts for writing and coding fell 21% relative to manual work, and image generators cut image-creation posts by 17%; the jobs that remained were more complex and paid more ([Demirci, Hannane and Zhu, Management Science, 2025](https://pubsonline.informs.org/doi/10.1287/mnsc.2024.05420)). Freelancers in the most exposed jobs lost 2% of their jobs and 5.2% of their earnings, and a strong track record did not protect them ([Hui, Reshef and Zhou, Organization Science, 2024](https://pubsonline.informs.org/doi/10.1287/orsc.2023.18441)).
- **Marketplaces followed the demand.** Upwork launched an app in ChatGPT in April 2026 and offers a Claude connector and an MCP server for agent hiring ([Upwork](https://investors.upwork.com/news-releases/news-release-details/upworks-work-marketplace-comes-chatgpt), [upwork.com/ai](https://www.upwork.com/ai/)). Thumbtack announced a ChatGPT app in October 2025 ([Thumbtack](https://press.thumbtack.com/announcements/thumbtack-partners-with-openai-to-power-home-services-in-chatgpt/)). Airtasker launched a full hiring flow in ChatGPT in August 2026 ([Airtasker](https://www.airtasker.com/us/blog/airtasker-launches-chatgpt-plugin/)). Fiverr Go (February 2025) gives freelancers an assistant trained on their client chats and a model trained on their past deliveries ([TechCrunch](https://techcrunch.com/2025/02/18/fiverr-wants-gig-workers-to-offload-some-of-their-work-to-ai/)).
- **Payleor's difference.** A marketplace owns the client relationship. Payleor gives each team its own channel inside the assistants: the team's brand, clients and prices, PayPal paying the team and its members, and a track record backed by real payments.
- **Hackathon fit.** The organizers' inspiration themes include "agent-to-agent negotiation and settlement" and "a scheduler that pays contractors when a job is marked complete" ([`../hackathon/resources.md`](../../hackathon/resources.md)).

## 2. Decisions (2026-10-07)

| Topic | Decision |
|---|---|
| Hackathon entries | Services is the main entry. Commerce becomes a second entry only if it passes the Nov 2 checkpoint (§11.3). The rules allow several entries that are "substantially different"; confirm with the hackathon manager that two entries from one codebase qualify |
| Product names | **Payleor Commerce** and **Payleor Services**. Payouts is a capability (paying freelancers now, creators later), not a product. Networks is the long-term direction (§12.2), not a product |
| AI direction | Clients hire a team from ChatGPT or Claude through Payleor's MCP server, and an intake agent scopes and quotes behind it (§6, §7). The same agent drafts quotes from Discord tickets and the web |
| Voice-note items for Nov 12 | The service catalog with departments and titles (§4); client grades and freelancer records (§5) |
| Later | Team agents trained on a team's own deliverables are phase 2; Networks is phase 3; the rest of the voice note is listed in §12 |

## 3. The voice note and where each item goes

| # | Requirement | Where it goes |
|---|---|---|
| V1 | A team groups its offer into departments and sub-departments, each listing the services clients can order | Nov 12, §4 |
| V2 | Teams have their own internal roles beyond admin, manager and freelancer | Nov 12: titles and departments (§4.3). Phase 2: named permission sets and Discord role mapping (§12.1) |
| V3 | Staff and freelancers apply with a portfolio, socials, previous teams and their age; the team may require a test | Phase 2 (§12.1). Age becomes the 18+ rule (§10) |
| V4 | Teams share a pool of vetted freelancers ("Networks") | Phase 3 (§12.2) |
| V5 | Each client has a grade with the team, based on spend | Nov 12, §5.2 |
| V6 | A project gets one or more quotes; the client accepts one | Covered (services spec §5.2) |
| V7 | Acceptance triggers a 50% deposit plus a management fee of 5 to 15% | Covered (services spec §4.3, §5.3) |
| V8 | The freelancer delivers; on acceptance the client pays the other 50% | Covered (services spec §5.2) |
| V9 | Deadlines can be extended | Unchanged: amendments add days (services spec §5.5) and "extend the deadline" is a case outcome (services spec §7.2). A request-and-accept extension is phase 2 |
| V10 | Late delivery costs a percentage per day, capped at 35%; at the cap the client can cancel and get a refund | Covered (services spec §7.2), on its current schedule |
| V11 | The team keeps a cut, usually 15%, set per team | Covered (services spec §4.3). Rates per freelancer or per rank: open question (§15) |
| V12 | Clients add or remove features through amendments | Covered (services spec §5.5) |
| V13 | A team can run a store that sells digital goods | Phase 2 (§12.1) |
| V14 | Reputation decides whether a client trusts a team with a large project, and whether a team trusts a freelancer or a client | Nov 12 inside one team (§5). Across teams: phase 3 |
| V15 | Products named Commerce, Payouts, Services and Networks | Commerce and Services (§2) |
| V16 | AI has reduced demand for commissions, and many teams ban AI in their members' work | §1, §6 to §8; no agent touches deliverables before phase 2 (§10) |

## 4. Service catalog

### 4.1 Departments

- Table `services_department`: `id`, `team_id`, `parent_id` (null for a department, set for a sub-department), `name`, `position`, `archived_at`. Two levels only: a sub-department's parent must be a department.
- Admins manage departments in the team settings. Archiving hides a department from new projects; existing projects keep their reference.

### 4.2 Catalog services

The UI calls them services. The table is `services_offering`, so it does not read like "services team".

- Fields: `id`, `team_id`, `department_id` (a department or sub-department), `name`, `description` (shown to clients), `price_min_minor` and `price_max_minor` (equal for a fixed price), `days_min` and `days_max` (usual delivery days), `intake_questions` (up to 5 short questions the intake agent must get answered, for example "Which Minecraft version?"), `auto_quote` (§7.4), `default_freelancer_id` (null; required for automatic quotes), `active`, `position`. Amounts are in the team's currency.
- Clients see active services with their department, name, description, price range and usual days: through the MCP tools (§6.2) and on the client page of a project that names a service.
- A project names at most one service: `project.offering_id`, null for free-form projects. Quote line items stay free; the service only gives the team and the intake agent a starting range.

### 4.3 Titles and departments for members

- `services_team_member.title`: free text up to 40 characters ("Head of Development", "Trial developer"). It is a label only; permissions still come from the role (admin, manager, freelancer).
- Table `services_member_department`: (`member_id`, `department_id`), unique. A member can belong to several departments.
- In `open` quoting mode, a freelancer who belongs to departments sees the quoting projects of those departments and projects without a service. A freelancer with no department sees every quoting project, as today. Managers and admins see every project, as today.
- New projects notify the freelancers of the project's department through the outbox notifications (services spec §5.2).
- Department-scoped managers and named permission sets are phase 2 (§12.1).

## 5. Clients, grades and freelancer records

### 5.1 Clients of a team

- Table `services_client`: `id`, `team_id`, `user_id` (null; set when the client has a Payleor account), `email` (lowercased, null), `discord_id` (null), `name`, `created_at`. Within a team, each of `user_id`, `email` and `discord_id` is unique when set.
- Starting a project looks the client up by user id, then email, then Discord id, and creates a client when none matches. `project.client_id` references it. `project.client_email` and `project.client_discord_id` stay as the contact the project was started with.
- A matched client gains the identifiers the new project brings, unless another client of the team already holds them. Payleor never merges two clients on its own; a merge action for admins is phase 2.

### 5.2 Grades

- **Lifetime spend with the team:** captured payments minus the refunds PayPal confirmed, over the client's projects, in the team's currency.
- **Tiers:** a team defines up to 5 tiers, each a name and a minimum lifetime spend (setting `client_tiers`, JSON validated in `core`). There are no tiers by default; the settings page offers a starter set. A client's grade is the highest tier whose minimum is at or below their lifetime spend.
- **Reliability, shown next to the grade:** projects started, completed and cancelled; payments captured within 7 days of being created; refunds; PayPal disputes and chargebacks once the dispute sync exists (services spec §7). Until then that line is hidden.
- **Where:** the project page and the client list in the team admin (AG Grid, §8), and the replies the bot sends only to staff (ephemeral). Public ticket cards do not show grades. Clients do not see grades (open question in §15).

### 5.3 Freelancer records

- Per team, for each member who has been assigned projects: projects completed; on time, meaning the share of completed projects whose first delivery was submitted by the deadline in force at that moment; average revisions per completed project (`project.revisions`); projects cancelled while assigned to them; cases filed against them once cases exist.
- Each delivery stores the deadline in force when it was submitted (`deadline_at_submission`), so later amendments do not rewrite the record.
- **Who sees it:** the team's admins and managers. Freelancers see their own record for each team in the freelancer portal, not each other's.
- **Facts only:** no score, no ranking, and no agent reads or writes records (§10). Records are not shared across teams before phase 3.

## 6. Hiring a team from ChatGPT and Claude

### 6.1 Flow

1. The client asks their assistant and names the team: "Ask Walk Crew for a quote for a daily rewards plugin."
2. The assistant calls `find_team` and `list_services`, and picks the matching service with the client.
3. The client signs in to Payleor once, through OAuth on `auth.payleor.com` (§6.3). A new client creates an account with any sign-in method of the auth spec (auth spec §7): email code, password, PayPal or Discord.
4. `request_quote` creates the project (status `quoting`, `source = assistant`, the signed-in user as the client) and starts the intake agent (§7).
5. When the intake agent needs answers, the tool returns its questions; the assistant asks the client and calls `answer_intake`. This loop is the agent-to-agent negotiation.
6. The draft goes to the team's managers (§7.3), or is sent at once when the service allows automatic quotes (§7.4). The team sees the request in the web app and, when set, in its requests channel in Discord.
7. When a quote is sent, the client is emailed. `get_project` shows the quote with its terms: line items, total, the 50% deposit, the management fee, delivery days, and the team's penalty and refund rules.
8. `accept_quote` returns a summary and a single-use confirmation token. The quote widget's Confirm button calls `confirm_action(token)`; without widgets, the assistant asks the client and then calls it. The project moves to `awaiting_deposit`.
9. `get_pay_link` returns the pay page link (`/pay/{token}`, services spec §5.4). The client pays with PayPal on that page; no payment happens inside the chat.
10. From then on the project runs on the existing flow. The client accepts amendments and deliveries with the same tools and confirm step, or on the client page.

### 6.2 Client tools

| Tool | Does | Notes |
|---|---|---|
| `find_team(query)` | Finds teams that allow hiring from assistants (§6.4) by slug or name | Exact or prefix match. Never ranked by quality or records |
| `list_services(team)` | Lists the team's active catalog | Department, name, description, price range, usual days |
| `request_quote(team, service?, request, deadline?, budget?)` | Creates the project and starts the intake agent | Returns questions, "with the team", or the quote |
| `answer_intake(project, answers)` | Continues the intake | |
| `list_my_projects()`, `get_project(project)` | Status, quotes, amendments, deliveries, payments and the client page link | Only the signed-in client's projects |
| `accept_quote`, `accept_amendment`, `accept_delivery` | The client's binding decisions | Confirm step, as for the money-moving merchant tools (platform spec §8.3) |
| `decline_amendment`, `request_changes(note)` | The client's other decisions | No confirm step |
| `get_pay_link(project)` | The pay page link of the payment due | |
| `confirm_action(token)` | Confirms a pending decision | Shared with the merchant tools |

Widgets (MCP Apps, platform spec §8.2): a quote card (items, totals, deposit, terms, Accept) and a project card (status, next step, a button that opens the pay page). Without the UI extension the tools return text.

### 6.3 Server and sign-in

- One MCP server at `mcp.payleor.com/mcp` (platform spec §8.1, on the platform domain since the 2026-10-06 domain change). The client tools are a new group next to the buyer and merchant groups.
- Authorization goes through `auth.payleor.com` as in auth spec §6 (`@better-auth/oauth-provider`, `jwt`, `@better-auth/mcp`, `cimd`), with one more scope: `projects:client`, which lets the user request quotes and act as the client on their own projects. A token with only this scope carries no team, so the consent page skips the team picker. Every tool checks that the user is the project's client.
- ChatGPT and Claude both register through Client ID Metadata Documents ([OpenAI](https://developers.openai.com/plugins/guides/security-privacy), [Anthropic](https://claude.com/docs/connectors/building/authentication)), so open dynamic registration stays off. The authorization server metadata must advertise `client_id_metadata_document_supported: true` and `none` among the token endpoint authentication methods; refresh tokens of these public clients rotate.
- This work moves ahead of store sign-in (auth spec phase A2), which becomes Commerce work.

### 6.4 Team settings and safeguards

- `assistant_hiring`, off by default. While it is off, `find_team` never returns the team and `request_quote` refuses.
- `requests_channel_id`, optional: a Discord channel where the bot posts new assistant requests and drafts for staff.
- Limits: at most 3 open requests (assistant projects still in `quoting`) per client per team and 10 in total; `request_quote` is rate limited per user (the existing `rate_limit` table).
- A manager can decline a request without quoting. The project is cancelled from `quoting` and the client is told.
- Everything the client writes is untrusted input for the intake agent (§7.5).

### 6.5 Communication

Before the quote, the intake loop carries the questions. After it, the client gets email at their account address (outbox notifications), the client page and the tools. Messages between the team and an assistant client are phase 2.

## 7. The intake agent

### 7.1 Sources

- **Assistant:** `request_quote` and `answer_intake` (§6).
- **Discord:** `/project draft` in a ticket channel, or Draft quote on a project card, staff only. The bot reads the ticket's messages through Discord's REST API at that moment (the app keeps no gateway connection) and answers the manager with an ephemeral summary and a Review link.
- **Web:** Draft with AI on the New project form and on a project in `quoting`.

### 7.2 Steps

1. Match the request to one of the team's active services, or to none (Clef `choice`).
2. Load the team's 5 most recent completed projects for that service: final price, days taken, late or not, revisions, and the accepted quote's line items.
3. List what is missing: the service's intake questions plus what the request leaves open (platform, version, assets, deadline, budget).
4. Ask the client (assistant source) or list the questions for the manager (Discord and web sources).
5. Draft the brief and the line items with amounts and days, within the service's range, and flag risks: vague scope, a deadline shorter than the service's usual days, a budget below its range.

### 7.3 Drafts

- Table `intake_draft`: `id`, `team_id`, `project_id`, `offering_id`, `brief`, `items`, `delivery_days`, `questions`, `answers`, `risks`, `model`, `prompt_version`, `created_at`. One open draft per project.
- A draft is not a quote. Quotes always name the freelancer who does the work (`quote.freelancer_id`); drafts don't. A manager opens the draft, edits it, names the freelancer as the quoting mode requires (`quoteAuthor` in `core`), and sends it. In `assigned` mode, the assigned freelancer sends it.
- Sending the quote copies the draft's brief to the project.

### 7.4 Automatic quotes

- Allowed only for a service with `auto_quote` on and a default freelancer, and only when the draft's total is within the service's price range, its days are within the usual days, and the agent flagged no risk. `core` checks these bounds; the model does not decide them.
- The quote names the service's default freelancer, records that the intake agent sent it (`quote.sent_by_agent`), and goes to the client at once. Accepting and paying still need the client.

### 7.5 Limits

- **Tools:** read the catalog, read the team's completed projects, read the ticket (Discord source), write its draft, ask questions. It has no tool that moves money, changes members or changes a project's state.
- **People:** it never picks, suggests or ranks freelancers (§10).
- **Untrusted input:** client text never reaches a tool argument without validation. `core` checks every draft before it is stored: positive items, totals within `MAX_AMOUNT_MINOR`, and days within limits.
- **Runtime:** an Agents SDK class `IntakeAgent`, instance `intake:{teamId}:{projectId}`, with models through AI Gateway (platform spec §9.1). Its tools come from `agent-tools` with `requiredRole` set and `movesMoney: false`.

### 7.6 What it learns from

- The team's own completed projects, read as records at draft time. No model is trained, nothing crosses teams, and a deleted project is gone from what the agent can read.
- Ticket messages are read at draft time and not stored; only the draft keeps what the agent wrote.
- Deliverables are not used before phase 2 (§12.1).

## 8. AI, PayPal and sponsor in the Services entry

| Area | What the entry shows |
|---|---|
| AI | The intake agent (§7), the MCP tools used from ChatGPT and Claude (§6), and the payout agent (services spec §6.5). The case agent and the PayPal dispute agent are stretch work (§11.1) |
| PayPal | Partner onboarding (built), Orders v2 with `platform_fees` on the pay page, PayPal webhooks, Log in with PayPal for the payout destination (built), the Payouts API; the Disputes API with the stretch dispute agent |
| Sponsor prize | AG Grid: tables for payments, clients (grades and reliability) and freelancers (records) in the team admin. Each entry can win one sponsor prize; a Commerce entry would aim at Channel3 |

## 9. Testing

- **Core unit tests:** department depth, catalog bounds, automatic-quote checks, draft validation, tier selection, lifetime spend, freelancer record figures, client lookup and the no-merge rule.
- **Integration tests:** client tools act only on the signed-in client's projects; teams with `assistant_hiring` off are invisible and refuse requests; confirmation tokens are single-use and expire; request limits and rate limits hold; a token with only `projects:client` carries no team.
- **Intake agent evaluations:** 20 seeded requests over a demo catalog, checking the service match, the questions asked, drafts within range and the risk flags, plus prompt-injection attempts in client text (asking for a discount, for another team's data, or to skip review).
- **Walkthrough:** in ChatGPT and in Claude, as a custom connector: find the demo team, request a quote, answer the questions, receive the quote, accept, pay in the PayPal sandbox, then the delivery, the balance and the freelancer's payout in Discord and on the web.

## 10. Rules

- **Payleor's role (approved 2026-10-07):** Payleor is software for the team, never a party to the deal. Each deal is between the team, as the seller, and the client, as the buyer.
  - Payleor never holds, releases or decides about money. Payments go straight to the team's PayPal account.
  - PayPal handles payment disputes. Inside a team, admins decide penalties and refunds under rules the team wrote; Payleor computes and records them.
  - Quotes the intake agent drafts or sends are the team's offers.
  - The terms say all of this, and that teams handle their own tax and pay their own members.
  - Held deposits (PayPal delayed disbursement) were considered and rejected, because Payleor would decide when money is released. The merchant-of-record option in the platform spec (§16 there) is removed on approval.
- **Payout credentials:** stored for the sandbox demo only (services spec §4.3). Before going live, ask PayPal whether a platform may hold a seller's REST secret, and what losses a platform partner carries for its sellers' refunds, chargebacks and negative balances.
- **18+:** Payleor's terms say that anyone who receives payouts must be 18 or older. Payouts only go to a verified PayPal account (services spec §4.2), and PayPal requires its users to be at least 18 ([user agreement](https://www.paypal.com/us/legalhub/paypal/useragreement-full)). Payleor collects no birthdates and adds no age feature.
- **No AI decisions about people:** no agent picks, ranks, scores or evaluates freelancers, applicants or clients. Grades and records are facts computed by rules in `core`. This keeps Payleor out of the EU AI Act's high-risk category for work and access to self-employment ([Annex III, point 4](https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3)), whose obligations apply from 2 December 2027 (Regulation (EU) 2026/1744).
- **Who sees what:** grades and records stay inside the team, and a freelancer sees their own record. The privacy policy says that teams see a client's and a freelancer's history with them.
- **Deliverables:** no agent produces or edits deliverables before phase 2.
- **Money:** unchanged (services spec goal 6). No agent moves money; clients pay on the pay page; binding client decisions made in a chat use the confirm step.

## 11. Schedule to Nov 12

This replaces the services spec's §12 from Oct 7.

### 11.1 Services (main entry)

| Week | Services | Shared |
|---|---|---|
| Oct 7–12 | Catalog, departments and titles (§4). Pay page, `applyPayPalFact`, PayPal webhooks, outbox and Queues | Auth host (auth spec A1) |
| Oct 13–19 | Deliveries, accept delivery, balance and amendments: the full flow on the web, the bot and the client page. Clients, grades and freelancer records (§5) | Email notifications |
| Oct 20–26 | MCP server with the client tools and widgets (§6); the intake agent on all three sources (§7) | MCP authorization with the `projects:client` scope (auth spec §6) |
| Oct 27–Nov 2 | Payouts, the payout agent and the freelancer portal; AG Grid tables (§8) | Deploy to the production hosts; Commerce checkpoint on Nov 2 (§11.3) |
| Nov 3–8 | Case templates, the validator and the deadline penalty (services spec §7.2); hardening. Stretch: the case agent and the PayPal dispute agent | Billing (plans per product, PayPal Subscriptions) if time allows |
| Nov 9–12 | Demo team with seeded history (catalog, past projects, clients), its Discord server, the ChatGPT and Claude connectors; README, video, submission | |

### 11.2 Commerce (second entry only if it passes the checkpoint)

Commerce work continues in its own worktrees and never takes time from Services. For Nov 12 it narrows to the storefront, web checkout and orders (Orders v2), and the buyer tools on the same MCP server, paying through the PayPal approval link in both assistants (platform spec §8.3; ACP Instant Checkout waits with the other protocols, §11.4). The Channel3 catalog work is already built.

### 11.3 Nov 2 checkpoint

Commerce becomes a second entry only if, on Nov 2, a buyer can find a product on the storefront or through an assistant, pay in the PayPal sandbox, and the merchant sees the order. Otherwise Commerce stays out of the submission.

### 11.4 Moved after Nov 12

- The public `/v1` API, outgoing webhooks, the OpenAPI document and the Postman collection (services spec §8.2, §8.3). Teams with their own bots use Payleor's bot or the web app until then (open question in §15)
- The reconciliation job on Render (services spec §6.7)
- The cases template editor UI, and the case and dispute agents if the stretch slot does not fit
- Commerce: the Store Sync, ACP, UCP and AP2 adapters and the conformance agent, custom domains, the admin agent and AG Studio, the Render bulk import, and store sign-in (auth spec A2)

## 12. After Nov 12

### 12.1 Phase 2: team agents and the rest of the voice note

- **Team agents.** A team builds an agent from its own past deliverables and conventions. The agent produces drafts for specific catalog services, a team member reviews every draft before delivery, and the catalog labels those services "agent-assisted". Conditions:
  - the client's permission for each deliverable used, since a commission usually belongs to the client once paid (Fiverr only lets freelancers train on deliveries the client made public, [Fiverr help](https://help.fiverr.com/hc/en-us/articles/32545573840657-Fiverr-Go-AI-Creation-Model-for-freelancers));
  - the consent of the freelancers who made the work;
  - a share for those freelancers of what the agent earns, paid through the ledger like project earnings.

  Agents work by retrieval over the team's own material, per team and deletable; no model is shared across teams.
- Applications and tests for staff and freelancers, with forms built on the case-template fields; accepting an application creates the member with a title and departments.
- Named permission sets, department-scoped managers, and mapping Discord roles to Payleor roles.
- Discord roles given to clients when they reach a tier.
- Deadline extension requests: an amendment that only adds days.
- Milestone payment schedules for large projects.
- Messages between a team and an assistant client.
- A merge action for duplicate clients.
- Team stores that sell digital goods, with the creator's share paid like project earnings.
- The items moved in §11.4.

### 12.2 Phase 3: Networks

- Teams share pools of vetted freelancers, and records travel with the person, with their consent.
- Clients find teams by need inside the assistants, not only by name.
- Networks stays a directory that teams choose to join, showing facts they choose to publish. Payleor never matches, ranks or vouches for anyone (§10). Even so, it probably makes Payleor a platform for EU seller reporting (DAC7), so it needs legal advice before it is built.

## 13. Edits to approved specs on approval

- **Services spec:** title and §1 ("Payleor Services"); §2 goal 2 (clients can also act through an assistant with a Payleor account), goal 4 (the public API and outgoing webhooks after Nov 12, if §15 question 4 is accepted) and the non-goals (link-only clients stay supported; the intake agent moves into scope); §3 decisions (catalog, intake agent, hiring from assistants; sponsors: AG Grid tables as in §8, Render and Postman after Nov 12); §4.1 (titles and departments); §4.3 settings (`assistant_hiring`, `requests_channel_id`, `client_tiers`); §5.2 (the assistant source); §8.4 (`/project draft`); §9 web surfaces (catalog settings, client list, records, drafts); §12 schedule (replaced by §11 here); §13 open items.
- **Platform spec:** the products line ("Services"); §8.1 authorization (auth spec §6); §8.2 the client tool group; §9.1 the intake agent row; §11 data model:
  - new tables `services_department`, `services_offering`, `services_member_department`, `services_client`, `intake_draft`;
  - new columns `services_team_member.title`; `project.offering_id`, `project.client_id`, `project.source` (`web`, `discord`, `api`, `assistant`); `quote.sent_by_agent`; `deadline_at_submission` on the delivery table that the deliveries plan adds; `services_team_settings.assistant_hiring`, `requests_channel_id`, `client_tiers`;
  - the existing `pending_actions` (platform spec §8.3) also holds client confirmations.
- **Auth federation spec:** §6 (the `projects:client` scope and tokens without a team); §10 phasing (MCP authorization before A2).
- **Code copy:** "Payouts" becomes "Services" as a product name in `apps/web/src/app/(site)/page.tsx` and `apps/web/src/components/site/payouts-pricing.tsx`. The Payouts pages for freelancers keep their name.
- **Parallel execution plan:** new workstreams for the plans this proposal creates: catalog and titles (§4); clients, grades and records (§5); MCP authorization and client tools (§6); the intake agent (§7). Each gets its own plan.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Five weeks for the full Services flow plus MCP and the intake agent | Commerce narrows and runs only in parallel (§11.2); the API, webhooks and reconciliation move after Nov 12 (§11.4); stretch work is named |
| Assistants call tools in ways the demo did not expect | Text responses for every tool, the confirm step for binding decisions, evaluations in §9, and the walkthrough in both assistants |
| Public listing in ChatGPT or Claude needs review | The demo runs as a custom connector; listing is requested after Nov 12 |
| Clients' own assistants may do small jobs themselves | The catalog and the intake agent target work a general assistant cannot finish alone; the pitch says so (§1) |
| The two-entry plan may not count as "substantially different" | Ask the hackathon manager before Nov 2; without a yes, submit Services only |

## 15. Open questions

1. **Earnings hold:** a per-team number of days between completion and the earliest payout, to limit losses from disputes after freelancers are paid (default 0)?
2. **Automatic quotes (§7.4)** in the Nov 12 build, or manager review only?
3. **Team cut per freelancer or per rank (V11)?**
4. **The public API and outgoing webhooks after Nov 12 (§11.4):** acceptable for teams that run their own bots?
5. **Grades for clients:** should clients see their own grade as a perk, or only the team?

## 16. Evidence for the pitch

This is not engineering work, but the accelerator pitch depends on it.

- Ask 10 former clients how they got their last job done, and whether they would have hired a team from inside ChatGPT or Claude.
- Interview 10 team owners: monthly volume, how they collect payments today (Friends and Family, invoices), and what breaks.
- Get 2 or 3 teams to run a sandbox project before Nov 12, and use their numbers and a quote in the README and the video.
- Request PayPal's live approvals for the partner account and for Payouts right after Nov 12 (research §4, services spec §3).
- Confirm with the hackathon manager (janet@devpost.com) that two entries from one codebase qualify.
