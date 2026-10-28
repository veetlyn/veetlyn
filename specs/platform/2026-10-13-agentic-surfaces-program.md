# Agentic surfaces: program for the hackathon

**Original program history (superseded where the Current amendment differs):** 2026-10-13. **Status:** approved by Mouhamed on 2026-10-13, then revised the same day after four independent reviews (codebase fit, security, program and demo, handoff) and Mouhamed's decisions: code finished by Oct 31, Slack after the hackathon, the AG Grid sponsor prize alongside the main prizes. Revised on 2026-10-14: AGPL-3.0 (§4 Submission), the agentic commerce story without the checkout protocols (§6), and Mouhamed's marketplace rules (§4.1): sellers decline with a reason or ask questions, a response deadline, two-way ratings and public reviews, seller profiles with a portfolio, and Discord request threads. Revised again on 2026-10-14: the mall (run M), where the client's AI browses Payleor stores and fills a cart and the client checks out on Payleor with PayPal (§4, §6). Each run gets its own design and plan.

**Goal that decides every trade-off:** a demo video under 3 minutes and the sandbox app live at our domains (`payleor.com` for the platform, `payleor.app` for seller pages and portals), submitted on Devpost before **Nov 12, 2026, 12:00 pm PST**. Code is finished by **Oct 31**, because the AI tooling subscriptions end around Nov 1 (`../archive/platform/plans/2026-10-07-hackathon-one-flow.md`).

**Original scope:** replaces the run order after 5b-1 in the sellers design (§11). The Discord design (`2026-10-13-discord-ticket-flow-design.md`) was the source for the now-cancelled run E.

## Current amendment (Mouhamed, 2026-10-27; recorded Oct 28)

This amendment takes precedence over the original program and its old target dates. **Cancel M, E and AG Studio for this delivery. Keep V, P and useful D agent work.** The current design is [Calls and the agent](2026-10-27-calls-and-agent-design.md): one contextual agent whose environment changes with business state, account/workspace/section/record scope, RBAC/ACL and the team's rulebook. The state machine and `perform` remain authoritative; an LLM neither invents transitions nor receives authority merely because context widened.

B1 is built and walked on staging with [explicit coverage gaps](plans/2026-10-27-b1-staging-walkthrough.md), not yet recorded merged or verified on production. The agent runtime, scope graph, dynamic handles and call routing are planned additions. B2 remains independent public API/key/webhook work. Do not infer implementation from the prototypes.

There are two submissions: the existing PayPal commerce story and the Meta Startup-track agentic dash built during Oct 27–Nov 4. The latter uses Meta credits with Muse Spark through the Claude Agent SDK (runtime/compatibility still to validate); see the [supplied participant guide](../hackathon/meta-ai-hackathon-participant-guide.md). Existing functionality is background, not new Meta-window work. V/P remain priorities, but no revised per-run dates or full delivery promises have been approved.

## 1. Positioning

AI tools (Claude, Lovable, Bolt, v0 and specialised generators) now produce generic outputs in minutes. People still pay for judgment, accountability, expertise, integration, the last stretch AI gets wrong, and an ongoing relationship. Sellers become human and AI studios, and some become fully automated agents.

Payleor is the money flow and the trust around paid work: quote, pay, deliver, accept, resolve, pay out. It works the same whether a person, a person with AI tools, or an agent does the work. The cheaper outputs get, the more acceptance, recourse, evidence and refunds matter. Payleor is never a party to the deal: the team is the merchant and PayPal moves the money.

- **When your AI needs a professional, it hires through Payleor.** The client's AI searches the sellers who chose to be listed and hires one through the Payleor plugin.
- **Offerings say how they are fulfilled:** by people, automated, or both. Buyers always see it.
- **The contextual dash helps the team operate its paid work.** Payleor prepares or executes only eligible actions within the chosen mode, and explains what a record waits on. Cross-store shopping (M) is cancelled for this delivery.
- **AI can hire AI.** Any team can plug its own agent into Payleor through the API and webhooks. The buyer still approves every payment in PayPal, and the team's payout rules still apply.

