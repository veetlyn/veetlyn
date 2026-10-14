# Connector UX/UI guidelines evidence (Claude, ChatGPT, MCP Apps spec)

Collected 2026-10-14 from primary sources only. Each fact cites a source key; the key table below gives the URL.

| Key | URL |
| --- | --- |
| C-DG | https://claude.com/docs/connectors/building/mcp-apps/design-guidelines |
| C-THEME | https://claude.com/docs/connectors/building/mcp-apps/transparent-theming |
| C-LINK | https://claude.com/docs/connectors/building/mcp-apps/external-links |
| C-TS | https://claude.com/docs/connectors/building/mcp-apps/troubleshooting |
| C-SUPER | https://claude.com/docs/connectors/building/mcp-apps/instance-supersession |
| C-GS | https://claude.com/docs/connectors/building/mcp-apps/getting-started |
| C-REV | https://claude.com/docs/connectors/building/review-criteria |
| C-SUB | https://claude.com/docs/connectors/building/submission |
| C-SRV | https://claude.com/docs/connectors/building/index |
| C-PLUG | https://claude.com/docs/plugins/build |
| O-UI | https://developers.openai.com/plugins/concepts/ui-guidelines (old /apps-sdk/concepts/ui-guidelines now serves this) |
| O-ADDUI | https://developers.openai.com/plugins/build/chatgpt-ui |
| O-SRV | https://developers.openai.com/plugins/build/mcp-server |
| O-TOOLS | https://developers.openai.com/plugins/plan/tools |
| O-REF | https://developers.openai.com/plugins/reference |
| O-META | https://developers.openai.com/plugins/guides/optimize-metadata |
| O-GL | https://developers.openai.com/plugins/plugin-guidelines |
| O-REVIEW | https://developers.openai.com/plugins/deploy/app-review |
| O-PKG | https://developers.openai.com/plugins/build/plugins |
| O-TEST | https://developers.openai.com/plugins/deploy/connect-chatgpt |
| O-SEC | https://developers.openai.com/plugins/guides/security-privacy |
| O-QUOTE | https://developers.openai.com/plugins/guides/local-services-request-quote-conversion-spec |
| S-APPS | https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx |
| S-PAT | https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/patterns.md |
| S-MIG | https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/migrate_from_openai_apps.md |
| S-PKG | https://unpkg.com/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js (and `/package.json`, `/dist/src/app.d.ts`) |
| S-MCP | https://modelcontextprotocol.io/specification/2025-11-25/schema (InitializeResult.instructions) |
| S-DISC | https://modelcontextprotocol.io/specification/2026-07-28/server/discover |
| S-TOOLS | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| S-BLOG | https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/ |
| A-TOOLS | https://www.anthropic.com/engineering/writing-tools-for-agents |

## Rules for Payleor

