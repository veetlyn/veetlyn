# H Hosts and First Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, one task at a time) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks marked **[Mouhamed]** are his alone (accounts, secrets, DNS, PayPal dashboard): stop and ask, never do them.

**Goal:** Payleor runs on its own hosts in the PayPal sandbox: production on `payleor.com`, `dash.payleor.com`, `api.payleor.com` and `*.payleor.app`, deployed on every push to main; a staging stage on `staging.payleor.com` hosts for branches; the admin host renamed `dash.`; the security audit's main findings fixed.

**Architecture:** Alchemy deploys two named stages, `production` and `staging`, from one `alchemy.run.ts`. A pure `deployedHosts(stage)` in `packages/infra/deploy-hosts.ts` gives each stage its domains, Worker custom domains and routes, and the dash origin, so no host is a free-form secret. The platform app label `dash` replaces `admin`; `admin.` hosts 301 to `dash.` in the web proxy. A GitHub Actions `Deploy` workflow migrates the stage's database, then runs the stage's deploy script, with secrets held in GitHub environments.

**Tech Stack:** Alchemy 2.0.0-beta.80 (Effect), Cloudflare Workers (Workers Paid), Hyperdrive to Aiven Postgres, Vinext (Next.js on Workers), drizzle-kit, GitHub Actions, Vitest.

**Spec:** [program](../2026-10-13-agentic-surfaces-program.md) §4 (H) and §6 item 6 (hosts); [architecture](../2026-10-16-architecture.md) §2; [security audit](../2026-10-16-security-audit.md) A1–A5; [agentic dash design](../2026-10-16-agentic-dash-design.md) §10 (H Oct 16–17). Backlog rows owned by H in [`BACKLOG.md`](../../BACKLOG.md).

**Base:** main at `d1f59f1`. Branch `h-hosts-deploy`, worktree `worktrees/h-hosts-deploy`, test database `jendal_test_h` (`docker exec jendal-pg createdb -U postgres jendal_test_h`; copy `.env.test.local` into the worktree and point `TEST_DATABASE_URL` at it). Never push to main.

**Runs in parallel with A2** (cloud, branch `a2-client-contacts`). A2 edits `packages/api` use cases, `client-links.ts`, the admin project pages and `pay-page.tsx`. This plan avoids those files; the identifier and folder rename (`adminOrigin`, `app/admin/`) waits for A2's merge (Task 11).

**Conventions:** Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tests first at the owner boundary under the test-audit gate. Per task: `npx vitest run <paths>`; before each commit `pnpm check-types` and `pnpm lint` (0 findings). Never edit while Vitest runs. Never print, log or commit secrets: check whether a value is set with `grep -c '^NAME=.\+' file`, never by echoing it.

---

## Facts the tasks rely on (main at `d1f59f1`)

- **Never deployed.** No deploy commit exists; `README.md:103-110` still holds the scaffold's deploy text, including a `CORS_ORIGIN` line the code no longer reads (audit A5).
- **The dev tunnel owns the production hosts.** `packages/infra/.env` has `TUNNEL_DOMAIN=payleor.com`, `TUNNEL_STORE_DOMAIN=payleor.app`; `packages/infra/.tunnel/config.yml` routes `api.payleor.com`, `payleor.com`, `*.payleor.com` and `*.payleor.app` to localhost. Worker custom domains cannot attach while DNS records for the same names exist, so the tunnel's records go before the production deploy (Task 9).
- **Stack:** `packages/infra/alchemy.run.ts` — stack `jendal-workspace`, state in Cloudflare (`Cloudflare.state()` `:158`); `server` Worker `:82-123` with a 10-minute cron and the `PayPalWebhooks` queue consumer `:165-169`; `Web` (`Cloudflare.Website.Vinext`) `:128-150`, bound to `server` as `SERVER`. Local stages are chosen by `JENDAL_LOCAL_STAGE` (`:14`); deployed stages read `PLATFORM_DOMAIN`, `STORE_DOMAIN`, `BETTER_AUTH_URL` from env (`:17-20`, `:94`). R2 `Files` CORS allows the platform and admin origins (`:59-74`).
- **Alchemy props (from `node_modules/alchemy/lib/Cloudflare`):** `WorkerProps.domain?: string | { name; aliases?; redirects?; zoneId? }` (custom domains, DNS and certificate managed; `redirects` 301 to `name`, path kept), `WorkerProps.routes?: { pattern; zoneId?; zoneName? }[]`; `VinextProps` extends `WorkerProps` minus build fields, so `Web` takes both. `Cloudflare.DNS.Record(id, { zoneId, name, type, content, proxied?, comment? })`. Credentials from `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; `ALCHEMY_PASSWORD` encrypts secrets in state (`packages/infra/.env.schema:5`).
- **Infra scripts:** `packages/infra/package.json` — `deploy: alchemy deploy`, local `dev`/`dev:preprod` wrap `varlock run --`. Root `pnpm deploy` runs it through turbo.
- **Hosts in code:** `packages/core/src/tenancy/target.ts` — `PlatformApp = "www" | "admin" | "api" | "mcp"` `:3`, `PLATFORM_APPS` `:14-19`. `apps/web/src/lib/host-routing.ts` rewrites the `admin` app to `/admin` `:23`; `apps/web/src/proxy.ts:11-18` handles `pass`, `not-found`, `rewrite`. `apps/web/src/lib/platform-url.ts:8` builds `{ site, admin }`; callers `apps/web/src/lib/server-api.ts:31`, `app/(site)/layout.tsx:9` (`SiteHeader adminOrigin`), `app/admin/new/services-team/page.tsx:15`. `packages/infra/dev-hosts.ts:43-56` builds `admin.` origins for local stages. Server: `apps/server/src/services.ts:39-44` — `siteOrigin` is `BETTER_AUTH_URL.replace("://admin.", "://")`; `storeOriginFor` in `apps/server/src/store-origin.ts`. `packages/auth/src/testing.ts:9` uses `http://admin.localhost:3001`.
- **Reserved slugs** include `staging`, `dev`, `preview`, `sandbox` (`packages/core/src/tenancy/slug.ts:27-30`), so `staging.payleor.app` can never be a seller.
- **Cookies:** Better Auth sets no cookie domain (`packages/auth/src/index.ts` has no `crossSubDomainCookies`), so cookies are host-only and staging never receives production sessions.
- **Env set locally** (values not read): `apps/server/.env` has `PAYPAL_WEBHOOK_ID`, `PAYPAL_PARTNER_ID`, `RESEND_API_KEY`, `PAYOUT_CREDENTIALS_KEY`, `DISCORD_BOT_TOKEN`, `CHANNEL3_API_KEY` set, `PLATFORM_DOMAIN=payleor.com`, `BETTER_AUTH_URL=https://payleor.com` (wrong for a deploy; Task 3 derives it), `PAYPAL_ENVIRONMENT=sandbox`, `DATABASE_URL` on Aiven with `sslmode=require`; `STORE_DOMAIN` and `EMAIL_DOMAIN` empty.
- **Migrations:** `packages/db/drizzle.config.ts` reads `DATABASE_URL`; `pnpm -F @jendal-workspace/db db:migrate` runs `drizzle-kit migrate` (postgres.js; `sslmode=require` encrypts without CA pinning). Latest migration `20261014003246_a1_action_log`.
- **CI:** `.github/workflows/ci.yml` — one `check` job, actions on tags `@v4` `:33-35`, no `permissions:` (audit A3).
- **Sandbox banner:** `apps/web/src/app/layout.tsx:33` renders `<SandboxBanner />` (default variant) on every page; `apps/web/src/lib/sandbox-banner.ts` `sandboxBannerContent(variant, settings)`; no page renders the checkout variant (backlog row). The web Worker has no `PAYPAL_ENVIRONMENT` binding.
- **Audit code sites:** `packages/core/src/payouts/payouts-web.ts:22-24` `csvCell`, note `Payout from ${team.name} via Payleor`; `apps/server/src/catalog/image-downloader.ts:13-14` buffers before the size check; `packages/api/src/use-cases/orders.ts:486` compares hashes with `!==`.
- **Logger:** `apps/server/src/index.ts:40-42` `initLogger({ env: { service: "jendal-api" } })`, no environment.
- **New users:** `apps/web/src/lib/auth-flow.ts:2` `VERIFIED_EMAIL_REDIRECT = "/new"`; `apps/web/src/app/admin/page.tsx:21` redirects users without organizations to `/new` (the store form). The seller setup with "Just me" / "A team" is `/new/services-team`.
- **Vitest** includes `packages/*/src/**`, `apps/server/src/**`, `apps/web/src/**` (`vitest.config.ts`), not `packages/infra/*.test.ts`.

