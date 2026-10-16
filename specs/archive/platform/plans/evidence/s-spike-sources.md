# Spike sources: MCP clients (Claude, ChatGPT), MCP Apps, MCP SDK v2

Collected 2026-10-14. Every fact lists the source URL and the version or date seen. "npm tarball" means the
published package was unpacked under /tmp and its `.d.mts`/`.mjs` files were read directly.

## Summary and recommendations for Payleor

Setup: Worker (Hono) MCP resource at `https://api.payleor.com/mcp`, Better Auth 1.7.7 authorization server at
`https://admin.payleor.com/api/auth`.

1. **Serve the 2025 protocol era. Do not use `legacy: "reject"`.** The `@better-auth/mcp` 1.7.7 README tells
   you to use `createMcpHandler(factory, { legacy: "reject" })`, which serves only MCP 2026-07-28. Claude's
   connector docs only mention the 2025-03-26, 2025-06-18 and 2025-11-25 authorization specs. Neither Claude
   nor ChatGPT documents 2026-07-28 support. Use `createMcpHandler(factory, { legacy: "stateless" })`, which is
   also the default. It answers `initialize`-based traffic statelessly for protocol versions 2025-11-25,
   2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07, and it serves 2026-07-28 envelope traffic on the same
   endpoint. Pass the verified token as `handler.fetch(request, { authInfo })`.
2. **Registration: advertise both CIMD and DCR, and expect CIMD to be used.**
   - Claude uses CIMD only when the authorization server metadata has both
     `client_id_metadata_document_supported: true` and `"none"` in `token_endpoint_auth_methods_supported`.
     Otherwise it falls back to DCR (`registration_endpoint`).
   - ChatGPT prefers CIMD when it is advertised, but the person creating the connector can pick DCR.
   - Claude's hosted CIMD `client_id` is `https://claude.ai/oauth/mcp-oauth-client-metadata`, and its
     `redirect_uris` value is `["https://claude.ai/api/mcp/auth_callback"]`.
   - ChatGPT's CIMD `client_id` is a per-connector URL of the form `https://chatgpt.com/oauth/.../client.json`.
     Its redirect is `https://chatgpt.com/connector/oauth/{callback_id}`.
   - Recommended: `cimd({ metadataProfile: "mcp-2026-07-28" })`, which requires `client_name` and
     `redirect_uris`; Claude's document has both. Keep DCR enabled as a fallback, because `@better-auth/mcp`
     disables DCR unless you turn it on.
   - **Risk:** `fetchClientMetadataResource` from `@better-auth/cimd/node` imports `node:dns/promises`,
     `node:https` and `node:net`. If admin.payleor.com runs on a Worker, check `nodejs_compat` support, or
     write a fetcher that meets the documented guarantees: resolve once, reject special-use IPs, refuse
     redirects.
3. **Cross-host authorization server is fine.** Both clients follow RFC 9728 `authorization_servers`. Claude uses
   only the first entry and needs a `401` that carries
   `WWW-Authenticate: Bearer resource_metadata="..."`. Serve the protected resource metadata at
   `https://api.payleor.com/.well-known/oauth-protected-resource/mcp`, and set `resource` to
   `https://api.payleor.com/mcp`.
4. **Widget bridge loading: use the ESM bundle, not UMD.** `@modelcontextprotocol/ext-apps` 2.0.3 ships
   `dist/src/app-with-deps.js`. It is a self-contained ES module (418 KB, no imports, exports `App`) and is
   available on unpkg and jsDelivr. No UMD or IIFE build exists. A plain-HTML widget loads it with
   `<script type="module">import { App } from "https://.../app-with-deps.js"`, which requires the CDN origin
   in `_meta.ui.csp.resourceDomains`. Alternatives are to serve it from our own origin (and list only that
   origin) or to inline it. Claude's docs recommend own-origin or inline for production.
