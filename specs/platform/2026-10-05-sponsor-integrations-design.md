# Sponsor integrations: AG Grid, Channel3 and Render

> **2026-10-13:** AG Grid remains the sponsor prize. For the hackathon it is built in run D of the agentic surfaces program as team analytics for services teams (money flow, payouts, agent and human work) with the team copilot as AG Studio's agent; the store analytics below are the reference for widgets, the agent setup and the trial key timing (request it Nov 1). Render is not used.

- **Status:** approved on 2026-10-05
- **Products (2026-10-06):** this spec covers the commerce product. The payouts product ([`2026-10-05-services-teams-design.md`](../archive/platform/2026-10-05-services-teams-design.md)) adds a Render reconciliation job, AG Grid payment stats and a Postman collection for its public API (services spec §3).
- **Parent spec:** [`2026-10-03-payleor-platform-design.md`](2026-10-03-payleor-platform-design.md) (§9.1 agents, §10 admin, §11 data model, §14 milestones)
- **Sponsor research:** [`../hackathon/sponsors.md`](../hackathon/sponsors.md), with the sponsor pages and the tools' documentation read on 2026-10-05

## 1. Goal and prize strategy

Use the hackathon sponsors' tools where they make Payleor a better product, and compete seriously for one sponsor prize.

- A project wins **at most one sponsor prize**, on top of one grand prize or one honorable mention (`../hackathon/rules.md` §Prizes). So we go deep on one sponsor and keep the others smaller.
- Staff from AG Grid, Bryntum, Channel3, Elastic, Postman, Render and APIMatic sit on the main judging panel. Every integration is visible to a judge who also scores the grand prizes.

| Sponsor | Role | Prize we compete for |
|---|---|---|
| **AG Grid (AG Studio)** | **Main.** Store analytics page with custom widgets and the Admin agent inside AG Studio (§2) | Best Use of AG Grid: $5,000, $2,000, $1,000 ×3 |
| **Channel3** | Start a product from a link or photo; market price check; optional competitor price alerts (§3) | none (we can win only one) |
| **Render** | Render Workflows for bulk catalog import (§4) | none |
| **Postman** | Optional in the last days: a public collection of our ACP, UCP and MCP endpoints (§5) | none |

**Not used:** APIMatic (dropped on 2026-10-05; the PayPal client stays our own `fetch` client, parent §6.3), Bryntum (competes with AG Grid for the one sponsor prize), Elastic (overlaps AI Search, and its trial ends around Nov 18, before judging ends on Dec 15), Zapier, KERNEL and Astropods (no prize, no judge, no feature that needs them).

## 2. Store analytics with AG Studio

### 2.1 Page

- Route: `admin.payleor.app/{storeSlug}/analytics`, a client component using `ag-studio` and `ag-studio-react` (2.1.x), with `AgStudioAiModule` registered.
- First load shows an **Overview** report shipped as JSON in code. Merchants can switch to edit mode, change widgets, add pages and save.
- The report state is one serializable JSON object per store, saved in `analytics_reports` (§6). "Reset to default" restores the shipped report.
- A period picker (last 7, 30 or 90 days, 12 months) sets a page-level date filter.

### 2.2 Data

A tRPC query, `analytics.dataset({ storeSlug })`, returns the store's data for the last 12 months as Studio data sources. The store comes from the session and the slug, never from client input alone. Studio's data engine joins, filters and aggregates in the browser.

| Source | Fields (main) | Relationship |
|---|---|---|
| `orders` | id, placed_at, channel, country, status, subtotal, discount, shipping, tax, total, currency, is_demo | — |
| `order_lines` | order_id, product_id, quantity, unit_price, line_total | → `orders`, → `products` |
| `payments` | order_id, captured_at, gross, paypal_fee, payleor_fee, net | → `orders` |
| `refunds` | order_id, refunded_at, amount, reason | → `orders` |
| `disputes` | order_id, opened_at, reason, stage, amount, seller_response_due_date, recommended_action, evidence_ready, status | → `orders` |
| `products` | id, title, status, price | — |
| `customers` | hashed id, country, first_order_at | → `orders` |

- **Channel** is one of `storefront`, `chatgpt`, `claude`, `acp`, `ucp`, `store_sync`, `ap2`. Agent channels are everything except `storefront`.
- No names, emails or addresses reach the browser for analytics. Customers are a hashed ID and a country.
- All money is in the store currency (multi-currency is a non-goal, parent §1).
- Size cap for v1: 12 months or 50,000 order lines, whichever is smaller. Beyond that, a server-side aggregate endpoint is a later change.

### 2.3 Overview report

