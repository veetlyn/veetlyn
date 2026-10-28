# Calls, the operating model and the agent harness

**Date:** 2026-10-27; reconciled 2026-10-28. **Status:** current product direction; detailed design and mockups remain in review. No agent runtime, calls schema or dynamic-permission migration is claimed shipped. Choices marked *(call)* remain proposals.

**Amends** the contextual dash ([`2026-10-18-contextual-dash-ontology-design.md`](2026-10-18-contextual-dash-ontology-design.md)), which this un-parks: its records-first model, modes (Manual, Ask me, Auto) and "Done on its own" stand; its sessions-free triage becomes calls (§3). **Builds on** B1's rulebook, outbox and scheduler ([`2026-10-21-b1-operating-model-design.md`](2026-10-21-b1-operating-model-design.md)) and the action registry ([`2026-10-13-action-catalog-design.md`](2026-10-13-action-catalog-design.md)). **Mockup:** [`../hackathon/agentic-dash-mock.html`](../hackathon/agentic-dash-mock.html).

## 1. Intent

Payleor is an applied AI agent operating in the business environment, whose available context, tools and widgets change as records transition through the existing business state machine. The **operating model** defines RBAC, ACL and the business behavior it covers; server-side evaluation remains authoritative. The **harness** assembles the authorized environment, exposes eligible tools, governs model execution and refreshes from resulting events. These are facets of one business system, not separate permission frameworks invented by the model. The interaction borrows how a team on Discord works: when something needs someone, they get mentioned, and they act where they were mentioned. Here the mention opens a **call**, and the call shows what can be done, as widgets, with the work already prepared when the team allows it.

- **One agent, Payleor.** What it can see and do depends on where it works (§2).
- **Handles** name who gets called: roles the team owner defines, like Discord roles, and people (§3).
- **Most calls come from events.** A person can also start one. Some events never need a call: they join a batch, Payleor handles them, or they are just an update (§4).
- **The dash is the main place to work.** Chat channels are optional (§8).

This is the work the Meta hackathon demo shows (Oct 27 to Nov 4, [`../hackathon/meta-ai-hackathon-participant-guide.md`](../hackathon/meta-ai-hackathon-participant-guide.md)).

## 2. One agent, scoped by where it works

The account is the root of everything a person has. Below it are levels:

| Level | What it is | Payleor sees |
|---|---|---|
| Account | The person: their workspaces, roles, subscription, and what they buy as a client | Each workspace's summary, never inside it; their own client records *(call)* |
| Workspace | An organization and its memberships, or the mandatory personal workspace; the subscription enables supported business capabilities | Authorized projections for its sellers and records |
| Seller, when needed | The owning team/store within a workspace; keep existing seller and workspace identities distinct | Only this seller's authorized records and fields |
| Section | Requests, Projects, Money, Storefront, Team | The section's records |
| Record | A request, project, payment, payout, PayPal case, member | The record and records one link away |

- **Scope of a call or chat:** the level it was opened at. Bringing in a record from elsewhere widens it to the **lowest level that holds everything on the table**: a project plus a member of the same team is the workspace; records from two workspaces is the account. The widening is said in "Working on" (§6).
- **Reading:** permitted record and field projections only, including links, summaries, search counts and files. Context expresses relevance, never an access grant. A linked member may expose a display name without exposing their payout destination or earnings.
- **Acting:** only actions under the scope, always through `perform`, so the person's role, the section's mode and the action log apply. Money never moves without a person except under an Auto rule the team chose (PayPal rules).
- **Tools:** the action registry filtered by scope. At the account level few tools and much summary; at a record many tools on few records.
- **Model:** Claude Agent SDK on Meta Model API's Messages endpoint, `muse-spark-1.3`; the base URL, key and model are environment values, so another provider is a configuration change (§9).

## 3. Handles

