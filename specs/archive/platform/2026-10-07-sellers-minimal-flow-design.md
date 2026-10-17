# Sellers: the minimal flow for freelancers and teams

> **Archived:** Built (runs 0–5b-1); archived 2026-10-16. §11 keeps the detailed history of runs 0–5; the program replaced its run order.

- **Status:** design written on 2026-10-07 from choices made in conversation (§2). Reviewed and approved on 2026-10-07. Pricing was reworked as plans with a subscription and a fee for freelancers and for teams, approved the same day in [`2026-10-07-seller-pricing-proposal.md`](../../platform/2026-10-07-seller-pricing-proposal.md) (§14)
- **Replaces:** the paused [`plans/2026-10-07-hackathon-one-flow.md`](plans/2026-10-07-hackathon-one-flow.md) as the build plan
- **Takes from** [`2026-10-07-services-amendments-proposal.md`](2026-10-07-services-amendments-proposal.md): the service catalog (§4 there, reduced), the intake agent (§7 there, web only) and Payleor's role (§10 there). Hiring from ChatGPT and Claude (§6 there) moves to the next phase (§12 here)
- **Builds on:** the services spec (projects, quotes, amendments, ledger, pay page, payouts), the platform spec (catalog, store host, PayPal client) and W1-D (auth, legal pages, store policies)
- **Milestone:** none forced. The PayPal AI Hackathon (Nov 12, 2026) is a target if the flow is ready (§13)

## 1. Goal

A freelancer or a team signs up once and sells in two ways from one page:

- **Services:** clients request a quote, pay a deposit, receive the work and pay the balance. Team members are paid automatically.
- **Digital products:** buyers pay with PayPal and download the file at once.

Payments go to the seller's own PayPal account. Payleor is software for the seller, never a party to the deal (proposal §10).

## 2. Decisions (2026-10-07)

| Topic | Decision |
|---|---|
| Seller | A team. A freelancer is a team of one |
| What a seller sells | Services, digital products, or both, from one seller page |
| Store | Digital downloads only. Physical goods stay with the existing Commerce store teams |
| AI | The intake agent drafts quotes from web requests. Hiring from ChatGPT and Claude comes next (§12) |
| Payments | One payment module for project payments and store orders |
| Hackathon | A target without pressure; submit if ready |
| Names (review) | The site presents offers by audience: "For freelancers and teams" (services and digital products) and "For shops" (physical goods). The names Commerce and Services stay internal (`team.product` keeps `store` and `services`) |
| File checks (review) | Limits on file type and size only. Malware scanning comes later (§12) |
| Refunds (review) | Sellers refund in their PayPal account; the refund webhook updates Payleor. A refund button comes later (§12) |
| Pricing (review) | Plans with a subscription and a per-payment fee, scaled separately for freelancers and for teams (pricing proposal, approved) |

## 3. Sellers

### 3.1 Solo sellers and teams

- New sellers are created as services teams (`team.product = 'services'`). The create form asks "Just me" or "A team" (setting `solo`).
- **Solo:** the owner is the only member and does the work. The defaults are a team cut of 100% (`team_cut_bps = 10000`) and a management fee of 0, so completion books the whole price as the seller's revenue and no payout is needed. The admin hides Members and Payouts. A solo seller can switch to a team later; the team cut then defaults to 15%.
- **Team:** as in the services spec, with members and roles (admin, manager, freelancer), titles (§4.1), the team cut, the management fee, the quoting mode and payouts.
- Existing store teams (`product = 'store'`) keep the Commerce flow unchanged.

### 3.2 Modules and setup

- `services_team_settings.store_enabled` (default false) turns the store on. Services appear on the seller page once the team has at least one active catalog service.
- `services_team_settings.bio`: up to 280 characters, shown on the seller page.
- Setup checklist: connect PayPal; add a service or a product; publish the seller page. Teams also add their payout credentials (sandbox) and members.

### 3.3 Seller page

- `{slug}.payleor.app` serves the seller page of a services team. The store host already resolves stores by slug; it now also resolves services teams.
- Sections:
  - the team's name and bio;
  - **Services:** cards with the name, description, price range and usual days, plus Request a quote;
  - **Store:** cards with the image, title and price, plus Buy;
  - the footer: the seller's policies and Payleor's legal pages.