## 2. Surfaces

| Surface | Who is there | What they do | Agent there | Before Nov 12 |
|---|---|---|---|---|
| Client's AI (Payleor plugin for Claude and ChatGPT, MCP Apps) | Clients | Search listed offerings (with ratings), request, answer the seller's questions, see quotes or a decline, accept and pay (widget buttons), follow, accept delivery, rate and review. | The client's AI calls Payleor's read and request tools; commitments need a widget button, and checkout opens Payleor in a new tab | C built; M cancelled |
| Web: seller page (profile with ratings, reviews and portfolio, store products), client page, pay page | Clients | Request, answer questions, accept, pay, review and rate | The contextual agent drafts questions or quotes in the request scope | Yes |
| Web: dashboard | Team admins and members | Browse records, search, read results and act through contextual calls | One contextual agent, scoped to the current work | Current design; D / contextual agent, plan pending |
| Optional chat channels | Teams that choose them | The same authorized calls and replies through Chat SDK adapters | Same contextual agent | After the dash; dedicated run E cancelled |
| Public API and webhooks | Teams' own agents | The same actions as the web | The team's own | Minimum (run B) |
| Slack | The team only | Support, disputes, financial results, payout approvals, alerts | Ops assistant | After the hackathon |

A project records the client's home surface (web and email, Discord, or their AI). Notices to the client go there, and clients whose home is their AI also get email, because ChatGPT and Claude cannot receive pushes; the widget shows the current state on the next tool call.

## 3. Architecture principles

1. **Core** owns money and projects and knows nothing about chat or agents. A client is a contact with identities (email, Payleor account, Discord user).
2. **Action catalog:** every action that changes something, typed with zod, with who may perform it. The web, the API, MCP, Discord and the agents call the same `perform`; agents use it as their tools.
3. **Query catalog:** reads for screens and agents (project status, offerings, team results).
4. **Actors and authority:**
   - Every action records the actor (a person, a client holding a link, an API key, an agent acting for a person), on whose behalf, and the surface.
   - **A member of the project's team is never its client**, whatever link, contact or email they hold.
   - Only identities Payleor verified count (an email whose link was clicked, a Discord user who interacted, a signed-in account).
   - Agents read only authorized data and draft in Ask me; Manual leaves action to the person. Auto may execute only explicitly permitted business transitions under a team rule and its limits, through the same `perform` checks and action log. Client commitments remain widget-confirmed and the payer always approves checkout in PayPal; an API key never acts as a client. Auto does not grant permission by itself.
   - Accepting a quote or a delivery from an AI client needs a press on a Payleor widget button (a tool only the widget can call), so the model cannot commit for the client.
   - Every payment needs the payer's PayPal approval on the pay page.
5. **Delivery:** the outbox and one delivery pipeline with targets (email, webhooks, Discord; Slack later). Discord is never called inside a database transaction.
6. **Hosts:** Cloudflare Workers (Workers Paid) deployed with Alchemy. `payleor.com` carries the platform hosts (`dash.` after the rename, the api Worker, OAuth and MCP endpoints), `payleor.app` carries seller pages and portals as subdomains. The demo runs on these hosts in the PayPal sandbox.

## 4. Runs (code finished Oct 31)

Each run is about two days of subagent work with review, merge and walkthrough. Dates are targets; the run board in `../PROGRESS.md` tracks the real state.

