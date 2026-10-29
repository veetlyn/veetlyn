# Veetlyn architecture

**Date:** 2026-10-16. **Status:** the architecture reference, written from the code on main at `4a27fb6` and the approved program. It replaces the platform design of 2026-10-03 ([`../archive/platform/2026-10-03-payleor-platform-design.md`](../archive/platform/2026-10-03-payleor-platform-design.md)), which planned a commerce-only product with AI checkout protocols, a dispute agent and Braintree; §10 lists what of that plan was dropped or deferred. Update this file in the same commit as a change that makes it wrong.

**What is decided elsewhere:** the program and its runs ([`2026-10-13-agentic-surfaces-program.md`](2026-10-13-agentic-surfaces-program.md)), the action registry and client contacts ([`2026-10-13-action-catalog-design.md`](2026-10-13-action-catalog-design.md)), conversations ([`2026-10-14-conversations-design.md`](2026-10-14-conversations-design.md)), the plugin ([`2026-10-15-c-plugin-design.md`](2026-10-15-c-plugin-design.md)), sign-in across hosts ([`2026-10-06-auth-federation-design.md`](2026-10-06-auth-federation-design.md)), seller plans and fees ([`2026-10-07-seller-pricing-proposal.md`](2026-10-07-seller-pricing-proposal.md)), PayPal facts ([`2026-10-07-r1-paypal-facts.md`](2026-10-07-r1-paypal-facts.md)) and the PayPal rules ([`../references/AGENTS.md`](../references/AGENTS.md)).

## Current direction and implementation boundary (2026-10-28)

[Calls and the agent](2026-10-27-calls-and-agent-design.md) is the current contextual-agent design. One runtime changes its authorized environment with account, workspace, section and record context. The business state machine, pinned rulebook, role/record access checks and `perform` determine available transitions; the model prepares tools/widgets and never bypasses these checks. An event updates the business record and refreshes the agent's environment. Calls project who the work waits on rather than owning a second business lifecycle.

B1's operating-model implementation is on `b1-operating-model`, with [staging evidence and remaining coverage](plans/2026-10-27-b1-staging-walkthrough.md); it is not recorded merged or verified on production. Agent scope/call persistence, dynamic permission handles, eligibility metadata and the SDK runtime beside the Workers are **planned**, not current infrastructure. Runtime choice and provider compatibility must be validated in the implementation plan. B2's external API keys/webhooks remain separate.

M (mall), E (dedicated Discord) and AG Studio are cancelled for this delivery. V/P remain priorities. Existing store checkout, Discord identity links and the client plugin are not removed. Optional channels follow the dash through Chat SDK. This section takes precedence over older future-tense run promises below; host/package descriptions remain dated evidence, not a claim of a new deploy.

## 1. Product

Veetlyn is the money flow and the trust around paid work. Sellers are services teams, solo freelancers and stores:

- **Services** (the hackathon entry): a team or a freelancer publishes offerings, takes quote requests, quotes, gets paid through PayPal (deposit and balance), delivers, and pays its members under payout rules.
- **Commerce:** a store sells digital products with guest checkout; the physical catalog exists (S5) but the cross-store cart/checkout run M is cancelled for this delivery.

Money always goes to the seller's PayPal account; Veetlyn takes its fee through PayPal's partner fee. Payers approve every checkout in PayPal. A team's explicitly configured Auto rule may authorize eligible business actions such as member payouts within its limits; this does not confer client authority or bypass `perform`. The contextual runtime and exact Auto allowlist remain to implement. "jendal" stays the code name in package names (`@jendal-workspace/*`), service and database names.

## 2. Hosts