1. [Both] One widget = one job. Inline cards hold at most 2 actions at the bottom (1 primary + 1 optional secondary), at most 4-5 data points, no tabs, drill-ins, breadcrumbs, or multiple views. (C-DG, O-UI)
2. [Both] No nested scrolling inline: the card auto-fits its height. Anything needing its own scroll area goes fullscreen through `ui/request-display-mode`. The host caps inline height and clips overflow; on mobile, vertical pans go to the conversation. (C-DG, O-UI)
3. [Both] Offerings search results: inline carousel with 3-8 items, consistent card size, image + title + up to 3 lines of metadata + 1 optional CTA per card. (C-DG, O-UI)
4. [Both] No dropdowns, context menus, or popovers. Use segmented buttons, toggle chips, or inline options. (C-DG)
5. [Both] Do not rebuild chat: free text, "request changes" wording, clarifying questions, and "redo/refine" go through the chat composer. Confirming a prepared action ("Accept quote", "Accept delivery") belongs in the widget. (C-DG, O-UI)
6. [Both] Keep `html, body { background: transparent }` and add `<meta name="color-scheme" content="light dark">`. Style every structural colour (background, text, border, icon) with host variables plus fallbacks. Brand colour only on accents and the primary button. No gradients or custom patterns. (C-THEME, C-DG, O-UI)
7. [Spec] On connect and on every `hostcontextchanged`, call `applyDocumentTheme(ctx.theme)`, `applyHostStyleVariables(ctx.styles.variables)`, and `applyHostFonts(ctx.styles.css.fonts)`. All three are exported from `app-with-deps.js` in 2.0.3. (C-THEME, S-PKG)
8. [Claude] To load Anthropic Sans through `applyHostFonts`, add `https://assets.claude.ai` to `_meta.ui.csp.resourceDomains`. Use `var(--font-sans, system-ui, sans-serif)`. [ChatGPT] Use no custom fonts and inherit the system stack. (C-THEME, O-UI)
9. [Both] Typography: 3 sizes (heading, body, caption) and 2 weights (regular, emphasized). Prefer body and body-small. (C-DG, O-UI)
10. [Both] Light and dark mode are mandatory. Test both. Contrast must meet WCAG AA. Provide alt text, keyboard navigation, and text resizing without breaking the layout. (C-DG, O-UI)
11. [Both] Layout from 320px up with no fixed widths and no horizontal scrolling. Tap targets are at least 44x44pt. Apply `hostContext.safeAreaInsets` as padding. Never put controls flush against an edge, because the composer can overlay the bottom. (C-DG)
12. [Both] Loading state: a skeleton that matches the final layout, not a spinner, for inline content. (C-DG)
13. [Both] Do not show the Payleor logo or app name inside the widget, because the host already labels it. Icons are monochrome and outlined. (O-UI, C-DG)
14. [Spec] Keep `autoResize` on (the SDK default). Never report height 0, because that makes the app invisible. Call `app.connect()` after registering `ontoolresult` and the other handlers. (S-APPS, C-TS)
15. [Spec] Declare `appCapabilities.availableDisplayModes` (for example `["inline","fullscreen"]`). Check `hostContext.availableDisplayModes` before you request a mode. Handle a returned mode that differs from the one requested. (S-APPS, C-DG)
16. [Both] Set `_meta.ui.prefersBorder` explicitly on each UI resource. Use `false` for a transparent, blended look in Claude. (C-THEME, C-DG, O-REF)
17. [Both] Every tool works without UI. `content` text and `structuredContent` must let the model finish the workflow in hosts that do not render widgets. (O-ADDUI, S-APPS)
18. [ChatGPT] Split data tools from render tools. Only the render tool carries `_meta.ui.resourceUri`, and its description says "call X first". This stops ChatGPT from re-rendering iframes on every call. (O-ADDUI)
19. [Spec] Widget-only actions (for example the accept-quote button handler and the nonce fetch) are tools with `_meta.ui.visibility: ["app"]`. The host must hide them from the model's tool list and reject app calls to tools without `"app"`. (S-APPS, S-PAT)
20. [ChatGPT] Put the confirmation nonce in the tool result `_meta`. OpenAI documents result `_meta` as "Delivered only to the component. Hidden from the model." Never put it in `structuredContent`: ChatGPT shows that to the model ("the model reads them verbatim"). (O-REF, O-SRV)
21. [Spec/Claude] The spec labels `_meta` "not intended for model context". No Claude page states what Claude does with result `_meta`, so treat it as unconfirmed. Make the nonce safe even if the model sees it: single-use, short TTL, bound to quote + user, and redeemable only through an app-only tool (rule 19). (S-APPS; gap)
22. [Both] Every tool has a `title` and explicit booleans `readOnlyHint`, `destructiveHint`, `openWorldHint` (ChatGPT marks all three Required). Add `idempotentHint` where it is true. Claude requires `title` plus the applicable `readOnlyHint` or `destructiveHint`. (O-REF, O-GL, C-REV, C-SUB)
23. [Claude] Annotations drive permissions. Read-only tools can run without a per-call prompt; destructive tools always prompt. Use `readOnlyHint: true` for search_offerings, get_quote, and get_order status. (C-REV)
24. [Both] Payment, acceptance, and changes are writes, so set `readOnlyHint: false`. ChatGPT: "Being able to undo an action does not, by itself, justify setting `destructiveHint` to `false`." Irreversible sends or transactions get `destructiveHint: true`. `openWorldHint: false` fits a bounded private catalog. (O-GL, O-REVIEW)
25. [Both] Separate read and write tools. Never ship a catch-all tool with a `method` or mode parameter. Use one focused tool per user goal, with verb-based names of 64 characters or fewer and no jargon. (C-REV, O-GL, O-SRV)
26. [ChatGPT] Descriptions start with "Use this when…", state limits and disallowed cases ("Do not use for…"), and distinguish the tool from similar tools. Document each parameter with examples and enums. (O-META, O-TOOLS)
27. [Both] Descriptions must not steer the model toward other tools or plugins, pull instructions from external sources, hide instructions, or promote anything. (C-REV, O-GL)
28. [Both] Errors are actionable. Return `isError: true` with a specific message and next step. Never return a bare "Internal Server Error" or "Bad Request". (C-REV, A-TOOLS, S-PAT)
29. [Both] Return high-signal, minimal results: names over UUIDs where possible, stable IDs for follow-up calls, and no session, trace, or request IDs, timestamps, or debug payloads. Results stay under ~150,000 characters (claude.ai) and 25,000 tokens (Claude Code). (A-TOOLS, O-GL, O-REVIEW, C-SRV, C-TS)
30. [Both] Server `instructions` cover only cross-tool workflow and constraints (for example: quote -> accept in widget -> pay on pay page -> follow delivery), with the key points in the first 512 characters. Do not repeat tool descriptions, change the model's personality, or rely on instructions for security. (O-SRV, S-BLOG)
31. [Spec] After a widget action, call `app.updateModelContext({content:[…]})` so the model knows the new state (for example "Quote Q-12 accepted, deposit pending"). Each call overwrites the previous one and may be deferred to the next user turn. Use `app.sendMessage` only when a model reply is wanted now. (S-APPS, S-PAT)
32. [Claude] `ui/open-link` (`app.openLink`) shows an "Open external link" modal unless the connector is in the directory and the origin is listed under Allowed link URIs. Call it from a real click. Make the pay-page URL recognizable in the UI. A success result does not prove the tab opened. (C-LINK, C-SUB)
33. [ChatGPT] For trusted external links, ChatGPT documents `window.openai.openExternal({href})` and requires `_meta["openai/widgetCSP"].redirect_domains`, because `_meta.ui.csp` has no redirect field. Feature-detect `window.openai` and fall back to `app.openLink`. (O-REF, O-ADDUI)
34. [ChatGPT] Set `_meta["openai/toolInvocation/invoking"]` and `["openai/toolInvocation/invoked"]` (64 characters or fewer each) on tool descriptors, and `_meta["openai/widgetDescription"]` on resource contents to reduce redundant narration. These keys are ChatGPT-only; ext-apps has no equivalent. (O-REF, S-MIG)
35. [Claude] Several calls to a widget tool leave several live iframes. Supersede older instances with a server-minted `{createdAt, seq}` key in `structuredContent` and a `BroadcastChannel`. Older cards grey out and stop sending context or messages. (C-SUPER)
36. [Both] `_meta.ui.csp` lists exact origins (`connectDomains`, `resourceDomains`). Claude restricts `frameDomains`. Version the `ui://` URI on breaking HTML/JS/CSS changes; ChatGPT may cache resources for up to 1 hour. (C-DG, O-ADDUI, O-REVIEW)
37. [Claude] If loading ext-apps from unpkg, either allowlist `https://unpkg.com` in `resourceDomains` or inline the bundle. On iOS the `Referer` header is missing, so allowlist on `Origin` `*.claudemcpcontent.com`. (C-THEME, C-TS)
38. [Both] Policy risk: Claude's directory does not accept connectors that "Transfer money"; ChatGPT allows commerce only for physical goods and bans selling services via plugins, so only external checkout is allowed. Custom connectors are not reviewed. Confirm before a public listing. (C-REV, O-GL, O-ADDUI)

