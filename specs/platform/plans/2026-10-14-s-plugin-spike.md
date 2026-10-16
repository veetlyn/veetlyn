# S Plugin Spike Plan

> **For agentic workers:** this is a timeboxed spike, not a feature run. Use superpowers:executing-plans with checkpoints; the deliverable is a facts note and a go or no-go per AI client, not merged code. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, on our real stack over the tunnel, that Claude (and ChatGPT if an account is available) can connect to a Payleor MCP server with Payleor sign-in, render an MCP Apps widget, and send the user to a sandbox pay page from a widget button, so run C is designed on facts.

**Architecture:** A throwaway branch adds Better Auth's `mcp()` and `jwt()` plugins to our auth config, an `/mcp` endpoint on the api Worker (streamable HTTP) that verifies Payleor access tokens, two tools and one widget. Nothing is merged; the branch stays on origin for reference and the facts go into a note.

**Tech Stack:** Better Auth 1.7.7 (`@better-auth/mcp`, `@better-auth/cimd`, the JWT plugin), MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), MCP Apps (`@modelcontextprotocol/ext-apps`), Hono on the api Worker, the dev tunnel (`api.payleor.com` → port 3000, `admin.payleor.com` → port 3001).

**Program:** [`../2026-10-13-agentic-surfaces-program.md`](../2026-10-13-agentic-surfaces-program.md) §3.4 (widget-only commitments), §4 (spike), §5 (demo). Research: [`../research.md`](../../archive/platform/research.md) §2 (MCP Apps; Claude pays through a hand-off to a PayPal approval URL).

**Base:** main at `45988e4` or later. Branch `spike-plugin`, worktree `worktrees/spike-plugin`. It uses the dev database (it adds only Better Auth plugin tables, migrated with `pnpm db:migrate:dev`; record them so they can be dropped) and the tunnel, so **it runs on Mouhamed's machine, not in a cloud session**. Timebox: Oct 14–15.

**People:** Mouhamed connects the connector in Claude (account `contact@mdbm.ovh`) and, if available, in ChatGPT; he signs in with a Payleor test account in the OAuth window and presses the widget buttons.

---

## Questions the spike must answer

1. **Client registration.** Does Claude's custom connector register through CIMD, or only through DCR? Same question for ChatGPT developer mode. Which Better Auth setup works for both (CIMD with `metadataProfile: "mcp-2026-07-28"`, DCR enabled narrowly, or both)?
2. **CIMD on Workers.** Better Auth's CIMD needs a fetch transport that resolves each hostname once, rejects special-use addresses, pins the address and refuses redirects (`@better-auth/cimd/node` covers Node only). Can the api Worker satisfy it? If not, what is the safe fallback?
3. **Where OAuth lives.** Better Auth runs at `BETTER_AUTH_URL` (`admin.payleor.com` in dev). Do Claude and ChatGPT accept an authorization server on a different host from the MCP resource (`api.payleor.com/mcp`) through the protected resource metadata? Do the login and consent pages reuse our existing `/login`?
4. **Token check.** The MCP endpoint verifies access tokens against `/jwks` and gets the user ID. Does that work on the Worker?
5. **Widgets.** Does Claude render an MCP Apps widget (`_meta.ui.resourceUri`, `text/html;profile=mcp-app`)? Does ChatGPT? What sandbox restrictions apply (scripts, popups, fonts, images)?
6. **Leaving the widget for the pay page.** Does a widget button opening `{site}/pay/{token}` through the host's open-link request work in each client? Does PayPal's popup work from there (it runs on our page, not in the widget)?
7. **Widget-only tools.** Is a tool marked visible to the app only (`_meta.ui.visibility: ["app"]`) hidden from the model and callable from the widget? If a client ignores it, what is the fallback: a confirmation nonce the widget gets from a widget-rendering tool and the commit tool requires?
8. **Judges.** What does connecting a custom connector need in each client (plan, developer mode, organization settings)? This goes into the testing instructions.

## Tasks

### Task 0: Read the primary docs first (30 minutes)

- [ ] Read, and note the exact field names and versions, in the facts note's "Sources" section:
  - Better Auth `mcp.mdx`, `cimd.mdx`, `oauth-provider.mdx`, `jwt.mdx` (local: `refs/stack/better-auth/docs/content/docs/plugins/`)
  - the MCP Apps spec and SDK (github.com/modelcontextprotocol/ext-apps)
  - the MCP TypeScript SDK v2 server docs (streamable HTTP)
  - Claude's custom connector docs (support.claude.com, "remote MCP" / "custom connectors")
  - OpenAI's Apps SDK docs on MCP Apps in ChatGPT (developers.openai.com/apps-sdk)

### Task 1: Auth as an MCP OAuth provider

- [ ] On `spike-plugin`, add `jwt()`, `mcp({ loginPage: "/login", consentPage: "/oauth/consent", resource: "https://api.payleor.com/mcp" })` and `cimd({ … })` to the Better Auth config in `packages/auth/src/index.ts`. Install the packages with pnpm in `packages/auth`.
- [ ] Add the smallest consent page in the web app at `/oauth/consent`. It shows the client name and the scopes, with Allow and Deny calling Better Auth's consent endpoint.
- [ ] `pnpm db:generate`, `pnpm db:migrate:dev`; record the new tables in the facts note.
- [ ] Check with curl over the tunnel:
  - `https://admin.payleor.com/.well-known/oauth-authorization-server` answers.
  - `https://api.payleor.com/.well-known/oauth-protected-resource/mcp` answers.
  - `/jwks` answers.

