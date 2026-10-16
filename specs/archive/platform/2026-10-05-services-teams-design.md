# Payleor Payouts: the services teams product

> **Archived:** Built (S1–S5, runs 0–5); archived 2026-10-16. The stories in `../../stories/` describe the current behaviour; the program and later designs in `../../platform/` win where they differ.

- **Status:** approved on 2026-10-05 (amendments added in review, §5.5). Revised 2026-10-06: a Payleor workspace holds two products, commerce and payouts; the web app is a full surface next to the bots; pricing per product plus bundles. Revised 2026-10-07: the fee of 0.5% + 0.10 and the bundles are replaced by the freelancer and team plans in [`2026-10-07-seller-pricing-proposal.md`](../../platform/2026-10-07-seller-pricing-proposal.md)
- **Sibling product:** commerce (stores), specified in [`2026-10-03-payleor-platform-design.md`](../../platform/2026-10-03-payleor-platform-design.md). §10 lists what the two products share
- **Milestone:** PayPal AI Hackathon submission, Nov 12, 2026, 12:00 pm PST ([`../hackathon/README.md`](../../hackathon/README.md))
- **PayPal sources:** `../../refs/paypal/paypal-rest-api-specifications/openapi/` (abbreviated `specs/` below), `../../refs/paypal/AI-Toolkit/skills/paypal-best-practices/references/`
- **Library sources:** `../../refs/stack/`

## 1. Problem and audience

Freelance services teams (development, design, writing, and so on) run on Discord. A client joins the team's server, opens a ticket, gets quotes, and pays through links posted in the ticket. The team takes a cut and pays its freelancers through PayPal and other methods. Today this runs on custom bots, spreadsheets and manual payouts queued for the core team. Balances are often a sheet or nothing at all.

Payleor gives these teams one consistent money flow: client billing per project, what the team owes each freelancer, payouts from the team's own PayPal account, and a cases and disputes module with templates each team shapes to its business. Teams can work entirely in the Payleor web app, use Payleor's Discord bot in their ticket channels, or keep their own bots and call Payleor's API. The bots are surfaces; everything they do can also be done in the web app.

Payouts is one of two products in a Payleor workspace. The other is agentic commerce (stores, platform spec). A workspace can use either product or both; each has its own plan and fees, and bundles combine them (§3).

The organizers' inspiration themes name this almost directly: "a scheduler that pays contractors when a job is marked complete", "a freelancer view of payments across clients", "instant payouts for gig workers when a task is approved", "request money inside a chat app" (`../hackathon/resources.md` §Inspiration themes).

## 2. Goals and non-goals

### Goals

1. A workspace creates a services team, connects its PayPal account, sets its rates and payout mode, optionally links its Discord server, and runs projects from the web app, from Discord ticket channels, or from its own bot through the API.
2. Clients accept quotes, amendments and deliveries on a client project page (a signed link) or with Discord buttons, and pay the deposit, management fee and balance through a Payleor pay page with PayPal. No client account.
3. Freelancers connect a verified PayPal payout destination once, see what every team owes them in one place, and get paid by request, by rule, or automatically.
4. Every action is available in the web app. Teams with their own bots use a public API and signed outgoing webhooks; Payleor's own bot uses the same use cases.
5. One cases and disputes module serves every party: internal cases from team-defined templates, penalties, and PayPal disputes.
6. Money always goes to the team's PayPal account, never Payleor's. No agent moves money without a rule a human set or an admin's confirmation (platform spec goal 4 still holds).
7. The payouts product has its own subscription plan, plus **0.5% + 0.10** (team currency) on each client payment through PayPal's partner fee. The commerce product keeps its own plans and order fee. Bundles combine both products (prices in §13).

### Non-goals for the hackathon

- Payleor holding funds, merchant-of-record or escrow
- Currencies other than USD and EUR; more than one currency per team
- Payout methods other than PayPal (Venmo, bank)
- Client accounts (clients act through signed links and Discord)
- Intake and team-ops agents (brief structuring, quote drafting, reminders beyond deadline penalties)
- A Discord bot that keeps a gateway connection (HTTP interactions only)
- TigerBeetle (the ledger is Postgres, §6)

## 3. Decisions