## 1. Claude: MCP Apps design and connector docs

- Principles: design the app as an extension of the conversation that is conversational, contextual, integrated (inherits host styling), and adaptive. (C-DG)
- Avoid: long-form static content, complex multi-step workflows beyond the display mode, deep navigation, nested scrolling, menus and popovers (clipping and z-index issues), and chat inputs that replicate Claude. (C-DG)
- Display modes: inline card, inline carousel, fullscreen; the app-declared modes are `inline`, `fullscreen`, `pip`. In fullscreen the app provides its own fullscreen button, a close button sits in the native header, the composer is always visible, and there are no floating panels (use collapsible sidebars, tabs, or pagination). (C-DG)
- Mobile: rendered in WKWebView or Android WebView, not an iframe. No camera, microphone, or location. Users must add the connector on web or desktop first. Responsive from 320px with container queries; no fixed breakpoints. (C-DG)
- `prefersBorder` default if unset: borderless on web, bordered on mobile. Borderless means edge-to-edge with no host padding, so honour `safeAreaInsets` (use `scroll-padding-inline` for carousels). (C-DG)
- CSP: all external origins are blocked by default; declare `_meta.ui.csp.{connectDomains, resourceDomains, baseUriDomains}`. `frameDomains` is restricted in Claude pending security review. (C-DG)
- Transitions: give inline -> fullscreen a clear affordance; closing returns to the same scroll position. (C-DG)
- Visual: host tokens for all structural elements, brand colours only for accents; a limited set of radii and border widths; monochrome outlined icons that support understanding rather than carry it; generous padding. (C-DG)
- Interaction split: in-app = direct manipulation, filtering or sorting shown data, expand or collapse, confirming or executing a prepared action, visualization interaction. Chat = text entry, follow-ups, modify/refine/redo, navigation to other topics, anything needing Claude's interpretation. (C-DG)
- Progressive disclosure: summary inline, detail in fullscreen. (C-DG)
- First render: "Claude asks for permission to display the app. Click Allow, or Always allow." (C-GS)
- `ui.domain` for Claude = first 32 hex characters of SHA-256(full connector URL) + `.claudemcpcontent.com`. A mismatch produces `Invalid ui.domain format` or `ui.domain mismatch`. Only needed for a stable origin (for example an app OAuth flow). (C-GS, C-TS)
- Debugging: Claude Desktop Help > Troubleshooting > Enable Developer Mode, then Cmd+Option+I; your app is the inner iframe. iOS uses Safari Web Inspector. (C-TS)
- Large results: above ~150,000 characters with the code sandbox active, Claude writes the result to a file and the app never hydrates. Paginate and fetch details through app-initiated tool calls. (C-TS)
- Submission (MCP Apps): 3-5 PNG screenshots, at least 1000px wide, cropped to the app response, prompts given separately, no video or GIF. Every tool needs a `title` plus `readOnlyHint` or `destructiveHint`, or the portal flags it. Test credentials must be for a fully populated account. (C-SUB)
- Review rejects: catch-all read/write tools; generic errors; oversized responses; collecting conversation data; querying Claude memory or chat history; descriptions with prompt-injection patterns; connectors that "Transfer money, cryptocurrency, or other financial assets". (C-REV)
- Server limits: tool call timeout of 240 s on claude.ai/Desktop. Claude does not support resource subscriptions, sampling, or "advanced or draft capabilities". (C-SRV)
- Claude docs give no "max widgets per answer" rule. Each tool call mounts its own iframe, and no host API unmounts older ones. (C-SUPER)

