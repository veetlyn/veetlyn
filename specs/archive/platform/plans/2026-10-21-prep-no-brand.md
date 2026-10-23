# Prep: no brand in source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remove every "payleor" from source code: code says `platform`, the name people read comes from `PLATFORM_NAME`, domains come from environment variables, and a check keeps it that way.

**Architecture:** one environment variable `PLATFORM_NAME` (value `Payleor`) set per stage like `PLATFORM_DOMAIN`, read by the server and web Workers through varlock and passed down as a dependency; the web app exposes it to server components with a helper and to client components with a context provider. Identifiers and the ledger account key are renamed (a data migration updates stored rows). Infra zones become variables. A `check-no-brand` script runs inside `pnpm lint`.

**Tech stack:** varlock env schemas, Alchemy (`packages/infra`), vinext/React (`apps/web`), Hono and tRPC (`apps/server`, `packages/api`), Drizzle migrations, MDX content.

**Design:** [`../../../platform/2026-10-21-b1-operating-model-design.md`](../../../platform/2026-10-21-b1-operating-model-design.md) §7. **Base:** main `68fd697`. **Branch:** `prep-no-brand`. **Worktree:** `worktrees/prep-no-brand`. **Test database:** `jendal_test_prep`. **Stories:** none new; a smoke on staging (Task 9). Mouhamed: testing beyond the existing suites waits for later (2026-10-21), so this plan adds only the brand check and updates existing tests.

---

## Facts (main `68fd697`)

- 752 lines in 189 files mention the name (case-insensitive) outside `*.md` and the generated bridge; 350 user-facing lines in non-test files; hotspots: `apps/web/src/app` (30 files), `apps/web/src/content` (16: blog MDX and `posts.ts`, legal MDX, policies TSX, `site/faqs.ts`, `site/nav.ts`), `apps/web/src/components` (14), `packages/api/src/use-cases` (9), `apps/server/src/mcp` (5), `packages/core` (9), `packages/db` (6), `packages/paypal` (5), `apps/server/src/discord` (2), `scripts/build-plugin-zips.ts`, `packages/ui/src/styles` (1).
- Identifiers: `ledgerAccounts.payleorFees` = `"payleor_fees"` (`packages/core/src/ledger/accounts.ts:11,22,39,46`; used in `postings.ts:17,47,83` and tests); `payleorMinor` (`apps/web/src/lib/site/examples.ts:48,65,82`, landing pages, `examples.test.ts`); `payleorLinks` (`apps/web/src/app/store/layout.tsx:15,37`); `PAYLEOR_LINKS` (`apps/web/src/components/site/site-footer.tsx:7,36`); tone `"payleor"` (`studios/page.tsx:22`).
- `payleor_fees` is a **ledger account key stored as data**: `ledger_entry.account` and `ledger_balance.account` (text, `packages/db/src/schema/ledger.ts:44,64`). Renaming the key needs a data migration.
- `PAYLEOR_BN` appears only in tests (21 lines) as a fixture value.
- Infra: `packages/infra/deploy-hosts.ts:7-8` hardcodes `PLATFORM_ZONE = "payleor.com"` and `STORE_ZONE = "payleor.app"`; `alchemy.run.ts` names `*.payleor.app` and `*.staging.payleor.app` (5 lines); `dev-hosts.ts`, `scripts/tunnel.ts`, `.env.schema` comments.
- Env: varlock schemas `apps/server/.env.schema`, `apps/web/.env.schema`, `packages/infra/.env.schema`, `packages/db/.env.schema`; `apps/server/src/env.ts` is generated from the schema (`@generateTsTypes`). Deploy vars come from GitHub environment variables (`.github/workflows/deploy.yml:37-57`). The web reads env from `cloudflare:workers` (`apps/web/src/proxy.ts`, `lib/server-api.ts:31`).
- `pnpm lint` is `oxlint` (`package.json:16`).

## Rules for the sweep