| Topic | Decision |
|---|---|
| Workspace and products | A workspace is a Better Auth organization. Stores and services teams are products inside it, both Better Auth teams with a `product` column (`store` or `services`). Per-team roles for services teams live in Payleor's `services_team_member` table |
| Pricing | Per product: a subscription plan and that product's fees (payouts: 0.5% + 0.10 per client payment; commerce: the order fee of its plan). Bundles of both products at a combined price. Billed per workspace through PayPal Subscriptions (platform spec §6.7) |
| Architecture | All on the existing Cloudflare stack: api Worker (Hono) serves Discord interactions, the public API and PayPal webhooks; web Worker (vinext) serves admin, freelancer portal and pay pages; Postgres via Hyperdrive; Queues; Agents SDK |
| Where client money sits | In the team's PayPal account. Payleor records what PayPal confirms |
| Client payments | Orders v2 created and captured on the server, with the team as payee and Payleor's fee as `platform_fees` (`specs/checkout_orders_v2.json`); PayPal buttons from JS SDK v6 on the pay page |
| Payouts | Payouts API called with the team's own PayPal REST credentials (`specs/payments_payouts_batch_v1.json`). The API has no way to act for a connected merchant, and it needs approval in the PayPal developer dashboard for live use (`AI-Toolkit/.../payouts.md`) |
| Payout destination | The freelancer's PayPal payer ID from "Log in with PayPal", sent as `recipient_type: PAYPAL_ID` (no typed emails) |
| Payout modes | Per team: manual approval, auto-approval rules, or automatic on project completion |
| Surfaces | Three surfaces over the same use cases: the web app (complete), Payleor's Discord bot, and the team's own bot through the public API. Linking Discord is optional |
| Discord | One Payleor Discord app over HTTP interactions; works inside the team's existing ticket channels (`/project start`), does not create tickets |
| Integration | API-first: public `/v1` API with team API keys and signed outgoing webhooks; the web app (tRPC) and our bot call the same `core` use cases |
| Quoting | Configurable per team: open bidding, assigned freelancer, or team quote. All produce `quote` rows made of line items; accepted amendments create new quote versions (§5.5) |
| Team cut | One rate per team, on the final price |
| Management fee | A rate on the accepted quote, added on top, paid with the 50% deposit, kept by the team |
| PayPal processing fees | Borne by the team |
| Freelancer "balance" | **Earnings owed**: what the team owes, computed from the ledger. Not a wallet |
| Ledger | Postgres, double-entry, integer minor units |
| Identity | Better Auth: email and password, PayPal, and Discord sign-in. Discord must be linked to use the bot. "Log in with PayPal" verifies the payout destination |
| Cases and disputes | One platform-wide module, PayPal disputes included, with per-party templates (fields, allowed values, rules, outcomes) and dedicated agents |
| Sponsors | Render: nightly reconciliation job. AG Grid: payment stats in the team admin. Postman: published collection for the public API |

## 4. People and accounts

### 4.1 Roles

Workspace roles come from Better Auth (owner, admin, member). Each services team has its own roles in `services_team_member`. A workspace owner or admin is an admin of every services team in the workspace.

| Services team role | Who | Can |
|---|---|---|
| Admin | The team's core staff | Everything a manager can, plus: settings, rates, payout mode and rules, PayPal and Discord connections, API keys and webhooks, approve payouts, resolve cases |
| Manager | Project managers | Start projects, quote for the team, assign freelancers, file cases |
| Freelancer | Members who do the work | Quote (when the quoting mode allows), deliver, request payouts, file cases |
| Client | The person the project is for | Accept quotes, amendments and deliveries, request changes, pay, file cases. Identified by Discord user ID, email, or both; no Payleor account |

A user can be a freelancer in several services teams, across workspaces; they are a `member` of each workspace. The client is stored on the project.

### 4.2 Sign-in and linking

