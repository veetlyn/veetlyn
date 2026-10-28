# The agentic dash

> **Current scope, 2026-10-28:** Supporting reference, superseded where [Calls and the agent](2026-10-27-calls-and-agent-design.md) differs. There is one contextual agent, not a hierarchy of module agents. M, E and AG Studio are cancelled for this delivery. UI prototypes are not implementation evidence.

**Date:** 2026-10-16. **Status:** sections approved by Mouhamed one by one in brainstorming on 2026-10-16; written document awaiting review. **Replaces** the program's run list after A2 (§10) and run D's separate agents; **builds on** the action registry ([`2026-10-13-action-catalog-design.md`](2026-10-13-action-catalog-design.md)), conversations ([`2026-10-14-conversations-design.md`](2026-10-14-conversations-design.md), kept with three additions, §5), the plugin spike ([`2026-10-14-plugin-spike-facts.md`](2026-10-14-plugin-spike-facts.md)) and the architecture reference ([`2026-10-16-architecture.md`](2026-10-16-architecture.md)).

## 1. Goal

Payleor becomes a specialised agent harness for paid work: one agent, its tools, its permissions, its money rails and its event loop, shown wherever people work. The dashboard is the agent's interface. Who you are and which workspace you are in decide what you see; each section of the sidebar is a specialisation of the same agent (intake, disputes, payouts…), not a separate bot. People tap more than they type: the agent proposes, components carry the decision, a person's tap commits. Sessions of work wait for events and wake when they arrive, so the agent comes back to you instead of you checking on it. The Claude and ChatGPT plugin is the same dash for someone else's agent.

## 2. Decisions (Mouhamed, 2026-10-16)

| Topic | Decision |
|---|---|
| Ambition | The agent is the main way into Payleor for the hackathon; it replaces runs D, B (except its event pipeline), E, M and P before the freeze (§10) |
| Interaction | Tap first, type when you want: designed components with buttons; chat is optional (⌘K) |
| Shape | An agentic dash: workspace switcher, sidebar of specialisations, sessions triaged by **Needs input**, **Working**, **Completed**, nested under projects |
| Who | One dash on `dash.payleor.com` for every signed-in person; the workspace is the context (a team as staff, a team as freelancer, "Me" as client, a store) |
| Runtime | Approach A: Postgres holds the truth (sessions, waits, triage); the Cloudflare Agents SDK runs conversations (one Durable Object per session) |
| Model | Claude through Cloudflare AI Gateway with the platform's key: Haiku 5.5 for fast work, Sonnet 5.5 for drafting and insights |
| Step kinds | Every agent step is a **rule**, **classify**, **retrieve** or **generate** step (§6.3); most are rules |
| Components | json-render catalog (zod), designed per use case, not generic cards; two densities and all states (§4) |
| Push | Inbox (sessions), email and web push in the first version; Discord, Slack (Chat SDK) and webhooks later on the same events |
| AG Grid | AG Grid Community and AG Charts Community (MIT) where the dash needs tables and charts; no AG Studio |
| Frontend | A visual overhaul (run V) runs in parallel with H and A2; mockups reviewed before building (§9) |
| Not adopted now | Void (announced 2026-10-15; D1-based, no Hyperdrive or Alchemy story); Turborepo stays |

## 3. Workspaces and sections

`dashSections(workspace, roles)` in core decides which sections show, from memberships and the services-team permissions (`packages/core/src/services-teams/permissions.ts`). The sidebar, ⌘K's scope and the agent's tools all read it.

| Workspace | Who | Sections |
|---|---|---|
| A team | Admins, managers | Intake · Projects · Disputes · Payouts · Catalog · Insights · Settings |
| The same team | Freelancers | Open requests · My work · Earnings |
| Me | Anyone signed in, as a client | My projects (every team) · Payments · Disputes |
| A store | Store staff | Products · Orders · Settings |