- **Identifier or comment** → `platform` (`payleorFees` → `platformFees`, "Payleor holds the fee" → "The platform holds the fee").
- **Text a person reads** → the name from `PLATFORM_NAME`: `platformName()` in server code, `usePlatformName()` in client components, `{name}` passed into pure helpers in `packages/core` and `packages/api`, `<PlatformName />` in MDX.
- **Domain or URL** → the existing variables (`PLATFORM_DOMAIN`, `STORE_DOMAIN`) or values derived from them; never a literal.
- **Test fixture** → `platform.test` domains, `"Platform"` as the name (the test env sets `PLATFORM_NAME=Platform`).
- **Kept:** `specs/**`, `*.md` docs, `plugins/payleor/**` (the published plugin's identity), `LICENSE`, lockfiles, generated files (fix their source instead).

---

### Task 1: Worktree and the brand check

**Files:**
- Create: `scripts/check-no-brand.mjs`
- Modify: `package.json` (`lint` script)

- [x] **Step 1: Worktree and test database**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git worktree add ../prep-no-brand -b prep-no-brand
cd ../prep-no-brand && pnpm install
cp ../main/.env.test.local .env.test.local
sed -i 's#/jendal_test[A-Za-z0-9_]*#/jendal_test_prep#' .env.test.local
cp ../main/apps/server/.env apps/server/.env 2>/dev/null || true
```

- [x] **Step 2: Write the check**

`scripts/check-no-brand.mjs`:

```js
// Fails when tracked source mentions the product name. The name people read comes from PLATFORM_NAME.
import { execFileSync } from "node:child_process";

// Docs, the published plugin, generated files and migrations (history) keep the name.
const KEPT = [/^specs\//, /\.md$/, /^plugins\//, /^LICENSE/, /(^|\/)pnpm-lock\.yaml$/, /\.generated\.ts$/, /(^|\/)src\/env\.ts$/, /\/drizzle\/.*\.sql$/];

let out = "";
try {
  out = execFileSync("git", ["grep", "-n", "-I", "-i", "payleor", "--", "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // git grep exits 1 when nothing matches.
  out = "";
}
const hits = out === "" ? [] : out.split("\n").filter((line) => !KEPT.some((rule) => rule.test(line.split(":")[0] ?? "")));
if (hits.length > 0) {
  console.error(`${hits.length} line(s) name the product in source; use platform, PLATFORM_NAME or the domain variables:\n${hits.join("\n")}`);
  process.exit(1);
}
```

- [x] **Step 3: Wire it into lint**

In `package.json`: `"lint": "oxlint && node scripts/check-no-brand.mjs"`.

- [x] **Step 4: Run it and keep the count**

Run: `node scripts/check-no-brand.mjs | tail -1; node scripts/check-no-brand.mjs 2>&1 | head -1`
Expected: exit 1 with about 750 lines listed. The count falls to 0 by Task 8.

- [x] **Step 5: Commit**

```bash
git add scripts/check-no-brand.mjs package.json
git commit -m "chore: check that source never names the product"
```

### Task 2: `PLATFORM_NAME` in every environment

**Files:**
- Modify: `apps/server/.env.schema`, `apps/web/.env.schema`, `packages/infra/.env.schema`, `packages/infra/alchemy.run.ts:112,164`, `.github/workflows/deploy.yml` (env block), `.env.test.local` handling in the test setup if it builds env, the ignored local env files.

- [x] **Step 1: Schemas.** Add to `apps/server/.env.schema` and `apps/web/.env.schema`, next to `PLATFORM_DOMAIN`:

```
# The product name people read in the UI, emails and the plugin. Renaming the product is a change to this value.
# @public @type=string
PLATFORM_NAME=
```

and in `packages/infra/.env.schema` (required, not public):

```
# The product name, passed to both Workers.
# @type=string
PLATFORM_NAME=
```

Remove the product name from these schemas' comments (for example "e.g. payleor.app" becomes "e.g. example.app"). Run `pnpm -F server exec varlock typegen 2>/dev/null || pnpm install` so `apps/server/src/env.ts` regenerates.

- [x] **Step 2: Infra.** In `packages/infra/alchemy.run.ts`, add `PLATFORM_NAME: Config.String("PLATFORM_NAME"),` to both Workers' `env` blocks (beside `PLATFORM_DOMAIN`). In `.github/workflows/deploy.yml` add `PLATFORM_NAME: ${{ vars.PLATFORM_NAME }}` to the job env.

- [x] **Step 3: Values.** Local and deployed values (no product name enters the repo):

```bash
gh variable set PLATFORM_NAME --env production --body "Payleor"
gh variable set PLATFORM_NAME --env staging --body "Payleor"
for f in apps/server/.env packages/infra/.env; do grep -q '^PLATFORM_NAME=' $f || echo 'PLATFORM_NAME=Payleor' >> $f; done
grep -q '^PLATFORM_NAME=' .env.test.local || echo 'PLATFORM_NAME=Platform' >> .env.test.local
```

Add `PLATFORM_NAME=Platform` the same way to CI's test env in `.github/workflows/ci.yml` (its `env:` block).

- [x] **Step 4: Check types.** Run: `pnpm check-types` — Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add apps/server/.env.schema apps/web/.env.schema packages/infra/.env.schema apps/server/src/env.ts packages/infra/alchemy.run.ts .github/workflows/deploy.yml .github/workflows/ci.yml
git commit -m "feat(infra): PLATFORM_NAME in every environment"
```

### Task 3: Read the name in the apps

**Files:**
- Create: `apps/web/src/lib/platform.ts`, `apps/web/src/components/platform-name.tsx`
- Modify: `apps/web/src/app/layout.tsx` (root layout), `apps/server/src/services.ts` (deps), `packages/api/src/context.ts` (deps type), `packages/email/src/*` (sender display name)

- [x] **Step 1: Web, server side.** `apps/web/src/lib/platform.ts`:

```ts
import { env } from "cloudflare:workers";
import { z } from "zod";

// The product name people read; set per stage (PLATFORM_NAME).
export function platformName(): string {
  return z.string().min(1).parse(env.PLATFORM_NAME);
}
```

- [x] **Step 2: Web, client side.** `apps/web/src/components/platform-name.tsx`:

```tsx
"use client";
import { createContext, type ReactNode, useContext } from "react";

const PlatformNameContext = createContext<string | null>(null);

export function PlatformNameProvider({ name, children }: { name: string; children: ReactNode }) {
  return <PlatformNameContext.Provider value={name}>{children}</PlatformNameContext.Provider>;
}

export function usePlatformName(): string {
  const name = useContext(PlatformNameContext);
  if (name === null) throw new Error("usePlatformName needs PlatformNameProvider above it.");
  return name;
}

// For MDX and server-rendered copy inside client trees.
export function PlatformName() {
  return <>{usePlatformName()}</>;
}
```

In the root layout, wrap the body's children: `<PlatformNameProvider name={platformName()}>{children}</PlatformNameProvider>`, and set `metadata` titles from `platformName()`.

- [x] **Step 3: MDX.** Register `PlatformName` in the MDX components map (the file that passes components to the blog and legal renderers; find it with `git grep -n "useMDXComponents\|components={" apps/web/src`).

- [x] **Step 4: Server and api.** In `apps/server/src/services.ts`, add `platformName: ENV.PLATFORM_NAME` to the services/deps object built there, add `platformName: string` to the deps type in `packages/api/src/context.ts` (and `McpDeps` in `apps/server/src/mcp/tools.ts`), and pass it into the email sender (display name `${platformName}`) where `packages/email/src/senders.ts` builds the from-name.

- [x] **Step 5: Check types.** Run: `pnpm check-types` — Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add -A apps/web/src/lib/platform.ts apps/web/src/components/platform-name.tsx apps/web/src/app apps/server/src packages/api/src/context.ts packages/email/src
git commit -m "feat: read the platform name from PLATFORM_NAME"
```

### Task 4: Identifiers and the ledger key

**Files:**
- Modify: `packages/core/src/ledger/accounts.ts:11,22,39,46`, `packages/core/src/ledger/postings.ts:17,47,83`, every test using `payleorFees` or `"payleor_fees"`, `apps/web/src/lib/site/examples.ts:48,65,82`, `apps/web/src/lib/site/examples.test.ts`, the three landing pages, `apps/web/src/app/store/layout.tsx`, `apps/web/src/components/site/site-footer.tsx`
- Create: a Drizzle migration in `packages/db/drizzle/`

- [x] **Step 1: Rename.**

```bash
git grep -l -e payleorFees -e payleor_fees -e payleorMinor -e payleorLinks -e PAYLEOR_LINKS -e PAYLEOR_BN -- apps packages | xargs sed -i \
  -e 's/payleorFees/platformFees/g' -e 's/payleor_fees/platform_fees/g' -e 's/payleorMinor/platformMinor/g' \
  -e 's/payleorLinks/platformLinks/g' -e 's/PAYLEOR_LINKS/PLATFORM_LINKS/g' -e 's/PAYLEOR_BN/PLATFORM_BN/g'
sed -i 's/tone: "payleor"/tone: "platform"/' "apps/web/src/app/(site)/(landing)/studios/page.tsx"
git grep -n 'tone === "payleor"\|"payleor" ' -- apps/web/src | head
```

Rename any matching tone value in the component that reads it the same way.

- [x] **Step 2: Data migration.** Run `pnpm db:generate --custom --name platform_fees_account` (Drizzle custom migration) and fill it:

```sql
UPDATE "ledger_entry" SET "account" = 'platform_fees' WHERE "account" = 'payleor_fees';
--> statement-breakpoint
UPDATE "ledger_balance" SET "account" = 'platform_fees' WHERE "account" = 'payleor_fees';
```

Check the table names with `git grep -n 'pgTable("ledger' packages/db/src/schema/ledger.ts` first and use those. Migrations keep the old key (the check exempts `drizzle/*.sql` as history).

- [x] **Step 3: Tests.** Run: `npx vitest run packages/core packages/api/src/routers/payment.test.ts packages/api/src/use-cases/paypal-webhooks.test.ts apps/web/src/lib/site` — Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add -A packages apps
git commit -m "refactor: platform, not the product name, in identifiers and the ledger key"
```

### Task 5: Infra zones from variables

**Files:**
- Modify: `packages/infra/deploy-hosts.ts:7-8`, `packages/infra/deploy-hosts.test.ts`, `packages/infra/alchemy.run.ts` (zone names, opt-out route pattern), `packages/infra/dev-hosts.ts`, `packages/infra/scripts/tunnel.ts`, `packages/infra/.env.schema`, `.github/workflows/deploy.yml`

- [x] **Step 1: Variables.** Replace the two constants with parameters:

```ts
export type Zones = { platformZone: string; storeZone: string };

export function deployedHosts(stage: DeployedStage, stagingStoreSlugs: readonly string[], zones: Zones): DeployedHosts {
  const prefix = stage === "production" ? "" : "staging.";
  const platformDomain = `${prefix}${zones.platformZone}`;
  const storeDomain = `${prefix}${zones.storeZone}`;
  // …the rest unchanged, with STORE_ZONE replaced by zones.storeZone in `routes`
}
```

In `alchemy.run.ts`, read `PLATFORM_ZONE` and `STORE_ZONE` from `process.env` (decode with zod, both required for a deploy), pass them to `deployedHosts`, and build the wildcard DNS name and the opt-out pattern from them: `` `*.${zones.storeZone}` `` and `` `*.staging.${zones.storeZone}/*` ``. Add both to `packages/infra/.env.schema` and the deploy workflow env (`${{ vars.PLATFORM_ZONE }}`, `${{ vars.STORE_ZONE }}`), and set them:

```bash
for e in production staging; do gh variable set PLATFORM_ZONE --env $e --body "payleor.com"; gh variable set STORE_ZONE --env $e --body "payleor.app"; done
```

- [x] **Step 2: Tests.** In `deploy-hosts.test.ts`, call `deployedHosts(stage, slugs, { platformZone: "platform.test", storeZone: "platform-store.test" })` and change the expected hosts to match. Run: `npx vitest run packages/infra` — Expected: PASS.

- [x] **Step 3: Dev hosts and tunnel.** Replace remaining literals in `dev-hosts.ts` and `scripts/tunnel.ts` with values read from their env (`TUNNEL_DOMAIN` etc. already exist) or comments without the name.

- [x] **Step 4: Commit**

```bash
git add -A packages/infra .github/workflows/deploy.yml
git commit -m "refactor(infra): zones come from PLATFORM_ZONE and STORE_ZONE"
```

### Task 6: Copy in the api, core, db, paypal, server and scripts

**Files:** every non-web file listed by `node scripts/check-no-brand.mjs` under `packages/` and `apps/server/` and `scripts/`.

- [x] **Step 1: List.** Run: `node scripts/check-no-brand.mjs 2>&1 | grep -v '^apps/web' | cut -d: -f1 | sort | uniq -c`
- [x] **Step 2: Comments** become "the platform". **Strings people read** take the name from deps: a use case builds its text with `deps.platformName`; a pure helper in `packages/core` takes `name: string` as a parameter; MCP tool and widget text in `apps/server/src/mcp` use `deps.platformName` (tool descriptions are built at server creation, so `buildServer` receives it); PayPal `brand_name`/descriptor fields in `packages/paypal` take the name as a parameter from the caller; Discord messages use the deps name. `scripts/build-plugin-zips.ts` reads `PLATFORM_NAME` from `process.env` for the display name.
- [x] **Step 3: Tests** that assert copy expect `"Platform"` (the test env value). Run: `npx vitest run packages apps/server` — Expected: PASS.
- [x] **Step 4: Commit:** `git commit -am "refactor: copy outside the web app reads the platform name"`

### Task 7: Copy in the web app

**Files:** every `apps/web/` file listed by the check: `app/` (30), `content/` (16), `components/` (14), `lib/` (5).

- [x] **Step 1: Server components** call `platformName()`; **client components** call `usePlatformName()`; **`content/*.ts`** (`site/faqs.ts`, `site/nav.ts`, `blog/posts.ts`) become functions of the name, e.g. `export function faqs(name: string) { return [ … ] }`, and their callers pass `platformName()`; **MDX** (blog, legal) uses `<PlatformName />` in place of the word; **policy TSX** uses `usePlatformName()` or a `name` prop; **domains in copy** use the values from `lib/server-api.ts` (`platformOrigins`) or `env.PLATFORM_DOMAIN`.
- [x] **Step 2:** `packages/ui/src/styles` (1 line): rename the class or variable to `platform`, and its users with it.
- [x] **Step 3: Tests.** Run: `npx vitest run apps/web` — Expected: PASS.
- [x] **Step 4: Commit:** `git commit -am "refactor(web): copy reads the platform name"`

### Task 8: The check passes

- [x] **Step 1:** Run: `pnpm lint` — Expected: oxlint 0 findings and `check-no-brand` exit 0. Fix anything listed with the rules above.
- [x] **Step 2:** Run: `pnpm check-types && npx vitest run` — Expected: all pass.
- [x] **Step 3:** Commit any remaining fixes: `git commit -am "refactor: last product-name mentions"`.

### Task 9: Audits, staging smoke, merge

- [x] **Step 1: Test audit** of every test changed (renames and copy expectations only; the plan adds no tests): record in Outcome.
- [x] **Step 2: Security audit** (`security-audit`, quick, scoped to `origin/main...prep-no-brand`, output `~/security-audit-skill/payleor/run-3`). Focus: env decoding of the new variables, the infra zone inputs (a wrong zone must fail the deploy, not route traffic elsewhere), the ledger data migration.
- [x] **Step 3: Push, PR, staging deploy:** `git push -u origin prep-no-brand`, `gh pr create`, `gh workflow run deploy.yml --ref prep-no-brand -f stage=staging`.
- [x] **Step 4: Smoke on staging:** `payleor.com`-equivalent hosts answer (site, dash sign-in, `walk-crew.staging…`, `/mcp` metadata); the site header, a blog post, the legal terms, the dash, an email (password reset to an AgentMail address) and the plugin's tool list all show "Payleor" from the variable; a staging ledger row reads `platform_fees` (query `ledger_balance` on the staging database).
- [x] **Step 5:** Merge after CI is green (squash), watch the production deploy, repeat the smoke's host checks on production.

## Outcome

**Merged as `c89947d` (PR #17) and deployed to staging and production on 2026-10-22.**

- **Test audit (`test-audit`, 2026-10-22):** 64 test files updated (`+389 / -334` lines); removed test-fixture defaults (`"Platform"`, `"platform.test"`) from `apps/web/src/lib/**` and `apps/web/src/content/**` helpers so production callers must pass `platformSite()` / `platformName()` explicitly and tests supply their own fixtures. Added 1 regression test in `packages/infra/deploy-hosts.test.ts` for invalid `PLATFORM_ZONE` / `STORE_ZONE` values. `167/167` test files (`1,798/1,798` tests) pass.
- **Security audit (`~/security-audit-skill/payleor/run-3`, quick, scoped to `68fd697..de76292`, 2026-10-22):** 0 confirmed findings, 0 needing validation, 3 coverage units covered (`PLATFORM_NAME` / domain env decoding, `PLATFORM_ZONE` / `STORE_ZONE` domain validation in `deployedHosts`, and the `payleor_fees` $\rightarrow$ `platform_fees` ledger migration). Hardened `deployedHosts` (`de76292`) with `checkZone` to reject any zone that is not a multi-label lowercase DNS name.
- **Deploy fixes during Task 9:**
  1. `c2d4638`: Wrapped `UPDATE "ledger_entry"` in `20261021095934_platform_fees_account/migration.sql` with `ALTER TABLE "ledger_entry" DISABLE/ENABLE TRIGGER "ledger_entry_immutable";` so existing rows on staging and production migrate cleanly without tripping `ledger_rows_are_immutable()`.
  2. `8cbd0fc`: Marked `EMAIL_DOMAIN` and `EMAIL_REPLY_TO` `@required=false` in `packages/infra/.env.schema` so `varlock run` lets `alchemy.run.ts` fall back to `PLATFORM_ZONE`; added `next: 16.4.1` to `overrides` and `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` to resolve the two critical advisories (`GHSA-2464-fhr4-w9xw`, `GHSA-673q-mjm6-r5xr`) flagged by `pnpm audit --prod --audit-level critical`.
- **Staging smoke (deploy run `39873592819`):** `staging.payleor.com` (`/`, `/llms.txt`, `/blog/ai-shopping-left-services-out`, `/legal/terms`), `dash.staging.payleor.com/login`, `walk-crew.staging.payleor.app/`, and `api.staging.payleor.com/.well-known/oauth-protected-resource` all returned `200` with `"Payleor"` rendered from `PLATFORM_NAME`; verification and password-reset emails to AgentMail arrived from `Payleor <accounts@payleor.com>` with `"Reset your Payleor password"`; `POST https://api.staging.payleor.com/mcp` (`tools/list`) returned `200` with `"Payleor"` in tool descriptions and `0` occurrences of `"Platform"`; `ledger_balance` (`1` row) and `ledger_entry` (`2` rows) on `payleor-staging` read `platform_fees` (`0` rows with `payleor_fees`).
- **Production deploy and smoke (deploy run `39879712688`):** `payleor.com` (`/`, `/llms.txt`, `/blog/ai-shopping-left-services-out`, `/legal/terms`), `dash.payleor.com/login`, `walk-crew.payleor.app/`, and `api.payleor.com/.well-known/oauth-protected-resource` all returned `200` with `"Payleor"`; `ledger_balance` (`1` row) and `ledger_entry` (`1` row) on `payleor-production` read `platform_fees` (`0` rows with `payleor_fees`).
