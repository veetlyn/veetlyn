# Hackathon plan: one flow, code finished by Oct 31

- **Status:** paused on 2026-10-07 by Mouhamed. Mental health comes first. Work resumes only if he chooses to, at his own pace, and the dates below are no longer deadlines. Replaced as the build plan by [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) (§11 runs).
- **Date:** 2026-10-07. For Nov 12 this replaces the schedule in [`../2026-10-07-services-amendments-proposal.md`](../2026-10-07-services-amendments-proposal.md) §11.
- **Why Oct 31:** the AI tooling subscriptions end around Nov 1. Nov 1–12 is for the README, the video, the Devpost form and accelerator applications, which need little AI.
- **Entry:** Payleor Services only. Commerce is not submitted.

## The flow (this is the demo video)

1. A client asks Claude or ChatGPT: "Ask Walk Crew for a quote for a daily rewards plugin."
2. Payleor's MCP tools find the team and its catalog. The client signs in once on `auth.payleor.com`.
3. The intake agent asks the missing questions, then drafts a line-item quote from the catalog and the team's past projects.
4. A manager sends the quote from the web app or Discord.
5. The client accepts in the chat and pays the deposit and the management fee on the pay page with PayPal (sandbox).
6. The freelancer delivers. The client accepts in the chat and pays the balance.
7. The payout agent pays the freelancer from the team's PayPal account through the Payouts API. Discord shows each step.

## Already built

Services teams, settings and members; Discord link and payout destination; PayPal partner onboarding; the ledger, projects and quotes; the client page.

## To build, in order

| # | Work | Target |
|---|---|---|
| 0 | Unblock onboarding: services teams stop requesting `TRACKING_SHIPMENT_READWRITE` (stores keep it) | Oct 8 |
| 1 | Pay page, Orders v2 with `platform_fees`, capture, `applyPayPalFact` for deposit, top-up and balance | Oct 11 |
| 2 | Deliveries, accept delivery, request changes, balance payment, completion postings | Oct 13 |
| 3 | Payouts API with the team's credentials (sandbox), automatic payout on completion, payout agent | Oct 17 |
| 4 | Catalog: departments, services (price range, usual days, intake questions), member titles | Oct 19 |
| 5 | Auth host (auth spec A1) and MCP authorization (`oauth-provider`, `jwt`, `mcp`, `cimd`, scope `projects:client`) | Oct 22 |
| 6 | Intake agent (Agents SDK, AI Gateway) for assistant, Discord and web requests | Oct 25 |
| 7 | MCP client tools: `find_team`, `list_services`, `request_quote`, `answer_intake`, `get_project`, `accept_quote` and `accept_delivery` with the confirm step, `get_pay_link` | Oct 27 |
| 8 | Discord updates for each step (outbox to the bot) | Oct 28 |
| 9 | Deploy on Cloudflare at `payleor.com` (the hosted demo stays up until Dec 15), move the dev tunnel off the production hosts, seed the demo team | Oct 31 |

## If time remains, in this order

1. Client grades and freelancer records (proposal §5)
2. One AG Grid table of payments and payouts (AG Grid sponsor prize)
3. The quote widget for ChatGPT and Claude

## Not for Nov 12

The Commerce entry, cases and penalties, billing, the public API and outgoing webhooks, reconciliation, the dispute agent, applications, Networks.

## Budget rules

- One fresh session per row, started from this file and the specs. Long sessions cost more on every turn.
- A subagent gets one row at a time with a focused handoff.
- Writing work (README, video script, application polish) goes to Claude Pro where possible.
- Running costs until Dec 15 stay under $10 a month: Workers Paid ($5) only if Queues stay, and a free or cheap model for the intake agent.

## What only Mouhamed can do

- PayPal sandbox app settings, and the Discord developer portal URLs once the auth host is live
- Create the public GitHub repository (a hackathon rule: public, with an open-source license GitHub detects). Droid prepares the repository; nothing is pushed until you ask
- A walkthrough after rows 2, 7 and 9
- Two or three real teams trying the flow before Nov 12 (traction for the applications)
- The video, the Devpost form and the applications
- Application dates (the accelerator application, kept outside the repository with the other personal pitch documents): Emergent Ventures this week; a16z speedrun between Oct 12 and Nov 1; Y Combinator by Nov 2 at 8 pm PT, with a rough demo recorded after row 9; register interest with Entrepreneurs First (London, Spring 2027)
