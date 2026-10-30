# Veetlyn for your AI assistant

One MCP connector puts Veetlyn's sellers inside Claude and ChatGPT: search offerings, ask questions, request quotes and follow a project you commissioned. The connector's tools prepare purchases; **you** approve every payment in PayPal.

## Connect

From the product page: [veetlyn.com/network](https://veetlyn.com/network#add) hosts the per-stage plugin downloads — `/plugin/claude.zip` and `/plugin/chatgpt.zip` are built into each deployed stage.

Or add the connector by hand:

| Client | Production connector | Staging connector (test mode) |
|---|---|---|
| Claude | Customize → Plugins → Upload plugin, or Settings → Connectors → **Add custom connector** with `https://api.veetlyn.com/mcp` | same, with `https://api.staging.veetlyn.com/mcp` |
| ChatGPT | Plugins → Upload, or developer mode → **Create a custom connector** with the same address | same, staging address |

The first use runs Veetlyn's OAuth consent: it names the app, the permissions it asks for and the host you'll be sent back to. Accepting signs your assistant in as you — everything it does is attributed to your account and logged.

## What to ask

- *"Find me a studio for a logo refresh"* — a search card with each seller's services, prices and how the work is fulfilled (by people, automated, or both).
- *"Request a quote from Walk Crew for a landing page"* — the assistant collects the brief (offering, description, timeline), and you confirm before it sends.
- *"What's the status of my project?"* — the current state, what's owed, what's waiting on whom.
- When quotes exist: *"compare the quotes"* — lines, delivery days and deposit side by side; acceptance happens on the card, not in free text.

## Rules the connector cannot break

- **An agent prepares, a person pays.** The agent has no tool that captures a payment. The pay page opens PayPal's checkout; you log in there and approve.
- **The seller's operating model decides what it sees.** Role, record and business state are evaluated server-side per tool call; a seller's internal actions are not on the connector.
- **Everything is logged.** Each tool call lands in the action log with its actor and policy (`free`, `needs a person's confirmation`, or `never`).

## Troubleshooting

- **No tools after connecting:** refresh the connector's tools (Claude: toggle the connector off and on; ChatGPT: reload after the consent flow). Widget definitions update on reconnect.
- **ChatGPT ignores an uploaded zip:** ChatGPT's web chats don't call MCP servers from zip uploads — use the custom connector with the MCP address instead. The zip works in the desktop app.
- **Connected to the wrong stage:** the connector URL decides the environment. Production (`api.veetlyn.com`) sees production sellers; staging sees staging's test data. Disconnect and re-add with the other address.

## For developers

The plugin source is [`plugins/veetlyn`](../plugins/veetlyn/README.md) (manifest, skills, per-stage `mcp.json`). Build locally with `pnpm plugin:zip` (production stage) and `pnpm plugin:zip:staging` — zips write to `dist/plugin/` and are never committed. The CI **AI plugin** workflow builds both stages on every change to `plugins/` as the `ai-plugin-zips` artifact. The MCP server lives in the api Worker (`apps/server`), and every tool is an entry in the action registry with its agent policy.