## Decisions for this run (Mouhamed, 2026-10-16)

- **Dev after H:** localhost for daily work (`dash.localhost:3001`), plus a `staging` stage deployed from any branch for checks that need public hosts (plugins in Claude and ChatGPT, PayPal webhooks, browser walkthroughs before merge). The tunnel is retired.
- **Staging hosts** sit one label down: `staging.payleor.com`, `dash.staging.payleor.com`, `api.staging.payleor.com`, and `{slug}.staging.payleor.app` for the slugs listed in `STAGING_STORE_SLUGS`. Each is a Worker custom domain with its own certificate, because Universal SSL does not cover two-level names and Advanced Certificate Manager costs money. Production uses a wildcard route for `*.payleor.app`.
- **Deploys:** production on every push to main once CI passes; staging by hand (`workflow_dispatch` on a branch).
- **Database:** the Aiven database in `DATABASE_URL` becomes production; its contents may be wiped. Staging gets a second database, `jendal_staging`, in the same Aiven service.
- **`admin.` hosts** 301 to `dash.` with the path kept, so links in emails already sent keep working.
- **Landing copy** (old fee, old wording; backlog row) moves to run V, which redesigns the landing page; H fixes only where new users land.

## File map

- Create `packages/infra/deploy-hosts.ts` (+ `deploy-hosts.test.ts`): `DeployedStage`, `parseDeployedStage`, `deployedHosts`, `storeSlugsFrom`. Modify `packages/infra/alchemy.run.ts`, `packages/infra/dev-hosts.ts`, `packages/infra/package.json`, `packages/infra/.env.schema`, `vitest.config.ts`.
- Modify `packages/core/src/tenancy/target.ts` (+ test): the `dash` app.
- Modify `apps/web/src/lib/host-routing.ts` (+ test), `apps/web/src/proxy.ts`, `apps/web/src/lib/platform-url.ts` (+ test), `apps/web/src/lib/server-api.ts`, `apps/web/src/app/(site)/layout.tsx`, `apps/web/src/components/site/site-header.tsx`, `apps/web/src/app/admin/new/services-team/page.tsx`.
- Modify `apps/server/src/store-origin.ts` (+ test): `siteOriginFor`; `apps/server/src/services.ts`; `apps/server/src/index.ts` (logger environment); `packages/auth/src/testing.ts`.
- Modify `apps/web/src/lib/sandbox-banner.ts` (+ test), `apps/web/src/components/sandbox-banner.tsx`; create `apps/web/src/components/sandbox-checkout-help.tsx`; modify `apps/web/src/app/(site)/pay/[token]/page.tsx`, `apps/web/src/app/store/buy/[productId]/page.tsx`.
- Modify `packages/core/src/payouts/payouts-web.ts` (+ test), `apps/server/src/catalog/image-downloader.ts` (+ test), `packages/api/src/use-cases/orders.ts`.
- Modify `apps/web/src/lib/auth-flow.ts`, `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/new/services-team/page.tsx`.
- Create `.github/workflows/deploy.yml`; modify `.github/workflows/ci.yml`; modify `README.md`.
- Specs: `specs/PROGRESS.md`, `specs/platform/2026-10-16-architecture.md`, `specs/stories/README.md`, `CLAUDE.md`, `specs/BACKLOG.md`.

---

### Task 1: [Mouhamed] Accounts, databases and secrets

Nothing in this task is done by an agent. The agent lists it, waits, then checks only what it can see without secrets.

