# W1-A: Foundations, Tenancy and Store Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant signs in on `admin.localhost`, creates an organization and a store (a Better Auth team), opens that store's dashboard at `admin.localhost/{storeSlug}`, and sees the store on `{storeSlug}.localhost`. The web app runs on vinext, the api Worker reaches Aiven through Hyperdrive, and store lookups are cached in KV.

**Architecture:** A pure `@jendal-workspace/core` package holds the tenancy rules: slugs, hostname parsing, store resolution, the store access rule and the tenant context. Stores are Better Auth teams with `slug`, `status` and `paypalMerchantId` as team additional fields. Our hooks enforce the slug rules on every create and update. The api Worker (Hono) resolves the store for store hosts. The web Worker (vinext, deployed by Alchemy `Website.Vinext`) forwards `/api/*` and `/trpc/*` to the api Worker through a service binding. Its `proxy.ts` rewrites each host into its own route tree (`/admin/…`, `/store/…`, or the marketing pages).

**Tech Stack:** pnpm 10 workspaces, Turborepo, TypeScript 6, Vitest 5, vinext 1.0.1 on Vite 8, React 19, Hono 4.13, tRPC 11.19, Better Auth 1.7.7 (organization plugin with teams, PayPal sign-in), Drizzle ORM 1.0.0-rc.4 with Postgres.js, Aiven for PostgreSQL, Cloudflare Workers, KV, Hyperdrive, Alchemy 2.0.0-beta.80, Effect 4, varlock, evlog 2.30.

**Spec:** [`../2026-10-03-payleor-platform-design.md`](../2026-10-03-payleor-platform-design.md): §2.1, §2.2, §3, §4 (all), §11, §12.1.

**Out of scope (later plans):**
- W1-B: the PayPal REST client and partner onboarding. It also invalidates the KV cache when `status` or `paypalMerchantId` change.
- W1-C: catalog tables and catalog admin, and store settings (rename, branding).
- Week 5: custom-domain provisioning through Cloudflare for SaaS.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/jendal-workspace` (its own git repository).

**Library sources:** cite and read the pinned clones in `/home/mouhamed/dev/repos/jendal/refs/stack/` (read-only). Load the matching skill before each task:

| Task | Skills |
|---|---|
| 1, 13, 18 | `turborepo`, `effect-ts`, `workers-best-practices` |
| 2–5, 11, 12 | `vitest` |
| 6–8 | `drizzle-orm` |
| 9, 10, 16 | `better-auth-best-practices`, `organization-best-practices` |
| 14, 15 | `migrate-to-vinext` |
| all | `review-logging-patterns` when touching evlog |

---

## Facts this plan relies on

Each was checked against the pinned sources. If code fails in a way that contradicts one of them, re-check the cited file before changing the design.

1. **Teams.** `teams: { enabled: true, defaultTeam: { enabled: false } }` enables teams without auto-creating one per organization (`refs/stack/better-auth/packages/better-auth/src/plugins/organization/types.ts:108-178`).
2. **Team schema.** The team adds `memberCount` (number, default 0, not client input). `teamMember` adds `membershipKey` (unique, optional). `session` adds `activeOrganizationId` and `activeTeamId`. `invitation` adds `teamId` (`organization.ts:959-1297`).
3. **Hooks.** `beforeCreateTeam` returns `{ data }`, which is **merged** into the new team. `beforeUpdateTeam` returns `{ data }`, which **replaces** the update (`routes/crud-team.ts:167-213`, `539-594`).
4. **Client input.** Additional fields with `input: false` are removed from the createTeam and updateTeam body schemas, and unknown keys are stripped (`db/to-zod.ts:23`).
5. **Creator membership.** `createTeam` needs `team:create` (owner or admin) and does **not** add the creator as a team member.
6. **Drizzle key matching.** The Drizzle adapter matches tables by model key (`team`, `teamMember`, …) and columns by JS property name (`drizzle-adapter/src/schema-check.ts:9-12`).
7. **Hyperdrive.**
   - `Cloudflare.Hyperdrive.Connection` takes `origin`, `caching: { disabled }`, and a `dev` origin with `sslmode` (`refs/stack/alchemy/packages/alchemy/src/Cloudflare/Hyperdrive/Connection.ts:18-129`).
   - An async Worker can bind it directly in `env` (`Workers/WorkerAsyncBindings.ts:618-623`).
   - In `alchemy dev` the binding passes straight through to the `dev` origin.
8. **Website.Vinext.**
   - It takes `rootDir`, `memo`, `env`, `dev` and `observability`.
   - Its default entry is `worker/index.ts`.
   - It provisions `VINEXT_KV_CACHE` and `CF_VERSION_METADATA` itself.
   - It serves dev on a stable proxy port (`dev.port`) in front of Vite's random port (`Cloudflare/Website/Vinext.ts`; `website/src/content/docs/cloudflare/frontend/vinext.mdx`).
9. **vinext features.**
   - vinext supports `src/proxy.ts` exporting `proxy`, and `NextResponse.rewrite(new URL(path, request.url))` to a path in the same app.
   - `import { env } from "cloudflare:workers"` works in server code.
   - `reactCompiler` in `next.config` is ignored; use `vinext({ react: { compiler: true } })` (`refs/stack/vinext/packages/vinext/src/check.ts:277-293`).
   - `vinext/types` declares `next`, `next/server`, `next/headers` and the other `next/*` modules, so the `next` package is removed.
10. **evlog on Workers.** `withEvlog` from `evlog/workers` wraps `(request, env, ctx, log)` (`refs/stack/evlog/packages/evlog/src/workers/index.ts:198`).
11. **Hono `getPath`.** The `getPath` option decides the path used for routing (`refs/stack/hono/src/hono-base.ts:67-86, 420`).
12. **Local stages and the tunnel** (already in the workspace before Task 1).
    - `pnpm dev` and `pnpm dev:preprod` run `varlock run -- alchemy dev --stage dev|preprod` with `JENDAL_LOCAL_STAGE` set. `varlock run` loads the env before Alchemy starts its sidecar, so the Vite dev server sees `TUNNEL_DOMAIN`. The ports are dev 3000/3001 and preprod 3100/3101, with `strictPort`.
    - `alchemy dev` does not use the Hyperdrive service: the Worker connects to the Hyperdrive `dev` origin itself, and workerd only trusts public CAs, so it cannot open TLS to Aiven (private project CA). Local stages therefore use a local Postgres, `DEV_DATABASE_URL` in `packages/infra/.env`, with `sslmode: "disable"`. Migrate it with `pnpm db:migrate:dev`. Deployed stages use `DATABASE_URL` (Aiven) through the Hyperdrive service.
    - `packages/infra/dev-hosts.ts` holds the ports and URLs.
    - `pnpm tunnel` runs the named tunnel `jendal-local` for the stage in `TUNNEL_STAGE`, on `TUNNEL_DOMAIN` (`elysiumjs.com`). It uses the production layout: `api.D` goes to the api port, and `D` and `*.D` go to the web port. Universal SSL covers `D` and `*.D`.
    - The Worker dev proxy passes the original `Host` through (`@alchemy.run/cloudflare-runtime/src/core/proxy/WorkerProxy.ts:18-24`), so `request.url` shows the public hostname.
    - `alchemy.run.ts` imports `./dev-hosts.ts` with its extension because Node loads it with type stripping. Every tsconfig that type-checks `alchemy.run.ts` needs `allowImportingTsExtensions`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `pnpm-workspace.yaml`, `*/package.json` | Modify | Latest releases (spec §2.2) |
| `vitest.config.ts`, `package.json` | Create, Modify | One Vitest 5 config; `test` script |
| `packages/core/**` | Create | Tenancy domain: slugs, targets, resolution, access, context |
| `packages/db/src/schema/auth.ts` | Modify | Session columns for organizations and teams; relations move out |
| `packages/db/src/schema/organization.ts` | Create | `organization`, `member`, `invitation`, `team` (stores), `team_member` |
| `packages/db/src/schema/stores.ts` | Create | `store_domains` |
| `packages/db/src/schema/auth-relations.ts` | Create | One `authRelations` for every Better Auth table |
| `packages/db/src/health.ts` | Create | `pingDatabase` |
| `packages/db/src/repositories/stores.ts` | Create | Store directory, access lookup, store listing |
| `packages/db/src/testing/*` | Create | Test database reset and fixtures |
| `packages/auth/src/index.ts` | Modify | Organizations, teams as stores, slug hooks, PayPal sign-in |
| `packages/api/src/context.ts`, `store-procedure.ts`, `routers/*` | Modify, Create | `storeProcedure`, `store.listMine`, `store.get`, DB health check |
| `apps/server/src/app-env.ts` | Create | Hono variables type |
| `apps/server/src/tenant/*`, `routes/store-info.ts` | Create | KV cache, tenant middleware, `GET /api/store` |
| `apps/server/src/{index,context,services}.ts`, `.env.schema` | Modify | Per-request DB and auth, Hyperdrive, routing |
| `packages/infra/alchemy.run.ts`, `.env.schema`, `package.json` | Modify | Hyperdrive, KV, server Worker, `Website.Vinext` |
| `packages/infra/dev-hosts.ts` | Modify | Local stage URLs now give the platform domain and admin URL |
| `apps/web/**` | Modify | vinext migration, worker entry, host routing, admin and storefront pages |
| `turbo.json` | Modify | Environment variable list |

---

### Task 0: Local setup (manual, no code)

**Files:** `apps/server/.env`, `.env.test.local` (both gitignored).

- [ ] **Step 1: Create the Aiven database**

  In the Aiven console, create a PostgreSQL service and copy its **Service URI**. It looks like `postgres://avnadmin:<password>@<host>.aivencloud.com:<port>/defaultdb?sslmode=require`.

- [ ] **Step 2: Create a PayPal sandbox app**

  1. Go to developer.paypal.com → Apps & Credentials → Sandbox → Create App, and copy the client ID and secret.
  2. Enable **Log in with PayPal** for the app.
  3. Its return URL must be public HTTPS. Add `https://admin.elysiumjs.com/api/auth/callback/paypal`, which reaches the local dev stage through the tunnel (Step 6). Use email and password sign-in when the tunnel is not running.

- [ ] **Step 3: Fill `apps/server/.env`**

  ```sh
  NODE_ENV=development
  BETTER_AUTH_SECRET=<output of: openssl rand -base64 32>
  BETTER_AUTH_URL=http://admin.localhost:3001
  CORS_ORIGIN=http://localhost:3001
  DATABASE_URL=<Aiven service URI>
  PLATFORM_DOMAIN=localhost
  PAYPAL_ENVIRONMENT=sandbox
  PAYPAL_CLIENT_ID=<sandbox client id>
  PAYPAL_CLIENT_SECRET=<sandbox client secret>
  ```

  `CORS_ORIGIN` is still required by the scaffold's schema. Task 13 removes it.

- [ ] **Step 4: Start a local test database**

  ```bash
  docker run -d --name jendal-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jendal_test -p 54329:5432 postgres:17
  ```

  Create `.env.test.local` at the workspace root:

  ```sh
  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/jendal_test
  ```

  The test setup drops and recreates the `public` schema of this database. It refuses to run unless the database name contains `test`.

- [ ] **Step 5: Connect Alchemy to Cloudflare**

  Run: `pnpm -F @jendal-workspace/infra exec alchemy profile edit --add Cloudflare`
  Expected: Alchemy saves a profile with your Cloudflare account (`refs/stack/alchemy/website/src/content/docs/getting-started.mdx:105`).

- [ ] **Step 6: Check the tunnel (already set up)**

  `cloudflared` is in `~/.local/bin`. The tunnel `jendal-local` exists, and `elysiumjs.com`, `*.elysiumjs.com` and `api.elysiumjs.com` route to it. `packages/infra/.env` (gitignored) holds:

  ```sh
  TUNNEL_DOMAIN=elysiumjs.com
  TUNNEL_STAGE=dev
  ```

  Run: `pnpm tunnel`. It is long-running, so use a separate terminal.
  Expected: it prints the three routes for the dev stage and registers four connections. To expose preprod instead, set `TUNNEL_STAGE=preprod`, then restart `pnpm dev:preprod` and `pnpm tunnel`.

  On a new machine, run `cloudflared tunnel login` (pick `elysiumjs.com`) and then `pnpm tunnel:setup`.

---

### Task 1: Move dependencies to their latest releases

**Files:**
- Modify: `pnpm-workspace.yaml`, `apps/server/package.json`, `apps/web/package.json`, `packages/auth/package.json`, `packages/infra/package.json`

- [ ] **Step 1: Update the catalog**

  In `pnpm-workspace.yaml` `catalog`, change these lines:

  ```yaml
    varlock: 1.21.1
    "@trpc/server": ^11.19.0
    better-auth: 1.7.7
    evlog: ^2.30.0
    "@trpc/client": ^11.19.0
  ```

  `drizzle-orm` stays at `1.0.0-rc.4` (spec §2.2).

- [ ] **Step 2: Update the pinned package versions**

  Make these changes:
  - `apps/server/package.json`: `"hono": "^4.13.12"`.
  - `apps/web/package.json`: `"@trpc/tanstack-react-query": "^11.19.0"`.
  - `packages/auth/package.json`: `"@better-auth/drizzle-adapter": "1.7.7"`.
  - `packages/infra/package.json`, in `devDependencies`:

  ```json
      "@effect/platform-bun": "4.0.0",
      "@effect/platform-node": "4.0.0",
      "@jendal-workspace/config": "workspace:*",
      "alchemy": "2.0.0-beta.80",
      "effect": "4.0.0",
  ```

- [ ] **Step 3: Install and type check**

  Run: `pnpm install && pnpm check-types`
  Expected:
  - The install completes. pnpm may print peer warnings: Alchemy lists `drizzle-orm` 1.0.0-rc.5 as an optional peer. Ignore them.
  - The type check reports `Tasks: 7 successful, 7 total`.

- [ ] **Step 4: Commit**

  ```bash
  git add pnpm-workspace.yaml pnpm-lock.yaml apps/server/package.json apps/web/package.json packages/auth/package.json packages/infra/package.json
  git commit -m "chore: move dependencies to their latest releases"
  ```

---

### Task 2: Vitest for the workspace

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest at the root**

  Run: `pnpm add -Dw vitest@^5.0.3`
  Expected: `vitest` appears in the root `devDependencies`.

- [ ] **Step 2: Create `vitest.config.ts`**

  ```ts
  import { existsSync } from "node:fs";
  import { defineConfig } from "vitest/config";

  if (existsSync(".env.test.local")) {
    process.loadEnvFile(".env.test.local");
  }

  export default defineConfig({
    test: {
      include: ["packages/*/src/**/*.test.ts", "apps/server/src/**/*.test.ts", "apps/web/src/**/*.test.ts"],
      passWithNoTests: true,
      // DB tests share one database, so test files run one at a time.
      fileParallelism: false,
    },
  });
  ```

- [ ] **Step 3: Add the `test` script**

  In the root `package.json` `scripts`, add this after `"check-types"`:

  ```json
      "test": "vitest run",
  ```

- [ ] **Step 4: Run it**

  Run: `pnpm test`
  Expected: `No test files found, exiting with code 0`.

- [ ] **Step 5: Commit**

  ```bash
  git add package.json pnpm-lock.yaml vitest.config.ts
  git commit -m "chore: add vitest for the workspace"
  ```

---

### Task 3: `core` package and slug rules

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/tenancy/slug.ts`
- Test: `packages/core/src/tenancy/slug.test.ts`

- [ ] **Step 1: Create the package files**

  `packages/core/package.json`:

  ```json
  {
    "name": "@jendal-workspace/core",
    "type": "module",
    "exports": {
      ".": "./src/index.ts",
      "./*": "./src/*.ts"
    },
    "scripts": {
      "check-types": "tsc --noEmit"
    },
    "devDependencies": {
      "@jendal-workspace/config": "workspace:*",
      "typescript": "catalog:"
    }
  }
  ```

  `packages/core/tsconfig.json`. Setting `types: []` keeps Node and Cloudflare globals out of the domain:

  ```json
  {
    "extends": "@jendal-workspace/config/tsconfig.base.json",
    "compilerOptions": {
      "noEmit": true,
      "lib": ["ESNext"],
      "types": []
    },
    "include": ["src"]
  }
  ```

  `packages/core/src/index.ts`:

  ```ts
  export * from "./tenancy/slug";
  ```

  Run: `pnpm install`
  Expected: completes, and `node_modules/@jendal-workspace/core` is linked.

- [ ] **Step 2: Write the failing test**

  `packages/core/src/tenancy/slug.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { validateStoreSlug } from "./slug";

  describe("validateStoreSlug", () => {
    it("accepts lowercase letters, digits and single hyphens", () => {
      expect(validateStoreSlug("acme-shop-2")).toEqual({ ok: true, slug: "acme-shop-2" });
    });

    it("trims and lowercases the input", () => {
      expect(validateStoreSlug("  Acme ")).toEqual({ ok: true, slug: "acme" });
    });

    it.each(["ab", "-acme", "acme-", "acme_shop", "a--b", "acme.shop", "a".repeat(41)])(
      "rejects %s as a format error",
      (input) => {
        expect(validateStoreSlug(input)).toEqual({ ok: false, reason: "format" });
      },
    );

    // Host labels, then the admin's own top-level paths (spec §4.2).
    it.each([
      "www",
      "admin",
      "api",
      "mcp",
      "store",
      "app",
      "docs",
      "login",
      "signup",
      "logout",
      "account",
      "settings",
      "orgs",
      "new",
      "verify-email",
      "forgot-password",
      "reset-password",
      "trpc",
      "assets",
      "static",
    ])("rejects reserved slug %s", (input) => {
      expect(validateStoreSlug(input)).toEqual({ ok: false, reason: "reserved" });
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**

  Run: `pnpm test packages/core/src/tenancy/slug.test.ts`
  Expected: FAIL with `Cannot find module './slug'`.

- [ ] **Step 4: Implement**

  `packages/core/src/tenancy/slug.ts`:

  ```ts
  export const RESERVED_SLUGS: readonly string[] = [
    "www",
    "admin",
    "api",
    "mcp",
    "store",
    "app",
    "docs",
    "login",
    "signup",
    "logout",
    "account",
    "settings",
    "orgs",
    "new",
    "verify-email",
    "forgot-password",
    "reset-password",
    "trpc",
    "assets",
    "static",
  ];

  const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

  export type SlugValidation = { ok: true; slug: string } | { ok: false; reason: "format" | "reserved" };

  export function validateStoreSlug(input: string): SlugValidation {
    const slug = input.trim().toLowerCase();
    // "--" is rejected so slugs can never look like punycode labels ("xn--").
    if (!SLUG_PATTERN.test(slug) || slug.includes("--")) {
      return { ok: false, reason: "format" };
    }
    if (RESERVED_SLUGS.includes(slug)) {
      return { ok: false, reason: "reserved" };
    }
    return { ok: true, slug };
  }
  ```

- [ ] **Step 5: Run test to verify it passes**

  Run: `pnpm test packages/core/src/tenancy/slug.test.ts`
  Expected: PASS, 29 tests.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core pnpm-lock.yaml
  git commit -m "feat(core): add store slug rules"
  ```