| Dates | Run | Delivers |
|---|---|---|
| Oct 14–15 | **S: plugin spike** (in parallel with A1) | A throwaway MCP server on the tunnel with Better Auth as the OAuth provider and one MCP Apps widget, connected in Claude and in ChatGPT; a widget button that opens a sandbox `/pay/{token}` page through the host's open-link request. Output: a facts note and go or no-go per AI client, before run C is designed |
| Oct 14–15 | **A1: action registry** | Registry, `perform`, actors, `ActionError`, action log, for the actions the demo and the later surfaces use (`2026-10-13-action-catalog-design.md`) |
| Oct 16–17 | **A2: client contacts** | Contacts and verified identities replacing the project's client columns, revocable client links tied to a contact, the client rule (team members excluded), the safe migration |
| Oct 18–19 | **H: hosts and first deploy** | The `dash.` rename; the first deploy to our domains in the sandbox (both Workers, database, webhooks registered, PayPal return URLs) through a GitHub Actions deploy workflow (Alchemy, state in Cloudflare, a narrowly scoped Cloudflare token and the env values as repository secrets); the sandbox partner app renamed from "Test Store" to Payleor. Every later registration (OAuth clients, Discord, PayPal) uses the final hosts, and browser agents check the stories there |
| Oct 20–23 | **C: client's AI plugin** | MCP server and widgets on the deployed hosts (`api.payleor.com/mcp`): offering search over listed sellers (listed by default, opt-out per offering and department), request, status, competing quotes with per-freelancer widget slides, widget-only accept buttons, pay through the pay page, client accounts with OAuth (A2 contacts as the identity). Conversations v1 in core and on every surface: the seller's freelancers ask questions and the client answers (client page, plugin card), the seller declines with a reason the client sees, freelancers are shortlisted per request. The client and pay pages move to the team's `{slug}.payleor.app` site; a minimal client home on payleor.com shows the signed-in client's projects across teams. Design: `2026-10-15-c-plugin-design.md`; plan: `../archive/platform/plans/2026-10-15-c-plugin.md` |
| Oct 24–25 | **B: delivery and API (minimum)** | The delivery pipeline (outbox delivery table, queue, cron catch-up) with email (client notices, Cloudflare Email first) and signed webhooks; API keys with explicit permissions; the endpoints an AI seller needs; payout events in the outbox; the offering fulfilment type; the response deadline (a seller acts on a request within 48 hours of publication: a reminder, then the request expires and the client is told) |
| Cancelled Oct 27 | **M: the mall** | Cancelled for this delivery; no cross-store product search/cart/checkout/tracking run |
| Cancelled Oct 27 | **E: Discord** | Dedicated Discord flow cancelled for this delivery; existing S2 integration remains, optional Chat SDK adapters after the dash |
| Replan | **D: contextual agent** | One agent for intake proposals, scoped business/money questions and eligible actions through `perform`; event-driven calls and Manual / Ask me / Auto. AG Studio cancelled. Design: [Calls and the agent](2026-10-27-calls-and-agent-design.md); implementation plan pending |
| Oct 30 | **P: reputation and profiles** | Two-way star ratings after a completed project (client rates seller, seller rates client), the client's public review, the seller profile on the seller page with ratings, reviews and portfolio items, ratings in the plugin's offering cards |
| Oct 30 (if time) | **AI seller** (optional) | A separate Worker that uses only the public API and webhooks: quotes a fixed price and delivers an image at once |
| Proposed 2026-10-19, needs a slot | **V: web visibility and Discover** | Web SEO on every plan (Mouhamed, 2026-10-19): structured data on each seller page (Service, Product, Offer, LocalBusiness, FAQPage as JSON-LD), canonical and Open Graph tags, a sitemap and an `llms.txt` per seller, robots that allow the AI crawlers; the Discover page on payleor.com over the same offering and product search the connector uses (categories, type, who does the work, price), with Discover sales counted toward the network fee like sales from the client's AI |
| Oct 31 | **Freeze** | Full walkthrough of the demo on the deployed hosts; features end |
| Nov 1–12 | **Submission** | Fixes only; demo seed data; README, Devpost text, tools list, testing access; the repository made public under AGPL-3.0 (decided 2026-10-14, `../PROGRESS.md`); the video |

**Current cut decision:** M, E and AG Studio are already cancelled, rather than optional tasks to begin if time remains. Retain the contextual-agent core and V/P priorities; defer optional channels and extra visual polish before compromising authorization, payment safeguards or the demo's state consistency. The optional external AI seller remains optional; it is not the contextual agent.

### 4.1 Marketplace rules (Mouhamed, 2026-10-14)