- [ ] **Step 1: Cloudflare.** Confirm the zones `payleor.com` and `payleor.app` are in the account. Create an API token for the deploy with: Account — Workers Scripts Edit, Workers KV Storage Edit, Workers R2 Storage Edit, Queues Edit, Hyperdrive Edit, Account Settings Read; Zone (both zones) — Workers Routes Edit, DNS Edit, Zone Read, Dynamic Redirect (Single Redirect) Edit. Note the account ID and the zone ID of `payleor.app`.
- [ ] **Step 2: Aiven.** Check the service's plan keeps it running while idle until Dec 15 (free plans can power off; if so, choose the smallest plan that does not). Create the database `jendal_staging` in the same service.
- [ ] **Step 3: PayPal sandbox app.** Rename the partner app from "Test Store" to Payleor (AGT-08). Keep the existing webhook (`https://api.payleor.com/webhooks/paypal`, its ID is the production `PAYPAL_WEBHOOK_ID`); add a second webhook `https://api.staging.payleor.com/webhooks/paypal` with the same events and note its ID for staging. In the app's Log in with PayPal settings, add the return URLs `https://dash.payleor.com/api/auth/callback/paypal` and `https://dash.staging.payleor.com/api/auth/callback/paypal` (sign-in sends the dash host as `redirect_uri`; found in Task 2).
- [ ] **Step 4: Discord app.** Add the OAuth redirect URIs `https://dash.payleor.com/api/auth/callback/discord` and `https://dash.staging.payleor.com/api/auth/callback/discord` next to the existing ones (the interactions endpoint stays on production).
- [ ] **Step 5: GitHub.** Create the environments `production` (deployment branches: `main` only) and `staging` (any branch). In each, set the secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD`, `DATABASE_URL` (production: the Aiven default database; staging: `jendal_staging`), `BETTER_AUTH_SECRET` (a different one per stage), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PARTNER_ID`, `PAYPAL_ATTRIBUTION_ID`, `PAYPAL_WEBHOOK_ID` (per stage), `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `RESEND_API_KEY`, `CHANNEL3_API_KEY`, `PAYOUT_CREDENTIALS_KEY`; and the variables: `PAYPAL_ENVIRONMENT=sandbox`, `CLOUDFLARE_STORE_ZONE_ID` (production only), `STAGING_STORE_SLUGS` (staging only, e.g. `walk-crew`), `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`, `SANDBOX_CARD_NUMBER`, `SANDBOX_CARD_EXPIRY`, `SANDBOX_CARD_CVV`, `DEMO_STORE_SLUG`.
- [ ] **Step 6: Agent check.** `gh api repos/payleor/payleor/environments --jq '.environments[].name'` lists `production` and `staging`; `gh secret list --env production` and `--env staging` list the names above (names only, never values).

### Task 2: The `dash` host

**Files:** `packages/core/src/tenancy/target.ts`, `target.test.ts`; `apps/web/src/lib/host-routing.ts`, `host-routing.test.ts`; `apps/web/src/proxy.ts`; `apps/web/src/lib/platform-url.ts`, `platform-url.test.ts`; `apps/web/src/lib/server-api.ts`; `apps/web/src/app/(site)/layout.tsx`; `apps/web/src/components/site/site-header.tsx`; `apps/web/src/app/admin/new/services-team/page.tsx`; `apps/server/src/store-origin.ts`, `store-origin.test.ts`; `apps/server/src/services.ts`; `packages/infra/dev-hosts.ts`; `packages/auth/src/testing.ts`.

- [ ] **Step 1: Failing tests.**

In `packages/core/src/tenancy/target.test.ts`, add `["dash.payleor.app", "dash"]` to the platform-app table next to `["admin.payleor.app", "admin"]` (line 17; `admin` stays an app so the web can redirect it), and next to line 85:

```ts
expect(parseSplit("dash.payleor.app")).toEqual({ kind: "platform", app: "dash" });
```

In `apps/web/src/lib/host-routing.test.ts`, replace the test "rewrites the admin host into /admin" with:

```ts
it("rewrites the dash host into the dashboard tree", () => {
  expect(route("https://dash.payleor.app/")).toEqual({ kind: "rewrite", pathname: "/admin" });
  expect(route("https://dash.payleor.app/acme/orders")).toEqual({ kind: "rewrite", pathname: "/admin/acme/orders" });
});

it("redirects the old admin host to the dash host, keeping the path and query", () => {
  expect(route("https://admin.payleor.app/acme/orders?tab=open")).toEqual({
    kind: "redirect",
    location: "https://dash.payleor.app/acme/orders?tab=open",
  });
  expect(route("http://admin.localhost:3001/login", { platformDomain: "localhost", storeDomain: "localhost" })).toEqual({
    kind: "redirect",
    location: "http://dash.localhost:3001/login",
  });
});
```

and in "blocks direct requests for the internal route trees on every host" replace `"https://admin.payleor.app/admin"` with `"https://dash.payleor.app/admin"`.

In `apps/web/src/lib/platform-url.test.ts`, replace every `admin:` key with `dash:` and every `admin.` host in expected values and inputs with `dash.` (e.g. `platformOrigins("localhost", "dash.localhost:3001")` → `{ site: "http://localhost:3001", dash: "http://dash.localhost:3001" }`).

In `apps/server/src/store-origin.test.ts`, add:

```ts
describe("siteOriginFor", () => {
  it("drops the dash label from the dash origin", () => {
    expect(siteOriginFor("https://dash.payleor.com")).toBe("https://payleor.com");
    expect(siteOriginFor("https://dash.staging.payleor.com")).toBe("https://staging.payleor.com");
    expect(siteOriginFor("http://dash.localhost:3001")).toBe("http://localhost:3001");
  });
});
```

(import `siteOriginFor` next to `storeOriginFor`).

- [ ] **Step 2: Run them and see them fail.** `npx vitest run packages/core/src/tenancy/target.test.ts apps/web/src/lib/host-routing.test.ts apps/web/src/lib/platform-url.test.ts apps/server/src/store-origin.test.ts` — expected: failures on `dash` (unknown app), `redirect` (no such kind), `dash:` keys and the missing `siteOriginFor` export.

- [ ] **Step 3: Implement.**

`packages/core/src/tenancy/target.ts`:

```ts
export type PlatformApp = "www" | "dash" | "admin" | "api" | "mcp";
```

and in `PLATFORM_APPS` add `["dash", "dash"],` before `["admin", "admin"],`, with the comment above the map extended: `// "admin" is the dashboard's old host; the web app redirects it to "dash".`

`apps/web/src/lib/host-routing.ts`:

```ts
export type HostRoute =
  | { kind: "pass" }
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; location: string }
  | { kind: "not-found" };
```

and in the `platform` case:

```ts
      if (target.app === "dash") return { kind: "rewrite", pathname: `/admin${suffix}` };
      if (target.app === "admin") {
        const location = new URL(url);
        location.hostname = `dash.${url.hostname.slice("admin.".length)}`;
        return { kind: "redirect", location: location.href };
      }
```

`apps/web/src/proxy.ts`, add to the switch:

```ts
    case "redirect":
      return NextResponse.redirect(route.location, 301);
```

`apps/web/src/lib/platform-url.ts`:

```ts
export type PlatformOrigins = { site: string; dash: string };

// Same rule as storeUrlParts: local stages use http and keep the port; deployed hosts use https.
export function platformOrigins(platformDomain: string, requestHost: string): PlatformOrigins {
  const local = platformDomain === "localhost";
  const port = local ? (/:\d+$/.exec(requestHost)?.[0] ?? "") : "";
  const scheme = local ? "http://" : "https://";
  return { site: `${scheme}${platformDomain}${port}`, dash: `${scheme}dash.${platformDomain}${port}` };
}
```