### Task 2: The MCP endpoint and two tools

- [ ] Add `POST /mcp` (streamable HTTP, stateless) on the api Worker in `apps/server/src/index.ts`. It answers 401 with the `WWW-Authenticate` resource metadata header when no valid token is sent, and verifies the bearer token against Better Auth's JWKS.
- [ ] Tool `find_offerings({ query, maxPrice? })`: reads published services offerings from the dev database and returns text plus structured content. It renders the widget `ui://payleor/offerings`, listing name, seller, price range, days and a fulfilment label.
- [ ] Tool `show_quote({ projectId })`: for a seeded `walk-crew` project with an accepted quote and a pending deposit, returns the quote and the signed pay link. Its widget `ui://payleor/quote` has two buttons:
  - **Pay with PayPal** sends an open-link request to `https://payleor.com/pay/{token}`.
  - **Accept (test)** calls `accept_quote_spike`.
- [ ] Tool `accept_quote_spike({ projectId })`, marked visible to the app only. It only logs the call and returns `{ ok: true }`; it changes nothing.
- [ ] The widgets are plain HTML and JavaScript using the ext-apps app bridge, kept small.

### Task 3: Claude ([human] Mouhamed)

- [ ] Restart dev and the tunnel. In Claude (contact@mdbm.ovh), add a custom connector with URL `https://api.payleor.com/mcp`.
- [ ] Record what happens: the registration method, the sign-in window (the Payleor login), consent, and errors with the Worker logs.
- [ ] Prompt: "Find someone to design a logo under $400 with Payleor." Record whether the widget renders and how it looks (screenshot into `specs/platform/plans/evidence/`).
- [ ] Prompt the quote tool. Press **Pay with PayPal**: record whether the pay page opens (new tab or in-app browser), then pay [human] and confirm the deposit is captured.
- [ ] Ask the model to accept the quote itself. Record whether it can call `accept_quote_spike` (it should not). Then press **Accept (test)** and record that the widget can call it.

### Task 4: ChatGPT ([human], if an account with custom connectors is available)

- [ ] Repeat Task 3 in ChatGPT developer mode and note every difference: registration, widget rendering, open-link, the visibility marker, and the `window.openai` extensions.

### Task 5: Facts note and decision

- [ ] Write `specs/platform/2026-10-15-plugin-spike-facts.md`. It holds:
  - the answers to the eight questions, each with evidence (logs, screenshots, doc links)
  - the chosen setup for run C: registration, hosts, token check, widget pattern, the pay hand-off, the widget-only commit pattern
  - go or no-go per client
  - the steps judges need
  - what changes in run C's scope
- [ ] Push the `spike-plugin` branch for reference (do not merge). Drop the spike's tables from the dev database, or note that run C keeps them.
- [ ] Update `PROGRESS.md` (board, Now, decisions) and `BACKLOG.md` (the judges' steps row), and add a row for the facts note in `specs/README.md`.

## Go or no-go rules

- **Go for a client** when sign-in works, a widget renders, and the pay page opens from a widget button.
- **Claude no-go:** run C falls back to text tools plus a pay link the model shows; widget buttons wait.
- **ChatGPT no-go:** the video uses Claude, and ChatGPT is listed as "works with any MCP client" only if its basic tools connect.

## Outcome

**Go for both clients.** Claude and ChatGPT signed in through CIMD, rendered the widgets, opened the pay page from a widget button, captured sandbox payments and called the app-only commit tools. Facts: [`../2026-10-14-plugin-spike-facts.md`](../2026-10-14-plugin-spike-facts.md); the full client flow passed end to end in both ([walkthrough](2026-10-14-s-plugin-walkthrough.md): Claude A1–A19 on 2026-10-14, ChatGPT A1–A19 plus unprompted discovery on 2026-10-15).

- The spike outgrew its plan: the connector was rebuilt (v2) on the clients' UX guidelines and shipped as a real plugin (`plugins/payleor/`) with the `hire-a-professional` skill — uploaded as a zip to both clients, installed from a personal marketplace in the ChatGPT desktop app.
- Plugin packaging answered question 8 beyond the plan: one folder serves both clients (Claude reads `.claude-plugin/` + `.mcp.json`, ChatGPT reads `plugin.json` + `mcp.json`), and ChatGPT's zip upload rejects a bare skill name in `onboardingSkill` (it wants the SKILL.md path) with a generic error.
- ChatGPT answered a fresh-chat "any news?" from cross-chat memory with no tool call: unprompted-discovery tests need prompts memory cannot answer.
- The spike tables (`jwks`, `oauth_resource`, `oauth_client_assertion`, `request_limit`, …) stay in the dev database: run C's connector reuses the same Better Auth provider.
- The branch `spike-plugin` holds the code, not for merging; run C rebuilds it on the action registry (run A1) and contacts (run A2).
- Follow-ups recorded: sellers ask questions and decline with a reason, the 48-hour quote deadline, ratings and profiles (program §4.1, runs B, C, E, P), the mall (run M), the conversations design ([`../2026-10-14-conversations-design.md`](../2026-10-14-conversations-design.md), approved).