- The page stays a draft until the team publishes it. A draft is visible only to members, as store drafts are today.

## 4. Services

### 4.1 Catalog

The proposal's catalog (§4 there), reduced:

- departments with one level only (sub-departments later), optional, so solo sellers usually skip them;
- services with `name`, `description`, `price_min_minor`, `price_max_minor`, `days_min`, `days_max`, `intake_questions` (up to 5), `active` and `position`;
- `services_team_member.title`, a free-text label.

### 4.2 Requesting a quote

- On the seller page, the client picks a service (or "Something else"), describes what they need, answers the service's intake questions, and gives their name and email.
- Submitting creates a project in `quoting` (`source = web`, `offering_id` set) and emails the client their client page link (`/c/{token}`, services spec §5.2). The email proves the address, so no account is needed.
- Limits: 3 open requests per email per team, plus rate limits per IP and per email (the existing `rate_limit` table).
- The team is notified by email, and the intake agent drafts a quote (§6).

### 4.3 From quote to completion

The services spec (§5, §6.5) applies, with these choices for the minimal version:

- A manager, or the solo seller, sends the quote. The client accepts it on the client page.
- The deposit, any top-ups and the balance are paid on the pay page through the payment module (§7).
- Delivery uses the Deliver form: a note, a link and an optional file up to 100 MB in R2. The client accepts the delivery or requests changes on the client page.
- Completion postings run when the balance is captured. Teams then owe their members' earnings, paid automatically or after approval through the Payouts API (team credentials, sandbox only, proposal §10). Solo sellers owe no earnings, so there is no payout.
- Deadline penalties and cases stay out of the minimal version.

## 5. Store: digital downloads

### 5.1 Products

- Digital products reuse the catalog's `products` table, which is already keyed to the team (`store_id → team.id`), with a new column `kind` (`physical` by default, or `digital`). A digital product has one variant (its price), optional images and one file.
- Table `product_files`: `product_id`, `r2_key`, `file_name`, `content_type`, `size_bytes`, `created_at`. One file per product in the minimal version.
- Upload goes to a private R2 bucket through a presigned URL. Files can be up to 100 MB; the allowed types (archives, documents, images, audio, video, fonts, and 3D and game-asset formats) are listed in the run's plan.
- Channel3 lookup and the physical fields (shipping, tracking) are hidden for digital products.

### 5.2 Checkout and delivery

- Buy on the seller page opens a checkout page with the product and an email field, then the PayPal buttons (JS SDK v6). The server creates the Orders v2 order with the team's merchant ID as payee, Payleor's fee as `platform_fees` and the order ID as `custom_id`.
- On capture, the order becomes `paid`. The buyer sees a download button and gets an email from `stores@payleor.com` ("{Team} via Payleor") with the link.
- Download links are signed, expire after 7 days and allow 5 downloads. The buyer can request a fresh link by email from the order page.
- Checkout is guest only, as the auth spec keeps it.

### 5.3 Orders and refunds

- Table `orders`: `id`, `team_id`, `product_id`, `buyer_email`, `amount_minor`, `currency`, `status` (`pending`, `paid`, `refunded`), `paypal_order_id`, `paypal_capture_id`, `created_at`, `paid_at`. Each order has one product for now; physical orders will extend this table later.
- Table `download_grants`: `order_id`, `token_hash`, `expires_at`, `downloads_left`.
- The admin lists orders: buyer, product, amount and status.
- Refunds happen in the seller's PayPal account. The refund webhook (`PAYMENT.CAPTURE.REFUNDED`) marks the order refunded and revokes its download links. A refund button in Payleor comes later.

## 6. The intake agent (web)

- This is the proposal's intake agent (§7 there) on the web only: the request form on the seller page, and Draft with AI in the admin.
- Its steps, drafts and limits are as described there. It matches the service, reads the team's recent completed projects, lists what is missing, drafts the brief and the items within the service's range, and flags risks.
- A draft is not a quote; a person sends it. There are no automatic quotes in the minimal version.
- It runs as an Agents SDK class through AI Gateway, on a free or cheap model chosen per environment.

## 7. Payment module

