# specs/

Payleor is the money flow and the trust around paid work: freelancers, teams and AI sellers quote, get paid through PayPal, deliver and pay their members, from the web, Discord, the API or the client's own AI (Claude, ChatGPT). It is being built for the PayPal AI Hackathon (code finished Oct 31, submission Nov 12, 2026); "jendal" is the repository's code name.

This folder is enough on its own to continue the work; there is no separate handoff document. This page is its context index: what to read for each kind of work, and nothing more.

## How to read this folder

1. Read [`PROGRESS.md`](PROGRESS.md) **Now** and the run board. They name the current run and link its design and plan.
2. Read the current run's design and plan, and the [`BACKLOG.md`](BACKLOG.md) rows it owns (search for its letter).
3. Then open only what the task needs, from the table below.

Never read the whole folder, and never send a helper agent to: most of it is history. [`archive/`](archive/README.md) holds finished runs and superseded designs; open a file there only when a live document links to it. Where an archived document and a live one disagree, the live one wins.

## What to read for what

| You need | Read |
|---|---|
| Where the build stands, what is next, how a run works, the environment, past decisions | [`PROGRESS.md`](PROGRESS.md) |
| Open gaps and which run owns them | [`BACKLOG.md`](BACKLOG.md) |
| The goal, the runs to Oct 31, the cut order, the marketplace rules, the demo, the deliverables | [`platform/2026-10-13-agentic-surfaces-program.md`](platform/2026-10-13-agentic-surfaces-program.md) |
| What the app does today and how to check it (walkthroughs) | [`stories/README.md`](stories/README.md), then the area file |
| Which stories a run delivers, and the plan task that walks them | [`PROGRESS.md`](PROGRESS.md) run board (Stories column), then the run's section in [`stories/09-agentic.md`](stories/09-agentic.md) |
| Anything PayPal | [`references/AGENTS.md`](references/AGENTS.md) (rules, story template), [`references/README.md`](references/README.md) (the reference clones in `refs/`), [`platform/2026-10-07-r1-paypal-facts.md`](platform/2026-10-07-r1-paypal-facts.md) (orders, fees, webhooks, SDK v6, sandbox) |
| Architecture: hosts, Workers and bindings, packages, tenancy, PayPal and money, surfaces, background jobs, testing | [`platform/2026-10-16-architecture.md`](platform/2026-10-16-architecture.md) |
| Security: audit findings and their priority, and the controls that passed | [`platform/2026-10-16-security-audit.md`](platform/2026-10-16-security-audit.md) |
| Sign-in, accounts, OAuth for stores and MCP clients | [`platform/2026-10-06-auth-federation-design.md`](platform/2026-10-06-auth-federation-design.md) |
| The action registry (`perform`, grants, actors, action log) and client contacts | [`platform/2026-10-13-action-catalog-design.md`](platform/2026-10-13-action-catalog-design.md) (§4 A1, §5 A2) |
| The Claude and ChatGPT plugin: MCP, OAuth, widgets, packaging | [`platform/2026-10-14-plugin-spike-facts.md`](platform/2026-10-14-plugin-spike-facts.md), [`platform/2026-10-15-c-plugin-design.md`](platform/2026-10-15-c-plugin-design.md), [`platform/2026-10-14-connector-ux-guidelines.md`](platform/2026-10-14-connector-ux-guidelines.md) |
| The dash: workspace contexts, sections, who each record waits on, drafts, the Needs you inbox | [`platform/2026-10-18-contextual-dash-ontology-design.md`](platform/2026-10-18-contextual-dash-ontology-design.md), with [`platform/2026-10-16-agentic-dash-design.md`](platform/2026-10-16-agentic-dash-design.md) for components, push, the plugin and failures |
| Conversations between clients, staff and freelancers | [`platform/2026-10-14-conversations-design.md`](platform/2026-10-14-conversations-design.md) |
| Discord (run E) | [`platform/2026-10-13-discord-ticket-flow-design.md`](platform/2026-10-13-discord-ticket-flow-design.md) (revise to program §4 first) |
| Seller plans, fees and billing | [`platform/2026-10-07-seller-pricing-proposal.md`](platform/2026-10-07-seller-pricing-proposal.md) |
| Sponsor integrations, AG Grid (run D) | [`platform/2026-10-05-sponsor-integrations-design.md`](platform/2026-10-05-sponsor-integrations-design.md) |
| Hackathon dates, rules, judging, prizes, resources | [`hackathon/README.md`](hackathon/README.md) |
| Worries about the product's direction, parked | [`parking-lot.md`](parking-lot.md) |
| How a built feature was designed, its plan, its review fixes | [`archive/README.md`](archive/README.md) |