- **Answering a request:** besides quoting, a seller can ask the client questions or decline the request with a reason the client sees.
- **Availability and presence:** a seller acts on a request (quote, ask, decline) within a set time after it is published, 48 hours by default, and does not stay inactive beyond a set period. Run B builds the 48-hour deadline with a reminder and expiry; the inactivity rule (and unlisting inactive sellers from the directory) comes after the hackathon.
- **Reputation:** clients and sellers rate each other in stars after a completed project; the client's review of the work is public. Ratings count only on paid, completed projects.
- **Profiles:** clients see a seller's profile with ratings, reviews and portfolio.
- **Discord (deferred):** the request-thread/private-channel requirement is historical scope, cancelled with E for this delivery. Future optional selected-channel adapters use Chat SDK after the contextual dash.
- **Every surface:** the conversations design (`2026-10-14-conversations-design.md`) puts these spaces in core (a request space for staff and the team's eligible freelancers, a project space for the client and staff that the accepted freelancer joins) and shows them on the web, in the plugin, by email, through the API and, when implemented later, optional chat channels.

**After the hackathon:** a single-tenant self-host mode in the same AGPL codebase; listing the plugin in the ChatGPT and Claude directories; the Commerce checkout protocols (§6); Slack ops; Discord amendments, payouts, `/ask` and archiving; the payout fixes in the backlog; full books (journal, statements, reconciliation, reserve); billing; moving use cases to domain errors; cases and disputes.

## 5. Demos (separate submissions)

**PayPal:** retain the service hire through the existing client plugin, quote acceptance and PayPal checkout, delivery on the web, balance/completion and member payout. Show the business rules and human payment approval. The old mall and dedicated Discord/AG Studio steps are cancelled; do not promise them in the video. AGT-30 is the final end-to-end check.

**Meta Startup track:** demonstrate the newly built contextual agentic dash, not the pre-existing platform as new work. A payout request opens or joins a call; the agent explains eligible versus held amounts, prepares the allowed action, and refreshes the record/call after the authorized transition. Bring a project into the call to show the environment changing while access remains enforced; show a request where the same agent prepares questions or a quote. Auto is demonstrated only for a rule/transition whose authority and limits have been explicitly designed and verified. Current reference: calls design §10; walkthrough stories AGT-55–60. This is a target, not evidence of a built runtime.

## 6. Hackathon deliverables and prizes

- **Targets:** a grand prize or the Best Use of Agentic Commerce and Best Use of PayPal + AI honorable mentions. AG Studio and its sponsor-prize integration are cancelled. Meta is a separate Startup-track submission (supplied guide), not a PayPal sponsor prize.
- **Agentic commerce story** (decided 2026-10-14, `../PROGRESS.md`): an AI assistant runs a whole service hire (search, brief, request, quote, accept), a person approves every payment in PayPal on the pay page, the seller delivers, and the payout rules pay the team; AI sellers sell on the public API, so AI can hire AI. The mall (run M) is cancelled for this delivery. The checkout protocols (ChatGPT Instant Checkout with ACP and Braintree Agent Ready, Google's UCP, PayPal Store Sync and the Cart API) stay out until after the hackathon: they sell physical goods from a catalog, are open to selected partners only, and need early access we do not have. They belong to the dormant Commerce product ([`research.md`](../archive/platform/research.md) §3, [`2026-10-14-plugin-spike-facts.md`](2026-10-14-plugin-spike-facts.md)).
- **PayPal surface shown:** Orders v2 with JS SDK v6 on the pay page, partner onboarding and platform fees, webhooks, Payouts with the payout rules, the reporting API through agent-toolkit, human approval before every payment.
- **Submission checklist** (`../hackathon/README.md`): working project on the deployed hosts, text description, tools list, public GitHub repository with all source and a licence GitHub detects, testing access (sandbox accounts, how to connect the plugin, free until Dec 15), a public YouTube video under 3 minutes with no third-party music, English throughout, the note that the project started after Oct 1, 2026.
- **Judges may score from the description, images and video alone,** possibly with automated AI analysis: the README and the Devpost text are first-class deliverables.