### Claude style variables (exact names; also the spec's `McpUiStyleVariableKey`)

From C-DG and S-APPS; Claude values use `light-dark()` (C-THEME):
- Background: `--color-background-{primary,secondary,tertiary,inverse,ghost,info,danger,success,warning,disabled}`
- Text: `--color-text-{primary,secondary,tertiary,inverse,ghost,info,danger,success,warning,disabled}`
- Border: `--color-border-{primary,secondary,tertiary,inverse,ghost,info,danger,success,warning,disabled}`
- Ring: `--color-ring-{primary,secondary,inverse,info,danger,success,warning}`
- Font: `--font-sans` ("Anthropic Sans, sans-serif"), `--font-mono`; `--font-weight-{normal 400,medium 500,semibold 600,bold 700}`
- Size: `--font-text-{xs 12,sm 14,md 16,lg 20}-size`, `--font-heading-{xs 12,sm 14,md 16,lg 20,xl 24,2xl 28,3xl 36}-size` (px)
- Line height: `--font-text-{xs,sm,md,lg}-line-height`, `--font-heading-{xs,sm,md,lg,xl,2xl,3xl}-line-height`
- Radius: `--border-radius-{xs 4,sm 6,md 8,lg 10,xl 12,full 9999}` (px); `--border-width-regular` (0.5px)
- Shadow: `--shadow-{hairline,sm,md,lg}`
- Claude's sample button: `background: var(--color-background-inverse); color: var(--color-text-inverse); font-weight: var(--font-weight-semibold); border-radius: var(--border-radius-md)`. (C-DG)

## 2. OpenAI (ChatGPT plugins, formerly Apps SDK)