## Live documents

`platform/` holds the program, the designs that runs still build on, and facts notes; `platform/plans/` holds only the plans of runs still to build or being built.

| Document | Status |
|---|---|
| [Agentic surfaces program](platform/2026-10-13-agentic-surfaces-program.md) | Approved 2026-10-13; the current program |
| [Agentic dash design](platform/2026-10-16-agentic-dash-design.md) | Sections approved 2026-10-16; written document awaiting review. Proposes to replace the program's runs after A2 |
| [Contextual dash](platform/2026-10-18-contextual-dash-ontology-design.md) | Parked 2026-10-18: the agentic dash is put aside for the revamp of the current screens and the plugin's widgets. Reference only |
| [Action catalog design](platform/2026-10-13-action-catalog-design.md) | Approved; A1 and A2 built; run C builds on the client contacts (§5) |
| [Conversations design](platform/2026-10-14-conversations-design.md) | Approved; built across runs C, B and E |
| [Run C design](platform/2026-10-15-c-plugin-design.md) | Approved 2026-10-15 |
| [Discord ticket flow design](platform/2026-10-13-discord-ticket-flow-design.md) | Source for run E, to revise first |
| [Plugin spike facts](platform/2026-10-14-plugin-spike-facts.md) | Final; go for Claude and ChatGPT |
| [Widget gallery](platform/2026-10-18-widget-gallery.html) | Draft 2026-10-18: the plugin's seven client cards in light and dark, each with loading, error and superseded states, on the spike's data; open it in a browser. Reference for run C's port of the widget |
| [Architecture](platform/2026-10-16-architecture.md) | Reference, from the code at `4a27fb6`; update it with any change that makes it wrong |
| [Auth federation design](platform/2026-10-06-auth-federation-design.md) | Approved 2026-10-06, not built; partly changed by run C (see its status) |
| [Seller pricing](platform/2026-10-07-seller-pricing-proposal.md) | Approved 2026-10-07 |
| [Sponsor integrations](platform/2026-10-05-sponsor-integrations-design.md) | Approved; AG Grid in run D |
| [PayPal facts](platform/2026-10-07-r1-paypal-facts.md) | Reference |
| [Connector UX guidelines](platform/2026-10-14-connector-ux-guidelines.md) | Reference: 38 rules for the plugin's tools and widgets, from Claude, OpenAI and the MCP Apps spec |
| [Run C plan](archive/platform/plans/2026-10-15-c-plugin.md) | Done: merged as `cc0e08d` (PR #13), walked through on staging in Claude and ChatGPT |
| [Site and design system](platform/2026-10-19-site-and-design-system-design.md) | The site (§1–5) built by run L; §6, the dash on the same system, still to plan |
| [Security audit](platform/2026-10-16-security-audit.md) | Review 2026-10-16; A1–A5 fixed by run H, B1–B4 taken by run C |

Finished plans (S, A1, A2, H, L and earlier) and their walkthrough evidence are in [`archive/`](archive/README.md); what each run found is in its plan's Outcome.

## Keeping this index useful

- A new design or plan gets a row in **Live documents** in the same commit (and a line in **What to read for what** if it answers a new kind of question).
- When a design is built or superseded and no run builds on it, move it to `archive/platform/` with an **Archived** line under its title, move its row to [`archive/README.md`](archive/README.md), and fix the links (`grep -rn '<file name>' specs CLAUDE.md`).
- A run is not done on the run board until its plan's Outcome is filled in. Then move the plan and its evidence to `archive/platform/plans/`, its row to [`archive/README.md`](archive/README.md), and fix the links. A plan in `platform/plans/` is always work still to do.
- New user stories go in [`stories/`](stories/README.md), not here.

## Working notes for agents

- **Sandbox payments in walkthroughs:** do not drive PayPal's checkout yourself. When a walkthrough needs a payment, open the pay page, then ask Mouhamed to pay in the PayPal popup and tell you when it is done (2026-10-08). Check the result in the database and on the pages afterwards.
- [`../CLAUDE.md`](../CLAUDE.md) is the entry point for Claude Code, with the workflow skills in `../.claude/skills/`.
