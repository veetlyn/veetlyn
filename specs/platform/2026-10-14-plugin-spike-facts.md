# Plugin spike: facts for run C

**Date:** 2026-10-14. **Status:** draft. Claude results are partly filled in, and ChatGPT is not tried yet. **Plan:** [`plans/2026-10-14-s-plugin-spike.md`](plans/2026-10-14-s-plugin-spike.md). **Branch:** `spike-plugin` (throwaway, not merged). **Sources:** [`plans/evidence/s-spike-sources.md`](plans/evidence/s-spike-sources.md), with every vendor fact and the URL it was read from.

## What was built

The spike ran on the dev stack over the tunnel, with Better Auth 1.7.7, `@modelcontextprotocol/server` 2.3.1 and `@modelcontextprotocol/ext-apps` 2.0.3.

- **Auth:** `jwt()`, `mcp({ loginPage: "/login", consentPage: "/oauth/consent", resource: "https://api.payleor.com/mcp", allowDynamicClientRegistration, allowUnauthenticatedClientRegistration })` and `cimd({ metadataProfile: "mcp-2026-07-28" })` in `packages/auth/src/index.ts`.
- **Database:** eight new tables (`jwks`, `oauth_client`, `oauth_resource`, `oauth_client_resource`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`, `oauth_client_assertion`), from migrations `20261014123711_spike_mcp_oauth` and `20261014125010_spike_mcp_oauth_jsonb`.
- **Web:** a consent page at `admin.payleor.com/oauth/consent`. `oauthProviderClient()` is added to the web auth client, and the sign-in form follows the OAuth continuation.
- **Web Worker:** forwards `/.well-known/oauth-authorization-server*` and `/.well-known/openid-configuration*` to the api.
- **api Worker:** answers `GET /.well-known/oauth-protected-resource[/mcp]` from the Better Auth handler, and serves `POST /mcp` wrapped in `requireMcpAuth`, through `createMcpHandler(factory, { legacy: "stateless" })`.
- **Tools:**
  - `find_offerings` (widget `ui://payleor/offerings`).
  - `show_quote` (widget `ui://payleor/quote`, with **Pay with PayPal** through `app.openLink` and **Accept (test)** through `app.callServerTool`).
  - `accept_quote_spike`, which is app-only (`_meta.ui.visibility: ["app"]`) and logs only.
- **Widgets:** plain HTML that imports `App` from unpkg (`_meta.ui.csp.resourceDomains: ["https://unpkg.com"]`).

## Answers

### 1. Client registration

**Claude registers through CIMD.**

- **Evidence:** on 2026-10-14 the `oauth_client` row `https://claude.ai/oauth/mcp-oauth-client-metadata` (`client_discovery_id = cimd`, name "Claude", redirect `https://claude.ai/api/mcp/auth_callback`, auth method `none`) was refreshed when Mouhamed connected. Claude never called `/oauth2/register`.
- **Better Auth profile:** the `mcp-2026-07-28` CIMD profile accepts Claude's document.
- **DCR also works:** it was proven with a scripted client (register, authorize, sign in, consent, token, MCP). Keep it as a fallback for clients without CIMD, behind Better Auth's rate limit (the limiter refused a registration burst with 429).

**ChatGPT also registers through CIMD.** It got the client id `https://chatgpt.com/oauth/client.json`, name "ChatGPT", `token_endpoint_auth_method: private_key_jwt`, and the redirect `https://chatgpt.com/connector_platform_oauth_redirect`.

- **Profile:** Better Auth's `mcp-2026-07-28` profile accepted the document.
- **Key fetch:** `private_key_jwt` means Better Auth fetches ChatGPT's `jwks_uri` through the same allowlisted transport.
- **First attempt, 15:09 to 15:13:**
  - Discovery and authorize worked.
  - The consent page reloaded three times, and Mouhamed reported a "script error" on the permissions screen.
  - Allow then succeeded (consent stored at 15:13:03).
  - ChatGPT never called the token endpoint.
  - **Cause:** the "script error" was the dev-only duplicate React problem ("Cannot read properties of null (reading 'useContext')" in vinext's `GlobalErrorBoundary`). Vite re-bundled dependencies after a restart, and the browser mixed cached and new bundles. It was fixed by clearing `apps/web/node_modules/.vite`, restarting and hard-reloading. This is not a production issue.
- **Retry at 16:41, connected:**
  - authorize (the stored consent skipped the screen), then the token exchange with `private_key_jwt` (Better Auth fetched ChatGPT's `jwks_uri` through the allowlisted transport), then MCP calls, then `/oauth2/userinfo`.
  - ChatGPT then showed "Données de rappel OAuth manquantes" (OAuth callback data missing), most likely on a second callback tab after the flow had already completed. Watch for it on a fresh connection.

### 2. CIMD on Workers

The bundled transport (`@better-auth/cimd/node`) needs `node:dns`, `node:https` and `node:net`, which Workers cannot use to pin an address. The spike injects its own transport:

- an `https:` allowlist of `claude.ai` and `chatgpt.com` (as `isMetadataDocumentUrlAllowed` and inside the transport);
- `fetch` with `redirect: "manual"`, refusing any 3xx.

Cloudflare's egress does not reach private networks, so the allowlist bounds the server-side request forgery risk that pinning addresses for. For run C, keep the allowlist and add hosts only for clients we test.

### 3. Where OAuth lives

The authorization server can live on a different host from the MCP resource.

- **Hosts:** the issuer is `https://admin.payleor.com/api/auth` (it follows `BETTER_AUTH_URL`) and the resource is `https://api.payleor.com/mcp`. Claude read `authorization_servers` from the protected resource metadata and ran discovery on the admin host.
- **Pages:** the login and consent pages are ours. The existing `/login` works once:
  - the web auth client has `oauthProviderClient()`, which adds the signed `oauth_query` to the sign-in body;
  - the form follows `{ redirect: true, url }`. The URL is relative (`/oauth/consent?…`) when consent is next.
- **Not covered:** sign-in with PayPal or Discord inside the OAuth window, because social sign-in does not carry `oauth_query` through the provider round trip.
- **Discovery:** discovery paths with the issuer path inserted (`/.well-known/oauth-authorization-server/api/auth`) must reach Better Auth on the admin host. Today the web Worker forwards only `/api/*` and `/trpc/*`.
- **After the `dash.` rename** (run H), the issuer moves with `BETTER_AUTH_URL`.

### 4. Token check

`requireMcpAuth(auth, handler, { resource })` verifies the JWT against `{issuer}/jwks` on the Worker.

- **Token:** an EdDSA JWT with `aud` set to `[resource, userinfo]`, `azp` set to the client id, and the user id in `sub`. Each Claude MCP call logged the user id and the client id.
- **No database round trip:** the check itself needs none.

### 5. Widgets

**Claude renders both widgets inline.** Evidence: [`plans/evidence/s-spike-claude-widgets.png`](plans/evidence/s-spike-claude-widgets.png), showing claude.ai on 2026-10-14 with Opus 5.5.

- **Tool list:** after connecting, Claude listed three tools, two marked interactive and one app-only. So it reads `_meta.ui.resourceUri` and `_meta.ui.visibility`.
- **Bridge:** the widgets loaded `App` from unpkg under `_meta.ui.csp.resourceDomains`, received the tool result through `ontoolresult`, and rendered the cards with system fonts.
- **Use of results:** Claude used the text content to answer. It noticed that the demo quote ($350) did not match the offering's listed price ($150) and said so, so run C's tool texts must be accurate and complete.
- **First prompt:** Claude first offered a web search. The user had to say "Use Payleor for this" before it called `find_offerings`. Run C's tool descriptions should name the cases where Payleor applies.

ChatGPT: (to fill in).

### 6. Leaving the widget for the pay page

**Claude: it works.** **Pay with PayPal** (`app.openLink({ url })`, which sends `ui/open-link`) opened `https://payleor.com/pay/{token}` in a new browser tab.

- **Payment:** Mouhamed paid there with the PayPal popup on our own page. The $210 deposit of "Logo refresh" was captured and the project moved to `in_progress`.
- **Widget status:** the widget showed "Opened the pay page." For a custom connector, Claude's docs say an "Open external link" confirmation appears first.
- **Pay link:** the pay link is signed and carries no amount, so the model never needs to see or repeat it. The tool text told the model not to share it, and it did not.

ChatGPT: (to fill in).

### 7. Widget-only tools

**Claude** lists `accept_quote_spike` as app-only.

- **The widget can call it:** pressing **Accept (test)** sent `app.callServerTool({ name: "accept_quote_spike" })`. The server logged the call (14:17:54, Claude's client id, the project id), and the widget showed `{"ok":true}`.
- **The pay button:** pressing **Pay with PayPal** afterwards opened the pay page in another tab again.
- **The model:** whether the model can call the tool itself is still to be filled in. The MCP Apps spec says a host must not list a tool without `"model"` to the agent.

**Server side:** a token holder can still call an app-only tool directly. The scripted client did, and got `{ ok: true }`. Hiding the tool is a host promise, not a security boundary. Run C's commit tools need the confirmation nonce: the widget-rendering tool issues it, and the commit tool requires and consumes it.

### 8. Judges

- **Claude:** custom connectors are available on every plan (Free is limited to one): Settings → Connectors → Add custom connector, with the URL `https://api.payleor.com/mcp` (the deployed host after run H) and no OAuth fields.
- **ChatGPT:** (to fill in).

## Problems found that run C must handle

1. **`text[]` columns come back as strings.**
   - **Problem:** `createDb` uses postgres.js with `fetch_types: false`, so Postgres arrays arrive as unparsed `"{a,b}"` strings and Drizzle does not parse them. Better Auth's OAuth tables use `string[]` fields, and the authorize endpoint threw `t.find is not a function`.
   - **Fix:** store those fields as `jsonb` (`$type<string[]>()`). Better Auth's relations-v2 adapter writes JS arrays and reads them back as arrays.
2. **MCP responses stream after the route returns.**
   - **Problem:** the api middleware closes the per-request database client once the handler returns a Response. With the SSE response from `createMcpHandler`, tools still running lost the connection (`CONNECTION_ENDED`).
   - **Fix:** buffer the MCP response (`await response.arrayBuffer()`) before returning it. The other option is to close the client only after the stream finishes.
   - **Caveat:** the api Worker's file watcher in `alchemy dev` stopped rebuilding at 13:01 without any message, and the first retry may have run an older bundle. Run C should reproduce this failure in a test (an SSE `tools/call` that runs two queries) before choosing the fix.
3. **Protocol versions.**
   - **What Claude sends:** on a new connection (15:13, logged by the spike), it first sends `server/discover` with `MCP-Protocol-Version: 2026-07-28` (user agent `Claude-User`). It then sends `initialize` with `protocolVersion: "2025-11-25"`, `clientInfo: { name: "Anthropic/ClaudeAI", version: "1.0.0" }` and `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes: ["text/html;profile=mcp-app"]`, then `notifications/initialized`.
   - **What ChatGPT sends (16:41):** `MCP-Protocol-Version: 2026-07-28` (user agent `openai-mcp/1.0.0`) throughout, with `server/discover`, `tools/list` and `resources/read` for both widgets. It never sends `initialize`. So ChatGPT uses the new stateless protocol, and Claude falls back to 2025-11-25.
   - **Problem:** `legacy: "reject"` (from the Better Auth MCP README) would refuse Claude's `initialize`.
   - **Fix:** use `legacy: "stateless"`, which serves both protocol eras on one endpoint. Run C can use the client's UI capability (`getUiCapability`) to fall back to text when a client does not render widgets.
4. **Fetch versus navigation.** Better Auth answers `/oauth2/authorize` with JSON `{ redirect, url }` instead of a 302 when the request carries `sec-fetch-mode: cors`. Browsers navigating get the 302.
5. **Rate limits.** Five sign-ins per minute apply inside the OAuth window too. A judge mistyping a password a few times waits a minute.

## Discovery: a plugin with skills, not a bare connector

- **What we saw:**
  - **ChatGPT:** it used Fiverr's published app for "find a logo designer" without an @-mention, but called Payleor only when Mouhamed @-mentioned it.
  - **Claude:** it first offered a web search, and called `find_offerings` only after "Use Payleor for this".
- **ChatGPT docs:**
  - A developer-mode (unpublished) app runs only when selected or @-mentioned for that message ("App selection applies to the message where you use it", help.openai.com 12584461).
  - Published apps can be surfaced through in-conversation discovery, which uses conversation context, brand mentions, tool metadata and linking state (developers.openai.com/apps-sdk/concepts/user-interaction).
  - Public distribution is now by plugins (apps, skills, or both) in ChatGPT and Codex, after review.
  - Model-readable text must not tell the model to prefer our app over others (submission guidelines).
  - ChatGPT plugins use the portable Agent Plugins format: root `plugin.json` with `$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, skills discovered from `skills/`, and `mcp.json` where each server declares `type: "streamable-http"` (not a renamed `.mcp.json`). OpenAI presentation (`displayName`, `defaultPrompt`) goes under `extensions.com.openai.interface`. Our `plugins/payleor/` already matches this format.
  - Local install is by marketplace file, not upload: `$REPO_ROOT/.agents/plugins/marketplace.json` (repo) or `~/.agents/plugins/marketplace.json` (personal), with the plugin folder at e.g. `~/.codex/plugins/payleor` and `source.path` relative to the marketplace root; then restart the **desktop app** and install from the local source in the Plugins Directory. On the web, chatgpt.com/plugins → Add custom MCP server → "Create as a plugin" wraps the registered connector (tools only, no skills).
  - `@plugin-creator` (ChatGPT Work mode) / `$plugin-creator` (Codex) scaffolds the older `.codex-plugin/plugin.json` compatibility layout and can wire a registered connector (`plugin_asdk_app...` id) into a plugin; the portable layout is the documented way forward.
- **Claude docs:**
  - A plugin bundles skills, MCP connectors and commands. "A connector alone leaves Claude to work out your workflow from tool names. The skill is where you put the sequence, the defaults, and what good output looks like." (claude.com/docs/plugins/build).
  - People add a plugin from Customize → Plugins: upload a zip, add a Git repository as a marketplace (`marketplace.json`), or install from the directory (reviewed, paid plans).
  - The skill's `description` decides when Claude loads it.
- **Spike follow-up (`spike-plugin`):**
  - `plugins/payleor/` holds a Claude plugin: `.claude-plugin/plugin.json`, `.mcp.json` pointing at `https://api.payleor.com/mcp`, the skill `skills/hire-a-professional/SKILL.md` and a README. The same folder is a valid ChatGPT portable plugin: root `plugin.json` (0.2.0, with `extensions.com.openai.interface` and `onboardingSkill`) and `mcp.json` with `type: "streamable-http"`. Installed on Mouhamed's machine at `~/.codex/plugins/payleor` with a personal marketplace at `~/.agents/plugins/marketplace.json`.
  - The tool descriptions now use OpenAI's "Use this when…" wording.
  - Whether Claude then uses Payleor without being told: **yes**. With the v2 plugin uploaded, "find me a logo refresh under $350" (no mention of Payleor) loaded the skill and called `search_offerings` (2026-10-14, 20:53; screenshot [`s-connector-v2-claude-plugin.png`](plans/evidence/s-connector-v2-claude-plugin.png)). See "Claude plugin test" under Connector v2.
- **For run C and the submission:**
  - Ship Payleor as a plugin: one `plugins/payleor/` folder serves both clients (Claude reads `.claude-plugin/` + `.mcp.json`, ChatGPT and Codex read `plugin.json` + `mcp.json`). Judges add it to Claude as a marketplace with `owner/repo`, and to ChatGPT desktop or Codex with `codex plugin marketplace add owner/repo`.
  - Write a golden prompt set and measure how often each client calls Payleor unprompted.
  - Directory listings (both clients) need review, so they cannot be counted on before judging; the testing instructions use the marketplace or upload for Claude and developer mode with an @-mention for ChatGPT.

## Connector v2 (spike, 2026-10-14 evening)

After the first sessions, the connector was rebuilt along the clients' guidance ([`plans/evidence/s-connector-ux-guidelines.md`](plans/evidence/s-connector-ux-guidelines.md), 38 rules from Claude's MCP Apps design guidelines, OpenAI's Apps SDK and plugin docs, the MCP Apps spec and Anthropic's guide to writing tools for agents).

- **Tools:**
  - `search_offerings` (query, budget, deadline).
  - `request_quote`: runs the real quote request path, which creates the project and emails the client link and the team notice.
  - `list_my_projects` and `get_project`, each result ending with the next step.
  - `request_changes`, visible to the model.
  - `accept_quote` and `accept_delivery`, app-only and destructive. They require a confirmation token (HMAC over the action, the user, the project and the quote or delivery, 15 minutes) that `get_project` puts in the result's `_meta`. ChatGPT documents `_meta` as hidden from the model; Claude does not document it, so the token is also bound to the user and the target and redeemable only through an app-only tool.
  - A forged token is refused, and a real one accepted the quote (tested with the scripted client).
- **Identity:** the client is the signed-in user's verified email matching the project's client email, and never a member of the seller's workspace. Run C replaces this with run A2's contacts and `perform`.
- **Server instructions:** the cross-tool flow and the rules on commitments and pay links.
- **Widget** (`ui://payleor/app-v3`), one app for every tool:
  - Offerings show as a carousel with one call to action that asks in the chat. Project cards have at most two actions plus the project page link.
  - Colors, fonts and radii come from the host's style variables (`applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts`) with fallbacks, on a transparent background. Loading shows a skeleton.
  - After a widget action, `updateModelContext` tells the model what the user did.
  - The pay button uses `window.openai.openExternal` when present, else `ui/open-link`.
  - Screenshots from a test host: [`s-connector-v2-offerings-light.png`](plans/evidence/s-connector-v2-offerings-light.png), [`s-connector-v2-deposit-dark.png`](plans/evidence/s-connector-v2-deposit-dark.png), [`s-connector-v2-delivered-light.png`](plans/evidence/s-connector-v2-delivered-light.png).
- **Plugin** (`plugins/payleor/` on the branch, zipped as `payleor-plugin.zip`):
  - The Claude manifest (`.claude-plugin/plugin.json`, `.mcp.json`) and the portable agent-plugins manifest (`plugin.json`, `mcp.json`), which ChatGPT reads.
  - The skill `hire-a-professional`: when to use Payleor, the eight-step flow, the rules. Its `reference.md` covers roles, offerings, statuses, payments (the deposit is half the quote plus any management fee), deliveries and emails.
- **Listing policy risk:**
  - Claude's directory does not accept connectors that "transfer money".
  - ChatGPT's plugin guidelines allow commerce only for physical goods (read literally, no services).
  - Payleor never moves money in the chat (payment happens on our pay page, approved in PayPal), but public directory listings may still be refused. Custom connectors, uploaded plugins and developer mode are not affected, which is what judges use.
  - **Correction after checking precedent:** OpenAI publishes service marketplaces with external payment. Airtasker's ChatGPT plugin (Aug 2026) lets clients post a task, compare offers and hire in the chat, with "Payments … handled through Airtasker" and redirects for wallet top-ups. Fiverr's app showed up in Mouhamed's session. So the "physical goods only" rule reads as no selling through in-chat checkout, and Payleor's pay page fits the external checkout pattern.
- **Claude plugin test** (Mouhamed, 2026-10-14 20:53, plugin uploaded as a zip, project `70202b60` created):
  - Unprompted "find me a logo refresh under $350": the skill loaded, the carousel rendered (one card, Walk Crew's $150 Logo refresh), and Claude recommended it in a few sentences.
  - The card's Request a quote button sent the follow-up message; Claude asked three brief questions, filled the rest from its memory of the user's company, showed the brief and asked "Shall I send this to Walk Crew?" before calling `request_quote`. The project card (Quoting, Refresh, Open project page) rendered after the call, and the client email went out.
  - Problems, fixed on the branch in `ad55768`: Claude told the user to share the current logo files on the project page, which has no client upload (the tool and skill now say to put file links in the brief); the button's message showed the raw offering id; the card's status text said "Check again later with get_project". Ids now go through `updateModelContext`, and the widget URI moved to `app-v4`.
  - Second session (21:22–21:24): "check if i received quotes for my logo refresh" listed both Logo refresh projects and opened them. Mouhamed pressed Pay on the $90 deposit, paid in the new tab and pressed Check payment; the same card switched to In progress (webhooks at 21:24:10). Pay through `ui/open-link` and refresh-after-pay work in Claude ([`s-connector-v2-claude-paid.png`](plans/evidence/s-connector-v2-claude-paid.png)).
  - Problems, fixed in `2361420`: Claude's reply still said to pay the deposit, because a refresh from the card does not reach the model (a status change on refresh now calls `updateModelContext`); the two projects had the same title and no other detail (rows now show the request date and the start of the brief, and the text gives the card's order). Widget URI now `app-v5`.
  - Claude's short progress lines appeared in French (the account's language) while the replies were in English: host behaviour, nothing for us.
- **Agentic commerce in the clients:**
  - ChatGPT's Instant Checkout (ACP, with Stripe; PayPal through Braintree "Agent Ready") is "available only to select marketplace partners", for physical goods.
  - OpenAI's "Get Quote" spec for local services is a partner-only beta: a fixed `request_service` tool, opened in a modal from a business card fed by a business feed with addresses.
  - Neither is open to Payleor before judging. Payleor's agentic commerce story is the full service hire by an agent with a person approving every payment in PayPal, plus AI sellers on the public API (program §1, §5). ACP, UCP and Store Sync belong to the dormant Commerce product ([`research.md`](research.md) §3).

## Run C scope notes

- **Projects:** `show_quote` without a project id shows walk-crew's newest project with a pending payment, so ChatGPT got "Landing page design" after the "Logo refresh" deposit was paid, and noticed it did not match the offering it had found. In run C, tools resolve projects from the signed-in client's own contacts (run A2), and requesting an offering creates the project the quote belongs to.

- **Seller questions** (Mouhamed, 2026-10-14): besides quoting, a seller can ask the client questions or open a private channel beside the request's public thread (`../BACKLOG.md`). In the plugin, a request with open questions needs its own state: the card shows the questions, the model helps the user answer, and an answer tool sends the reply. The skill's "no messages" rule changes when this lands.

- **Widget design:** the spike widgets are deliberately bare (white cards, system fonts, no theming). Mouhamed expects a better UI and UX inside the chat clients: themed to the host's light and dark context (`onhostcontextchanged`), clearer states, and a design pass once the flows work. Functionality comes first; the design pass is part of run C.

## Setup chosen for run C

- **Registration:**
  - CIMD first, through `cimd({ metadataProfile: "mcp-2026-07-28" })` with an allowlisted Workers transport (`claude.ai`, `chatgpt.com`, refusing redirects).
  - DCR stays on as a rate-limited fallback.
  - Accept `none` and `private_key_jwt` client authentication. Claude uses the first, ChatGPT the second.
- **Hosts:**
  - The authorization server follows `BETTER_AUTH_URL` (the admin host, `dash.` after run H).
  - The MCP resource is `https://api.{platform}/mcp`.
  - The web Worker forwards the OAuth discovery paths.
  - Login and consent are our own pages: `oauthProviderClient()` in the web auth client, the sign-in form following the continuation, and a designed consent page showing the client's name.
- **Tokens:**
  - JWT access tokens bound to the resource, checked with `requireMcpAuth` against `{issuer}/jwks`. `sub` is the Payleor user id, and `azp` is the AI client.
  - Run C maps the user to a client contact (run A2) before any tool reads a project.
- **Transport:**
  - `createMcpHandler(factory, { legacy: "stateless" })` serves both protocol eras.
  - The database client must outlive streamed responses: buffer the response or close the client when the stream ends.
- **Widgets:**
  - MCP Apps resources (`text/html;profile=mcp-app`) with `_meta.ui.csp`.
  - Serve the bridge from our own origin or bundle it, instead of unpkg.
  - Theme to the host context.
  - Check `getUiCapability` and keep the text content complete, so hosts without widgets still work.
- **Pay hand-off:** a widget button calls `app.openLink` with the signed `/pay/{token}` URL. The person pays on our page with the PayPal popup, and the model never needs the link.
- **Commitments:**
  - Accepting a quote or a delivery is an app-only tool, called by a widget button.
  - Hiding the tool is a host promise, not a boundary, so the commit tool also requires a short-lived confirmation nonce. The widget-rendering tool issues the nonce, bound to the project, the quote version and the user. The commit tool consumes it once.
  - Agents and API keys still cannot accept as the client (action catalog design).

## Go or no-go

- **Claude: go** (provisional, pending the model-refusal check). Sign-in through CIMD works, both widgets render, the pay page opens from a widget button and the payment was captured, and the widget calls the app-only tool.
- **ChatGPT: go for widgets and app-only tools.** Evidence: [`plans/evidence/s-spike-chatgpt-session.png`](plans/evidence/s-spike-chatgpt-session.png), from 2026-10-14.
  - It registered through CIMD with `private_key_jwt`, ran on protocol 2026-07-28, and rendered both widgets ("Payleor offerings" and "Your quote" with its two buttons).
  - **Accept (test)** called the app-only tool from the widget: the server logged `accept_quote_spike` for project `42c6962f…` at 16:48:20, and the widget showed `accept_quote_spike answered: {"ok":true}`.
  - The pay page from ChatGPT's widget: (to fill in).
- **ChatGPT's behavior, in Mouhamed's words "lost":**
  - It mixed Fiverr's published app results with Payleor's, and drew its own cards for the $150 "Logo refresh" offering, including a "Request the $150 quote" button.
  - It then said that Payleor's project creation and quote requests "aren't exposed in connected tools". It searched `find_offerings` again with the whole brief as the query (16:49:24), and ended with a written brief for the user to submit by hand.
  - So the model wants a request tool. Without one, it improvises.
  - Run C must expose the full path as tools: request an offering (which creates the project and the request), the status of my projects, show my quote, then widget buttons to accept and pay. The text results must say what the next step is.
