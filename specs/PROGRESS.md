# Progress

Where the build stands, what comes next, and how work is done. Each run's plan lists the backlog rows it owns (search `BACKLOG.md` for its letter). Update **Now** and the run board at every step (design approved, plan written, task merged, walkthrough done), in the same commit as the change it records. Open gaps live in [`BACKLOG.md`](BACKLOG.md); the document index is [`README.md`](README.md).

## Now

- **Date:** 2026-10-13. **main:** `2e1312e` (`specs/` moved into the repository; last code merge `2f2cb35`).
- **Step:** run A (action and query catalog) design written: [`platform/2026-10-13-action-catalog-design.md`](platform/2026-10-13-action-catalog-design.md). Waiting for Mouhamed's review.
- **Next:** after approval, write the run A plan in `platform/plans/` (writing-plans), then execute it task by task (see "How a run works").
- **Deadline:** hackathon submission Nov 12, 2026, 12:00 pm PST ([`hackathon/README.md`](hackathon/README.md)). Keep the last five days for deploying, walkthrough fixes and the video.
- **Waiting on Mouhamed:** review of the run A design.

## Run board

### Hackathon program (current)

From [`platform/2026-10-13-agentic-surfaces-program.md`](platform/2026-10-13-agentic-surfaces-program.md). Each run: design → plan → build → merge → walkthrough → outcome recorded.

| Run | Scope | Design | Plan | Status |
|---|---|---|---|---|
| A | Action and query catalog, actors, client contacts, action log, payout events | [design](platform/2026-10-13-action-catalog-design.md) | not written | Design waiting for review |
| B | Delivery pipeline (webhook and email targets), public API, webhooks, offering fulfilment type, demo AI seller | not written | | Not started |
| C | Client's AI plugin (MCP server, MCP Apps widgets, client accounts, MCP authorization) | not written | | Not started |
| D | Web agents (intake agent, team copilot) | not written | | Not started |
| E | Discord ticket flow on the conversation layer, `/ask` | [source design](platform/2026-10-13-discord-ticket-flow-design.md) (revise first) | | Not started |
| F | Slack ops (team-only install, payout approvals, alerts, ops assistant), payout fixes | not written | | Not started |
| G | `dash.` rename, deploy, seeded demo sellers, the video (maintenance batch first if time allows) | not written | | Not started |

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
3. **Build.** One branch and worktree per run (`worktrees/<run>`), its own test database (`jendal_test_<run>`, created in the `jendal-pg` container; the Vitest global setup migrates it; point the worktree's `.env.test.local` at it). One worker per task; the controller reviews each task and the whole branch. Checks per task: `npx vitest run <paths>`, `pnpm check-types`, `pnpm lint`. Conventional Commits ending with `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`. Never push.
4. **Merge.** `git merge --no-ff` into main, `pnpm install`, `pnpm db:migrate:dev` (check the dev data before and after), restart the dev stack.
5. **Walkthrough.** Over the tunnel in the PayPal sandbox, with Playwright. Mouhamed does the steps PayPal refuses to automate (paying in the PayPal popup, Payouts Web uploads). Fixes found go in a follow-up branch.
6. **Record.** Fill the plan's Outcome, set the design's status, move finished backlog rows to Done and add new findings to Open, update the run board and **Now**. Remove the worktree, branch and test database.

Spec and plan edits are committed on main (`docs(specs): …`), not on feature branches.

## Environment

- **Repository:** `github.com/payleor/payleor` (private). Local layout: `/home/mouhamed/dev/repos/jendal/` holds `worktrees/main` (main), run worktrees under `worktrees/`, and `refs/` (PayPal and stack reference clones, not in git; guide copies in [`references/`](references/README.md)). `jendal/specs` is a symlink to `worktrees/main/specs`.
- **Stack:** pnpm and turbo monorepo; api Worker (Hono + tRPC, `apps/server`), web Worker (vinext, `apps/web`), Postgres through Hyperdrive, Drizzle, Better Auth, evlog, Alchemy for infrastructure (`packages/infra/alchemy.run.ts`). Design details: [`platform/2026-10-03-payleor-platform-design.md`](platform/2026-10-03-payleor-platform-design.md).
- **Dev:** Postgres in Docker (`jendal-pg`, port 5432; dev database `jendal-dev`), MinIO for R2 (`mdbm-start-minio`). `pnpm dev` from `worktrees/main`; `pnpm tunnel` serves `admin.payleor.com` and `*.payleor.app` (a bare `cloudflared tunnel run` loads no ingress rules and every host returns 503). After a merge that changes dependencies, the web app can load two copies of React (blank page, "Invalid hook call"): stop dev, delete `apps/web/node_modules/.vite`, restart, clear the browser cache.
- **Secrets:** only in ignored env files (`apps/server/.env`, `.env.test.local`) and the PayPal developer dashboard. Never print or commit them.
- **Sandbox walkthrough accounts:**
  - Team `walk-crew` (services team, merchant `TR4W3HLBT75MG`, seller 3 `sb-h9zfs53161788@business.example.com`). Owner and payee "Walk Through" (`mdbm-agent@agentmail.to`, payout destination buyer 1 `AWVNN2ZZ6ZWT4`). Extra admins `mdbm-agent+admin2@agentmail.to` and `mdbm-agent+admin3@agentmail.to`.
  - Buyers: buyer 2 `sb-vexyv53252581@personal.example.com` pays project invoices.
  - The AgentMail inbox (`mdbm-agent@agentmail.to`, plus addresses included) is read with the `AGENT_MAIL_*` values in `apps/server/.env`. Sign-ups from scripts need the Origin `https://admin.payleor.com`.
  - walk-crew ends R5b-1 with automatic payouts off and Custom payout rules (see the R5b-1 plan's Outcome).

## Decisions log (latest first)

- 2026-10-13: Backlog items without a run got owners: client email notifications in run B, payout fixes in run F, minor items in a maintenance batch before G if time allows.
- 2026-10-13: `specs/` moved into the repository with this progress file and [`BACKLOG.md`](BACKLOG.md); together with the designs and plans they replace any separate handoff document.
- 2026-10-13: Run A design approved section by section: registry of action definitions, client contacts in run A, the delivery pipeline moved to run B.
- 2026-10-13: Agentic surfaces program approved (runs A–G, demo story). Full AI seller support: any team plugs its own agent through the API and webhooks. Slack is team-only; Discord serves businesses with their clients.
- 2026-10-13: Discord run 5b-2 designed, then reframed as run E.
- Earlier decisions are recorded in each design's Decisions section and each plan's "Decisions during execution".
