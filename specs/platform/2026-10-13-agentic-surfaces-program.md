# Agentic surfaces: program for the hackathon

**Date:** 2026-10-13. **Status:** approved by Mouhamed in brainstorming on 2026-10-13. Each run gets its own design and plan.

**Replaces:** the run order after 5b-1 in the sellers design (§11: 5b-2 Discord, 5b-3 books, 6 intake agent, 7 deploy, 8 billing). The Discord design (`2026-10-13-discord-ticket-flow-design.md`) becomes the source for run E.

## 1. Positioning

AI tools (Claude, Lovable, Bolt, v0 and specialised generators) now produce generic outputs in minutes. People still pay for judgment, accountability, expertise, integration, the last stretch AI gets wrong, and an ongoing relationship. Sellers become human and AI studios, and some become fully automated agents.

Payleor is the money flow and the trust around paid work: quote, pay, deliver, accept, resolve, pay out. It works the same whether a person, a person with AI tools, or an agent does the work. The cheaper outputs get, the more acceptance, recourse, evidence and refunds matter.

- **When your AI needs a professional, it hires through Payleor.** The client's AI tries the task, and when it needs accountability or expertise it hires a seller through the Payleor plugin.
- **Offerings say how they are fulfilled:** by people, automated, or both (for example "draft in 10 minutes for $29, or human-polished in 3 days for $350"). Buyers always see it.
- **AI can hire AI.** Any team can plug its own agent into Payleor through the API and webhooks. The buyer still approves every payment in PayPal, and the team's payout rules still apply.

## 2. Surfaces

| Surface | Who is there | What they do | Agent there |
|---|---|---|---|
| Client's AI (Payleor plugin for ChatGPT and Claude, MCP Apps) | Clients, and agents acting for them | Find sellers, request, compare, accept, pay, follow, accept delivery | The client's own AI calls Payleor's tools; Payleor's widgets show quotes, payment and status |
| Web: seller page and client page | Clients | Request, accept, pay, review | Intake agent; a project assistant on the client page |
| Web: dashboard | Team admins and members | Everything | Team copilot: drafts quotes, answers questions, prepares payouts |
| Discord | Businesses serving their clients in the same server | Ticket flow (a channel per project), member payouts | An assistant in the project channel (`/ask`), drafting for a person to confirm |
| Slack | The team only | Support, disputes, financial results, payout approvals, alerts | Ops assistant |
| Public API and webhooks | Teams' own agents and bots | The same actions as the web | The team's own |

Clients are never in Slack. A project records the client's home surface (web and email, Discord, or their AI), and notices to the client go there. A project started outside Discord can still get a team-only Discord channel.

## 3. Architecture principles

1. **Core** owns money and projects and knows nothing about chat or agents. A client is a neutral contact with identities (email, Discord user, Slack user, Payleor account).
2. **Action catalog:** every action that changes something, typed with zod, with who may perform it. The web, the API, Discord, Slack and the agents all call the same entry, and the agents use it as their tools.
3. **Query catalog:** every read (project status, earnings, financial results, disputes), for screens and for agents.
4. **Actors and authority:** every action records the actor (a person, an agent acting for someone, an API key), on whose behalf, and the surface. Agents read freely and draft. A person confirms anything that commits the team or moves money, except what a team has delegated (payout rules, automated offerings). Every payment needs the payer's PayPal approval.
5. **Conversation layer:** rooms, participants, cards and notices are neutral; Discord and Slack are adapters with renderers. Delivery goes through the outbox and one delivery pipeline with targets (webhook, Discord, Slack).
6. **Natural language in Discord** starts with a `/ask` command (HTTP interactions). Reading channel messages needs the Gateway WebSocket (a Durable Object) and the Message Content intent; that comes later. Slack delivers channel messages over HTTP.

## 4. Runs

| Run | Builds |
|---|---|
| A | Action and query catalog, actor model, client contacts, action log, payout events in the outbox (`2026-10-13-action-catalog-design.md`) |
| B | The generic delivery pipeline (outbox delivery table, queue, cron catch-up) with webhook and email targets (client notifications, Cloudflare Email first), public API (keys, `/v1`, idempotency, OpenAPI), signed outgoing webhooks with a delivery log, the offering fulfilment type, a demo AI seller built only on the API and webhooks |
| C | Client's AI plugin: MCP server with MCP Apps widgets, client accounts and MCP authorization (auth host), the client tools |
| D | Web agents: the intake agent and the team copilot |
| E | Discord ticket flow on the conversation layer (from the Discord design), with `/ask` |
| F | Slack ops: team-only install, payout approvals, alerts, ops assistant with financial results from the ledger; the payout fixes from the backlog |
| G | The `dash.` rename, deploy, seeded demo sellers, the video. Before it, a maintenance batch for the minor backlog items if time allows |

After the hackathon: full books (journal, statements, reconciliation, reserve), billing, the Discord Gateway agent, cases.

Runs have taken about a day each with the walkthrough. Keep each run lean, and keep the last five days before Nov 12 for deploying, walkthrough fixes and the video.

## 5. Demo (under 3 minutes)

1. In Claude or ChatGPT: "Find someone to design a logo for my bakery, under $400, in 5 days." The plugin returns an instant AI seller ($29, now) and a human studio ($350, 5 days).
2. The user picks the studio. A project channel opens in the studio's Discord; the intake agent drafts the quote and the admin confirms it.
3. The quote widget appears in the AI; the client pays with PayPal.
4. The freelancer delivers in Discord; the client accepts in the AI.
5. The payout rules pay the freelancer automatically. In Slack the admin asks "what did we make this week?".
6. Optionally, a second purchase from the AI seller, delivered at once.