5. **Pay button:** call `app.openLink({ url })` (`ui/open-link`), not `window.open`, because the sandbox blocks
   it. Claude always shows an "Open external link" confirmation for custom connectors. Only directory listings
   with "Allowed link URIs" skip it. ChatGPT supports the MCP Apps spec. Its own `window.openai.openExternal`
   needs `_meta["openai/widgetCSP"].redirect_domains` for trusted targets.
6. **Widget-only tool:** set `_meta.ui.visibility: ["app"]`.
   - The spec requires hosts to hide such tools from the model and to reject app calls to tools that lack
     `"app"`.
   - ChatGPT documents `_meta.ui.visibility` directly.
   - Anthropic's official build-mcp-app skill says `["app"]` hides the tool from Claude's tool list.
   - **The server must still authorize the call.** Visibility is a host-side filter, and any token holder
     can call the tool directly.
   - For older ChatGPT behaviour, optionally also set `"openai/widgetAccessible": true` and
     `"openai/visibility": "private"`.

## 1. Claude custom connectors

| Fact | Source (seen 2026-10-14) |
| --- | --- |
| Custom connectors (remote MCP) are available on Free, Pro, Max, Team and Enterprise. Free accounts are limited to one. On Team and Enterprise, Owners add the connector (on Enterprise, also custom roles with "Manage access to Libraries"), then each user connects individually. | https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp ; https://claude.com/docs/connectors/custom/add-unlisted |
| Supported auth types: `oauth_dcr` (RFC 7591, default), `oauth_cimd` (default), `oauth_anthropic_creds`, `custom_connection`, `static_headers` (beta), `none`. | https://claude.com/docs/connectors/building/authentication |
| CIMD is selected only if the AS metadata has `"client_id_metadata_document_supported": true` and `"none"` in `token_endpoint_auth_methods_supported`. Otherwise Claude falls back to DCR. The Add-connector dialog offers "Use Claude's published identity" (CIMD, recommended), "Register automatically" (DCR) or "Use your own OAuth client". | https://claude.com/docs/connectors/building/authentication ; https://claude.com/docs/connectors/custom/add-unlisted |
| Hosted redirect URI: `https://claude.ai/api/mcp/auth_callback`. Claude Code uses a loopback redirect, so accept `http://localhost/callback` and `http://127.0.0.1/callback` with the port ignored. | https://claude.com/docs/connectors/building/authentication |
| Hosted CIMD document, fetched live: `{"client_id":"https://claude.ai/oauth/mcp-oauth-client-metadata","client_name":"Claude","client_uri":"https://claude.ai","redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"grant_types":["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:jwt-bearer"],"response_types":["code"],"token_endpoint_auth_method":"none"}`. The URL is not printed in the docs; it was found by probing and returned HTTP 200. | https://claude.ai/oauth/mcp-oauth-client-metadata |
| Claude Code CIMD: `https://claude.ai/oauth/claude-code-client-metadata` (portless loopback `redirect_uris`, `token_endpoint_auth_method: "none"`). | URL fetched live; https://github.com/anthropics/claude-code/issues/37747 |
| Claude "follows the 2025-03-26, 2025-06-18, and 2025-11-25 authorization specifications". Transport: Streamable HTTP, with legacy HTTP+SSE still supported. Unsupported: resource subscriptions, sampling, "advanced or draft capabilities". | https://claude.com/docs/connectors/building |
| The Claude quickstart server is stateless Streamable HTTP (`sessionIdGenerator: undefined`, POST only, GET/DELETE return 405), so stateless serving works with Claude. | https://claude.com/docs/connectors/building/mcp-apps/quickstart |
| Cross-host AS: Claude reads protected resource metadata from the MCP server and then runs discovery against the host in `authorization_servers`. It uses only the first entry. It tries `/.well-known/oauth-authorization-server` first, then `/.well-known/openid-configuration`. | https://claude.com/docs/connectors/building/authentication |
| A `401` is required to start sign-in. A `WWW-Authenticate` header on a `200` is ignored. The `resource_metadata` URL may be on any HTTPS origin. Without it, Claude probes `/.well-known/oauth-protected-resource/<path>` and then the root form. | https://claude.com/docs/connectors/building/authentication |
| Claude sends `resource` = the full MCP URL including the path. The token endpoint must accept `application/x-www-form-urlencoded`. DCR `/register` uses JSON. Refresh tokens should rotate for public clients, and an invalid refresh token must return `invalid_grant`. | https://claude.com/docs/connectors/building/authentication |
| Timeouts: 10 s for discovery, registration and token endpoints, and 30 s for refresh. Egress IP range: `160.79.104.0/21`. Tool results are limited to about 150,000 characters, and tool calls time out after 240 s (claude.ai and Desktop). | https://claude.com/docs/connectors/building/authentication ; https://claude.com/docs/connectors/building |