| Host | Production (since 2026-10-20) | Staging | After run C |
|---|---|---|---|
| `veetlyn.com` | Landing, pricing, legal pages, client page `/c/{token}`, pay page `/pay/{token}` | `staging.veetlyn.com` | Landing and the client's home across teams; `/c` and `/pay` move to the team's site |
| `dash.veetlyn.com` | Sign-in, account, seller dashboards (`/{slug}/…`); `admin.veetlyn.com` redirects here | `dash.staging.veetlyn.com` | same |
| `api.veetlyn.com` | The api Worker: auth, tRPC, webhooks, Discord, onboarding return | `api.staging.veetlyn.com` | plus `/mcp`, the plugin's endpoint |
| `{slug}.veetlyn.app` | One seller's site: seller page or storefront, request form, `/buy`, orders, policies | `{slug}.staging.veetlyn.app` | plus the client and pay pages (`{slug}.veetlyn.app/c/{token}`, `/pay/{token}`) |

- `PLATFORM_NAME` is `Veetlyn` (every user-facing string, email sender, MCP tool description and metadata title reads it); `PLATFORM_DOMAIN` (`PLATFORM_ZONE` in infra) is `veetlyn.com`, `STORE_DOMAIN` (`STORE_ZONE` in infra) is `veetlyn.app`. `veetlyn.com` is multi-tenant (accounts, dashboards, the client's HQ); each `veetlyn.app` subdomain is one seller's own site, where client, team and freelancer interact. `pnpm lint` runs `scripts/check-no-brand.mjs` so source code never hardcodes the product name or domains.
- One account works on every host (federated sign-in, [`2026-10-06-auth-federation-design.md`](2026-10-06-auth-federation-design.md)). Signed client links stay the no-account path.
- `parseRequestTarget` (`packages/core/src/tenancy/target.ts`) classifies a host as a platform app (`www`, `admin`, `api`, `mcp`), a seller slug, a custom domain or unknown. The `mcp.` label stays reserved; the MCP endpoint is `api.veetlyn.com/mcp`.
- **Reserved slugs** (`packages/core/src/tenancy/slug.ts`): platform host labels, environment names, mail and DNS labels, brand names (`veetlyn`, `paypal`, `venmo`, `braintree`), `agent(s)`, and the dashboard's own top-level paths, so a slug never shadows a page.
- **Email** goes out through Resend (`packages/email`) from purpose addresses on `veetlyn.com` (`accounts@`, `stores@`, `invoices@`, `payouts@`, …), replies to `support@veetlyn.com`. `veetlyn.app` sends no mail (SPF `-all`, null MX).

## 3. Runtime

Two Cloudflare Workers, defined with Alchemy v2 in `packages/infra/alchemy.run.ts` (state kept in Cloudflare):

| Worker | Source | Serves |
|---|---|---|
| **web** | `apps/web` (vinext, the Next.js API on Vite) | Every page. Route trees: `dash/` (dashboards), `(site)/` (landing, legal, client and pay pages), `store/` (seller sites). The Worker entry forwards `/api/*` and `/trpc/*` to the api Worker through the `SERVER` service binding, keeping the host, so the browser only talks to its own origin |
| **api** | `apps/server` (Hono) | `/api/auth/*` (Better Auth), `/trpc/*`, `/webhooks/paypal`, `/api/paypal/onboarding/return`, `/discord/interactions`, store info and catalog images; the PayPal webhook queue consumer; the maintenance cron |

| Binding | Use |
|---|---|
| Hyperdrive → Postgres (Render Postgres when deployed, one instance per stage in Virginia; a local Docker Postgres in dev) | Source of truth. Query cache off, so reads see writes |
| KV `STORE_CACHE` | Host and slug to seller lookups; Postgres is written first, then the cache |
| Queue `PayPalWebhooks` | Verified webhook events, processed by the api Worker (batches of 10, retries) |
| R2 `Files` | Private files (delivery files, digital products), uploaded and downloaded with presigned URLs |
| R2 `ProductImages` | Catalog images |
| Cron `*/10 * * * *` | Maintenance sweeps (§8) |

Local development: `pnpm dev` runs both Workers with `alchemy dev` on `localhost:3001` and `dash.localhost:3001`. Production deploys from GitHub Actions after CI passes on main; staging deploys by hand (`specs/PROGRESS.md`, Environment). Workers Cache is off for the web Worker: it served signed-in answers to other callers (H plan, Build notes). Environment values are declared in `.env.schema` files and loaded by varlock.

## 4. Code layout

| Package | Holds | Rule |
|---|---|---|
| `packages/core` | Pure domain rules: tenancy and slugs, money, pricing and fees, projects and quotes, payouts (rules, decisions, Payouts Web), ledger, orders, catalog, billing plans | Imports nothing outside itself (no Drizzle, PayPal, Hono or Cloudflare). Convention, checked in review; no lint rule enforces it |
| `packages/db` | Drizzle schema (45 tables), migrations, repositories | Repositories take the database explicitly |
| `packages/api` | tRPC routers, use cases (`use-cases/`), the action registry (`actions/`) | Business steps live in use cases; routers and every other surface call them |
| `packages/paypal` | Typed `fetch` client (§6) | Responses decoded with zod at the client |
| `packages/auth` | Better Auth: email and password, Discord, organizations and teams | |
| `packages/email` | Mailer port, Resend transport, senders and templates | |
| `packages/channel3` | Channel3 client (product prefill for the Commerce catalog) | |
| `packages/ui`, `packages/config`, `packages/infra` | Shared components, tsconfig, Alchemy stack | |

Code rules (decoding at the boundary, money in integer minor units, no `typeof` checks, `SAFETY:` comments on assertions) are in [`../../CLAUDE.md`](../../CLAUDE.md); `pnpm lint` runs Oxlint with the anti-slop plugin in `tools/oxlint/anti-slop/`.

## 5. Tenancy and access

- A **seller is a Better Auth team** in an organization (the workspace). Stores and services teams share the `team.slug` unique index: one seller, one slug, one site. A solo freelancer is a services team of one in their own workspace.
- **Who can open a seller:** organization owners and admins open every seller of the workspace; other members open the teams they belong to. Services teams add their own roles (admin, manager, freelancer) on `services_team_member`.
- Dashboard procedures take the slug as input (`storeProcedure`, `servicesTeamProcedure`, `sellerProcedure` in `packages/api/src`); the seller comes from the URL, not the session, so two tabs show two sellers. A seller the user cannot open answers `NOT_FOUND`.
- **Clients** are not team members. Today a client acts through a signed link (`/c/{token}`); run A2 adds client contacts with verified identities and revocable links, and the rule that a member of the project's team is never its client.

## 6. Money and PayPal

- **Client** (`packages/paypal`): platform token cached until expiry; `PayPal-Auth-Assertion` and `PayPal-Partner-Attribution-Id` on seller calls; `PayPal-Request-Id` on every POST, derived from our record and step; 429 and 5xx retried with backoff under the same request id; every call logged with operation, status and debug id, never secrets.
- **Onboarding:** partner referrals with `EXPRESS_CHECKOUT` (services teams skip shipment tracking). Automatic payouts use a first-party referral that shares the team's REST credentials (`PAYOUTS`, balance reading), sealed with `PAYOUT_CREDENTIALS_KEY`.
- **Payments:** Orders v2 created on the server with the seller as payee and Veetlyn's platform fee at the seller's plan rate; the buyer approves with JS SDK v6 buttons on the pay page or `/buy`; capture on the server. Project payments (deposit, top-up, balance) and store orders share this path.
- **Webhooks:** `/webhooks/paypal` verifies the signature with PayPal, stores the event (unique id), answers 200 and enqueues it; the consumer applies captures, refunds and reversals, and parks facts that need a person. Handlers are safe to run twice; the cron requeues stuck events.
- **Ledger:** every capture, fee, refund, reversal and payout is posted in core's ledger, with PayPal's fee and Veetlyn's fee as their own lines.
- **Payouts:** members request payouts of their available earnings; the team's payout rules (approval, trusted members, second approver, automatic project payouts with a hold, payday, balance floor, minimum) decide in one core function; payouts go through the Payouts API with the team's own credentials, or as a PayPal Payouts Web CSV when automatic payouts are off.
- **Refunds:** from the dashboard through the capture refund API; refunds and reversals revoke digital downloads.
- **Plans and fees:** core computes the plan and fee rate per seller (Solo, Pro, Premium for freelancers; Team, Studio, Agency for teams; Starter, Grow, Scale for stores). Subscriptions are not billed yet.

## 7. Actions and surfaces

- **Action registry** (`packages/api/src/actions/`): each action is a definition (input, output, grants, agent policy) behind one `perform`, which checks the scope and grants, refuses agents where the policy says so, maps failures to `ActionError` (keeping tRPC codes) and writes the `action_log` (kept 180 days). The tRPC adapters in `actions/trpc.ts` expose actions to the web; run C adds the MCP tools on the same registry.
- **Surfaces:**
  - **Web:** the dashboard, seller sites, client and pay pages (built).
  - **Email:** the client link, notices to teams, buyer receipts (built; run B adds the delivery pipeline with an outbox).
  - **Discord:** sign-in, account and server link, `/veetlyn link`, `/payouts setup` (built in S2, never checked on a real server; project-channel run E is cancelled for this delivery).
  - **Claude and ChatGPT plugin:** MCP on `api.veetlyn.com/mcp`, OAuth through Better Auth, MCP Apps widgets, widget-only accept buttons, pay through the pay page (proven in spike S, built in run C).
  - **API keys and webhooks for AI sellers:** run B.
- Every surface calls the same use cases; commitments by an AI client need a press on a Veetlyn widget button, and every payment needs the payer's PayPal approval.

## 8. Background work

The cron (every 10 minutes, `apps/server/src/maintenance.ts`) runs each sweep on its own, so one failure never stops the others: `webhooks` (requeue stuck events), `requestLimits`, `actionLog` (180-day cleanup), `uploads` (unattached files), `orders` (abandoned checkouts), `projectPayouts` (completed projects past their hold), `payoutSends` (approved payouts due, with retry back-off) and `payouts` (settle sent payouts).

## 9. Logging, errors and tests

- **Logging:** evlog, one wide event per request, queue batch or cron run; PayPal calls add their fields; secrets and tokens are never logged. tRPC errors are logged with the original cause.
- **Errors:** use cases throw `ActionError` or tRPC errors with a message the user can act on; internal failures keep their cause for the log, not the response.
- **Tests:** Vitest against a real Postgres test database (the global setup migrates it; its name must contain "test"), PayPal faked at `fetch`, each test at the strongest boundary (router or use case). The story book in [`../stories/`](../stories/README.md) is the walkthrough proof. CI runs check-types, lint and tests on every pull request and push to main.

## 10. Dropped or deferred from the first design

| Planned on 2026-10-03 | Now |
|---|---|
| AI checkout protocols (Store Sync, ACP, UCP, AP2) and a conformance agent | After the hackathon (decision of 2026-10-14). Run M sells through the plugin with checkout on Veetlyn |
| Braintree rail | Dropped with the protocols |
| Shopping, admin and dispute agents (Agents SDK, AI Gateway, Clef) | Replaced by capabilities of one contextual agent in D; no separate personas or AG Studio, disputes after the hackathon |
| AI Search per store | Not built; run M's design decides how products are searched |
| Custom domains (Cloudflare for SaaS) | Host resolution understands them; creating them is after the hackathon |
| Tax (Shopify's manual model) | Not built; digital products and services only for now |
| Plan subscriptions through PayPal | Plans and fee rates exist; billing after the hackathon |
| Hosts `admin.veetlyn.app`, `mcp.veetlyn.app/mcp`, store domain `veetlyn.site` | §2 |

## 11. Versions

vinext 1.0.1, Better Auth 1.7.7, Alchemy 2.0.0-beta.80, Drizzle ORM 1.0.0-rc.4, Hono 4.13, tRPC 11.19, evlog 2.30, varlock 1.21.1, zod 4, Vitest 5.0.3, TypeScript 6, React 19. Reference clones pinned to these releases live in `refs/stack/` next to the repository (not in git).