- Staff and freelancers sign in on the web with email and password, PayPal, or **Discord** (Better Auth social provider). A linked Discord account connects bot interactions to their Payleor user; it is required only to use the bot.
- **Server link (optional):** an admin creates a one-time link code in the team admin and runs `/payleor link code:` in their Discord server. The guild ID is stored on the team. One server per team.
- **Payout destination:** a freelancer opens Payouts in the freelancer portal, or runs `/payouts setup` and follows the link the bot sends (ephemeral). Either way they connect PayPal through "Log in with PayPal" (built in W1-A). Payleor stores the verified PayPal email and payer ID. A user without a verified destination cannot request or receive payouts.

### 4.3 Services team settings

| Setting | Values |
|---|---|
| Currency | USD or EUR |
| Team cut | Basis points, e.g. 1500 = 15% |
| Management fee | Basis points, e.g. 1000 = 10% |
| Quoting mode | `open` (any freelancer quotes), `assigned` (manager assigns, assignee quotes), `team` (managers quote, then assign) |
| Payout mode | `manual`, `rules`, `automatic` |
| Payout rules (mode `rules`) | Auto-approve when the amount is at most X, and/or the freelancer is on a trusted list; otherwise manual |
| PayPal account | Connected through partner onboarding (W1-B); receives client payments |
| Payout credentials | The team's PayPal REST client ID and secret, used only for payouts, balance checks and reconciliation. Encrypted at rest with a platform key; never shown after saving; replaceable and removable |
| Discord server | Optional link (§4.2) |
| Webhook endpoint | URL and signing secret (§8.3) |

## 5. Projects and client payments

### 5.1 States

`quoting → awaiting_deposit → in_progress → delivered → awaiting_balance → completed`, plus `cancelled`. A project with an open case keeps its state and shows the case. `core` owns the transition table; any other move is rejected.

### 5.2 Flow

Every step can be taken on any surface: the web app, Payleor's bot, or the team's bot through the API. The examples name the web action and the bot command.

**Client project page.** Each project has a signed client link (`/c/{token}`) showing the project, quotes, amendments, deliveries and payments, with the client's buttons. It is emailed when the client has an email on the project and posted in the ticket when the project has a channel. Discord buttons, when present, do the same thing as the page.

**Notifications** come from the outbox (§6.6): the ticket card when the project has a channel, email to the client and to team members, and the team's webhooks.

1. A manager starts a project: the New project form in the web app (client email and/or Discord user, title, brief), or `/project start client:@user title:` in a ticket channel. The project stores the team, the optional channel ID, the client's Discord ID and/or email, and the title.
2. Quotes: the Quote form on the project page, or `/quote amount: days: [freelancer:@x]`, allowed by the quoting mode. Only the project's client can accept a quote, on the client page or with the **Accept** button.
3. Accepting moves the project to `awaiting_deposit` and creates the deposit payment: 50% of the quote plus the management fee on the full quote. The client page and the ticket card show **Pay with PayPal**.
4. The client pays on the pay page (§5.4). On capture, the project moves to `in_progress`, the deadline is set from the quote's delivery days, and the freelancer is pinged.
5. The freelancer submits the delivery (the Deliver form, or `/deliver note: link:`). The project moves to `delivered`; the client sees **Accept delivery** and **Request changes**. Request changes returns it to `in_progress` and counts a revision.
6. Accept delivery computes the final price (§5.3), moves the project to `awaiting_balance` and creates the balance payment.
7. On the balance capture, the project is `completed` and the completion postings run (§6.3). In `automatic` payout mode, the payout agent creates the freelancer's payout.

After the deposit, scope changes go through amendments (§5.5).

### 5.3 Amounts

Example: quote $1,000, management fee 10%, team cut 15%, delivered 3 days late under a 5%-per-day penalty rule.

| Line | Amount |
|---|---|
| Deposit payment | $500 (50% of quote) + $100 (management fee on the quote) = **$600** |
| Penalty | 3 × 5% × $1,000 = $150 |
| Final price | $1,000 − $150 = **$850** |
| Balance payment | $850 − $500 = **$350** |
| Team cut | 15% × $850 = $127.50 |
| Freelancer earnings | $850 − $127.50 = **$722.50** |
| Team keeps | $127.50 + $100 = $227.50, minus PayPal processing fees |
| Payleor fee | The seller plan's rate on each payment (pricing proposal); Team is 1%: $6 on $600, $3.50 on $350 |