## 2. Claude MCP Apps

| Fact | Source |
| --- | --- |
| Claude (web, Desktop, mobile) renders MCP Apps: tool `_meta.ui.resourceUri` → `ui://` resource with mimeType `text/html;profile=mcp-app`. The first render asks the user to Allow or Always allow. Claude Code does not render the UI. | https://claude.com/docs/connectors/building/mcp-apps/getting-started ; .../quickstart |
| CSP: all external origins are blocked by default. Declare them on the resource content with `_meta.ui.csp` = `{ connectDomains, resourceDomains, baseUriDomains }`. `frameDomains` is restricted in Claude pending security review. | https://claude.com/docs/connectors/building/mcp-apps/design-guidelines |
| By default the frame only runs inline or same-origin scripts. The quickstart adds `resourceDomains: ['https://unpkg.com']` to load `App`. For production, use your own origin or bundle the script. | https://claude.com/docs/connectors/building/mcp-apps/quickstart |
| Sandbox origin: `{sha256(connectorUrl)[0:32]}.claudemcpcontent.com`. Setting `_meta.ui.domain` is optional and must match exactly (hash of `https://api.payleor.com/mcp`, with no trailing slash). Requests from the app carry that `Origin`, and iOS omits `Referer`. | https://claude.com/docs/connectors/building/mcp-apps/getting-started ; .../troubleshooting |
| `ui/open-link`: Claude shows an "Open external link" modal, and the link opens in a new tab after confirmation. Custom and local connectors always show the modal. Directory connectors can declare "Allowed link URIs" (HTTPS origins or owned custom schemes), but the modal is skipped only after a real user gesture. A successful response does not prove the tab opened. | https://claude.com/docs/connectors/building/mcp-apps/external-links ; https://claude.com/docs/connectors/building/submission |
| `visibility: ["app"]` on a tool "hides a widget-only helper tool ... from Claude's tool list". `app.openLink({url})` is used because "sandbox blocks `window.open`". | https://github.com/anthropics/claude-plugins-official/blob/HEAD/plugins/mcp-server-dev/skills/build-mcp-app/SKILL.md |
| Display modes: `inline`, `fullscreen` and `pip` via `ui/request-display-mode`. On mobile, apps render in a native WebView. | https://claude.com/docs/connectors/building/mcp-apps/design-guidelines |

## 3. ChatGPT (developer mode / Apps SDK)