- One module, in `packages/paypal` and `core`, serves both project payments and store orders. It covers:
  - creating orders on the server, and capturing them with `PayPal-Request-Id`;
  - `platform_fees`;
  - `INSTRUMENT_DECLINED` handling, 429 backoff and `debug_id` logging.
- `applyPayPalFact` (services spec §6.4) applies captures and refunds from API responses and webhooks, idempotent by PayPal resource ID. Webhooks are verified, stored by event ID and processed from a Queue.
- Payleor's fee applies to every seller payment, both project payments and store orders. Its rate comes from the seller's plan (§14), read through `planFor` as the platform spec does for stores (§6.7 there).

## 8. Payleor's role and rules

- Payleor is software for the seller, never a party to the deal (proposal §10). Sellers are responsible for their services, their products, their taxes and their members' pay.
- **Acceptable use for digital products:** no game cheats or hacks, no game accounts, no leaked or unlicensed assets, no malware, and nothing PayPal's Acceptable Use Policy forbids. Anyone can report a product to `abuse@payleor.com`, and Payleor can unpublish it.
- Files are served only through signed links, and file types and sizes are limited (§5.1). Uploads are not scanned for malware in the minimal version.
- Anyone who receives payouts must be 18 or older (proposal §10).

## 9. Data model changes

- `services_team_settings`: `solo`, `store_enabled`, `bio`
- Service catalog: `services_department`, `services_offering`; `services_team_member.title`; `project.offering_id`, `project.source`
- Store: `products.kind`, `product_files`, `orders`, `download_grants`
- The deliveries table (services spec §5.2), with an optional file

## 10. Testing

- **Unit:** solo defaults and postings (no earnings owed), the fee on orders, download link signing, expiry and count, request limits.
- **Integration:**
  - a request creates a project and a draft;
  - a captured order becomes paid and gets a download grant;
  - the refund webhook marks the order refunded and revokes the grant;
  - duplicate and out-of-order PayPal facts are handled.
- **Sandbox end to end:**
  - buy a digital product;
  - request a quote, pay the deposit, deliver, accept, pay the balance;
  - for a team, the payout.
- **Walkthrough:** over the tunnel first, then on the deployed hosts.

## 11. Runs

Each run is one plan executed in a fresh session; Mouhamed rests between runs.

**Since 2026-10-13:** after 5b-1, the agentic surfaces program (`2026-10-13-agentic-surfaces-program.md`) replaces the order below: runs A (action and query catalog) to G (deploy and demo). Remaining 5b-2 Discord becomes run E, 5b-3 books shrinks to the ledger summaries run F needs (full books after the hackathon), run 6 becomes part of run D, run 7 becomes run G, and run 8 moves after the hackathon.