- **Role handles** are created by the team owner, like Discord roles: a name and its members. A team starts with `@admins`, `@payouts` and `@sales`, seeded from the team's kind; the owner renames, adds or removes them. A member can hold several.
- **Person handles:** every member is callable by name (`@aicha`).
- **Record handles** resolve from the record: `@lead` is the project's lead, `@assignee` the freelancer on it *(call)*.
- A team of one may route its staff handles to the owner; this never permits self-approval or creates member-payout features for a solo seller.
- Handles address people and route attention; permission bundles and record relationships are defined/evaluated by the operating model. Renaming or joining an attention group does not create a grant. Show the relevant one once in “You were called as …” when it explains a call; do not repeat handles in every call row, header, person footer or action subtitle.

## 4. What an event does

The outbox (B1) carries every event. For each one the team's rules choose one of five routes:

1. **New call** to a handle: a decision with its own context.
2. **Joins the record's call:** one open call per record per handle; follow-ups land in it, like a Discord thread.
3. **Joins a batch:** one call per period gathers them (payout requests).
4. **Payleor handles it** (Auto, within the rules); it is logged under "Done on its own" and a call opens only for what falls outside the rules.
5. **Update only:** no action needed; it shows as an unread mark on the record and in the activity.

Proposed routing defaults, edited by the team. **Mode boundary:** these modes govern the new agent's discretionary preparation/execution. Until an explicit migration is designed, they do not pause or rewrite B1's existing deterministic scheduler, timers or configured automatic payout preset. “Ask me” must not imply that all platform automation stops. The UI must identify any existing scheduled send and its approval requirements separately; changing the mode alone cannot authorize a new payout or suppress an already configured engine rule. The exact precedence/migration is open in §13.

Defaults:

| Event | Called | Manual | Ask me | Auto |
|---|---|---|---|---|
| New request from a client | `@sales` | New call | New call, quote drafted | Payleor asks questions or quotes within its limits; call if it can't |
| Someone applies to join as a freelancer | `@admins` | New call | New call | New call (always a person) |
| A freelancer asks to be paid | `@payouts` | Joins the batch | Batch prepared, collect required approvals | Paid at the batch time; call for held or over-limit payouts |
| Store order that needs handling | `@sales` | New call | New call, reply drafted | Payleor sends the fulfilment notice |
| Digital store sale | none | Update | Update | Update |
| PayPal case opened | `@admins` | New call | New call, response drafted | Same as Ask me (always a person) |
| Refund request | `@payouts` | New call | New call, recommendation | Recommendation only; human executes (registry `never` for agents) |
| Client asks for changes | `@lead` | Joins the project's call | Same, price change drafted | Same |
| Member late or a rule broken | `@admins` | New call | New call | New call |
| Payment received, case won, review posted | none | Update | Update | Update |