| Fact | Source |
| --- | --- |
| Developer mode is available to Pro, Plus, Business, Enterprise and Education accounts on the web: Settings → Security and login → Developer mode, then create an app from the MCP server under Plugins (+). Supported transports: SSE and streaming HTTP. | https://developers.openai.com/api/docs/guides/developer-mode |
| Business: only admins and owners can use developer mode and publish. Enterprise/Edu: admins grant access through RBAC (Permissions & Roles → Connected Data), and users toggle it in Settings → Apps → Advanced. The help center says Pro users get "read/fetch" only and full MCP (write) is limited to Business, Enterprise and Edu. This conflicts with the developer guide; see the gaps below. | https://help.openai.com/en/articles/12584461 |
| Client registration: CIMD, DCR, or a predefined client, all with PKCE S256. ChatGPT "prioritizes CIMD when it is available, but the connector creator can choose DCR". CIMD supports `none` and `private_key_jwt`. Its `client_id` looks like `https://chatgpt.com/oauth/.../client.json` and is specific to each MCP server. | https://developers.openai.com/apps-sdk/build/auth ; https://developers.openai.com/api/docs/guides/custom-mcp-server |
| Redirect: `https://chatgpt.com/connector/oauth/{callback_id}` (shown on the app management page). The legacy `https://chatgpt.com/connector_platform_oauth_redirect` still works for published apps. | https://developers.openai.com/apps-sdk/build/auth |
| ChatGPT sends `resource=<PRM resource>` on both authorize and token requests, and tries each `authorization_servers` entry. Tool-level auth UI needs `securitySchemes` (`noauth` / `oauth2`) and an error result with `_meta["mcp/www_authenticate"]`. | https://developers.openai.com/apps-sdk/build/auth |
| "ChatGPT is now fully compatible with the MCP Apps spec" (changelog entry dated 2026-02-22). Recommended pattern: `_meta.ui.resourceUri` plus the `ui/*` bridge. `window.openai` is an optional extension, and `_meta["openai/outputTemplate"]` and `text/html+skybridge` are compatibility aliases. | https://developers.openai.com/apps-sdk/changelog ; https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt |
| Tool `_meta`: `ui.visibility` (string[], default `["model","app"]`). `openai/widgetAccessible` (bool, default false) and `openai/visibility` (`public`/`private`) are compatibility fields with "prefer `_meta.ui.visibility`". | https://developers.openai.com/apps-sdk/reference |
| Resource `_meta`: `ui.csp` {`connectDomains`, `resourceDomains`, `frameDomains?`}, `ui.domain` (required for submission; default `https://web-sandbox.oaiusercontent.com`), `ui.prefersBorder`. `openai/widgetCSP.redirect_domains` is still required for trusted `window.openai.openExternal({ href, redirectUrl })`, and `redirectUrl: false` stops `?redirectUrl=` from being appended. | https://developers.openai.com/apps-sdk/reference |
| Approval-gated tools: tool input arrives through `ui/notifications/tool-input` after approval (changelog entry dated 2026-05-27). | https://developers.openai.com/apps-sdk/changelog |

## 4. MCP Apps spec and `@modelcontextprotocol/ext-apps`

