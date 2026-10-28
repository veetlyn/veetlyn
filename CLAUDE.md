# Veetlyn (code name jendal)

Veetlyn is the money flow and the trust around paid work: freelancers, teams and AI sellers quote, get paid through PayPal, deliver and pay their members. It is being built for the PayPal AI Hackathon. Code is finished by **Oct 31, 2026**; submission is due **Nov 12, 2026, 12:00 pm PST**.

## Read first, in this order

1. [`specs/PROGRESS.md`](specs/PROGRESS.md): where the build stands, the next step, the run board, how a run works, the environment, the decisions log.
2. [`specs/BACKLOG.md`](specs/BACKLOG.md): open gaps with the run that owns them.
3. [`specs/platform/2026-10-13-agentic-surfaces-program.md`](specs/platform/2026-10-13-agentic-surfaces-program.md): the program, the demo and the hackathon deliverables.
4. The current run's design and plan (linked from `PROGRESS.md`), and [`specs/stories/`](specs/stories/README.md) for what the app must do.

For anything else, [`specs/README.md`](specs/README.md) is the context index: what to read for each kind of work. Never read the whole `specs/` folder or send a helper agent to; `specs/archive/` is history, opened only through a link.

Settled decisions are in the designs and the decisions log; do not reopen them without Mouhamed.

## Workflow

The skills in `.claude/skills/` carry the process:

- **brainstorming** for a new design (one question at a time, approaches, sections approved one by one). Designs go in `specs/platform/YYYY-MM-DD-<topic>-design.md`, not `docs/superpowers/specs`.
- **writing-plans** for the plan, in `specs/platform/plans/YYYY-MM-DD-<run>-<topic>.md`, with base commit, branch, worktree, test database, facts with file and line references, tasks, the walkthrough's story IDs, and an empty Outcome.
- **subagent-driven-development** (or **executing-plans**) to build it task by task, with **using-git-worktrees**, **test-driven-development**, **requesting-code-review**, **verification-before-completion** and **finishing-a-development-branch**.
- **test-audit** whenever tests are written, changed or reviewed: each test names a credible regression, sits at the strongest boundary (router or use case with the real database, PayPal faked at `fetch`), and does not duplicate another.
- **anti-slop** for code and prose quality, next to `pnpm lint`.
- **design-system-boss** steers all UI and brand work, with Quartz as the base system; it runs `build-design-system`, `migrate-design-system`, `token-mapping`, `component-docs` and `ui-review`.
- **securebydesign** for any change to an API, auth, storage, payments or a deploy.
- **End of every run, before the merge:** a **test-audit** sweep of every test the branch adds or changes, then a **security-audit** in full audit mode with the `quick` profile, scoped to the run's diff (`origin/main...<branch>`), its output outside the repository (`~/security-audit-skill/payleor/run-<N>`). Both results go in the plan's Outcome; confirmed findings are fixed on the branch or become backlog rows with an owner before the merge.

One branch and worktree per run, its own test database. Open a pull request; Mouhamed merges once CI is green and the walkthrough passed. Spec, plan, story and backlog edits are part of the work: record the outcome, story statuses and backlog changes as `PROGRESS.md` "How a run works" says.

## Commands

- `pnpm install`, `pnpm check-types`, `pnpm lint` (Oxlint with the anti-slop plugin, must stay at 0 findings), `pnpm test` (Vitest).
- Tests need `TEST_DATABASE_URL` in `.env.test.local`, pointing at a Postgres database whose name contains `test` (the global setup drops and migrates it). Run focused tests with `npx vitest run <paths>`. Never edit files while Vitest runs.
- Migrations: `pnpm db:generate` creates them (Drizzle); `pnpm db:migrate:dev` applies them to the dev database.

## Code rules

- Decode untrusted data at the boundary with zod; no `typeof` checks; no `unknown` parameters except `cause`; a `SAFETY:` comment on any type assertion; `fromPartial` (shoehorn) for test fakes.
- Integer minor units for money, basis points for rates, round half-up once at the line that produces a value.
- Comments only for reasons the code cannot show; never mention runs, tasks or plans in code.
- Follow `specs/references/AGENTS.md` for anything PayPal: JS SDK v6, orders on the server, `PayPal-Request-Id` on every POST, verified webhooks, and no money movement by an agent without a person's confirmation.
- Conventional Commits.

## Secrets and people

- Never print, log or commit secrets. Env values live in ignored files (`apps/server/.env`, `packages/infra/.env`, `.env.test.local`) or the cloud environment's settings. Everything is PayPal sandbox.
- Steps only Mouhamed does: approving payments in the PayPal popup, Payouts Web uploads, connecting the plugin in Claude or ChatGPT, anything on real Discord accounts, deploy credentials and DNS. Stop and ask.

## Claude Code cloud sessions

- Start Postgres with `docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17` (or `service postgresql start` for the pre-installed 16), create `jendal_test`, and write `.env.test.local` with `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jendal_test`.
- There is no dev tunnel any more. Browser checks run against the deployed sandbox hosts: staging (`dash.staging.payleor.com`, deployed by hand from a branch) before a merge, production (`dash.payleor.com`) after it (`specs/stories/README.md`). Never deploy from a cloud session; ask Mouhamed to run the staging deploy.
