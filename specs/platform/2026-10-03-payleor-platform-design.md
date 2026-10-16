# Payleor platform design

- **Status:** approved on 2026-10-03. Revised the same day: vinext replaces OpenNext; stores are Better Auth teams with one dashboard per store; dependencies move to their latest releases
- **Products (2026-10-06):** a Payleor workspace holds two products: agentic commerce (stores, this spec) and payouts for services teams ([`2026-10-05-services-teams-design.md`](../archive/platform/2026-10-05-services-teams-design.md)). Both are in the hackathon scope. Each product has its own plan and fees, plus bundles, which revises §6.7 (services spec §3 and §13). The combined schedule in services spec §12 replaces §13 here, and services spec §10 lists what the products share.
- **Domains and email (2026-10-06):** `PLATFORM_DOMAIN` is `payleor.com` (site, `admin.`, `api.`, `mcp.`) and `STORE_DOMAIN` is `payleor.app` (`{slug}.payleor.app`). This replaces `payleor.app` as the platform domain and `payleor.site` as the store domain in §4.2; host examples that read `*.payleor.app` for the admin, api or MCP now read `*.payleor.com`. Email goes out through Resend (free tier, which also receives mail for `payleor.com`), with Brevo's API and then its SMTP relay as fallbacks. Cloudflare Email Service replaces both later. Brevo stays a fallback only because it always rewrites HTML links for click tracking and adds an open pixel. Senders are purpose-specific addresses on `payleor.com`: `accounts@` (sign-in, verification, reset, invites), `stores@` ("{Store} via Payleor", to buyers), `invoices@` ("{Team} via Payleor", to services clients), `payouts@`, `disputes@` and `billing@`. Replies go to `support@payleor.com` unless a message sets its own Reply-To. Resend receives incoming mail on `payleor.com`; Cloudflare Email Routing was set up and then removed on 2026-10-06. `payleor.app` sends and receives no mail (SPF `-all`, DMARC `p=reject`, null MX).
- **Library sources:** reference clones pinned to the release we use live in `../../refs/stack/` (§2.2)
- **Product:** a multi-tenant, headless, agentic commerce SaaS on PayPal, running on Cloudflare
- **Name:** Payleor (renamed from Jendal on 2026-10-04, after Jendal turned out to clash with existing commerce products). Code identifiers (`@jendal-workspace/*` packages, `jendal-*` service, database and tunnel names, `JENDAL_LOCAL_STAGE`) and the `jendal/` and `jendal-workspace/` folders keep the old name until after the hackathon
- **Milestone:** PayPal AI Hackathon submission, Nov 12, 2026, 12:00 pm PST ([`../hackathon/README.md`](../hackathon/README.md))
- **Background facts and sources:** [`research.md`](../archive/platform/research.md). Section references such as "R§4" point to it.
- **Detailed specs:**
  - [`2026-10-04-public-site-auth-onboarding-design.md`](../archive/platform/2026-10-04-public-site-auth-onboarding-design.md) (landing page, pricing, sandbox banner, auth, onboarding, legal pages)
  - [`2026-10-05-sponsor-integrations-design.md`](2026-10-05-sponsor-integrations-design.md) (AG Studio analytics, Channel3 catalog tools, Render bulk import)

## 1. Goals and non-goals

### Goals