| Fact | Source |
| --- | --- |
| SEP-1865 "MCP Apps", **Status: Stable (2026-01-26)**. Extension id `io.modelcontextprotocol/ui`. The client advertises `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes: ["text/html;profile=mcp-app"]`. The spec's example uses protocolVersion `2024-11-05`, so it works with 2025-era initialize. | https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx (raw fetched) |
| Resource rules: the URI MUST be `ui://...`. The mimeType MUST be `text/html;profile=mcp-app`. If `ui.csp` is omitted, the default CSP is `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'`. The host MUST NOT allow undeclared domains. | same, lines ~265-290 |
| Visibility: default `["model","app"]`. The host MUST NOT list tools without `"model"` to the agent, and MUST reject app `tools/call` for tools without `"app"`. App-only tools are callable only from the same server connection. | same, "Visibility" section |
| Bridge methods (`ui/*` names from the 2.0.3 bundle): requests `ui/initialize`, `ui/open-link` (params `{url}`, empty result or error), `ui/message`, `ui/update-model-context`, `ui/request-display-mode`, `ui/download-file`, `ui/resource-teardown`. Notifications: `ui/notifications/initialized`, `tool-input`, `tool-input-partial`, `tool-result`, `tool-cancelled`, `size-changed`, `host-context-changed`, `request-teardown`, and `sandbox-proxy-ready`/`sandbox-resource-ready` (host-internal). Standard MCP calls `tools/call` and `resources/read` are also proxied from the app. | npm tarball @modelcontextprotocol/ext-apps@2.0.3 `dist/src/spec.types.d.ts`, `app.js` |
| npm: `@modelcontextprotocol/ext-apps` latest = **2.0.3** (published 2026-09-25; dist-tags `latest` and `release-2.0` are both 2.0.3). 2.0.0 was published 2026-09-08. Peer deps: `@modelcontextprotocol/server ^2.0.0` (optional), `@modelcontextprotocol/client`/`core ^2.0.0`, `zod ^4.2.0`. The 1.x line (1.7.5) pairs with SDK 1.x, which is what Claude's quickstart uses. | `npm view` run 2026-10-14; tarball package.json |
| Exports: `.` (App, ESM), `./app-with-deps` (self-contained), `./react`, `./app-bridge` (host side), `./server`. The server exports `registerAppTool(server, name, config, cb)`, `registerAppResource(server, name, uri, config, readCb)`, `RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"`, `RESOURCE_URI_META_KEY = "ui/resourceUri"` (legacy flat key, which `registerAppTool` also writes), `EXTENSION_ID`, and `getUiCapability(clientCapabilities)`. | tarball `dist/src/server/index.d.ts`, `constants.d.ts` |
| `App` API: `new App({name, version}, caps?, {autoResize})`, `connect(transport?)` (auto-detects the host), `callServerTool({name, arguments})`, `openLink({url})`, `sendMessage`, `updateModelContext`, `requestDisplayMode`, `downloadFile`, `readServerResource`, `getHostContext`, and setters `ontoolinput`, `ontoolinputpartial`, `ontoolresult`, `ontoolcancelled`, `onhostcontextchanged`, `onteardown`. Set the handlers before calling `connect()`. | tarball `dist/src/app.d.ts`; https://claude.com/docs/connectors/building/mcp-apps/troubleshooting |
| CDN: `https://unpkg.com/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js` (HTTP 200) and `https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js` (HTTP 200, ACAO `*`). The file is ESM only (`export {..., OO as App}`) with no static or dynamic imports. No UMD build exists. | curl 2026-10-14; tarball |

Minimal plain-HTML widget (adapted from the Claude quickstart, version bumped to 2.0.3):

```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div id="summary">Loading…</div><button id="pay" disabled>Pay with PayPal</button>
<script type="module">
  import { App } from "https://unpkg.com/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js";
  const app = new App({ name: "Payleor Invoice", version: "1.0.0" });
  let payUrl;
  app.ontoolresult = ({ structuredContent: sc }) => {
    payUrl = sc?.payUrl; document.getElementById("summary").textContent = sc?.label ?? "";
    document.getElementById("pay").disabled = !payUrl;
  };
  document.getElementById("pay").onclick = () => app.openLink({ url: payUrl });   // ui/open-link
  // App-only tool (visibility ["app"]): app.callServerTool({ name: "refresh_invoice", arguments: {...} })
  await app.connect();
</script></body></html>
```

The resource content must set `mimeType: RESOURCE_MIME_TYPE` and
`_meta: { ui: { csp: { resourceDomains: ["https://unpkg.com"] } } }`, or use our own origin.

## 5. MCP TypeScript SDK v2 (`@modelcontextprotocol/server`)