KPI tiles: net sales, orders, average order value, refund rate, open disputes. Then the three custom widgets (§2.4), revenue by product, sales by country, and an orders grid.

**Metric definitions** (used by tiles, widgets and the agent):

| Metric | Definition |
|---|---|
| Gross sales | Sum of `orders.total − orders.tax` for orders with a capture in the period |
| Refunds | Sum of `refunds.amount` in the period, minus the tax share of each refund |
| PayPal fees | Sum of `payments.paypal_fee` (from the capture's `seller_receivable_breakdown`) |
| Payleor fee | Sum of `payments.payleor_fee` (the partner fee at the store's plan rate, parent §6.2) |
| Tax collected | Sum of `orders.tax`, net of refunded tax. Money owed to tax authorities, never shown as revenue |
| Net sales | Gross sales − refunds − PayPal fees − Payleor fee |
| Refund rate | Refunded orders ÷ orders, by count, in the period |
| Dispute rate | Orders with a dispute opened in the period ÷ orders in the period |

### 2.4 Custom widgets

Each widget is built from the merchant question it answers. All three are `AgWidgetDefinition`s registered through `createWidgets({ additionalTypes })`, use `studioGridTheme` and `getChartTheme(api)` for inner grids and charts, provide a `form` for the edit panel, and define `formatShape` and `ai` metadata so the agents can add and configure them.

| Widget | Merchant question | What it shows | Next step from the widget |
|---|---|---|---|
| **Money flow** | "How much of my sales do I actually keep?" | A flow from gross sales through refunds, PayPal fees and the Payleor fee to net sales, with tax collected shown beside it as owed, not earned. Follows the page period | Clicking a segment cross-filters the orders grid to the orders behind it |
| **Dispute clock** | "Which disputes need me now, and what is at stake?" | Open disputes sorted by `seller_response_due_date`: countdown, amount, reason, recommended action, evidence readiness. Under 72 hours is amber, under 24 hours red, PayPal `ALERT` cases use the 20-hour clock | Clicking a row opens the dispute in the disputes console |
| **Agent vs human sales** | "Are AI agents bringing me customers, and are they good customers?" | For each channel: share of net sales, orders, average order value, refund rate and dispute rate, plus the agent share trend over the period | Filters the page by channel; an "Ask why" button sends the selection to the agent |

### 2.5 Theme

`studioTheme.withParams(...)` maps our Tailwind design tokens (background, foreground, muted, border, accent, radius, font) for both light and dark mode, following the app's color scheme. Chart series colors come from the same palette as the rest of the admin.

### 2.6 Agent

The Admin agent (parent §9.1, instance `admin:{storeId}:{userId}`) is the analytics page's **primary agent** in Studio's agent framework.

- **Lead (ours):** a `clientToolRunner` whose `run` streams one turn from the api Worker. On the server, the turn runs the Admin agent's model (AI Gateway) with its server tools: order lookup, dispute details, `compare_periods` (explains a change between two periods by product, channel and country), and `market_price` (§3.2). Studio tools that the server leaves unresolved run in the browser.
- **Built-in specialists:** the lead's tools include `tools.delegateTo(['planning', 'data', 'page', 'widget'])`. Studio's own Planning, Data, Page and Widget agents run as `directLlmRunner`s whose adapter calls `POST /ai/studio` on the api Worker, which forwards to AI Gateway. Model keys never reach the browser.
- **Example:** "Why did refunds jump last week?" The lead calls `compare_periods` on the server, finds that one product drives the spike, then delegates to the Page and Widget agents to add a refunds-by-product chart filtered to that product.
- **Read-only:** on this page the agent changes the dashboard, never store data. Refunds and other writes stay in the Admin agent panel behind the consent gate (parent §6.4).
- **Limits:** `/ai/studio` and agent turns require a session for the store, are rate limited per user, and count against the plan's AI credits (`PlanLimit`, parent §12).
- **Threads:** conversations persist through the harness `history` store, backed by the Admin agent's Durable Object storage.
- The exact `clientToolRunner` input and AG-UI event shapes are checked against `ag-studio` 2.1.x while planning.

### 2.7 Demo data

`tools/seed-demo-analytics` creates about six months of realistic orders for the demo store: weekly seasonality, a product mix, a channel mix that grows agent share over time, a refund spike in one week, and a few open disputes with near due dates. Seeded rows have `is_demo = true`. Real sandbox orders made during the demo are added on top.

### 2.8 Licence

- AG Studio is an enterprise product. It runs locally without a key; in production, a missing key shows a watermark, and the AI module does not start.
- The free trial key lasts 45 days with no restrictions. **Request it around Nov 1**, so it stays valid through judging (Dec 1–15). Also ask AG Grid on the hackathon Discord whether hackathon keys can be extended.
- The key is set with `AgStudioLicenseManager.setLicenseKey` from a public env value (`AG_STUDIO_LICENSE_KEY`), declared in `apps/web/.env.schema`.
- After the hackathon, a commercial licence for a multi-tenant product is custom priced. Keeping or replacing AG Studio is decided then (parent §16).

## 3. Channel3 on the merchant side

Channel3 is called only from the api Worker, with the `CHANNEL3_API_KEY` secret (header `x-api-key`), through `@channel3/sdk` if it runs on Workers, otherwise plain `fetch`. Buyers never see Channel3: storefront and agent surfaces show only the merchant's catalog.

### 3.1 Start a product from a link or photo

- The new-product form offers "Start from a link or photo".
  - **Link:** `POST /v1/lookup` with the URL.
  - **Photo:** the image uploads to R2 first, then image search by URL (`/v1/image-search`). The merchant picks one of up to 10 matches.
- The match pre-fills title, description, brand, category, attributes, variants and images. Images are copied into R2 under the store's image prefix, never hotlinked.
- A required checkbox: "I have the right to use these images and this text." Retailer content can be copyrighted; the merchant is responsible for what they import.
- Price is never pre-filled from the match. The merchant sets their own price, with the market price panel (§3.2) next to it.
- No match, an unsupported market or a Channel3 error leaves the form empty, with "No match found. Fill in the details yourself."

### 3.2 Market price check

- The product page shows a **Market price** panel: low, median and high price of the same or similar products across retailers, the number of offers, and three example offers with retailer names.
- Source: `/v1/similar` from the canonical product ID when the product was started from Channel3, otherwise `/v1/search` with the title and brand. Prices use the store's locale and currency.
- Results are cached in KV for 24 hours per product. "Refresh" bypasses the cache at most once an hour.
- The Admin agent gets the same data as the `market_price` tool, so it can answer "Am I priced right?"
- Channel3 covers the US, Canada, the UK, Ireland, Australia and much of the EU, in USD, CAD, AUD, GBP, EUR, SEK, CZK and RON. Other markets or currencies show "No market data for your region."

### 3.3 Competitor price alerts (optional, if time allows)

- From the market price panel, the merchant can watch a competitor's product. We call `/v0/price-tracking/start` and store the watch in `price_watches`.
- Channel3's price-change webhook posts to `POST /webhooks/channel3` on the api Worker. The handler finds the watches for that product, creates an admin notification, and asks the Admin agent to propose a new price. Nothing changes until the merchant confirms.
- Webhook authenticity is checked while planning (signature if Channel3 provides one, otherwise a secret path token).
- Cost: one credit per watched product per day. Watches are limited per plan.

### 3.4 Credits

Each search, lookup and similar call costs one credit. The hackathon key has 20,000 free credits with code `PAYPAL-HACKATHON-2026`; Channel3 tops up through the `#channel3` Discord channel. The cache in §3.2 keeps normal use far below that.

## 4. Bulk catalog import on Render Workflows

### 4.1 What the merchant sees

- On the catalog page, "Import products": paste up to 100 product links, or upload a CSV with one link per row.
- An option, off by default: "Rewrite descriptions in my store's voice."
- A progress list shows each link as queued, importing, done or failed. Done rows link to the new draft product. Failed rows show the reason, with "Retry" and "Add manually".
- Imported products are **drafts**. Nothing is published without review.

### 4.2 Flow

1. The api Worker creates a `catalog_imports` row and one `catalog_import_items` row per link, then starts the Render task `importCatalog(importId, items, options)` through Render's API.
2. `importCatalog` starts one `importProduct` run per item in parallel (`ctx.run`). Each run:
   1. calls Channel3 `POST /v1/lookup` for the URL
   2. downloads the product images and processes them with `sharp`: standard sizes, WebP, metadata removed
   3. uploads them to R2 through R2's S3-compatible API
   4. rewrites the description through AI Gateway when the option is on
   5. posts the result to the api Worker's `POST /internal/imports/{importId}/items/{itemId}`, which creates the draft product and marks the item done
3. A failed run is retried up to 3 times with backoff (`maxRetries: 3`, `waitDurationMs: 2000`, `backoffScaling: 2`), then posts the failure reason to the same endpoint.
4. When all runs finish, `importCatalog` posts the import's final status.
5. The reconciliation cron (parent §12) marks items still `importing` after 30 minutes as failed, so an import never hangs.

### 4.3 Boundaries

- **Render never touches Postgres.** The api Worker stays the only writer and runs every tenant check.
- The internal endpoint accepts only requests signed with HMAC-SHA256 over the timestamp and body (`IMPORT_CALLBACK_SECRET`), within 5 minutes, and only for the import and item IDs it issued. Callbacks are safe to receive twice.
- Render holds three secrets: an R2 API token limited to the images bucket, `IMPORT_CALLBACK_SECRET`, and `CHANNEL3_API_KEY`. The AI Gateway token is added only if the rewrite option ships.
- Code lives in a new workspace package, `apps/workflows` (TypeScript, `@renderinc/sdk`). It shares types with `core` and imports nothing from `db`.

### 4.4 Why Render

`sharp` needs native Node, which Workers cannot run, and fanning out many retried tasks is what Render Workflows is built for. The README says this plainly.

### 4.5 To check while planning

- Render deploys from a Git repository, so `jendal-workspace` needs a GitHub remote (private is fine).
- Whether the api Worker can start a task with plain `fetch` to Render's REST API, or needs the SDK client.
- Cost: runs use the Flex plan, billed per second; the $50 in credits already on the account covers the hackathon.

## 5. Postman (optional, last days)

If time allows in Nov 9–12: a public Postman workspace with a collection for the ACP, UCP and MCP endpoints of the demo store, with environment variables for the sandbox, linked from the README and the Devpost testing instructions.

## 6. Data model additions

All tables include `store_id` (parent §11).

- `analytics_reports`: store, name, `state` (JSON), `is_default`, updated by, timestamps
- `catalog_imports`: store, created by, status (`running`, `done`, `failed`), item count, done count, failed count, `rewrite_copy`, Render task run ID, timestamps
- `catalog_import_items`: import, URL, status (`queued`, `importing`, `done`, `failed`), Channel3 product ID, product ID once created, error, attempts, timestamps
- `price_watches` (only with §3.3): store, product, Channel3 canonical product ID, competitor title and retailer, last price, timestamps
- `orders.channel` and `orders.is_demo`, `payments.paypal_fee` and `payments.payleor_fee` are required by §2.2 and must exist when the orders and payments tables are created

## 7. Schedule

The full parent scope stays. Sponsor work fits into the existing weeks (parent §14):

| Week | Sponsor work |
|---|---|
| Oct 5–11 and 12–18 | Channel3 link and photo start and market price panel, with the catalog work (W1-C) |
| Oct 12–18 | Render bulk import, right after the catalog |
| Oct 26–Nov 1 | AG Studio page, theme, custom widgets and demo seed data, built locally without a key. Price alerts if time allows |
| Nov 1 | Request the AG Studio trial key; ask AG Grid about an extension |
| Nov 2–8 | AG Studio agent: lead runner, delegation, `/ai/studio`, threads; polish |
| Nov 9–12 | Demo video shows the analytics agent; README sponsor section; Postman collection if time allows |

**Accounts the user sets up:** a Channel3 key with the promo code (week 1), a Render API key and a GitHub remote for the workspace (by Oct 12), the AG Studio trial (Nov 1).

## 8. Testing

| Area | Tests |
|---|---|
| Analytics dataset | Integration: a user sees only their store's rows; no PII fields in the payload; metric definitions match fixtures (net sales, refund rate, tax not counted as revenue) |
| Custom widgets | Unit: each widget's data mapping and `formatShape` parse; Playwright: the Overview report renders, cross-filtering from Money flow filters the grid |
| Analytics agent | Agent evals: "why did refunds jump" finds the seeded spike and adds a widget; the agent never calls a write tool on this page |
| Channel3 | Contract: zod schemas for lookup, search and similar responses; integration with mocked `fetch`: no-match and error paths, KV cache hit |
| Bulk import | Unit (`apps/workflows`): `importProduct` with mocked Channel3 and R2; integration: callback signature check, replayed callback is a no-op, stale items fail through the cron |

## 9. Risks

| Risk | Mitigation |
|---|---|
| The AG Studio trial expires during judging | Request it around Nov 1 (§2.8); ask AG Grid for an extension |
| `clientToolRunner` and AG-UI shapes differ from the docs | Check against the installed `ag-studio` while planning; fallback is Studio's built-in harness with our adapter and custom server tools (`kind: 'server'`) |
| Channel3 has no match or no coverage for a market | Clear empty states (§3.1, §3.2); the import marks such items failed with the reason |
| Render needs a Git remote | Set it up by Oct 12 (§7) |
| Retailer images and text are copyrighted | Required rights checkbox; imported products are drafts |