- **Always a person:** accepting a member, answering a PayPal case, executing a refund and anything that breaks a rule open a call in every mode. A routing/mode rule never overrides an action marked `never` for agents.
- **Batches:** the team sets the period (default weekly, Friday 17:00 in the team's time zone *(call)*) or a total that sends early.
- **Where it lives:** routing, automation and authority belong to the operating model. Preserve distinct revision lifetimes for pinned accepted business terms, current permissions/delegation, and current operational automation. A mode change cannot rewrite a project's accepted terms or restore revoked access. Existing `engine-rules` is a foundation, not a shipped dynamic-permissions implementation.

## 5. Inside a call

- **Opening:** in Manual the call shows the records and their buttons, nothing drafted. In Ask me and Auto, Payleor runs once when the call opens to prepare the work (the batch, the draft quote, the case response).
- **Widgets:** built from json-render specs the server fills from the records; Payleor picks the widget and its inputs, never free-form buttons. Each button is a registry action, run through `perform` after the person presses it.
- **Talking:** the person can reply in the call; Payleor answers within the call's scope and can propose more actions as widgets.
- **Progress and closing:** routing names both the required next decision and the business outcome that resolves this call. Taking an optional allowed action does not close it. A payout call stays Needs you while required approvals remain, becomes In progress when fully approved/queued or sent, and becomes Done on settlement (or an explicit terminal outcome); one approver cannot satisfy a multi-approval rule. An intake call may resolve on quote sent when that is its named outcome. All handle members see the same record-derived progress, filtered by their own authority.
- **Started by a person:** a call with no event, at the level they are on; it has no handle and closes when they close it.

## 6. The dash

Mockups: [call](../hackathon/agentic-dash-mock.html), [record](../hackathon/agentic-dash-record.html), [payouts](../hackathon/agentic-dash-payouts.html). Shared rules: [stylesheet](../hackathon/dash-ds.css), [design sheet](../hackathon/dash-ds.html). These are prototypes, not production components. The [current correction/verification notes](../hackathon/dashboard-prototype-notes.md) distinguish fixed fixture/control issues from remaining accessibility and runtime work.

- **Design base:** Quartz structure, hierarchy and sizing, with Mouhamed's overrides: landing colours only; restrained light skeuomorphism, light gradient controls, small radii and sparse relief. Cal Sans UI for display/titles, Inter for body, labels, controls and tabular amounts. No Google Sans Flex or Montserrat.
- **Hierarchy:** one raised main working surface. The right context panel is flat inside it. Only meaningful data/actions and the first context card get the shared light double-ring treatment; explanatory text, figures and secondary lists breathe on the surface. Frames and double rules mark a real hierarchy change, never every nested section.
- **Sizing:** use available browser width and let content scroll. No fixed canvas, page-width cap, scale-to-fit or browser resizing. The shared type/spacing scale and narrow navigation take precedence over squeezing every fact into the first screen.
- **Left:** workspace switcher, contextual navigation/back link, then Calls. Calls is the section heading; **Needs you**, **In progress**, **Done** are subordinate group labels; call titles and one smaller detail line sit below them. Selected pages have a light raised state and selected calls a grey fill. Handles are not repeated as row headings; unread meaning must not rely on colour alone.
- **Centre:** breadcrumb and tools, then a clear page title. A call holds the conversation and relevant business widgets. Record/table views retain browsing, search, lifecycle and analytics; browsing does not create a call. The composer is a real growing multiline textarea with scope chip, Bring in, attachment/mention controls and a separate send row.
- **Right, what the call is about:**
  - **Working on:** what it is and why you were called ("Payleor called you as `@payouts` because 3 freelancers asked to be paid"); **Where** (Walk Crew › Money, and "widened from Baobab when you brought in Aicha"); **Who acts**, from the mode: Manual "You decide; Payleor prepares nothing", Ask me "The agent prepares; you confirm its proposed action" (show any separately configured scheduled automation alongside it), Auto "Payleor does this on its own; you are here because …" with the rule that sent it; **By** (the deadline); **Rule**.
  - **On the table:** the records in play, with **Bring in**.
  - **Done so far:** what Payleor checked or did in this call.
  - **Coming up:** the batch time, reminders, deadlines.
- **Words on screen:** Calls (not sessions), On the table (not context), Done so far, Coming up, Bring in. No "agent", "session", "scope" or "workflow" in the interface.
- **Phone:** the call full screen; Calls behind the menu; Working on behind a "Details" button.

## 7. Data

- `handle (id, team_id, name, kind role|record, created_by, created_at)`, unique `(team_id, name)`; `handle_member (handle_id, user_id)`. Person handles come from the member list.
- `call (id, team_id, handle_id, user_id, scope_kind, scope_id, record_kind, record_id, batch_key, title, status open|done, opened_by event|person, event_id, opened_at, closed_at)`; one open call per `(team_id, handle_id, record_kind, record_id)` and per `(team_id, handle_id, batch_key)`.
- `call_entry (id, call_id, kind event|message|widget|action, actor_kind person|platform, actor_id, body jsonb, created_at)`: the thread; actions also write the action log.
- `call_read (call_id, user_id, read_at)` for unread marks.
- The "Calls" rule kind in the rulebook spec (§4).

## 8. Chat channels

Optional, after the dash. Teams that want to work from Slack or Discord pick channels; the same calls are posted there through **Chat SDK** (one handler for every platform; each platform still has our app installed once). A mention there calls the linked handle; replies join the call; widgets become the platform's cards. Money actions open the dash to confirm *(call)*. Chat SDK's web adapter could also carry the dash chat itself; to check when the plan is written.

## 9. Runtime and cost

- The proposed agent runtime sits beside the Worker (a Cloudflare Container or a small Node service), since the Agent SDK needs process support to validate. It calls our API as an explicitly scoped delegated principal, never through direct database access or a shared unrestricted “team credential”. The identity, delegation grant, revocation and unattended-run contract must be approved before implementation; an outbox event is not itself authority.
- Runs happen when a call opens in Ask me or Auto and when a person writes in a call. A daily cap per team and a spend alert at $100 on the Meta account *(call)*.
- New dependencies follow the two-week rule.

## 10. The demo (Meta, 3 minutes)

1. Aicha asks to be paid: the `@payouts` call appears for Mouhamed with the batch ready.
2. He brings in Baobab from the project page; "Working on" widens and says why.
3. He provides the required approval; the batch remains in progress through the configured send and settlement, then the call closes. The action log distinguishes approval, sending and settlement.
4. He switches Payouts to Auto; the next request is paid on its own, and only Kofi's held payout opens a call, with the rule that sent it.
5. A new request reaches `@sales`; Payleor drafted questions; one tap sends them.

## 11. The model underneath

Calls, handles and levels are three views of one model (Mouhamed, 2026-10-27): a state machine per record, with roles and an access tree.

| Part | Today | Change |
|---|---|---|
| **States** | Status enums on each record (`PROJECT_STATUSES`, quotes, payments, deliveries, refunds, payouts, disputes) | none |
| **Actions (transitions)** | Project state-machine metadata and guards already exist; registry and payout router/use-case paths are not yet one tool interface | Reuse existing domain evaluators. Add full actor/record/operating-model eligibility and required-decision projections, and register demo payout actions through `perform` before agent exposure; do not duplicate transition tables |
| **Events** | B1's outbox | none; routing (§4) reads them |
| **Roles (RBAC)** | Fixed roles and current workspace inheritance; coarse action grants with deeper checks | Evaluate roles/permissions as an operating-model facet. Adapt fixed roles first; editable bundles can follow. Handles reference an authorized audience and do not become permission grants |
| **Access (ACL)** | `Scope` is a team and a project (`perform.ts`) | The scope is a node in the account tree (§2); reading is the subtree plus one link; record rules stay (a freelancer sees only their own quote) |
| **Conditions** | Rule checks inside actions (refund caps, response windows) | Unchanged; they also decide when Auto must call a person instead (§4) |
| **Who fires** | `agent: free \| confirm \| never` per action; agents refused in `perform` | The section's mode and the "Calls" rule say whether Payleor may fire it on its own; `never` stays never |

What follows from it:

- **A record waits on a handle** when its current state/rule requires that handle's next decision, not merely because a permitted optional action exists. Eligibility lists all allowed actions; a separate required-decision/outcome projection drives Needs you, In progress and Done. Routing names the resolving outcome (for example quote sent or payout settled), with remaining approvals and external waits kept visible. Both projections read the same records and pinned rules; calls never invent their own business state.
- **Payleor's tools** for a call are the actions open on the records on the table, filtered by the person's permissions and the mode.
- **Scope of the work before Nov 4:** declare `from` and permissions for the actions the demo touches (payout requests, payout batches, requests and quotes, project review); the rest follow after *(call)*. No state machine library; the statuses stay in the database.

## 12. Act and look

Calls are for acting; people also browse, search and read numbers. Both live in the same frame, and the right sidebar follows what is in the centre. Mockups: [`../hackathon/agentic-dash-record.html`](../hackathon/agentic-dash-record.html) (a record) and [`../hackathon/agentic-dash-payouts.html`](../hackathon/agentic-dash-payouts.html) (a table).

| In the centre | Centre shows | Right sidebar |
|---|---|---|
| A call | The thread and its widgets | **Working on**, On the table, Done so far, Coming up |
| A record | Its lifecycle, **What can happen now**, **What happened** | **About this project** (or payment, member…): money, people, Coming up, the rules it runs under and the pinned rulebook version |
| A table | Totals, filters by state, rows with a **Next step** column | The selection: **What you can do with them**, what Payleor checked, Coming up; folded when nothing is selected |

- **Lifecycle strip:** the record's statuses in order, done steps ticked, the current one marked, the next ones faint; under it, what the record waits on and the timer that will move it, with the rule and version.
- **What can happen now:** every action declared from the current status (§11), in three kinds: open to the viewer (a button), someone else's step ("Only Lina can do this"), and **blocked** with the guard's reason and what unlocks it ("Opens when Lina accepts, or on Nov 3 · rule 6.1"); a blocked step offers the allowed alternative when there is one ("Offer a paid change").
- **What happened:** each step with its time, who took it (a person, Payleor, PayPal), the rule and version, and the mode when Payleor acted.
- **Tables:** filters are the record's statuses with counts; the **Next step** column comes from the same open-actions query; bulk actions are the actions allowed from every selected row's status, with the others shown and their reason ("Approve · already approved on Oct 27"). A payout batch is a bulk action.
- **Search:** ⌘K finds pages and records with their breadcrumb; the composer's `@` uses the same search.
- **Payleor on every page:** a multiline composer at the bottom with "This page" as a chip; asking from a record or a table starts a call scoped to it; answers can be tables or charts, and "Open as a page" keeps one.
- **Bridges:** every record and row has **Bring into a call** and **Ask about this**; every chip in a call opens its record; browsing never opens a call by itself.
- **Before Nov 4:** the existing list and record pages move into the frame; the lifecycle strip, What can happen now and the Next step column are built for projects and payouts first *(call)*.

## 13. Open

1. A person's records as a client: on the account (default) or in their personal workspace.
2. Personal workspace types: the subscription sets client-only or solo seller; teams are separate workspaces (default).
3. The batch default (weekly, Friday 17:00).
4. Exact Chat SDK adapters and their timing after the dash; the dedicated Discord run E is cancelled for this delivery.
5. Exact runtime/deployment, SDK/provider compatibility and persistence/resume mechanism; §9 is a proposed boundary to validate, not an installed service.
6. Which actions and limits Auto may execute, and how mode changes are confirmed. Showing an action as eligible never replaces authorization inside `perform`.
7. Resolve project naming and placement of the mode control. The critic proposed moving mode changes to settings; this has not been approved.
8. Personal-workspace and dynamic-handle permissions migration must be designed against today's fixed roles before implementation.
9. For unattended/event runs, define the delegated principal, grant lifetime, membership/role revocation, and what happens when a run or persisted context resumes after authority changes. An event/handle match never supplies authority on its own.
10. Resolve precedence between each project's pinned business rulebook, current permissions and mode/routing policy, especially a batch of projects on different versions. Access revocation is checked at execution/resume; do not enable discretionary Auto for an unresolved policy combination. Decide explicitly whether any mode change migrates/suspends existing engine automation; today no such behavior is claimed.

## 14. Delivery scope and evidence

- **Cancelled for this delivery:** M (mall/cart), E (dedicated Discord flow) and AG Studio. No new multi-agent hierarchy or Studio copilot is planned. V and P remain priorities; D's intake and money-question capabilities live inside the one contextual agent. B2 remains a separate public API/webhook run.
- **Built foundation:** B1's rulebook, outbox, scheduler, project transitions and action checks. See its [staging evidence](plans/2026-10-27-b1-staging-walkthrough.md) for actual verified paths and gaps. This design's `from` declarations, call routing, scope graph and editable permission handles are additions still to plan.
- **Environment contract:** on every turn, resolve actor and authorized scope, load permitted record state and pinned rules, derive eligible tools/widgets, execute only through `perform`, then refresh state after the resulting event. Revalidate at execution: a stale card or widened context cannot bypass a hold, role, record ACL, rule limit or changed status. One-link reading remains permission-filtered; the account root is not a cross-team administrator.
- **Two demos:** the PayPal submission retains the service/payment story on its shipped foundation; the Meta Startup-track demo shows work built during Oct 27–Nov 4, specifically the contextual agentic dash. Meta credits fund Muse Spark through the Claude Agent SDK, with compatibility to validate. Existing PayPal code is background to the Meta demo, not claimed as newly built during that window.
- **Critic follow-up:** the [prototype notes](../hackathon/dashboard-prototype-notes.md) record the corrected money fixtures, action labels, controls and scoped contrast checks. Production data consistency, full accessibility, actual eligibility/approval execution and the contextual runtime remain unverified. Keep Calls and the mint selection tint; screenshots never prove business execution.

## 15. Use cases and operating-model evaluation

The [high-effort use-case review](2026-10-28-contextual-agent-use-cases-review.md) supplies matrices and recommended implementation slices. The current design adopts these constraints; detailed schema/runtime choices remain proposals.

- **People hold capacities, not global user-type privileges.** A customer sees My purchases; a solo consultant sees requests, projects and incoming money; an assigned worker sees eligible requests, My work and own Earnings; a merchant sees Products and Orders; an agency/studio composes the supported services/store/team capabilities. Agency versus studio does not create a new state machine. One person may occupy all these capacities across different records/workspaces.
- **Personal purchases remain private.** Prefer Personal › My purchases as a view over seller-owned records, retaining existing client identities and narrow link grants. Seller administration never confers customer acceptance rights. Guest orders need a verified claim before joining signed-in history; matching a typed email is insufficient. No existing sellers are reparented by a navigation change.
- **One operating-model evaluation, several consumers.** The conceptual interface is inspect → prepare → perform → inspect. It resolves trusted ownership, current role/grants and record/field relationships, complete business facts and pinned terms, required approvals and execution policy. Browsing, tool exposure, widgets, Next step and triage share those evaluators; execution revalidates. The model receives authorized projections rather than raw admin responses.
- **Attention differs from obligation.** Episode/outcome identity and event deduplication are independent of a handle name. Required decisions differ from optional allowed actions. Triage is per viewer: after one of two approvals, the first approver waits while the second still sees Needs you. Settlement, terminal refusal/failure and a closed private question have distinct labels.
- **Safe shared work.** Seller-local Calls may be shared only with an audience authorized for all source records and derived content. Mixed-capacity/mixed-workspace questions stay private initially. Bringing in a sensitive record cannot publish it to a broader audience. On resume, re-resolve access before loading copied summaries or old messages into the model.
- **Execution policy is harness configuration inside the operating model.** Supervised / accept routine edits / auto within limits / full permitted access are engineering policy concepts. No setting grants RBAC/ACL authority or overrides a mandatory human gate. Present business effects such as “Prepare for my approval” and “Send permitted follow-ups” rather than developer jargon. Existing scheduled engine actions stay visible with their own executor until an explicit migration is approved.
- **Unattended authority proposal:** a named runtime identity with a bounded, revocable delegation from one currently authorized human per seller; action/record selectors, limits, expiry and revisions are persisted. No shared team password, model-chosen admin or silent fallback. Human confirmations execute as the signed-in person with proposal attribution. New automatic effects require an approved action-specific grant; `never` remains human-only.
- **Version and effect discipline:** accepted project terms stay pinned; access/delegation is current; operational policy has its own current revision. Current deny/hold wins. Mixed project versions are evaluated per item, one seller/currency/compatible policy per actionable group; freeze selection, beneficiary and amount, then revalidate at final claim. An uncertain provider result is reconciled with its original identity, never resent as a fresh model attempt.
- **Business language:** the UI uses purchases, work, requests, orders, earnings, approvals, responsibilities and Operating model. Technical terms stay in engineering docs; show the required person, next effect, time and a plain reason when blocked. Technical IDs/version details are secondary disclosure.

**Source prerequisites before widening agent access:** verify/fix worker quote-field filtering, payout actions currently outside `perform`, pinned response deadlines and terminal abandoned-conversation behavior. These review findings are tracked in BACKLOG; they are not declared fixed here. The first implementation uses existing capabilities and fixed-role evaluation, human-confirmed decisions and read-only money answers. No full editable RBAC, new commerce/shipping flow or external B2 credentials are prerequisites for that slice.