- The Apps SDK docs moved under `/plugins/…`. ChatGPT implements the open MCP Apps standard; new UI should use `_meta.ui.resourceUri` and the `ui/*` bridge. `window.openai` is an optional extension; feature-detect it rather than branching on host name. Aliases: `openai/outputTemplate` -> `ui.resourceUri`, `window.openai.toolOutput` -> `ui/notifications/tool-result`, `callTool` -> `tools/call`, `sendFollowUpMessage` -> `ui/message`. (O-ADDUI)
- Inline layout: app label and icon, then the widget, then a model follow-up. "Inline surfaces currently always appear before the generated model response." The follow-up should avoid content redundant with the card. (O-UI)
- Inline card: title if document-based, Expand (fullscreen) for rich media, "Show more" for lists, at most 2 primary actions at the bottom that "perform either a conversation turn or a tool call", no deep navigation, no nested scrolling, no duplicate inputs. (O-UI)
- Carousel: 3-8 items, always an image, title, metadata (no more than 2-3 lines), optional badge, single CTA. Fullscreen: system close, composer overlaid, design for the composer. PiP: for parallel live sessions; close automatically when done. (O-UI)
- Colour: system colours for text, icons, and dividers; brand accents must not override backgrounds or text; no custom gradients or patterns; brand accent allowed on primary buttons. Typography: system fonts (SF Pro on iOS), no custom fonts even in fullscreen, limit size variation. Spacing: system grid, consistent padding, system corner radii, a clear headline -> supporting text -> CTA order. Icons: monochrome outlined; do not include your logo, because ChatGPT prepends logo and name. Accessibility: WCAG AA, alt text, text resizing. (O-UI)
- Optional `@openai/apps-sdk-ui` component library (Tailwind plus CSS variable tokens). (O-UI)
- Result visibility (O-REF): `structuredContent` is "Surfaced to the model and the component"; `content` is model and transcript; `_meta` is "Delivered only to the component. Hidden from the model." "Only `structuredContent` and `content` appear in the conversation transcript." The widget reads full `_meta` via `window.openai.toolResponseMetadata` or MCP Apps `ontoolresult` -> `params._meta`. (O-REF, S-MIG) O-SRV adds: "Treat `_meta` as hidden from the model, not as a substitute for authorization or secure storage."
- Tool descriptor `_meta` keys: `ui.resourceUri`, `ui.visibility` (default `["model","app"]`), `openai/toolInvocation/invoking` and `/invoked` (64 characters or fewer), `openai/widgetAccessible` (legacy), `openai/visibility` (legacy), `openai/fileParams`, `openai/profile`. (O-REF)
- Resource `_meta` keys: `ui.prefersBorder`, `ui.csp`, `ui.domain` (required when submitting a plugin with UI; unique per plugin), `openai/ui.availableDisplayModes`, `openai/widgetDescription` ("summary surfaced to the model when the component loads"), and `openai/widgetCSP.redirect_domains` (needed for `openExternal`). (O-REF)
- Client-sent `_meta` on calls: `openai/locale`, `openai/userAgent`, `openai/userLocation`, `openai/subject`, `openai/session`, `openai/organization` (hints, never for authorization). (O-REF)
- Widget state: `window.openai.widgetState` / `setWidgetState` (synchronous, per-instance; not a source of truth). The structured shape `{modelContent, privateContent, imageIds}` keeps `privateContent` hidden from the model. Portable alternative: `ui/update-model-context`. Business data stays on the server: the UI calls a tool, the server validates and returns an authoritative snapshot. Do not use `localStorage` for core state. (O-ADDUI)
- Locale: the host mirrors it to `document.documentElement.lang`. (O-ADDUI)
- Annotations: `readOnlyHint`, `destructiveHint`, `openWorldHint` Required; `idempotentHint` Optional. (O-REF) Explicit booleans are needed for listing; justifications are no longer required. (O-GL) A mismatched annotation is a common rejection reason. (O-REVIEW)
- Metadata: names pair domain and action; descriptions start "Use this when…" and name disallowed cases; build a golden prompt set (direct, indirect, negative); change one field at a time; aim for precision on negative prompts first. (O-META)
- Tool guidelines: unique, verb-style names; no promotional names; tools operate independently; minimal inputs (no full chat history); "Tools should be safe to retry where possible, or explicitly indicate when retries may cause repeated effects"; response minimization. (O-GL)
- Security: "Requiring human confirmation for irreversible operations"; "Use the host's confirmation prompts for destructive actions." (O-SEC)
- Commerce: "plugins may conduct commerce only for physical goods. Selling digital products or services … is not allowed"; "standard external checkout is the required approach". (O-GL)
- Related beta: the "Get Quote" local-services spec uses tool `request_service` with `ui://widget/request-service.html` in `modal` mode. Partners only. (O-QUOTE)
- Developer testing: chatgpt.com/plugins -> + -> Add custom MCP server -> URL plus auth -> "I understand and want to continue" -> Create as a plugin. Then type `@` in a new chat and pick the plugin. After metadata changes, use Refresh. (O-TEST)

