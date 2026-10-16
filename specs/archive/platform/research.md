# Platform research digest

> **Archived:** Research digest from the first week; archived 2026-10-16. Vendor facts used since then live in the facts notes in `../../platform/`.

This digest collects the facts that shape the design of a multi-tenant, headless, agentic commerce platform on PayPal. The platform has three surfaces: a web app (storefront and admin), a ChatGPT plugin, and a Claude plugin.

- **Compiled:** 2026-10-03, from three kinds of source:
  - the hackathon pages (see [`../hackathon/`](../../hackathon/README.md))
  - every resource those pages link to
  - the local clones in `refs/`, via [`references/README.md`](../../references/README.md)
- **When sources disagree,** follow the source order in `refs/AGENTS.md`: live docs first, then the specs, then library source, then ruleshub, then AI-Toolkit. Known conflicts are listed in [§10](#10-conflicts-between-sources).
- **Reference shortcuts:**
  - `E/` means `refs/ruleshub/paypal-checkout/enterprise-checkout/`
  - `SPEC/` means `refs/paypal-rest-api-specifications/openapi/`
  - `AIT/` means `refs/AI-Toolkit/skills/paypal-best-practices/references/`

## 1. Hackathon constraints that affect the platform

- **Deadline:** Nov 12, 2026, 12:00 pm PST. The hackathon is a milestone; the real target is a product.
- **Environment:** the PayPal sandbox is required. Braintree counts as PayPal ("all the services provided by PayPal such as Venmo, Braintree...", Official Rules §4).
- **Deliverables:**
  - a working build, either with run instructions or a hosted URL
  - a public GitHub repo with a license that GitHub detects
  - a YouTube video under 3 minutes
- **Judging:**
  - Judges may not run the build, and AI-driven review is allowed. The README and the video carry real weight.
  - Prize targets: Best Use of Agentic Commerce and Best Use of PayPal + AI (each $5,000), plus the grand prizes.
- **Sponsor tools that fit:** Channel3 (product data), Render (hosting and workflows), APIMatic (Context Plugin for coding agents), Elastic (search).

## 2. Surfaces: one MCP server serves ChatGPT and Claude

**MCP Apps** is the official MCP extension for interactive UI, spec `2026-01-26`. Both **ChatGPT and Claude** support it, as do VS Code, Goose, M365 Copilot and Postman.

- **How it works:**
  - Tools declare `_meta.ui.resourceUri` pointing to a `ui://` HTML resource with MIME type `text/html;profile=mcp-app`.
  - The UI runs in a sandboxed iframe and talks to the host over JSON-RPC `ui/*` messages via `postMessage`.
  - The client and server negotiate support through the `io.modelcontextprotocol/ui` extension capability. Without it, tools fall back to text only.
  - SDK: `@modelcontextprotocol/ext-apps` (`/server`, `/react`, `/app-bridge`).
  - Sources: blog.modelcontextprotocol.io, 2026-01-26 post; github.com/modelcontextprotocol/ext-apps
- **ChatGPT-only extensions:**
  - `window.openai` offers `requestCheckout` (Instant Checkout), `requestModal`, and file APIs.
  - Feature-detect these, and degrade gracefully in Claude.
  - OpenAI now calls ChatGPT apps "Plugins". Developers connect them in Settings, under Developer mode.
  - Source: developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
- **Consequence for the design:** build **one MCP server with MCP Apps widgets** to be both plugins. Native in-chat payment exists **only in ChatGPT** (ACP Instant Checkout). In Claude, checkout must hand off to a PayPal approval URL or to the storefront.
- **PayPal's own MCP server:**
  - Local: `npx @paypal/mcp --tools=all`, with `PAYPAL_ACCESS_TOKEN` and `PAYPAL_ENVIRONMENT`.
  - Remote: `https://mcp.sandbox.paypal.com/{sse|http}` and `https://mcp.paypal.com/{sse|http}`, with PayPal login (OAuth) or `Authorization: Bearer`.
  - The remote server's **commerce tools** (`search_product`, `create_cart`, `checkout_cart`) need the header `x-feature-flags: commerce:true`. They are **gift cards only** for now.
  - Sources: docs.paypal.ai MCP quickstart and agent tools reference
  - These tools act on the merchant's own account. They do not replace our tenant-aware MCP server.

## 3. Agentic commerce protocols

### 3.1 PayPal Store Sync (Cart API): merchant-hosted, uses Orders v2

- **Who calls whom.** The merchant implements the endpoints and **PayPal calls them** when an AI agent shops.
  - Endpoints:
    - `POST /merchant-cart`
    - `GET /merchant-cart/{id}`
    - `PUT /merchant-cart/{id}`, which is a **full replacement, not a merge**
    - `POST /merchant-cart/{id}/checkout`
  - Every call carries a **PayPal-signed JWT** in `Authorization`, containing the merchant ID and scope. Verify it with PayPal's public keys.
  - Source: docs.paypal.ai, Store Sync, "Set up your API (Orders v2 integration)"
- **How carts map to Orders v2:**
  - Creating a cart triggers `POST /v2/checkout/orders`.
  - Item, coupon, address and quantity changes trigger `PATCH /v2/checkout/orders/{id}`.
  - Checkout receives `payment_method {type: paypal, token: <order id>, payer_id}`, then captures.
  - The PayPal order ID is the cart's `payment_method.token`.
  - A Braintree integration path is also documented.
- **Cart state fields:**
  - `status`: `CREATED`, `INCOMPLETE`, `COMPLETED`
  - `validation_status`: `VALID`, `INVALID`, `REQUIRES_ADDITIONAL_INFORMATION`
  - `validation_issues[]`, each with:
    - `code`: `INVENTORY_ISSUE`, `PRICING_ERROR`, `SHIPPING_ERROR`, `PAYMENT_ERROR`, `DATA_ERROR`, `BUSINESS_RULE_ERROR`
    - `type`, `user_message`, `variant_id`, `context`
    - `resolution_options[]`, with actions such as `SUGGEST_ALTERNATIVE`, `ACCEPT_NEW_PRICE` (never auto-applied), `UPDATE_ADDRESS`, `REMOVE_ITEM`, `SPLIT_ORDER`, `RETRY_LATER`
- **Response codes:**
  - `200` with issues for business problems
  - `422` with `details[].business_context` when the cart cannot be created
  - `400`, `404` and `500` for technical errors
  - Sources: docs.paypal.ai Store Sync response-handling, integration-use-cases, advanced-use-cases
- **Extras:** gift-card `gift_options`, `geo_coordinates`, multi-item carts, `marketing_consents`, `available_shipping_options`. An OpenAPI spec (`paypal-cart-agentic-commerce-v1.yaml`) is listed in the docs.paypal.ai `llms.txt` index, but it returned 404 on 2026-10-03.
- **Catalog distribution** goes through partners (Wix, Cymbio, BigCommerce/Feedonomics, Shopware) or direct catalog sync. PayPal then distributes the catalog to ChatGPT, Copilot, Perplexity and others.
- **Access:** **early access via a request form** (paypal.com/us/business/ai#form).
- **Fit for multi-tenant:** one platform implementation of `/merchant-cart` can serve every tenant, routed by the merchant ID in the JWT. Whether the JWT carries the **seller's** merchant ID for a partner platform is not documented; ask PayPal.

### 3.2 ACP (OpenAI and Stripe): Instant Checkout in ChatGPT

- **Spec status:** beta, date-versioned. The latest stable version is **`2026-04-17`** (cart, feed, orders, authentication, MCP). Earlier versions: `2026-01-30` (extensions, discounts, payment handlers), `2026-01-16` (capability negotiation), `2025-12-12`, `2025-09-29`.
- **Two specs make up ACP:**
  - **Agentic Checkout.** The seller implements `POST /checkout_sessions`, `GET` and `POST /checkout_sessions/{id}`, `POST .../complete` and `POST .../cancel`. Each call carries Idempotency-Key, Request-Id, Signature, Timestamp and API-Version headers.
  - **Delegate Payment.** The PSP tokenizes a card under an `allowance` of `{reason: one_time, max_amount, currency, checkout_session_id, merchant_id, expires_at}`.
- **PayPal's path is Agent Ready through Braintree:**
  - The ChatGPT app widget calls `window.openai.requestCheckout({... payment_provider: {provider: "braintree", merchant_id, supported_payment_methods: [card, applepay, googlepay]}})`.
  - Our MCP server exposes `complete_checkout` and receives `payment_data.token`, a Braintree single-use nonce.
  - We then call `transaction.sale` or the GraphQL `chargePaymentMethod`.
  - Braintree validates `merchant_id`, `max_amount`, `currency` and `expires_at`.
  - `facilitator_details.oauth_application_name = "ChatGPT"` tags these transactions.
  - `paypal_wallet` and `venmo_wallet` are "coming soon".
  - Sources: developer.paypal.com/agent-ready/agentic-commerce-protocol; github.com/agentic-commerce-protocol
- **Access:** early access, the same form as Store Sync.

### 3.3 UCP (Google and partners): Google AI Mode and Gemini

- **Discovery:** the business publishes a profile at **`/.well-known/ucp`** listing services, capabilities, payment handlers and JWK `keys`. Platforms identify themselves with the `UCP-Agent: profile="..."` header, and capability sets are negotiated by intersection. The latest dated spec seen is `2026-08-25`.
- **Capabilities:**
  - shopping: `dev.ucp.shopping.checkout`, `.cart`, `.catalog.search`, `.catalog.lookup`, `.order`, `.permalink`, `.fulfillment`, `.discount`
  - common: `dev.ucp.common.identity_linking` (OAuth), `.location.*`
- **Transports:** **REST** (OpenAPI), **MCP** (OpenRPC, where tools map one-to-one to operations), **A2A** (Agent Card), and **embedded**.
- **Checkout operations:**
  - REST: `POST/GET/PUT /checkout-sessions[/{id}]`, `.../complete`, `.../cancel`
  - MCP tools: `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout`
  - Status values: `incomplete`, `requires_escalation`, `ready_for_complete`, `complete_in_progress`, `completed`, `canceled`
  - `continue_url` hands the buyer off to the business UI.
  - Authentication and signing: API key, OAuth, mTLS, or RFC 9421 HTTP Message Signatures. TLS 1.3 is required.
- **Human approval.** The user must finalize checkout through a **trusted UI** unless the AP2 Mandates extension is supported.
- **PayPal's path is Agent Ready through Braintree, using the Google Pay handler:**
  - Google tokenizes server-side and sends `androidPayCards` in the checkout-complete payload.
  - Prerequisites: a Braintree account, Google Pay enabled, and **UCP merchant registration with Google**.
  - Sources: developer.paypal.com/agent-ready/universal-commerce-protocol; ucp.dev
- **Discovery is permissionless.** Any platform can call a business that publishes `/.well-known/ucp`, so we can build and test UCP endpoints without Google. The Google AI Mode buy button still needs Google's enablement.

### 3.4 AP2 (Agent Payments Protocol): the trust layer

- **Spec v0.2** (github.com/google-agentic-commerce/ap2). AP2 is a security layer that sits inside a commerce protocol and is designed to work with UCP.
- **Two mandates, both SD-JWT verifiable credentials:**
  - The **Checkout Mandate** binds the user's approval to a merchant-signed Checkout JWT via `checkout_hash`. It gives the merchant proof.
  - The **Payment Mandate** gives proof to the credential provider, the network and the processor.
- **Two modes:**
  - **Human Present:** the user approves on a trusted surface.
  - **Human Not Present:** the user approves open mandates with constraints, and the agent signs closed mandates with its key (`cnf` claim).
- **Receipts:** every mandate gets a signed receipt. The mandates and receipts together form **dispute-grade evidence**.
- **PayPal** announced AP2 support (developer.paypal.com community blog) but has **no public AP2 API**. Mandates must be implemented by us, as the merchant and as the agent operator.

### 3.5 What "support ACP, UCP and AP2" means for us

| Protocol | Our role | Build work | Payment rail | Production gate |
|---|---|---|---|---|
| Store Sync | Merchant API that PayPal calls | `/merchant-cart` (4 endpoints), JWT verification, Orders v2 | PayPal Orders v2 | PayPal early-access form |
| ACP | Seller, plus MCP plugin in ChatGPT | `/checkout_sessions` (5 endpoints), `complete_checkout` tool, widget | **Braintree** delegated token | PayPal early access, OpenAI plugin review |
| UCP | Business | `/.well-known/ucp`, REST and/or MCP checkout bindings, signatures | **Braintree** Google Pay handler | Google UCP registration |
| AP2 | Merchant verifier, and signer for our own agents | Mandate verification, receipts, evidence storage | Any | None. The spec is open and early. |

## 4. Multi-tenant platform (PayPal Multiparty)

- **Seller onboarding:**
  - `POST /v2/customer/partner-referrals` with `tracking_id`, `operations[API_INTEGRATION / THIRD_PARTY features]`, `products: [EXPRESS_CHECKOUT]` and `legal_consents`. Redirect the seller to `links[rel=action_url]`.
  - Features to request: `PAYMENT`, `REFUND`, `PARTNER_FEE`, **`READ_SELLER_DISPUTE`, `UPDATE_SELLER_DISPUTE`**, `TRACKING_SHIPMENT_READWRITE`, `ACCESS_MERCHANT_INFORMATION`, `VAULT`, and optionally `DELAY_FUNDS_DISBURSEMENT`.
  - Sources: `SPEC/customer_partner_referrals_v2.json`, `E/snippets/javascript/seller-onboarding.md`
- **Onboarding status:**
  - `GET /v1/customer/partners/{partner_id}/merchant-integrations/{merchant_id}`. Check `payments_receivable`, `primary_email_confirmed` and `oauth_integrations`.
  - This endpoint is **not in the specs**. It appears only in ruleshub (`E/rules.md:155`).
- **Acting on a seller's behalf:**
  - Send a `PayPal-Auth-Assertion` JWT (`iss` = partner client ID, `payer_id` = seller merchant ID), plus `PayPal-Partner-Attribution-Id` (the BN code).
  - Orders: `payee.merchant_id`, `payment_instruction.platform_fees[]`, and `disbursement_mode` (`INSTANT` by default, or `DELAYED`).
  - Sources: `E/snippets/javascript/multiparty-{create-order,capture}.md`
- **Platform fee rules:**
  - The fee currency must match the transaction currency.
  - The fee payee needs a bank account, and fees settle daily.
  - The partner's API-caller account cannot hold a PayPal balance.
  - Fees are not supported for first-party integrations.
  - Refunding the fee requires PayPal enablement.
  - Source: developer.paypal.com/docs/multiparty
- **SDK support:**
  - Server SDK (`refs/PayPal-TypeScript-Server-SDK`): supports `paypalAuthAssertion` and `paypalPartnerAttributionId` on Orders and Payments. It has **no** partner-referrals, disputes or webhook-verification controllers, so we write those calls ourselves.
  - JS SDK v6: `createInstance({clientId: PARTNER_CLIENT_ID, merchantId: SELLER_MERCHANT_ID, ...})`. Fastlane needs a client token, and partner token calls also send the Auth-Assertion and BN headers.
  - agent-toolkit: **no Auth-Assertion support**. Use one toolkit instance per tenant with that tenant's token, or our own tool layer. Its `context.tenant_context`, sent as the `PayPal-Tenant-Context` header, is undocumented.
- **Team reporting and payouts (sandbox probes, 2026-10-13):**
  - Third-party: walk-crew (`TR4W3HLBT75MG`) re-consented to a referral adding `ADVANCED_TRANSACTIONS_SEARCH` and `PAYPAL_BALANCE` (both accepted, 201). Its `oauth_integrations` then list `reporting/search/read`, yet `GET /v1/reporting/balances` and `/v1/reporting/transactions` with the partner token and the seller's `PayPal-Auth-Assertion` still answer 403 NOT_AUTHORIZED (with or without the BN header). The partner's own transaction search answers 200. Third-party `PAYOUTS` stays refused (422 `FEATURES_UNAUTHORIZED`, R5a).
  - First-party: a referral with `first_party_details.features` = `PAYMENT`, `REFUND`, `PAYOUTS`, `ADVANCED_TRANSACTIONS_SEARCH`, `PAYPAL_BALANCE` (201) and one consent in the mini-browser gives seller credentials whose token carries `payments/payouts`, `reporting/search/read` and the referenced-payouts scopes. With them, balances answered 200 (`account_id` = the merchant, USD available 5343.41) and transactions 200 (19 in 30 days; event codes T0006, T0113, T1107, T1900). Without the two features (R5c), balances answered 403.
  - So Payleor reads a team's balance and transactions, and sends its payouts, with the team's first-party credentials; the third-party connection keeps checkout, platform fees, refunds and disputes. PayPal's build-onboarding page says first-party covers "only cart capabilities" (no platform fee, partner reporting or disputes), which matches.
  - Sources: developer.paypal.com/platforms/seller-onboarding/build-onboarding, …/before-payment, …/create-account; `SPEC/customer_partner_referrals_v2.json` (`rest_endpoint_features_enum`); probe scripts `/tmp/r5b-reporting-probe.mjs`, `/tmp/r5b-firstparty-reporting.mjs`.
- **Going live:** sandbox works with a standard developer account. **Live use requires PayPal approval of the partner.**
- **Braintree for multi-tenant** (needed for ACP and UCP in production):
  - Braintree Auth and OAuth are **closed beta in production** and **open beta in sandbox**.
  - Scopes include `read_write`, `manage_disputes` and `oauth_app_receive_dispute_webhooks`.
  - Without them, each tenant must bring its own Braintree credentials.
  - Source: developer.paypal.com/braintree/docs/guides/braintree-auth

## 5. Disputes and chargebacks

- **One API covers both** (`SPEC/customer_disputes_v1.json`, 16 operations):
  - Read and update: list, get, PATCH.
  - Actions: `provide-evidence` (multipart), `appeal`, `accept-claim`, `make-offer`, `accept-offer`, `deny-offer`, `escalate`, `send-message`, `acknowledge-return-item`, `provide-supporting-info`.
  - Sandbox-only: `adjudicate`, `require-evidence`.
- **Channels:**
  - `INTERNAL`: filed with PayPal; PayPal adjudicates.
  - `EXTERNAL`: a **card chargeback** or ACH return; the issuer or network adjudicates.
  - `ALERT`: a pre-chargeback alert. Refund **within 20 hours** to avoid the chargeback.
- **Stages** (`dispute_life_cycle_stage`):
  - `INQUIRY`: up to 20 days, internal only, for item-not-received and not-as-described disputes.
  - Then `CHARGEBACK`, then `PRE_ARBITRATION`, then `ARBITRATION`. Note that `CHARGEBACK` is also PayPal's name for the claim stage.
  - Buyers have 180 days to file. PayPal decides claims within 10 days.
  - Under **Accelerated Response**, merchants get a 10-day evidence window during inquiry.
- **Key fields:**
  - `seller_response_due_date`
  - `allowed_response_options` and the HATEOAS `links`, which list the actions allowed in the current stage
  - `evidences[]` with `source: REQUESTED_FROM_SELLER`
  - `seller_protection_eligible`
- **Evidence by reason:**
  - Item not received or unauthorized: `PROOF_OF_FULFILLMENT` with a carrier and tracking number.
  - Not as described: `OTHER` with notes or documents.
  - `PROOF_OF_REFUND` with refund IDs applies across reasons.
  - The spec documents about 75 evidence types in `x-enumDescriptions`.
  - Source: docs.paypal.ai disputes "reasons and evidence"
- **Sandbox simulation for agent tests:**
  - Create a dispute: `POST /v1/customer/disputes` (multipart, with Auth-Assertion).
  - Create a chargeback: `POST /v2/customer-support/process-chargeback`.
  - Change the reason: `POST /v1/customer/disputes/{id}/change-reason`.
  - Settle: the `adjudicate` endpoint.
  - Source: docs.paypal.ai disputes "test and go live"
- **Webhooks:** `CUSTOMER.DISPUTE.CREATED`, `.UPDATED` and `.RESOLVED`. `RISK.DISPUTE.CREATED` is deprecated. These events are **not** in `SPEC/notifications_webhooks_v1.json`.
- **agent-toolkit coverage:** only `list_disputes`, `get_dispute` and `accept_dispute_claim`. Its zod schema validates `note` against the dispute-ID regex (`refs/agent-toolkit/typescript/src/shared/parameters.ts:575`), which is a bug. **Evidence, offers, appeals and messages need our own tools.**
- **Braintree disputes** use a separate API, needed for ACP and UCP transactions. The Braintree Auth scope is `manage_disputes`.
- **AIT guidance** (`AIT/disputes-refunds.md`): never auto-accept, check the stage and due date first, prefer a proactive refund, add tracking early.

## 6. agent-toolkit, version 1.11.0 (`refs/agent-toolkit`)

- **Tools:**
  - 21 invoice tools
  - products (4)
  - plans and subscriptions (8)
  - tracking (3)
  - orders `create_order`, `get_order`, `pay_order`
  - refunds `create_refund`, `get_refund`
  - disputes (3)
  - `list_transactions`
  - `get_merchant_insights`, which **throws in sandbox**
- **Configuration:** `actions` is a per-tool allow-list (`{product: {action: bool}}`). `context` takes `sandbox`, `access_token`, `request_id` (sent as `PayPal-Request-Id`), `tenant_context` and `merchant_id`; `merchant_id` is only logged.
- **Adapters:**
  - TypeScript: `ai-sdk`, `openai`, `langchain`, `bedrock`, `mcp`
  - Python: openai, langchain, crewai, bedrock
- **MCP:** `PayPalMCPToolkit.getTools()` lets us embed PayPal tools inside **our own** MCP server, alongside tenant-scoped tools.
- **Prompt guidance** (docs.paypal.ai prompt best practices):
  - Use action-first prompts and split multi-step tasks.
  - Never put card numbers or other PII in prompts.
  - Keep a human in the loop where judgment matters.

## 7. Storefront: JS SDK v6 (`refs/paypal-js`)

- **Loading:** `loadCoreSdkScript({environment})`, then `createInstance({clientId | clientToken, components, merchantId?, partnerAttributionId?, pageType, locale})`.
- **Sessions:**
  - PayPal one-time and save
  - Pay Later and Credit
  - Venmo
  - guest card
  - card fields (one-time and save)
  - Apple Pay and Google Pay
  - subscriptions
  - about 50 local payment methods
  - `findEligibleMethods`
- **React** (`@paypal/react-paypal-js/sdk-v6`): `PayPalProvider`, buttons, card fields, and `use*Session` hooks, including Braintree variants.
- **Gaps:** no Fastlane types or components, although Fastlane is documented in `AIT/js-sdk-v6.md`.

## 8. Webhooks, credentials and security

- **Webhooks:**
  - Up to **10 webhook URLs per REST app**, each subscribed to specific event types.
  - PayPal retries non-2xx responses **25 times over 3 days**.
  - Verify via `POST /v1/notifications/verify-webhook-signature` or the CRC32 signature.
  - Return 200 quickly and process asynchronously. Expect duplicates.
- **Multi-tenant webhooks:** the platform receives events through the partner app. Route each event to its tenant by the resource's `payee.merchant_id` or dispute `seller.merchant_id`. Ruleshub has no guidance on this.
- **Credentials:**
  - Cache OAuth tokens until `expires_in`. Scopes come back on the token response; see docs.paypal.ai "Apps, scopes, and credentials".
  - Store client secrets only server-side, in a vault or environment.
  - Rotate secrets, use least privilege, use TLS 1.2 or higher, and never log tokens or PANs.
- **Sandbox testing:** force errors with the `PayPal-Mock-Response` header (for example `INSTRUMENT_DECLINED`, `DUPLICATE_INVOICE_ID`), or turn on account-level negative testing (github.com/paypaldev/getting-started-with-paypal-sandbox).

## 9. Design implications

1. **Two payment rails are unavoidable.**
   - PayPal REST (Orders v2 with Multiparty) handles the web storefront, Store Sync, and Claude handoff.
   - **Braintree** handles ACP and UCP.
   - The commerce core needs a payment-rail abstraction keyed by tenant and channel.
2. **One canonical checkout model, with protocol adapters around it.** Store Sync carts, ACP `checkout_sessions`, UCP `checkout-sessions` and our own MCP and web checkout should all map onto one internal checkout aggregate. Each protocol only adds a thin adapter.
3. **Tenant routing is a first-class concern**, carried through every layer:
   - the merchant ID in the Store Sync JWT
   - `payee.merchant_id` in webhooks
   - the Auth-Assertion header on outbound calls
   - the per-tenant Braintree merchant
   - per-tenant `/.well-known/ucp`
4. **Our own PayPal tool layer is required.** agent-toolkit cannot act for a seller and lacks the dispute actions. Wrap our tenant-aware PayPal client as agent tools, and reuse agent-toolkit schemas where they fit.
5. **Money-moving actions are gated.**
   - Refunds, capture, accepting claims and offers all need human confirmation.
   - AP2 mandates give cryptographic proof of consent, and double as dispute evidence.
6. **Early-access dependencies need fallbacks:**
   - Store Sync and Agent Ready need the PayPal form.
   - Production Braintree Auth is closed beta.
   - UCP needs Google registration.
   - The sandbox demo must work without them: an MCP plugin with PayPal handoff, plus UCP and ACP endpoints exercised by our own test agent.

## 10. Conflicts between sources

| Topic | Source A | Source B | Resolution |
|---|---|---|---|
| Cart API shape | ruleshub `E/mappings/agentic-commerce.json`: PayPal-hosted `POST /v2/cart`, `PATCH /v2/cart/{id}` | docs.paypal.ai Store Sync: merchant-hosted `/merchant-cart`, `PUT` replace, PayPal JWT | Follow the live docs |
| ACP payment config | PayPal Agent Ready guide: `payment_provider {provider: braintree}` | ACP spec `2026-01-30` and later: `capabilities.payment.handlers[]`, which replaces `payment_provider` | Confirm with PayPal which ACP version Braintree supports |
| ChatGPT widget MIME type | PayPal guide: `text/html+skybridge`, `openai/outputTemplate` | MCP Apps standard: `text/html;profile=mcp-app`, `_meta.ui.resourceUri` (ChatGPT accepts both) | Use the MCP Apps standard, with OpenAI aliases where needed |
| Onboarding webhooks | `E/snippets/javascript/webhooks.md`: `CUSTOMER.MERCHANT-INTEGRATION.SELLER-ONBOARDING.*` | `E/mappings/webhooks.json`: `MERCHANT.ONBOARDING.COMPLETED`, `MERCHANT.PARTNER-CONSENT.REVOKED` | Check the live webhook event list before relying on either |
| Dispute evidence types | `E/mappings/multiparty-disputes.json`: includes `TRACKING_INFO` | `SPEC/customer_disputes_v1.json`: no `TRACKING_INFO`; tracking goes in `PROOF_OF_FULFILLMENT.evidence_info` | Follow the spec |
| Remote MCP commerce tools | `AIT/mcp-tools.md`: general commerce | docs.paypal.ai: gift cards only | Gift cards only |

## 11. Open questions for PayPal (ask on Discord)

1. Can hackathon sandbox accounts get Store Sync and Agent Ready (ACP and UCP) access before Nov 12?
2. For Store Sync on a partner platform, does the PayPal JWT identify the **seller** merchant? Do cart orders use Auth-Assertion and `platform_fees`?
3. Which ACP spec version does Braintree delegated payment support: `payment_provider` or `payment_handlers`?
4. Is Braintree OAuth (sandbox open beta) enough to run ACP and UCP for many tenants in sandbox?
5. Does PayPal plan an AP2 API, for example Payment Mandate passthrough on Orders v2?

## 12. Runtime platform: Cloudflare

The platform runs on Cloudflare. [`2026-10-02-cloudflare-birthday-week.md`](2026-10-02-cloudflare-birthday-week.md) (copied from the workspace root's `cloudfare.md`) summarizes Birthday Week 2026 (Sept 28 to Oct 1). The items below were checked against blog.cloudflare.com, developers.cloudflare.com and the changelog on 2026-10-03.

### 12.1 Chosen stack

The project was scaffolded with:

```sh
pnpm create better-t-stack@latest jendal-workspace --frontend next --backend hono \
  --runtime workers --api none --auth better-auth --payments none --database postgres \
  --orm drizzle --db-setup prisma-postgres --package-manager pnpm --git --web-deploy cloudflare \
  --server-deploy cloudflare --install --addons evlog pwa turborepo --examples none
```

All flags are valid per better-t-stack.dev/docs/cli/options. Cloudflare deployment is generated as Alchemy infrastructure-as-code in `packages/infra/alchemy.run.ts`. The `evlog` addon adds request logging (evlog.dev); `pwa` adds a manifest and service worker to the web app.

Three additions or corrections:

- **vinext for Next.js on Workers.** Vinext 1.0 (2026-09-28; 1.0.1 is current) is a Cloudflare Vite plugin that reimplements the Next.js 16 API. It supports the App and Pages routers, RSC, server actions, route handlers, `middleware.ts` and `proxy.ts`, `instrumentation.ts`, ISR, and bindings through `cloudflare:workers`. Gaps: full Cache Components, build-time image and font optimization (Google Fonts load from the CDN), typed `Link` hrefs from `typedRoutes`, and native modules in dev. `reactCompiler` in `next.config` is ignored; use `vinext({ react: { compiler: true } })` with `@vitejs/plugin-react` 6.1+ and `oxc-transform-react` (`refs/stack/vinext/README.md`, `refs/stack/vinext/packages/vinext/src/check.ts`). **Deployment through Alchemy:** `Cloudflare.Website.Vinext`, added in Alchemy 2.0.0-beta.80, builds with the app's `vite.config.ts`, injects Alchemy's Cloudflare Vite plugin (so `@cloudflare/vite-plugin` must not be in the config), provisions `VINEXT_KV_CACHE`, and defaults the Worker entry to `worker/index.ts` wrapping `vinext/server/fetch-handler` (`refs/stack/alchemy/website/src/content/docs/cloudflare/frontend/vinext.mdx`, `refs/stack/alchemy/examples/cloudflare-website-vinext/`). The example binds another Worker as a service binding and calls it with `env.BACKEND.fetch(...)` from a server component.
- **Better Auth and PayPal.** Better Auth has a built-in PayPal **social sign-in provider** (`socialProviders.paypal`, `environment: "sandbox" | "live"`). It handles login only. Better Auth has no PayPal payments plugin (only a Stripe one), so payments use our own PayPal client. The PayPal redirect URL must be public HTTPS, so localhost sign-in needs a tunnel.
- **Store URLs.** Each store is reachable three ways:
  - a subdomain: `{store}.payleor.app`, served by a `*.payleor.app/*` Worker route
  - a path: `store.payleor.app/{store-id}/`
  - the merchant's own domain, through **Cloudflare for SaaS** custom hostnames with the Worker as the fallback origin and a `*/*` route

  The Worker resolves the tenant from the `Host` header, `request.cf.hostMetadata` (custom hostnames), or the first path segment, then looks it up in a cached tenant map. Workers for Platforms (dispatch namespaces) is only needed if merchants ever run their own code.

### 12.2 Cloudflare products that fit the design

| Need | Product | Status (2026-10-03) | Notes |
|---|---|---|---|
| Tenant and host lookup on every request | **Workers KV Instant** | Private beta | Same KV API, backed by Quicksilver. p99 reads 1.62 ms, p99 global write replication 256 ms. Fallback: classic KV (p99 287 ms uncached, around 4 s replication) with Postgres as source of truth. blog.cloudflare.com/workers-kv-instant |
| Order, payment and dispute event log | **K2** | Public beta, Workers Paid | Durable ordered log on R2. Worker binding `send()`, subscriptions with lease, `ack`/`nack`, at-least-once delivery, retention up to 30 days. Produce latency around 1 s p99, so not for the request path. developers.cloudflare.com/k2 |
| Product search for the shopping agent and storefront | **AI Search** | GA; billing starts 2026-11-01 | Multimodal embeddings (search by image), OCR, built-in MCP endpoint per instance. Multitenancy: one instance per tenant through the `ai_search_namespaces` binding (recommended) or a shared instance with a `folder` filter. developers.cloudflare.com/ai-search/how-to/per-tenant-search |
| Fast typed decisions (dispute triage, fraud flags, agent guardrails) | **Clef / Clef-flash** on Workers AI | Available | Decision models that return per-option probabilities. Up to 64 questions per call, types `noul`, `choice` and `score`, 64K context, up to 4 images. Called through `env.AI.run("@cf/cloudflare/clef", …)`. Weights are Apache 2.0. developers.cloudflare.com/workers-ai/models/clef |
| LLM routing and cost control for agents | **AI Gateway + Auto Router** | Public beta, free during beta | Set the model to `cloudflare/auto` and the router picks a capable, cheaper model per request. blog.cloudflare.com/auto-router |
| MCP server for the ChatGPT and Claude plugins | **Agents SDK `createMcpHandler`** | Current | Stateless, one `McpServer` per request (MCP SDK v2, `@modelcontextprotocol/server`). `McpAgent` is deprecated and feature-frozen, so do not start on it. OAuth comes from `@cloudflare/workers-oauth-provider`; tools read identity through `getMcpAuthContext()`. Use `allowedHostnames` for custom domains. Durable state goes in Durable Objects, KV or Postgres, never in an MCP session. developers.cloudflare.com/agents/model-context-protocol/apis/handler-api |
| Charging agents for API or MCP access | **Monetization Gateway** | Closed beta | HTTP 402 with x402 authorization. It meters access to resources; it does not replace PayPal checkout. Out of scope unless we later sell API access. |
| Running a Node-only SDK if needed | **Containers** | Available; faster starts announced 2026-09-30 | Escape hatch if a payments SDK cannot run inside a Worker. |

Not relevant to this project: Artifacts, EmDash, Forge, the `cf` CLI (useful for tooling only), Cloudflare OS, the CA application, and Basin (possible later for analytics).

### 12.3 PayPal and Braintree clients on Workers

- **Node.js compatibility:** compatibility dates from 2026-08-04 enable `nodejs_compat` by default (developers.cloudflare.com/workers/runtime-apis/nodejs).
- **`@paypal/paypal-server-sdk`** sends requests through `@apimatic/axios-client-adapter` (`refs/PayPal-TypeScript-Server-SDK/package.json:46`). Axios has a history of failing in Workers. Whether the SDK runs in a Worker is **unverified** and needs a spike.
- **Recommendation:** write a thin, typed `fetch` client for the PayPal endpoints we use, with types derived from `SPEC/*.json`. We need our own layer anyway, because every outbound call must carry per-tenant headers (`PayPal-Auth-Assertion`, `PayPal-Partner-Attribution-Id`, `PayPal-Request-Id`) and use a cached OAuth token (see §4 and §9).
- **Braintree:** the Node SDK relies on Node's HTTP stack, and Workers support is unverified. Braintree's GraphQL API works over plain `fetch`, which avoids the problem. Containers is the fallback.
- **Database:** Aiven for PostgreSQL through Drizzle. Deployed Workers connect through Hyperdrive, which supports Postgres.js 3.4.4 and later (the scaffold uses `postgres@^3.4.9`). Cloudflare recommends `fetch_types: false` with Postgres.js when array types are not used, and `prepare: true` so Hyperdrive can cache prepared statements (developers.cloudflare.com/hyperdrive/examples/connect-to-postgres). The user re-ran the scaffold with `--api trpc --db-setup none`; see the design spec §2.1 for the generated structure. **Hyperdrive in Alchemy:** `Cloudflare.Hyperdrive.Connection` caches query results for 60 seconds by default; set `caching: { disabled: true }` so auth and store reads see writes at once. In `alchemy dev` the binding is a passthrough to the connection's `dev` origin (default `sslmode: "prefer"`), so local development needs a reachable Postgres (`refs/stack/alchemy/examples/cloudflare-dev/src/HyperdriveWorker.ts`).
  - **First deploy (2026-10-04, stage `live_mouhamed`, W1-A Task 18):** Hyperdrive to Aiven worked on the first deploy with the default origin settings. Aiven's private CA needed no `mtls` or `sslmode` change. `/trpc/healthCheck` (which pings the database) answered `{"result":{"data":"OK"}}` on both the api Worker and the web Worker (through the service binding). The first request took about 5.5 s (cold start plus the first Aiven connection); later ones took 0.7 to 0.9 s from the developer's machine. The turbo `deploy` task is marked `interactive`, so `pnpm run deploy` needs a real terminal; from scripts or agents, run `pnpm exec alchemy deploy --yes --no-input` in `packages/infra`.