---

### Task 4: Request targets and routing paths

**Files:**
- Create: `packages/core/src/tenancy/target.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/tenancy/target.test.ts`

- [ ] **Step 1: Write the failing test**

  `packages/core/src/tenancy/target.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { parseRequestTarget, routingPath } from "./target";

  const DOMAIN = "payleor.app";
  const parse = (hostname: string, pathname = "/") => parseRequestTarget({ hostname, pathname }, DOMAIN);

  describe("parseRequestTarget", () => {
    it("maps the apex domain to the www platform app", () => {
      expect(parse("payleor.app")).toEqual({ kind: "platform", app: "www" });
    });

    it.each([
      ["www.payleor.app", "www"],
      ["admin.payleor.app", "admin"],
      ["api.payleor.app", "api"],
      ["mcp.payleor.app", "mcp"],
    ] as const)("maps %s to the %s platform app", (hostname, app) => {
      expect(parse(hostname)).toEqual({ kind: "platform", app });
    });

    it("maps a store subdomain to a store with no base path", () => {
      expect(parse("acme.payleor.app", "/products")).toEqual({ kind: "store", slug: "acme", basePath: "" });
    });

    it("maps store.payleor.app/{slug}/ to a store with a base path", () => {
      expect(parse("store.payleor.app", "/acme/products/1")).toEqual({
        kind: "store",
        slug: "acme",
        basePath: "/acme",
      });
    });

    it("returns unknown for store.payleor.app without a slug", () => {
      expect(parse("store.payleor.app", "/")).toEqual({ kind: "unknown" });
    });

    it("returns unknown for store.payleor.app with a reserved first segment", () => {
      expect(parse("store.payleor.app", "/admin/x")).toEqual({ kind: "unknown" });
    });

    it("returns unknown for reserved subdomains that are not platform apps", () => {
      expect(parse("docs.payleor.app")).toEqual({ kind: "unknown" });
    });

    it("returns unknown for nested subdomains", () => {
      expect(parse("a.b.payleor.app")).toEqual({ kind: "unknown" });
    });

    it("treats any other hostname as a custom domain", () => {
      expect(parse("Shop.Example.com")).toEqual({ kind: "custom-domain", hostname: "shop.example.com" });
    });

    it("ignores case, port and a trailing dot", () => {
      expect(parseRequestTarget({ hostname: "ACME.localhost:3001", pathname: "/" }, "localhost")).toEqual({
        kind: "store",
        slug: "acme",
        basePath: "",
      });
      expect(parse("acme.payleor.app.")).toEqual({ kind: "store", slug: "acme", basePath: "" });
    });
  });

  describe("routingPath", () => {
    it("strips the base path of path-based stores", () => {
      expect(routingPath(parse("store.payleor.app", "/acme/api/store"), "/acme/api/store")).toBe("/api/store");
    });

    it("returns / for the root of a path-based store", () => {
      expect(routingPath(parse("store.payleor.app", "/acme"), "/acme")).toBe("/");
    });

    it("leaves every other target unchanged", () => {
      expect(routingPath(parse("acme.payleor.app", "/api/store"), "/api/store")).toBe("/api/store");
      expect(routingPath(parse("admin.payleor.app", "/acme"), "/acme")).toBe("/acme");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `pnpm test packages/core/src/tenancy/target.test.ts`
  Expected: FAIL with `Cannot find module './target'`.

- [ ] **Step 3: Implement**

  `packages/core/src/tenancy/target.ts`:

  ```ts
  import { validateStoreSlug } from "./slug";

  export type PlatformApp = "www" | "admin" | "api" | "mcp";

  export type RequestTarget =
    | { kind: "platform"; app: PlatformApp }
    | { kind: "store"; slug: string; basePath: string }
    | { kind: "custom-domain"; hostname: string }
    | { kind: "unknown" };

  const PLATFORM_APPS: Record<string, PlatformApp> = { www: "www", admin: "admin", api: "api", mcp: "mcp" };
  const PATH_STORE_LABEL = "store";

  export function normalizeHostname(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  }

  export function parseRequestTarget(
    input: { hostname: string; pathname: string },
    platformDomain: string,
  ): RequestTarget {
    const hostname = normalizeHostname(input.hostname);
    const domain = normalizeHostname(platformDomain);

    if (hostname === domain) return { kind: "platform", app: "www" };
    if (!hostname.endsWith(`.${domain}`)) return { kind: "custom-domain", hostname };

    const label = hostname.slice(0, -(domain.length + 1));
    if (label.includes(".")) return { kind: "unknown" };

    const app = PLATFORM_APPS[label];
    if (app) return { kind: "platform", app };

    if (label === PATH_STORE_LABEL) {
      const firstSegment = input.pathname.split("/")[1] ?? "";
      const result = validateStoreSlug(firstSegment);
      return result.ok ? { kind: "store", slug: result.slug, basePath: `/${result.slug}` } : { kind: "unknown" };
    }

    const result = validateStoreSlug(label);
    return result.ok ? { kind: "store", slug: result.slug, basePath: "" } : { kind: "unknown" };
  }

  // Routes are written once; store.{domain}/{slug}/x is routed as /x, like {slug}.{domain}/x.
  export function routingPath(target: RequestTarget, pathname: string): string {
    if (target.kind !== "store" || target.basePath === "") return pathname;
    return pathname.slice(target.basePath.length) || "/";
  }
  ```

  Append to `packages/core/src/index.ts`:

  ```ts
  export * from "./tenancy/target";
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `pnpm test packages/core/src/tenancy/target.test.ts`
  Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/core
  git commit -m "feat(core): parse request hosts into targets and routing paths"
  ```

---

### Task 5: Store ports, resolution, access rule and tenant context

**Files:**
- Create: `packages/core/src/tenancy/store.ts`, `resolve.ts`, `access.ts`, `context.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/tenancy/resolve.test.ts`, `access.test.ts`, `context.test.ts`

- [ ] **Step 1: Create the types and ports**

  `packages/core/src/tenancy/store.ts`:

  ```ts
  export type StoreStatus = "draft" | "active" | "suspended";

  // A store is a Better Auth team; `id` is the team ID.
  export type StoreRecord = {
    id: string;
    organizationId: string;
    slug: string;
    name: string;
    status: StoreStatus;
    paypalMerchantId: string | null;
  };

  export interface StoreDirectory {
    findById(id: string): Promise<StoreRecord | null>;
    findBySlug(slug: string): Promise<StoreRecord | null>;
    findByHostname(hostname: string): Promise<StoreRecord | null>;
  }

  // Entries expire, but a slug, domain or status change must also delete the affected keys (W1-B, W1-C).
  export interface StoreLookupCache {
    get(key: string): Promise<StoreRecord | null>;
    put(key: string, store: StoreRecord): Promise<void>;
    delete(key: string): Promise<void>;
  }

  export function isStoreReachable(store: StoreRecord): boolean {
    return store.status !== "suspended";
  }
  ```

- [ ] **Step 2: Write the failing resolution test**

  `packages/core/src/tenancy/resolve.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { cacheKeyFor, lookupForTarget, resolveStore } from "./resolve";
  import type { StoreDirectory, StoreLookupCache, StoreRecord } from "./store";

  const acme: StoreRecord = {
    id: "store-1",
    organizationId: "org-1",
    slug: "acme",
    name: "Acme",
    status: "active",
    paypalMerchantId: null,
  };

  function fakeDirectory(stores: StoreRecord[], domains: Record<string, string> = {}) {
    const calls: string[] = [];
    const directory: StoreDirectory = {
      async findById(id) {
        calls.push(`id:${id}`);
        return stores.find((s) => s.id === id) ?? null;
      },
      async findBySlug(slug) {
        calls.push(`slug:${slug}`);
        return stores.find((s) => s.slug === slug) ?? null;
      },
      async findByHostname(hostname) {
        calls.push(`host:${hostname}`);
        const storeId = domains[hostname];
        return stores.find((s) => s.id === storeId) ?? null;
      },
    };
    return { directory, calls };
  }

  function fakeCache() {
    const entries = new Map<string, StoreRecord>();
    const cache: StoreLookupCache = {
      async get(key) {
        return entries.get(key) ?? null;
      },
      async put(key, store) {
        entries.set(key, store);
      },
      async delete(key) {
        entries.delete(key);
      },
    };
    return { cache, entries };
  }

  describe("lookupForTarget", () => {
    it("looks up store targets by slug", () => {
      expect(lookupForTarget({ kind: "store", slug: "acme", basePath: "" })).toEqual({ by: "slug", slug: "acme" });
    });

    it("prefers the Cloudflare for SaaS host metadata store id for custom domains", () => {
      expect(lookupForTarget({ kind: "custom-domain", hostname: "shop.example.com" }, "store-1")).toEqual({
        by: "id",
        id: "store-1",
      });
    });

    it("falls back to the hostname for custom domains without metadata", () => {
      expect(lookupForTarget({ kind: "custom-domain", hostname: "shop.example.com" })).toEqual({
        by: "hostname",
        hostname: "shop.example.com",
      });
    });

    it("returns null for platform and unknown targets", () => {
      expect(lookupForTarget({ kind: "platform", app: "api" })).toBeNull();
      expect(lookupForTarget({ kind: "unknown" })).toBeNull();
    });
  });

  describe("cacheKeyFor", () => {
    it("builds a distinct key per lookup type", () => {
      expect(cacheKeyFor({ by: "id", id: "s1" })).toBe("id:s1");
      expect(cacheKeyFor({ by: "slug", slug: "acme" })).toBe("slug:acme");
      expect(cacheKeyFor({ by: "hostname", hostname: "shop.example.com" })).toBe("host:shop.example.com");
    });
  });

  describe("resolveStore", () => {
    it("reads the directory on a cache miss and writes the result to the cache", async () => {
      const { directory, calls } = fakeDirectory([acme]);
      const { cache, entries } = fakeCache();

      await expect(resolveStore({ by: "slug", slug: "acme" }, { directory, cache })).resolves.toEqual(acme);
      expect(calls).toEqual(["slug:acme"]);
      expect(entries.get("slug:acme")).toEqual(acme);
    });

    it("serves a cached store without reading the directory", async () => {
      const { directory, calls } = fakeDirectory([acme]);
      const { cache, entries } = fakeCache();
      entries.set("slug:acme", acme);

      await expect(resolveStore({ by: "slug", slug: "acme" }, { directory, cache })).resolves.toEqual(acme);
      expect(calls).toEqual([]);
    });

    it("resolves custom domains through the directory", async () => {
      const { directory } = fakeDirectory([acme], { "shop.example.com": "store-1" });
      const { cache } = fakeCache();

      await expect(
        resolveStore({ by: "hostname", hostname: "shop.example.com" }, { directory, cache }),
      ).resolves.toEqual(acme);
    });

    it("returns null and caches nothing when no store matches", async () => {
      const { directory } = fakeDirectory([]);
      const { cache, entries } = fakeCache();

      await expect(resolveStore({ by: "slug", slug: "ghost" }, { directory, cache })).resolves.toBeNull();
      expect(entries.size).toBe(0);
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**

  Run: `pnpm test packages/core/src/tenancy/resolve.test.ts`
  Expected: FAIL with `Cannot find module './resolve'`.

- [ ] **Step 4: Implement resolution**

  `packages/core/src/tenancy/resolve.ts`:

  ```ts
  import type { StoreDirectory, StoreLookupCache, StoreRecord } from "./store";
  import type { RequestTarget } from "./target";

  export type StoreLookup =
    | { by: "id"; id: string }
    | { by: "slug"; slug: string }
    | { by: "hostname"; hostname: string };

  export function lookupForTarget(target: RequestTarget, hostMetadataStoreId?: string): StoreLookup | null {
    switch (target.kind) {
      case "store":
        return { by: "slug", slug: target.slug };
      case "custom-domain":
        return hostMetadataStoreId
          ? { by: "id", id: hostMetadataStoreId }
          : { by: "hostname", hostname: target.hostname };
      case "platform":
      case "unknown":
        return null;
    }
  }

  export function cacheKeyFor(lookup: StoreLookup): string {
    switch (lookup.by) {
      case "id":
        return `id:${lookup.id}`;
      case "slug":
        return `slug:${lookup.slug}`;
      case "hostname":
        return `host:${lookup.hostname}`;
    }
  }

  function findInDirectory(lookup: StoreLookup, directory: StoreDirectory): Promise<StoreRecord | null> {
    switch (lookup.by) {
      case "id":
        return directory.findById(lookup.id);
      case "slug":
        return directory.findBySlug(lookup.slug);
      case "hostname":
        return directory.findByHostname(lookup.hostname);
    }
  }

  export async function resolveStore(
    lookup: StoreLookup,
    deps: { directory: StoreDirectory; cache: StoreLookupCache },
  ): Promise<StoreRecord | null> {
    const key = cacheKeyFor(lookup);
    const cached = await deps.cache.get(key);
    if (cached) return cached;

    const store = await findInDirectory(lookup, deps.directory);
    if (store) await deps.cache.put(key, store);
    return store;
  }
  ```

- [ ] **Step 5: Run test to verify it passes**

  Run: `pnpm test packages/core/src/tenancy/resolve.test.ts`
  Expected: PASS, 9 tests.

- [ ] **Step 6: Write the failing access test**

  `packages/core/src/tenancy/access.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { canOpenStore } from "./access";

  describe("canOpenStore", () => {
    it("lets organization owners open every store", () => {
      expect(canOpenStore({ role: "owner", isTeamMember: false })).toBe(true);
    });

    it("lets organization admins open every store", () => {
      expect(canOpenStore({ role: "admin", isTeamMember: false })).toBe(true);
    });

    it("reads comma-separated roles", () => {
      expect(canOpenStore({ role: "member, admin", isTeamMember: false })).toBe(true);
    });

    it("keeps other members out of stores whose team they are not in", () => {
      expect(canOpenStore({ role: "member", isTeamMember: false })).toBe(false);
    });

    it("lets other members open stores whose team they are in", () => {
      expect(canOpenStore({ role: "member", isTeamMember: true })).toBe(true);
    });
  });
  ```

- [ ] **Step 7: Run test to verify it fails**

  Run: `pnpm test packages/core/src/tenancy/access.test.ts`
  Expected: FAIL with `Cannot find module './access'`.

- [ ] **Step 8: Implement the access rule**

  `packages/core/src/tenancy/access.ts`:

  ```ts
  const STORE_WIDE_ROLES = new Set(["owner", "admin"]);

  export type StoreAccess = { role: string; isTeamMember: boolean };

  // Better Auth stores several roles as one comma-separated string.
  export function hasStoreWideRole(role: string): boolean {
    return role.split(",").some((r) => STORE_WIDE_ROLES.has(r.trim()));
  }

  // Spec §4.1: owners and admins open every store of their organization; other members only their teams' stores.
  export function canOpenStore(access: StoreAccess): boolean {
    return hasStoreWideRole(access.role) || access.isTeamMember;
  }
  ```

- [ ] **Step 9: Run test to verify it passes**

  Run: `pnpm test packages/core/src/tenancy/access.test.ts`
  Expected: PASS, 5 tests.

- [ ] **Step 10: Write the failing context test**

  `packages/core/src/tenancy/context.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { createTenantContext } from "./context";

  describe("createTenantContext", () => {
    it("copies the store identity and adds channel and environment", () => {
      const context = createTenantContext(
        {
          id: "store-1",
          organizationId: "org-1",
          slug: "acme",
          name: "Acme",
          status: "active",
          paypalMerchantId: "MERCHANT123",
        },
        "admin",
        "sandbox",
      );

      expect(context).toEqual({
        storeId: "store-1",
        organizationId: "org-1",
        slug: "acme",
        paypalMerchantId: "MERCHANT123",
        channel: "admin",
        environment: "sandbox",
      });
    });
  });
  ```

- [ ] **Step 11: Run test to verify it fails**

  Run: `pnpm test packages/core/src/tenancy/context.test.ts`
  Expected: FAIL with `Cannot find module './context'`.

- [ ] **Step 12: Implement the context**

  `packages/core/src/tenancy/context.ts`:

  ```ts
  import type { StoreRecord } from "./store";

  export type TenantChannel = "web" | "admin" | "mcp" | "acp" | "ucp" | "store-sync" | "agent";
  export type TenantEnvironment = "sandbox" | "live";

  export type TenantContext = {
    storeId: string;
    organizationId: string;
    slug: string;
    paypalMerchantId: string | null;
    channel: TenantChannel;
    environment: TenantEnvironment;
  };

  export function createTenantContext(
    store: StoreRecord,
    channel: TenantChannel,
    environment: TenantEnvironment,
  ): TenantContext {
    return {
      storeId: store.id,
      organizationId: store.organizationId,
      slug: store.slug,
      paypalMerchantId: store.paypalMerchantId,
      channel,
      environment,
    };
  }
  ```

  Replace `packages/core/src/index.ts` with:

  ```ts
  export * from "./tenancy/access";
  export * from "./tenancy/context";
  export * from "./tenancy/resolve";
  export * from "./tenancy/slug";
  export * from "./tenancy/store";
  export * from "./tenancy/target";
  ```

- [ ] **Step 13: Run all core tests and the type check**

  Run: `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types`
  Expected: PASS (60 tests), and `tsc` exits 0.

- [ ] **Step 14: Commit**

  ```bash
  git add packages/core
  git commit -m "feat(core): resolve stores through a cache, check store access, build tenant context"
  ```

---

### Task 6: Organization, team and store schema; first migration

**Files:**
- Modify: `packages/db/src/schema/auth.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/schema/organization.ts`, `stores.ts`, `auth-relations.ts`, `packages/db/src/health.ts`
- Generate: `packages/db/src/migrations/*`

These columns follow the Better Auth 1.7.7 organization schema with teams. Read `refs/stack/better-auth/packages/better-auth/src/plugins/organization/organization.ts:959-1297`, the `schema` object. Drizzle property names must equal the Better Auth field names (Fact 6).

- [ ] **Step 1: Update the session table and drop the old relations**

  In `packages/db/src/schema/auth.ts`:

  1. In the `session` table columns, after `userAgent: text("user_agent"),`, add:

     ```ts
         activeOrganizationId: text("active_organization_id"),
         activeTeamId: text("active_team_id"),
     ```

  2. Delete the whole `export const authRelations = defineRelationsPart(...)` block at the end of the file. Then change the first import line to remove `defineRelationsPart`. The file should no longer import from `"drizzle-orm"`, only from `"drizzle-orm/pg-core"`.

- [ ] **Step 2: Create the organization and team tables**

  `packages/db/src/schema/organization.ts`:

  ```ts
  import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

  import { user } from "./auth";

  export const organization = pgTable("organization", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at").notNull(),
    metadata: text("metadata"),
  });

  export const member = pgTable(
    "member",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
      role: text("role").default("member").notNull(),
      createdAt: timestamp("created_at").notNull(),
    },
    (table) => [
      index("member_organizationId_idx").on(table.organizationId),
      index("member_userId_idx").on(table.userId),
    ],
  );

  export const invitation = pgTable(
    "invitation",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      email: text("email").notNull(),
      role: text("role"),
      teamId: text("team_id"),
      status: text("status").default("pending").notNull(),
      expiresAt: timestamp("expires_at").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      inviterId: text("inviter_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    },
    (table) => [
      index("invitation_organizationId_idx").on(table.organizationId),
      index("invitation_email_idx").on(table.email),
    ],
  );

  // Each team is a store (spec §4.1). slug, status and paypalMerchantId are team additionalFields in packages/auth.
  export const team = pgTable(
    "team",
    {
      id: text("id").primaryKey(),
      name: text("name").notNull(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      slug: text("slug").notNull().unique(),
      status: text("status", { enum: ["draft", "active", "suspended"] })
        .default("draft")
        .notNull(),
      paypalMerchantId: text("paypal_merchant_id").unique(),
      memberCount: integer("member_count").default(0).notNull(),
      createdAt: timestamp("created_at").notNull(),
      updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
    },
    (table) => [index("team_organizationId_idx").on(table.organizationId)],
  );

  export const teamMember = pgTable(
    "team_member",
    {
      id: text("id").primaryKey(),
      teamId: text("team_id")
        .notNull()
        .references(() => team.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
      membershipKey: text("membership_key").unique(),
      createdAt: timestamp("created_at"),
    },
    (table) => [
      index("teamMember_teamId_idx").on(table.teamId),
      index("teamMember_userId_idx").on(table.userId),
    ],
  );
  ```

- [ ] **Step 3: Create the store domains table**

  `packages/db/src/schema/stores.ts`:

  ```ts
  import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

  import { team } from "./organization";

  export const storeDomains = pgTable(
    "store_domains",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
      storeId: text("store_id")
        .notNull()
        .references(() => team.id, { onDelete: "cascade" }),
      hostname: text("hostname").notNull().unique(),
      status: text("status", { enum: ["pending", "active"] })
        .default("pending")
        .notNull(),
      cloudflareHostnameId: text("cloudflare_hostname_id"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("store_domains_storeId_idx").on(table.storeId)],
  );
  ```

- [ ] **Step 4: Define one relations part for every Better Auth table**

  A single part avoids two parts both defining `user` relations, where the second spread would overwrite the first. The relation names follow Better Auth's generator (`refs/stack/better-auth/packages/drizzle-adapter/src/relations-v2/generate-drizzle-schema.ts:455-575`).

  `packages/db/src/schema/auth-relations.ts`:

  ```ts
  import { defineRelationsPart } from "drizzle-orm";

  import { account, session, user, verification } from "./auth";
  import { invitation, member, organization, team, teamMember } from "./organization";

  export const authRelations = defineRelationsPart(
    { user, session, account, verification, organization, member, invitation, team, teamMember },
    (r) => ({
      user: {
        sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
        accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
        members: r.many.member({ from: r.user.id, to: r.member.userId }),
        invitations: r.many.invitation({ from: r.user.id, to: r.invitation.inviterId }),
        teamMembers: r.many.teamMember({ from: r.user.id, to: r.teamMember.userId }),
      },
      session: {
        user: r.one.user({ from: r.session.userId, to: r.user.id }),
      },
      account: {
        user: r.one.user({ from: r.account.userId, to: r.user.id }),
      },
      organization: {
        members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
        invitations: r.many.invitation({ from: r.organization.id, to: r.invitation.organizationId }),
        teams: r.many.team({ from: r.organization.id, to: r.team.organizationId }),
      },
      member: {
        organization: r.one.organization({ from: r.member.organizationId, to: r.organization.id }),
        user: r.one.user({ from: r.member.userId, to: r.user.id }),
      },
      invitation: {
        organization: r.one.organization({ from: r.invitation.organizationId, to: r.organization.id }),
        user: r.one.user({ from: r.invitation.inviterId, to: r.user.id }),
      },
      team: {
        organization: r.one.organization({ from: r.team.organizationId, to: r.organization.id }),
        teamMembers: r.many.teamMember({ from: r.team.id, to: r.teamMember.teamId }),
      },
      teamMember: {
        team: r.one.team({ from: r.teamMember.teamId, to: r.team.id }),
        user: r.one.user({ from: r.teamMember.userId, to: r.user.id }),
      },
    }),
  );
  ```

- [ ] **Step 5: Export the schema**

  Replace `packages/db/src/schema/index.ts` with:

  ```ts
  export * from "./auth";
  export * from "./auth-relations";
  export * from "./organization";
  export * from "./stores";
  ```

  `packages/db/src/relations.ts` is unchanged. It still spreads `schema.authRelations` over `defineRelations(schema)`.

- [ ] **Step 6: Tune the client for Hyperdrive and add a health check**

  Replace the `createDb` function in `packages/db/src/index.ts` with:

  ```ts
  export function createDb(env: DatabaseConfig) {
    // fetch_types is off because the schema uses no custom types; it saves a round trip per connection.
    const client = postgres(env.DATABASE_URL || "", { max: 1, fetch_types: false });

    return drizzle({ client, relations });
  }
  ```

  `packages/db/src/health.ts`:

  ```ts
  import { sql } from "drizzle-orm";

  import type { Database } from "./index";

  export async function pingDatabase(db: Database): Promise<void> {
    await db.execute(sql`select 1`);
  }
  ```

- [ ] **Step 7: Generate the first migration**

  Run: `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name init`
  Expected: a new folder under `packages/db/src/migrations/` with a `migration.sql`. It should contain `CREATE TABLE` for `user`, `session` (with `active_organization_id` and `active_team_id`), `account`, `verification`, `organization`, `member`, `invitation` (with `team_id`), `team` (with `slug`, `status`, `paypal_merchant_id`, `member_count`), `team_member` (with `membership_key`) and `store_domains`.

- [ ] **Step 8: Apply it to Aiven**

  Run: `pnpm -F @jendal-workspace/db db:migrate` (the root `pnpm db:migrate` goes through an interactive Turbo task and fails outside a terminal UI)
  Expected: drizzle-kit reports the migration as applied, with no errors.

- [ ] **Step 9: Type check and commit**

  Run: `pnpm -F @jendal-workspace/db check-types`
  Expected: exits 0.

  ```bash
  git add packages/db
  git commit -m "feat(db): add organization, team (store) and store domain tables with the first migration"
  ```

---

### Task 7: Test database setup

**Files:**
- Create: `packages/db/src/testing/global-setup.ts`, `packages/db/src/testing/db.ts`
- Modify: `vitest.config.ts`
- Test: `packages/db/src/testing/db.test.ts`

- [ ] **Step 1: Create the global setup**

  `packages/db/src/testing/global-setup.ts`:

  ```ts
  import { fileURLToPath } from "node:url";

  import { drizzle } from "drizzle-orm/postgres-js";
  import { migrate } from "drizzle-orm/postgres-js/migrator";
  import postgres from "postgres";

  export default async function setup() {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) return;

    const databaseName = new URL(url).pathname.slice(1);
    if (!databaseName.includes("test")) {
      throw new Error(
        `Refusing to reset "${databaseName}": TEST_DATABASE_URL must point to a database whose name contains "test".`,
      );
    }

    const client = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await client.unsafe(
        "drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;",
      );
      await migrate(drizzle({ client }), {
        migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
      });
    } finally {
      await client.end();
    }
  }
  ```

- [ ] **Step 2: Register it in Vitest**

  In `vitest.config.ts`, add this to the `test` object:

  ```ts
      globalSetup: ["./packages/db/src/testing/global-setup.ts"],
  ```

- [ ] **Step 3: Create the test helpers**

  `packages/db/src/testing/db.ts`:

  ```ts
  import { sql } from "drizzle-orm";

  import { createDb, type Database } from "../index";
  import { user } from "../schema/auth";
  import { member, organization, team, teamMember } from "../schema/organization";

  export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

  export function createTestDb(): Database {
    return createDb({ DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" });
  }

  export async function truncateAll(db: Database): Promise<void> {
    await db.execute(
      sql.raw(
        'truncate table "store_domains", "team_member", "team", "invitation", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
      ),
    );
  }

  export async function seedUser(db: Database, name = "Owner"): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(user).values({ id, name, email: `${id}@example.com` });
    return id;
  }

  export async function seedOrganization(
    db: Database,
    options: { role?: string; name?: string } = {},
  ): Promise<{ userId: string; organizationId: string }> {
    const userId = await seedUser(db);
    const organizationId = crypto.randomUUID();
    await db.insert(organization).values({
      id: organizationId,
      name: options.name ?? "Acme Inc",
      slug: `org-${organizationId.slice(0, 8)}`,
      createdAt: new Date(),
    });
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: options.role ?? "owner",
      createdAt: new Date(),
    });
    return { userId, organizationId };
  }

  export async function addMember(db: Database, input: { organizationId: string; role: string }): Promise<string> {
    const userId = await seedUser(db, "Staff");
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId,
      role: input.role,
      createdAt: new Date(),
    });
    return userId;
  }

  export async function seedStore(
    db: Database,
    input: { organizationId: string; slug: string; name?: string; status?: "draft" | "active" | "suspended" },
  ) {
    const [row] = await db
      .insert(team)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        slug: input.slug,
        name: input.name ?? input.slug,
        status: input.status ?? "draft",
        createdAt: new Date(),
      })
      .returning({
        id: team.id,
        organizationId: team.organizationId,
        slug: team.slug,
        name: team.name,
        status: team.status,
        paypalMerchantId: team.paypalMerchantId,
      });
    if (!row) throw new Error("Insert into team returned no row");
    return row;
  }

  export async function addTeamMember(db: Database, input: { teamId: string; userId: string }): Promise<void> {
    await db.insert(teamMember).values({ id: crypto.randomUUID(), ...input, createdAt: new Date() });
  }
  ```

- [ ] **Step 4: Write a smoke test**

  `packages/db/src/testing/db.test.ts`:

  ```ts
  import { afterAll, beforeEach, describe, expect, it } from "vitest";

  import { member } from "../schema/organization";
  import { createTestDb, hasTestDatabase, seedOrganization, truncateAll } from "./db";

  describe.skipIf(!hasTestDatabase)("test database", () => {
    const db = createTestDb();

    beforeEach(() => truncateAll(db));
    afterAll(() => db.$client.end());

    it("seeds an organization with an owner", async () => {
      const { organizationId, userId } = await seedOrganization(db);
      const rows = await db.select().from(member);

      expect(rows).toEqual([expect.objectContaining({ organizationId, userId, role: "owner" })]);
    });
  });
  ```

- [ ] **Step 5: Run it**

  Run: `pnpm test packages/db`
  Expected: PASS, 1 test. A `skipped` result means `.env.test.local` is missing or the Docker container is not running (Task 0, Step 4).

- [ ] **Step 6: Commit**

  ```bash
  git add vitest.config.ts packages/db/src/testing
  git commit -m "test(db): reset and migrate a dedicated test database"
  ```

---

### Task 8: Store repository

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/src/repositories/stores.ts`
- Test: `packages/db/src/repositories/stores.test.ts`

- [ ] **Step 1: Depend on `core`**

  In `packages/db/package.json` `dependencies`, add:

  ```json
      "@jendal-workspace/core": "workspace:*",
  ```

  Run: `pnpm install`
  Expected: completes.

- [ ] **Step 2: Write the failing test**

  `packages/db/src/repositories/stores.test.ts`:

  ```ts
  import { afterAll, beforeEach, describe, expect, it } from "vitest";

  import { member } from "../schema/organization";
  import { storeDomains } from "../schema/stores";
  import {
    addMember,
    addTeamMember,
    createTestDb,
    hasTestDatabase,
    seedOrganization,
    seedStore,
    truncateAll,
  } from "../testing/db";
  import { createStoreDirectory, findStoreAccess, isStoreSlugTaken, listOrganizationsWithStores } from "./stores";

  describe.skipIf(!hasTestDatabase)("store repository", () => {
    const db = createTestDb();
    const directory = createStoreDirectory(db);

    beforeEach(() => truncateAll(db));
    afterAll(() => db.$client.end());

    it("finds a store by id and by slug", async () => {
      const { organizationId } = await seedOrganization(db);
      const store = await seedStore(db, { organizationId, slug: "acme", name: "Acme" });

      expect(store).toEqual({
        id: expect.any(String),
        organizationId,
        slug: "acme",
        name: "Acme",
        status: "draft",
        paypalMerchantId: null,
      });
      await expect(directory.findById(store.id)).resolves.toEqual(store);
      await expect(directory.findBySlug("acme")).resolves.toEqual(store);
    });

    it("returns null for unknown stores", async () => {
      await expect(directory.findBySlug("ghost")).resolves.toBeNull();
      await expect(directory.findById("missing")).resolves.toBeNull();
      await expect(directory.findByHostname("nowhere.example.com")).resolves.toBeNull();
    });

    it("finds stores by custom hostname only when the domain is active", async () => {
      const { organizationId } = await seedOrganization(db);
      const store = await seedStore(db, { organizationId, slug: "acme" });
      await db.insert(storeDomains).values([
        { storeId: store.id, hostname: "shop.acme.com", status: "active" },
        { storeId: store.id, hostname: "pending.acme.com", status: "pending" },
      ]);

      await expect(directory.findByHostname("shop.acme.com")).resolves.toEqual(store);
      await expect(directory.findByHostname("pending.acme.com")).resolves.toBeNull();
    });

    it("reports whether a slug is taken", async () => {
      const { organizationId } = await seedOrganization(db);
      await seedStore(db, { organizationId, slug: "acme" });

      await expect(isStoreSlugTaken(db, "acme")).resolves.toBe(true);
      await expect(isStoreSlugTaken(db, "other")).resolves.toBe(false);
    });

    it("returns the role and team membership of users who belong to the store's organization", async () => {
      const { userId: ownerId, organizationId } = await seedOrganization(db);
      const store = await seedStore(db, { organizationId, slug: "acme" });
      const staffId = await addMember(db, { organizationId, role: "member" });
      await addTeamMember(db, { teamId: store.id, userId: staffId });

      await expect(findStoreAccess(db, { slug: "acme", userId: ownerId })).resolves.toEqual({
        store,
        role: "owner",
        isTeamMember: false,
      });
      await expect(findStoreAccess(db, { slug: "acme", userId: staffId })).resolves.toEqual({
        store,
        role: "member",
        isTeamMember: true,
      });
    });

    it("returns no access for users outside the organization and for unknown slugs", async () => {
      const { userId, organizationId } = await seedOrganization(db);
      await seedStore(db, { organizationId, slug: "acme" });
      const outsider = await seedOrganization(db);

      await expect(findStoreAccess(db, { slug: "acme", userId: outsider.userId })).resolves.toBeNull();
      await expect(findStoreAccess(db, { slug: "ghost", userId })).resolves.toBeNull();
    });

    it("lists every organization of the user by name, with its stores by name and team membership", async () => {
      const first = await seedOrganization(db, { name: "First" });
      const beta = await seedStore(db, { organizationId: first.organizationId, slug: "beta" });
      const acme = await seedStore(db, { organizationId: first.organizationId, slug: "acme" });
      const empty = await seedOrganization(db, { name: "Empty" });
      await db.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: empty.organizationId,
        userId: first.userId,
        role: "member",
        createdAt: new Date(),
      });
      await addTeamMember(db, { teamId: beta.id, userId: first.userId });
      const other = await seedOrganization(db, { name: "Other" });
      await seedStore(db, { organizationId: other.organizationId, slug: "other" });

      const result = await listOrganizationsWithStores(db, first.userId);

      expect(result).toEqual([
        { organization: { id: empty.organizationId, name: "Empty" }, role: "member", stores: [] },
        {
          organization: { id: first.organizationId, name: "First" },
          role: "owner",
          stores: [
            { store: acme, isTeamMember: false },
            { store: beta, isTeamMember: true },
          ],
        },
      ]);
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**

  Run: `pnpm test packages/db/src/repositories`
  Expected: FAIL with `Cannot find module './stores'`.

- [ ] **Step 4: Implement**

  `packages/db/src/repositories/stores.ts`:

  ```ts
  import type { StoreDirectory, StoreRecord } from "@jendal-workspace/core";
  import { and, eq } from "drizzle-orm";

  import type { Database } from "../index";
  import { member, organization, team, teamMember } from "../schema/organization";
  import { storeDomains } from "../schema/stores";

  const storeColumns = {
    id: team.id,
    organizationId: team.organizationId,
    slug: team.slug,
    name: team.name,
    status: team.status,
    paypalMerchantId: team.paypalMerchantId,
  };

  export function createStoreDirectory(db: Database): StoreDirectory {
    return {
      async findById(id) {
        const [row] = await db.select(storeColumns).from(team).where(eq(team.id, id)).limit(1);
        return row ?? null;
      },
      async findBySlug(slug) {
        const [row] = await db.select(storeColumns).from(team).where(eq(team.slug, slug)).limit(1);
        return row ?? null;
      },
      async findByHostname(hostname) {
        const [row] = await db
          .select(storeColumns)
          .from(storeDomains)
          .innerJoin(team, eq(storeDomains.storeId, team.id))
          .where(and(eq(storeDomains.hostname, hostname), eq(storeDomains.status, "active")))
          .limit(1);
        return row ?? null;
      },
    };
  }

  export async function isStoreSlugTaken(db: Database, slug: string): Promise<boolean> {
    const [row] = await db.select({ id: team.id }).from(team).where(eq(team.slug, slug)).limit(1);
    return row !== undefined;
  }

  export type StoreAccessRow = { store: StoreRecord; role: string; isTeamMember: boolean };

  // Null when the store does not exist or the user is not a member of its organization.
  export async function findStoreAccess(
    db: Database,
    input: { slug: string; userId: string },
  ): Promise<StoreAccessRow | null> {
    const [row] = await db
      .select({ ...storeColumns, role: member.role, teamMemberId: teamMember.id })
      .from(team)
      .innerJoin(member, and(eq(member.organizationId, team.organizationId), eq(member.userId, input.userId)))
      .leftJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, input.userId)))
      .where(eq(team.slug, input.slug))
      .limit(1);
    if (!row) return null;
    const { role, teamMemberId, ...store } = row;
    return { store, role, isTeamMember: teamMemberId !== null };
  }

  export type OrganizationStores = {
    organization: { id: string; name: string };
    role: string;
    stores: Array<{ store: StoreRecord; isTeamMember: boolean }>;
  };

  export async function listOrganizationsWithStores(db: Database, userId: string): Promise<OrganizationStores[]> {
    const rows = await db
      .select({
        organizationId: organization.id,
        organizationName: organization.name,
        role: member.role,
        store: storeColumns,
        teamMemberId: teamMember.id,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .leftJoin(team, eq(team.organizationId, organization.id))
      .leftJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, userId)))
      .where(eq(member.userId, userId))
      // Ordering by name keeps the dashboard list stable; created_at can tie within a millisecond.
      .orderBy(organization.name, organization.id, team.name, team.id);

    const byOrganization = new Map<string, OrganizationStores>();
    for (const row of rows) {
      let entry = byOrganization.get(row.organizationId);
      if (!entry) {
        entry = { organization: { id: row.organizationId, name: row.organizationName }, role: row.role, stores: [] };
        byOrganization.set(row.organizationId, entry);
      }
      if (row.store) entry.stores.push({ store: row.store, isTeamMember: row.teamMemberId !== null });
    }
    return [...byOrganization.values()];
  }
  ```

- [ ] **Step 5: Run test to verify it passes**

  Run: `pnpm test packages/db`
  Expected: PASS, 8 tests (1 from Task 7, 7 here).

- [ ] **Step 6: Type check and commit**

  Run: `pnpm -F @jendal-workspace/db check-types`
  Expected: exits 0.

  ```bash
  git add packages/db pnpm-lock.yaml
  git commit -m "feat(db): look up stores, store access and a user's stores"
  ```

---

### Task 9: Better Auth organizations, stores as teams, PayPal sign-in

**Files:**
- Modify: `packages/auth/package.json`, `packages/auth/src/index.ts`
- Test: `packages/auth/src/index.test.ts`

- [ ] **Step 1: Depend on `core`**

  In `packages/auth/package.json` `dependencies`, add:

  ```json
      "@jendal-workspace/core": "workspace:*",
  ```

  Run: `pnpm install`
  Expected: completes.

- [ ] **Step 2: Write the failing test**

  `packages/auth/src/index.test.ts`:

  ```ts
  import { team } from "@jendal-workspace/db/schema/organization";
  import { createTestDb, hasTestDatabase, truncateAll } from "@jendal-workspace/db/testing/db";
  import { eq } from "drizzle-orm";
  import { afterAll, beforeEach, describe, expect, it } from "vitest";

  import { createAuth } from "./index";

  const config = {
    BETTER_AUTH_URL: "http://admin.localhost:3001",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
    PAYPAL_CLIENT_ID: "sandbox-client-id",
    PAYPAL_CLIENT_SECRET: "sandbox-client-secret",
    PAYPAL_ENVIRONMENT: "sandbox",
  };

  describe.skipIf(!hasTestDatabase)("stores as Better Auth teams", () => {
    const db = createTestDb();
    const auth = createAuth(config, db);

    beforeEach(() => truncateAll(db));
    afterAll(() => db.$client.end());

    async function signUp(email: string) {
      const { headers, response } = await auth.api.signUpEmail({
        body: { name: "Ada", email, password: "correct-horse-battery" },
        returnHeaders: true,
      });
      const cookie = headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      return { userId: response.user.id, headers: new Headers({ cookie }) };
    }

    async function ownerWithOrganization(slug = "acme-inc") {
      const owner = await signUp(`owner-${slug}@example.com`);
      const organization = await auth.api.createOrganization({
        body: { name: "Acme Inc", slug },
        headers: owner.headers,
      });
      if (!organization) throw new Error("organization was not created");
      return { ...owner, organizationId: organization.id };
    }

    it("creates a draft store from a normalized slug", async () => {
      const { headers, organizationId } = await ownerWithOrganization();

      const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: " Acme " }, headers });

      const [row] = await db.select().from(team).where(eq(team.id, store.id));
      expect(row).toMatchObject({ organizationId, name: "Acme", slug: "acme", status: "draft", paypalMerchantId: null });
    });

    it("ignores client attempts to set the status or PayPal merchant", async () => {
      const { headers, organizationId } = await ownerWithOrganization();
      const extra: Record<string, unknown> = { status: "active", paypalMerchantId: "FAKE" };

      const store = await auth.api.createTeam({
        body: { name: "Acme", organizationId, slug: "acme", ...extra },
        headers,
      });

      const [row] = await db.select().from(team).where(eq(team.id, store.id));
      expect(row).toMatchObject({ status: "draft", paypalMerchantId: null });
    });

    it("rejects reserved and malformed slugs", async () => {
      const { headers, organizationId } = await ownerWithOrganization();

      await expect(
        auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "login" }, headers }),
      ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "STORE_SLUG_RESERVED" } });
      await expect(
        auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "a_b" }, headers }),
      ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "STORE_SLUG_INVALID" } });
    });

    it("rejects a slug that another store already uses", async () => {
      const first = await ownerWithOrganization("first-org");
      const second = await ownerWithOrganization("second-org");
      await auth.api.createTeam({
        body: { name: "Acme", organizationId: first.organizationId, slug: "acme" },
        headers: first.headers,
      });

      await expect(
        auth.api.createTeam({
          body: { name: "Other", organizationId: second.organizationId, slug: "acme" },
          headers: second.headers,
        }),
      ).rejects.toMatchObject({ status: "CONFLICT", body: { code: "STORE_SLUG_TAKEN" } });
    });

    it("only lets owners and admins create stores", async () => {
      const { organizationId } = await ownerWithOrganization();
      const staff = await signUp("staff@example.com");
      await auth.api.addMember({ body: { userId: staff.userId, organizationId, role: "member" } });

      await expect(
        auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme" }, headers: staff.headers }),
      ).rejects.toMatchObject({ status: "FORBIDDEN" });
    });

    it("keeps the slug fixed and allows renaming", async () => {
      const { headers, organizationId } = await ownerWithOrganization();
      const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme" }, headers });

      await expect(
        auth.api.updateTeam({ body: { teamId: store.id, data: { slug: "other" } }, headers }),
      ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "STORE_SLUG_IMMUTABLE" } });

      const renamed = await auth.api.updateTeam({ body: { teamId: store.id, data: { name: "Acme Goods" } }, headers });
      expect(renamed).toMatchObject({ name: "Acme Goods", slug: "acme" });
    });

    it("does not create a default team with a new organization", async () => {
      const { organizationId } = await ownerWithOrganization();

      await expect(db.select().from(team).where(eq(team.organizationId, organizationId))).resolves.toEqual([]);
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**

  Run: `pnpm test packages/auth`
  Expected: FAIL. At runtime the first call fails with `auth.api.createOrganization is not a function`.

- [ ] **Step 4: Implement**

  Replace `packages/auth/src/index.ts` with:

  ```ts
  import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
  import { validateStoreSlug } from "@jendal-workspace/core";
  import type { Database } from "@jendal-workspace/db";
  import { isStoreSlugTaken } from "@jendal-workspace/db/repositories/stores";
  import * as schema from "@jendal-workspace/db/schema/index";
  import { betterAuth } from "better-auth";
  import { APIError } from "better-auth/api";
  import { organization } from "better-auth/plugins/organization";

  export type AuthConfig = {
    BETTER_AUTH_URL: string;
    BETTER_AUTH_SECRET: string;
    PAYPAL_CLIENT_ID: string;
    PAYPAL_CLIENT_SECRET: string;
    PAYPAL_ENVIRONMENT: string;
  };

  // A store is a team (spec §4.1). status and paypalMerchantId are set by our own code only.
  const storeFields = {
    slug: { type: "string", required: true, unique: true, input: true },
    status: { type: "string", required: true, defaultValue: "draft", input: false },
    paypalMerchantId: { type: "string", required: false, unique: true, input: false },
  } as const;

  async function claimStoreSlug(database: Database, input: unknown): Promise<string> {
    const result = validateStoreSlug(typeof input === "string" ? input : "");
    if (!result.ok) {
      throw new APIError("BAD_REQUEST", {
        code: result.reason === "reserved" ? "STORE_SLUG_RESERVED" : "STORE_SLUG_INVALID",
        message:
          result.reason === "reserved"
            ? "This store address is reserved."
            : "Use 3 to 40 lowercase letters, numbers or single hyphens.",
      });
    }
    // The unique index on team.slug still guards against a concurrent claim.
    if (await isStoreSlugTaken(database, result.slug)) {
      throw new APIError("CONFLICT", { code: "STORE_SLUG_TAKEN", message: "This store address is already taken." });
    }
    return result.slug;
  }

  export function createAuth(env: AuthConfig, database: Database) {
    return betterAuth({
      database: drizzleAdapter(database, { provider: "pg", schema }),
      emailAndPassword: { enabled: true },
      socialProviders: {
        paypal: {
          clientId: env.PAYPAL_CLIENT_ID,
          clientSecret: env.PAYPAL_CLIENT_SECRET,
          environment: env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox",
        },
      },
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      plugins: [
        organization({
          // A store needs a slug, so no team is created automatically with an organization.
          teams: { enabled: true, defaultTeam: { enabled: false } },
          schema: { team: { additionalFields: storeFields } },
          organizationHooks: {
            beforeCreateTeam: async ({ team }) => ({
              data: { slug: await claimStoreSlug(database, team.slug), status: "draft", paypalMerchantId: null },
            }),
            // Store URLs and the KV cache are keyed by slug, so slugs cannot change until W1-C adds invalidation.
            beforeUpdateTeam: async ({ team, updates }) => {
              if (updates.slug !== undefined && updates.slug !== team.slug) {
                throw new APIError("BAD_REQUEST", {
                  code: "STORE_SLUG_IMMUTABLE",
                  message: "A store address cannot be changed.",
                });
              }
            },
          },
        }),
      ],
    });
  }

  export type Auth = ReturnType<typeof createAuth>;
  export type Session = Auth["$Infer"]["Session"];
  ```

  This drops the scaffold's `trustedOrigins` and the `sameSite: "none"` cookie override. The browser now reaches auth on the admin origin itself (same origin), and Better Auth trusts its own `baseURL` origin.

- [ ] **Step 5: Run test to verify it passes**

  Run: `pnpm test packages/auth`
  Expected: PASS, 7 tests.

  If the FORBIDDEN test reports a different status, open `refs/stack/better-auth/packages/better-auth/src/plugins/organization/routes/crud-team.ts:128-145` and assert the status the permission check actually throws. Keep the test's intent: a member cannot create a store.

- [ ] **Step 6: Type check**

  Run: `pnpm -F @jendal-workspace/auth check-types`
  Expected: exits 0. `apps/server` will not compile until Task 13 changes its env and services. That is expected.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/auth pnpm-lock.yaml
  git commit -m "feat(auth): stores as Better Auth teams with slug rules, and PayPal sign-in"
  ```

---

### Task 10: tRPC store procedures

**Files:**
- Modify: `packages/api/package.json`, `packages/api/src/context.ts`, `packages/api/src/routers/index.ts`
- Create: `packages/api/src/store-procedure.ts`, `packages/api/src/routers/store.ts`
- Test: `packages/api/src/routers/store.test.ts`, `packages/api/src/routers/index.test.ts`

- [ ] **Step 1: Depend on `core` and extend the context**

  In `packages/api/package.json` `dependencies`, add:

  ```json
      "@jendal-workspace/core": "workspace:*",
  ```

  Run: `pnpm install`

  Replace `packages/api/src/context.ts` with:

  ```ts
  import type { Session } from "@jendal-workspace/auth";
  import type { TenantEnvironment } from "@jendal-workspace/core";
  import type { Database } from "@jendal-workspace/db";

  export type Context = {
    session: Session | null;
    db: Database;
    environment: TenantEnvironment;
  };
  ```

- [ ] **Step 2: Write the failing tests**

  `packages/api/src/routers/store.test.ts`:

  ```ts
  import {
    addMember,
    addTeamMember,
    createTestDb,
    hasTestDatabase,
    seedOrganization,
    seedStore,
    truncateAll,
  } from "@jendal-workspace/db/testing/db";
  import { afterAll, beforeEach, describe, expect, it } from "vitest";

  import type { Context } from "../context";
  import { appRouter } from "./index";

  type SessionValue = NonNullable<Context["session"]>;

  function makeSession(userId: string): SessionValue {
    const now = new Date();
    return {
      session: {
        id: "session-1",
        token: "token-1",
        userId,
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: userId,
        name: "Someone",
        email: `${userId}@example.com`,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  describe.skipIf(!hasTestDatabase)("store router", () => {
    const db = createTestDb();
    const callerFor = (userId: string | null) =>
      appRouter.createCaller({ db, session: userId ? makeSession(userId) : null, environment: "sandbox" });

    beforeEach(() => truncateAll(db));
    afterAll(() => db.$client.end());

    it("lists every store of the organizations an owner belongs to", async () => {
      const { userId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
      const acme = await seedStore(db, { organizationId, slug: "acme", name: "Acme" });

      await expect(callerFor(userId).store.listMine()).resolves.toEqual([
        { id: organizationId, name: "Acme Inc", role: "owner", canCreateStores: true, stores: [acme] },
      ]);
    });

    it("lists only the team stores of other members", async () => {
      const { organizationId } = await seedOrganization(db, { name: "Acme Inc" });
      const acme = await seedStore(db, { organizationId, slug: "acme" });
      await seedStore(db, { organizationId, slug: "beta" });
      const staffId = await addMember(db, { organizationId, role: "member" });
      await addTeamMember(db, { teamId: acme.id, userId: staffId });

      await expect(callerFor(staffId).store.listMine()).resolves.toEqual([
        { id: organizationId, name: "Acme Inc", role: "member", canCreateStores: false, stores: [acme] },
      ]);
    });

    it("rejects anonymous callers", async () => {
      await expect(callerFor(null).store.listMine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("returns a store and the caller's role to owners, whatever the slug's case", async () => {
      const { userId, organizationId } = await seedOrganization(db);
      const acme = await seedStore(db, { organizationId, slug: "acme" });

      await expect(callerFor(userId).store.get({ storeSlug: " ACME " })).resolves.toEqual({ ...acme, role: "owner" });
    });

    it("returns a store to members of its team", async () => {
      const { organizationId } = await seedOrganization(db);
      const acme = await seedStore(db, { organizationId, slug: "acme" });
      const staffId = await addMember(db, { organizationId, role: "member" });
      await addTeamMember(db, { teamId: acme.id, userId: staffId });

      await expect(callerFor(staffId).store.get({ storeSlug: "acme" })).resolves.toEqual({ ...acme, role: "member" });
    });

    it("reports a store as not found to members outside its team", async () => {
      const { organizationId } = await seedOrganization(db);
      await seedStore(db, { organizationId, slug: "acme" });
      const staffId = await addMember(db, { organizationId, role: "member" });

      await expect(callerFor(staffId).store.get({ storeSlug: "acme" })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Store not found.",
      });
    });

    it("reports another merchant's store as not found", async () => {
      const { organizationId } = await seedOrganization(db);
      await seedStore(db, { organizationId, slug: "acme" });
      const outsider = await seedOrganization(db);

      await expect(callerFor(outsider.userId).store.get({ storeSlug: "acme" })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Store not found.",
      });
    });
  });
  ```

  `packages/api/src/routers/index.test.ts`:

  ```ts
  import { createTestDb, hasTestDatabase } from "@jendal-workspace/db/testing/db";
  import { afterAll, describe, expect, it } from "vitest";

  import { appRouter } from "./index";

  describe.skipIf(!hasTestDatabase)("healthCheck", () => {
    const db = createTestDb();
    afterAll(() => db.$client.end());

    it("answers OK once the database responds", async () => {
      const caller = appRouter.createCaller({ db, session: null, environment: "sandbox" });

      await expect(caller.healthCheck()).resolves.toBe("OK");
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm test packages/api`
  Expected: FAIL. `caller.store` is undefined (`Cannot read properties of undefined (reading 'listMine')`).

- [ ] **Step 4: Implement the store procedure**

  `packages/api/src/store-procedure.ts`:

  ```ts
  import { canOpenStore, createTenantContext } from "@jendal-workspace/core";
  import { findStoreAccess } from "@jendal-workspace/db/repositories/stores";
  import { TRPCError } from "@trpc/server";
  import { z } from "zod";

  import { protectedProcedure } from "./index";

  // Spec §4.7: the store comes from the URL. A store the caller cannot open is reported
  // exactly like a missing one, so other merchants' slugs do not leak.
  export const storeProcedure = protectedProcedure
    .input(z.object({ storeSlug: z.string().trim().toLowerCase().min(1) }))
    .use(async ({ ctx, input, next }) => {
      const access = await findStoreAccess(ctx.db, { slug: input.storeSlug, userId: ctx.session.user.id });
      if (!access || !canOpenStore(access)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
      }
      return next({
        ctx: {
          store: access.store,
          role: access.role,
          tenant: createTenantContext(access.store, "admin", ctx.environment),
        },
      });
    });
  ```

- [ ] **Step 5: Implement the router**

  `packages/api/src/routers/store.ts`:

  ```ts
  import { canOpenStore, hasStoreWideRole } from "@jendal-workspace/core";
  import { listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";

  import { protectedProcedure, router } from "../index";
  import { storeProcedure } from "../store-procedure";

  export const storeRouter = router({
    listMine: protectedProcedure.query(async ({ ctx }) => {
      const organizations = await listOrganizationsWithStores(ctx.db, ctx.session.user.id);
      return organizations.map(({ organization, role, stores }) => ({
        id: organization.id,
        name: organization.name,
        role,
        // Mirrors Better Auth's default team:create permission (owner and admin).
        canCreateStores: hasStoreWideRole(role),
        stores: stores.filter((s) => canOpenStore({ role, isTeamMember: s.isTeamMember })).map((s) => s.store),
      }));
    }),

    get: storeProcedure.query(({ ctx }) => ({ ...ctx.store, role: ctx.role })),
  });
  ```

  Replace `packages/api/src/routers/index.ts` with the following. The scaffold's `privateData` procedure goes away along with the dashboard page that used it (Task 14).

  ```ts
  import { pingDatabase } from "@jendal-workspace/db/health";

  import { publicProcedure, router } from "../index";
  import { storeRouter } from "./store";

  export const appRouter = router({
    healthCheck: publicProcedure.query(async ({ ctx }) => {
      await pingDatabase(ctx.db);
      return "OK";
    }),
    store: storeRouter,
  });
  export type AppRouter = typeof appRouter;
  ```

- [ ] **Step 6: Run tests to verify they pass**

  Run: `pnpm test packages/api`
  Expected: PASS, 8 tests.

- [ ] **Step 7: Type check and commit**

  Run: `pnpm -F @jendal-workspace/api check-types`
  Expected: exits 0. If `makeSession` fails to type-check because the inferred Better Auth session has more required fields, add exactly the fields the compiler names to the literal.

  ```bash
  git add packages/api pnpm-lock.yaml
  git commit -m "feat(api): store procedure with access rule, store list and store detail"
  ```

---

### Task 11: KV store cache adapter

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/src/tenant/kv-store-cache.ts`
- Test: `apps/server/src/tenant/kv-store-cache.test.ts`

- [ ] **Step 1: Depend on `core`**

  In `apps/server/package.json` `dependencies`, add:

  ```json
      "@jendal-workspace/core": "workspace:*",
  ```

  Run: `pnpm install`
  Expected: completes.

- [ ] **Step 2: Write the failing test**

  `apps/server/src/tenant/kv-store-cache.test.ts`:

  ```ts
  import type { StoreRecord } from "@jendal-workspace/core";
  import { describe, expect, it } from "vitest";

  import { createKvStoreCache, type JsonKv } from "./kv-store-cache";

  const acme: StoreRecord = {
    id: "store-1",
    organizationId: "org-1",
    slug: "acme",
    name: "Acme",
    status: "active",
    paypalMerchantId: null,
  };

  function fakeKv() {
    const values = new Map<string, string>();
    const ttls = new Map<string, number | undefined>();
    const kv: JsonKv = {
      async get(key) {
        const raw = values.get(key);
        return raw === undefined ? null : JSON.parse(raw);
      },
      async put(key, value, options) {
        values.set(key, value);
        ttls.set(key, options?.expirationTtl);
      },
      async delete(key) {
        values.delete(key);
      },
    };
    return { kv, values, ttls };
  }

  describe("createKvStoreCache", () => {
    it("stores records as JSON under a prefixed key with a TTL", async () => {
      const { kv, values, ttls } = fakeKv();
      const cache = createKvStoreCache(kv, 120);

      await cache.put("slug:acme", acme);

      expect(JSON.parse(values.get("store:slug:acme") ?? "null")).toEqual(acme);
      expect(ttls.get("store:slug:acme")).toBe(120);
      await expect(cache.get("slug:acme")).resolves.toEqual(acme);
    });

    it("returns null on a miss", async () => {
      const { kv } = fakeKv();
      await expect(createKvStoreCache(kv).get("slug:ghost")).resolves.toBeNull();
    });

    it("treats a malformed cached value as a miss", async () => {
      const { kv, values } = fakeKv();
      values.set("store:slug:acme", JSON.stringify({ id: "store-1" }));

      await expect(createKvStoreCache(kv).get("slug:acme")).resolves.toBeNull();
    });

    it("deletes a cached record", async () => {
      const { kv, values } = fakeKv();
      const cache = createKvStoreCache(kv);
      await cache.put("slug:acme", acme);

      await cache.delete("slug:acme");

      expect(values.has("store:slug:acme")).toBe(false);
      await expect(cache.get("slug:acme")).resolves.toBeNull();
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**

  Run: `pnpm test apps/server/src/tenant/kv-store-cache.test.ts`
  Expected: FAIL with `Cannot find module './kv-store-cache'`.

- [ ] **Step 4: Implement**

  `apps/server/src/tenant/kv-store-cache.ts`:

  ```ts
  import type { StoreLookupCache } from "@jendal-workspace/core";
  import { z } from "zod";

  // The subset of KVNamespace this adapter uses; a real KVNamespace satisfies it.
  export interface JsonKv {
    get(key: string, type: "json"): Promise<unknown>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  }

  const cachedStoreSchema = z.object({
    id: z.string(),
    organizationId: z.string(),
    slug: z.string(),
    name: z.string(),
    status: z.enum(["draft", "active", "suspended"]),
    paypalMerchantId: z.string().nullable(),
  });

  const KEY_PREFIX = "store:";
  // KV rejects expirationTtl values below 60 seconds. Short enough that a rename shows up quickly.
  const DEFAULT_TTL_SECONDS = 300;

  export function createKvStoreCache(kv: JsonKv, ttlSeconds = DEFAULT_TTL_SECONDS): StoreLookupCache {
    return {
      async get(key) {
        const parsed = cachedStoreSchema.safeParse(await kv.get(`${KEY_PREFIX}${key}`, "json"));
        return parsed.success ? parsed.data : null;
      },
      async put(key, store) {
        await kv.put(`${KEY_PREFIX}${key}`, JSON.stringify(store), { expirationTtl: ttlSeconds });
      },
      async delete(key) {
        await kv.delete(`${KEY_PREFIX}${key}`);
      },
    };
  }
  ```

- [ ] **Step 5: Run test to verify it passes**

  Run: `pnpm test apps/server/src/tenant/kv-store-cache.test.ts`
  Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server pnpm-lock.yaml
  git commit -m "feat(server): cache store lookups in Workers KV"
  ```

---

### Task 12: Tenant middleware and store info route

**Files:**
- Create: `apps/server/src/app-env.ts`, `apps/server/src/tenant/middleware.ts`, `apps/server/src/routes/store-info.ts`
- Test: `apps/server/src/tenant/middleware.test.ts`

- [ ] **Step 1: Create the Hono variables type**

  `apps/server/src/app-env.ts`:

  ```ts
  import type { Auth } from "@jendal-workspace/auth";
  import type { RequestTarget, StoreRecord, TenantContext } from "@jendal-workspace/core";
  import type { Database } from "@jendal-workspace/db";
  import type { EvlogVariables } from "evlog/hono";

  export type AppEnv = {
    Variables: EvlogVariables["Variables"] & {
      db: Database;
      auth: Auth;
      target: RequestTarget;
      store: StoreRecord | null;
      tenant: TenantContext | null;
    };
  };
  ```

- [ ] **Step 2: Write the failing test**

  `apps/server/src/tenant/middleware.test.ts`:

  ```ts
  import type { StoreDirectory, StoreLookupCache, StoreRecord } from "@jendal-workspace/core";
  import { evlog } from "evlog/hono";
  import { Hono } from "hono";
  import { describe, expect, it } from "vitest";

  import type { AppEnv } from "../app-env";
  import { storeInfoRoute } from "../routes/store-info";
  import { routingPathFor, tenantMiddleware } from "./middleware";

  const acme: StoreRecord = {
    id: "store-1",
    organizationId: "org-1",
    slug: "acme",
    name: "Acme",
    status: "active",
    paypalMerchantId: null,
  };
  const closed: StoreRecord = { ...acme, id: "store-2", slug: "closed", status: "suspended" };

  function buildApp() {
    const directoryCalls: string[] = [];
    const directory: StoreDirectory = {
      async findById(id) {
        directoryCalls.push(`id:${id}`);
        return [acme, closed].find((s) => s.id === id) ?? null;
      },
      async findBySlug(slug) {
        directoryCalls.push(`slug:${slug}`);
        return [acme, closed].find((s) => s.slug === slug) ?? null;
      },
      async findByHostname(hostname) {
        directoryCalls.push(`host:${hostname}`);
        return hostname === "shop.acme.com" ? acme : null;
      },
    };
    const entries = new Map<string, StoreRecord>();
    const cache: StoreLookupCache = {
      async get(key) {
        return entries.get(key) ?? null;
      },
      async put(key, store) {
        entries.set(key, store);
      },
      async delete(key) {
        entries.delete(key);
      },
    };

    const app = new Hono<AppEnv>({ getPath: (request) => routingPathFor(request, "payleor.app") });
    app.use(evlog());
    app.use(tenantMiddleware({ platformDomain: "payleor.app", environment: "sandbox" }, () => ({ directory, cache })));
    app.route("/", storeInfoRoute);
    app.get("*", (c) => c.json({ target: c.get("target").kind, store: c.get("tenant")?.slug ?? null }));

    return { app, directoryCalls };
  }

  describe("tenantMiddleware", () => {
    it("resolves a store subdomain and exposes it to routes", async () => {
      const { app } = buildApp();

      const response = await app.request("https://acme.payleor.app/api/store");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ storeId: "store-1", slug: "acme", name: "Acme" });
    });

    it("resolves path-based store URLs", async () => {
      const { app } = buildApp();

      const response = await app.request("https://store.payleor.app/acme/products");

      expect(await response.json()).toEqual({ target: "store", store: "acme" });
    });

    it("routes path-based store URLs without their base path", async () => {
      const { app } = buildApp();

      const response = await app.request("https://store.payleor.app/acme/api/store");

      expect(await response.json()).toEqual({ storeId: "store-1", slug: "acme", name: "Acme" });
    });

    it("resolves active custom domains", async () => {
      const { app } = buildApp();

      const response = await app.request("https://shop.acme.com/");

      expect(await response.json()).toEqual({ target: "custom-domain", store: "acme" });
    });

    it("passes platform hosts through without a tenant", async () => {
      const { app, directoryCalls } = buildApp();

      const response = await app.request("https://api.payleor.app/anything");

      expect(await response.json()).toEqual({ target: "platform", store: null });
      expect(directoryCalls).toEqual([]);
    });

    it("returns 404 for unknown, suspended and invalid store hosts", async () => {
      const { app } = buildApp();

      for (const url of ["https://ghost.payleor.app/", "https://closed.payleor.app/", "https://docs.payleor.app/"]) {
        const response = await app.request(url);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "store_not_found" });
      }
    });

    it("serves repeat lookups from the cache", async () => {
      const { app, directoryCalls } = buildApp();

      await app.request("https://acme.payleor.app/");
      await app.request("https://acme.payleor.app/");

      expect(directoryCalls).toEqual(["slug:acme"]);
    });

    it("reports that platform hosts have no store info", async () => {
      const { app } = buildApp();

      const response = await app.request("https://api.payleor.app/api/store");

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_a_store_host" });
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**

  Run: `pnpm test apps/server/src/tenant/middleware.test.ts`
  Expected: FAIL with `Cannot find module '../routes/store-info'`.

- [ ] **Step 4: Implement the middleware**

  `apps/server/src/tenant/middleware.ts`:

  ```ts
  import {
    createTenantContext,
    isStoreReachable,
    lookupForTarget,
    parseRequestTarget,
    resolveStore,
    routingPath,
    type StoreDirectory,
    type StoreLookupCache,
    type TenantEnvironment,
  } from "@jendal-workspace/core";
  import type { Context } from "hono";
  import { createMiddleware } from "hono/factory";

  import type { AppEnv } from "../app-env";

  export type TenantSettings = { platformDomain: string; environment: TenantEnvironment };
  export type StoreLookupDeps = { directory: StoreDirectory; cache: StoreLookupCache };

  // Used as Hono's getPath, so routes match store.{domain}/{slug}/x as /x.
  export function routingPathFor(request: Request, platformDomain: string): string {
    const url = new URL(request.url);
    const target = parseRequestTarget({ hostname: url.hostname, pathname: url.pathname }, platformDomain);
    return routingPath(target, url.pathname);
  }

  // Cloudflare for SaaS attaches custom hostname metadata to request.cf.
  function hostMetadataStoreId(request: Request): string | undefined {
    const cf: unknown = Reflect.get(request, "cf");
    if (typeof cf !== "object" || cf === null || !("hostMetadata" in cf)) return undefined;
    const metadata = cf.hostMetadata;
    if (typeof metadata !== "object" || metadata === null || !("storeId" in metadata)) return undefined;
    return typeof metadata.storeId === "string" ? metadata.storeId : undefined;
  }

  export function tenantMiddleware(
    settings: TenantSettings,
    getStoreLookup: (c: Context<AppEnv>) => StoreLookupDeps,
  ) {
    return createMiddleware<AppEnv>(async (c, next) => {
      const url = new URL(c.req.url);
      const target = parseRequestTarget({ hostname: url.hostname, pathname: url.pathname }, settings.platformDomain);
      c.set("target", target);
      c.set("store", null);
      c.set("tenant", null);

      if (target.kind === "platform") {
        await next();
        return;
      }

      const lookup = lookupForTarget(target, hostMetadataStoreId(c.req.raw));
      const store = lookup ? await resolveStore(lookup, getStoreLookup(c)) : null;

      if (!store || !isStoreReachable(store)) {
        c.get("log").set({ tenant: { resolved: false, target: target.kind } });
        return c.json({ error: "store_not_found" }, 404);
      }

      const tenant = createTenantContext(store, "web", settings.environment);
      c.set("store", store);
      c.set("tenant", tenant);
      c.get("log").set({
        tenant: { storeId: tenant.storeId, organizationId: tenant.organizationId, channel: tenant.channel },
      });
      await next();
    });
  }
  ```

- [ ] **Step 5: Implement the route**

  `apps/server/src/routes/store-info.ts`:

  ```ts
  import { Hono } from "hono";

  import type { AppEnv } from "../app-env";

  export const storeInfoRoute = new Hono<AppEnv>().get("/api/store", (c) => {
    const store = c.get("store");
    if (!store) return c.json({ error: "not_a_store_host" }, 404);
    return c.json({ storeId: store.id, slug: store.slug, name: store.name });
  });
  ```

- [ ] **Step 6: Run test to verify it passes**

  Run: `pnpm test apps/server/src/tenant`
  Expected: PASS, 12 tests (8 middleware, 4 cache).

- [ ] **Step 7: Commit**

  ```bash
  git add apps/server/src/app-env.ts apps/server/src/tenant apps/server/src/routes
  git commit -m "feat(server): resolve the tenant for store hosts"
  ```

---

### Task 13: Alchemy resources and api Worker wiring

**Files:**
- Modify: `packages/infra/alchemy.run.ts`, `packages/infra/dev-hosts.ts`, `packages/infra/.env.schema`, `packages/infra/package.json`
- Modify: `apps/server/.env.schema`, `apps/server/.env`, `apps/server/src/services.ts`, `apps/server/src/context.ts`, `apps/server/src/index.ts`, `turbo.json`

- [ ] **Step 1: Declare the server variables**

  Replace `apps/server/.env.schema` with:

  ```sh
  # @defaultRequired=true
  # @defaultSensitive=true
  # @currentEnv=$NODE_ENV
  # @generateTsTypes(path=./src/env.ts, exposeEnv=local)
  # ---

  # @public @type=enum(development, production, test)
  NODE_ENV=development

  # @type=string(minLength=32)
  BETTER_AUTH_SECRET=

  # The admin origin. Better Auth builds callback URLs from it; http://admin.localhost:3001 in development.
  # @public @type=url
  BETTER_AUTH_URL=

  # Direct Aiven URL, used by drizzle-kit and as the Hyperdrive origin. Workers connect through Hyperdrive.
  # @type=string(minLength=1)
  DATABASE_URL=

  # Root domain for admin and store hosts, e.g. payleor.app; "localhost" in development.
  # @public @type=string(minLength=1)
  PLATFORM_DOMAIN=localhost

  # @public @type=enum(sandbox, live)
  PAYPAL_ENVIRONMENT=sandbox

  # @public @type=string(minLength=1)
  PAYPAL_CLIENT_ID=

  # @type=string(minLength=1)
  PAYPAL_CLIENT_SECRET=
  ```

  Delete the `CORS_ORIGIN=` line from `apps/server/.env`. The browser no longer calls the api Worker cross-origin.

  Replace `packages/infra/.env.schema` with:

  ```sh
  # @import(../../apps/server/, pick=[NODE_ENV, DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, PLATFORM_DOMAIN, PAYPAL_ENVIRONMENT, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET])
  # @defaultRequired=false
  # @defaultSensitive=true
  # ---
  ALCHEMY_PASSWORD=

  # Domain the named tunnel serves (pnpm tunnel) with the production layout: web on D and *.D, api on api.D.
  # Leave empty to reach the local stages on localhost only.
  # @public
  TUNNEL_DOMAIN=

  # Local stage that owns TUNNEL_DOMAIN; the other stage stays on localhost.
  # @public @type=enum(dev, preprod)
  TUNNEL_STAGE=dev
  ```

  Run: `pnpm env:generate`
  Expected: `apps/server/src/env.ts` lists the new keys and no longer lists `CORS_ORIGIN`.

- [ ] **Step 2: Add the vinext integration to infra**

  In `packages/infra/package.json` `devDependencies`, add:

  ```json
      "@alchemy.run/frontend-frameworks": "2.0.0-beta.80",
      "hono": "^4.13.12",
      "vite": "^8.3.2",
  ```

  Run: `pnpm install`

  `hono` is an optional peer of `alchemy` and `@alchemy.run/frontend-frameworks` (`^4.12.14`). Without a direct dependency, pnpm fills it with the `hono@4.11.4` that `@prisma/dev` pins.

  Alchemy loads the frontend integration as its own optional peer, so it must be resolvable from `packages/infra`. Task 14 also adds it to `apps/web`, as the Alchemy vinext docs ask.

- [ ] **Step 3: Declare the resources**

  The local stages need the same values a deployed stage gets from its env: the platform domain and the admin origin used as `BETTER_AUTH_URL`. In `packages/infra/dev-hosts.ts`, replace the `StageUrls` type and the `stageUrls` function with:

  ```ts
  export type StageUrls = { platformDomain: string; admin: string };

  // Only the stage that owns the tunnel is reached through D; the other one stays on localhost.
  export function stageUrls(stage: LocalStage, tunnel: TunnelSettings | undefined): StageUrls {
    if (tunnel?.stage === stage) {
      return { platformDomain: tunnel.domain, admin: `https://admin.${tunnel.domain}` };
    }
    return { platformDomain: "localhost", admin: `http://admin.localhost:${PORTS[stage].web}` };
  }
  ```

  Then replace `packages/infra/alchemy.run.ts` with:

  ```ts
  import * as Alchemy from "alchemy";
  import * as Cloudflare from "alchemy/Cloudflare";
  import * as Config from "effect/Config";
  import * as Effect from "effect/Effect";
  import * as Redacted from "effect/Redacted";
  import "varlock/auto-load";

  import { localPorts, parseLocalStage, stageUrls, tunnelSettings } from "./dev-hosts.ts";

  // Set only by the `dev` and `dev:preprod` scripts, so deployed stages keep their env values.
  const localStage = parseLocalStage(process.env.JENDAL_LOCAL_STAGE);
  const ports = localPorts(localStage ?? "dev");
  const localUrls = localStage ? stageUrls(localStage, tunnelSettings(process.env)) : undefined;
  const platformDomain = localUrls ? localUrls.platformDomain : Config.String("PLATFORM_DOMAIN");

  function postgresOrigin(connectionUri: string) {
    const url = new URL(connectionUri);
    return {
      scheme: "postgres" as const,
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: Redacted.make(decodeURIComponent(url.password)),
    };
  }

  // alchemy dev does not use the Hyperdrive service: the Worker connects to the dev origin itself, and
  // workerd only trusts public CAs, so it cannot reach Aiven (private CA). Local stages use a local database.
  function devDatabaseOrigin() {
    const url = process.env.DEV_DATABASE_URL;
    if (!url) throw new Error("Set DEV_DATABASE_URL in packages/infra/.env to run a local stage.");
    return { ...postgresOrigin(url), sslmode: "disable" as const };
  }

  export const Database = Effect.gen(function* () {
    const origin = postgresOrigin(Redacted.value(yield* Config.Redacted("DATABASE_URL")));
    return yield* Cloudflare.Hyperdrive.Connection("Database", {
      origin,
      // Reads must see writes immediately (spec §2.1).
      caching: { disabled: true },
      dev: localStage ? devDatabaseOrigin() : undefined,
    });
  });

  export const StoreCache = Cloudflare.KV.Namespace("StoreCache");

  const observability = {
    enabled: true,
    logs: { enabled: true, invocationLogs: true },
    traces: { enabled: true },
  };

  export const server = Cloudflare.Worker("server", {
    main: "../../apps/server/src/index.ts",
    compatibility: {
      flags: ["nodejs_compat"],
    },
    observability,
    env: {
      HYPERDRIVE: Database,
      STORE_CACHE: StoreCache,
      BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
      BETTER_AUTH_URL: localUrls ? localUrls.admin : Config.String("BETTER_AUTH_URL"),
      PLATFORM_DOMAIN: platformDomain,
      PAYPAL_ENVIRONMENT: Config.String("PAYPAL_ENVIRONMENT"),
      PAYPAL_CLIENT_ID: Config.String("PAYPAL_CLIENT_ID"),
      PAYPAL_CLIENT_SECRET: Config.Redacted("PAYPAL_CLIENT_SECRET"),
    },
    dev: {
      port: ports.api,
      // Fail instead of drifting to the next port, which may belong to the other stage.
      strictPort: true,
    },
  });

  export type ServerEnv = Cloudflare.InferEnv<typeof server>;

  // Website.Vinext provisions VINEXT_KV_CACHE and CF_VERSION_METADATA itself; do not bind them.
  export class Web extends Cloudflare.Website.Vinext<Web>()("web", {
    rootDir: "../../apps/web",
    memo: {
      lockfile: true,
      // The web build bundles these workspace packages.
      include: ["**/*", "../../packages/core/src/**", "../../packages/ui/src/**"],
    },
    observability,
    env: {
      SERVER: server,
      PLATFORM_DOMAIN: platformDomain,
    },
    dev: {
      port: ports.web,
    },
  }) {}

  export type WebEnv = Cloudflare.InferEnv<typeof Web>;

  export default Alchemy.Stack(
    "jendal-workspace",
    {
      providers: Cloudflare.providers(),
      state: Cloudflare.state(),
    },
    Effect.gen(function* () {
      const serverWorker = yield* server;
      const web = yield* Web;

      return {
        web: web.url,
        server: serverWorker.url,
      };
    }),
  );
  ```

  `apps/server/cloudflare-env.d.ts` stays as it is. It already infers `CloudflareEnv` from `ServerEnv`.

  On a local stage, `PLATFORM_DOMAIN` and `BETTER_AUTH_URL` come from `dev-hosts.ts`, so the values in `apps/server/.env` only apply to deployed stages. With `TUNNEL_STAGE=dev`, the dev stage gets `elysiumjs.com` and `https://admin.elysiumjs.com`, and preprod gets `localhost` and `http://admin.localhost:3101`. Switching to `payleor.com` only changes `TUNNEL_DOMAIN` locally and `PLATFORM_DOMAIN` when deployed.

- [ ] **Step 4: One database client and auth instance per request**

  A Worker cannot reuse a database connection across requests. Hyperdrive makes a new client per request cheap.

  Replace `apps/server/src/services.ts` with:

  ```ts
  import { createAuth as createConfiguredAuth } from "@jendal-workspace/auth";
  import { type Database, createDb } from "@jendal-workspace/db";

  import { ENV } from "./env.server";

  export function getDb(): Database {
    return createDb({ DATABASE_URL: ENV.HYPERDRIVE.connectionString });
  }

  export function createAuth(database: Database) {
    return createConfiguredAuth(ENV, database);
  }
  ```

  Replace `apps/server/src/context.ts` with:

  ```ts
  import type { Context as ApiContext } from "@jendal-workspace/api/context";
  import type { TenantEnvironment } from "@jendal-workspace/core";
  import type { Context as HonoContext } from "hono";

  import type { AppEnv } from "./app-env";

  export async function createContext(c: HonoContext<AppEnv>, environment: TenantEnvironment): Promise<ApiContext> {
    const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
    return { db: c.get("db"), session, environment };
  }
  ```

- [ ] **Step 5: Wire the api Worker**

  Replace `apps/server/src/index.ts` with:

  ```ts
  import { trpcServer } from "@hono/trpc-server";
  import { appRouter } from "@jendal-workspace/api/routers/index";
  import type { TenantEnvironment } from "@jendal-workspace/core";
  import { createStoreDirectory } from "@jendal-workspace/db/repositories/stores";
  import { initLogger } from "evlog";
  import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
  import { evlog } from "evlog/hono";
  import { Hono } from "hono";

  import type { AppEnv } from "./app-env";
  import { createContext } from "./context";
  import { ENV } from "./env.server";
  import { storeInfoRoute } from "./routes/store-info";
  import { createAuth, getDb } from "./services";
  import { createKvStoreCache } from "./tenant/kv-store-cache";
  import { routingPathFor, tenantMiddleware } from "./tenant/middleware";

  initLogger({
    env: { service: "jendal-api" },
  });

  const environment: TenantEnvironment = ENV.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";

  const app = new Hono<AppEnv>({ getPath: (request) => routingPathFor(request, ENV.PLATFORM_DOMAIN) });

  app.use(evlog());

  app.use("*", async (c, next) => {
    const db = getDb();
    const auth = createAuth(db);
    c.set("db", db);
    c.set("auth", auth);
    const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
      exclude: ["/api/auth/**"],
      maskEmail: true,
    });
    try {
      await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
      await next();
    } finally {
      c.executionCtx.waitUntil(db.$client.end());
    }
  });

  app.use(
    "/api/store",
    tenantMiddleware({ platformDomain: ENV.PLATFORM_DOMAIN, environment }, (c) => ({
      directory: createStoreDirectory(c.get("db")),
      cache: createKvStoreCache(ENV.STORE_CACHE),
    })),
  );

  app.on(["POST", "GET"], "/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

  app.use("/trpc/*", (c, next) =>
    trpcServer({
      endpoint: "/trpc",
      router: appRouter,
      createContext: () => createContext(c, environment),
    })(c, next),
  );

  app.route("/", storeInfoRoute);

  app.get("/", (c) => {
    return c.text("OK");
  });

  export default app;
  ```

  The tenant middleware runs only on store-scoped routes. Auth and tRPC are served on the admin host, and on hosts that are not yet routed (such as `workers.dev`), without a store lookup. Protocol routes join this list in later weeks.

- [ ] **Step 6: Update the Turborepo environment list**

  In `turbo.json`, replace `globalEnv` with:

  ```json
    "globalEnv": [
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "CI",
      "DATABASE_URL",
      "NODE_ENV",
      "PAYPAL_CLIENT_ID",
      "PAYPAL_CLIENT_SECRET",
      "PAYPAL_ENVIRONMENT",
      "PLATFORM_DOMAIN",
      "TUNNEL_DOMAIN",
      "TUNNEL_STAGE",
      "_VARLOCK_ENV_KEY"
    ],
  ```

- [ ] **Step 7: Type check**

  Run: `pnpm -F @jendal-workspace/infra check-types && pnpm -F server check-types`
  Expected: both exit 0.
  - If `infra` reports an error on `observability`, open the `WorkerObservability` type (`refs/stack/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts:81-84`, example at `2098-2115`) and add the fields it requires.
  - If the error is on `HYPERDRIVE: Database`, check Fact 7, then adjust only the binding expression.

- [ ] **Step 8: Run all tests**

  Run: `pnpm test`
  Expected: every test file passes.

- [ ] **Step 9: Commit**

  ```bash
  git add apps/server packages/infra turbo.json pnpm-lock.yaml
  git commit -m "feat(infra): Hyperdrive, store cache KV and the vinext website; per-request DB and auth in the api"
  ```

  `alchemy dev` is not run yet: `Website.Vinext` needs the vinext app from Task 14.

---

### Task 14: Move the web app to vinext

**Files:**
- Modify: `apps/web/package.json`, `next.config.ts`, `tsconfig.json`, `.env.schema`, `.gitignore`, `AGENTS.md`, `src/lib/auth-client.ts`, `src/utils/trpc.ts`, `src/components/header.tsx`, `src/components/sign-in-form.tsx`, `src/components/sign-up-form.tsx`, root `package.json`
- Create: `apps/web/vite.config.ts`, `apps/web/worker/index.ts`, `apps/web/cloudflare-env.d.ts`, `apps/web/src/lib/host-routing.ts`
- Delete: `apps/web/open-next.config.ts`, `wrangler.jsonc`, `instrumentation.ts`, `src/proxy.ts`, `src/lib/evlog.ts`, `src/app/dashboard/`, `next-env.d.ts`, `tsconfig.tsbuildinfo`
- Test: `apps/web/src/lib/host-routing.test.ts`

- [ ] **Step 1: Run the compatibility check**

  Run: `cd apps/web && pnpm dlx vinext@1.0.1 check; cd ../..`
  Expected: a scored report. It should list `typedRoutes` and `reactCompiler` as partial; both are handled in this task. Stop and report to the user if it lists anything as unsupported other than those two and `next/font/google` (partial: loaded from the CDN).

- [ ] **Step 2: Replace the package manifest**

  Replace `apps/web/package.json` with:

  ```json
  {
    "name": "web",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "build": "vite build",
      "check-types": "tsc --noEmit",
      "env:generate": "varlock codegen"
    },
    "dependencies": {
      "@jendal-workspace/api": "workspace:*",
      "@jendal-workspace/core": "workspace:*",
      "@jendal-workspace/ui": "workspace:*",
      "@tanstack/react-form": "^1.33.5",
      "@tanstack/react-query": "^5.102.8",
      "@trpc/client": "catalog:",
      "@trpc/server": "catalog:",
      "@trpc/tanstack-react-query": "^11.19.0",
      "better-auth": "catalog:",
      "evlog": "catalog:",
      "lucide-react": "catalog:",
      "next-themes": "catalog:",
      "react": "catalog:",
      "react-dom": "catalog:",
      "react-server-dom-webpack": "^19.3.0",
      "sonner": "catalog:",
      "varlock": "catalog:",
      "vinext": "1.0.1",
      "zod": "catalog:"
    },
    "devDependencies": {
      "@alchemy.run/frontend-frameworks": "2.0.0-beta.80",
      "@cloudflare/workers-types": "catalog:",
      "@jendal-workspace/auth": "workspace:*",
      "@jendal-workspace/config": "workspace:*",
      "@jendal-workspace/infra": "workspace:*",
      "@tailwindcss/postcss": "catalog:",
      "@tanstack/react-query-devtools": "^5.102.8",
      "@types/node": "catalog:",
      "@types/react": "catalog:",
      "@types/react-dom": "catalog:",
      "@vitejs/plugin-react": "^6.1.1",
      "@vitejs/plugin-rsc": "^0.5.35",
      "oxc-transform-react": "^0.152.0",
      "tailwindcss": "catalog:",
      "typescript": "catalog:",
      "vite": "^8.3.2"
    }
  }
  ```

  This removes `next`, `@opennextjs/cloudflare`, `wrangler`, `babel-plugin-react-compiler` and `@swc/helpers`. There is no `dev` script: `pnpm dev` runs Alchemy, which starts Vite for this app.

  In the root `package.json` `scripts`, delete the `"dev:web"` and `"dev:server"` lines. `dev:server` pointed at a `hono` filter that does not exist.

- [ ] **Step 3: Delete the Next.js and OpenNext files**

  ```bash
  git rm apps/web/open-next.config.ts apps/web/wrangler.jsonc apps/web/instrumentation.ts apps/web/src/proxy.ts apps/web/src/lib/evlog.ts
  git rm -r apps/web/src/app/dashboard
  rm -f apps/web/next-env.d.ts apps/web/tsconfig.tsbuildinfo
  ```

  The last two files are gitignored build artifacts.

- [ ] **Step 4: Add the Vite and vinext configuration**

  `apps/web/vite.config.ts`. Alchemy injects the Cloudflare plugin, so it is not listed here (Fact 8):

  ```ts
  import { env } from "node:process";

  import vinext from "vinext";
  import { defineConfig } from "vite";

  // Both values come from the infra `dev` / `dev:preprod` scripts (packages/infra/dev-hosts.ts).
  const tunnelDomain = env.TUNNEL_DOMAIN;

  export default defineConfig({
    plugins: [vinext({ react: { compiler: true } })],
    // Each stage's dev server gets its own dependency cache, so dev and preprod can run at once.
    cacheDir: env.JENDAL_LOCAL_STAGE === "preprod" ? "node_modules/.vite-preprod" : undefined,
    server: {
      // Vite rejects unknown Host headers; the tunnel sends D and *.D. A leading dot allows subdomains.
      allowedHosts: tunnelDomain ? [`.${tunnelDomain}`] : [],
    },
  });
  ```

  Replace `apps/web/next.config.ts` with the following. vinext ignores `reactCompiler` and only partly supports `typedRoutes`, so both are removed. The `distDir` and `allowedDevOrigins` tunnel settings only applied to `next dev` and are dropped with it:

  ```ts
  import type { NextConfig } from "next";

  import { withPwa } from "./pwa.config";

  const nextConfig: NextConfig = {};

  export default withPwa(nextConfig);
  ```

- [ ] **Step 5: Update the TypeScript configuration**

  Replace `apps/web/tsconfig.json` with:

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["dom", "dom.iterable", "esnext"],
      "allowJs": true,
      "skipLibCheck": true,
      "strict": true,
      "noEmit": true,
      "esModuleInterop": true,
      "module": "esnext",
      "moduleResolution": "bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "verbatimModuleSyntax": true,
      "jsx": "react-jsx",
      "allowImportingTsExtensions": true,
      "paths": {
        "@/*": ["./src/*"],
        "@jendal-workspace/ui/*": ["../../packages/ui/src/*"]
      },
      "types": ["vinext/types", "@cloudflare/workers-types"]
    },
    "include": ["**/*.ts", "**/*.tsx"],
    "exclude": ["./node_modules", "./dist"]
  }
  ```

  `allowImportingTsExtensions` is needed because `cloudflare-env.d.ts` below pulls in `packages/infra/alchemy.run.ts`, which imports `./dev-hosts.ts` (Fact 12).

  `apps/web/cloudflare-env.d.ts` types `import { env } from "cloudflare:workers"` from the Alchemy declaration:

  ```ts
  import type { WebEnv } from "@jendal-workspace/infra/alchemy.run";

  declare module "cloudflare:workers" {
    namespace Cloudflare {
      export interface Env extends WebEnv {}
    }
  }
  ```

- [ ] **Step 6: Write the failing forwarding test**

  `apps/web/src/lib/host-routing.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { shouldForwardToApi } from "./host-routing";

  const DOMAIN = "payleor.app";
  const forwards = (href: string) => shouldForwardToApi(new URL(href), DOMAIN);

  describe("shouldForwardToApi", () => {
    it("forwards auth and tRPC requests", () => {
      expect(forwards("https://admin.payleor.app/api/auth/get-session")).toBe(true);
      expect(forwards("https://admin.payleor.app/trpc/store.listMine?batch=1")).toBe(true);
    });

    it("forwards store API paths, including path-based stores", () => {
      expect(forwards("https://acme.payleor.app/api/store")).toBe(true);
      expect(forwards("https://store.payleor.app/acme/api/store")).toBe(true);
    });

    it("leaves pages and look-alike paths to the web app", () => {
      for (const href of [
        "https://admin.payleor.app/acme",
        "https://payleor.app/apiary",
        "https://admin.payleor.app/trpcx",
        "https://store.payleor.app/acme/products",
      ]) {
        expect(forwards(href)).toBe(false);
      }
    });
  });
  ```

  Run: `pnpm install && pnpm test apps/web`
  Expected: FAIL with `Cannot find module './host-routing'`.

- [ ] **Step 7: Implement forwarding**

  `apps/web/src/lib/host-routing.ts`:

  ```ts
  import { parseRequestTarget, type RequestTarget, routingPath } from "@jendal-workspace/core";

  const API_PATH_PREFIXES = ["/api/", "/trpc/"];

  function targetAndPath(url: URL, platformDomain: string): { target: RequestTarget; path: string } {
    const target = parseRequestTarget({ hostname: url.hostname, pathname: url.pathname }, platformDomain);
    return { target, path: routingPath(target, url.pathname) };
  }

  export function shouldForwardToApi(url: URL, platformDomain: string): boolean {
    const { path } = targetAndPath(url, platformDomain);
    return API_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
  }
  ```

  Run: `pnpm test apps/web`
  Expected: PASS, 3 tests.

- [ ] **Step 8: Create the Worker entry**

  `apps/web/worker/index.ts`:

  ```ts
  import type { WebEnv } from "@jendal-workspace/infra/alchemy.run";
  import { initWorkersLogger, withEvlog } from "evlog/workers";
  import handler from "vinext/server/fetch-handler";

  import { shouldForwardToApi } from "../src/lib/host-routing";

  initWorkersLogger({ env: { service: "jendal-web" } });

  export default withEvlog<WebEnv>(async (request, env, ctx, log) => {
    // The original request keeps its host, so the api resolves the same store and cookies stay first-party.
    if (shouldForwardToApi(new URL(request.url), env.PLATFORM_DOMAIN)) {
      log.set({ forwardedTo: "api" });
      return env.SERVER.fetch(request);
    }
    return handler.fetch(request, env, ctx);
  });
  ```

- [ ] **Step 9: Call the api on the same origin**

  Replace `apps/web/src/lib/auth-client.ts` with the following. Without a `baseURL`, the client uses `/api/auth` on the current origin (`refs/stack/better-auth/packages/better-auth/src/client/config.ts:62-65`):

  ```ts
  import { createAuthClient } from "better-auth/react";

  export const authClient = createAuthClient();
  ```

  In `apps/web/src/utils/trpc.ts`, replace the `url:` line with:

  ```ts
        url: "/trpc",
  ```

  In the same file, delete the `fetch(url, options) { ... }` override. Same-origin requests send cookies by default.

  In `apps/web/src/components/header.tsx`, replace the `links` array with:

  ```ts
    const links = [{ to: "/", label: "Home" }] as const;
  ```

  In `apps/web/src/components/sign-in-form.tsx` and `apps/web/src/components/sign-up-form.tsx`, replace `router.push("/dashboard");` with `router.push("/");`.

- [ ] **Step 10: Remove the public server URL**

  In `apps/web/.env.schema`, delete the `NEXT_PUBLIC_SERVER_URL` entry and its decorator comment. In `apps/web/.env`, delete the `NEXT_PUBLIC_SERVER_URL=` line.

  Run: `pnpm env:generate`
  Expected: `apps/web/src/env.ts` no longer mentions `NEXT_PUBLIC_SERVER_URL`.

- [ ] **Step 11: Update the ignore file and the agent notes**

  Append to `apps/web/.gitignore`:

  ```gitignore
  .vinext/
  ```

  Replace `apps/web/AGENTS.md` with:

  ```markdown
  # apps/web

  This app runs on **vinext** (the Next.js API on Vite), not Next.js. Next.js documentation applies only where vinext supports the feature. Check support in `../../../refs/stack/vinext/README.md` and `packages/vinext/src/check.ts`, and use the `migrate-to-vinext` skill.

  - Alchemy deploys it with `Cloudflare.Website.Vinext` (`packages/infra/alchemy.run.ts`). There is no `wrangler.jsonc`.
  - `worker/index.ts` forwards `/api/*` and `/trpc/*` to the api Worker; everything else goes to vinext.
  - Server code reads bindings with `import { env } from "cloudflare:workers"`.
  ```

- [ ] **Step 12: Type check and run tests**

  Run: `pnpm check-types && pnpm test`
  Expected: `Tasks: 8 successful, 8 total`, and every test file passes.
  - If `web` cannot resolve `@/…` imports in `check-types`, the `paths` block above is wrong. Fix it there, not in the imports.
  - If `web` fails on files under `packages/infra` because Node globals are missing, add `"node"` to `types` in `apps/web/tsconfig.json`.

- [ ] **Step 13: Run the stack**

  Run: `pnpm dev`. It is long-running, so use a separate terminal.
  Expected: Alchemy starts the api Worker on `http://localhost:3000` and the website on `http://localhost:3001`.

  Then check:

  Run: `curl -s http://localhost:3001/trpc/healthCheck`
  Expected: `{"result":{"data":"OK"}}`. This proves the web Worker, the service binding, the api Worker, Hyperdrive dev mode and Aiven all work.

  Run: `curl -s http://localhost:3001/api/auth/ok`
  Expected: `{"ok":true}`

  Run: `curl -s http://localhost:3001/ | grep -c "API Status"`
  Expected: `1`

  The Alchemy terminal shows one evlog wide event per request, from `jendal-web`, and `jendal-api` for forwarded requests.

  With `pnpm tunnel` running in a third terminal (Task 0, Step 6), check the same path through the public hostname. This proves that Vite accepts the tunnel's `Host` header:

  Run: `curl -s https://elysiumjs.com/trpc/healthCheck`
  Expected: `{"result":{"data":"OK"}}`

- [ ] **Step 14: Commit**

  ```bash
  git add -A apps/web package.json pnpm-lock.yaml
  git commit -m "feat(web): move the web app to vinext with a same-origin api"
  ```

---

### Task 15: Host routing in the web app

**Files:**
- Modify: `apps/web/src/lib/host-routing.ts`, `apps/web/src/lib/host-routing.test.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/header.tsx`
- Create: `apps/web/src/proxy.ts`, `apps/web/src/lib/server-api.ts`, `apps/web/src/app/admin/layout.tsx`, `apps/web/src/app/store/page.tsx`
- Move: `apps/web/src/app/login/page.tsx` → `apps/web/src/app/admin/login/page.tsx`

- [ ] **Step 1: Write the failing routing tests**

  Replace the first import line of `apps/web/src/lib/host-routing.test.ts` with the following, and append the new `describe` block:

  ```ts
  import { routeForHost, shouldForwardToApi } from "./host-routing";
  ```

  ```ts
  const route = (href: string) => routeForHost(new URL(href), DOMAIN);

  describe("routeForHost", () => {
    it("passes marketing hosts through", () => {
      expect(route("https://payleor.app/")).toEqual({ kind: "pass" });
      expect(route("https://www.payleor.app/pricing")).toEqual({ kind: "pass" });
    });

    it("rewrites the admin host into /admin", () => {
      expect(route("https://admin.payleor.app/")).toEqual({ kind: "rewrite", pathname: "/admin", basePath: "" });
      expect(route("https://admin.payleor.app/acme/orders")).toEqual({
        kind: "rewrite",
        pathname: "/admin/acme/orders",
        basePath: "",
      });
    });

    it("rewrites store subdomains into /store", () => {
      expect(route("https://acme.payleor.app/")).toEqual({ kind: "rewrite", pathname: "/store", basePath: "" });
      expect(route("https://acme.payleor.app/products")).toEqual({
        kind: "rewrite",
        pathname: "/store/products",
        basePath: "",
      });
    });

    it("rewrites path-based stores into /store and keeps their base path", () => {
      expect(route("https://store.payleor.app/acme")).toEqual({ kind: "rewrite", pathname: "/store", basePath: "/acme" });
      expect(route("https://store.payleor.app/acme/products")).toEqual({
        kind: "rewrite",
        pathname: "/store/products",
        basePath: "/acme",
      });
    });

    it("rewrites custom domains into /store", () => {
      expect(route("https://shop.example.com/products")).toEqual({
        kind: "rewrite",
        pathname: "/store/products",
        basePath: "",
      });
    });

    it("blocks direct requests for the internal route trees on every host", () => {
      for (const href of ["https://payleor.app/admin", "https://acme.payleor.app/store/x", "https://admin.payleor.app/admin"]) {
        expect(route(href)).toEqual({ kind: "not-found" });
      }
    });

    it("serves nothing on api, mcp and unknown hosts", () => {
      for (const href of ["https://api.payleor.app/", "https://mcp.payleor.app/", "https://docs.payleor.app/", "https://a.b.payleor.app/"]) {
        expect(route(href)).toEqual({ kind: "not-found" });
      }
    });
  });
  ```

  Run: `pnpm test apps/web`
  Expected: FAIL, because `routeForHost` is not exported.

- [ ] **Step 2: Implement host routing**

  Append to `apps/web/src/lib/host-routing.ts`:

  ```ts
  export const BASE_PATH_HEADER = "x-jendal-base-path";

  export type HostRoute =
    | { kind: "pass" }
    | { kind: "rewrite"; pathname: string; basePath: string }
    | { kind: "not-found" };

  const INTERNAL_ROUTE_TREES = new Set(["admin", "store"]);

  export function routeForHost(url: URL, platformDomain: string): HostRoute {
    // The route trees are reachable only through a rewrite, so one host never serves another host's pages.
    if (INTERNAL_ROUTE_TREES.has(url.pathname.split("/")[1] ?? "")) return { kind: "not-found" };

    const { target, path } = targetAndPath(url, platformDomain);
    const suffix = path === "/" ? "" : path;

    switch (target.kind) {
      case "platform":
        if (target.app === "www") return { kind: "pass" };
        if (target.app === "admin") return { kind: "rewrite", pathname: `/admin${suffix}`, basePath: "" };
        return { kind: "not-found" };
      case "store":
        return { kind: "rewrite", pathname: `/store${suffix}`, basePath: target.basePath };
      case "custom-domain":
        return { kind: "rewrite", pathname: `/store${suffix}`, basePath: "" };
      case "unknown":
        return { kind: "not-found" };
    }
  }
  ```

  Run: `pnpm test apps/web`
  Expected: PASS, 10 tests.

- [ ] **Step 3: Add the proxy**

  `apps/web/src/proxy.ts`:

  ```ts
  import { env } from "cloudflare:workers";
  import { type NextRequest, NextResponse } from "next/server";

  import { BASE_PATH_HEADER, routeForHost } from "@/lib/host-routing";

  export function proxy(request: NextRequest) {
    const route = routeForHost(new URL(request.url), env.PLATFORM_DOMAIN);
    switch (route.kind) {
      case "pass":
        return NextResponse.next();
      case "not-found":
        return new NextResponse("Not found", { status: 404 });
      case "rewrite": {
        // Setting the header here also overwrites any value the client sent.
        const headers = new Headers(request.headers);
        headers.set(BASE_PATH_HEADER, route.basePath);
        const destination = new URL(`${route.pathname}${request.nextUrl.search}`, request.url);
        return NextResponse.rewrite(destination, { request: { headers } });
      }
    }
  }

  export const config = {
    // Static files and metadata routes are shared by every host.
    matcher: ["/((?!_next/|favicon|manifest\\.webmanifest|sw\\.js|offline\\.html).*)"],
  };
  ```

- [ ] **Step 4: Add the server-side api helper**

  `apps/web/src/lib/server-api.ts`:

  ```ts
  import { env } from "cloudflare:workers";
  import { headers } from "next/headers";
  import { z } from "zod";

  import { BASE_PATH_HEADER } from "./host-routing";

  // The api Worker resolves stores from the original host and path, so the request keeps both.
  export async function callApi(path: string, init?: RequestInit): Promise<Response> {
    const incoming = await headers();
    const host = incoming.get("host") ?? "localhost";
    const basePath = incoming.get(BASE_PATH_HEADER) ?? "";
    return env.SERVER.fetch(new Request(`http://${host}${basePath}${path}`, init));
  }

  const storeInfoSchema = z.object({ storeId: z.string(), slug: z.string(), name: z.string() });
  export type StoreInfo = z.infer<typeof storeInfoSchema>;

  export async function fetchStoreInfo(): Promise<StoreInfo | null> {
    const response = await callApi("/api/store");
    if (!response.ok) return null;
    const parsed = storeInfoSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  }
  ```

- [ ] **Step 5: Split the route trees**

  1. Move the login page:

     ```bash
     mkdir -p apps/web/src/app/admin/login
     git mv apps/web/src/app/login/page.tsx apps/web/src/app/admin/login/page.tsx
     ```

  2. In `apps/web/src/app/layout.tsx`:
     - Delete the `import Header from "@/components/header";` line.
     - Replace the `<div className="grid grid-rows-[auto_1fr] h-svh"> ... </div>` block inside `<Providers>` with `{children}`.
     - Change `metadata` to `{ title: "Payleor", description: "Agentic commerce on PayPal" }`.

  3. Create `apps/web/src/app/admin/layout.tsx`:

     ```tsx
     import Header from "@/components/header";

     export default function AdminLayout({ children }: { children: React.ReactNode }) {
       return (
         <div className="grid h-svh grid-rows-[auto_1fr]">
           <Header />
           {children}
         </div>
       );
     }
     ```

  4. In `apps/web/src/components/header.tsx`, replace the `links` array with:

     ```ts
       const links = [{ to: "/", label: "Stores" }] as const;
     ```

  5. Create `apps/web/src/app/store/page.tsx`. It is a placeholder storefront; the real storefront is week 2:

     ```tsx
     import { notFound } from "next/navigation";

     import { fetchStoreInfo } from "@/lib/server-api";

     export default async function StorefrontHome() {
       const store = await fetchStoreInfo();
       if (!store) notFound();

       return (
         <main className="container mx-auto max-w-3xl px-4 py-8">
           <h1 className="text-2xl font-semibold">{store.name}</h1>
           <p className="text-muted-foreground">This store is getting ready.</p>
         </main>
       );
     }
     ```

- [ ] **Step 6: Type check**

  Run: `pnpm -F web check-types`
  Expected: exits 0.

- [ ] **Step 7: Check the routing in the browser and with curl**

  These checks use the `localhost` platform domain. A stage that owns the tunnel (`TUNNEL_STAGE` matches it and `TUNNEL_DOMAIN` is set) uses `elysiumjs.com` instead, so `admin.localhost` would be treated as a custom domain. Either comment out `TUNNEL_DOMAIN` in `packages/infra/.env` and restart `pnpm dev`, or run `pnpm tunnel` and use the public hosts. For example, use `curl -s -o /dev/null -w '%{http_code}\n' https://admin.elysiumjs.com/login` in place of the first check.

  With `pnpm dev` running (restart it so the proxy loads), check each of these. Browsers resolve `*.localhost` to your machine. With curl, pass the host explicitly:

  Run: `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: admin.localhost:3001' http://localhost:3001/login`
  Expected: `200` (the sign-up form, served from `/admin/login`).

  Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/admin/login`
  Expected: `404` (direct requests for internal trees are blocked).

  Run: `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: ghost.localhost:3001' http://localhost:3001/`
  Expected: `404` (no store with that slug).

  Run: `curl -s http://localhost:3001/ | grep -c "API Status"`
  Expected: `1` (the marketing page still passes through).

  If the rewrite or the request-header override does not take effect, read `refs/stack/vinext/packages/vinext/src/server/middleware-runtime.ts:647-688` and the `x-middleware-request-*` handling. Do not move the rewrite into `worker/index.ts`. That would change the URL the browser sees and break client navigation.

- [ ] **Step 8: Commit**

  ```bash
  git add -A apps/web
  git commit -m "feat(web): route admin, store and marketing hosts to their own route trees"
  ```

---

### Task 16: Admin home and store dashboard

**Files:**
- Modify: `apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/server-api.ts`
- Create: `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/stores-overview.tsx`, `apps/web/src/app/admin/[storeSlug]/page.tsx`, `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`, `apps/web/src/components/create-organization-form.tsx`, `apps/web/src/components/create-store-form.tsx`

- [ ] **Step 1: Add the organization client**

  Replace `apps/web/src/lib/auth-client.ts` with the following. `inferOrgAdditionalFields` types the store fields on `createTeam` (`refs/stack/better-auth/packages/better-auth/src/plugins/organization/client.ts:293`):

  ```ts
  import type { Auth } from "@jendal-workspace/auth";
  import { inferOrgAdditionalFields, organizationClient } from "better-auth/client/plugins";
  import { createAuthClient } from "better-auth/react";

  export const authClient = createAuthClient({
    plugins: [organizationClient({ teams: { enabled: true }, schema: inferOrgAdditionalFields<Auth>() })],
  });
  ```

- [ ] **Step 2: Add the session gate**

  Append to `apps/web/src/lib/server-api.ts`. Also add `import { redirect } from "next/navigation";` to its imports.

  ```ts
  const sessionSchema = z.object({
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  });

  export async function requireSession(): Promise<z.infer<typeof sessionSchema>> {
    const cookie = (await headers()).get("cookie") ?? "";
    const response = await callApi("/api/auth/get-session", { headers: { cookie } });
    const parsed = sessionSchema.safeParse(response.ok ? await response.json() : null);
    if (!parsed.success) redirect("/login");
    return parsed.data;
  }
  ```

- [ ] **Step 3: Create the forms**

  `apps/web/src/components/create-organization-form.tsx`:

  ```tsx
  "use client";

  import { Button } from "@jendal-workspace/ui/components/button";
  import { Input } from "@jendal-workspace/ui/components/input";
  import { Label } from "@jendal-workspace/ui/components/label";
  import { type FormEvent, useState } from "react";
  import { toast } from "sonner";

  import { authClient } from "@/lib/auth-client";

  export default function CreateOrganizationForm({ onCreated }: { onCreated: () => void }) {
    const [name, setName] = useState("");
    const [pending, setPending] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setPending(true);
      // The organization slug never appears in a URL, so a random one saves the merchant a question.
      const { error } = await authClient.organization.create({
        name,
        slug: `org-${crypto.randomUUID().slice(0, 8)}`,
      });
      setPending(false);
      if (error) {
        toast.error(error.message ?? "Could not create your merchant account.");
        return;
      }
      onCreated();
    }

    return (
      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Create your merchant account</h2>
        <div className="space-y-2">
          <Label htmlFor="organization-name">Business name</Label>
          <Input
            id="organization-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
          />
        </div>
        <Button type="submit" disabled={pending}>
          Create account
        </Button>
      </form>
    );
  }
  ```

  `apps/web/src/components/create-store-form.tsx`:

  ```tsx
  "use client";

  import { Button } from "@jendal-workspace/ui/components/button";
  import { Input } from "@jendal-workspace/ui/components/input";
  import { Label } from "@jendal-workspace/ui/components/label";
  import { type FormEvent, useState } from "react";
  import { toast } from "sonner";

  import { authClient } from "@/lib/auth-client";

  export default function CreateStoreForm({
    organizationId,
    onCreated,
  }: {
    organizationId: string;
    onCreated: () => void;
  }) {
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [pending, setPending] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setPending(true);
      const { error } = await authClient.organization.createTeam({ name, slug, organizationId });
      setPending(false);
      if (error) {
        toast.error(error.message ?? "Could not create the store.");
        return;
      }
      setName("");
      setSlug("");
      onCreated();
    }

    return (
      <form onSubmit={handleSubmit} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor={`store-name-${organizationId}`}>Store name</Label>
          <Input
            id={`store-name-${organizationId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`store-slug-${organizationId}`}>Store address</Label>
          <Input
            id={`store-slug-${organizationId}`}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme"
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          Create store
        </Button>
      </form>
    );
  }
  ```

- [ ] **Step 4: Create the admin home**

  `apps/web/src/app/admin/stores-overview.tsx`:

  ```tsx
  "use client";

  import { useQuery } from "@tanstack/react-query";
  import Link from "next/link";

  import CreateOrganizationForm from "@/components/create-organization-form";
  import CreateStoreForm from "@/components/create-store-form";
  import Loader from "@/components/loader";
  import { trpc } from "@/utils/trpc";

  export default function StoresOverview() {
    const organizations = useQuery(trpc.store.listMine.queryOptions());

    if (organizations.isPending) return <Loader />;
    if (organizations.isError) return <p className="text-destructive">Could not load your stores.</p>;

    const refresh = () => void organizations.refetch();

    if (organizations.data.length === 0) return <CreateOrganizationForm onCreated={refresh} />;

    return (
      <div className="space-y-8">
        {organizations.data.map((organization) => (
          <section key={organization.id} className="space-y-3">
            <h2 className="text-lg font-medium">{organization.name}</h2>
            {organization.stores.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stores yet.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {organization.stores.map((store) => (
                  <li key={store.id}>
                    <Link href={`/${store.slug}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted">
                      <span>{store.name}</span>
                      <span className="text-sm text-muted-foreground">{store.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {organization.canCreateStores ? (
              <CreateStoreForm organizationId={organization.id} onCreated={refresh} />
            ) : null}
          </section>
        ))}
      </div>
    );
  }
  ```

  `apps/web/src/app/admin/page.tsx`:

  ```tsx
  import { requireSession } from "@/lib/server-api";

  import StoresOverview from "./stores-overview";

  export default async function AdminHome() {
    const session = await requireSession();

    return (
      <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-semibold">Welcome, {session.user.name}</h1>
        <StoresOverview />
      </main>
    );
  }
  ```

- [ ] **Step 5: Create the store dashboard**

  `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`:

  ```tsx
  "use client";

  import { useQuery } from "@tanstack/react-query";
  import Link from "next/link";

  import Loader from "@/components/loader";
  import { trpc } from "@/utils/trpc";

  export default function StoreDashboard({ storeSlug }: { storeSlug: string }) {
    const store = useQuery({ ...trpc.store.get.queryOptions({ storeSlug }), retry: false });

    if (store.isPending) return <Loader />;
    if (store.isError) {
      return (
        <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
          <h1 className="text-2xl font-semibold">Store not found</h1>
          <Link href="/" className="underline">
            Back to your stores
          </Link>
        </main>
      );
    }

    return (
      <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
        <Link href="/" className="text-sm text-muted-foreground">
          All stores
        </Link>
        <h1 className="text-2xl font-semibold">{store.data.name}</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Address</dt>
          <dd>{store.data.slug}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{store.data.status}</dd>
          <dt className="text-muted-foreground">Your role</dt>
          <dd>{store.data.role}</dd>
          <dt className="text-muted-foreground">PayPal</dt>
          <dd>{store.data.paypalMerchantId ?? "Not connected"}</dd>
        </dl>
      </main>
    );
  }
  ```

  `apps/web/src/app/admin/[storeSlug]/page.tsx`:

  ```tsx
  import { requireSession } from "@/lib/server-api";

  import StoreDashboard from "./store-dashboard";

  export default async function StoreDashboardPage({ params }: { params: Promise<{ storeSlug: string }> }) {
    await requireSession();
    const { storeSlug } = await params;

    return <StoreDashboard storeSlug={storeSlug} />;
  }
  ```

  `/admin/login` is a static segment, so it wins over `/admin/[storeSlug]`. `login` is also a reserved slug (Task 3).

- [ ] **Step 6: Type check**

  Run: `pnpm check-types`
  Expected: `Tasks: 8 successful, 8 total`.

- [ ] **Step 7: Commit**

  ```bash
  git add -A apps/web
  git commit -m "feat(web): admin store list, store creation and per-store dashboard"
  ```

- [ ] **Step 8: Add the PayPal sign-in button**

  Task 17, Step 3 signs in with PayPal, and the server provider exists since Task 9, but the login page had no button for it (added after the fact in commit `64fe2e0`).

  `apps/web/src/components/paypal-sign-in-button.tsx` calls `authClient.signIn.social({ provider: "paypal", callbackURL: "/" })`; the client's redirect plugin then sends the browser to PayPal (`refs/stack/better-auth/packages/better-auth/src/client/fetch-plugins.ts:4-17`). `apps/web/src/app/admin/login/page.tsx` renders it under the sign-in and sign-up forms.

  ```bash
  git add apps/web/src/components/paypal-sign-in-button.tsx apps/web/src/app/admin/login/page.tsx
  git commit -m "feat(web): add the PayPal sign-in button to the admin login page"
  ```

---

### Task 17: End-to-end check

**Files:** none changed unless a check fails.

- [ ] **Step 1: Run every check**

  Run: `pnpm check-types && pnpm test`
  Expected:
  - `Tasks: 8 successful, 8 total`.
  - With the test database: 131 tests pass (core 78, db 8, auth 15, api 8, server 12, web 10). Auth grew from 7 to 15 with the PayPal sign-in fixes in Step 3. Core grew from 60 to 78 with the hardening tests added after the Task 5 review (commit "fix(core): harden host parsing and add cache deletion").
  - Without it, 106 tests pass and 25 are skipped.

- [ ] **Step 2: Walk through the merchant flow**

  With `pnpm dev` running and `TUNNEL_DOMAIN` commented out in `packages/infra/.env` (see Task 15, Step 7):

  1. Open `http://admin.localhost:3001/`. You are redirected to `/login`.
  2. Sign up. You land on the admin home with the "Create your merchant account" form.
  3. Create the account "Acme Inc", then a store named "Acme" with the address ` Acme `. The store appears as `acme`, with status `draft`.
  4. Try to create a store at `login`. A toast says the address is reserved.
  5. Click "Acme". The URL is `http://admin.localhost:3001/acme`, and the dashboard shows address `acme`, status `draft`, role `owner` and PayPal "Not connected".
  6. Open `http://acme.localhost:3001/`. It shows "Acme" and "This store is getting ready."
  7. Open `http://store.localhost:3001/acme`. It shows the same store.
  8. Run: `curl -s -H 'Host: acme.localhost:3001' http://localhost:3001/api/store`
     Expected: `{"storeId":"<id>","slug":"acme","name":"Acme"}`
  9. In a private window, sign up a second user and open `http://admin.localhost:3001/acme`. It shows "Store not found".

- [ ] **Step 3: Repeat over the tunnel, with PayPal sign-in**

  Restore `TUNNEL_DOMAIN=elysiumjs.com` (with `TUNNEL_STAGE=dev`), restart `pnpm dev`, and start `pnpm tunnel`.

  1. Open `https://admin.elysiumjs.com/`. You are redirected to `/login`.
  2. Sign in with PayPal using a sandbox personal account. PayPal returns to `https://admin.elysiumjs.com/api/auth/callback/paypal` (Task 0, Step 2), and you land on the admin home.

     This step found four problems, fixed as follows:
     - **"invalid client_id or redirect_uri" on PayPal:** turn on Log in with PayPal for the sandbox app, with that exact Return URL and the Full name, Email, Account verification status and Payer ID fields. Placeholder policy URLs such as `https://example.com` are fine for sandbox.
     - **"Something went wrong on our end" on PayPal:** the authorize page needs a `scope`, and Better Auth's PayPal provider sends none (`refs/stack/better-auth/packages/core/src/social-providers/paypal.ts:111-116`). `packages/auth/src/paypal.ts` puts `openid profile email https://uri.paypal.com/services/paypalattributes` on the `authorizationEndpoint` override, whose query Better Auth keeps (commit `7156be7`).
     - **`unable_to_get_user_info` (userinfo returns 400 "Unable to fetch details to serve the request"):** PayPal refuses Log in with PayPal for the business account that owns the app. Use a sandbox personal account.
     - **`email_not_found`:** userinfo with `schema=paypalv1.1` returns an `emails` list, not `email`. `paypalEmail` in `packages/auth/src/paypal.ts` maps the primary address through `mapProfileToUser` (commit `4ce510e`).

     Expected in `jendal-dev`: a user with `email_verified = true`, an `account` row with `provider_id = 'paypal'`, and a session.
  3. Repeat steps 3–7 of Step 2 on the public hosts: `https://admin.elysiumjs.com/acme`, `https://acme.elysiumjs.com/` and `https://store.elysiumjs.com/acme`. The database is shared, so use a new store address, such as `acme2`.
  4. Run: `curl -s https://acme2.elysiumjs.com/api/store`
     Expected: `{"storeId":"<id>","slug":"acme2","name":"<name>"}`

- [ ] **Step 4: Check the logs**

  The Alchemy terminal shows:
  - `jendal-web` events for page requests.
  - `jendal-api` events for forwarded requests.
  - A `tenant` field with `storeId`, `organizationId` and `channel` on the `/api/store` events.

- [ ] **Step 5: Commit any fixes**

  If a step failed and you fixed it, commit with a message that names the failure, for example `fix(web): …`.

---

### Task 18: Deploy check

**Files:** none changed unless the deploy reveals a problem; `specs/platform/research.md` (outside the workspace).

**Result (2026-10-04):** done. Alchemy deployed stage `live_mouhamed` (the default deploy stage, `live_$USER`) in 57 s: Hyperdrive `Database`, `StoreCache`, `webIsrCache` (the `VINEXT_KV_CACHE` namespace), and both Workers. Hyperdrive reached Aiven with no TLS change. Smoke tests: api `/` → `OK`; api and web `/trpc/healthCheck` → `{"result":{"data":"OK"}}`; web `/` → 404 as expected on `workers.dev`. Deviation: turbo marks `deploy` as `interactive`, so `pnpm run deploy` fails without a terminal UI; the deploy ran as `pnpm exec alchemy deploy --yes --no-input` in `packages/infra`. The deployed stage reads `apps/server/.env`, where `PLATFORM_DOMAIN` is currently `admin.elysiumjs.com`; it has no effect until Worker routes exist, but must become the bare domain before routes are added.

- [x] **Step 1: Deploy the dev stage**

  Run: `pnpm run deploy`
  Expected: Alchemy creates the Hyperdrive configuration, the `StoreCache` and `VINEXT_KV_CACHE` namespaces, and both Workers, then prints the `web` and `server` URLs.

  If Hyperdrive creation fails with a TLS or certificate error from Aiven, add `mtls: { sslmode: "require" }` to the `Cloudflare.Hyperdrive.Connection` props in `packages/infra/alchemy.run.ts` and deploy again.

- [x] **Step 2: Smoke test**

  Run: `curl -s https://<server url>/`
  Expected: `OK`

  Run: `curl -s https://<web url>/trpc/healthCheck`
  Expected: `{"result":{"data":"OK"}}`. This proves the deployed web Worker reaches Aiven through the service binding, the api Worker and Hyperdrive.

  The `workers.dev` host is not an admin or store host, so its pages answer 404. Admin and store hosts start working once `payleor.app` is on Cloudflare, `PLATFORM_DOMAIN=payleor.app`, `BETTER_AUTH_URL=https://admin.payleor.app`, and Worker routes are set (spec §15).

- [x] **Step 3: Record the outcome**

  Append a short note to `/home/mouhamed/dev/repos/jendal/specs/platform/research.md` §12.3 under **Database**. Include the date, whether Hyperdrive to Aiven worked on the first deploy, and any setting that had to change.

---

### Task 19: Subdomain-only storefronts, `STORE_DOMAIN`, and the Store URL field

Spec §4.2–4.3 (revised 2026-10-04): stores live only at `{slug}.{STORE_DOMAIN}` or a custom domain. The `store.{domain}/{slug}` path storefront is removed. `STORE_DOMAIN` defaults to `PLATFORM_DOMAIN`. The reserved slugs grow.

**Files:**
- Modify: `packages/core/src/tenancy/{target,slug,resolve}.ts` and their tests, `packages/core/src/index.ts` (exports)
- Modify: `apps/server/src/tenant/middleware.ts`, `middleware.test.ts`, `apps/server/src/index.ts`, `apps/server/.env.schema`
- Modify: `apps/web/src/lib/host-routing.ts`, `host-routing.test.ts`, `apps/web/src/proxy.ts`, `apps/web/worker/index.ts`, `apps/web/src/lib/server-api.ts`
- Create: `apps/web/src/lib/store-url.ts`, `store-url.test.ts`
- Modify: `apps/web/src/app/admin/page.tsx`, `stores-overview.tsx`, `[storeSlug]/page.tsx`, `[storeSlug]/store-dashboard.tsx`, `apps/web/src/components/create-store-form.tsx`
- Modify: `packages/infra/alchemy.run.ts`, `packages/infra/.env.schema`, `turbo.json`

- [x] **Step 1: Core — failing tests**

  `target.test.ts`: `parseRequestTarget(hostname, { platformDomain, storeDomain })` no longer takes a path. Replace the path-store and `routingPath` cases with:
  - same domain (`payleor.app` for both): `acme.payleor.app` is `{ kind: "store", slug: "acme" }`; `store.payleor.app` and `docs.payleor.app` are `unknown` (reserved).
  - separate domains (`payleor.app`, `payleor.site`): `acme.payleor.site` is a store; `acme.payleor.app`, the bare `payleor.site` and `a.b.payleor.site` are `unknown`; `admin.payleor.app` stays the admin app; `payleor.app` stays `www`; `shop.example.com` is a custom domain.
  - keep the existing normalization, lookalike, IPv6 and invalid-hostname cases.

  `slug.test.ts`: the new reserved slugs (`shop`, `dashboard`, `auth`, `oauth`, `checkout`, `pay`, `payments`, `billing`, `dev`, `staging`, `preview`, `sandbox`, `test`, `demo`, `email`, `smtp`, `imap`, `autodiscover`, `autoconfig`, `ns1`, `ns2`, `security`, `abuse`, `payleor`, `paypal`, `venmo`, `braintree`, `agent`, `agents`) are rejected as `reserved`.

  Run: `pnpm exec vitest run packages/core` — Expected: FAIL.

- [x] **Step 2: Core — implement**

  `target.ts`:

  ```ts
  export type RequestTarget =
    | { kind: "platform"; app: PlatformApp }
    | { kind: "store"; slug: string }
    | { kind: "custom-domain"; hostname: string }
    | { kind: "unknown" };

  export type HostDomains = { platformDomain: string; storeDomain: string };

  // The label directly under `domain`, "" for a deeper subdomain, or null when the host is not under it.
  function labelUnder(hostname: string, domain: string): string | null {
    if (!hostname.endsWith(`.${domain}`)) return null;
    const label = hostname.slice(0, -(domain.length + 1));
    return label.includes(".") ? "" : label;
  }

  export function parseRequestTarget(rawHostname: string, domains: HostDomains): RequestTarget {
    const hostname = normalizeHostname(rawHostname);
    const platform = normalizeHostname(domains.platformDomain);
    const store = normalizeHostname(domains.storeDomain);
    if (![hostname, platform, store].every((h) => VALID_HOSTNAME.test(h))) return { kind: "unknown" };
    if (hostname === platform) return { kind: "platform", app: "www" };

    const platformLabel = labelUnder(hostname, platform);
    const app = platformLabel ? PLATFORM_APPS.get(platformLabel) : undefined;
    if (app) return { kind: "platform", app };

    const storeLabel = labelUnder(hostname, store);
    if (storeLabel !== null) {
      const slug = exactSlug(storeLabel);
      return slug ? { kind: "store", slug } : { kind: "unknown" };
    }
    if (platformLabel !== null || hostname === store) return { kind: "unknown" };
    return { kind: "custom-domain", hostname };
  }
  ```

  Delete `PATH_STORE_LABEL` and `routingPath`. Export `HostDomains` from `packages/core/src/index.ts`. Extend `RESERVED_SLUGS` with the Step 1 list. Update `resolve.test.ts` for the target without `basePath`.

  Run: `pnpm exec vitest run packages/core` — Expected: PASS.

- [x] **Step 3: api Worker**

  - `middleware.ts`: `TenantSettings = { domains: HostDomains; environment }`; parse with `parseRequestTarget(url.hostname, settings.domains)`; delete `routingPathFor`.
  - `index.ts`: `new Hono<AppEnv>()` (no custom `getPath`); pass `{ platformDomain: ENV.PLATFORM_DOMAIN, storeDomain: ENV.STORE_DOMAIN }`.
  - `middleware.test.ts`: drop the two path-store tests and the custom `getPath`; add "returns 404 for `store.payleor.app/acme`"; add a separate-domain case (`acme.payleor.site` resolves, `acme.payleor.app` is 404).
  - `apps/server/.env.schema`: after `PLATFORM_DOMAIN`, add

    ```
    # Root domain for storefronts ({slug}.STORE_DOMAIN), e.g. payleor.site. Defaults to PLATFORM_DOMAIN.
    # @public @required=false @type=string
    STORE_DOMAIN=
    ```

- [x] **Step 4: web Worker**

  - `host-routing.ts`: take `HostDomains`; delete `BASE_PATH_HEADER`, `targetAndPath` and `basePath` (`HostRoute` rewrite becomes `{ kind: "rewrite"; pathname: string }`). Update the tests: no path stores; `store.payleor.app/acme` is `not-found`; one separate-domain case.
  - `proxy.ts`: pass `{ platformDomain: env.PLATFORM_DOMAIN, storeDomain: env.STORE_DOMAIN }`; rewrite without the header.
  - `worker/index.ts`: the same domains for `shouldForwardToApi`.
  - `server-api.ts`: `callApi` builds `http://${host}${path}` (no base path).
  - `store-url.ts` (test first):

    ```ts
    export type StoreUrlParts = { prefix: string; suffix: string };

    // Local stages serve stores on *.localhost over http on the web port; deployed and tunnel hosts use https.
    export function storeUrlParts(storeDomain: string, requestHost: string): StoreUrlParts {
      const port = /:\d+$/.exec(requestHost)?.[0] ?? "";
      const local = storeDomain === "localhost";
      return { prefix: local ? "http://" : "https://", suffix: `.${storeDomain}${local ? port : ""}` };
    }

    export function storeUrl(slug: string, parts: StoreUrlParts): string {
      return `${parts.prefix}${slug}${parts.suffix}`;
    }
    ```

    Tests: `("elysiumjs.com", "admin.elysiumjs.com")` gives `https://` and `.elysiumjs.com`; `("localhost", "admin.localhost:3001")` gives `http://` and `.localhost:3001`; `storeUrl("acme", …)` joins them.
  - `server-api.ts`: `getStoreUrlParts()` reads `env.STORE_DOMAIN` and the `host` header and returns `storeUrlParts(...)`.

- [x] **Step 5: Admin UI**

  - `admin/page.tsx` and `[storeSlug]/page.tsx` call `getStoreUrlParts()` and pass `urlParts` to `StoresOverview` and `StoreDashboard`. `StoresOverview` passes it to `CreateStoreForm`.
  - `create-store-form.tsx`: label "Store URL"; an `InputGroup` with `InputGroupAddon` `https://` (start), `InputGroupInput` for the slug, and `InputGroupAddon` `.elysiumjs.com` (end) from `urlParts`. Below it, when the field is not empty: "Your store will be at {storeUrl(slug.trim().toLowerCase(), urlParts)}". The error toasts stay.
  - `store-dashboard.tsx`: the "Address" row becomes "Store URL" with a link to `storeUrl(store.slug, urlParts)` (opens in a new tab). The status row shows "Draft · Connect PayPal to start selling." for `draft`, otherwise the status.

- [x] **Step 6: Infra**

  - `alchemy.run.ts`:

    ```ts
    const storeDomain = localUrls
      ? localUrls.platformDomain
      : Config.String("STORE_DOMAIN").pipe(Config.orElse(() => Config.String("PLATFORM_DOMAIN")));
    ```

    Add `STORE_DOMAIN: storeDomain` to the `server` and `Web` env.
  - `packages/infra/.env.schema`: add `STORE_DOMAIN` to the `@import` pick list.
  - `turbo.json`: add `STORE_DOMAIN` to `globalEnv`.

- [x] **Step 7: Verify and commit**

  Run: `pnpm check-types && pnpm exec vitest run` — Expected: all pass.

  Restart dev and check over the tunnel:
  - `https://brooklyn.elysiumjs.com/` shows the store; `https://store.elysiumjs.com/brooklyn` answers 404.
  - The admin form shows `https://` `[slug]` `.elysiumjs.com` and the live URL; the store page links to `https://brooklyn.elysiumjs.com` and shows the draft line.

  ```bash
  git add -A packages/core apps/server apps/web packages/infra turbo.json
  git commit -m "feat: subdomain-only storefronts with a STORE_DOMAIN setting and a Store URL field"
  ```


**Result (2026-10-05):** commit `c63d5bd`. 168 tests pass with the test database; 8 packages type-check. Over the tunnel: `brooklyn.elysiumjs.com` serves the store and `/api/store`; `store.elysiumjs.com/brooklyn` and unknown stores return 404; the admin form shows `https://` `[slug]` `.elysiumjs.com` with a live preview; the store page links to its URL and shows the draft line. Deviations: `shouldForwardToApi(url)` no longer takes the domains (only the path matters now), and infra reads `STORE_DOMAIN` with `Config.NonEmptyString` so an empty value falls back to `PLATFORM_DOMAIN`.

---

## Done when

- `pnpm check-types` and `pnpm test` pass (168 tests with the test database).
- On `admin.localhost:3001`:
  - A merchant signs up, creates an organization and a store, and opens `admin.localhost:3001/acme`.
  - A user outside the store's team or organization gets "Store not found".
- `acme.localhost:3001` shows the store; `store.localhost:3001/acme` and unknown store hosts return 404 (Task 19).
- Through the tunnel, `https://admin.elysiumjs.com` signs in with PayPal sandbox, and `https://<slug>.elysiumjs.com` shows the store.
- The deployed web Worker answers `/trpc/healthCheck` through Hyperdrive.