### ChatGPT plugin packaging (O-PKG)

- Portable manifest: `plugin.json` at the plugin root with `"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"`, `name` (kebab-case, stable), `version`, `description`, and optional `author{name,email,url}`, `homepage`, `repository`, `license`, `keywords`.
- Skills: `skills/<skill-name>/SKILL.md` with front matter `name` and `description`, auto-discovered (no `skills` field needed).
- MCP: root `mcp.json` with `"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"` and `mcpServers.<id> = {"type":"streamable-http","url":"https://…/mcp"}`. Auth goes under `extensions["com.openai"].auth` (`type`: `none|oauth|mixed|api_key`; OAuth `client.mode`: `provided|dcr|cimd`).
- OpenAI extras: `extensions["com.openai"]` in `plugin.json` holds `apps` ("./.app.json" registered-MCP mapping to a `plugin_asdk_app…` ID), `hooks`, `onboardingSkill`, and `interface{displayName, shortDescription, longDescription, developerName, category, capabilities, websiteURL, privacyPolicyURL, termsOfServiceURL, defaultPrompt[], brandColor, composerIcon, logo, screenshots}`.
- Legacy `.codex-plugin/plugin.json` (scaffolded by `@plugin-creator`) is still supported. ChatGPT also accepts Claude-compatible manifests and reads `.claude-plugin/marketplace.json`.
- Local test: marketplace at `~/.agents/plugins/marketplace.json` or `$REPO/.agents/plugins/marketplace.json`, with entries `{name, source:{source:"local",path:"./…"}, policy:{installation, authentication}, category}`. Restart the ChatGPT desktop app and install from the Plugins Directory.
- MCP server skills can also be imported via the draft SEP-2640 (`capabilities.extensions["io.modelcontextprotocol/skills"]`, `skills/list`, `skills/get`) at submission "Scan Tools" time. (O-SRV)

### Claude plugin packaging (C-PLUG)

- `.claude-plugin/plugin.json` with `name`, `displayName`, `version`, `description`, `author`, `license`; `.mcp.json` at the root with `{"mcpServers":{"payleor":{"type":"http","url":"https://…/mcp"}}}`; `skills/<name>/SKILL.md`. Upload a zip via claude.ai Customize > Plugins > Add > Upload plugin; validate with `claude plugin validate`. Use the same server URL as the directory connector to avoid duplicate tools.

## 3. MCP Apps spec (2026-01-26) and ext-apps 2.0.3

