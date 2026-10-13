# Parallel execution: workstreams, contracts and git rules

- **Date:** 2026-10-06
- **Specs:** [`../2026-10-03-payleor-platform-design.md`](../2026-10-03-payleor-platform-design.md) (commerce), [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) (payouts; §12 is the combined schedule)
- **Repository:** `/home/mouhamed/dev/repos/jendal/jendal-workspace` (main worktree). Other worktrees live in `/home/mouhamed/dev/repos/jendal/worktrees/<name>`

## 1. Git rules

1. `main` is the integration branch. It holds W1-A as one merge commit (`ae50e45`).
2. Each workstream has one branch and one worktree, created from the current `main`:
   `git worktree add /home/mouhamed/dev/repos/jendal/worktrees/<ws> -b <branch> main`
3. One commit per plan task (or per step where the plan says so), with a conventional message (`feat(scope): …`, `fix(scope): …`, `test: …`, `chore: …`) and the trailer `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`. No WIP commits, no fixup commits left in the branch.
4. Before merging: `git rebase main` in the workstream worktree, rerun the full check (`pnpm test`, `pnpm check-types`), then in the `main` worktree: `git merge --no-ff <branch> -m "Merge branch '<branch>': <summary>"` with the trailer. Never fast-forward, never squash, never push (no remote).
5. **Migrations:** a workstream may generate migrations while it works, so its tests run. After rebasing onto `main`, if `main` gained migrations since the branch started, delete the workstream's migration folders, regenerate them with `pnpm db:generate` (one migration per workstream, named after it), check the SQL, and amend that into the workstream's migration commit before merging. Only one migration chain exists on `main`.
6. Never modify `refs/`. Never print `.env` values. Never change the git identity.

## 2. Worktree setup (run once per worktree)

```bash
WS=<name>; WT=/home/mouhamed/dev/repos/jendal/worktrees/$WS; SRC=/home/mouhamed/dev/repos/jendal/jendal-workspace
git -C $SRC worktree add $WT -b <branch> main
cp $SRC/apps/server/.env $WT/apps/server/.env
cp $SRC/packages/infra/.env $WT/packages/infra/.env
sed -E "s#(/jendal_test)([^/?]*)#\1_${WS}#" $SRC/.env.test.local > $WT/.env.test.local
docker exec jendal-pg createdb -U postgres "jendal_test_${WS}" 2>/dev/null || true
cd $WT && pnpm install --frozen-lockfile
```

Each worktree tests against its own database `jendal_test_<ws>` (the global setup only resets databases whose name contains `test`). Only one local dev stack runs at a time (ports 3000 and 3001); browser walkthroughs are scheduled by the controller.

## 3. Workstreams

| Id | Branch | Product | Plan | Starts | Depends on |
|---|---|---|---|---|---|
| W1D | `w1d-public-site-auth` (existing, main worktree) | Shared | W1-D plan, Tasks 13 (revised in S1 Part A), 15, 16 | Now | — |
| S1 | `s1-services-teams` | Payouts | `2026-10-06-s1-services-teams-foundation.md` | After W1D merges | W1D |
| S2 | `s2-discord` | Payouts | `2026-10-06-s2-discord.md` | After S1 merges | S1 |
| S3 | `s3-paypal-onboarding` | Shared | `2026-10-06-s3-paypal-client-onboarding.md` | Now | — |
| S4 | `s4-ledger-projects` | Payouts | `2026-10-06-s4-ledger-projects-quotes.md` | Part A (pure core) now; Part B after S1 merges | S1 for Part B |
| S5 | `s5-catalog` | Commerce | `2026-10-06-s5-catalog-channel3.md` | Now | — |

## 4. Contracts between workstreams

Plans must use exactly these names. A plan that needs something not listed here defines it itself and says so in its "Decisions" section.