- The top of the sidebar is the **workspace switcher** ("Me" plus each team and store) and the **triage** of that workspace's sessions (§6.1).
- Each section page has three layers: the section's sessions that need you, the section's content (today's pages, moved under the new navigation), and ⌘K scoped to the workspace, the section and the open record.
- Routes: `dash.payleor.com/{slug}/{section}/…` and `dash.payleor.com/me/…`.
- **Guests** on `{slug}.payleor.app` meet the concierge (§6.4): offerings and a request built by tapping; signing in lands them in "Me".
- **No-account client links** (`/c/{token}`) open a single-project view built from the same components as "My projects".

## 4. Components

A catalog in `packages/ui/agent-components`, defined with json-render and zod. The catalog is the contract: every surface renders only what is in it, and every prop is validated before rendering.

| Component | Job |
|---|---|
| RequestBuilder | The offering's intake questions as a guided flow of tappable choices, text only where needed, and a preview of what the team sees |
| QuoteCompare | One slide per freelancer (swipe on phones): avatar, title, price, days, lines that expand; one Accept per slide with the next step spelled out |
| Quote | Lines, deposit and balance, delivery date; Accept and Ask in reach, Decline one step away |
| ProjectStatus | A live timeline from request to payout, with the next step and who it waits on |
| Conversation | One space's thread, saying who reads it, masking contact details as you type, with ready-made replies |
| Question | Free text or structured (choices, yes/no, date, budget range), so clients usually answer with a tap |
| Delivery | A file or link preview, then Accept or Request changes with the note inline |
| PayButton | The amount, what it covers, PayPal's brand; opens the pay page and reflects the result live |
| EvidencePack | The dispute timeline with each proof ticked, the drafted response, Copy for PayPal |
| Approval, PayoutRequest | Amount, member, the rule that applied, balance after; Approve in one tap, Reject one step away |
| SessionPlan, SessionRecap | The live plan of a session and the summary when it needs you (§6.1) |
| Table, Chart | AG Grid Community and AG Charts Community in our theme, filterable from ⌘K |
| Notice | Anything else worth a line |

- **Two densities:** compact (triage, ⌘K replies, the Claude or ChatGPT widget) and full (the section page). **All states:** loading, stale (refreshed in place), done, error, empty. Light and dark, phone first, keyboard and screen reader ready; the widget version follows the connector UX rules ([`2026-10-14-connector-ux-guidelines.md`](2026-10-14-connector-ux-guidelines.md)).
- **Actions** a component carries: `perform(action, input)` (one registry action as the person pressing it), `open(url)`, `ask(prompt)` (a follow-up to the agent), `edit(form)` (the record's form, prefilled).
- **The server builds every component that carries data.** Builders in `packages/api` turn records into components; the model never writes an amount, a name or a button.
- **Every component carries its record's version;** a press re-checks it and refreshes a stale component instead of acting.
- **Payments always leave the component** for the pay page and the payer's PayPal approval. Commitments from Claude or ChatGPT need a press on the widget's button.
- **Rendering:** natively on the dash and seller sites (json-render's React renderer, our components); in Claude and ChatGPT as `structuredContent` drawn by one MCP App widget that bundles the same renderer; as a summary with a deep link in email and web push; mapped to Chat SDK cards for Discord and Slack later.
- **Quality bar:** each component gets a mockup reviewed by Mouhamed before it is built (§9).

## 5. Conversations before the quote

The conversations design stands as written: the request and project spaces, open mode, message kinds, the actions, `conversationAccess`, masking, the 48-hour rule, the client's view grouped by freelancer, the plugin's summary and `reply`. Its web surfaces move into the dash (the Open requests board is the freelancer's **Open requests**; the staff Request and Project tabs are views in **Intake** and **Projects**; the client page is **QuoteCompare** and **Conversation**). Its Discord section gives way to the Chat SDK path after the hackathon. Three additions:

1. **Structured questions:** `conversation_message.answer_schema` (jsonb, nullable) on a `question`, and `answer_value` (jsonb) on its `answer`. Free-text questions stay.
2. **The intake agent proposes questions and drafts quotes;** a person sends each one (§6.2).
3. **Notices are batched:** at most one email and one web push every 15 minutes per project and per person, summarising what happened.

The flow: a request arrives (RequestBuilder, the plugin) → an intake session starts (§6) → the agent proposes the missing questions, structured, and staff or a freelancer sends them → the client answers by tapping (dash, phone push, widget) → the session wakes and drafts the quote → staff or the freelancer sends it (several in open mode) → the client compares, accepts and pays the deposit → the winner joins the project space. Decline with a reason is open to staff at every step.

## 6. Sessions and the agent

### 6.1 Sessions and triage

A **session** is one piece of work on a record: an intake, a delivery review, a dispute, a payout run, a follow-up, or an Ask thread started from ⌘K. Sessions nest under their project (the parent) and collapse like threads.

- **`agent_session`** (Postgres): workspace, project, parent session, kind, title, `waiting_on` (staff, the client, a freelancer, or nobody), `status` (`active`, `completed`), the plan (steps with their state) and the recap.
- **Triage is computed per person** by one pure function, `triage(session, viewer)`: **Needs input** when the session waits on the viewer (or a role the viewer holds); **Working** when it is active and waits on someone else or the agent is running; **Completed** when done (recent). The same intake is in staff's Needs input and in the client's Working.
- A team session leaves every staff member's Needs input as soon as one of them acts; the action that a session waits for resolves it from any surface.
- **Inside a session:** the live plan (✓ brief read · ✓ 2 questions sent · ⏳ waiting for the client · ○ draft quote), the recap when it needs you, and a side rail (the record, who is involved, what the agent used).
- **Follow-ups:** the agent suggests a related session ("The balance has been due for 3 days. Send a reminder?"), started with one tap. ⌘K side questions open a side thread without disturbing the session.

### 6.2 Events wake sessions

- **`session_wait`** rows say what a session awaits: an event type and the record it concerns ("answers on project X", "payment captured", "delivery submitted"), or a deadline (the 48-hour rule, a payday, a reminder).
- The **event pipeline** reads the outbox (`packages/db/src/schema/outbox.ts`, written in the same transaction as each change; nothing reads it today). For each event: a session that awaits it **wakes** and takes its next step; an event no session awaits **starts** one when a rule says so (a new request starts an intake, a dispute starts a dispute session); then email and web push announce moves into each person's Needs input, batched (§5).
- Waking is idempotent by event id (the wait records the event that consumed it); the cron re-wakes sessions stuck in Working and fires deadlines.
- **Writes are proposals.** The agent never runs a commitment or a post. It returns a component with the button ("Send these 2 questions", "Send quote $350"); the person's tap runs `perform` with the person as the actor and "drafted by the agent" in the action log.

### 6.3 Step kinds

| Kind | Used for | How |
|---|---|---|
| Rule | Waking and starting sessions, triage, deadlines, masking, batching, payout decisions, the evidence pack, plans, most recaps | Code in core, tested as tables |
| Classify | The department or offering for a "Something else" request; which intake questions the brief answers; a client message's intent (answer, change request, acceptance, complaint); dispute risk; spam on guest requests | Haiku with a strict enum schema (zero-shot); a trained classifier later behind the same interface |
| Retrieve | Similar past projects for a quote draft; the nearest offering for a request | Workers AI embeddings, nearest match |
| Generate | Question wording, quote lines, the dispute response, Ask answers | Sonnet (Haiku for short answers) |

Every classify and generate step is logged with its outcome (sent as is, edited, dismissed, corrected): these are the labels a future classifier trains on.

### 6.4 Runtime and modes

- **Interactive** (⌘K Ask, the concierge, Insights' Ask): a `PayleorAgent` Durable Object (Agents SDK, exported by the api Worker, bound through Alchemy) per session; replies stream over a WebSocket the web Worker forwards same-origin, as it does `/trpc`. On connect, the session cookie is checked against the instance name and the agent builds its actor (person, workspace, roles).
- **Event-driven** (intake, disputes, follow-ups): the session's step runs when the pipeline wakes it; its state lives in Postgres, its thread in its Durable Object.
- **Tools** come from the registry: a read catalog (project, request thread, offerings, payouts, ledger figures) filtered by `conversationAccess` and the section's scope, and actions offered only as proposals.
- **Guests** are anonymous: public reads and creating a request, under today's request limits, honeypot and rate limits.

| Mode | Where | Steps |
|---|---|---|
| Ask | ⌘K on any page | Retrieve and generate (Haiku; Sonnet for heavy questions) |
| Intake | A request or a client's answer | Classify the department and the answered questions, propose the missing ones (generate), then draft the quote from similar projects (retrieve, generate with Sonnet) |
| Dispute | A dispute opens | The evidence pack by rule, the response drafted with Sonnet; a person submits it in PayPal |
| Concierge | Guests on seller sites | Offerings and RequestBuilder (Haiku) |
| Insights | "Unpaid projects over $500" | Filters a Table or Chart (Sonnet) |

- **Safety:** briefs, messages and answers are untrusted text given to the model as data; grants are enforced in `perform` whatever the model says; the model's output is plain text, and components are built by the server. AI Gateway applies rate limits per user and IP and a monthly budget per workspace; evlog records the mode, model, tokens and tools of each turn.

## 7. Push

- **Inbox:** the triage itself; sidebar badges count Needs input per section.
- **Web push** through the PWA we ship (`apps/web/public/sw.js`): `push_subscription` per person and device, sent from the Worker with VAPID and WebCrypto; permission asked after a meaningful moment ("Get notified when the client answers?"), never on load; a push opens its session; on an open dash the service worker refreshes the triage. On iPhones, web push needs the dash added to the home screen, and the prompt says so.
- **Email:** the existing mailer, batched (§5). Clients with only a contact and a link get email linking to their project view.
- **Claude and ChatGPT** cannot receive pushes: email covers them, and `get_sessions` returns fresh state on the next call.
- **Later, on the same events:** signed webhooks and an API for teams' own agents; Discord and Slack through the Chat SDK, where sessions post their recap components with buttons.

## 8. The plugin

The dash for someone else's agent, on `api.payleor.com/mcp` with OAuth through Better Auth on the dash host and CIMD registration, as proven in the spike:

- **Same tools:** generated from the read catalog and registry actions, filtered by `dashSections` and `conversationAccess`. A client sees "Me"; a staff member can triage their team's sessions.
- **Same components:** a text summary for the model plus the components as `structuredContent`, drawn by one widget with a versioned resource URI.
- **Same sessions:** `get_sessions` (Needs input first); opening a session returns its plan, recap and components; a request from Claude starts the same intake session the dash shows.
- **Same safety:** commitments are widget-only tools with the spike's single-use confirmation token; `reply` posts messages after the skill confirms the wording; payments open the pay page.
- Shipped as a plugin zip with its skills for Claude and ChatGPT.

## 9. Visual overhaul (run V)

Today's UI is fine for development, not for a product judged from a video. V runs in parallel with H and A2 and merges before G:

1. **Design system** in `packages/ui`: tokens for color, type scale, spacing, radius, elevation and motion; light and dark; Payleor's own look. Existing components are restyled through the tokens, not rewritten.
2. **Mockups reviewed by Mouhamed (around Oct 17–18) before building:** the shell (workspace switcher, triage sidebar, ⌘K), the session view (plan, recap, side rail), RequestBuilder, QuoteCompare, ProjectStatus, Delivery, EvidencePack, Approval, and the public pages (seller page, pay page, landing), each on phone and desktop.
3. **The shell built to the mockups,** behind the existing pages, so G plugs sessions into a finished frame.

Later runs build their screens to the approved mockups; existing pages adopt the tokens as they move into sections; the public pages are finished by the Oct 30 buffer; the widget uses the same tokens.

## 10. Placement before the freeze

| Dates | Run | Delivers |
|---|---|---|
| Oct 16–17 | **H** hosts and first deploy | As planned: main on `payleor.com` and `*.payleor.app`, the `dash.` rename, the deploy workflow |
| Oct 16–19 (parallel) | **V** visual overhaul | §9 |
| Oct 18–19 | **A2** client contacts, trimmed | Contacts, verified identities, "a team member is never the client", revocable links: the identity behind "Me" and the plugin |
| Oct 20–22 | **G** agentic dash foundation | The event pipeline on the outbox; `agent_session`, `session_wait`, triage, wake and start; the dash shell with sections and ⌘K; the component catalog and its first components; web push; batched email |
| Oct 23–25 | **C** conversations and intake | The conversations design with structured questions; Intake, Open requests, My projects; the Agents SDK and AI Gateway; intake sessions; ⌘K Ask; the 48-hour deadline as a session wait |
| Oct 26–27 | **L** the plugin | The spike ported onto `perform`, the components widget, `get_sessions`, packaging for Claude and ChatGPT |
| Oct 28–29 | **D** disputes and insights | Dispute sessions (handling `CUSTOMER.DISPUTE.*` webhooks, the evidence pack, the drafted response), Insights with AG Grid and AG Charts Community, the concierge |
| Oct 30 | Buffer | Demo seed, rehearsal, fixes, public pages |
| Oct 31 | **Freeze** | The full demo on the deployed hosts |

- **Dropped or moved after the hackathon:** M (the mall) dropped; P (ratings and profiles), E (Discord, now through the Chat SDK) and the rest of B (API keys, webhooks, the AI seller) after the hackathon. B's event pipeline moves into G and its deadline into C.
- **Cut order if a run slips:** Insights' Ask (tables stay), the concierge, staff triage in the plugin (the client flow stays), the drafted dispute response (the evidence pack stays), web push (email stays). Never cut: the deploy, sessions and triage, intake, the plugin's client flow, the pay page.
- **Risk:** G is the heaviest run; if it slips a day, D absorbs it through the cut order.
- **Documents this changes once approved:** the program's §4 (runs) and §5 (demo); run C's design (its client home becomes "Me"; its MCP and OAuth decisions stay) and its plan (replaced); the A2 plan (trimmed); the stories (remapped to the new runs, new stories for the dash, the mall and ratings stories moved to later); PROGRESS (run board, Now, decisions log).

## 11. Failures

The dash works without the model: every proposal has a manual path (the quote form, the question box, the evidence pack without the drafted response).

- **Model error or timeout:** AI Gateway falls back; if that fails, the session says "The assistant couldn't finish this step" with Retry, and the manual path stays one tap away.
- **Budget reached:** agent features pause with a notice; everything else continues.
- **Stale proposal:** the component refreshes instead of acting.
- **Wake delivered twice or lost:** idempotent by event id; the cron re-wakes stuck sessions.
- **Durable Object unavailable:** the triage renders from Postgres; the turn retries.
- **Expired push subscription (410):** deleted.
- **Guest abuse:** rate limits per IP and session; nothing is written without a person's tap.

## 12. Testing

No live model in CI; each test at its strongest boundary.

- **Core tables:** `dashSections`, `triage` (state per audience as a session moves), wake routing (awaited event wakes, unawaited event starts), structured answer schemas.
- **Use cases with the real database:** an event starts or wakes the right session with the right state per audience; acting from any surface resolves it for everyone; batching; conversations as their design lists.
- **Agent turns with a scripted model:** fixed tool calls; proposals become components, writes become proposals only, grants hold.
- **Component builders:** every record state builds a spec the catalog accepts.
- **MCP:** the spike's scripted OAuth client at the boundary.
- **Model quality is evaluated, not tested:** a fixed set of briefs and disputes run against the real model by hand before the freeze (questions cover what is missing, quote shape, evidence pack complete).
- **Stories:** new AGT stories for the dash, walked on the deployed hosts.

## 13. To verify while planning

- The Agents SDK on our stack: the Durable Object binding through Alchemy, routing agent requests next to Hono, the WebSocket forwarded by the web Worker.
- json-render's React renderer in vinext and bundled in the MCP App widget.
- Claude through AI Gateway (provider, keys, rate limits, budgets).
- Web push from Workers (VAPID, payload encryption with WebCrypto).
- A Workers AI embeddings model for retrieve steps.
- `CUSTOMER.DISPUTE.*` events and the dispute read API on the sandbox (the partner features already include the dispute scopes).

## 14. Out of scope

Discord and Slack (Chat SDK, later); webhooks and the API for teams' own agents; the AI seller; the mall; ratings and profiles; a trained classifier (the labels are collected now); AG Studio; Void; replies by email, attachments in messages, editing messages (as in the conversations design).