Update the callers: `app/(site)/layout.tsx` destructures `dash` and renders `<SiteHeader dashOrigin={dash} />`; `components/site/site-header.tsx` takes `{ dashOrigin }` and links `${dashOrigin}/login` and `${dashOrigin}/signup`; `app/admin/new/services-team/page.tsx` passes `adminOrigin={origins.dash}` (the form's prop name changes in Task 11).

`apps/server/src/store-origin.ts`, add:

```ts
// The site lives on the platform domain itself; the dash origin is the same host with the dash label.
export function siteOriginFor(dashOrigin: string): string {
  return dashOrigin.replace("://dash.", "://");
}
```

`apps/server/src/services.ts:35-44`: comment becomes "links in emails point at the site and dash origins derived from BETTER_AUTH_URL (http://dash.localhost:3001 in dev, https://dash.payleor.com in production)", and `siteOrigin: siteOriginFor(adminOrigin),` (import it from `./store-origin`).

`packages/infra/dev-hosts.ts`: rename `StageUrls.admin` to `dash` and build `https://dash.${tunnel.domain}` / `http://dash.localhost:${PORTS[stage].web}`; in `alchemy.run.ts` use `localUrls.dash` at `:60` and `:94`. `packages/auth/src/testing.ts:9`: `BETTER_AUTH_URL: "http://dash.localhost:3001"`.

- [ ] **Step 4: Run them and see them pass,** then `npx vitest run packages/auth apps/server/src/routes` (auth and the onboarding return read `BETTER_AUTH_URL`) — expected: pass.

- [ ] **Step 5: Commit.** `git commit -m "feat(web): serve the dashboard on dash. and redirect admin. to it"`

### Task 3: Deployed hosts in Alchemy

**Files:** create `packages/infra/deploy-hosts.ts`, `packages/infra/deploy-hosts.test.ts`; modify `vitest.config.ts`, `packages/infra/alchemy.run.ts`, `packages/infra/package.json`, `packages/infra/.env.schema`, root `package.json`.

- [ ] **Step 1: Include infra tests.** In `vitest.config.ts` add `"packages/infra/*.test.ts"` to `include`.

- [ ] **Step 2: Failing test** `packages/infra/deploy-hosts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deployedHosts, parseDeployedStage, storeSlugsFrom } from "./deploy-hosts.ts";

describe("deployedHosts", () => {
  it("serves production on the apex domains with a wildcard store route", () => {
    const hosts = deployedHosts("production", ["walk-crew"]);
    expect(hosts.platformDomain).toBe("payleor.com");
    expect(hosts.storeDomain).toBe("payleor.app");
    expect(hosts.dashOrigin).toBe("https://dash.payleor.com");
    expect(hosts.web.domain).toEqual({
      name: "payleor.com",
      aliases: ["dash.payleor.com", "admin.payleor.com"],
      redirects: ["www.payleor.com"],
    });
    expect(hosts.web.routes).toEqual([{ pattern: "*.payleor.app/*", zoneName: "payleor.app" }]);
    expect(hosts.api.domain).toBe("api.payleor.com");
    expect(hosts.fileOrigins).toEqual(["https://payleor.com", "https://dash.payleor.com"]);
  });

  // A staging route on a production zone would take over production's seller sites.
  it("keeps staging off the production hosts: named store hosts, no routes", () => {
    const hosts = deployedHosts("staging", ["walk-crew", "acme"]);
    expect(hosts.platformDomain).toBe("staging.payleor.com");
    expect(hosts.storeDomain).toBe("staging.payleor.app");
    expect(hosts.dashOrigin).toBe("https://dash.staging.payleor.com");
    expect(hosts.web.domain.aliases).toEqual([
      "dash.staging.payleor.com",
      "admin.staging.payleor.com",
      "walk-crew.staging.payleor.app",
      "acme.staging.payleor.app",
    ]);
    expect(hosts.web.routes).toEqual([]);
    expect(hosts.api.domain).toBe("api.staging.payleor.com");
  });
});

describe("parseDeployedStage and storeSlugsFrom", () => {
  it("accepts only the two deployed stages", () => {
    expect(parseDeployedStage("production")).toBe("production");
    expect(parseDeployedStage("staging")).toBe("staging");
    expect(parseDeployedStage("prod")).toBeUndefined();
    expect(parseDeployedStage(undefined)).toBeUndefined();
  });

  it("reads a comma list of slugs and refuses a slug that is not a valid host label", () => {
    expect(storeSlugsFrom(" walk-crew, acme ,")).toEqual(["walk-crew", "acme"]);
    expect(storeSlugsFrom(undefined)).toEqual([]);
    expect(() => storeSlugsFrom("walk-crew,a.b")).toThrow(/STAGING_STORE_SLUGS/);
  });
});
```

- [ ] **Step 3: Run it and see it fail.** `npx vitest run packages/infra/deploy-hosts.test.ts` — expected: cannot resolve `./deploy-hosts.ts`.

- [ ] **Step 4: Implement** `packages/infra/deploy-hosts.ts`:

```ts
// Hosts of the deployed stages. Production owns the apex domains; staging sits one label down, where
// Universal SSL does not reach, so every staging host is a Worker custom domain with its own certificate
// (seller sites only for the slugs listed in STAGING_STORE_SLUGS) and staging adds no zone routes.

export type DeployedStage = "production" | "staging";

const PLATFORM_ZONE = "payleor.com";
const STORE_ZONE = "payleor.app";
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type DeployedHosts = {
  platformDomain: string;
  storeDomain: string;
  dashOrigin: string;
  web: {
    domain: { name: string; aliases: string[]; redirects: string[] };
    routes: { pattern: string; zoneName: string }[];
  };
  api: { domain: string };
  fileOrigins: string[];
};

export function parseDeployedStage(value: string | undefined): DeployedStage | undefined {
  return value === "production" || value === "staging" ? value : undefined;
}

export function storeSlugsFrom(value: string | undefined): string[] {
  const slugs = (value ?? "").split(",").map((slug) => slug.trim()).filter((slug) => slug !== "");
  const bad = slugs.find((slug) => !HOST_LABEL.test(slug));
  if (bad) throw new Error(`STAGING_STORE_SLUGS has "${bad}", which is not a host label.`);
  return slugs;
}

export function deployedHosts(stage: DeployedStage, stagingStoreSlugs: readonly string[]): DeployedHosts {
  const prefix = stage === "production" ? "" : "staging.";
  const platformDomain = `${prefix}${PLATFORM_ZONE}`;
  const storeDomain = `${prefix}${STORE_ZONE}`;
  const storeHosts = stage === "production" ? [] : stagingStoreSlugs.map((slug) => `${slug}.${storeDomain}`);
  return {
    platformDomain,
    storeDomain,
    dashOrigin: `https://dash.${platformDomain}`,
    web: {
      domain: {
        name: platformDomain,
        // admin. stays attached so the web app can redirect it to dash. with the path.
        aliases: [`dash.${platformDomain}`, `admin.${platformDomain}`, ...storeHosts],
        redirects: [`www.${platformDomain}`],
      },
      routes: stage === "production" ? [{ pattern: `*.${storeDomain}/*`, zoneName: STORE_ZONE }] : [],
    },
    api: { domain: `api.${platformDomain}` },
    fileOrigins: [`https://${platformDomain}`, `https://dash.${platformDomain}`],
  };
}
```

- [ ] **Step 5: Run it and see it pass.**

- [ ] **Step 6: Wire it into `alchemy.run.ts`.** After `localUrls` (`:16`):

```ts
const deployStage = parseDeployedStage(process.env.JENDAL_DEPLOY_STAGE);
if (!localStage && !deployStage) {
  throw new Error("Run a local stage (pnpm dev) or deploy with pnpm deploy:staging or pnpm deploy:production.");
}
const hosts = deployStage ? deployedHosts(deployStage, storeSlugsFrom(process.env.STAGING_STORE_SLUGS)) : undefined;
```

Replace `platformDomain`, `storeDomain` and `platformOrigins` (`:17-20`, `:59-61`) with (the empty strings are unreachable after the check above; they avoid a non-null assertion):

```ts
const platformDomain = localUrls ? localUrls.platformDomain : hosts ? hosts.platformDomain : "";
const storeDomain = localUrls ? localUrls.storeDomain : hosts ? hosts.storeDomain : "";
const dashOrigin = localUrls ? localUrls.dash : hosts ? hosts.dashOrigin : "";
const platformOrigins = localUrls ? [localUrls.platform, localUrls.dash] : hosts ? hosts.fileOrigins : [];
```

In `server.env`: `BETTER_AUTH_URL: dashOrigin,`. Add to `server` props: `domain: hosts?.api.domain,`. Add to `Web` props: `domain: hosts?.web.domain, routes: hosts?.web.routes,`, and to `Web.env`: `PAYPAL_ENVIRONMENT: Config.String("PAYPAL_ENVIRONMENT"),` (Task 4 reads it). In the stack effect, before `const web = yield* Web;`:

```ts
    if (deployStage === "production") {
      // Seller sites: the web Worker's *.payleor.app route needs a proxied record to receive requests.
      yield* Cloudflare.DNS.Record("StoreWildcard", {
        zoneId: yield* Config.String("CLOUDFLARE_STORE_ZONE_ID"),
        name: "*.payleor.app",
        type: "AAAA",
        content: "100::",
        proxied: true,
        comment: "Seller sites, served by the web Worker's route",
      });
    }
