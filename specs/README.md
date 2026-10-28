# specs/

Veetlyn is the money flow and the trust around paid work: freelancers, teams and AI sellers quote, get paid through PayPal, deliver and pay their members, from the web, the API or the client's own AI (Claude, ChatGPT). The current build adds one contextual agent whose environment changes with the business state, permissions and context level. It targets both the PayPal AI Hackathon and the Meta hackathon Startup track; "jendal" is the repository's code name.

This folder is enough on its own to continue the work; there is no separate handoff document. This page is its context index: what to read for each kind of work, and nothing more.

The public name is **Veetlyn** from 2026-10-28. Earlier documents use Payleor for the same product. Existing payleor.com/payleor.app hosts remain active until a new domain is chosen.

## How to read this folder

1. Read [`PROGRESS.md`](PROGRESS.md) **Now** and the run board. They name the current run and link its design and plan.
2. Read the current run's design and plan, and the [`BACKLOG.md`](BACKLOG.md) rows it owns (search for its letter).
3. Then open only what the task needs, from the table below.

Start with the live documents below. For the current contextual-agent review, read this index, PROGRESS, BACKLOG, platform and stories; exclude every archive directory. Do not pull archived history into a helper's brief. [`archive/`](archive/README.md) holds finished runs and superseded designs; open a file there only when a live document links to it. Where an archived document and a live one disagree, the live one wins.

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
| The contextual agent, state machine, scopes, calls and the dash | [`platform/2026-10-27-calls-and-agent-design.md`](platform/2026-10-27-calls-and-agent-design.md) (current), with the node-by-node [context graph inventory](platform/2026-10-28-context-graph-inventory.md); the Oct 18 contextual design and Oct 16 dash design are supporting references only where this does not supersede them |
| Conversations between clients, staff and freelancers | [`platform/2026-10-14-conversations-design.md`](platform/2026-10-14-conversations-design.md) |
| Discord reference (run E cancelled for this delivery) | [`platform/2026-10-13-discord-ticket-flow-design.md`](platform/2026-10-13-discord-ticket-flow-design.md) (reference only; optional channel adapters come after the dash) |
| Seller plans, fees and billing | [`platform/2026-10-07-seller-pricing-proposal.md`](platform/2026-10-07-seller-pricing-proposal.md) |
| Earlier sponsor research (AG Studio cancelled) | [`platform/2026-10-05-sponsor-integrations-design.md`](platform/2026-10-05-sponsor-integrations-design.md) |
| Hackathon context | [`hackathon/README.md`](hackathon/README.md) (PayPal), [`hackathon/meta-ai-hackathon-participant-guide.md`](hackathon/meta-ai-hackathon-participant-guide.md) (Meta; supplied guide) |
| Worries about the product's direction, parked | [`parking-lot.md`](parking-lot.md) |
| How a built feature was designed, its plan, its review fixes | [`archive/README.md`](archive/README.md) |

## Live documents

`platform/` holds the program, the designs that runs still build on, and facts notes; `platform/plans/` holds only the plans of runs still to build or being built.

| Document | Status |
|---|---|
| [Agentic surfaces program](platform/2026-10-13-agentic-surfaces-program.md) | Revised 2026-10-28: M, E and AG Studio cancelled; V, P and contextual-agent work retained |
| [Agentic dash design](platform/2026-10-16-agentic-dash-design.md) | Supporting reference; the current calls/contextual-agent design takes precedence |
| [Calls and the contextual agent](platform/2026-10-27-calls-and-agent-design.md) | Current product direction; design and mockups in review, not implemented. One agent, changing environment, business transitions, RBAC/ACL; Meta Startup track |
| [Contextual-agent use-case review](platform/2026-10-28-contextual-agent-use-cases-review.md) | Independent high-effort proposal, with parent operating-model/harness synthesis; current use-case and implementation recommendations |
| [Context graph inventory](platform/2026-10-28-context-graph-inventory.md) | Draft 2026-10-28: every screen as a node from the account down, with the agent's context, tools and skills at each; the dash design starts from it |
| [Contextual dash](platform/2026-10-18-contextual-dash-ontology-design.md) | Resumed 2026-10-27 through Calls and the contextual agent; older sessions-free model superseded |
| [Action catalog design](platform/2026-10-13-action-catalog-design.md) | Approved; A1 and A2 built; run C builds on the client contacts (§5) |
| [Conversations design](platform/2026-10-14-conversations-design.md) | Web/plugin built across C/B; dedicated Discord portion E cancelled |
| [Run C design](platform/2026-10-15-c-plugin-design.md) | Built and merged 2026-10-21 |
| [Run B1 design](platform/2026-10-21-b1-operating-model-design.md) | Approved 2026-10-21 |
| [Run B1 plan](platform/plans/2026-10-22-b1-operating-model.md) | Built on B1; staging evidence recorded Oct 27; merge and production verification remain |
| [Discord ticket flow design](platform/2026-10-13-discord-ticket-flow-design.md) | Reference only; run E cancelled for this delivery |
| [Plugin spike facts](platform/2026-10-14-plugin-spike-facts.md) | Final; go for Claude and ChatGPT |
| [Widget gallery](platform/2026-10-18-widget-gallery.html) | Draft 2026-10-18: the plugin's seven client cards in light and dark, each with loading, error and superseded states, on the spike's data; open it in a browser. Reference for run C's port of the widget |
| [Architecture](platform/2026-10-16-architecture.md) | Reference, from the code at `4a27fb6`; update it with any change that makes it wrong |
| [Auth federation design](platform/2026-10-06-auth-federation-design.md) | Approved 2026-10-06, not built; partly changed by run C (see its status) |
| [Seller pricing](platform/2026-10-07-seller-pricing-proposal.md) | Approved 2026-10-07 |
| [Sponsor integrations](platform/2026-10-05-sponsor-integrations-design.md) | Reference only; AG Studio and its sponsor-prize integration cancelled |
| [PayPal facts](platform/2026-10-07-r1-paypal-facts.md) | Reference |
| [Connector UX guidelines](platform/2026-10-14-connector-ux-guidelines.md) | Reference: 38 rules for the plugin's tools and widgets, from Claude, OpenAI and the MCP Apps spec |
| [Run C plan](archive/platform/plans/2026-10-15-c-plugin.md) | Done: merged as `cc0e08d` (PR #13), walked through on staging in Claude and ChatGPT |
| [Site and design system](platform/2026-10-19-site-and-design-system-design.md) | Site built by L; the dash uses landing colours only, with Quartz structure, light relief, Cal Sans titles and Inter body per the current calls design |
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