- `hostContext` fields: `toolInfo{id, tool}`, `theme` ("light"|"dark"), `styles{variables, css{fonts}}`, `displayMode`, `availableDisplayModes`, `containerDimensions` ({height}|{maxHeight} & {width}|{maxWidth}), `locale` (BCP 47), `timeZone`, `userAgent`, `platform` ("web"|"desktop"|"mobile"), `deviceCapabilities{touch, hover}`, `safeAreaInsets{top,right,bottom,left}`. (S-APPS)
- Host capabilities: `openLinks`, `serverTools`, `serverResources`, `logging`, `sandbox{permissions, csp}`. (S-APPS)
- Sizing: a fixed `height` means fill; `maxHeight` means the view sizes itself up to the max. The SDK sends `ui/notifications/size-changed` through ResizeObserver when `autoResize` is on (the default), debounced. (S-APPS)
- Theming: hosts can pass any subset of variables; views should define fallbacks; hosts should use `light-dark()`. (S-APPS)
- Visibility: `_meta.ui.visibility` defaults to `["model","app"]`. The host MUST NOT list tools without `"model"` to the agent and MUST reject app calls to tools without `"app"`. (S-APPS)
- Result fields, per the spec's best practice: `content` is the text for the model and text-only hosts; `structuredContent` is "optimized for UI rendering (not added to model context)"; `_meta` is "not intended for model context". This conflicts with ChatGPT, which surfaces `structuredContent` to the model (O-REF). The core MCP spec says a tool returning structured content SHOULD also return serialized JSON in a TextContent block. (S-APPS, S-TOOLS)
- `ui/update-model-context` {content?, structuredContent?}: used "in future turns"; each request overwrites the previous one; the host MAY defer it to the next user message and SHOULD send only the last update. `ui/message` {role:"user", content}: the host SHOULD add it to the conversation and MAY ask for consent; it triggers a follow-up. `ui/open-link` {url}: returns error -32000 if denied. `ui/request-display-mode` {mode} returns the actual mode. (S-APPS)
- Patterns: report client-side failures to the model with `updateModelContext`; structure context with YAML front matter; for large data, call `updateModelContext` first, then `sendMessage` with a short prompt. (S-PAT)
- ext-apps 2.0.3 `app-with-deps.js` exports include `App`, `PostMessageTransport`, `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts`, `getDocumentTheme`, `RESOURCE_MIME_TYPE`, `RESOURCE_URI_META_KEY`, and method constants such as `OPEN_LINK_METHOD`, `MESSAGE_METHOD`, `REQUEST_DISPLAY_MODE_METHOD`, `SIZE_CHANGED_METHOD`, `HOST_CONTEXT_CHANGED_METHOD`. `App` methods: `connect`, `getHostContext`, `getHostCapabilities`, `callServerTool`, `sendMessage`, `updateModelContext`, `openLink`, `downloadFile`, `requestDisplayMode`, `requestTeardown`, `sendSizeChanged`, `setupSizeChangedNotifications`, `sendLog`; handlers `ontoolinput`, `ontoolinputpartial`, `ontoolresult`, `ontoolcancelled`, `onhostcontextchanged`, `onteardown`; options `{autoResize}`. (S-PKG)
- Not in MCP Apps: `openai/toolInvocation/*`, `openai/widgetDescription` ("use `app.updateModelContext()`"), `widgetState`. (S-MIG)

## 4. Server `instructions`

- `InitializeResult.instructions`: "can be used by clients to improve the LLM's understanding … MAY be added to the system prompt." (S-MCP) The 2026-07-28 `server/discover` result also carries `instructions`. (S-DISC)
- ChatGPT: "ChatGPT and Codex use these instructions alongside tool metadata." Use them for cross-tool guidance such as required sequences or shared limits; keep the key details in the first 512 characters; do not repeat tool descriptions or change the model's personality. (O-SRV) Instructions are scanned and reviewed with tools. (O-REVIEW)
- MCP blog guidance: capture cross-tool relationships, operational patterns, and constraints. Be concise. No marketing, no unrelated behaviour, no manual. Do not rely on instructions for security or critical actions. Host use varies, so test each client. (S-BLOG)
- Claude: none of the Claude connector pages fetched say how Claude uses `instructions`. Claude's review bans descriptions that "attempt to override system instructions". (C-REV)

## 5. Anthropic: writing tools for agents (A-TOOLS)

- Build a few tools for high-impact workflows; consolidate frequently chained steps (for example `schedule_event` instead of list plus create). Avoid tools that only wrap API endpoints. Overlapping tools confuse agents.
- Namespace by service and resource (for example `asana_projects_search`). Prefix versus suffix affects evals.
- Return high-signal context: natural-language names over cryptic IDs. Optionally add a `response_format` enum (`concise`/`detailed`).
- Token efficiency: pagination, filtering, and truncation with sensible defaults; truncation messages should steer the agent. Errors should give specific, actionable fixes, not codes or tracebacks.
- Descriptions: write them as for a new hire; make implicit context explicit; use unambiguous parameter names (`user_id`, not `user`); enforce strict schemas. Use MCP annotations to disclose open-world and destructive behaviour. Evaluate with realistic multi-step tasks.

## Gaps and conflicts

- Claude and result `_meta` or `structuredContent`: no Claude page says whether the model sees either. The spec says both are "not added/intended for model context". Claude's supersession guide puts its election key in `structuredContent` but says nothing about model visibility. Unconfirmed.
- ChatGPT `ui/open-link`: O-ADDUI lists the `ui/*` bridge generically, but the only documented external-link API is `window.openai.openExternal` with `redirect_domains`. Whether ChatGPT honours `ui/open-link` was not confirmed.
- Max widgets per answer: neither host documents a number.
- Claude's handling of `instructions`: not documented in the fetched Claude pages.