1. Merchants sign up, connect PayPal, set up a store, and sell through three surfaces:
   - a web storefront (a subdomain of the store domain, or the merchant's own domain)
   - a ChatGPT plugin
   - a Claude plugin
2. External AI shoppers can buy through **Store Sync, ACP, UCP and AP2**. Each protocol is built to its spec and proven in the sandbox by our own conformance test agent.
3. Three agents: a **shopping** agent (storefront), an **admin** agent (merchant operations), and a **dispute** agent (disputes and chargebacks).
4. Money always goes to the merchant's PayPal account, never ours. No agent moves money without confirmation from a human or the buyer.
5. Payleor earns the way Shopify does: each store pays a monthly or yearly plan, billed through PayPal Subscriptions, plus a per-order fee taken through PayPal's partner fee (§6.7).

### Non-goals for v1

- An automatic tax engine (like Shopify Tax), duties and import taxes, tax-exempt customers, filing or remitting tax. v1 tax is Shopify's manual model (§6.1)
- Acting as merchant of record (planned after the hackathon, §16)
- Multi-currency pricing, discounts and coupons, subscriptions sold by merchants to their buyers (Payleor's own plans are in scope, §6.7)
- Merchants running their own code (Workers for Platforms)
- Full Braintree dispute handling (read-only in v1)
- UCP's MCP and A2A transports (REST only in v1)
- AP2 Human Not Present mode
- Charging agents for API access (Monetization Gateway)
- K2 event streaming (deferred; Queues covers v1)
- Polished handling of the unhappy onboarding paths (consent revoked, onboarding half-finished) beyond a clear "not connected" state

## 2. Decisions

| Topic | Decision |
|---|---|
| Target | A real product; the hackathon is a milestone |
| Merchant model | Multi-tenant SaaS: many merchants, each with their own store |
| Protocols | Store Sync, ACP (`2026-04-17`), UCP (REST), AP2 v0.2 (Human Present) |
| Gated protocol access | Build to spec now and prove each protocol with our own conformance agent in the sandbox. When PayPal or Google grants access, only configuration changes |
| Runtime | Cloudflare Workers (R§12) |
| Stack | better-t-stack scaffold, then: **vinext** (Next.js API on Vite) for the web app, Hono, tRPC for the admin API, Better Auth, Drizzle, pnpm, Turborepo, evlog, PWA, varlock for env, Alchemy v2 for infrastructure (R§12.1; scaffold in §2.1; versions in §2.2) |
| Tenancy | Better Auth **organization plugin with teams**. An organization is a merchant account; each **store is a team**; store staff are team members (§4.1) |
| Admin | One dashboard per store at `admin.payleor.app/{storeSlug}/…` (§4.7) |
| Database | **Aiven for PostgreSQL**. Workers connect through **Hyperdrive**; local development and migrations use the direct Aiven URL |
| Architecture | A modular monolith: 2 Workers (web, api) with shared packages, built so it can split later |
| Agents | Cloudflare Agents SDK (one Durable Object per agent session), AI Gateway with the platform's own Claude and GPT keys, Clef for fast typed decisions |
| PayPal connection | Minimal partner onboarding (Connect button, return page, status check), plus one demo store that is already connected |
| PayPal client | Our own typed `fetch` client. The server SDK's axios transport is unproven on Workers (R§12.3) |
| Braintree client | The GraphQL API over `fetch`; Containers if that fails |
| Async processing | Cloudflare Queues |
| Logging | **evlog** ([evlog.dev](https://www.evlog.dev/)): one wide event per request, job or agent turn, with structured errors (§12.1) |
| Admin scope by Nov 12 | Onboarding and store settings, catalog, orders (fulfillment, tracking, refunds), disputes console with the dispute agent, store analytics |
| Hackathon sponsor tools | **AG Studio** for store analytics with the Admin agent (the sponsor prize we compete for), **Channel3** for catalog tools on the merchant side, **Render Workflows** for bulk catalog import ([sponsor spec](2026-10-05-sponsor-integrations-design.md)) |

### 2.1 Scaffold

The product is named **Payleor**. The workspace lives in `jendal-workspace/` and was generated by better-t-stack 3.44.2. Its `bts.jsonc` records the command that reproduces it:

```sh
pnpm create better-t-stack@latest jendal-workspace --frontend next --backend hono \
  --runtime workers --database postgres --orm drizzle --api trpc --auth better-auth \
  --payments none --addons evlog pwa turborepo --examples none --db-setup none \
  --web-deploy cloudflare --server-deploy cloudflare --git --package-manager pnpm --install
```

What the scaffold contains:

- **Apps:** `apps/web` (Next.js 16, built for Workers with OpenNext) and `apps/server` (Hono on Workers, Turborepo filter name `hono`).
- **Packages:** `packages/api` (tRPC routers), `packages/auth` (Better Auth with the Drizzle adapter), `packages/db` (Drizzle 1.0 RC with Postgres.js), `packages/ui` (shadcn components), `packages/config` (shared tsconfig) and `packages/infra` (Alchemy).
- **Environment variables:** declared in `.env.schema` files and loaded by varlock, which also generates types into `src/env.ts`.
- **Deployment:** Alchemy v2 (Effect-based) in `packages/infra/alchemy.run.ts`. Our Worker routes, service binding, Hyperdrive, KV, R2, Queues, Durable Objects, AI Search, Workers AI and custom hostnames go there. Alchemy provides `Cloudflare.Hyperdrive.Connection`, `Cloudflare.KV.Namespace` and `CustomHostname` resources.
- **evlog:** set up on the Hono server (with its Better Auth user identification) and in Next.js (`evlog/next` proxy and instrumentation). The web side moves to `evlog/workers` with vinext. We extend it to the agents, queue consumer and cron (§12.1).
- **PWA:** `app/manifest.ts`, `public/sw.js` and `pwa.config.ts`. Because the storefront serves many stores, the manifest is served per store (name, colors and icons from the store's branding), and the service worker never caches checkout, admin or API responses.

Changes we make on top of the scaffold:

- **Admin API:** tRPC procedures in `packages/api`, served by the Hono Worker at `/trpc`. Protocol endpoints, webhooks and MCP stay plain Hono routes, because their shapes are fixed by outside specs.
- **Database:** Aiven Postgres. The Worker reads `HYPERDRIVE.connectionString`; Hyperdrive's query cache is off, so reads see writes immediately. In `alchemy dev` the binding passes through to the Hyperdrive `dev` origin (the Aiven URL).
- **vinext:** the web app moves from OpenNext to vinext in week 1. Alchemy deploys it with `Cloudflare.Website.Vinext` (`refs/stack/alchemy/website/src/content/docs/cloudflare/frontend/vinext.mdx`), which injects its own Cloudflare Vite plugin and provisions the `VINEXT_KV_CACHE` namespace. There is no `wrangler.jsonc` and no OpenNext build. `next.config.ts` stays and is read by vinext.
- **Same-origin API:** the browser never calls the api Worker directly. The web Worker's entry (`apps/web/worker/index.ts`) forwards `/api/*` and `/trpc/*` to the api Worker through the `SERVER` service binding before vinext sees the request, keeping the original host so the api resolves the same store. This removes the build-time `NEXT_PUBLIC_SERVER_URL`, cross-site cookies and CORS for the admin. Server components call the api Worker through the same binding.
- **Env types:** Worker env types come from Alchemy (`Cloudflare.InferEnv<typeof server>`), not hand-written interfaces.
- **New packages from §3.2** are added under `packages/` with `create-better-t-stack add --package`.

### 2.2 Versions and reference sources

We use the latest npm release of each library. Where the latest line is a pre-release, the scaffold's line is kept and the reason is noted. Each library is cloned at that release under `refs/stack/` so plans cite real source, and the matching agent skill is installed.

| Library | Version | Reference clone (tag) | Skill |
|---|---|---|---|
| vinext | 1.0.1 | `refs/stack/vinext` (`vinext@1.0.1`) | `migrate-to-vinext` |
| Better Auth | 1.7.7 (with `@better-auth/drizzle-adapter` 1.7.7) | `refs/stack/better-auth` (`v1.7.7`) | `better-auth-best-practices`, `organization-best-practices` |
| Alchemy | 2.0.0-beta.80 (v2 has no stable release; beta.80 adds `Website.Vinext`), with `@alchemy.run/frontend-frameworks` 2.0.0-beta.80 | `refs/stack/alchemy` (`v2.0.0-beta.80`) | `effect-ts` |
| Effect | 4.0.0 (`@effect/platform-node`, `@effect/platform-bun` 4.0.0) | — | `effect-ts` |
| Drizzle ORM and drizzle-kit | 1.0.0-rc.4. The `latest` tag is 0.45, but Better Auth's `relations-v2` adapter needs the 1.0 line | `refs/stack/drizzle-orm` (`v1.0.0-rc.4`) | `drizzle-orm` |
| Hono | 4.13.12 | `refs/stack/hono` (`v4.13.12`) | — |
| tRPC | 11.19.0 | `refs/stack/trpc` (`v11.19.0`) | — |
| evlog | 2.30.0 | `refs/stack/evlog` (`evlog@2.30.0`) | `review-logging-patterns` |
| varlock | 1.21.1 | `refs/stack/varlock` (`varlock@1.21.1`) | `varlock` |
| Vitest | 5.0.3 | — | `vitest` |
| Cloudflare platform | — | `refs/stack/skills` (Cloudflare's skills repo, `main`) | `cloudflare`, `workers-best-practices`, `wrangler` |
| Turborepo | as scaffolded | — | `turborepo` |

## 3. Architecture

### 3.1 Workers

| Worker | Source | Serves |
|---|---|---|
| **web** | `apps/web` (vinext) | Storefront and admin UI, plus same-origin `/api/auth/*` and `/trpc/*` forwarded to the api Worker. Routes: `*.payleor.app/*`, `*.{STORE_DOMAIN}/*` when the store domain is separate (§4.2), and the Cloudflare for SaaS fallback for custom domains. A `proxy.ts` rewrites each host to its route tree (`/admin/…`, `/store/…`, or the marketing pages); store pages get the store from the api Worker, which resolves it from the original host |
| **api** | `apps/server` (Hono) | `/api/auth/*` (Better Auth); `/trpc/*` (admin API); the protocol endpoints; `/.well-known/ucp`; `/mcp`; `/webhooks/*`; the agent Durable Object classes; the Queue consumer; the reconciliation cron |

Outside Cloudflare, one **Render Workflows** service (`apps/workflows`) runs bulk catalog imports. It never touches Postgres; it reports back to the api Worker through a signed internal endpoint (sponsor spec §4).

The web Worker calls the api Worker through a **service binding**, never over the public internet. The api Worker also answers on store hosts for the protocol paths (`/merchant-cart*`, `/checkout_sessions*`, `/checkout-sessions*`, `/.well-known/ucp`, `/mcp`). The web Worker forwards those paths to it through the service binding.

### 3.2 Shared packages

| Package | Purpose | May import |
|---|---|---|
| `core` | Domain: tenants, catalog, checkout, orders, refunds, disputes, consent. Pure TypeScript, with ports (interfaces) for storage, payments, events and clock | nothing outside itself |
| `db` | Drizzle schema, migrations, and implementations of the `core` repository ports | `core` |
| `paypal` | Tenant-aware PayPal REST client (§6.3) | none |
| `braintree` | Braintree GraphQL client: charge a token, read disputes | none |
| `payments` | Implements the `core` payment port; picks the rail by channel | `core`, `paypal`, `braintree` |
| `protocols` | Adapters: `store-sync`, `acp`, `ucp`, `ap2` | `core` |
| `agent-tools` | Tool definitions with role and money-movement metadata, shared by the MCP server and the agents | `core` |
| `auth` | Better Auth config: PayPal sign-in, organizations and teams (stores), store slug rules on team create and update, MCP OAuth bridge | `core`, `db` |
| `ui` | Shared React components and the MCP Apps widgets | none |

**Rule:** `core` never imports PayPal, Braintree, Cloudflare or Drizzle code. Every surface calls the same `core` use cases. An import-boundary lint rule enforces this.

### 3.3 Cloudflare services

| Service | Use |
|---|---|
| Hyperdrive in front of Aiven Postgres, used through Drizzle | Source of truth |
| Workers KV (classic; switch to KV Instant when it is generally available) | Cache of hostnames and slugs to stores |
| R2 | Product images; product documents for AI Search |
| Image transformations (the scaffold already binds `IMAGES`) | Resize images on request (vinext does not optimize images at build time) |
| AI Search, one instance per store (`ai_search_namespaces` binding) | Product search for the storefront and agents |
| Workers AI: `@cf/cloudflare/clef`, `clef-flash` | Dispute triage, action guardrail |
| AI Gateway | All LLM calls, model fallback, logs |
| Durable Objects (Agents SDK) | Agent sessions; dispute deadline alarms |
| Queues | Webhook processing, search indexing |
| Cron Triggers | Reconciliation every 15 minutes |
| Cloudflare for SaaS | Merchants' own domains |

## 4. Tenancy and routing

### 4.1 Model

Tenancy is backed by the Better Auth organization plugin with teams enabled (`refs/stack/better-auth/packages/better-auth/src/plugins/organization/`).

- A **store** is the tenant. Each store is a Better Auth **team**, so its ID is the team ID. The `team` table carries the store columns as team `additionalFields`: `slug` (globally unique), `status` (`draft`, `active`, `suspended`), and `paypal_merchant_id`. Branding, domains and connections live in our own tables keyed by `store_id` (the team ID).
- A merchant **organization** (Better Auth organization) owns many stores. It holds the people and their roles.
- **Staff access is two-dimensional:**
  - *Which stores:* organization owners and admins can open every store of the organization. Other members can open only the stores whose team they belong to.
  - *What they can do:* the member's organization role, checked with the plugin's access control. Better Auth team members have no per-team role (the `teamMember` schema has no additional fields), so a role applies to every store the member can open.
- **Creating a store** is Better Auth's `createTeam`. It already requires the `team:create` permission (owners and admins by default). Our `beforeCreateTeam` and `beforeUpdateTeam` hooks validate and normalize the slug with the `core` slug rules, so the rules hold even when the browser calls Better Auth directly. The plugin's default team (created with each organization) is turned off, because a store needs a slug.
- **Adding staff to a store** is Better Auth's `addTeamMember` (requires `member:update`).
- A store has: slug, status, branding, custom domains, its PayPal merchant ID (from onboarding), and an optional Braintree merchant ID.

### 4.2 Hostnames

Two settings name the domains:

- `PLATFORM_DOMAIN` (`payleor.app`): the marketing site, the admin, the api and the MCP endpoint.
- `STORE_DOMAIN`: the storefronts. It defaults to `PLATFORM_DOMAIN`. The plan is a separate, neutral domain such as `payleor.site` (Whop uses `whop.site`, Shopify `myshopify.com`). Merchants sell courses, digital goods and memberships as well as physical products, so the name should not suggest retail only (avoid `.store` and `.shop`). A separate domain keeps store pages from setting cookies on the admin's domain, can be added to the Public Suffix List so browsers treat each store as its own site, and keeps a flagged store from affecting the admin's domain reputation. Moving stores there is a configuration and DNS change. Development uses `elysiumjs.com` for both.

| Host | Serves |
|---|---|
| `{slug}.{STORE_DOMAIN}` | That store's storefront and protocol endpoints |
| Merchant domain | The same store, through Cloudflare for SaaS |
| `admin.payleor.app/` | Sign-in, the list of stores the user can open, organization pages |
| `admin.payleor.app/{storeSlug}/…` | That store's dashboard (§4.7) |
| `mcp.payleor.app/mcp` | Shared MCP endpoint for both plugins |
| `api.payleor.app` | Webhooks, OAuth callbacks |

There are no path-based storefronts (`store.payleor.app/{slug}` was dropped). Protocol endpoints such as `/.well-known/ucp` must sit at the root of the store's own host, and each subdomain is its own browser origin. `store` stays a reserved slug, so `store.payleor.app` answers 404 and stays free for a possible store directory later. A public store profile on the platform domain (`payleor.app/{slug}`, like `whop.com/{store}`) is a possible later feature, not part of the hackathon scope; it would also need the marketing site's top-level paths reserved.

**Reserved slugs:**
- Platform host labels: `www`, `admin`, `api`, `mcp`, `store`, `shop`, `app`, `docs`, `mail`, `status`, `help`, `support`, `blog`, `cdn`, `dashboard`, `auth`, `oauth`, `checkout`, `pay`, `payments`, `billing`.
- Environments: `dev`, `staging`, `preview`, `sandbox`, `test`, `demo`.
- Mail and DNS: `email`, `smtp`, `imap`, `autodiscover`, `autoconfig`, `ns1`, `ns2`.
- Trust and brands: `security`, `abuse`, `payleor`, `paypal`, `venmo`, `braintree`.
- Agents: `agent`, `agents`.
- The admin's own top-level paths, so a store slug can never shadow them: `login`, `signup`, `logout`, `account`, `settings`, `orgs`, `new`, `verify-email`, `forgot-password`, `reset-password`, `trpc`, `assets`, `static`.

The list stays the same after stores move to their own domain: slugs are also admin paths, and keeping them avoids renaming stores.

### 4.3 Resolving a request to a store

One pure function in `core`, `parseRequestTarget(hostname, { platformDomain, storeDomain })`, classifies every request as a platform app, a store (with its slug), a custom domain, or unknown:

- `PLATFORM_DOMAIN` itself is the marketing site; `www`, `admin`, `api` and `mcp` under it are platform apps.
- Any other single label under `STORE_DOMAIN` is a store slug, if it passes the slug rules (reserved slugs fail, so they are unknown).
- When the domains differ, other labels under `PLATFORM_DOMAIN`, the bare `STORE_DOMAIN` and deeper subdomains of either are unknown.
- Any other host is a custom domain.

- **api Worker (Hono middleware):**
  1. If the host is a custom hostname, use `request.cf.hostMetadata.storeId`.
  2. If the host is `{slug}.{STORE_DOMAIN}`, use the slug.
  3. Look up `id:`, `slug:` or `host:` keys in KV. On a miss, read Postgres and write the result to KV.
  4. If nothing matches, or the store is suspended, return 404 `store_not_found`.
- **web Worker (`proxy.ts`):** rewrites by target: `admin` host to `/admin/…`, store hosts to `/store/…`, `www` to the marketing pages. Requests that reach `/admin` or `/store` paths directly are answered with 404, so one host can never serve another host's pages. The web Worker has no database access; pages ask the api Worker for store data through the service binding, keeping the original host so the api resolves the same store.

Every store change writes to Postgres first, then updates KV.

### 4.4 Tenant context

`TenantContext = { storeId, organizationId, paypalMerchantId?, braintreeMerchantId?, channel, environment }`

- `channel` is one of `web`, `admin`, `mcp`, `acp`, `ucp`, `store-sync`, `agent`.
- The context is passed **as an explicit argument** to every `core` use case and repository method. It is never read from global or async-local state.
- Repository methods for store tables cannot be called without it. A test checks that every query on a store table filters by `store_id`.

### 4.5 Inbound requests that are not tied to a host

- **PayPal webhooks:** map to a store by `payee.merchant_id`, or the dispute's `seller.merchant_id`.
- **Store Sync:** the merchant ID in the PayPal JWT must match the store resolved from the host. A mismatch returns 403.
- **MCP:** see §8.

### 4.6 Custom domains

1. The merchant enters a domain in the admin.
2. The api creates a Cloudflare for SaaS custom hostname with `custom_metadata: { storeId }`.
3. The admin shows the CNAME and TXT records to add, then the verification status until the domain is active.

### 4.7 Store dashboards

- Every store has its own dashboard at `admin.payleor.app/{storeSlug}/…`. The store comes from the URL, not from session state, so two tabs can show two stores. The session's `activeOrganizationId` and `activeTeamId` are only used by Better Auth's own endpoints.
- `admin.payleor.app/` lists the stores the user can open across all their organizations (§4.1 access rule) and links to each dashboard.
- Store-scoped tRPC procedures take `storeSlug` as input. A shared `storeProcedure` resolves the store, applies the access rule, and adds the store and a `TenantContext` (channel `admin`) to the procedure context. A store the user cannot open is reported as `NOT_FOUND`, so its existence does not leak.

## 5. PayPal onboarding

1. **Connect:** the admin's "Connect PayPal" button calls `POST /v2/customer/partner-referrals`. The request uses `tracking_id = storeId` and `products: [EXPRESS_CHECKOUT]`, and asks for these features: `PAYMENT`, `REFUND`, `PARTNER_FEE`, `READ_SELLER_DISPUTE`, `UPDATE_SELLER_DISPUTE`, `TRACKING_SHIPMENT_READWRITE`, `ACCESS_MERCHANT_INFORMATION`. Services teams ask for the same features except `TRACKING_SHIPMENT_READWRITE`, because they ship nothing and PayPal rejects a referral that asks for a feature the partner app is not approved for (2026-10-07, R0). The merchant is redirected to `links[rel=action_url]` (R§4; `refs/paypal-rest-api-specifications/openapi/customer_partner_referrals_v2.json`).
2. **Return:** PayPal sends the merchant back to `admin.payleor.app/{storeSlug}/paypal/return` with their merchant ID. We store it in `paypal_connections`.
3. **Status check:** `GET /v1/customer/partners/{partner_id}/merchant-integrations/{merchant_id}`. The store is connected when `payments_receivable` and `primary_email_confirmed` are both true. This endpoint is not in the specs, so it is taken from `refs/ruleshub/paypal-checkout/enterprise-checkout/rules.md:155`.
4. **Gate:** a store that is not connected cannot publish or take payments. The admin shows a clear "not connected" state.
5. **Demo store:** a seed script creates a store linked to a sandbox seller account that is already onboarded.

Going live requires PayPal to approve us as a partner. That is a launch task, not a milestone task.

## 6. Checkout and payments

### 6.1 Checkout

A `Checkout` holds:
- store and channel
- line items, with prices copied from the catalog at each change
- buyer contact and shipping address
- the shipping options offered and the one chosen
- totals: subtotal, shipping, tax, total and currency
- the payment rail and its reference
- consent proofs
- `expiresAt`
- `version`, used to reject concurrent updates (`VersionConflict`)

**States:**

```
open ──► ready_for_payment ──► awaiting_approval ──► completed
  │              │                     │
  └──────────────┴─────────────────────┴──► canceled | expired | failed
```

- `ready_for_payment` means the line items, address and shipping choice are present and valid. A cart with only digital products (`requiresShipping` off) needs the buyer's country and, for the US and Canada, state or province (for tax), but no shipping choice.
- `awaiting_approval` means a payment has started and the buyer's approval or token is pending.

**Use cases:** `create`, `replace` (full replacement, used by Store Sync `PUT`), `update` (partial edit), `quote`, `startPayment`, `complete`, `cancel`.

- Every change reprices from the catalog and checks stock. Prices sent by a client or agent are ignored.
- A changed price is reported as an issue and never accepted automatically.

**v1 pricing:**
- shipping: flat-rate options per store
- tax: see "Tax" below
- one currency per store

**Tax (Shopify's manual model):**

The merchant is the seller, so the merchant is responsible for registering, filing and remitting tax. We help them charge, show and record it. The admin says so and tells merchants to confirm their rates with a tax advisor.

- **Registrations:** the merchant adds each country, or country and state/province, where they are registered, with an optional tax number. Tax is collected only for destinations that match a registration, with one exception: EU VAT on digital goods (below), where one EU registration covers every EU country. No registration means no tax.
- **Default rates:** we ship a built-in rate table: EU and UK VAT, US state base rates, Canadian provinces, and standard VAT/GST for the other supported countries. Rates are country or state level only, never city or county, the same as Shopify's overrides.
- **Product flags:** `chargeTax`, on by default; off means the product is never taxed. `requiresShipping` (Shopify's "This is a physical product"), on by default; off marks a digital product.
- **Overrides:** a rate for a given product, or for shipping, in a given country or state. Overrides attach to products because v1 has no collections.
- **Store settings:**
  - `pricesIncludeTax`: catalog prices already include tax (usual in the EU and UK) or tax is added on top (usual in the US)
  - `chargeTaxOnShipping`
  - `chargeVatOnDigitalGoods`: digital products sold to EU buyers are taxed at the buyer's country rate, as under the EU One-Stop Shop scheme
- **Calculation:** `quote` works out tax per line in minor units with banker's rounding (round half to even), then adds the lines up. For each line, using the buyer's address:
  1. `chargeTax` off: zero.
  2. A digital product, an EU buyer, `chargeVatOnDigitalGoods` on and at least one EU registration: the buyer's country rate.
  3. No registration matching the destination: zero.
  4. Otherwise, a product override for that country or state, if any, then the default rate for that country or state.
  
  Shipping follows steps 3–4 with shipping overrides, and only when `chargeTaxOnShipping` is on. With `pricesIncludeTax`, the tax is taken out of the line price instead of added to it.
- **PayPal:** `startPayment` sends `amount.breakdown.tax_total` and each item's `tax`, so PayPal's records match the checkout. ACP, UCP and Store Sync totals come from the same quote.
- **Receipts:** show each tax line with its rate, plus the merchant's tax number for the buyer's region.
- **Legal checks before going live (with an accountant, not code):** the EU "deemed supplier" rule for platforms involved in selling electronic services (Article 9a of Regulation 282/2011), and US marketplace-facilitator laws if a shared marketplace is ever added. Checkout, receipts and the terms of service name the merchant as the seller.

**Stock:**
- checked on every change
- reduced in one atomic step right before capture (`UPDATE variants SET available = available - $qty WHERE id = $id AND available >= $qty`)
- released if capture fails

### 6.2 Payment rails

| Rail | Channels | Flow |
|---|---|---|
| **PayPal REST** (Orders v2) | `web`, `store-sync`, `mcp` (Claude, or ChatGPT without ACP), `agent` | `startPayment` creates the order with `payee.merchant_id`, a `platform_fees` entry at the store plan's rate (§6.7), Auth-Assertion and the BN code. The buyer approves with v6 buttons on web or an approval link in chat. `complete` captures on the server. `PAYMENT.CAPTURE.COMPLETED` confirms |
| **Braintree** | `acp`, `ucp`, and `mcp` when ChatGPT Instant Checkout is used | `complete` charges the delegated token (ACP, Instant Checkout) or the Google Pay token (UCP) as a sale under the store's Braintree merchant |

The `payments` package selects the rail from the payment input: a Braintree token goes to Braintree, and everything else goes to PayPal REST. The channel decides which inputs are allowed.

### 6.3 PayPal client (`packages/paypal`)

- Plain `fetch`. Request and response types come from `refs/paypal-rest-api-specifications/openapi/*.json`.
- **OAuth:** the platform token is cached until shortly before `expires_in` runs out.
- **Headers on every seller call:** `PayPal-Auth-Assertion` (`iss` = partner client ID, `payer_id` = seller merchant ID) and `PayPal-Partner-Attribution-Id`.
- **Headers on every POST:** `PayPal-Request-Id`, derived from the checkout or order ID plus the step.
- **Retries:** 429 and 5xx are retried with exponential backoff and jitter, reusing the same request ID. Other 4xx errors are not retried.
- **Logging:** every call adds `paypal: { operation, status, debugId, attempt }` to the current evlog wide event. Tokens and secrets are never logged.
- **Endpoint groups in v1:** partner referrals, merchant integrations, Orders v2, Payments (capture, refund), tracking, disputes, webhook signature verification.

### 6.4 Consent gate

`complete` and every refund or dispute action need a **consent proof**. Accepted proofs:

| Proof | Produced by |
|---|---|
| PayPal approval | The buyer approved the order on PayPal (web buttons or approval link) |
| ACP delegated token | ChatGPT Instant Checkout, after the buyer confirmed in ChatGPT |
| UCP payment token | Google's trusted checkout UI |
| AP2 Payment Mandate | A verified mandate tied to this checkout's `checkout_hash` |
| Merchant confirmation | A redeemed `pending_actions` token (refunds and dispute actions, §8.3) |

Without a valid proof, the call fails with `ConsentRequired`. This holds for every caller, including our own agents.

### 6.5 Orders

- A completed checkout becomes an `Order`. It holds the rail, the capture or transaction ID, the platform fee, fulfillment status, and refunds.
- **Fulfillment** in the admin adds a carrier and tracking number and sends them to PayPal tracking.
- **Refunds** go through the consent gate. They are full or partial and are capped at the remaining captured amount.

### 6.6 Idempotency

- Every changing endpoint accepts an idempotency key. ACP uses `Idempotency-Key`; other channels derive a key from the request.
- `idempotency_keys` stores the key, a request hash and the response. A repeat with the same key and the same hash returns the stored response. The same key with a different hash returns 409.

### 6.7 Billing (Payleor plans)

**Update (2026-10-07):** freelancers and teams get their own plans ([`2026-10-07-seller-pricing-proposal.md`](2026-10-07-seller-pricing-proposal.md)); the shop plans below are unchanged. Subscriptions run on a second Payleor PayPal business account, because PayPal's multiparty docs say the partner account that receives platform fees cannot hold a balance or sell. The setup script creates 18 PayPal plans (three audiences, three tiers, two intervals).

Payleor follows Shopify's pricing model: a plan per store, cheaper when paid yearly, plus a per-order fee that drops on higher plans. Every Payleor order goes through PayPal, so the fee always applies (Shopify charges it whenever a store uses a third-party payment provider).

| Plan | Monthly | Yearly (per month) | Fee per order | Includes |
|---|---|---|---|---|
| Starter | $12 | $9 | 2% | Storefront, ChatGPT and Claude plugins, AI shopper protocols, shopping agent, 2 staff, AI credits |
| Grow | $39 | $29 | 1% | Everything in Starter, plus custom domain, admin agent, dispute agent, 5 staff, more AI credits |
| Scale | $129 | $99 | 0.5% | Everything in Grow, plus 15 staff, priority support, the most AI credits |

- **Billing unit:** the store, like Shopify. An organization with three stores has three plans.
- **Trial:** 14 days free, starting when the store is created, with Starter's limits and fee rate. When the trial ends without a plan, the store returns to `draft` and its storefront and agent channels stop taking orders. The admin keeps working so the merchant can subscribe.
- **Payment:** the PayPal Subscriptions API (`/v1/billing/plans`, `/v1/billing/subscriptions`) on Payleor's own PayPal account. This is a first-party call, with no Auth-Assertion. Six PayPal plans (three tiers, monthly and yearly) are created once by a setup script, and their IDs are settings. The merchant approves the subscription on PayPal. Changing tier uses the subscription revise call.
- **Webhooks:** `BILLING.SUBSCRIPTION.ACTIVATED`, `.UPDATED`, `.CANCELLED`, `.SUSPENDED`, `.EXPIRED`, `.PAYMENT.FAILED` and `PAYMENT.SALE.COMPLETED` update `store_subscriptions`. They reach the same `/webhooks/paypal` endpoint (§9.2). They carry no seller merchant ID, so they are matched to the store by subscription ID (`custom_id` = store ID).
- **Grace period:** after a failed payment, the store keeps selling for 7 days while PayPal retries; then it returns to `draft`.
- **Limits:** `planFor(store)` in `core` returns the fee rate and the limits (staff, custom domain, admin and dispute agents, monthly AI credits). Use cases check it and fail with `PlanLimit`. `startPayment` reads the fee rate from it.
- **Sandbox deployment:** billing runs against the PayPal sandbox like everything else, so the prices are real and the money is fake.
- **Before billing ships** (Nov 2–8 week, §14): `planFor` returns Starter for every store, and the trial is not enforced.
- **Our own tax:** VAT or similar on plan and fee income is Payleor's obligation, separate from the merchant's sales tax (§6.1).

## 7. Protocol adapters

Each adapter in `packages/protocols/<name>`:

1. checks authentication and the signature
2. validates the payload with a zod schema built from the pinned spec version
3. calls `core` use cases
4. translates the result and any errors into the protocol's format

Adapters contain no business logic.

### 7.1 Store Sync (R§3.1)

- **Endpoints:** `POST /merchant-cart`, `GET /merchant-cart/{id}`, `PUT /merchant-cart/{id}` (full replacement), `POST /merchant-cart/{id}/checkout`.
- **Authentication:** a PayPal-signed JWT, checked against PayPal's public keys, whose merchant must match the store.
- **Mapping:**
  - creating a cart → `create`, plus a PayPal order
  - `PUT` → `replace`, plus a PATCH to the PayPal order
  - checkout → `complete`, using `payment_method.token` (the PayPal order ID) as the consent proof
- **Errors:** business problems come back as `200` with `validation_status` and `validation_issues[]`, including resolution options. A cart that cannot be created returns `422` with `details[].business_context`.

### 7.2 ACP `2026-04-17` (R§3.2)

- **Endpoints:** `POST /checkout_sessions`, `GET /checkout_sessions/{id}`, `POST /checkout_sessions/{id}`, `POST /checkout_sessions/{id}/complete`, `POST /checkout_sessions/{id}/cancel`.
- **Headers checked:** Signature, Timestamp, Idempotency-Key, Request-Id, API-Version.
- `complete` charges the Braintree delegated token through `payments`. The token's limits (merchant, `max_amount`, currency, expiry) are checked by Braintree, and we also check them before calling.
- Which ACP payment-config format Braintree supports is still an open question (R§10, R§11 Q3). The adapter keeps it behind one mapping function.

### 7.3 UCP REST (R§3.3)

- **`GET /.well-known/ucp`:** a per-store profile listing services, the capabilities we support (`dev.ucp.shopping.checkout`, `.catalog.search`, `.catalog.lookup`, `.order`, `.fulfillment`), the Braintree Google Pay payment handler, and the store's public JWKs.
- **Endpoints:** `POST /checkout-sessions`, `GET /checkout-sessions/{id}`, `PUT /checkout-sessions/{id}`, `.../complete`, `.../cancel`.
- **Authentication:** the `UCP-Agent` header, plus HTTP Message Signatures (RFC 9421).
- **Status mapping:**
  - `open` → `incomplete`
  - `ready_for_payment` → `ready_for_complete`
  - `awaiting_approval` → `complete_in_progress`
  - `completed` → `completed`
  - `canceled`, `expired` and `failed` → `canceled`
- **Hand-off to our storefront:** `continue_url` points to the store's checkout page.

### 7.4 AP2 v0.2, Human Present (R§3.4)

- **Checkout JWT:** for each UCP checkout we sign one with the store's signing key. Keys are stored encrypted, and their public keys are published in `/.well-known/ucp`.
- **On `complete`:** we verify the Payment Mandate (an SD-JWT) against the `checkout_hash`, then store the mandate and a signed receipt in `mandates`.
- **Our shopping agent:** it creates a mandate only after the buyer approves in our UI.
- **Dispute evidence:** stored mandates and receipts become evidence for the dispute agent (§9.3).

### 7.5 Conformance test agent (`tools/conformance`)

Scripted clients run the full flow for each protocol against a deployed sandbox environment:

| Protocol | What the client uses |
|---|---|
| Store Sync | JWTs signed by a test key. The test issuer is accepted only when `environment = sandbox` |
| ACP | Braintree sandbox test nonces |
| UCP | Braintree sandbox Google Pay test nonces; RFC 9421 signatures with a test key |
| AP2 | Mandates signed by a test agent key |

The tests run in CI on every merge to the main branch, and through `pnpm conformance` for the demo. When real access is granted, only the issuer and key settings change.

## 8. MCP plugin (ChatGPT and Claude)

### 8.1 Server

- `mcp.payleor.app/mcp`, built with `createMcpHandler` from `agents/mcp/server` (MCP SDK v2). One `McpServer` is created per request (R§12.2).
- `McpAgent` is not used; it is deprecated.
- **OAuth:** `@cloudflare/workers-oauth-provider`, with Better Auth as the login step. Tools read identity through `getMcpAuthContext()`.
- **Per-store endpoint:** `{store-host}/mcp` serves the same tools with the store fixed. `allowedHostnames` covers the custom domains.

### 8.2 Tools and widgets

| Group | Tools | Login |
|---|---|---|
| Buyer | `search_products`, `get_product`, `create_checkout`, `update_checkout`, `get_checkout`, `start_payment`, `complete_checkout`, `get_order_status` | Not required. The tools take a store slug, or search across stores that opt into the marketplace |
| Merchant | `list_orders`, `get_order`, `add_tracking`, `refund_order`, `update_inventory`, `list_disputes`, `get_dispute`, `draft_dispute_response`, `submit_dispute_response`, `accept_claim`, `confirm_action` | OAuth required. Scoped to the user's stores and role |

**Widgets** (MCP Apps, `text/html;profile=mcp-app`, linked through `_meta.ui.resourceUri`): product grid, cart and checkout, order status, dispute summary. Without the UI extension, the tools return text only.

### 8.3 Paying and confirming in chat

- **Checkout widget:** it checks for `window.openai?.requestCheckout`.
  - **ChatGPT:** it starts ACP Instant Checkout through Braintree. `complete_checkout` charges the token.
  - **Claude and others:** it shows a "Pay with PayPal" approval link. The buyer approves in PayPal and returns to the store's confirmation page. The server captures, and `get_order_status` reports the result.
- **Money-moving merchant tools** (`refund_order`, `submit_dispute_response`, `accept_claim`) never act directly:
  1. They create a `pending_actions` row and return a summary plus a single-use token valid for 10 minutes.
  2. The widget shows a Confirm button, which calls `confirm_action(token)`.
  3. These tools carry `destructiveHint: true`.

  MCP elicitation is not relied on, because not every client supports it.

## 9. Agents

### 9.1 Runtime

- Each agent is a Cloudflare Agents SDK class (a Durable Object) exported by the api Worker.
- All model calls go through AI Gateway, using the platform's own Claude and GPT keys, with a default and a fallback model per agent.
- Agents use tools from `agent-tools` only. Each tool declares `requiredRole` and `movesMoney`. Tools that move money go through the consent gate (§6.4).

| Agent | Instance name | Surface | Can do | Cannot do |
|---|---|---|---|---|
| Shopping | `shop:{storeId}:{sessionId}` | Storefront chat widget | Search (AI Search), answer questions, build and update the checkout, hand off to v6 buttons | Complete a payment |
| Admin | `admin:{storeId}:{userId}` | Admin side panel; primary agent of the AG Studio analytics page (sponsor spec §2.6) | Answer sales and order questions, build analytics widgets, check market prices (Channel3), draft product copy, prepare inventory and fulfillment changes, propose refunds | Refund without merchant confirmation; change store data from the analytics page |
| Dispute | `dispute:{storeId}:{disputeId}` | Event-driven; output shown in the disputes console | Triage, gather evidence, draft responses, schedule reminders | Submit or accept without merchant confirmation |

- **Identity:** a connection is accepted only after the session is checked against the store in the instance name. The agent builds its `TenantContext` from that name.
- **Guardrail:** before any write tool runs, `clef-flash` answers one yes-or-no question: does this action match the user's latest request? Below the threshold, the action is refused and the agent asks the user. This check is defense in depth; the consent gate is the hard control.

### 9.2 Webhook pipeline

1. `POST /webhooks/paypal` verifies the signature through PayPal's verify-webhook-signature API, inserts the event into `webhook_events` (unique event ID), returns 200, and enqueues the event.
2. The Queue consumer finds the store (§4.5) and sends the event to a handler:
   - capture events → orders
   - refund events → refunds
   - `CUSTOMER.DISPUTE.CREATED`, `.UPDATED`, `.RESOLVED` → the dispute agent
   - `BILLING.SUBSCRIPTION.*` and subscription `PAYMENT.SALE.*` events → billing (§6.7)
3. Handlers are safe to run twice. Failed messages are retried by Queues, then sent to a dead-letter queue.

### 9.3 Dispute flow (PayPal disputes)

1. **Fetch:** load the dispute with Auth-Assertion: stage, channel, reason, `seller_response_due_date`, `allowed_response_options`, requested evidence. Update `disputes`.
2. **Triage with Clef:**
   - `choice` recommended action: `refund_now`, `fight_with_evidence`, `make_offer` or `accept`
   - `score` chance of winning
   - `noul` urgency
   - `ALERT` channel cases always flag a refund within 20 hours.
3. **Evidence pack:** collect the order, the capture, tracking and delivery data, our messages with the buyer, and any AP2 mandates and receipts. Map them to the evidence types the reason requires (for example `PROOF_OF_FULFILLMENT` with carrier and tracking for item-not-received). The spec governs evidence types (R§10).
4. **Draft:** the LLM writes the response notes and a summary for the merchant into `dispute_drafts`.
5. **Reminders:** Durable Object alarms fire 72 hours and 24 hours before the due date, or on the 20-hour clock for alerts. Each one creates an admin notification.
6. **Act:** in the console, the merchant reviews, edits and confirms. Only then do we call `provide-evidence`, `make-offer` or `accept-claim`. We never accept or submit automatically.
7. **Failure:** if any step fails, the dispute is marked `needs_manual_review`. Reminders still fire.

**Braintree disputes** (from ACP and UCP orders) are read through the Braintree API and shown read-only, with a link to the Braintree control panel.

## 10. Admin (scope for Nov 12)

| Area | Features |
|---|---|
| Onboarding and settings | Connect PayPal (§5), store name, slug, branding (logo, colors), custom domain (§4.6), shipping rates, taxes (registrations, overrides, prices include tax, tax on shipping, EU VAT on digital goods; §6.1) |
| Billing | Current plan and trial days left, choose or change plan (monthly or yearly) through PayPal, cancel (§6.7) |
| Catalog | Products, variants (price, SKU, stock), images (R2), publish or unpublish. A change triggers re-indexing for search. Start a product from a link or photo and a market price panel (Channel3); bulk import of up to 100 links as drafts (Render Workflows) (sponsor spec §3–4) |
| Analytics | AG Studio report per store: KPI tiles, Money flow, Dispute clock and Agent vs human sales widgets, saved reports, the Admin agent building widgets (sponsor spec §2) |
| Orders | List and filter, detail, add tracking, full or partial refund through Confirm |
| Disputes | List (stage, channel, due-date countdown, triage), detail (timeline, evidence pack, draft, only the actions allowed), Confirm to act |
| Agent panel | Admin agent chat |

## 11. Data model (Postgres)

Every store table includes `store_id`. Main tables:

- **Auth (Better Auth):** `user`, `session` (with `active_organization_id`, `active_team_id`), `account`, `verification`, `organization`, `member`, `invitation`, `team` (the stores, with `slug`, `status`, `paypal_merchant_id`), `team_member` (store staff)
- **Billing:** `store_subscriptions` (store, tier, interval, PayPal subscription ID, status, `trial_ends_at`, `current_period_ends_at`, `grace_ends_at`)
- **Platform:** `store_domains`, `paypal_connections`, `braintree_connections`, `store_signing_keys`. Their `store_id` references `team.id`
- **Catalog:** `products` (with `charge_tax`, `requires_shipping`), `variants`, `product_images`, `shipping_rates`
- **Tax:** `tax_registrations` (country, optional region, optional tax number), `tax_overrides` (product or shipping, country, optional region, rate). Default rates are a versioned data file in `core`, not a table. Tax settings live on the store
- **Commerce:** `checkouts`, `checkout_lines`, `payments`, `orders`, `order_lines`, `fulfillments`, `refunds`
- **Disputes and trust:** `disputes`, `dispute_drafts`, `mandates`
- **Analytics and imports:** `analytics_reports`, `catalog_imports`, `catalog_import_items`, `price_watches` (optional). `orders.channel`, `orders.is_demo`, `payments.paypal_fee` and `payments.payleor_fee` feed analytics (sponsor spec §6)
- **Infrastructure:** `idempotency_keys`, `webhook_events`, `pending_actions`, `audit_log`, `notifications`

`audit_log` records every tool and agent action: actor type (staff, buyer, our agent, external agent), actor ID, channel, tool, input summary, result.

## 12. Errors and reconciliation

| `core` error | Meaning | Example mapping |
|---|---|---|
| `TenantNotFound` | No store for this host or slug | 404 |
| `StoreNotConnected` | PayPal is not connected | 409; admin banner |
| `OutOfStock` | Not enough stock | Store Sync `INVENTORY_ISSUE`; ACP and UCP messages |
| `PriceChanged` | The catalog price changed | Store Sync `PRICING_ERROR` with `ACCEPT_NEW_PRICE` |
| `PaymentDeclined` | `INSTRUMENT_DECLINED` or a Braintree decline | The buyer can retry with another payment method |
| `ConsentRequired` | No valid consent proof | 403 |
| `VersionConflict` | Concurrent update | 409; the client re-reads and retries |
| `PlanLimit` | The store's plan does not include this (staff count, custom domain, an agent, AI credits) | 402; admin shows the plan that includes it |

- **Reconciliation cron (every 15 minutes):** re-checks checkouts in `awaiting_approval` older than 15 minutes, and payments in an unclear state, against PayPal. Webhooks and the cron are both safe to run twice.
- **Model failures:** AI Gateway switches to the fallback model. If that fails too, the agent reports that it cannot continue.

### 12.1 Logging with evlog

evlog emits **one wide event per unit of work**. It is not a business record; `audit_log` stays the record of who did what.

| Where | evlog entry point | Unit of work |
|---|---|---|
| api Worker (Hono) | `app.use(evlog())` from `evlog/hono`; `c.get('log')` in routes | One HTTP request, including protocol and MCP calls |
| web Worker (vinext) | `withEvlog` from `evlog/workers`, wrapping vinext's fetch handler in `apps/web/worker/index.ts`. It replaces the scaffold's `evlog/next` proxy and instrumentation | One page, route handler or server action request |
| Agent Durable Objects | `evlog/workers` | One agent turn, or one dispute flow step |
| Queue consumer, cron | `createLogger()` | One message batch, one reconciliation run |

- **Shared fields** on every event: `tenant: { storeId, organizationId, channel }`, `actor: { type, id }`, `requestId` (from `x-request-id`, else `cf-ray`).
- **Domain fields**, added by adapters and packages: `checkout: { id, state, total }`, `paypal: { operation, debugId }`, `braintree: { operation }`, `protocol: { name, version }`, `agent: { name, tool, model, guardrailScore }`.
- **Errors:** at the HTTP boundary, each `core` error is turned into an evlog structured error (`createError` with `why` and `fix`) before it is mapped to the protocol response.
- **Privacy:** `redact: true` and a header allowlist. Tokens, secrets, card data and buyer addresses are never logged; buyer emails are hashed.
- **Sampling:** keep every error and every event slower than 1 second; sample the rest.
- **Output:** JSON to Workers Logs in v1. Sending to an external service later is a configuration change.
- **Package rules:** `core` does not log. `paypal`, `braintree`, `payments`, `protocols` and `agent-tools` take the current logger as an explicit argument, the same way they take `TenantContext`, so they never depend on a framework integration.

## 13. Testing

| Layer | Tooling | Covers |
|---|---|---|
| Unit | Vitest | `core` use cases, state transitions, pricing, consent gate. No I/O |
| Integration | `@cloudflare/vitest-pool-workers` | Routes, tenant resolution, adapters, webhook pipeline, PayPal client (mocked `fetch`) |
| Contract | zod schemas built from the specs | Our payloads match Orders v2, Store Sync, ACP and UCP shapes |
| Sandbox end to end | `tools/conformance`; Playwright | Every protocol flow; web checkout; onboarding; refunds; disputes |
| Agent evals | Fixed scenarios | Dispute triage choice, evidence types, no money moved without confirmation, guardrail refusals |

Sandbox cases required by `refs/AGENTS.md`: the happy path, `INSTRUMENT_DECLINED` (through `PayPal-Mock-Response`), buyer cancel, a retried request with the same idempotency key, reconciliation driven by webhooks, and confirmation before any agent moves money.

## 14. Milestone plan

| Week | Scope | Done when |
|---|---|---|
| Oct 5–11 | Submit the PayPal early-access forms. Scaffold (done). Move the web app to vinext. Connect Aiven through Hyperdrive. Time-boxed Braintree GraphQL test. Tenancy and routing, organizations and stores, store dashboards, PayPal client, onboarding, catalog admin with Channel3 (start from a link or photo, market price) | A merchant signs in, creates a store, opens its dashboard, connects a sandbox seller, adds products, one of them started from a link |
| Oct 12–18 | Storefront, web checkout (v6, Orders v2 for the merchant), orders, webhooks and Queues, tracking, refunds. Bulk catalog import on Render Workflows | A buyer pays on the store's subdomain; the merchant ships and refunds; 20 links import as drafts |
| Oct 19–25 | MCP server, widgets, buyer and merchant tools, shopping agent with AI Search, admin agent | Buying in Claude through the approval link; buying in ChatGPT through the PayPal link |
| Oct 26–Nov 1 | Dispute agent and console, Store Sync and ACP adapters, conformance tests. AG Studio analytics page, theme, custom widgets and demo seed data (no licence key yet). Nov 1: request the AG Studio trial key | A simulated dispute is triaged, drafted and answered; Store Sync and ACP conformance passes; the Overview report renders the seeded data |
| Nov 2–8 | UCP and AP2, custom domains, billing (§6.7), the AG Studio agent (lead runner, delegation, `/ai/studio`), hardening | UCP and AP2 conformance passes; a custom domain serves a store; a merchant subscribes to a plan in the sandbox and the order fee follows the plan; "why did refunds jump" adds the right widget |
| Nov 9–12 | Seed the demo store, README (with a sponsor section), video under 3 minutes, Postman collection if time allows, submit | Submission complete |

Each week gets its own implementation plan and ends with working, tested software.

## 15. Risks and open items

| Risk | Mitigation |
|---|---|
| vinext gaps (`use cache`, build-time image and font optimization, typed `Link` hrefs) | No `use cache`; images through Cloudflare transformations; `typedRoutes` off. If a blocking gap appears, `Cloudflare.Website.Nextjs` (OpenNext) is the fallback, since app code is unchanged |
| Aiven requires TLS; Hyperdrive must accept its certificate | Week 1 deploy test. Hyperdrive supports `sslmode` settings and custom CA certificates if needed |
| Alchemy v2 is a beta (`2.0.0-beta.80`) | Pin the version; keep infrastructure changes small and reviewed |
| No per-store roles in Better Auth teams | A member's organization role applies to every store they can open. If per-store roles become necessary, add a `store_staff_roles` table keyed by team member |
| Host routing needs a real zone | Local development uses `*.localhost`. Deployed host routing (admin and store subdomains) starts once `payleor.app` is on Cloudflare; until then the deploy check covers the Workers, Hyperdrive and the marketing page |
| Braintree GraphQL details on Workers | Quick test in week 1. Fallback: the Node SDK in Containers |
| Store Sync, Agent Ready and UCP access not granted | Conformance agent proves each protocol; the video explains the gates |
| The AG Studio trial key (45 days) expires before judging ends on Dec 15 | Request it around Nov 1; ask AG Grid for an extension (sponsor spec §2.8) |
| Render deploys only from a Git repository | Add a GitHub remote for the workspace by Oct 12 (sponsor spec §4.5) |
| Store Sync JWT may not carry the seller's merchant ID | Ask PayPal (R§11 Q2); the adapter isolates JWT-to-store mapping |
| ACP payment-config format for Braintree | Ask PayPal (R§11 Q3); one mapping function |
| Braintree Auth is beta | Sandbox open beta covers v1; production needs PayPal approval |
| KV Instant in private beta | Classic KV; switch when it is generally available |
| AI Search billing from Nov 1 | Within the free tier for the demo; monitor |
| Scope versus five weeks | The weekly plan has a demo-ready result each week; UCP and AP2 are last so they can shrink |

## 16. After the hackathon

- **Merchant of record (MoR):** an optional mode where Payleor is the seller of record, as Paddle, Lemon Squeezy and Gumroad are, and handles sales tax and VAT for merchants. It reverses goal 4 for stores that opt in: buyer payments go to Payleor's PayPal account, and merchants are paid out. It needs tax registrations in the main markets (EU One-Stop Shop, UK, US states over their thresholds), a tax engine, payouts, and Payleor carrying refunds and chargebacks. The manual tax model (§6.1) stays the default for stores that remain the seller.
- **AG Studio licence:** a commercial licence for a multi-tenant product is custom priced. Decide whether to buy it or replace the analytics page with AG Grid Community and AG Charts plus our own agent (sponsor spec §2.8).