```

Import `deployedHosts`, `parseDeployedStage`, `storeSlugsFrom` from `./deploy-hosts.ts`. If `dev:preprod` or `dev` with the tunnel still reads `STORE_DOMAIN`/`PLATFORM_DOMAIN` through `Config`, those paths are now gone: local stages always use `localUrls`.

- [ ] **Step 7: Scripts and schema.** `packages/infra/package.json`: replace `"deploy": "alchemy deploy"` and `"destroy"` with

```json
    "deploy:staging": "JENDAL_DEPLOY_STAGE=staging varlock run -- alchemy deploy --stage staging",
    "deploy:production": "JENDAL_DEPLOY_STAGE=production varlock run -- alchemy deploy --stage production",
    "destroy:staging": "JENDAL_DEPLOY_STAGE=staging varlock run -- alchemy destroy --stage staging",
```

(no production destroy script on purpose). Root `package.json`: replace `deploy`/`destroy` with `"deploy:staging": "pnpm -F @jendal-workspace/infra deploy:staging"` and `"deploy:production": "pnpm -F @jendal-workspace/infra deploy:production"`. `packages/infra/.env.schema`: add, after `ALCHEMY_PASSWORD=`,

```
# Deploy credentials (GitHub environments in CI; your shell or this file for a deploy from your machine).
CLOUDFLARE_API_TOKEN=
# @public
CLOUDFLARE_ACCOUNT_ID=
# Zone of payleor.app, for the seller-site wildcard record (production only).
# @public
CLOUDFLARE_STORE_ZONE_ID=
# Seller slugs served on staging as {slug}.staging.payleor.app, comma-separated.
# @public
STAGING_STORE_SLUGS=
```

- [ ] **Step 8: Check.** `pnpm check-types` (the `domain`/`routes`/`DNS.Record` props type-check against Alchemy), `pnpm lint`, `npx vitest run packages/infra apps/web/src/lib`. Then `pnpm dev` still starts both local Workers on `localhost:3001`/`dash.localhost:3001` (stop it before the next task).

- [ ] **Step 9: Commit.** `git commit -m "feat(infra): production and staging stages on Payleor's hosts"`

### Task 4: Sandbox notice only in the sandbox; test logins on checkout pages

Audit A4 and the backlog row "the checkout variant is built but no page renders it".

**Files:** `apps/web/src/lib/sandbox-banner.ts`, `sandbox-banner.test.ts`; `apps/web/src/components/sandbox-banner.tsx`; create `apps/web/src/components/sandbox-checkout-help.tsx`; `apps/web/src/app/(site)/pay/[token]/page.tsx`; `apps/web/src/app/store/buy/[productId]/page.tsx`.

- [ ] **Step 1: Failing tests.** In `sandbox-banner.test.ts`, add `PAYPAL_ENVIRONMENT: "sandbox",` to `all`, and:

```ts
  it("shows nothing outside the PayPal sandbox", () => {
    expect(sandboxBannerContent("default", { ...all, PAYPAL_ENVIRONMENT: "live" })).toBeNull();
    expect(sandboxBannerContent("checkout", { ...all, PAYPAL_ENVIRONMENT: "live" })).toBeNull();
  });
```

- [ ] **Step 2: Run and see it fail** (`npx vitest run apps/web/src/lib/sandbox-banner.test.ts`).

- [ ] **Step 3: Implement.** In `sandbox-banner.ts`, add `PAYPAL_ENVIRONMENT?: string;` to `SandboxSettings`, change the return type to `SandboxBannerContent | null`, and start the function with:

```ts
  // The notice says no real money moves; on a live deployment that would be false.
  if (settings.PAYPAL_ENVIRONMENT !== "sandbox") return null;
```

`components/sandbox-banner.tsx` becomes the notice only:

```tsx
import { env } from "cloudflare:workers";

import { sandboxBannerContent } from "@/lib/sandbox-banner";

// Rendered by the root layout on every host. It cannot be dismissed (spec §4.3).
export default function SandboxBanner() {
  const content = sandboxBannerContent("default", env);
  if (!content) return null;
  return (
    <aside
      aria-label="Sandbox notice"
      className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <p>{content.text}</p>
    </aside>
  );
}
```

`components/sandbox-checkout-help.tsx`:

```tsx
import { env } from "cloudflare:workers";

import { sandboxBannerContent } from "@/lib/sandbox-banner";

// Next to the PayPal buttons on checkout pages: the sandbox buyer login and test card judges pay with.
export default function SandboxCheckoutHelp() {
  const content = sandboxBannerContent("checkout", env);
  if (content?.kind !== "checkout") return null;
  return (
    <section
      aria-label="Sandbox test payment details"
      className="mx-auto mt-6 w-full max-w-md rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <p className="font-medium">Pay with a sandbox test account</p>
      <dl className="mt-2 grid gap-1 text-xs">
        <div className="flex gap-2">
          <dt className="font-medium">PayPal buyer</dt>
          <dd className="font-mono">
            {content.buyer.email} / {content.buyer.password}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Test card</dt>
          <dd className="font-mono">
            {content.card.number} · {content.card.expiry} · CVV {content.card.cvv}
          </dd>
        </div>
      </dl>
    </section>
  );
}
```

`app/(site)/pay/[token]/page.tsx`:

```tsx
import SandboxCheckoutHelp from "@/components/sandbox-checkout-help";

