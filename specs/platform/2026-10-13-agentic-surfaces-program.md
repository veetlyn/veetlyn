# Agentic surfaces: program for the hackathon

**Date:** 2026-10-13. **Status:** approved by Mouhamed on 2026-10-13, then revised the same day after four independent reviews (codebase fit, security, program and demo, handoff) and Mouhamed's decisions: code finished by Oct 31, Slack after the hackathon, the AG Grid sponsor prize alongside the main prizes. Revised on 2026-10-14: AGPL-3.0 (§4 Submission), the agentic commerce story without the checkout protocols (§6), and Mouhamed's marketplace rules (§4.1): sellers decline with a reason or ask questions, a response deadline, two-way ratings and public reviews, seller profiles with a portfolio, and Discord request threads. Each run gets its own design and plan.

**Goal that decides every trade-off:** a demo video under 3 minutes and the sandbox app live at our domains (`payleor.com` for the platform, `payleor.app` for seller pages and portals), submitted on Devpost before **Nov 12, 2026, 12:00 pm PST**. Code is finished by **Oct 31**, because the AI tooling subscriptions end around Nov 1 (`plans/2026-10-07-hackathon-one-flow.md`).

**Replaces:** the run order after 5b-1 in the sellers design (§11). The Discord design (`2026-10-13-discord-ticket-flow-design.md`) is the source for run E.

## 1. Positioning

AI tools (Claude, Lovable, Bolt, v0 and specialised generators) now produce generic outputs in minutes. People still pay for judgment, accountability, expertise, integration, the last stretch AI gets wrong, and an ongoing relationship. Sellers become human and AI studios, and some become fully automated agents.

Payleor is the money flow and the trust around paid work: quote, pay, deliver, accept, resolve, pay out. It works the same whether a person, a person with AI tools, or an agent does the work. The cheaper outputs get, the more acceptance, recourse, evidence and refunds matter. Payleor is never a party to the deal: the team is the merchant and PayPal moves the money.

- **When your AI needs a professional, it hires through Payleor.** The client's AI searches the sellers who chose to be listed and hires one through the Payleor plugin.
- **Offerings say how they are fulfilled:** by people, automated, or both. Buyers always see it.
- **AI can hire AI.** Any team can plug its own agent into Payleor through the API and webhooks. The buyer still approves every payment in PayPal, and the team's payout rules still apply.

## 2. Surfaces

| Surface | Who is there | What they do | Agent there | Before Nov 12 |
|---|---|---|---|---|
| Client's AI (Payleor plugin for Claude and ChatGPT, MCP Apps) | Clients | Search listed offerings (with ratings), request, answer the seller's questions, see quotes or a decline, accept and pay (widget buttons), follow, accept delivery, rate and review | The client's AI calls Payleor's read and request tools; commitments need a widget button | Yes (run C) |
| Web: seller page (profile with ratings, reviews and portfolio), client page, pay page | Clients | Request, answer questions, accept, pay, review and rate | Intake agent drafts the team's quote | Yes |
| Web: dashboard | Team admins and members | Everything; team analytics in AG Studio | Team copilot as AG Studio's agent | Yes (run D) |
| Discord | Businesses serving their clients in the same server, and teams that run their work there | A request channel or thread where the client talks with the team's freelancers, then a private project channel with the freelancer whose quote the client accepted, messages synced between them (team-only when the client is not on Discord); card, notices, `/deliver`, client buttons, confirming agent drafts | Proposal cards a person confirms | Yes, minimum (run E) |
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
   - Agents read freely and draft. A person with the right grant confirms anything that commits the team or the client or moves money; an agent never confirms, and an API key never acts as a client.
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
| Oct 20–23 | **C: client's AI plugin** | MCP server and widgets on the deployed hosts: offering search over listed sellers (sellers opt in), request, status, quote and delivery widgets with widget-only accept buttons, pay through the pay page, client accounts with OAuth. With the core actions on every client surface: the seller declines a request with a reason, or asks the client questions that the client answers (client page, plugin card) |
| Oct 24–25 | **B: delivery and API (minimum)** | The delivery pipeline (outbox delivery table, queue, cron catch-up) with email (client notices, Cloudflare Email first) and signed webhooks; API keys with explicit permissions; the endpoints an AI seller needs; payout events in the outbox; the offering fulfilment type; the response deadline (a seller acts on a request within 48 hours of publication: a reminder, then the request expires and the client is told) |
| Oct 26–27 | **E: Discord** | A request channel or thread where the client and the team's freelancers talk before a quote, and a private project channel with the freelancer whose quote is accepted, messages synced between them; a project channel for any project of a team with Discord (team-only when the client is not on Discord), the pinned card and notices, `/deliver`, the client's buttons, a card to confirm an agent's draft. Starts with the S2 real-server check |
| Oct 28–29 | **D: agents and analytics** | The intake agent drafts the quote as a proposal on any new request (any surface), confirmed on the web or in Discord. Team analytics in AG Studio with custom widgets (money flow, payouts, agent and human work) and the team copilot as Studio's agent, reading the ledger and PayPal through agent-toolkit with the team's credentials |
| Oct 30 | **P: reputation and profiles** | Two-way star ratings after a completed project (client rates seller, seller rates client), the client's public review, the seller profile on the seller page with ratings, reviews and portfolio items, ratings in the plugin's offering cards |
| Oct 30 (if time) | **AI seller** (optional) | A separate Worker that uses only the public API and webhooks: quotes a fixed price and delivers an image at once |
| Oct 31 | **Freeze** | Full walkthrough of the demo on the deployed hosts; features end |
| Nov 1–12 | **Submission** | Fixes only; demo seed data; AG Studio trial key (requested Nov 1 so it covers judging, Dec 1–15); README, Devpost text, tools list, testing access; the repository made public under AGPL-3.0 (decided 2026-10-14, `../PROGRESS.md`); the video |