Rules:
- Integer minor units everywhere; percentages in basis points; every calculation rounds half-up once, at the line it produces.
- The team cut and freelancer earnings come from the **final price**; the management fee comes from the accepted quote and is not reduced by penalties.
- If the final price is below what the client has already paid toward the quote, the difference is refunded on the deposit capture and there is no balance payment. The final price is never below zero.
- Payleor's fee is per client payment, in the team's currency.

### 5.4 Pay page

- URL on the web Worker: `/pay/{token}`. The token is signed, names one payment, and carries no amount.
- The page loads the payment from the database: project, team, line items (deposit, management fee, penalty, balance) and status. A paid payment shows "Already paid" and the receipt.
- PayPal buttons use JS SDK v6 (`refs/AGENTS.md` defaults). The server creates the order: `intent: CAPTURE`, payee = the team's merchant ID, `platform_fees` = Payleor's fee (`specs/checkout_orders_v2.json`), `custom_id` = payment ID, `PayPal-Request-Id` = payment ID. The server captures with `PayPal-Request-Id` = `capture:{paymentId}`. **As built (R1a, 2026-10-07):** the payment keeps its order while PayPal can still capture it (the server looks the order up before replacing it), and a new order is created only once the old one is dead (declined capture, expired). Keys are fresh per order creation (`order:{paymentId}:{uuid}`) and per capture attempt (`capture:{orderId}:{uuid}`), because a reused key would replay a decline; PayPal refuses a second capture of an order, and any failed capture is recovered by reading the order.
- `INSTRUMENT_DECLINED` (422) lets the client choose another funding source on the same page. 429s retry with backoff. Every PayPal error logs its `debug_id`.

### 5.5 Amendments

Clients add or remove features after work starts. A quote is a list of line items (description, amount, optional extra days); an amendment adds or removes items.

- **Who:** the assigned freelancer or a manager proposes an amendment (the Amend form, `/amend`, or the API). The client accepts or declines it on the client page or with buttons. Amendments are allowed in `in_progress` and `delivered`; a pending amendment blocks delivery acceptance until it is accepted or declined.
- **Effect:** the accepted amendment becomes the current quote version. The quote amount, the management fee base, penalty formulas and the deadline (extra days) all use the current version. Every version is kept.
- **Increase** (example: $1,000 quote, $500 deposit paid, +$400): a top-up payment is due now: 50% of the increase plus the management fee on the increase = $200 + $40 = **$240**. The extra work starts when it is captured. The other $200 is added to the balance payment.
- **Decrease** (example: −$300): no payment now. The management fee overpaid on the removed part ($30) and the deposit paid above 50% of the new quote ($150) are credited against the balance payment. If the credits exceed what is still due, the difference is refunded on the original captures at completion.
- **Money:** top-ups are payments like the deposit (pay page, `platform_fees`, same postings as §6.3). The balance payment is always computed as: final price + management fee on the current quote − everything already paid toward the project.

## 6. Ledger and money consistency

### 6.1 Principles

1. **PayPal is the source of truth for money.** The ledger records what PayPal confirmed and what the team owes. Payleor never holds funds.
2. **One database transaction per state change.** Each transition (deposit captured, delivery accepted, balance captured, payout reserved, payout settled, refund applied, penalty applied, case outcome) does all of the following or none of them:
   - checks the transition is allowed and the row is unchanged (status plus `version` compare-and-set)
   - writes balanced ledger entries (each `ledger_transfer` sums to zero)
   - writes outgoing events to the `outbox`
3. **Invariants enforced in the transaction:** a freelancer's earnings owed (available plus reserved) never goes below zero; reserved never exceeds earnings owed; ledger rows are never updated or deleted.

### 6.2 Accounts

Per team, in the team currency:

| Account | Meaning |
|---|---|
| `client_held:{projectId}` | Client money received for a project not yet completed (lives in the team's PayPal) |
| `team_revenue` | The team's cut and management fees |
| `owed:{freelancerId}:available` | Earnings the team owes the freelancer and that can be requested |
| `owed:{freelancerId}:reserved` | Earnings in a payout request or in flight |
| `paid_out:{freelancerId}` | Payouts PayPal confirmed |
| `client_refunds` | Money returned to clients |
| `paypal_clearing` | Counterpart for money entering or leaving the team's PayPal |
| `paypal_fees` | PayPal's processing fees on the team's captures (borne by the team) |
| `payleor_fees` | Payleor's platform fee on the team's captures (borne by the team) |

### 6.3 Postings

| Event | Entries |
|---|---|
| Deposit or amendment top-up captured | `paypal_clearing → client_held:{p}` (quote part); `paypal_clearing → team_revenue` (management fee) |
| Balance captured | `paypal_clearing → client_held:{p}` (quote part); `paypal_clearing → team_revenue` (management fee still due after amendments) |
| Amendment decrease, management fee credit | `team_revenue → client_held:{p}` (the overpaid fee now counts toward the project's balance) |
| Completion | `client_held:{p} → team_revenue` (team cut); `client_held:{p} → owed:{f}:available` (freelancer earnings) |
| Refund on completion or cancel | `client_held:{p}` (and `team_revenue` for a refunded management fee) `→ client_refunds`, then `client_refunds → paypal_clearing` when PayPal confirms the refund |
| Payout requested | `owed:{f}:available → owed:{f}:reserved` |
| Payout succeeded | `owed:{f}:reserved → paid_out:{f}` |
| Payout failed, returned, blocked or rejected | `owed:{f}:reserved → owed:{f}:available` |
| Penalty after completion (case outcome) | `owed:{f}:available → team_revenue`, or to `client_refunds` when the client is refunded |
| Fees on a capture, once PayPal reports the seller receivable breakdown (R1c) | `team_revenue → paypal_fees` (PayPal's fee); `team_revenue → payleor_fees` (Payleor's fee) |
| Chargeback or reversal | Reverses the capture's entries; if the freelancer was already paid, `team_revenue` absorbs it and a case is opened |

Penalties before completion are not postings; they reduce the final price (§5.3).

### 6.4 Applying PayPal facts

- Two inputs report money movements: synchronous API responses (capture, refund, payout create, payout item lookup) and PayPal webhooks.
- Both go through one idempotent `applyPayPalFact(resourceType, resourceId)` step. It keys on PayPal's resource ID (capture, refund, payout item, dispute) and applies each fact at most once; whichever input arrives first applies it.
- Incoming webhooks are signature-verified (`specs/notifications_webhooks_v1.json`), stored by event ID (duplicates dropped), acknowledged, and processed from a Queue.
- PayPal does not guarantee order. The processor re-fetches the resource from PayPal and applies its current status instead of trusting the event payload.
- Capture statuses: `COMPLETED` advances the project; `PENDING` leaves the payment pending and the project unchanged until a later fact; `DECLINED` or `FAILED` marks the payment failed and the pay link usable again.
- Webhooks are mapped to a team by `payee.merchant_id` (payments), the dispute's seller merchant ID (disputes), and `sender_batch_id` (payouts).

### 6.5 Payouts

1. **Request:** a freelancer (or the automatic mode) creates a payout request for an amount up to their available earnings. Posting: available → reserved.
2. **Approval** follows the payout mode. A rejected request posts reserved → available.
3. **Send:** the payout agent checks the team's PayPal balance with the team's credentials (`GET /v1/reporting/balances`, `specs/reporting_transactions_v1.json`). With enough funds, it calls `POST /v1/payments/payouts` with `sender_batch_id` = payout request ID (PayPal rejects a reused `sender_batch_id`), one item, `recipient_type: PAYPAL_ID`.
4. **Insufficient funds** (from the balance check or PayPal's response) keep the request `queued`. It retries on a backoff schedule and immediately when an admin clicks Retry. Nothing is lost or double-sent.
5. **Settle:** item status `SUCCESS` posts reserved → paid out. `FAILED`, `RETURNED`, `BLOCKED` post reserved → available and notify the freelancer. `UNCLAIMED` should not happen with a payer ID; if it does, it is shown and treated as failed when PayPal returns it. Item status arrives through the payout item lookup and the payout webhooks; both go through `applyPayPalFact`. (Webhook event names are confirmed against developer.paypal.com when the plan is written.)

### 6.6 Outbox

- Every committed state change writes events to `outbox` in the same transaction: `id`, `team_id`, `type`, `project_id`, per-project `sequence`, `created_at`, `data` (a snapshot).
- A Queue consumer delivers each event to every subscriber: the team's webhook endpoint (§8.3), Payleor's bot (updates cards, posts messages), notifications.
- Delivery is at least once. Subscribers deduplicate by event ID and order by sequence. Bot cards therefore only show committed state.

### 6.7 Reconciliation

A nightly Render job (Render sponsor) reads each team's PayPal transactions (`GET /v1/reporting/transactions`, `specs/reporting_transactions_v1.json`) and payout batches with the team's credentials and compares them with the ledger. Mismatches are listed in the team admin. Nothing is corrected automatically.

## 7. Cases and disputes

Built last (§12), but the tables, ledger postings and outbox events exist from the start.

### 7.1 One module

A case has a source (`internal` or `paypal`), a team, an optional project, the filer and other parties, a template, the entries, a status (`open`, `awaiting_response`, `resolved`, `cancelled`), and an outcome. It covers:
- client, freelancer and team cases (missed deadline, quality, refund request)
- freelancer cases against the team (missing payout, wrong earnings, cut disagreement)
- penalties imposed by the team
- PayPal disputes and chargebacks, synced through the Disputes API (`specs/customer_disputes_v1.json`) and the `CUSTOMER.DISPUTE.*` webhooks, answered through it (`provide-evidence`, `make-offer`, `accept-claim`)

### 7.2 Templates

Each team (and any party that resolves cases) defines templates for its domain. A template has:
- **Who may file:** client, freelancer, manager, admin.
- **Fields:** choice (allowed values), number (min, max), amount, date, text, attachment.
- **Rules:** declarative JSON over the entries and project facts (days late, quote, amounts paid): which combinations are allowed, which entries are required for others, and thresholds that unlock options.
- **Computed amounts:** formulas over entries and project facts, with caps, e.g. `rate_per_day × days_late × quote`, capped at a percentage.
- **Outcomes:** what each allowed resolution does: adjust the final price, refund the client (amount or formula), move earnings to the team (penalty), extend the deadline, cancel the project.
- **Automatic application:** a template can apply on a project event without anyone filing, e.g. a deadline penalty at delivery.

Example (a team's "Missed deadline" template):
- Applies automatically at delivery: penalty = 5% of the quote per day late, capped at 35%; reduces the final price (§5.3).
- When the cap is reached and the work is not delivered, the client may file "Cancel": outcome = refund the deposit and the management fee in full, cancel the project.

One validator in `core` checks entries against the rules and computes amounts, so the API, the bot and the web accept and reject the same things.

### 7.3 Outcomes and money

Outcomes only use existing paths: a change to the final price before completion, a PayPal refund on the original capture, a ledger posting between team accounts and earnings owed, or a project change (deadline, cancel). Each outcome is one state change under §6.1. Refunds include Payleor's `platform_fees` refund where PayPal allows it (checked when the plan is written).

### 7.4 Agents

- **Case agent:** helps the filer choose a template and fill it from the ticket conversation, collects evidence from the ticket history through Discord's REST API, runs the validator, and drafts a resolution for the team.
- **PayPal dispute agent:** the dispute agent of the platform spec (§9.3): triages, gathers evidence from the project and ticket, drafts the response.
- Both prepare actions; an admin confirms every refund, penalty and dispute response.

### 7.5 Surfaces

`/case open template:` in Discord (a modal, or a link to a web form when the template has more fields than a modal holds), API endpoints, a cases console and template editor in the team admin. If time runs short, the template editor UI is cut first and templates are seeded as JSON.

## 8. Integration surfaces

### 8.1 Shared use cases

All domain behaviour lives in `core` use cases with permission checks: start project, add quote, accept quote, propose, accept or decline amendment, create payment link, apply PayPal fact, submit delivery, accept delivery, request changes, request payout, approve or reject payout, file case, resolve case. The web app (through tRPC), the public API and our bot all call them in process, so the three surfaces behave the same way.

### 8.2 Public API

- Base path `/v1` on the api Worker. JSON. Errors as `{ error: { code, message } }`.
- **API keys:** created by an admin in the team admin, shown once, stored hashed, scoped to the team, revocable, with a last-used time.
- **Acting for someone:** requests that act for a person carry `actor_discord_id`. Payleor checks that the ID holds the needed role in the project (only the client accepts a quote; only a freelancer with a verified destination requests a payout). The team is accountable for its bot; money still moves only through the pay page or the payout rules.
- **Idempotency:** every POST takes an `Idempotency-Key` header; a repeat returns the first response.
- **Endpoints (hackathon):** `POST /v1/projects`, `GET /v1/projects/{id}` (with the current pay link), `POST /v1/projects/{id}/quotes`, `POST /v1/quotes/{id}/accept`, `POST /v1/projects/{id}/amendments`, `POST /v1/amendments/{id}/accept`, `POST /v1/amendments/{id}/decline`, `POST /v1/projects/{id}/deliveries`, `POST /v1/projects/{id}/accept-delivery`, `POST /v1/projects/{id}/request-changes`, `GET /v1/freelancers/{discordId}/earnings`, `POST /v1/payout-requests`, `POST /v1/payout-requests/{id}/approve`, `POST /v1/payout-requests/{id}/reject`, later `POST /v1/cases`.
- **Docs:** an OpenAPI document generated from the zod schemas, served at `/v1/openapi.json`, and a published Postman collection.

### 8.3 Outgoing webhooks

- One endpoint per team (URL and secret, set by an admin).
- Events: `project.created`, `quote.created`, `quote.accepted`, `amendment.proposed`, `amendment.accepted`, `amendment.declined`, `payment.created`, `payment.captured`, `payment.failed`, `delivery.submitted`, `delivery.accepted`, `project.completed`, `project.cancelled`, `payout.requested`, `payout.approved`, `payout.queued`, `payout.sent`, `payout.failed`, later `case.*`.
- Body: the outbox event (`id`, `type`, `team_id`, `project_id`, `sequence`, `created_at`, `data`).
- Header `Payleor-Signature: t={unix},v1={hex HMAC-SHA256 of "{t}.{body}"}`. Receivers reject timestamps older than 5 minutes.
- Retries on non-2xx or timeout with exponential backoff for 24 hours, then the delivery is marked failed. The team admin shows the delivery log and can replay any event.

### 8.4 Payleor's bot

The bot is one surface among three; a team that never links Discord loses nothing.

- One Discord application, installed in many servers, receiving interactions over HTTP at the api Worker. Requests are verified with the app's Ed25519 public key.
- Messages and cards are posted and edited through Discord's REST API with the bot token. Interaction responses stay within Discord's 3-second limit by deferring and following up.
- Commands: `/payleor link`, `/project start`, `/quote`, `/amend`, `/deliver`, `/earnings`, `/payout request`, `/payouts setup`, later `/case open`.
- Buttons: Accept quote, Accept or Decline amendment, Accept delivery, Request changes, Approve payout and Reject payout (admins only).

## 9. Web surfaces

The web app is a complete surface: every action in §5, §6.5 and §7 has a web page or form.

- **Public site:** one landing page presenting both products (commerce and payouts), pricing per product and bundles, legal pages covering both products, sandbox banner on every page.
- **Workspace home** at `admin.<domain>`: the workspace's stores and services teams; **Create your store** and **Create your services team**.
- **Services team admin** at `admin.<domain>/{teamSlug}` (store and team slugs share one namespace):
  - Setup checklist: connect PayPal, add payout credentials, set currency, rates, quoting and payout modes, optionally link the Discord server.
  - Projects: list and New project; detail with timeline, quotes, amendments, deliveries, payments, penalty and ledger entries, and the staff and freelancer actions (quote, amend, deliver, assign).
  - Freelancers: members, verified destination, earnings owed.
  - Payouts: queue with approve, reject, retry; payout rules.
  - Payment stats with AG Grid (AG Grid sponsor).
  - Developers: API keys, webhook endpoint, delivery log with replay, OpenAPI link.
  - Cases: console and template editor (last).
  - Reconciliation: mismatches.
- **Freelancer portal** at `admin.<domain>/me`: payout destination, projects assigned to them across teams with their actions (quote, amend, deliver), earnings owed per team and in total, payout requests and history.
- **Client project page** at `/c/{token}` (§5.2).
- **Pay page** at `/pay/{token}` (§5.4).

## 10. Relationship to the commerce product

Both products are in the hackathon scope. The commerce product stays as specified in the platform spec; this section lists what the two share and what changes in the work already done.

| Shared | Commerce only | Payouts only |
|---|---|---|
| Workspace (organization), auth, email, rate limits, sandbox banner, legal pages | Stores, storefronts, subdomains and custom domains, catalog, checkout for buyers | Services teams, projects, quotes, amendments, client pages |
| Partner onboarding (one PayPal connection per store or services team) | Store Sync, ACP, UCP, AP2, conformance agent | Ledger and earnings owed, payouts and the payout agent |
| PayPal client, Orders v2, webhook verification, `applyPayPalFact`, outbox, Queues | Shopping agent, admin agent, MCP server | Discord bot, public `/v1` API and outgoing webhooks |
| Cases and disputes module (§7) and the dispute agent: store disputes and services cases use the same module | Store policies | Reconciliation job |
| Billing (plans per product, bundles), AG Grid analytics | | |

Changes to W1-D:
- Task 12's "Create your store" stays. A "Create your services team" flow is added next to it.
- Task 13 (landing) presents both products and both pricings.
- Task 15 (store policies) stays.
- Task 16 (deploy) runs after the above.
- Stores and services teams are both Better Auth teams with a `product` column; the store fields (`status`, `paypalMerchantId`, `supportEmail`) apply to stores, the settings in §4.3 to services teams.

## 11. Testing

- **Core unit tests:** fee math (Payleor fee, management fee, team cut, rounding), penalty formulas and caps, amendment top-ups and credits, final price, balance and refunds, state machines, ledger invariants, template validator.
- **Database integration tests:** one transaction per state change; duplicate and out-of-order PayPal facts; outbox writes; payout reserve, settle, release; earnings never negative under concurrent requests.
- **Signature tests:** Discord Ed25519, PayPal webhook verification, Payleor webhook HMAC.
- **PayPal sandbox end to end:** order with `platform_fees`, capture, refund, payouts success and failure, a simulated dispute.
- **Playwright:** project flow on the web (new project, quote, client page, pay page, deliver, accept), setup checklist, freelancer portal.

## 12. Schedule

Both products are built in full by Nov 12, in parallel workstreams (git worktrees, one plan per workstream). This table replaces the platform spec's §13 schedule.

| Week | Payouts | Commerce | Shared |
|---|---|---|---|
| Oct 6–12 | Services teams and settings; Discord app, sign-in, server link; ledger, projects, quotes | Store creation kept; catalog admin with Channel3 | W1-D finish (landing for both, legal, store policies, deploy); `product` column; partner onboarding; PayPal client |
| Oct 13–19 | Client page, pay page, amendments, deliveries, full flow on web and bot | Storefront, web checkout, orders, tracking, refunds; Render bulk import | `applyPayPalFact`, PayPal webhooks, outbox, Queues |
| Oct 20–26 | Payouts, payout agent, freelancer portal, team admin pages | MCP server, widgets, shopping agent, admin agent | Email notifications |
| Oct 27–Nov 2 | Public API, outgoing webhooks, OpenAPI and Postman, reconciliation job | Store Sync and ACP adapters, conformance tests | AG Grid analytics for both products; AG Studio key requested Nov 1 |
| Nov 3–8 | Templates, validator, penalties, case agent | UCP and AP2, custom domains | Cases and disputes module, dispute agent; billing (plans per product, bundles) |
| Nov 9–12 | Demo Discord server and services team | Demo store | README, video, submission |

## 13. Open items for the plans

- Prices: the payouts product's plans (monthly and yearly) and the bundle prices. Needed before the billing plan (Nov 3–8); the 0.5% + 0.10 fee is decided.

- Confirm the payout webhook event names and the refund of `platform_fees` against developer.paypal.com.
- Confirm Discord modal component limits for `/case open`.
- Pick the encryption scheme for payout credentials (Web Crypto AES-GCM with a platform key from the secret store).
- Decide whether teams need a sandbox/live switch per API key (the hackathon runs on sandbox only).