import PayPage from "./pay-page";

export default async function PayRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <PayPage token={token} />
      <SandboxCheckoutHelp />
    </>
  );
}
```

`app/store/buy/[productId]/page.tsx`: render `<SandboxCheckoutHelp />` after the existing page content in the same way (read the file first; keep its data loading unchanged).

- [ ] **Step 4: Run and see it pass;** `pnpm check-types`.
- [ ] **Step 5: Commit.** `git commit -m "fix(web): sandbox notice only in the sandbox; test logins beside checkout"`

### Task 5: Audit quick fixes (A1, A2, A5)

**Files:** `packages/core/src/payouts/payouts-web.ts`, `payouts-web.test.ts`; `apps/server/src/catalog/image-downloader.ts`, `image-downloader.test.ts`; `packages/api/src/use-cases/orders.ts`; `README.md`.

- [ ] **Step 1: Failing tests.** In `payouts-web.test.ts`, after "writes PayPal's upload rows without a header, quoting a note with a comma" (it uses the file's `row` fixture), add:

```ts
  // The note carries the team's name, and admins open this file in a spreadsheet before uploading it.
  it("keeps a note that starts like a formula from running in a spreadsheet", () => {
    expect(payoutsWebCsv([{ ...row, note: '=HYPERLINK("http://x")' }, { ...row, note: "+1-2" }])).toBe(
      [
        `BUYER1PAYERID,24.50,USD,PL7K2M9Q4XR1AB,"'=HYPERLINK(""http://x"")",PAYPAL`,
        "BUYER1PAYERID,24.50,USD,PL7K2M9Q4XR1AB,'+1-2,PAYPAL",
      ].join("\r\n"),
    );
  });
```

In `image-downloader.test.ts`, add:

```ts
  it("stops reading a body larger than the image limit", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const downloader = createHttpImageDownloader(async () => new Response(body, { headers: { "content-type": "image/png" } }));

    expect(await downloader.download("https://cdn.example.com/huge.png")).toBeNull();
    expect(pulled).toBeLessThanOrEqual(MAX_IMAGE_BYTES + chunk.byteLength * 2);
  });
```

- [ ] **Step 2: Run and see them fail** (`npx vitest run packages/core/src/payouts/payouts-web.test.ts apps/server/src/catalog/image-downloader.test.ts`; the stream test hangs or fails without the cap — the 20 s test timeout bounds it).

- [ ] **Step 3: Implement.** `payouts-web.ts`:

```ts
// A spreadsheet runs a cell starting with one of these as a formula; the note carries the team's name.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
```

`image-downloader.ts`, replace the `arrayBuffer()` line and size check with a capped read:

```ts
        const bytes = await readCapped(response, MAX_IMAGE_BYTES);
        if (!bytes || bytes.byteLength === 0) return null;
```

and add below the factory:

```ts
// Reads the body until it passes the cap, so a huge image never sits whole in memory.
async function readCapped(response: Response, cap: number): Promise<ArrayBuffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
```

`orders.ts:486`: compare with the timing-safe helper the client links already use. Find it with `grep -rn "timingSafe\|constantTime" packages/api/src packages/core/src`; if it compares strings, use it (`!(await …)` / `!…(a, b)` as its signature requires); if none takes two hex strings, add to `packages/api/src/use-cases/orders.ts`:

```ts
// Hashes are fixed-length hex, so comparing every character leaks nothing through timing.
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

and write `if (!row || !sameHash(await hashToken(input.secret), row.checkoutSecretHash)) throw invalidCheckout();`. The existing checkout router tests cover a wrong secret; run `npx vitest run packages/api/src/routers/checkout.test.ts`.

`README.md`: replace the "Production origins" section and the `alchemy deploy --stage production` paragraph (`:103-110`) with:

```md
### Deploys

Production deploys from GitHub Actions on every push to main once CI passes (`.github/workflows/deploy.yml`); staging deploys by hand from the Actions tab ("Deploy", choose the branch and `staging`). From a machine with the deploy settings in `packages/infra/.env`: `pnpm deploy:staging` or `pnpm deploy:production`. Hosts are fixed per stage in `packages/infra/deploy-hosts.ts`; there is no CORS setting (the web Worker reaches the api Worker through a service binding).
```

- [ ] **Step 4: Run and see them pass;** `pnpm check-types`, `pnpm lint`.
- [ ] **Step 5: Commit.** `git commit -m "fix: neutralize CSV formulas, cap image downloads, compare checkout hashes in constant time"`

### Task 6: New users land on the seller setup; logs name their stage

**Files:** `apps/web/src/lib/auth-flow.ts`; `apps/web/src/app/admin/page.tsx`; `apps/web/src/app/admin/new/services-team/page.tsx`; `apps/server/src/index.ts`; `packages/infra/alchemy.run.ts`.