| Run | Scope |
|---|---|
| 0 | Services teams stop requesting `TRACKING_SHIPMENT_READWRITE` (stores keep it). Done 2026-10-07, merged as R0 (`50b821a`) |
| 1 | Payment module, PayPal webhooks, pay page for project payments. Split into R1a (server payments: done 2026-10-07, merged as `17a6499`), R1b (pay page with JS SDK v6: done 2026-10-08, merged as `a46bcf2`, paid end to end in the sandbox) and R1c (webhooks, the Queue and fees in the ledger: done 2026-10-08, merged as `e2fcebf`, webhook capture checked in the sandbox) |
| 2 | Deliveries, acceptance, balance, completion; client page actions. Done 2026-10-08, merged as `722e1e3`: delivery (note and https link), request changes, accept, balance on the pay page, completion postings; walked through in the sandbox (changes requested once, balance captured by the webhook, project completed). Delivery files split out as run 2b |
| 2b | Delivery files: one file per delivery up to 100 MB in a private R2 bucket (`Files`, shared with run 4), presigned PUT and GET; in dev the presigned URLs hit localhost, so the browser needs local network access allowed for our hosts. Done 2026-10-08, merged as `2aac26f`; walked through (type and size refusals, PDF and 60 MB uploads, client downloads byte-identical, tampered and expired links refused) |
| 3 | Sellers: solo or team, store toggle, bio, seller page, service catalog, request form. Split into 3a and 3b. 3a (setup and catalog in the admin): done 2026-10-08, merged as `444c1f4`. It covers "Just me" or "A team" with the solo defaults (whole price, Solo plan 2% fee, quoting without an assignment, no members or payouts, one-way switch to a team), the bio, the support email for services teams, member titles, the service catalog (departments, offerings with a price range, usual days and up to five intake questions), the checklist step, and projects that record their service and source. Walked through in the sandbox (solo 2% and team 1% fees read from created orders). The `store_enabled` column exists but has no UI until run 4. 3b (seller page and publishing): done 2026-10-08, merged as `29b6188`. The seller page at `{slug}.payleor.app` shows the name, the bio, the active services grouped by department, "Request a quote" mailto links (the form comes in 3c), and a footer with the services terms and privacy plus Payleor's legal pages. Stores and services teams stay drafts until an admin publishes them (rules: PayPal connected and an active service, or for a store a published product; suspended sellers cannot publish); drafts and suspended sellers 404 on the public host, members preview inside the admin at `/{slug}/preview`, and publishing or unpublishing drops the cached storefront lookups. Also closed: the solo wording ("Set up your seller page", "Settings"), `project.assign` refuses solo teams, and the new-service form waits for input with clearer price wording. Walked through over the tunnel (publish, policies, preview, unpublish with immediate 404, store card rules). 3c (request form with emails and limits): done 2026-10-09, merged as `8d51ff2`. The published seller page's "Request a quote" links open `/request` (per service or "Something else"); submitting the public `project.requestQuote` creates the project in quoting (source web, offering, client name and answers on the project) and emails the client their private `/c/{token}` page (awaited; a failure refuses with a generic message and keeps the project), with a best-effort notice to the team's support email that links the admin project page (which shows the Request section). Spam is bounded by a honeypot (fake success), twenty requests per hour per IP and five per hour per email, and three open requests per email per team. The api context gained an email port (mailer, site and admin origins, `waitUntil`) next to the auth one. Walked through over the tunnel with real email (client link, notice, limits refusal, honeypot no-op, draft 404); the notice check temporarily pointed the support email at a readable inbox because `walk-crew@example.com` is not visible to the AgentMail key at hand |
| 4 | Store: digital products, upload, checkout, orders, download links, refund webhook. Split into 4a and 4b. 4a (digital products and the Store section): done 2026-10-10, merged as `2df314e`. A services team turns on its store (`store_enabled`, admin only) and adds digital products: a title, a description, one price, and one file up to 100 MB. The file is uploaded straight to the `Files` bucket and stored as a `file_upload` row with purpose `product`; replacing it deletes the old row and object, and attaches are serialized by a product row lock. A product needs its file to be published, and an edit cannot break a published product's rules. Seller publish accepts an active service or a published digital product. The seller page shows a Store section with Buy links to `/buy/{id}`, and store teams get the seller page once they have published digital products. Services-team roles (`manage_settings`) gate product management; the physical catalog procedures stay store-only. The Commerce checklist now counts published products only. Product images were skipped. Walked through over the tunnel (store toggle, file-required publish refusal, upload and publish, Store section live and in preview, product-only publish on walk-crew-solo, `.exe` refused, Commerce UI unchanged). 4b (checkout, orders, download grants, buyer email, refund webhook): done 2026-10-11, merged as `60bed6c`. Buy opens `/buy/{id}`, where the buyer enters an email and pays with the PayPal buttons. The team is the payee, Payleor's plan fee goes as `platform_fees`, the `custom_id` is `order:{id}`, and the browser proves it started the order with a hashed checkout secret. A capture (from the browser or the webhook, applied once under the order lock) marks the order paid, posts `order_paid` and `order_fees`, and issues download grants: SHA-256-hashed tokens, 7 days, 5 downloads. The buyer lands on `/orders/{token}` on the store host and gets the link from `stores@` ("{Team} via Payleor", reply-to the support email). An expired or used-up link offers "Email me a new link", which goes only to the order's email. The admin lists paid and refunded orders. Refund and reversal webhooks find the order by the refunded capture id (now parsed from the refund's `up` link; project payment refunds are parked instead of ignored), mark it refunded, revoke every grant and post `order_refunded` once per refund. The store switch gates the seller page's products, checkout and the publish count, and the admin can turn the store off. Walked through in the sandbox over the tunnel (purchase, byte-identical download, buyer email, used-up link and fresh link, admin list, a $5 partial refund revoking access, the store switch) |
| 5 | Payouts for teams: Payouts API, automatic mode, payout agent. 5a (team-pasted REST credentials, `f70b191`) and 5a-2 (owner pays in PayPal and marks paid, `0458169`) were superseded. 5c (automatic payouts): done 2026-10-13, merged as `b437e78`, `0f0f58a`, `abc93b0`. A team admin turns on automatic payouts with one PayPal consent in the mini-browser (first-party onboarding shares the team's REST credentials, sealed with `PAYOUT_CREDENTIALS_KEY`; the payer id must be the team's merchant and the token must carry the payouts scope). Members 18 or older connect a personal PayPal account with Log in with PayPal (the `address` scope gives the country) and request payouts; admins approve and Payleor sends through the Payouts API. PayPal's fee is estimated at send, comes off the member's payout and is corrected at settle. Without automatic payouts, requests wait. Walked through in the sandbox ($10 rejected, $25 sent $24.50 with a $0.49 fee, turned off and waiting). 5b-1 (payout rules): done 2026-10-13, merged as `a4cf6a8` and `2f2cb35`. Each team sets rules (auto-approve with scopes, trusted members, a second admin above an amount, one automatic payout per completed project after a hold, a payday, a balance floor read from PayPal, a minimum) with Manual, Rules and Automatic as presets; the cron creates project payouts and sends due ones with backoff; without automatic payouts approved payouts are exported for PayPal Payouts Web and PayPal's CSV log is imported; the quote calculator sits on the New quote form. Walked through in the sandbox (project payout sent and settled by the cron, two-admin approval, floor hold and retry, Payouts Web export and import). Next was 5b-2 Discord and 5b-3 books; superseded on 2026-10-13 by the agentic surfaces program (see `../PROGRESS.md`) |
| 6 | The intake agent on the web |
| 7 | Deploy on Cloudflare, move the dev tunnel off the production hosts, seed demo sellers. The account is on Workers Paid (bought 2026-10-08: CPU time up to 5 min per request instead of 10 ms, no daily request cap, unlimited Hyperdrive queries, Queues with 4-day retention, 250 cron triggers); the `payleor.com` zone stays on the Free plan (100 MB request bodies, which presigned uploads avoid; one path-based rate limiting rule, enough for `/webhooks/paypal`) |
| 8 | Billing: PayPal Subscriptions on a separate billing account, the trial, the Billing page, plan changes (pricing proposal §5–6). Optional before the hackathon |

