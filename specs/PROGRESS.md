# Progress

Where the build stands, what comes next, and how work is done. Each run's plan lists the backlog rows it owns (search `BACKLOG.md` for its letter). Update **Now** and the run board at every step (design approved, plan written, task merged, walkthrough done), in the same commit as the change it records. Open gaps live in [`BACKLOG.md`](BACKLOG.md); the document index is [`README.md`](README.md).

## Now

- **Date:** 2026-10-15. Last code merge on main: `4a27fb6` (A1, PR #1). Check `git log` for the latest docs commits.
- **Goal:** the demo video and the sandbox app live at `payleor.com` / `payleor.app`, submitted before Nov 12, 2026, 12:00 pm PST. **Code finished by Oct 31** (AI tooling ends around Nov 1); Nov 1–12 is fixes, README, Devpost and the video.
- **Step:**
  - A1 is merged (`4a27fb6`, PR #1).
  - **Spike S is closed: go for both clients.** The full hire flow passed end to end in Claude (walkthrough A1–A19, 2026-10-14) and ChatGPT (A1–A19 plus unprompted discovery, 2026-10-15) with the plugin uploaded as a zip. Facts: [`platform/2026-10-14-plugin-spike-facts.md`](platform/2026-10-14-plugin-spike-facts.md); plan Outcome: [`platform/plans/2026-10-14-s-plugin-spike.md`](platform/plans/2026-10-14-s-plugin-spike.md).
- **Next:**
  - Run C is designed and planned: [`platform/2026-10-15-c-plugin-design.md`](platform/2026-10-15-c-plugin-design.md), [`platform/plans/2026-10-15-c-plugin.md`](platform/plans/2026-10-15-c-plugin.md). Settled: default-listed with per-offering and per-department opt-out; conversation audience per quoting mode; client and pay pages move to `{team}.payleor.app`; minimal client home on payleor.com; MCP stays on `api.payleor.com/mcp` for the hackathon.
  - Then A2 (design approved, plan not written), then H, then C (Oct 20–23).
- **Waiting on Mouhamed:**
  - For run E: three Discord accounts and the test server.
- **If Mouhamed is unavailable:** plans may be drafted and backlog items owned by the current run may be prepared, but nothing is merged into main and no design decision is changed without him.

## Run board

### Hackathon program (current)

From [`platform/2026-10-13-agentic-surfaces-program.md`](platform/2026-10-13-agentic-surfaces-program.md) §4. Each run: design → plan → build → merge → walkthrough → outcome recorded. Cut order if a run slips: AI seller, Discord client buttons, the Discord request-thread sync, the portfolio, the mall's multi-store order, webhooks, AG Studio agent (program §4; the three new steps to confirm).

| Dates | Run | Scope | Design | Plan | Status |
|---|---|---|---|---|---|
| Oct 14–15 | S | Plugin spike: MCP server, Better Auth OAuth, one widget in Claude and ChatGPT, pay link | program §4 | [plan](platform/plans/2026-10-14-s-plugin-spike.md) | **Done, go for both clients.** Full walkthrough passed in Claude and ChatGPT (A1–A19 each, plus ChatGPT unprompted discovery); plugin uploaded as a zip to both. Code stays on branch `spike-plugin` (not for merging); [facts](platform/2026-10-14-plugin-spike-facts.md) |
| Oct 14–15 | A1 | Action registry, `perform`, actors, errors, action log | [design](platform/2026-10-13-action-catalog-design.md) §4 | [plan](platform/plans/2026-10-14-a1-action-registry.md) | Merged as `4a27fb6` (PR #1) |
| Oct 16–17 | A2 | Client contacts, verified identities, revocable client links, safe migration | [design](platform/2026-10-13-action-catalog-design.md) §5 | not written | Design approved |
| Oct 18–19 | H | `dash.` rename, first deploy to our domains (sandbox), partner app renamed to Payleor | not written | | Not started |
| Oct 20–23 | C | Client's AI plugin on `api.payleor.com/mcp`: offering search (default-listed, opt-out), request, competing quotes with per-freelancer slides, widget-only accept, pay page, client OAuth on A2 contacts; conversations (questions, answers, decline with a reason, shortlist) on every surface; client and pay pages on `{team}.payleor.app`; client home on payleor.com | [design](platform/2026-10-15-c-plugin-design.md) | [plan](platform/plans/2026-10-15-c-plugin.md) | Design and plan written, awaiting review |
| Oct 24–25 | B | Delivery pipeline with email and webhooks, API keys, AI seller endpoints, payout events, fulfilment type, 48-hour response deadline | not written | | Not started |
| Oct 24–27 (parallel with B and E) | M | The mall: product search across stores, server-side cart, cart card, checkout on Payleor (one PayPal order across stores), flat shipping, stock, tracking | not written | | Not started |
| Oct 26–27 | E | Discord: request thread with the team's freelancers synced with the private project channel, channel for any project, card, notices, `/deliver`, client buttons, draft confirmation | [source design](platform/2026-10-13-discord-ticket-flow-design.md) (revise to program §4 first) | | Not started |
| Oct 28–29 | D | Intake agent proposals; AG Studio team analytics with the copilot (agent-toolkit) | not written | | Not started |
| Oct 30 | P | Two-way ratings, public reviews, seller profile with portfolio, ratings in the plugin | not written | | Not started |
| Oct 30 (if time) | AI seller | Separate Worker on the public API (optional, first to cut) | not written | | Not started |
| Oct 31 | Freeze | Full demo walkthrough on the deployed hosts | | | |
| Nov 1–12 | Submission | Fixes, seed data, AG Studio key (Nov 1), README, Devpost, public repo with licence, video | | | |

After the hackathon: Slack ops, the inactivity rule, plugin directory listings, the Commerce checkout protocols, the rest of Discord, payout fixes, full books, billing, domain errors, cases.

### Done before the program

Merged into main with `--no-ff`; each plan's Outcome records reviews and walkthroughs.

| Run | What | Merge |
|---|---|---|
| W1-A | Foundations and tenancy ([plan](platform/plans/2026-10-03-w1a-foundations-tenancy.md)) | `ae50e45` |
| W1-D | Public site, auth, onboarding, legal pages ([plan](platform/plans/2026-10-05-w1d-public-site-auth-onboarding.md)) | `a8e5260` |
| S1–S5 | Services teams, Discord (S2), PayPal onboarding, ledger and projects, commerce catalog ([plans](platform/plans/)) | `6e79775`, `8c53d23`, `6baf62c`, `eb3b570`, `8929e40` |
| E1–E7 | Email senders, dev tunnel, auth forms, error logs, PayPal card copy, quote refusal hint | `0e84725` … `908e709` |
| R0 | Services skip shipment tracking ([plan](platform/plans/2026-10-07-r0-services-paypal-features.md)) | `50b821a` |
| R1a, R1b, R1c | Server payments, pay page, PayPal webhooks and fees | `17a6499`, `a46bcf2`, `e2fcebf` |
| R2, R2b | Deliveries and completion, delivery files | `722e1e3`, `2aac26f` |
| R3a, R3b, R3c | Seller setup and catalog, seller page and publishing, quote request form | `444c1f4`, `29b6188`, `8d51ff2` |
| R4a, R4b | Digital products, checkout and orders | `2df314e`, `60bed6c` |
| B1, B2, B3 | Maintenance batches and payout prerequisites | `46cb788`, `eed3537`, `0060728` |
| L1 | Lint cleanup (anti-slop to zero) | `ae192c0` |
| R5a, R5a-2 | Team payouts with pasted credentials, then manual payouts: both superseded | `f70b191`, `0458169` |
| R5c | Automatic payouts through PayPal first-party onboarding | `b437e78`, `0f0f58a`, `abc93b0` |
| R5b-1 | Payout rules, project payouts, Payouts Web CSV, quote calculator ([plan](platform/plans/2026-10-13-r5b1-payout-rules.md)) | `a4cf6a8`, `2f2cb35` |
| Audits 1, 2, 4, 5, 6 | Test audits between runs (audit 3 was never merged) | `0db4f5c`, `124e052`, `6224a59`, `2922048`, `94e8050` |

The sellers design §11 ([`platform/2026-10-07-sellers-minimal-flow-design.md`](platform/2026-10-07-sellers-minimal-flow-design.md)) has the detailed history of runs 0–5.

## How a run works

1. **Design.** Brainstorm with Mouhamed (one question at a time, approaches with a recommendation, design sections approved one by one). Write the design in `platform/` with a date prefix, add a row to `README.md`, update **Now**. Mouhamed reviews the written design before planning.
2. **Plan.** Write the plan in `platform/plans/`: base commit, branch, worktree, test database, facts with file and line references, tasks with checkboxes, a final controller task (review, merge, walkthrough), and an empty Outcome section.
3. **Build.** One branch and worktree per run (for A1: branch `a1-action-registry`, worktree `worktrees/a1-action-registry`), its own test database (`jendal_test_a1`; see Environment for the commands). One worker per task; the controller reviews each task and the whole branch. Checks per task: `npx vitest run <paths>`, `pnpm check-types`, `pnpm lint`. Conventional Commits ending with `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`. Never push.
4. **Merge.** `git merge --no-ff` into main, `pnpm install`, `pnpm db:migrate:dev` (check the dev data before and after), restart the dev stack.
5. **Walkthrough.** Run the plan's stories from [`stories/`](stories/README.md) in the PayPal sandbox with a browser agent (Playwright, Chrome DevTools or Claude in Chrome): over the tunnel before run H, on the deployed hosts after it. Mouhamed does the [human] steps (paying in the PayPal popup, Payouts Web uploads, plugin connectors, Discord accounts). Fixes found go in a follow-up branch.
6. **Record.** Fill the plan's Outcome, set the design's status, update the stories' statuses (and add stories for new features), move finished backlog rows to Done and add new findings to Open, update the run board and **Now**. Remove the worktree, branch and test database.

Spec and plan edits are committed on main (`docs(specs): …`), not on feature branches.

The agent tooling named in plans (writing-plans, subagent-driven-development, explorer and worker subagents, Playwright and Chrome DevTools for walkthroughs) are Droid skills and subagents. A person can follow the same steps by hand: the plan's tasks are self-contained.

## Environment

- **Repository:** `github.com/payleor/payleor` (private until the submission, then public with a licence). Local layout: `/home/mouhamed/dev/repos/jendal/` holds `worktrees/main` (main), run worktrees under `worktrees/`, `refs/` (PayPal and stack reference clones, not in git; guide copies in [`references/`](references/README.md)) and `pitch/` (personal documents, never in git). `jendal/specs` is a symlink to `worktrees/main/specs`. Only `worktrees/main` is active; the other worktrees are leftovers of merged runs. "jendal" is the code name; the product is Payleor.
- **Stack:** pnpm and turbo monorepo; api Worker (Hono + tRPC, `apps/server`), web Worker (vinext, `apps/web`), Postgres through Hyperdrive, Drizzle, Better Auth, evlog, Alchemy for infrastructure (`packages/infra/alchemy.run.ts`). Hosting: Cloudflare Workers Paid. Domains: `payleor.com` (platform hosts) and `payleor.app` (seller pages and portals as subdomains). Design details: [`platform/2026-10-03-payleor-platform-design.md`](platform/2026-10-03-payleor-platform-design.md).
- **Set up from scratch:**
  1. `pnpm install` in `worktrees/main` (Varlock generates the env accessors).
  2. Env values: the keys are listed in each `.env.schema` (`apps/server`, `apps/web`, `packages/db`, `packages/infra`); values come from Mouhamed or the dashboards (PayPal developer, Cloudflare, Discord developer portal, Resend, AgentMail). They go in ignored env files (`apps/server/.env`, `.env.test.local`). Never print or commit them.
  3. Postgres: `docker run -d --name jendal-pg --restart unless-stopped -p 5432:5432 -e POSTGRES_PASSWORD=<choose> -v jendal-pg-data:/var/lib/postgresql/data postgres:17`, then `docker exec jendal-pg createdb -U postgres jendal-dev`. `DEV_DATABASE_URL` points at it; `pnpm db:migrate:dev` migrates it.
  4. Files: R2 is emulated by `alchemy dev` (`/cdn-cgi/local/r2/s3` on the api port); no MinIO is needed (the `mdbm-start-minio` container on this machine belongs to another project).
  5. Tunnel: `pnpm tunnel:setup` once (Cloudflare access), then `pnpm tunnel` serves `admin.payleor.com` and `*.payleor.app` (a bare `cloudflared tunnel run` loads no ingress rules and every host returns 503).
  6. Dev: `pnpm dev` from `worktrees/main`. Stop with Ctrl-C; if a port stays taken, find the leftover `workerd`, `vite` or `alchemy` process with `ss -ltnp` and stop it. After a merge that changes dependencies, the web app can load two copies of React (blank page, "Invalid hook call"): stop dev, delete `apps/web/node_modules/.vite`, restart, clear the browser cache.
- **CI:** `.github/workflows/ci.yml` runs `pnpm check-types`, `pnpm lint` and `pnpm test` against a Postgres 17 service on every pull request and push to main. Run H adds a deploy workflow (Alchemy to Cloudflare from GitHub Actions; the state already lives in Cloudflare through `Cloudflare.state()`).
- **Agents:** `CLAUDE.md` is the entry point for Claude Code (local or cloud), and `.claude/skills/` holds the workflow skills (brainstorming, writing-plans, subagent-driven-development, executing-plans, test-audit, anti-slop and the steps they call).
- **Claude Code cloud environment** (claude.ai/code, Mouhamed's plan; usage credits end Nov 5): network access Custom, allowing the defaults plus `api-m.sandbox.paypal.com`, `www.sandbox.paypal.com`, `api.cloudflare.com`, `discord.com`, `api.agentmail.to`, `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`, and our own hosts (`*.payleor.com`, `*.payleor.app`); setup script `npm i -g n && n 24 && corepack enable && pnpm install && npx playwright install --with-deps chromium`; environment variables: sandbox values only (the keys of the `.env.schema` files a task needs), and tokens such as the Cloudflare API token as network secrets. Check the allowlist against the docs when creating the environment.
- **Tests:** `pnpm test` (Vitest) uses `TEST_DATABASE_URL` from `.env.test.local`; the global setup migrates and resets it and refuses any database whose name lacks "test". Per run: `docker exec jendal-pg createdb -U postgres jendal_test_<run>`, copy `.env.test.local` into the worktree and point `TEST_DATABASE_URL` at it; drop it when the run is done. Before each commit: `pnpm check-types` and `pnpm lint`.
- **Sandbox walkthrough accounts:**
  - Team `walk-crew` (services team, merchant `TR4W3HLBT75MG`, seller 3 `sb-h9zfs53161788@business.example.com`). Owner and payee "Walk Through" (`mdbm-agent@agentmail.to`, payout destination buyer 1, payer ID `AWVNN2ZZ6ZWT4`). Extra admins `mdbm-agent+admin2@agentmail.to` and `mdbm-agent+admin3@agentmail.to`. Solo seller: `walk-b2-solo` (a draft solo seller from B2; `walk-crew-solo` was switched to a team in R3a), or create one with story ACC-08.
  - Buyer 2 `sb-vexyv53252581@personal.example.com` pays project invoices.
  - Payleor sign-in: email and password. Passwords are not kept in the repository; use "Forgot password" and read the reset email in the AgentMail inbox (`AGENT_MAIL_*` values in `apps/server/.env`; plus addresses arrive in the same inbox). Sign-ups from scripts need the Origin `https://admin.payleor.com`.
  - PayPal sandbox accounts and passwords: the `SANDBOX_*` values in `packages/infra/.env` (also in developer.paypal.com > Sandbox > Accounts). Mouhamed pays in the PayPal popup and does Payouts Web uploads (PayPal refuses automation there).
  - walk-crew ends R5b-1 with automatic payouts off and Custom payout rules (see the R5b-1 plan's Outcome).
  - Discord (needed from run E): the Discord application and its test server are not documented yet; Mouhamed provides three accounts (admin, freelancer, client) before run E.

## Decisions log (latest first)

- 2026-10-14: Conversations design approved ([`platform/2026-10-14-conversations-design.md`](platform/2026-10-14-conversations-design.md), sections and the written document): two spaces per request in core; the request space is public to the team's own freelancers in the offering's department (or a staff shortlist), in the open quoting mode where each freelancer quotes and the client picks one; the project space holds the client and staff from the start and the accepted freelancer from acceptance; contact details masked until acceptance except file links; Discord reads plain messages through the Gateway in a Durable Object, with a Reply button as fallback.
- 2026-10-14: The mall joins the hackathon build as run M (Oct 24–27, in parallel with B and E): the client's AI browses Payleor stores and fills a cart through the same connector, and checkout opens Payleor in a new tab (one PayPal order across stores, flat shipping, tracking). Agentic commerce without a checkout protocol, which ChatGPT's guidelines allow for physical goods; ACP, UCP and Store Sync stay out. Nothing was cut; Mouhamed is arranging AI tooling beyond Nov 1 to absorb the extra work, and the freeze stays Oct 31.
- 2026-10-14: Mouhamed added marketplace rules to the hackathon build (program §4.1): sellers decline a request with a reason or ask the client questions (run C); a 48-hour response deadline with a reminder and expiry (run B; the inactivity rule after the hackathon); two-way star ratings, public client reviews and seller profiles with ratings and portfolio (new run P, Oct 30, before the optional AI seller); in Discord, a request channel or thread where the client talks with the team's freelancers, synced with the private project channel opened for the freelancer whose quote is accepted (run E). The cut order gains the request-thread sync and the portfolio (proposed, to confirm).
- 2026-10-14: Agentic commerce stays on the services story: an AI assistant runs the whole hire, a person approves every payment in PayPal, the payout rules pay the team, and AI sellers sell on the public API (program §6). No ChatGPT Instant Checkout (ACP, Braintree Agent Ready), UCP or Store Sync before the submission: they are for physical goods from a catalog, partner-only, and need early access we do not have. ChatGPT's "physical goods only" commerce rule targets selling inside ChatGPT; service marketplaces with checkout on their own site are published (Airtasker, Fiverr), so Payleor's pay page fits it.
- 2026-10-14: Open source model: the repository goes public for the submission under **AGPL-3.0**, with the same multi-tenant codebase the hosted Payleor runs (the Documenso and Twenty model). The hackathon requires the public repository to hold all the source of the demoed project (`hackathon/rules.md`), and the demo is multi-tenant. A single-tenant self-host mode (one team or freelancer, the team's own PayPal REST app, no partner fees, no cross-seller directory) comes after the hackathon in the same codebase. Compared first: Gumroad (MIT, same app), Discourse (GPL-2.0), Mattermost (open core), Cal.com (now a separate MIT community fork), Chatwoot (MIT plus an enterprise folder), Documenso (AGPL-3.0), Twenty (AGPL plus commercial files).

- 2026-10-13: Mouhamed approved the A1/A2 design and the spike scope. The spike uses his Claude account (`contact@mdbm.ovh`).
- 2026-10-13: After four independent reviews: code finished by Oct 31; run A split into A1 (registry) and A2 (client contacts) with the review fixes; a plugin spike in parallel with A1; the first deploy to our domains moves to run H (Oct 18–19); runs C, B, E, D in that order with minimum scopes; Slack after the hackathon; the AG Grid sponsor prize (AG Studio analytics in run D) alongside the grand prize and the Agentic Commerce and PayPal + AI honorable mentions; a member of a project's team is never its client; personal pitch documents kept out of git.
- 2026-10-13: Backlog items without a run got owners: client email notifications in run B, payout fixes in run F, minor items in a maintenance batch before G if time allows (superseded by the entry above).
- 2026-10-13: `specs/` moved into the repository with this progress file and [`BACKLOG.md`](BACKLOG.md); together with the designs and plans they replace any separate handoff document.
- 2026-10-13: Run A design sections approved in brainstorming (the written document still needed review): registry of action definitions, client contacts in run A, the delivery pipeline moved to run B.
- 2026-10-13: Agentic surfaces program approved (runs A–G, demo story). Full AI seller support: any team plugs its own agent through the API and webhooks. Slack is team-only; Discord serves businesses with their clients.
- 2026-10-13: Discord run 5b-2 designed, then reframed as run E.
- Earlier decisions are recorded in each design's Decisions section and each plan's "Decisions during execution".