- [ ] **Step 1:** `auth-flow.ts:2`: `export const VERIFIED_EMAIL_REDIRECT = "/new/services-team";`. `app/admin/page.tsx:21`: `redirect("/new/services-team")`. In `app/admin/new/services-team/page.tsx`, below the form, add `<p className="text-sm text-muted-foreground">Selling digital products? <Link href="/new" className="underline-offset-4 hover:underline">Create a store</Link>.</p>` (import `Link` from `next/link` if not imported). `grep -rn "VERIFIED_EMAIL_REDIRECT\|\"/new\"" apps/web/src packages/auth/src` and update any test that expects `/new`.
- [ ] **Step 2: Logs.** In `alchemy.run.ts` `server.env`, add `DEPLOY_STAGE: deployStage ?? localStage ?? "dev",`; in `apps/server/src/env.ts`/`.env.schema` add `DEPLOY_STAGE` as a public enum `production, staging, dev, preprod` with default `dev` (follow how `PAYPAL_ENVIRONMENT` is declared, then `pnpm env:generate`); `apps/server/src/index.ts:40`: `initLogger({ env: { service: "jendal-api", environment: ENV.DEPLOY_STAGE } });` (check evlog's `env` type accepts `environment`: `grep -n "environment" node_modules/evlog/dist/*.d.ts | head`; if not, put it in `service` as `jendal-api-${ENV.DEPLOY_STAGE}`).
- [ ] **Step 3:** `pnpm check-types`, `pnpm lint`, `npx vitest run apps/web/src packages/auth`.
- [ ] **Step 4: Commit.** `git commit -m "feat: new sellers start at the seller setup; api logs name their stage"`

### Task 7: Deploy workflow and CI hardening (A3)

**Files:** create `.github/workflows/deploy.yml`; modify `.github/workflows/ci.yml`.

- [ ] **Step 1: Pin the actions.** Get the commit SHAs: `gh api repos/actions/checkout/commits/v4 --jq .sha`, `gh api repos/pnpm/action-setup/commits/v4 --jq .sha`, `gh api repos/actions/setup-node/commits/v4 --jq .sha`, `gh api repos/gitleaks/gitleaks-action/commits/v2 --jq .sha`. Use them below as `uses: actions/checkout@<sha> # v4`.

- [ ] **Step 2: `ci.yml`.** Add at the top level `permissions:\n  contents: read`; pin the three actions; give checkout `fetch-depth: 0` (gitleaks scans history); after `pnpm install --frozen-lockfile` add:

```yaml
      - run: pnpm audit --prod --audit-level high
      - uses: gitleaks/gitleaks-action@<sha> # v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Run `pnpm audit --prod --audit-level high` locally first; if it fails on an existing advisory, record the package and advisory in the PR and in Build notes, and lower to `--audit-level critical` rather than block every PR (Mouhamed decides on upgrades).

- [ ] **Step 3: `deploy.yml`:**

```yaml
name: Deploy

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      stage:
        description: Stage to deploy the chosen branch to
        type: choice
        options: [staging, production]
        default: staging

permissions:
  contents: read

concurrency:
  group: deploy-${{ github.event_name == 'workflow_dispatch' && inputs.stage || 'production' }}
  cancel-in-progress: false

jobs:
  deploy:
    # Production: only after CI passed on a push to main. The production environment only accepts main.
    if: github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push')
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: ${{ github.event_name == 'workflow_dispatch' && inputs.stage || 'production' }}
    env:
      STAGE: ${{ github.event_name == 'workflow_dispatch' && inputs.stage || 'production' }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      ALCHEMY_PASSWORD: ${{ secrets.ALCHEMY_PASSWORD }}
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
      PAYPAL_ENVIRONMENT: ${{ vars.PAYPAL_ENVIRONMENT }}
      PAYPAL_CLIENT_ID: ${{ secrets.PAYPAL_CLIENT_ID }}
      PAYPAL_CLIENT_SECRET: ${{ secrets.PAYPAL_CLIENT_SECRET }}
      PAYPAL_PARTNER_ID: ${{ secrets.PAYPAL_PARTNER_ID }}
      PAYPAL_ATTRIBUTION_ID: ${{ secrets.PAYPAL_ATTRIBUTION_ID }}
      PAYPAL_WEBHOOK_ID: ${{ secrets.PAYPAL_WEBHOOK_ID }}
      DISCORD_CLIENT_ID: ${{ secrets.DISCORD_CLIENT_ID }}
      DISCORD_CLIENT_SECRET: ${{ secrets.DISCORD_CLIENT_SECRET }}
      DISCORD_APP_ID: ${{ secrets.DISCORD_APP_ID }}
      DISCORD_PUBLIC_KEY: ${{ secrets.DISCORD_PUBLIC_KEY }}
      DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}
      RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
      CHANNEL3_API_KEY: ${{ secrets.CHANNEL3_API_KEY }}
      PAYOUT_CREDENTIALS_KEY: ${{ secrets.PAYOUT_CREDENTIALS_KEY }}
      CLOUDFLARE_STORE_ZONE_ID: ${{ vars.CLOUDFLARE_STORE_ZONE_ID }}
      STAGING_STORE_SLUGS: ${{ vars.STAGING_STORE_SLUGS }}
      SANDBOX_BUYER_EMAIL: ${{ vars.SANDBOX_BUYER_EMAIL }}
      SANDBOX_BUYER_PASSWORD: ${{ vars.SANDBOX_BUYER_PASSWORD }}
      SANDBOX_CARD_NUMBER: ${{ vars.SANDBOX_CARD_NUMBER }}
      SANDBOX_CARD_EXPIRY: ${{ vars.SANDBOX_CARD_EXPIRY }}
      SANDBOX_CARD_CVV: ${{ vars.SANDBOX_CARD_CVV }}
      DEMO_STORE_SLUG: ${{ vars.DEMO_STORE_SLUG }}
    steps:
      - uses: actions/checkout@<sha> # v4
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}
      - uses: pnpm/action-setup@<sha> # v4
      - uses: actions/setup-node@<sha> # v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
      - run: pnpm deploy:${{ env.STAGE }}
```

If Task 8's first deploy shows the Alchemy CLI needs Bun, add `oven-sh/setup-bun` pinned to a SHA before install.

- [ ] **Step 4:** `npx --yes @action-validator/cli .github/workflows/deploy.yml .github/workflows/ci.yml` (or `actionlint` if installed) — expected: no errors. Commit: `git commit -m "ci: deploy workflow for production and staging; pin actions, scan dependencies and secrets"`.

### Task 8: First staging deploy and smoke check

- [ ] **Step 1: [Mouhamed]** From the worktree, with the Task 1 values in `packages/infra/.env` (staging `DATABASE_URL` pointing at `jendal_staging`, `STAGING_STORE_SLUGS`, Cloudflare token and account ID): `DATABASE_URL=<staging url> pnpm db:migrate`, then `pnpm deploy:staging`. (The workflow cannot run from a branch until `deploy.yml` is on main.) Keep the output; it lists the Worker URLs.
- [ ] **Step 2: Smoke (agent, browser tool):** `https://staging.payleor.com` shows the landing page and the sandbox notice; `https://www.staging.payleor.com` 301s to it; `https://admin.staging.payleor.com/login` 301s to `https://dash.staging.payleor.com/login`; sign up on `dash.staging…` with a fresh email (verification email arrives with a `dash.staging.payleor.com` link) and land on the seller setup ("Just me" / "A team"); create the team with a slug from `STAGING_STORE_SLUGS` and open `https://{slug}.staging.payleor.app`; `https://api.staging.payleor.com/webhooks/paypal` answers a `GET` with 404/405 (the route exists for POST only), not a Cloudflare error.
- [ ] **Step 3: Webhook check.** In the PayPal sandbox app, send a test event to the staging webhook; in Cloudflare's logs for the staging api Worker the request arrives (mock events fail postback verification by design — `r1-paypal-facts.md` §4 — so a logged verification refusal is the expected outcome).
- [ ] **Step 4:** Record what failed and what was changed in **Build notes**; fix on the branch, redeploy staging, repeat Step 2.

### Task 9: Production cutover

- [ ] **Step 1:** Push the branch and open the pull request "feat: hosts and first deploy (H)" (body: tasks delivered, the staging smoke results, the cutover steps below). CI must be green.
- [ ] **Step 2: [Mouhamed]** Stop `pnpm tunnel`. In Cloudflare DNS, delete the tunnel's records: `payleor.com`, `*.payleor.com`, `api.payleor.com` (zone payleor.com) and `*.payleor.app` (zone payleor.app). In `packages/infra/.env`, empty `TUNNEL_DOMAIN` and `TUNNEL_STORE_DOMAIN`. Migrate the production database: `DATABASE_URL=<production url> pnpm db:migrate` (the workflow does it on later deploys).
- [ ] **Step 3: [Mouhamed]** Merge the pull request. CI runs on main, then **Deploy** runs for production.
- [ ] **Step 4: Check (agent):** `gh run list --workflow Deploy --limit 1` shows success; repeat Task 8 Step 2 on the production hosts (`payleor.com`, `dash.payleor.com`, `admin.payleor.com` → dash, `{slug}.payleor.app` for a new team, `api.payleor.com`).