### 4.1 Delivered by W1D (already on its branch)
- `@jendal-workspace/email` (`Mailer`, `createSmtpMailer`, `createFakeMailer`), `createAuth(env, db, { mailer, waitUntil, onEmailError })`, `packages/auth/src/testing.ts` (`createTestAuth`, `signUpVerified`, `cookieHeaders`), tRPC context with `auth` and `headers`, `store.checkSlug` and `store.create`, web helpers in `apps/web/src/lib/`, auth pages under `app/admin/(auth)/`, `/new` ("Create your store").

### 4.2 Delivered by S1 (services teams foundation)
- Column `team.product`: `text not null default 'store'`, values `'store' | 'services'`. Store-only columns (`status`, `paypal_merchant_id`, `support_email`) stay on `team`; `paypal_merchant_id` is also used by services teams (S3).
- Table `services_team_member`: `id` text PK, `team_id` → `team.id` (cascade), `user_id` → `user.id` (cascade), `role` text (`'admin' | 'manager' | 'freelancer'`), `created_at`; unique (`team_id`, `user_id`).
- Table `services_team_settings`: `team_id` text PK → `team.id` (cascade), `currency` (`'USD' | 'EUR'`, default `'USD'`), `team_cut_bps` int default 1500, `management_fee_bps` int default 1000, `quoting_mode` (`'open' | 'assigned' | 'team'`, default `'assigned'`), `payout_mode` (`'manual' | 'rules' | 'automatic'`, default `'manual'`), `settings_saved_at` timestamp null.
- `@jendal-workspace/core`: `ServicesTeamRole`, `ServicesTeamSettings`, `Currency` types; `canServicesTeam(role, action)` permission table; workspace owner or admin counts as services team `admin`.
- Repository `packages/db/src/repositories/services-teams.ts`: `findServicesTeamBySlug`, `getServicesTeamSettings`, `servicesTeamRoleFor(db, teamId, userId)`.
- tRPC router `servicesTeam`: `create`, `get`, `updateSettings`, `listMembers`, `addMember` (by email of an existing user), `setMemberRole`.
- Web: "Create your services team" at `admin.<domain>/new/services-team`; the workspace home lists stores and services teams; `admin.<domain>/{slug}` shows the store dashboard or the services team dashboard by `product`; services team settings page; setup checklist for services teams.

### 4.3 Delivered by S2 (Discord)
- Better Auth Discord social provider; env `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`.
- Column `services_team_settings.discord_guild_id` text unique null; table `discord_link_code`.
- api route `POST /discord/interactions` (Ed25519 verified); command registry `apps/server/src/discord/commands.ts`; `pnpm -F server discord:register`.
- Commands `/payleor link`, `/payouts setup`; `/payouts setup` and the freelancer portal both lead to the payout destination page.
- Table `payout_destination`: `user_id` PK → `user.id`, `paypal_payer_id`, `paypal_email`, `verified_at`.

### 4.4 Delivered by S3 (PayPal client and partner onboarding)
- Package `@jendal-workspace/paypal`: typed `fetch` client with token caching, `PayPal-Request-Id` on every POST, 429 backoff, `debug_id` in errors; modules for partner referrals and merchant integration status. Later plans add orders, payouts, disputes, webhooks to it.
- Partner onboarding for any team (store or services): "Connect PayPal" → return page → status check; writes `team.paypal_merchant_id`; table `paypal_onboarding`.

### 4.5 Delivered by S4 (ledger, projects, quotes)
- Part A (pure `core`, no DB): money math (`payleorFeeMinor`, management fee, team cut, final price, balance, amendment top-up and credits, penalty formula), project state machine, ledger posting builders.
- Part B (DB, after S1): tables `project`, `quote`, `quote_item`, `payment`, `ledger_transfer`, `ledger_entry`, `outbox`; use cases start project, add quote, accept quote; tRPC and web pages for them.

### 4.6 Delivered by S5 (catalog)
- Commerce catalog per the platform spec and the sponsor spec (Channel3). Owns its tables; touches no services tables.