### 11.1 Backlog from testing

Moved to [`../BACKLOG.md`](../../BACKLOG.md) on 2026-10-13 (open items with their owner, done items with their commit). Progress across runs is tracked in [`../PROGRESS.md`](../../PROGRESS.md).

## 12. Next phase

- Hiring and buying from ChatGPT and Claude: the auth host (auth spec A1), MCP authorization, and the client tools (proposal §6), extended with `list_products` and a buy flow.
- Discord updates for each step, and `/project draft`.
- Client grades and freelancer records (proposal §5).
- Creator shares on team store sales; physical goods for sellers.
- Malware scanning for uploaded files, and a refund button in the admin.

## 13. Hackathon, if ready

- The entry is the minimal flow plus the intake agent, and ChatGPT and Claude hiring if the next phase's first run lands in time.
- The video shows:
  1. a freelancer's page with services and a product;
  2. a buyer downloading the product;
  3. a client requesting a quote and the intake agent drafting it;
  4. the client paying the deposit and the balance;
  5. for a team, a member being paid automatically.

## 14. Review answers (2026-10-07)

1. **Pricing:** a services team is the team version of a freelancer, so each audience gets its own plans, and every plan has a subscription price and a per-payment fee, scaled for that audience. Approved in [`2026-10-07-seller-pricing-proposal.md`](../../platform/2026-10-07-seller-pricing-proposal.md), which replaces the flat 0.5% + $0.10 and adds run 8 (billing) to §11.
2. **Names:** by audience (§2).
3. **File checks:** limits only (§2, §8).
4. **Refunds:** in PayPal, synced by the webhook (§2, §5.3).