### Task 10: Docs for the new environment

**Files:** `specs/PROGRESS.md` (Environment section, the tunnel steps at `:69`, the walkthrough rule at `:53`), `specs/platform/2026-10-16-architecture.md` §2 (hosts table: today = production; staging hosts; `admin.` redirects), `specs/stories/README.md` (`{dash}` and the hosts for walkthroughs: production after merge, staging before), `CLAUDE.md` ("Claude Code cloud sessions": the tunnel is gone; browser checks use staging or production), `specs/BACKLOG.md` (move the H rows to `archive/backlog-done.md` with the merge commit; the landing copy row's owner becomes V).

- [ ] **Step 1:** Make those edits; run `python3 /path/to/check_links.py` or `grep -rn "admin.payleor.com\|pnpm tunnel" specs CLAUDE.md` and fix every live (non-archive) mention.
- [ ] **Step 2: Commit on main** (spec edits): `git commit -m "docs(specs): environment after the first deploy"`.

### Task 11: Rename the dashboard tree and identifiers (after A2 merges)

Done on `h-dash-tree`, branched from `h-hosts-deploy` instead of main because H also edits `host-routing.ts`; checked on staging 2026-10-17 (`/login` renders on the dash host, `/dash` and `/admin` paths 404, `admin.` redirects).

On a short branch `h-dash-tree` from main once A2 is merged, so A2's edits to the admin pages and `requests.ts` are not in conflict.

- [x] **Step 1:** `git mv apps/web/src/app/admin apps/web/src/app/dash`; in `apps/web/src/lib/host-routing.ts` rewrite to `/dash${suffix}` and change `INTERNAL_ROUTE_TREES` to `["dash", "admin", "store"]` (keep `admin` blocked); update `host-routing.test.ts` expectations (`/dash`, `/dash/acme/orders`, the blocked-tree list adds `https://dash.payleor.app/dash`).
- [x] **Step 2:** Rename `adminOrigin` to `dashOrigin` everywhere: `grep -rln "adminOrigin" apps packages | xargs sed -i 's/adminOrigin/dashOrigin/g'`, then review the diff (`packages/api/src/context.ts`, `use-cases/requests.ts`, `apps/server/src/services.ts`, `store-origin.ts`, the services-team form). Replace `admin.localhost` with `dash.localhost` in tests: `grep -rln "admin\.localhost\|admin\.payleor" apps packages --include=*.ts --include=*.tsx`.
- [x] **Step 3:** `pnpm check-types`, `pnpm lint`, `pnpm test` (full suite: the rename touches many files). Commit `refactor(web): the dashboard tree and origins are named dash`; pull request; Mouhamed merges.

### Task 12: Walkthrough on production

- [ ] **Step 1:** Run AGT-07 and AGT-08 from [`stories/09-agentic.md`](../../stories/09-agentic.md) on the production hosts with a browser tool. [human] Mouhamed approves the payment in the PayPal popup (AGT-07 step 4) and reads the PayPal consent screen (AGT-08 step 2).
- [ ] **Step 2:** Check in the production database (through `pnpm db:studio` with the production `DATABASE_URL`, run by Mouhamed, or the dash pages) that the payment is captured and the webhook event is recorded.
- [ ] **Step 3:** Mark AGT-07 and AGT-08 Walked through (date) in the stories; fill the Outcome below; move this plan to `archive/` per `specs/README.md`.

## Build notes

- **Task 1 URLs (Task 2):** Log in with PayPal and Discord sign-in send `{dash origin}/api/auth/callback/{provider}` as `redirect_uri`, so those exact URLs must be registered; Task 1 Steps 3–4 now say so.
- **Task 2:** the landing page (`app/(site)/page.tsx:76`) also read `origins.admin`; switched to `dash`. `apps/server/.env.schema` documents `BETTER_AUTH_URL` as the dash origin.
- **Task 3:** the turbo `deploy`/`destroy` tasks were removed from `turbo.json` (the root scripts call the infra package directly). Checked locally: with `TUNNEL_DOMAIN=payleor.com` the dev stage serves `dash.payleor.com` and 301s `admin.payleor.com/login?x=1` to `https://dash.payleor.com/login?x=1`; with the tunnel settings empty, `localhost:3001` and `dash.localhost:3001/login` answer 200 and `admin.localhost:3001` 301s to `dash.localhost`.
- **Task 6:** `DEPLOY_STAGE` is a new public server variable (`apps/server/.env.schema`), set by `alchemy.run.ts`; evlog takes it as `env.environment`.
- **Task 7:** `gitleaks/gitleaks-action` needs a paid license for organization accounts, so CI runs the `zricethezav/gitleaks:v8.30.1` image (`ghcr.io` refused the pull locally). History scan: one finding, a test constant in an archived plan's code sample, listed in `.gitleaksignore`. `pnpm audit --prod` found seroval (critical and high, through better-auth > solid-js, unused) and braces (high, build-time through vinext, no patched version): seroval is overridden to 1.6.3 in `pnpm-workspace.yaml`, and CI fails on critical advisories only. Workflows pass `actionlint` 1.7.7.
- **Cutover (2026-10-20, Claude Code with Mouhamed approving):** the production environment had no secrets or variables (Task 1 Step 5 was done for staging only); it now holds the Step 5 list from the local env files, with a new `BETTER_AUTH_SECRET` and `ALCHEMY_PASSWORD`, `DATABASE_URL` on the Aiven database `jendal` (empty before; `defaultdb` was also empty), `PAYPAL_ENVIRONMENT=sandbox`, `CLOUDFLARE_STORE_ZONE_ID` and the sandbox buyer login (buyer 1; no test card values exist locally). The tunnel was stopped and its four DNS records (`payleor.com`, `*.payleor.com`, `api.payleor.com`, `*.payleor.app`) deleted (backup of their content kept outside the repo). Three deploy fixes: #10 (`turbo` refuses the interactive `db:migrate` in CI; the workflow calls `drizzle-kit migrate` directly), #11 (varlock requires `BETTER_AUTH_URL`; now an environment variable per stage), #12 (Alchemy's state store token lives in the account's Secrets Store, which the deploy token cannot read; CI now gets the credentials Alchemy's OAuth login cached, as the `ALCHEMY_STATE_STORE_CREDENTIALS` secret in both environments). The deploy for `2035821` succeeded. Smoke without sign-in: `payleor.com` 200 with the sandbox notice, `www.` 301 to the apex, `admin.payleor.com/login?x=1` 301 to `dash.payleor.com/login?x=1`, `dash.payleor.com/login` 200, `api.payleor.com` 200, `/sitemap.xml` and `/llms.txt` 200; seller hosts 404 until a seller exists (empty database). Follow-up: replace the cached state store credentials with a dedicated, per-stage token that can read the state store.

## Outcome

(Empty until the walkthrough passes.)