| Fact | Source |
| --- | --- |
| Latest is **2.3.1** (published 2026-10-05). 2.0.0 was published 2026-07-27. `@modelcontextprotocol/core` is also 2.3.1. The v1 package `@modelcontextprotocol/sdk` is at 1.32.1. | `npm view` 2026-10-14 |
| `createMcpHandler(factory: (ctx: {era, authInfo?, requestInfo?}) => McpServer \| Server, options?)` returns `{ fetch(request, { authInfo?, parsedBody? }), close, notify, bus }`, which is the shape Workers expect from `export default`. `authInfo` is passed through as-is: the handler does not verify tokens. | tarball `dist/createMcpHandler-*.d.mts` |
| `legacy?: 'stateless' \| 'reject'`. **Default is `'stateless'`**: each 2025-era request gets a fresh instance over a streamable HTTP transport with `sessionIdGenerator: undefined`, and GET/DELETE return 405. `'reject'` is modern-only and returns an unsupported-protocol-version error. Other options: `responseMode` (`auto`/`sse`/`json`, which applies to modern traffic only), `maxRequestBodySize` (4 MiB), `keepAliveMs`, `onerror`. Also exported: `isLegacyRequest(request)` and `legacyStatelessFallback(factory)` for custom routing. | same |
| Legacy (`initialize`) versions supported: `SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25","2025-06-18","2025-03-26","2024-11-05","2024-10-07"]`, `LATEST_PROTOCOL_VERSION = "2025-11-25"` (legacy era). The modern era is `2026-07-28`, using a per-request `_meta` envelope and `server/discover`. | tarball @modelcontextprotocol/core@2.3.1 `dist/auth-*.mjs` |
| `WebStandardStreamableHTTPServerTransport` is still exported (`sessionIdGenerator?`, `enableJsonResponse?`) for manual Fetch-API wiring. | tarball `dist/index.d.mts` |
| Workers: the package has a `workerd` export condition (`./_shims`) that makes `CfWorkerJsonSchemaValidator` the default JSON-schema validator (no Ajv `eval`). It is also exported at `@modelcontextprotocol/server/validators/cf-worker`. | tarball package.json, `shimsWorkerd.d.mts` |

Worker sketch (types verified, not executed):

```ts
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
const mcp = createMcpHandler(({ authInfo }) => buildServer(authInfo), { legacy: "stateless" });
app.post("/mcp", async (c) => mcp.fetch(c.req.raw, { authInfo: await verifyBearer(c) /* 401 + WWW-Authenticate if absent */ }));
```

## 6. Better Auth 1.7.7 (context for the recommendations)

| Fact | Source |
| --- | --- |
| `@better-auth/mcp` 1.7.7 and `@better-auth/cimd` 1.7.7 were both published 2026-09-30. | `npm view` |
| `mcp()` serves RFC 9728 PRM with `authorization_servers: [issuer]`. "Dynamic Client Registration is disabled unless explicitly enabled." The README tells you to compose with `cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" })` and to use `createMcpHandler` with `legacy: "reject"`. **Do not use `"reject"`; see recommendation 1.** | tarball README + `dist/index.mjs` |
| `cimd()` advertises `client_id_metadata_document_supported: true`. The `mcp-2026-07-28` profile rejects documents that lack `client_name` or `redirect_uris`. `fetchClientMetadataResource` is required, and the only shipped implementation (`@better-auth/cimd/node`) uses `node:dns/promises`, `node:https` and `node:net`. | tarball `@better-auth/cimd` `dist/index.mjs`, `node.mjs`, `index.d.mts` |

## Not confirmed

- **Claude's negotiated `protocolVersion`:** no primary source says what Claude sends in `initialize`, or whether it
  supports 2026-07-28. The docs only list the 2025 authorization specs. Verify by logging `initialize` from a real
  connection.
- **Claude's web CIMD URL** (`https://claude.ai/oauth/mcp-oauth-client-metadata`): found by probing, not documented.
  It could change.
- **ChatGPT's CIMD document:** the exact URL and contents (`client_name`, `redirect_uris`, whether JWKS is used) are
  per-connector and not published. Check that it passes the `mcp-2026-07-28` profile when we test.
- **ChatGPT `ui/open-link`:** support is implied by "fully compatible with the MCP Apps spec" (2026-02-22), but the
  OpenAI reference documents only `openExternal` for links and does not say whether a confirmation prompt is shown.
- **ChatGPT plan scope:** the developer guide says Plus and Pro can use developer mode. The help center says Pro
  gets only read/fetch MCP, with write limited to Business, Enterprise and Edu. These conflict.
- **`openai/visibility` deprecation date:** a secondary source (agentcat.com) says it was deprecated on 2026-07-21.
  The OpenAI changelog crawl only reached 2026-05-28, so this was not confirmed in a primary source.
- **Claude honouring `visibility: ["app"]`:** the evidence is Anthropic's official skill file, not the claude.com
  docs.