**Cut order** if a run slips: the AI seller, then the Discord client buttons (the team side stays), then the request-thread sync in Discord (the private project channel stays), then the portfolio (ratings and reviews stay), then webhooks, then the AG Studio agent (the analytics page stays). Proposed on 2026-10-14 when the marketplace rules were added; Mouhamed to confirm.

### 4.1 Marketplace rules (Mouhamed, 2026-10-14)

- **Answering a request:** besides quoting, a seller can ask the client questions or decline the request with a reason the client sees.
- **Availability and presence:** a seller acts on a request (quote, ask, decline) within a set time after it is published, 48 hours by default, and does not stay inactive beyond a set period. Run B builds the 48-hour deadline with a reminder and expiry; the inactivity rule (and unlisting inactive sellers from the directory) comes after the hackathon.
- **Reputation:** clients and sellers rate each other in stars after a completed project; the client's review of the work is public. Ratings count only on paid, completed projects.
- **Profiles:** clients see a seller's profile with ratings, reviews and portfolio.
- **Discord:** a request has a channel or thread for the client and the team's freelancers; accepting a freelancer's quote opens a private project channel with that freelancer; messages sync between the two.

**After the hackathon:** a single-tenant self-host mode in the same AGPL codebase; listing the plugin in the ChatGPT and Claude directories; the Commerce checkout protocols (§6); Slack ops; Discord amendments, payouts, `/ask` and archiving; the payout fixes in the backlog; full books (journal, statements, reconciliation, reserve); billing; moving use cases to domain errors; cases and disputes.

## 5. Demo (under 3 minutes)

1. In Claude (or ChatGPT): "Find someone to design a logo for my bakery, under $400, in 5 days." The plugin lists matching offerings, an instant AI seller ($29, now) and a human studio ($350, 5 days), each labelled with how it is fulfilled.
2. The user picks the studio; the request reaches the team. The studio's Discord gets a project channel, the intake agent's draft quote appears as a card, and the admin confirms it.
3. The quote widget appears in the AI. The user presses Accept, then pays the deposit with PayPal on the pay page (the human approval moment).
4. The freelancer delivers with `/deliver` in Discord. The user asks "Is my logo ready?"; the delivery widget shows it; the user presses Accept delivery and pays the balance.
5. The payout rules pay the freelancer (seeded team: hold 0). In the dashboard, the admin asks the copilot "What did we make this week?" and AG Studio adds the widget.
6. Optional: a second purchase from the AI seller, delivered at once.

## 6. Hackathon deliverables and prizes

- **Targets:** a grand prize or the Best Use of Agentic Commerce and Best Use of PayPal + AI honorable mentions, plus the AG Grid sponsor prize (one honorable mention or grand prize plus one sponsor prize can be won, `../hackathon/rules.md`).
- **Agentic commerce story** (decided 2026-10-14, `../PROGRESS.md`): an AI assistant runs a whole service hire (search, brief, request, quote, accept), a person approves every payment in PayPal on the pay page, the seller delivers, and the payout rules pay the team; AI sellers sell on the public API, so AI can hire AI. The checkout protocols (ChatGPT Instant Checkout with ACP and Braintree Agent Ready, Google's UCP, PayPal Store Sync and the Cart API) stay out until after the hackathon: they sell physical goods from a catalog, are open to selected partners only, and need early access we do not have. They belong to the dormant Commerce product ([`research.md`](research.md) §3, [`2026-10-14-plugin-spike-facts.md`](2026-10-14-plugin-spike-facts.md)).
- **PayPal surface shown:** Orders v2 with JS SDK v6 on the pay page, partner onboarding and platform fees, webhooks, Payouts with the payout rules, the reporting API through agent-toolkit, human approval before every payment.
- **Submission checklist** (`../hackathon/README.md`): working project on the deployed hosts, text description, tools list, public GitHub repository with all source and a licence GitHub detects, testing access (sandbox accounts, how to connect the plugin, free until Dec 15), a public YouTube video under 3 minutes with no third-party music, English throughout, the note that the project started after Oct 1, 2026.
- **Judges may score from the description, images and video alone,** possibly with automated AI analysis: the README and the Devpost text are first-class deliverables.
