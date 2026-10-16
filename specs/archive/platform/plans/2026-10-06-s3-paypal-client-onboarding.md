# S3: PayPal Client and Partner Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any team — a store or a services team — gets a "Connect PayPal" flow: the admin clicks Connect, is redirected to PayPal, grants Payleor the platform spec's permissions, lands back on the team dashboard, and the dashboard shows the true state of the connection (not connected, pending, connected, needs attention). Underneath sits `@jendal-workspace/paypal`, a typed `fetch` client for the PayPal REST API that later plans extend with orders, payouts, disputes and webhooks.

**Note:** W1-B (PayPal onboarding) never got a plan. This plan replaces it; references to W1-B in the services spec (§4.3 "PayPal account") and in the W1-D plan's out-of-scope list are served here.

**Architecture:** A new `packages/paypal` package holds the client: OAuth client-credentials token cached until just before expiry (in memory by default, Workers KV on the api Worker), `PayPal-Request-Id` on every POST, exponential backoff with jitter on 429 and 5xx, a `PayPalError` carrying `debug_id`, `name` and `details`, an unsigned-JWT `PayPal-Auth-Assertion` builder, and modules for partner referrals and merchant integration status. Postgres gets a `paypal_onboarding` table keyed by team ID. The tRPC `paypal` router (`startOnboarding`, `onboardingStatus`) and the api Worker's return route `GET /api/paypal/onboarding/return` share one orchestration module in `packages/api`. Everything is keyed by team ID, so it works for any team row; `team.product` (S1) is never read. On success `team.paypal_merchant_id` is written and the KV store cache is invalidated. The web app gets a generic `PayPalConnectCard` (takes a team ID) mounted on the store dashboard; S1's services team dashboard can mount the same component.

**Tech Stack:** `fetch` (workerd and undici), Drizzle ORM 1.0.0-rc.4, tRPC 11.19.0, Hono 4.13.12, Better Auth 1.7.7 (teams), React 19, TanStack Query 5, Vitest 5, varlock, Alchemy 2.0.0-beta.80 with Effect 4 `Config`.

**Spec:** [`../2026-10-03-payleor-platform-design.md`](../../../platform/2026-10-03-payleor-platform-design.md) §5 (PayPal onboarding), §6.3 (PayPal client) and the decisions rows "PayPal connection" and "PayPal client"; [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) §4.3 (PayPal account) and §10 (partner onboarding shared by both products); [`../research.md`](../research.md) R§4 and R§12.3.

**Builds on:** W1-D merged into `main` (branch `w1d-public-site-auth`): tRPC context with `auth` and `headers`, `storeProcedure`, the store dashboard, `packages/email` as the package template, the KV store cache. Delivers contract §4.4 of [`2026-10-06-parallel-execution.md`](2026-10-06-parallel-execution.md).

**Out of scope (later plans):**
- Orders v2, payments (capture, refund), tracking, disputes, webhook signature verification and webhooks in general (`MERCHANT.ONBOARDING.COMPLETED` included) — later plans add them to `packages/paypal`; §6.3 lists the endpoint groups.
- Gating checkout or publishing on the connection state (checkout plan); the services team's payout credentials (S1+ plans).
- Mounting the card on the services team dashboard — S1 builds that dashboard and mounts this plan's component.
- PayPal social sign-in (W1-A) and the seeded, pre-connected demo store (platform spec §5.5, Nov 9–12).

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/s3-paypal-onboarding` (created in Task 0). The `main` checkout is `/home/mouhamed/dev/repos/jendal/jendal-workspace` (the merge in Task 8 happens there).

**Library sources:** read the pinned clones in `/home/mouhamed/dev/repos/jendal/refs/stack/` and `/home/mouhamed/dev/repos/jendal/refs/paypal/` (read-only). Load the matching skill before each task:

| Task | Skills |
|---|---|
| 1–2 | `vitest`, `test-driven-development` |
| 3 | `drizzle-orm` |
| 4 | `vitest`, `test-driven-development` |
| 5 | `workers-best-practices`, `effect-ts`, `varlock`, `review-logging-patterns` |
| 6 | `migrate-to-vinext`, `better-writing`, `better-accessibility` |
| 7–8 | `verification-before-completion` |

---

## Facts this plan relies on

Each was checked against the pinned sources or the repository on 2026-10-06, except facts 5–7, which come from the live PayPal docs (fetched 2026-10-06) because the merchant integrations spec is absent from `refs/paypal/paypal-rest-api-specifications/openapi/` (verified by listing the folder: it has thirteen JSON specs, none for partner accounts or merchant integrations; research.md R§4 confirms "This endpoint is not in the specs"). Live docs are the first source in the precedence order of `refs/AGENTS.md`. If code fails in a way that contradicts one of these facts, re-read the cited source before changing the design.

1. **Create partner referral.** `POST /v2/customer/partner-referrals` answers 201 with a body of `create_referral_data_response`, which is only `{ links }`; the 201 description says the response contains an `action_url` link to redirect the customer to, with the `partner_referral_id` appended to it (`refs/paypal/paypal-rest-api-specifications/openapi/customer_partner_referrals_v2.json:29-43` and `:1676-1686`).
2. **Referral body constraints.** `tracking_id` is a string of 1–127 characters (same file `:3341-3346`). `partner_config_override.return_url` is a URI of 1–127 characters (`:2768-2773`). The only legal consent type is `SHARE_DATA_CONSENT` (`:2557-2564`). `EXPRESS_CHECKOUT` is a valid product (`:3143`, `:3213`). The feature enum includes `PAYMENT`, `REFUND`, `PARTNER_FEE`, `READ_SELLER_DISPUTE`, `UPDATE_SELLER_DISPUTE`, `ACCESS_MERCHANT_INFORMATION` and `TRACKING_SHIPMENT_READWRITE` (`:3496-3625`).
3. **Error shape.** PayPal error bodies carry `name`, `message`, `details` and `debug_id` ("The PayPal internal ID. Used for correlation purposes.") (same file `:1860-1888`, `:1912-1915`). A detail has `field`, `value`, `issue` and `description` (`:2208-2231`).
4. **Base URLs.** Sandbox `https://api-m.sandbox.paypal.com`, live `https://api-m.paypal.com` (same file `:9-13`).
5. **Merchant integration status and tracking lookup.** `GET /v1/customer/partners/{partner_id}/merchant-integrations/{merchant_id}` returns `payments_receivable`, `primary_email_confirmed`, `primary_email`, `legal_name`, `products`, `capabilities` and `oauth_integrations` (with `oauth_third_party[].scopes`); `GET /v1/customer/partners/{partner_id}/merchant-integrations?tracking_id={tracking_id}` finds the seller by the referral's tracking ID. Sources: live doc `https://developer.paypal.com/docs/multiparty/seller-onboarding/before-payment/` (step 5, sample responses), `refs/paypal/ruleshub/paypal-checkout/enterprise-checkout/mappings/multiparty-seller-onboarding.json:49-58` and `refs/paypal/ruleshub/paypal-checkout/enterprise-checkout/snippets/javascript/seller-onboarding.md:142-175`. The tracking lookup's exact response envelope is loosely documented ("lists sellers… `merchant_id`, tracking ID, HATEOAS links"), so the client parses it defensively and Task 7 verifies it against the sandbox.
6. **Return URL parameters.** After onboarding, PayPal redirects the seller to `partner_config_override.return_url` with these query parameters: `merchantId` (our `tracking_id`), `merchantIdInPayPal` (the seller's PayPal merchant ID), `permissionsGranted`, `accountStatus` (`BUSINESS_ACCOUNT` or absent), `consentStatus`, `productIntentId` (`addipmt`), `isEmailConfirmed`, and conditionally `returnMessage` and `riskStatus` (live doc of fact 5, step 4). The `action_url` **expires after one use**; a fresh one comes from the referral's `self` link or a new Partner Referrals call (same doc, step 2 result).
7. **PayPal-Auth-Assertion.** An API-caller-provided JWT; PayPal recommends the unsigned form: header `{"alg":"none"}`, payload `{"iss":"<partner client_id>","payer_id":"<seller merchant id>"}`, empty signature; the three parts are Base64-encoded separately and concatenated with periods. The unsigned `alg: "none"` form and the standard-Base64-with-padding encoding come from the live doc `https://developer.paypal.com/api/rest/requests/#paypal-auth-assertion` (top precedence per `refs/AGENTS.md`); the `iss` = partner client ID and `payer_id` = seller merchant ID claims also appear in `refs/paypal/ruleshub/paypal-checkout/enterprise-checkout/snippets/javascript/multiparty-create-order.md:7-14`, whose example is a *signed* JWT this plan does not use. `PayPal-Partner-Attribution-Id` carries the partner's BN code (same page).
8. **Idempotency and retries.** Every POST sends `PayPal-Request-Id`; PayPal stores the ID (up to 45 days), so retries of the same POST are safe (live doc of fact 7, `PayPal-Request-Id`; `refs/AGENTS.md:36`). Retry 429 with exponential backoff; log `debug_id` from every error response; cache OAuth tokens until they expire (`refs/AGENTS.md:38-44`). Platform spec §6.3 extends the retry set to 5xx with jitter, reusing the same request ID. The token endpoint is `POST /v1/oauth2/token` with a Basic authorization header and form body `grant_type=client_credentials`; the caching pattern keeps a 60-second safety margin (`refs/paypal/ruleshub/paypal-checkout/enterprise-checkout/snippets/javascript/seller-onboarding.md:12-52`).
9. **Why our own client.** The server SDK's axios transport is unproven on Workers, and every outbound call must carry per-tenant headers with a cached token (`specs/platform/research.md:348-356`, R§12.3; `:143-173`, R§4).
10. **A store is a team.** The `team` table carries `paypalMerchantId` (`text`, unique, nullable) (`packages/db/src/schema/organization.ts:56-75`), declared to Better Auth with `input: false`, so only our server code writes it (`packages/auth/src/index.ts:33-38`). `StoreRecord` includes `paypalMerchantId` and the KV store cache stores the record under keys `id:<teamId>`, `slug:<slug>` and `host:<hostname>` with a 300-second TTL (`packages/core/src/tenancy/store.ts`, `packages/core/src/tenancy/resolve.ts` `cacheKeyFor`, `apps/server/src/tenant/kv-store-cache.ts:5,21-24`) — so writing the merchant ID must invalidate the `id:` and `slug:` keys.
11. **tRPC context.** `Context` is `{ session, db, environment, auth, headers }` and tests build it by hand (`packages/api/src/context.ts`, `packages/api/src/routers/index.test.ts`); adding an optional field does not break them. tRPC 11 has the error codes `PRECONDITION_FAILED` and `BAD_GATEWAY` (`refs/stack/trpc/packages/server/src/unstable-core-do-not-import/rpc/codes.ts:25-37`).
12. **Hono.** `c.req.query()` returns all query parameters (`refs/stack/hono/src/request.ts:145-146`); `c.redirect()` defaults to 302 (`refs/stack/hono/src/context.ts:767`). Server routes are tested with `app.request(...)` against a factory-injected dependency, like `apps/server/src/tenant/middleware.test.ts`.
13. **Web Worker forwarding.** The web Worker forwards only `/api/*` and `/trpc/*` to the api Worker, preserving the host (`apps/web/src/lib/host-routing.ts:3-6`, `apps/web/worker/index.ts`). A browser-facing api route must therefore live under `/api/`. The admin origin is `BETTER_AUTH_URL` (`apps/server/.env.schema:14-15`; `https://admin.<TUNNEL_DOMAIN>` with the tunnel, `packages/infra/dev-hosts.ts:40`).
14. **Drizzle.** `onConflictDoUpdate({ target, set })` upserts (`refs/stack/drizzle-orm/drizzle-orm/src/pg-core/query-builders/insert.ts:472`); `jsonb(name).$type<T>()` types a JSONB column — `$type` is defined on the `ColumnBuilder` base class (`refs/stack/drizzle-orm/drizzle-orm/src/column-builder.ts:299`), which the pg-core `PgColumnBuilder` extends (`refs/stack/drizzle-orm/drizzle-orm/src/pg-core/columns/common.ts:167`); `$onUpdate` sets the value on update while `defaultNow()` covers insert (`packages/db/src/schema/auth.ts` `user.updatedAt`). Migrations are generated with `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name <name>` and applied to the shared dev database with `pnpm db:migrate:dev` (W1-D Task 5).
15. **evlog.** `log.set` merges objects recursively and concatenates arrays; `log.error(error, context)` captures an error with extra fields (`refs/stack/evlog/packages/evlog/src/types.ts:735-744`, `:772`). Hono handlers read it with `c.get("log")` (`apps/server/src/tenant/middleware.test.ts` uses `evlog()` the same way).
16. **Test infrastructure.** Vitest 5 with `testTimeout: 20_000` runs `packages/*/src/**/*.test.ts` and `apps/{server,web}/src/**/*.test.ts` (`vitest.config.ts`). The global setup rebuilds the test database from all migrations before the run (`packages/db/src/testing/global-setup.ts`), and `truncateAll` in `packages/db/src/testing/db.ts` must list every table. `Response`, `Request`, `btoa`, `atob` and `crypto.randomUUID` are globals in Node 18+, workerd and the vitest environment.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/paypal/package.json`, `tsconfig.json` | Create | `@jendal-workspace/paypal` package, mirrors `packages/email` |
| `packages/paypal/src/errors.ts` (+client tests) | Create | `PayPalError` with `status`, `debugId`, `name`, `details`; response parser |
| `packages/paypal/src/token.ts` (+test) | Create | `PayPalTokenCache` port, memory and KV adapters |
| `packages/paypal/src/auth-assertion.ts` (+test) | Create | Unsigned-JWT `PayPal-Auth-Assertion` builder |
| `packages/paypal/src/client.ts` (+test) | Create | `createPayPalClient`: token caching, request-id rule, 429/5xx backoff |
| `packages/paypal/src/testing.ts` | Create | `fakeFetch`, `jsonResponse` helpers shared by all PayPal tests |
| `packages/paypal/src/partner-referrals.ts` (+test) | Create | `POST /v2/customer/partner-referrals`, feature list, `actionUrlFromLinks` |
| `packages/paypal/src/merchant-integrations.ts` (+test) | Create | Status GET and `tracking_id` lookup with defensive parsing |
| `packages/db/src/schema/paypal.ts`, `schema/index.ts` | Create, Modify | `paypal_onboarding` table |
| `packages/db/src/migrations/<ts>_s3_paypal_onboarding/` | Generate | Migration |
| `packages/db/src/testing/db.ts` | Modify | Truncate `paypal_onboarding` |
| `packages/db/src/repositories/paypal-onboarding.ts` (+test) | Create | Referral/integration upserts, `markTeamPayPalMerchant` |
| `packages/db/src/repositories/teams.ts` (+test) | Create | `findTeamAccess`, `findTeamById`, `findTeamSlug` |
| `packages/api/src/context.ts` | Modify | Optional `paypal: PayPalServices` |
| `packages/api/src/paypal/onboarding.ts` | Create | Shared start/refresh/view orchestration |
| `packages/api/src/routers/paypal.ts` (+test), `routers/index.ts` | Create, Modify | `paypal.startOnboarding`, `paypal.onboardingStatus` |
| `apps/server/src/routes/paypal-onboarding.ts` (+test) | Create | `GET /api/paypal/onboarding/return` |
| `apps/server/src/services.ts`, `context.ts`, `index.ts`, `package.json` | Modify | PayPal wiring, KV token cache, cache invalidation, error logging |
| `apps/server/.env.schema`, `packages/infra/.env.schema`, `packages/infra/alchemy.run.ts`, `turbo.json` | Modify | `PAYPAL_PARTNER_MERCHANT_ID`, `PAYPAL_PARTNER_ATTRIBUTION_ID` |
| `apps/web/src/lib/paypal-status.ts` (+test) | Create | Pure view → card model mapping |
| `apps/web/src/components/paypal-connect-card.tsx` | Create | Generic Connect PayPal card (team ID prop) |
| `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx` | Modify | Mount the card |

---

## Task 0: Worktree and setup

S3 starts now, from `main` after W1-D merges. If the check in step 1 fails, stop and report to the controller: W1-D has not merged yet.

- [ ] **Step 1: Check that W1-D is on main and create the worktree**

```bash
SRC=/home/mouhamed/dev/repos/jendal/jendal-workspace
git -C $SRC log --oneline -3 main
git -C $SRC ls-tree main packages/ | grep email
```

Expected: a merge commit for `w1d-public-site-auth` in the log, and `packages/email` listed. Then the §2 setup of [`2026-10-06-parallel-execution.md`](2026-10-06-parallel-execution.md):

```bash
WS=s3-paypal-onboarding; WT=/home/mouhamed/dev/repos/jendal/worktrees/$WS; SRC=/home/mouhamed/dev/repos/jendal/jendal-workspace
git -C $SRC worktree add $WT -b s3-paypal-onboarding main
cp $SRC/apps/server/.env $WT/apps/server/.env
cp $SRC/packages/infra/.env $WT/packages/infra/.env
sed -E "s#(/jendal_test)([^/?]*)#\1_${WS}#" $SRC/.env.test.local > $WT/.env.test.local
docker exec jendal-pg createdb -U postgres "jendal_test_${WS}" 2>/dev/null || true
cd $WT && pnpm install --frozen-lockfile
```

- [ ] **Step 2: Verify the baseline**

Run: `pnpm test && pnpm check-types`
Expected: W1-D's tests pass against the worktree's own database `jendal_test_s3-paypal-onboarding`; no type errors. This worktree is the working directory for every later command.

No commit: the worktree and the copied env files are untracked.

---

## Task 1: `packages/paypal` — client, token cache, errors, auth assertion

**Files:**
- Create: `packages/paypal/package.json`, `packages/paypal/tsconfig.json`
- Create: `packages/paypal/src/errors.ts`, `token.ts`, `auth-assertion.ts`, `client.ts`, `testing.ts`, `index.ts`
- Test: `packages/paypal/src/client.test.ts`, `token.test.ts`, `auth-assertion.test.ts`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

- [ ] **Step 1: Create the package**

`packages/paypal/package.json`:

```json
{
  "name": "@jendal-workspace/paypal",
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

`packages/paypal/tsconfig.json`:

```json
{
  "extends": "@jendal-workspace/config/tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src"]
}
```

Run: `pnpm install`
Expected: `pnpm-lock.yaml` picks up the new workspace package.

- [ ] **Step 2: Write the failing tests**

`packages/paypal/src/auth-assertion.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildAuthAssertion } from "./index";

describe("buildAuthAssertion", () => {
  // PayPal's documented unsigned JWT: alg "none", iss + payer_id claims, empty signature (Fact 7).
  it("builds the unsigned JWT PayPal documents", () => {
    const parts = buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER42" }).split(".");

    expect(parts).toHaveLength(3);
    expect(JSON.parse(atob(String(parts[0])))).toEqual({ alg: "none" });
    expect(JSON.parse(atob(String(parts[1])))).toEqual({ iss: "partner-client-id", payer_id: "SELLER42" });
    expect(parts[2]).toBe("");
  });
});
```

`packages/paypal/src/token.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createKvTokenCache, createMemoryTokenCache, type JsonKv, type PayPalToken } from "./index";

function fakeKv() {
  const entries = new Map<string, { value: string; expirationTtl?: number }>();
  const kv: JsonKv = {
    async get(key) {
      const entry = entries.get(key);
      return entry ? JSON.parse(entry.value) : null;
    },
    async put(key, value, options) {
      entries.set(key, { value, expirationTtl: options?.expirationTtl });
    },
  };
  return { kv, entries };
}

describe("createMemoryTokenCache", () => {
  it("stores and returns the token", async () => {
    const cache = createMemoryTokenCache();
    expect(await cache.get()).toBeNull();
    const token: PayPalToken = { accessToken: "t", expiresAt: 123 };
    await cache.set(token);
    expect(await cache.get()).toEqual(token);
  });
});

describe("createKvTokenCache", () => {
  it("stores the token with a TTL that ends 60 seconds before expiry", async () => {
    const { kv, entries } = fakeKv();
    const now = 1_000_000;
    const cache = createKvTokenCache(kv, "paypal:oauth:sandbox:client", { now: () => now });

    await cache.set({ accessToken: "token-1", expiresAt: now + 3_600_000 });

    expect(entries.get("paypal:oauth:sandbox:client")?.expirationTtl).toBe(3540);
    await expect(cache.get()).resolves.toEqual({ accessToken: "token-1", expiresAt: now + 3_600_000 });
  });

  it("does not store tokens that expire within 60 seconds (KV's minimum TTL)", async () => {
    const { kv, entries } = fakeKv();
    const now = 1_000_000;
    const cache = createKvTokenCache(kv, "k", { now: () => now });

    await cache.set({ accessToken: "short", expiresAt: now + 100_000 });

    expect(entries.size).toBe(0);
  });

  it("ignores values that are not stored tokens", async () => {
    const { kv, entries } = fakeKv();
    entries.set("k", { value: JSON.stringify({ nope: true }) });
    const cache = createKvTokenCache(kv, "k", { now: () => 0 });

    await expect(cache.get()).resolves.toBeNull();
  });
});
```

`packages/paypal/src/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createPayPalClient, PayPalError } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

const CONFIG = {
  clientId: "partner-client-id",
  clientSecret: "partner-secret",
  environment: "sandbox" as const,
  sleep: () => Promise.resolve(),
};

function clientWith(fetch: ReturnType<typeof fakeFetch>["fetch"], extra: Record<string, unknown> = {}) {
  return createPayPalClient({ ...CONFIG, fetch, ...extra });
}

describe("OAuth token", () => {
  it("fetches a token once and reuses it until it expires", async () => {
    let now = 1_000_000;
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    const client = clientWith(fetch, { now: () => now });

    await client.request({ method: "GET", path: "/v1/example" });
    await client.request({ method: "GET", path: "/v1/example" });
    expect(requests.filter((r) => r.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);

    now += 32400 * 1000; // past expiry minus the 60-second skew
    await client.request({ method: "GET", path: "/v1/example" });
    expect(requests.filter((r) => r.url.endsWith("/v1/oauth2/token"))).toHaveLength(2);
  });

  it("sends basic auth to the token endpoint and a bearer token on API calls", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );

    await clientWith(fetch).request({ method: "GET", path: "/v1/example" });

    const tokenCall = recordedAt(requests, 0);
    expect(tokenCall.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(tokenCall.headers.get("authorization")).toBe(`Basic ${btoa("partner-client-id:partner-secret")}`);
    expect(tokenCall.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(tokenCall.body).toBe("grant_type=client_credentials");
    expect(recordedAt(requests, 1).headers.get("authorization")).toBe("Bearer token-1");
  });

  it("uses the live base URL when the environment is live", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    const client = createPayPalClient({ ...CONFIG, environment: "live", fetch });

    await client.request({ method: "GET", path: "/v1/example" });

    expect(recordedAt(requests, 0).url).toBe("https://api-m.paypal.com/v1/oauth2/token");
    expect(recordedAt(requests, 1).url).toBe("https://api-m.paypal.com/v1/example");
  });

  it("turns a token failure into a PayPalError without calling the API", async () => {
    const { requests, fetch } = fakeFetch(() =>
      jsonResponse(401, { name: "AUTHENTICATION_FAILURE", message: "Authentication failed.", debug_id: "d1" }),
    );

    const error = await clientWith(fetch).request({ method: "GET", path: "/v1/example" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 401, name: "AUTHENTICATION_FAILURE", debugId: "d1" });
    expect(requests).toHaveLength(1);
  });
});

describe("request headers", () => {
  async function postWithHeaders(extra: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    await clientWith(fetch, extra).request({ method: "POST", path: "/v2/example", body: { a: 1 }, requestId: "req-1", ...options });
    return recordedAt(requests, 1);
  }

  it("sends PayPal-Request-Id and JSON content type on POST", async () => {
    const call = await postWithHeaders();

    expect(call.headers.get("paypal-request-id")).toBe("req-1");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("refuses a POST without a requestId before any HTTP call", async () => {
    const { requests, fetch } = fakeFetch(() => jsonResponse(200, FAKE_TOKEN_RESPONSE));
    const client = clientWith(fetch);

    await expect(client.request({ method: "POST", path: "/v2/example", body: {} })).rejects.toThrow(/requestId/);
    expect(requests).toHaveLength(0);
  });

  it("sends no request id or content type on GET", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    await clientWith(fetch).request({ method: "GET", path: "/v1/example" });

    const call = recordedAt(requests, 1);
    expect(call.headers.get("paypal-request-id")).toBeNull();
    expect(call.headers.get("content-type")).toBeNull();
  });

  it("sends the BN code when one is configured", async () => {
    const withBn = await postWithHeaders({ partnerAttributionId: "PAYLEOR_BN" });
    expect(withBn.headers.get("paypal-partner-attribution-id")).toBe("PAYLEOR_BN");

    const withoutBn = await postWithHeaders();
    expect(withoutBn.headers.get("paypal-partner-attribution-id")).toBeNull();
  });

  it("adds an unsigned PayPal-Auth-Assertion JWT when a merchant id is given", async () => {
    const call = await postWithHeaders({}, { merchantId: "SELLER42" });

    const parts = (call.headers.get("paypal-auth-assertion") ?? "").split(".");
    expect(JSON.parse(atob(String(parts[0])))).toEqual({ alg: "none" });
    expect(JSON.parse(atob(String(parts[1])))).toEqual({ iss: "partner-client-id", payer_id: "SELLER42" });
    expect(parts[2]).toBe("");
  });
});

describe("retries", () => {
  it("retries 429 with exponential backoff and jitter, reusing the request id", async () => {
    const delays: number[] = [];
    const { requests, fetch } = fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      return requests.length < 4 ? jsonResponse(429, { name: "RATE_LIMIT_REACHED" }) : jsonResponse(200, {});
    });
    const client = clientWith(fetch, { random: () => 0, sleep: (ms: number) => (delays.push(ms), Promise.resolve()) });

    await client.request({ method: "POST", path: "/v2/example", body: {}, requestId: "same-id" });

    expect(delays).toEqual([250, 500]);
    expect(requests).toHaveLength(4); // one token call, three API calls
    for (const call of requests.slice(1)) {
      expect(call.headers.get("paypal-request-id")).toBe("same-id");
    }
  });

  it("honors a Retry-After header on 429", async () => {
    const delays: number[] = [];
    let apiCalls = 0;
    const { fetch } = fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      apiCalls += 1;
      if (apiCalls === 1) {
        return new Response(JSON.stringify({ name: "RATE_LIMIT_REACHED" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "2" },
        });
      }
      return jsonResponse(200, {});
    });
    const client = clientWith(fetch, { sleep: (ms: number) => (delays.push(ms), Promise.resolve()) });

    await client.request({ method: "GET", path: "/v1/example" });

    expect(delays).toEqual([2000]);
  });

  it("retries 5xx but not other 4xx", async () => {
    const apiCalls: string[] = [];
    const { fetch } = fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      apiCalls.push(request.url);
      return apiCalls.length === 1 ? jsonResponse(500, {}) : jsonResponse(400, { name: "INVALID_REQUEST", message: "bad" });
    });
    const client = clientWith(fetch);

    await expect(client.request({ method: "GET", path: "/v1/example" })).rejects.toMatchObject({ status: 400 });
    expect(apiCalls).toHaveLength(2);
  });

  it("gives up after maxAttempts and throws a PayPalError", async () => {
    const apiCalls: string[] = [];
    const { fetch } = fakeFetch((request) => {
      if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      apiCalls.push(request.url);
      return jsonResponse(429, { name: "RATE_LIMIT_REACHED", debug_id: "d429" });
    });

    await expect(clientWith(fetch).request({ method: "GET", path: "/v1/example" })).rejects.toMatchObject({
      status: 429,
      debugId: "d429",
    });
    expect(apiCalls).toHaveLength(3);
  });
});

describe("error mapping", () => {
  it("carries status, debug id, name and details", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(422, {
            name: "INVALID_REQUEST",
            message: "Request is not well-formed.",
            debug_id: "abc123",
            details: [{ field: "/tracking_id", value: "", issue: "INVALID_STRING_LENGTH", description: "Too short." }],
          }),
    );

    const error = await clientWith(fetch)
      .request({ method: "POST", path: "/v2/example", body: {}, requestId: "r" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({
      status: 422,
      name: "INVALID_REQUEST",
      message: "Request is not well-formed.",
      debugId: "abc123",
      details: [{ field: "/tracking_id", value: "", issue: "INVALID_STRING_LENGTH", description: "Too short." }],
    });
  });

  it("maps a non-JSON error body to a bare PayPalError", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : new Response("oops", { status: 400, headers: { "content-type": "text/plain" } }),
    );

    await expect(clientWith(fetch).request({ method: "GET", path: "/v1/example" })).rejects.toMatchObject({
      status: 400,
      message: "PayPal answered 400",
      debugId: undefined,
      details: [],
    });
  });

  it("resolves undefined for a 204", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : new Response(null, { status: 204 }),
    );

    await expect(clientWith(fetch).request({ method: "GET", path: "/v1/none" })).resolves.toBeUndefined();
  });
});
```

Run: `pnpm test packages/paypal`
Expected: FAIL, the test files cannot import `./index` (no sources yet).

- [ ] **Step 3: Implement the package core**

`packages/paypal/src/errors.ts`:

```ts
export type PayPalErrorDetail = {
  field?: string;
  value?: string;
  issue?: string;
  description?: string;
};

export class PayPalError extends Error {
  readonly status: number;
  readonly debugId: string | undefined;
  readonly details: PayPalErrorDetail[];

  constructor(input: { status: number; message: string; debugId?: string; name?: string; details?: PayPalErrorDetail[] }) {
    super(input.message);
    // PayPal's error name (INVALID_REQUEST, …) is more useful in logs than the class name.
    this.name = input.name ?? "PayPalError";
    this.status = input.status;
    this.debugId = input.debugId;
    this.details = input.details ?? [];
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

// Error bodies carry name, message, details and debug_id (Fact 3).
export async function payPalErrorFromResponse(response: Response): Promise<PayPalError> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const record = asRecord(body);
  const details: PayPalErrorDetail[] = [];
  if (record && Array.isArray(record.details)) {
    for (const item of record.details) {
      const detail = asRecord(item);
      if (!detail) continue;
      details.push({
        field: typeof detail.field === "string" ? detail.field : undefined,
        value: typeof detail.value === "string" ? detail.value : undefined,
        issue: typeof detail.issue === "string" ? detail.issue : undefined,
        description: typeof detail.description === "string" ? detail.description : undefined,
      });
    }
  }
  return new PayPalError({
    status: response.status,
    message: typeof record?.message === "string" ? record.message : `PayPal answered ${response.status}`,
    debugId: typeof record?.debug_id === "string" ? record.debug_id : undefined,
    name: typeof record?.name === "string" ? record.name : undefined,
    details,
  });
}
```

`packages/paypal/src/token.ts`:

```ts
// The subset of Workers KV this adapter uses; a real KVNamespace satisfies it.
export interface JsonKv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export type PayPalToken = { accessToken: string; expiresAt: number };

export interface PayPalTokenCache {
  get(): Promise<PayPalToken | null>;
  set(token: PayPalToken): Promise<void>;
}

// Default for tests and one-off scripts: Worker isolates share no memory, so the Worker passes the KV adapter.
export function createMemoryTokenCache(): PayPalTokenCache {
  let token: PayPalToken | null = null;
  return {
    async get() {
      return token;
    },
    async set(next) {
      token = next;
    },
  };
}

// Refetch margin, same as the ruleshub snippet (Fact 8).
const EXPIRY_SKEW_MS = 60_000;
// KV rejects expirationTtl values below 60 seconds; a shorter-lived token is simply not stored.
const KV_MIN_TTL_SECONDS = 60;

export function createKvTokenCache(
  kv: JsonKv,
  key: string,
  options: { now?: () => number } = {},
): PayPalTokenCache {
  const now = options.now ?? (() => Date.now());
  return {
    async get() {
      const value = await kv.get(key, "json");
      const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
      if (!record || typeof record.accessToken !== "string" || typeof record.expiresAt !== "number") return null;
      return { accessToken: record.accessToken, expiresAt: record.expiresAt };
    },
    async set(token) {
      const ttlSeconds = Math.floor((token.expiresAt - EXPIRY_SKEW_MS - now()) / 1000);
      if (ttlSeconds < KV_MIN_TTL_SECONDS) return;
      await kv.put(key, JSON.stringify(token), { expirationTtl: ttlSeconds });
    },
  };
}
```

`packages/paypal/src/auth-assertion.ts`:

```ts
// Fact 7: PayPal recommends the unsigned JWT — alg "none", iss = partner client ID,
// payer_id = seller merchant ID, empty signature; standard base64 with padding, joined with dots.
export function buildAuthAssertion(input: { clientId: string; payerId: string }): string {
  const header = btoa(JSON.stringify({ alg: "none" }));
  const payload = btoa(JSON.stringify({ iss: input.clientId, payer_id: input.payerId }));
  return `${header}.${payload}.`;
}
```

`packages/paypal/src/client.ts`:

```ts
import { buildAuthAssertion } from "./auth-assertion";
import { payPalErrorFromResponse } from "./errors";
import { createMemoryTokenCache, type PayPalToken, type PayPalTokenCache } from "./token";

export type PayPalEnvironment = "sandbox" | "live";

// Fact 4.
export const PAYPAL_BASE_URLS: Record<PayPalEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export type FetchLike = (request: Request) => Promise<Response>;

export type PayPalClientConfig = {
  clientId: string;
  clientSecret: string;
  environment: PayPalEnvironment;
  fetch?: FetchLike;
  tokenCache?: PayPalTokenCache;
  // The partner's BN code, sent as PayPal-Partner-Attribution-Id on every call (Fact 7).
  partnerAttributionId?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export type PayPalRequestOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  // Required on POST: sent as PayPal-Request-Id, which makes retries idempotent (Fact 8).
  requestId?: string;
  // Adds PayPal-Auth-Assertion to act on behalf of this connected merchant (Fact 7).
  merchantId?: string;
};

export type PayPalRequest = <T>(options: PayPalRequestOptions) => Promise<T>;

export interface PayPalClient {
  request: PayPalRequest;
}

type ResolvedConfig = {
  fetch: FetchLike;
  tokenCache: PayPalTokenCache;
  partnerAttributionId: string | undefined;
  maxAttempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
};

const TOKEN_EXPIRY_SKEW_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 429 and 5xx are retried with backoff and jitter (spec §6.3). Retried POSTs carry the
// caller's PayPal-Request-Id, so PayPal applies them at most once (Fact 8).
async function send(config: ResolvedConfig, build: () => Request): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await config.fetch(build());
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt >= config.maxAttempts) return response;
    await config.sleep(backoffDelay(config, response, attempt));
  }
}

function backoffDelay(config: ResolvedConfig, response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return config.baseDelayMs * 2 ** (attempt - 1) + Math.floor(config.random() * config.baseDelayMs);
}

export function createPayPalClient(config: PayPalClientConfig): PayPalClient {
  const resolved: ResolvedConfig = {
    fetch: config.fetch ?? ((request) => fetch(request)),
    tokenCache: config.tokenCache ?? createMemoryTokenCache(),
    partnerAttributionId: config.partnerAttributionId,
    maxAttempts: config.maxAttempts ?? 3,
    baseDelayMs: config.baseDelayMs ?? 250,
    sleep: config.sleep ?? defaultSleep,
    now: config.now ?? (() => Date.now()),
    random: config.random ?? Math.random,
  };
  const baseUrl = PAYPAL_BASE_URLS[config.environment];

  async function fetchToken(): Promise<PayPalToken> {
    const response = await send(
      resolved,
      () =>
        new Request(`${baseUrl}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        }),
    );
    if (!response.ok) throw await payPalErrorFromResponse(response);
    const body: unknown = await response.json();
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    if (typeof record.access_token !== "string") {
      throw new Error("PayPal's token response has no access_token.");
    }
    const expiresIn = typeof record.expires_in === "number" ? record.expires_in : 3600;
    return { accessToken: record.access_token, expiresAt: resolved.now() + expiresIn * 1000 };
  }

  async function accessToken(): Promise<string> {
    const cached = await resolved.tokenCache.get();
    if (cached && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > resolved.now()) return cached.accessToken;
    const token = await fetchToken();
    await resolved.tokenCache.set(token);
    return token.accessToken;
  }

  async function request<T>(options: PayPalRequestOptions): Promise<T> {
    if (options.method === "POST" && !options.requestId) {
      throw new Error("PayPal POST calls require options.requestId, sent as PayPal-Request-Id.");
    }
    const token = await accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
    if (resolved.partnerAttributionId) headers["PayPal-Partner-Attribution-Id"] = resolved.partnerAttributionId;
    if (options.merchantId) {
      headers["PayPal-Auth-Assertion"] = buildAuthAssertion({ clientId: config.clientId, payerId: options.merchantId });
    }
    const response = await send(
      resolved,
      () =>
        new Request(`${baseUrl}${options.path}`, {
          method: options.method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        }),
    );
    if (!response.ok) throw await payPalErrorFromResponse(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return { request };
}
```

`packages/paypal/src/testing.ts`:

```ts
import type { FetchLike } from "./client";

export type RecordedRequest = { url: string; method: string; headers: Headers; body: string | null };

// Shared fake fetch for every test of this package and its callers (router tests included).
export function fakeFetch(handler: (request: RecordedRequest, callCount: number) => Response) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (request) => {
    const body = await request.text();
    const record: RecordedRequest = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: body || null,
    };
    requests.push(record);
    return handler(record, requests.length);
  };
  return { requests, fetch: fetchImpl };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function recordedAt(requests: RecordedRequest[], index: number): RecordedRequest {
  const request = requests[index];
  if (!request) throw new Error(`Only ${requests.length} requests recorded; no request #${index}.`);
  return request;
}

export const FAKE_TOKEN_RESPONSE = { access_token: "token-1", expires_in: 32400 };
```

`packages/paypal/src/index.ts`:

```ts
export * from "./auth-assertion";
export * from "./client";
export * from "./errors";
export * from "./token";
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test packages/paypal`
Expected: all tests pass.

Run: `pnpm -F @jendal-workspace/paypal check-types`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/paypal pnpm-lock.yaml
git status --short   # review: only intended files
git commit -m "feat(paypal): add a typed fetch client with token caching, backoff and error mapping" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 2: `packages/paypal` — partner referrals and merchant integrations

**Files:**
- Create: `packages/paypal/src/partner-referrals.ts`, `packages/paypal/src/merchant-integrations.ts`
- Test: `packages/paypal/src/partner-referrals.test.ts`, `packages/paypal/src/merchant-integrations.test.ts`
- Modify: `packages/paypal/src/client.ts`, `packages/paypal/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/paypal/src/partner-referrals.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { actionUrlFromLinks, createPayPalClient, PARTNER_REFERRAL_FEATURES } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

const REFERRAL_RESPONSE = {
  links: [
    {
      href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/REF-1",
      rel: "self",
      method: "GET",
    },
    {
      href: "https://www.sandbox.paypal.com/bizsignup/entry?partnerId=PARTNER42&token=REF-1",
      rel: "action_url",
      method: "GET",
    },
  ],
};

describe("partnerReferrals.create", () => {
  it("posts the referral body PayPal documents and returns the links", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(201, REFERRAL_RESPONSE),
    );
    const client = createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch,
      sleep: () => Promise.resolve(),
      partnerAttributionId: "PAYLEOR_BN",
    });

    const referral = await client.partnerReferrals.create({
      trackingId: "team-1",
      returnUrl: "https://admin.example.com/api/paypal/onboarding/return",
      requestId: "partner-referral:team-1:abc",
    });

    const call = recordedAt(requests, 1);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/customer/partner-referrals");
    expect(call.headers.get("paypal-request-id")).toBe("partner-referral:team-1:abc");
    expect(call.headers.get("paypal-partner-attribution-id")).toBe("PAYLEOR_BN");
    expect(JSON.parse(call.body ?? "")).toEqual({
      tracking_id: "team-1",
      partner_config_override: { return_url: "https://admin.example.com/api/paypal/onboarding/return" },
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: { features: [...PARTNER_REFERRAL_FEATURES] },
            },
          },
        },
      ],
      products: ["EXPRESS_CHECKOUT"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
    });
    expect(actionUrlFromLinks(referral.links)).toBe(
      "https://www.sandbox.paypal.com/bizsignup/entry?partnerId=PARTNER42&token=REF-1",
    );
  });

  it("requests exactly the platform spec's feature list", () => {
    expect([...PARTNER_REFERRAL_FEATURES]).toEqual([
      "PAYMENT",
      "REFUND",
      "PARTNER_FEE",
      "READ_SELLER_DISPUTE",
      "UPDATE_SELLER_DISPUTE",
      "TRACKING_SHIPMENT_READWRITE",
      "ACCESS_MERCHANT_INFORMATION",
    ]);
  });
});

describe("actionUrlFromLinks", () => {
  it("returns null when the response has no action_url link", () => {
    expect(actionUrlFromLinks([{ href: "https://api-m.sandbox.paypal.com/x", rel: "self" }])).toBeNull();
  });
});
```

`packages/paypal/src/merchant-integrations.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createPayPalClient, PayPalError } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

const CONFIG = {
  clientId: "partner-client-id",
  clientSecret: "partner-secret",
  environment: "sandbox" as const,
  sleep: () => Promise.resolve(),
};

const INTEGRATION_BODY = {
  merchant_id: "SELLER1",
  tracking_id: "team-1",
  products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE" }],
  capabilities: [{ name: "PAYPAL_CHECKOUT", status: "ACTIVE" }],
  payments_receivable: true,
  legal_name: "Acme LLC",
  primary_email: "seller@example.com",
  primary_email_confirmed: true,
  oauth_integrations: [
    {
      integration_type: "OAUTH_THIRD_PARTY",
      integration_method: "PAYPAL",
      oauth_third_party: [
        {
          partner_client_id: "partner-client-id",
          merchant_client_id: "seller-client-id",
          scopes: [
            "https://uri.paypal.com/services/payments/realtimepayment",
            "https://uri.paypal.com/services/payments/refund",
          ],
        },
      ],
    },
  ],
};

describe("merchantIntegrations.get", () => {
  it("gets the status and maps it to camelCase", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, INTEGRATION_BODY),
    );
    const client = createPayPalClient({ ...CONFIG, fetch });

    const status = await client.merchantIntegrations.get("PARTNER42", "SELLER1");

    expect(recordedAt(requests, 1).url).toBe(
      "https://api-m.sandbox.paypal.com/v1/customer/partners/PARTNER42/merchant-integrations/SELLER1",
    );
    expect(status).toEqual({
      merchantId: "SELLER1",
      trackingId: "team-1",
      paymentsReceivable: true,
      primaryEmail: "seller@example.com",
      primaryEmailConfirmed: true,
      legalName: "Acme LLC",
      products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE", vettingStatus: undefined }],
      capabilities: [{ name: "PAYPAL_CHECKOUT", status: "ACTIVE" }],
      oauthIntegrations: [
        {
          integrationType: "OAUTH_THIRD_PARTY",
          integrationMethod: "PAYPAL",
          status: undefined,
          oauthThirdParty: [
            {
              partnerClientId: "partner-client-id",
              merchantClientId: "seller-client-id",
              scopes: [
                "https://uri.paypal.com/services/payments/realtimepayment",
                "https://uri.paypal.com/services/payments/refund",
              ],
            },
          ],
        },
      ],
    });
  });

  it("throws when the response has no merchant_id", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );

    await expect(createPayPalClient({ ...CONFIG, fetch }).merchantIntegrations.get("PARTNER42", "SELLER1")).rejects.toThrow(
      /merchant_id/,
    );
  });
});

describe("merchantIntegrations.findByTrackingId", () => {
  it("returns the merchant reference for a known tracking id", async () => {
    const { requests, fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(200, { merchant_id: "SELLER1", tracking_id: "team-1" }),
    );
    const client = createPayPalClient({ ...CONFIG, fetch });

    await expect(client.merchantIntegrations.findByTrackingId("PARTNER42", "team-1")).resolves.toEqual({
      merchantId: "SELLER1",
      trackingId: "team-1",
    });
    expect(recordedAt(requests, 1).url).toBe(
      "https://api-m.sandbox.paypal.com/v1/customer/partners/PARTNER42/merchant-integrations?tracking_id=team-1",
    );
  });

  it("returns null on a 404 (the seller has not finished onboarding)", async () => {
    const { fetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(404, { name: "INVALID_RESOURCE_ID", message: "Resource not found.", debug_id: "d404" }),
    );

    await expect(
      createPayPalClient({ ...CONFIG, fetch }).merchantIntegrations.findByTrackingId("PARTNER42", "team-1"),
    ).resolves.toBeNull();
  });

  it("returns null for a 200 body without a merchant id, and rethrows other errors", async () => {
    const { fetch: emptyFetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, {}),
    );
    await expect(
      createPayPalClient({ ...CONFIG, fetch: emptyFetch }).merchantIntegrations.findByTrackingId("PARTNER42", "team-1"),
    ).resolves.toBeNull();

    const { fetch: failingFetch } = fakeFetch((request) =>
      request.url.endsWith("/v1/oauth2/token")
        ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
        : jsonResponse(500, { name: "INTERNAL_SERVER_ERROR", debug_id: "d500" }),
    );
    const error = await createPayPalClient({ ...CONFIG, fetch: failingFetch })
      .merchantIntegrations.findByTrackingId("PARTNER42", "team-1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 500, debugId: "d500" });
  });
});
```

Run: `pnpm test packages/paypal`
Expected: FAIL — `./index` does not export `PARTNER_REFERRAL_FEATURES`, `actionUrlFromLinks`, and `client.partnerReferrals` does not exist.

- [ ] **Step 2: Implement the modules**

`packages/paypal/src/partner-referrals.ts`:

```ts
import type { PayPalRequest } from "./client";

// Platform spec §5 step 1: the permissions Payleor asks every seller for (Fact 2).
export const PARTNER_REFERRAL_FEATURES = [
  "PAYMENT",
  "REFUND",
  "PARTNER_FEE",
  "READ_SELLER_DISPUTE",
  "UPDATE_SELLER_DISPUTE",
  "TRACKING_SHIPMENT_READWRITE",
  "ACCESS_MERCHANT_INFORMATION",
] as const;

export type PartnerReferralLink = { href: string; rel: string; method?: string };

// The 201 response is only a links array (Fact 1).
export type PartnerReferral = { links: PartnerReferralLink[] };

export type CreatePartnerReferralInput = {
  trackingId: string;
  returnUrl: string;
  requestId: string;
  features?: readonly string[];
};

export function createPartnerReferrals(request: PayPalRequest) {
  return {
    async create(input: CreatePartnerReferralInput): Promise<PartnerReferral> {
      return request<PartnerReferral>({
        method: "POST",
        path: "/v2/customer/partner-referrals",
        requestId: input.requestId,
        body: {
          tracking_id: input.trackingId,
          partner_config_override: { return_url: input.returnUrl },
          operations: [
            {
              operation: "API_INTEGRATION",
              api_integration_preference: {
                rest_api_integration: {
                  integration_method: "PAYPAL",
                  integration_type: "THIRD_PARTY",
                  third_party_details: { features: [...(input.features ?? PARTNER_REFERRAL_FEATURES)] },
                },
              },
            },
          ],
          products: ["EXPRESS_CHECKOUT"],
          legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
        },
      });
    },
  };
}

// The seller is redirected to the link with rel "action_url" (Fact 1).
export function actionUrlFromLinks(links: readonly PartnerReferralLink[]): string | null {
  return links.find((link) => link.rel === "action_url")?.href ?? null;
}
```

`packages/paypal/src/merchant-integrations.ts`:

```ts
import type { PayPalRequest } from "./client";
import { PayPalError } from "./errors";

export type OAuthThirdParty = {
  partnerClientId?: string;
  merchantClientId?: string;
  scopes: string[];
};

export type OAuthIntegration = {
  integrationType?: string;
  integrationMethod?: string;
  status?: string;
  oauthThirdParty: OAuthThirdParty[];
};

// Field list from the live doc's sample responses (Fact 5); unknown fields are ignored.
export type MerchantIntegration = {
  merchantId: string;
  trackingId?: string;
  paymentsReceivable?: boolean;
  primaryEmail?: string;
  primaryEmailConfirmed?: boolean;
  legalName?: string;
  products: { name: string; status?: string; vettingStatus?: string }[];
  capabilities: { name: string; status?: string }[];
  oauthIntegrations: OAuthIntegration[];
};

export type MerchantIntegrationRef = { merchantId: string; trackingId?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const records: Record<string, unknown>[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record) records.push(record);
  }
  return records;
}

export function parseMerchantIntegration(body: unknown): MerchantIntegration {
  const record = asRecord(body);
  const merchantId = record ? asString(record.merchant_id) : undefined;
  if (!record || !merchantId) {
    throw new Error("PayPal's merchant-integration response has no merchant_id.");
  }
  return {
    merchantId,
    trackingId: asString(record.tracking_id),
    paymentsReceivable: asBoolean(record.payments_receivable),
    primaryEmail: asString(record.primary_email),
    primaryEmailConfirmed: asBoolean(record.primary_email_confirmed),
    legalName: asString(record.legal_name),
    products: asRecordArray(record.products).map((product) => ({
      name: asString(product.name) ?? "",
      status: asString(product.status),
      vettingStatus: asString(product.vetting_status),
    })),
    capabilities: asRecordArray(record.capabilities).map((capability) => ({
      name: asString(capability.name) ?? "",
      status: asString(capability.status),
    })),
    oauthIntegrations: asRecordArray(record.oauth_integrations).map((integration) => ({
      integrationType: asString(integration.integration_type),
      integrationMethod: asString(integration.integration_method),
      status: asString(integration.status),
      oauthThirdParty: asRecordArray(integration.oauth_third_party).map((thirdParty) => ({
        partnerClientId: asString(thirdParty.partner_client_id),
        merchantClientId: asString(thirdParty.merchant_client_id),
        scopes: Array.isArray(thirdParty.scopes)
          ? thirdParty.scopes.filter((scope): scope is string => typeof scope === "string")
          : [],
      })),
    })),
  };
}

export function createMerchantIntegrations(request: PayPalRequest) {
  return {
    // GET /v1/customer/partners/{partner_id}/merchant-integrations/{merchant_id} (Fact 5).
    async get(partnerId: string, merchantId: string): Promise<MerchantIntegration> {
      const body = await request<unknown>({
        method: "GET",
        path: `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations/${encodeURIComponent(merchantId)}`,
      });
      return parseMerchantIntegration(body);
    },

    // GET /v1/customer/partners/{partner_id}/merchant-integrations?tracking_id=… (Fact 5).
    // 404 means PayPal has no integration for the tracking id: the seller has not finished.
    async findByTrackingId(partnerId: string, trackingId: string): Promise<MerchantIntegrationRef | null> {
      try {
        const body = await request<unknown>({
          method: "GET",
          path: `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations?tracking_id=${encodeURIComponent(trackingId)}`,
        });
        const record = asRecord(body);
        const merchantId = record ? asString(record.merchant_id) : undefined;
        if (!merchantId) return null;
        return { merchantId, trackingId: asString(record.tracking_id) };
      } catch (error) {
        if (error instanceof PayPalError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
```

- [ ] **Step 3: Wire the modules into the client**

In `packages/paypal/src/client.ts`, add the imports after the `payPalErrorFromResponse` import:

```ts
import { createMerchantIntegrations } from "./merchant-integrations";
import { createPartnerReferrals } from "./partner-referrals";
```

Replace the `PayPalClient` interface:

```ts
export interface PayPalClient {
  request: PayPalRequest;
  partnerReferrals: ReturnType<typeof createPartnerReferrals>;
  merchantIntegrations: ReturnType<typeof createMerchantIntegrations>;
}
```

Replace the final return of `createPayPalClient`:

```ts
  return {
    request,
    partnerReferrals: createPartnerReferrals(request),
    merchantIntegrations: createMerchantIntegrations(request),
  };
```

Append to `packages/paypal/src/index.ts`:

```ts
export * from "./merchant-integrations";
export * from "./partner-referrals";
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test packages/paypal && pnpm -F @jendal-workspace/paypal check-types`
Expected: all tests pass (Task 1's and the new ones); no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/paypal
git status --short   # review: only intended files
git commit -m "feat(paypal): add partner referrals and merchant integration status" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 3: `paypal_onboarding` table, migration and repositories

**Files:**
- Create: `packages/db/src/schema/paypal.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/testing/db.ts`
- Generate: `packages/db/src/migrations/<timestamp>_s3_paypal_onboarding/`
- Create: `packages/db/src/repositories/paypal-onboarding.ts`, `packages/db/src/repositories/teams.ts`
- Test: `packages/db/src/repositories/paypal-onboarding.test.ts`, `packages/db/src/repositories/teams.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/db/src/repositories/paypal-onboarding.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { team } from "../schema/organization";
import { createTestDb, hasTestDatabase, seedOrganization, seedStore, truncateAll } from "../testing/db";
import {
  findPayPalOnboarding,
  markTeamPayPalMerchant,
  savePayPalIntegration,
  savePayPalReferral,
} from "./paypal-onboarding";

describe.skipIf(!hasTestDatabase)("paypal onboarding repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedTeam(slug = "acme") {
    const { organizationId } = await seedOrganization(db);
    return seedStore(db, { organizationId, slug });
  }

  it("saves a referral and finds it by team", async () => {
    const store = await seedTeam();

    await savePayPalReferral(db, { teamId: store.id, trackingId: store.id, actionUrl: "https://paypal.example/abc" });

    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({
      teamId: store.id,
      trackingId: store.id,
      actionUrl: "https://paypal.example/abc",
      status: "pending",
      merchantId: null,
      paymentsReceivable: null,
      primaryEmailConfirmed: null,
      oauthIntegrations: null,
    });
    expect(await findPayPalOnboarding(db, "missing")).toBeNull();
  });

  it("a new referral replaces the action URL and resets the status, keeping the integration fields", async () => {
    const store = await seedTeam();
    await savePayPalReferral(db, { teamId: store.id, trackingId: store.id, actionUrl: "https://paypal.example/one" });
    await savePayPalIntegration(db, {
      teamId: store.id,
      merchantId: "SELLER1",
      status: "needs_attention",
      paymentsReceivable: false,
      primaryEmailConfirmed: true,
      oauthIntegrations: [],
    });

    const saved = await savePayPalReferral(db, {
      teamId: store.id,
      trackingId: store.id,
      actionUrl: "https://paypal.example/two",
    });

    expect(saved).toMatchObject({
      actionUrl: "https://paypal.example/two",
      status: "pending",
      merchantId: "SELLER1",
      primaryEmailConfirmed: true,
    });
  });

  it("saves the integration over an existing referral, keeping the action URL", async () => {
    const store = await seedTeam();
    await savePayPalReferral(db, { teamId: store.id, trackingId: store.id, actionUrl: "https://paypal.example/abc" });
    const oauthIntegrations = [
      {
        integrationType: "OAUTH_THIRD_PARTY",
        integrationMethod: "PAYPAL",
        oauthThirdParty: [{ partnerClientId: "p", merchantClientId: "m", scopes: ["scope-a"] }],
      },
    ];

    await savePayPalIntegration(db, {
      teamId: store.id,
      merchantId: "SELLER1",
      status: "connected",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      oauthIntegrations,
    });

    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({
      status: "connected",
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      actionUrl: "https://paypal.example/abc",
    });
    expect(row?.oauthIntegrations).toEqual(oauthIntegrations);
  });

  it("inserts a row when the integration arrives before any referral", async () => {
    const store = await seedTeam();

    await savePayPalIntegration(db, {
      teamId: store.id,
      merchantId: "SELLER1",
      status: "needs_attention",
      paymentsReceivable: false,
      primaryEmailConfirmed: false,
      oauthIntegrations: [],
    });

    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({
      teamId: store.id,
      trackingId: store.id,
      actionUrl: null,
      merchantId: "SELLER1",
      status: "needs_attention",
    });
  });

  it("writes the merchant id on the team and returns the slug", async () => {
    const store = await seedTeam();

    await expect(markTeamPayPalMerchant(db, { teamId: store.id, merchantId: "SELLER1" })).resolves.toEqual({
      slug: "acme",
    });
    const [row] = await db
      .select({ paypalMerchantId: team.paypalMerchantId })
      .from(team)
      .where(eq(team.id, store.id));
    expect(row?.paypalMerchantId).toBe("SELLER1");
    await expect(markTeamPayPalMerchant(db, { teamId: "missing", merchantId: "X" })).resolves.toBeNull();
  });

  it("deletes the onboarding row with its team", async () => {
    const store = await seedTeam();
    await savePayPalReferral(db, { teamId: store.id, trackingId: store.id, actionUrl: "https://paypal.example/abc" });

    await db.delete(team).where(eq(team.id, store.id));

    expect(await findPayPalOnboarding(db, store.id)).toBeNull();
  });
});
```

`packages/db/src/repositories/teams.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  addTeamMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedStore,
  seedUser,
  truncateAll,
} from "../testing/db";
import { findTeamAccess, findTeamById, findTeamSlug } from "./teams";

describe.skipIf(!hasTestDatabase)("team repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("finds a team by id with the caller's organization role", async () => {
    const { userId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    const store = await seedStore(db, { organizationId, slug: "acme" });

    const access = await findTeamAccess(db, { teamId: store.id, userId });

    expect(access).toEqual({ team: store, role: "owner", isTeamMember: false });
  });

  it("marks organization membership without team membership", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const staffId = await addMember(db, { organizationId, role: "member" });

    const beforeJoin = await findTeamAccess(db, { teamId: store.id, userId: staffId });
    expect(beforeJoin).toMatchObject({ role: "member", isTeamMember: false });

    await addTeamMember(db, { teamId: store.id, userId: staffId });
    const afterJoin = await findTeamAccess(db, { teamId: store.id, userId: staffId });
    expect(afterJoin?.isTeamMember).toBe(true);
  });

  it("returns null for a user outside the organization and for a missing team", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const outsiderId = await seedUser(db, "Outsider");

    expect(await findTeamAccess(db, { teamId: store.id, userId: outsiderId })).toBeNull();
    expect(await findTeamAccess(db, { teamId: "missing", userId: outsiderId })).toBeNull();
  });

  it("finds a team by id and a slug by team id", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });

    expect(await findTeamById(db, store.id)).toEqual(store);
    expect(await findTeamById(db, "missing")).toBeNull();
    expect(await findTeamSlug(db, store.id)).toBe("acme");
    expect(await findTeamSlug(db, "missing")).toBeNull();
  });
});
```

Run: `pnpm test packages/db`
Expected: FAIL, the new test files cannot import `./paypal-onboarding` and `./teams`.

- [ ] **Step 2: Add the schema**

`packages/db/src/schema/paypal.ts`:

```ts
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { team } from "./organization";

export type PayPalOnboardingStatus = "pending" | "connected" | "needs_attention";

// The normalized oauth_integrations payload from PayPal's merchant-integration status.
// Declared here because packages/db must not import packages/paypal (platform spec §3.2).
export type StoredOAuthIntegration = {
  integrationType?: string;
  integrationMethod?: string;
  status?: string;
  oauthThirdParty: { partnerClientId?: string; merchantClientId?: string; scopes: string[] }[];
};

// One PayPal onboarding per team (store or services team). tracking_id is the team ID;
// PayPal sends it back as `merchantId` on the return URL (Fact 6).
export const paypalOnboarding = pgTable("paypal_onboarding", {
  teamId: text("team_id")
    .primaryKey()
    .references(() => team.id, { onDelete: "cascade" }),
  trackingId: text("tracking_id").notNull().unique(),
  actionUrl: text("action_url"),
  status: text("status").$type<PayPalOnboardingStatus>().default("pending").notNull(),
  merchantId: text("merchant_id"),
  paymentsReceivable: boolean("payments_receivable"),
  primaryEmailConfirmed: boolean("primary_email_confirmed"),
  oauthIntegrations: jsonb("oauth_integrations").$type<StoredOAuthIntegration[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
```

In `packages/db/src/schema/index.ts`, append:

```ts
export * from "./paypal";
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name s3_paypal_onboarding`
Expected: a new folder `packages/db/src/migrations/<timestamp>_s3_paypal_onboarding/` whose `migration.sql` creates `paypal_onboarding` with `team_id` as primary key, a foreign key to `team(id)` with `on delete cascade`, a unique constraint on `tracking_id`, `status` defaulting to `'pending'`, and `oauth_integrations` of type jsonb. Read the SQL; it must contain no `DROP`.

- [ ] **Step 4: Truncate the new table in tests**

In `packages/db/src/testing/db.ts`, add `"paypal_onboarding"` at the front of the truncate list:

```ts
      'truncate table "paypal_onboarding", "rate_limit", "store_domains", "team_member", "team", "invitation", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
```

- [ ] **Step 5: Implement the repositories**

`packages/db/src/repositories/paypal-onboarding.ts`:

```ts
import { eq } from "drizzle-orm";

import type { Database } from "../index";
import { team } from "../schema/organization";
import {
  paypalOnboarding,
  type PayPalOnboardingStatus,
  type StoredOAuthIntegration,
} from "../schema/paypal";

export type PayPalOnboardingRow = typeof paypalOnboarding.$inferSelect;

export async function findPayPalOnboarding(db: Database, teamId: string): Promise<PayPalOnboardingRow | null> {
  const [row] = await db.select().from(paypalOnboarding).where(eq(paypalOnboarding.teamId, teamId)).limit(1);
  return row ?? null;
}

// A fresh action URL for a new (or restarted) onboarding. Keeps any integration fields:
// a seller who finished once and restarts keeps their merchant id on the row.
export async function savePayPalReferral(
  db: Database,
  input: { teamId: string; trackingId: string; actionUrl: string },
): Promise<PayPalOnboardingRow> {
  const [row] = await db
    .insert(paypalOnboarding)
    .values({ teamId: input.teamId, trackingId: input.trackingId, actionUrl: input.actionUrl, status: "pending" })
    .onConflictDoUpdate({
      target: paypalOnboarding.teamId,
      set: { actionUrl: input.actionUrl, status: "pending", updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Upsert into paypal_onboarding returned no row");
  return row;
}

export type SavePayPalIntegrationInput = {
  teamId: string;
  merchantId: string;
  status: PayPalOnboardingStatus;
  paymentsReceivable: boolean;
  primaryEmailConfirmed: boolean;
  oauthIntegrations: StoredOAuthIntegration[];
};

// Upsert so a completed PayPal onboarding is recorded even if the referral row is missing.
// The action URL survives: a seller whose account needs attention can reopen the flow.
export async function savePayPalIntegration(
  db: Database,
  input: SavePayPalIntegrationInput,
): Promise<PayPalOnboardingRow> {
  const [row] = await db
    .insert(paypalOnboarding)
    .values({
      teamId: input.teamId,
      trackingId: input.teamId,
      actionUrl: null,
      status: input.status,
      merchantId: input.merchantId,
      paymentsReceivable: input.paymentsReceivable,
      primaryEmailConfirmed: input.primaryEmailConfirmed,
      oauthIntegrations: input.oauthIntegrations,
    })
    .onConflictDoUpdate({
      target: paypalOnboarding.teamId,
      set: {
        status: input.status,
        merchantId: input.merchantId,
        paymentsReceivable: input.paymentsReceivable,
        primaryEmailConfirmed: input.primaryEmailConfirmed,
        oauthIntegrations: input.oauthIntegrations,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("Upsert into paypal_onboarding returned no row");
  return row;
}

// Returns the team's slug so the caller can invalidate the cached store record (Fact 10).
export async function markTeamPayPalMerchant(
  db: Database,
  input: { teamId: string; merchantId: string },
): Promise<{ slug: string } | null> {
  const [row] = await db
    .update(team)
    .set({ paypalMerchantId: input.merchantId })
    .where(eq(team.id, input.teamId))
    .returning({ slug: team.slug });
  return row ?? null;
}
```

`packages/db/src/repositories/teams.ts`:

```ts
import type { StoreRecord } from "@jendal-workspace/core";
import { and, eq } from "drizzle-orm";

import type { Database } from "../index";
import { member, team, teamMember } from "../schema/organization";

const teamColumns = {
  id: team.id,
  organizationId: team.organizationId,
  slug: team.slug,
  name: team.name,
  status: team.status,
  paypalMerchantId: team.paypalMerchantId,
};

export type TeamAccessRow = { team: StoreRecord; role: string; isTeamMember: boolean };

// Null when the team does not exist or the user is not a member of its organization.
// Same access shape as findStoreAccess, keyed by team id instead of slug.
export async function findTeamAccess(
  db: Database,
  input: { teamId: string; userId: string },
): Promise<TeamAccessRow | null> {
  const [row] = await db
    .select({ ...teamColumns, role: member.role, teamMemberId: teamMember.id })
    .from(team)
    .innerJoin(member, and(eq(member.organizationId, team.organizationId), eq(member.userId, input.userId)))
    .leftJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, input.userId)))
    .where(eq(team.id, input.teamId))
    .limit(1);
  if (!row) return null;
  const { role, teamMemberId, ...teamRecord } = row;
  return { team: teamRecord, role, isTeamMember: teamMemberId !== null };
}

export async function findTeamById(db: Database, teamId: string): Promise<StoreRecord | null> {
  const [row] = await db.select(teamColumns).from(team).where(eq(team.id, teamId)).limit(1);
  return row ?? null;
}

export async function findTeamSlug(db: Database, teamId: string): Promise<string | null> {
  const [row] = await db.select({ slug: team.slug }).from(team).where(eq(team.id, teamId)).limit(1);
  return row?.slug ?? null;
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test packages/db`
Expected: all pass, including the new repository tests (the global setup rebuilds the test database with the new migration).

- [ ] **Step 7: Migrate the local dev database**

Run: `pnpm db:migrate:dev`
Expected: the new migration applies to `jendal-dev` (shared by all workstreams; the change is additive).

- [ ] **Step 8: Commit**

```bash
git add packages/db/src
git status --short   # review: only intended files
git commit -m "feat(db): add the paypal_onboarding table and team repositories" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 4: `paypal.startOnboarding` and `paypal.onboardingStatus`

**Files:**
- Modify: `packages/api/package.json`, `packages/api/src/context.ts`, `packages/api/src/routers/index.ts`, `pnpm-lock.yaml`
- Create: `packages/api/src/paypal/onboarding.ts`, `packages/api/src/routers/paypal.ts`
- Test: `packages/api/src/routers/paypal.test.ts`

The orchestration (`startPayPalOnboarding`, `refreshPayPalOnboarding`, `getPayPalOnboardingView`) lives in `packages/api/src/paypal/onboarding.ts` so the tRPC router (this task) and the api Worker's return route (Task 5) share it.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routers/paypal.test.ts` (`makeSession` is copied verbatim from `store.test.ts`):

```ts
import { createTestAuth } from "@jendal-workspace/auth/testing";
import { findPayPalOnboarding, markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { team } from "@jendal-workspace/db/schema/organization";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedStore,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createPayPalClient, type FetchLike } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse } from "@jendal-workspace/paypal/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Context, PayPalServices } from "../context";
import { refreshPayPalOnboarding } from "../paypal/onboarding";
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

const RETURN_URL = "https://admin.example.com/api/paypal/onboarding/return";
const ACTION_URL = "https://www.sandbox.paypal.com/bizsignup/entry?token=REF-1";

function makePayPal(
  fetchImpl: FetchLike,
  onTeamMerchantChanged?: PayPalServices["onTeamMerchantChanged"],
): PayPalServices {
  return {
    client: createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
    }),
    partnerId: "PARTNER42",
    returnUrl: RETURN_URL,
    onTeamMerchantChanged,
  };
}

// A fake PayPal API: token endpoint, partner referral, tracking lookup and status GET.
// `integration: null` makes the tracking lookup answer 404 (seller has not finished).
function fakePayPalApi(options: { integration: Record<string, unknown> | null }) {
  return fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.url.endsWith("/v2/customer/partner-referrals")) {
      return jsonResponse(201, { links: [{ href: ACTION_URL, rel: "action_url", method: "GET" }] });
    }
    if (request.url.includes("/merchant-integrations?tracking_id=")) {
      if (options.integration === null) {
        return jsonResponse(404, { name: "INVALID_RESOURCE_ID", message: "Resource not found.", debug_id: "d404" });
      }
      return jsonResponse(200, {
        merchant_id: options.integration.merchant_id,
        tracking_id: options.integration.tracking_id,
      });
    }
    if (request.url.includes("/merchant-integrations/")) {
      return jsonResponse(200, options.integration ?? {});
    }
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
}

describe.skipIf(!hasTestDatabase)("paypal router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null, paypal?: PayPalServices) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      paypal,
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("requires authentication", async () => {
    const { fetch } = fakePayPalApi({ integration: null });

    await expect(callerFor(null, makePayPal(fetch)).paypal.startOnboarding({ teamId: "team-1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("hides teams the caller cannot administer", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const outsiderId = await seedUser(db, "Outsider");
    const staffId = await addMember(db, { organizationId, role: "member" });
    const { fetch } = fakePayPalApi({ integration: null });
    const paypal = makePayPal(fetch);

    await expect(callerFor(outsiderId, paypal).paypal.startOnboarding({ teamId: store.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // A plain member can open the store but not connect PayPal (services spec §4.1: an admin power).
    await expect(
      callerFor(staffId, paypal).paypal.onboardingStatus({ teamId: store.id, refresh: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fails with PRECONDITION_FAILED when PayPal is not configured", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });

    await expect(callerFor(userId).paypal.startOnboarding({ teamId: store.id })).rejects.toThrow(
      /PayPal is not configured/,
    );
  });

  it("starts onboarding and stores the pending referral", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { requests, fetch } = fakePayPalApi({ integration: null });

    const started = await callerFor(userId, makePayPal(fetch)).paypal.startOnboarding({ teamId: store.id });

    expect(started).toEqual({ actionUrl: ACTION_URL });
    const referralCall = requests.find((r) => r.url.endsWith("/v2/customer/partner-referrals"));
    expect(referralCall?.headers.get("paypal-request-id")).toMatch(/^partner-referral:/);
    expect(JSON.parse(referralCall?.body ?? "{}")).toMatchObject({
      tracking_id: store.id,
      partner_config_override: { return_url: RETURN_URL },
      products: ["EXPRESS_CHECKOUT"],
    });
    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({ trackingId: store.id, actionUrl: ACTION_URL, status: "pending", merchantId: null });
  });

  it("refuses a start when the return URL is longer than PayPal's 127-character limit", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { requests, fetch } = fakePayPalApi({ integration: null });
    const paypal = { ...makePayPal(fetch), returnUrl: `https://admin.example.com/${"x".repeat(120)}` };

    await expect(callerFor(userId, paypal).paypal.startOnboarding({ teamId: store.id })).rejects.toThrow(/127/);
    expect(requests).toHaveLength(0);
  });

  it("reports not_connected before anything starts", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { fetch } = fakePayPalApi({ integration: null });

    await expect(
      callerFor(userId, makePayPal(fetch)).paypal.onboardingStatus({ teamId: store.id, refresh: false }),
    ).resolves.toEqual({
      state: "not_connected",
      merchantId: null,
      actionUrl: null,
      paymentsReceivable: null,
      primaryEmailConfirmed: null,
    });
  });

  it("stays pending while PayPal has no integration for the tracking id", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { fetch } = fakePayPalApi({ integration: null });
    const caller = callerFor(userId, makePayPal(fetch));

    await caller.paypal.startOnboarding({ teamId: store.id });

    await expect(caller.paypal.onboardingStatus({ teamId: store.id, refresh: true })).resolves.toEqual({
      state: "pending",
      merchantId: null,
      actionUrl: ACTION_URL,
      paymentsReceivable: null,
      primaryEmailConfirmed: null,
    });
  });

  it("reports needs_attention while PayPal has not cleared the account", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const integration = {
      merchant_id: "SELLER1",
      tracking_id: store.id,
      payments_receivable: false,
      primary_email_confirmed: false,
      oauth_integrations: [],
    };
    const { fetch } = fakePayPalApi({ integration });
    const changed: { id: string; slug: string }[] = [];
    const caller = callerFor(userId, makePayPal(fetch, (team) => changed.push(team)));
    await caller.paypal.startOnboarding({ teamId: store.id });

    await expect(caller.paypal.onboardingStatus({ teamId: store.id, refresh: true })).resolves.toEqual({
      state: "needs_attention",
      merchantId: "SELLER1",
      actionUrl: ACTION_URL,
      paymentsReceivable: false,
      primaryEmailConfirmed: false,
    });

    const [teamRow] = await db.select({ paypalMerchantId: team.paypalMerchantId }).from(team).where(eq(team.id, store.id));
    expect(teamRow?.paypalMerchantId).toBeNull();
    expect(changed).toEqual([]);
  });

  it("connects the team when PayPal confirms payments and email", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const integration = {
      merchant_id: "SELLER1",
      tracking_id: store.id,
      payments_receivable: true,
      primary_email_confirmed: true,
      primary_email: "seller@example.com",
      oauth_integrations: [
        {
          integration_type: "OAUTH_THIRD_PARTY",
          integration_method: "PAYPAL",
          oauth_third_party: [
            {
              partner_client_id: "partner-client-id",
              merchant_client_id: "seller-client-id",
              scopes: ["https://uri.paypal.com/services/payments/realtimepayment"],
            },
          ],
        },
      ],
    };
    const { fetch } = fakePayPalApi({ integration });
    const changed: { id: string; slug: string }[] = [];
    const caller = callerFor(userId, makePayPal(fetch, (team) => changed.push(team)));
    await caller.paypal.startOnboarding({ teamId: store.id });

    await expect(caller.paypal.onboardingStatus({ teamId: store.id, refresh: true })).resolves.toEqual({
      state: "connected",
      merchantId: "SELLER1",
      actionUrl: null,
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
    });

    const [teamRow] = await db.select({ paypalMerchantId: team.paypalMerchantId }).from(team).where(eq(team.id, store.id));
    expect(teamRow?.paypalMerchantId).toBe("SELLER1");
    expect(changed).toEqual([{ id: store.id, slug: "acme" }]);
    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({
      status: "connected",
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
    });
    expect(row?.oauthIntegrations?.[0]?.oauthThirdParty[0]?.scopes).toEqual([
      "https://uri.paypal.com/services/payments/realtimepayment",
    ]);
  });

  it("rejects a second start once the team is connected", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    await markTeamPayPalMerchant(db, { teamId: store.id, merchantId: "SELLER1" });
    const { fetch } = fakePayPalApi({ integration: null });

    await expect(callerFor(userId, makePayPal(fetch)).paypal.startOnboarding({ teamId: store.id })).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
  });
});

describe.skipIf(!hasTestDatabase)("refreshPayPalOnboarding", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("refuses a merchant id that does not match the tracking id lookup", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { fetch } = fakePayPalApi({ integration: { merchant_id: "SELLER1", tracking_id: store.id } });

    await expect(
      refreshPayPalOnboarding({ db, ...makePayPal(fetch) }, store, { merchantIdInPayPal: "ATTACKER99" }),
    ).rejects.toThrow(/does not match/);
    expect(await findPayPalOnboarding(db, store.id)).toBeNull();
    const [teamRow] = await db.select({ paypalMerchantId: team.paypalMerchantId }).from(team).where(eq(team.id, store.id));
    expect(teamRow?.paypalMerchantId).toBeNull();
  });
});
```

Run: `pnpm test packages/api`
Expected: FAIL, the test file cannot import `../paypal/onboarding` and `../context` has no `PayPalServices`.

- [ ] **Step 2: Add the dependency**

```bash
pnpm -F @jendal-workspace/api add "@jendal-workspace/paypal@workspace:*"
```

Expected: `packages/api/package.json` lists `"@jendal-workspace/paypal": "workspace:*"`.

- [ ] **Step 3: Extend the tRPC context**

Replace `packages/api/src/context.ts`:

```ts
import type { Auth, Session } from "@jendal-workspace/auth";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { PayPalClient } from "@jendal-workspace/paypal";

export type PayPalServices = {
  client: PayPalClient;
  partnerId: string;
  returnUrl: string;
  // Called after team.paypal_merchant_id changes; the api Worker invalidates the KV store cache (Fact 10).
  onTeamMerchantChanged?: (team: { id: string; slug: string }) => void | Promise<void>;
};

export type Context = {
  session: Session | null;
  db: Database;
  environment: TenantEnvironment;
  // Procedures that act through Better Auth (organizations, stores) pass the caller's headers on.
  auth: Auth;
  headers: Headers;
  // Absent in tests and when PayPal is not configured; the paypal router then fails with PRECONDITION_FAILED.
  paypal?: PayPalServices;
};
```

- [ ] **Step 4: Implement the onboarding service**

`packages/api/src/paypal/onboarding.ts`:

```ts
import type { StoreRecord } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  findPayPalOnboarding,
  markTeamPayPalMerchant,
  type PayPalOnboardingRow,
  savePayPalIntegration,
  savePayPalReferral,
} from "@jendal-workspace/db/repositories/paypal-onboarding";
import { actionUrlFromLinks, type PayPalClient } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";

// Assembled by the router (tRPC) and by the return route (Hono) from Context["paypal"] plus the db.
export type PayPalOnboardingDeps = {
  db: Database;
  client: PayPalClient;
  partnerId: string;
  returnUrl: string;
  onTeamMerchantChanged?: (team: { id: string; slug: string }) => void | Promise<void>;
};

export type PayPalOnboardingState = "not_connected" | "pending" | "connected" | "needs_attention";

export type PayPalOnboardingView = {
  state: PayPalOnboardingState;
  merchantId: string | null;
  actionUrl: string | null;
  paymentsReceivable: boolean | null;
  primaryEmailConfirmed: boolean | null;
};

export function viewFor(team: StoreRecord, row: PayPalOnboardingRow | null): PayPalOnboardingView {
  // team.paypal_merchant_id is the source of truth for "connected"; only written once
  // PayPal confirmed payments_receivable and primary_email_confirmed.
  if (team.paypalMerchantId) {
    return {
      state: "connected",
      merchantId: team.paypalMerchantId,
      actionUrl: null,
      paymentsReceivable: row?.paymentsReceivable ?? true,
      primaryEmailConfirmed: row?.primaryEmailConfirmed ?? true,
    };
  }
  if (!row) {
    return {
      state: "not_connected",
      merchantId: null,
      actionUrl: null,
      paymentsReceivable: null,
      primaryEmailConfirmed: null,
    };
  }
  const stored = {
    merchantId: row.merchantId,
    actionUrl: row.actionUrl,
    paymentsReceivable: row.paymentsReceivable,
    primaryEmailConfirmed: row.primaryEmailConfirmed,
  };
  return row.status === "pending" ? { state: "pending", ...stored } : { state: "needs_attention", ...stored };
}

// PayPal caps tracking_id and return_url at 127 characters (Fact 2).
const PAYPAL_URL_MAX_LENGTH = 127;

export async function startPayPalOnboarding(
  deps: PayPalOnboardingDeps,
  team: StoreRecord,
): Promise<{ actionUrl: string }> {
  if (team.paypalMerchantId) {
    throw new TRPCError({ code: "CONFLICT", message: "This team already has a PayPal account connected." });
  }
  if (deps.returnUrl.length > PAYPAL_URL_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The PayPal return URL is longer than 127 characters." });
  }
  const referral = await deps.client.partnerReferrals.create({
    trackingId: team.id,
    returnUrl: deps.returnUrl,
    // A fresh suffix per attempt: a used action_url cannot be reopened, so every start mints a new link (Fact 6).
    requestId: `partner-referral:${team.id}:${crypto.randomUUID()}`,
  });
  const actionUrl = actionUrlFromLinks(referral.links);
  if (!actionUrl) throw new Error("PayPal's partner referral response has no action_url link.");
  await savePayPalReferral(deps.db, { teamId: team.id, trackingId: team.id, actionUrl });
  return { actionUrl };
}

export async function getPayPalOnboardingView(
  deps: PayPalOnboardingDeps,
  team: StoreRecord,
): Promise<PayPalOnboardingView> {
  return viewFor(team, await findPayPalOnboarding(deps.db, team.id));
}

// Re-reads the integration from PayPal — never trusting return-URL query parameters (Fact 6) —
// stores it, and writes team.paypal_merchant_id once the account can receive payments.
export async function refreshPayPalOnboarding(
  deps: PayPalOnboardingDeps,
  team: StoreRecord,
  hint: { merchantIdInPayPal?: string } = {},
): Promise<PayPalOnboardingView> {
  const lookup = await deps.client.merchantIntegrations.findByTrackingId(deps.partnerId, team.id);
  if (!lookup) {
    // PayPal has no integration for this tracking id yet: the seller has not finished (or declined).
    return viewFor(team, await findPayPalOnboarding(deps.db, team.id));
  }
  if (hint.merchantIdInPayPal && hint.merchantIdInPayPal !== lookup.merchantId) {
    throw new Error(`PayPal's merchant id ${lookup.merchantId} does not match the return parameter.`);
  }
  const status = await deps.client.merchantIntegrations.get(deps.partnerId, lookup.merchantId);
  if (status.trackingId && status.trackingId !== team.id) {
    throw new Error(`PayPal merchant ${lookup.merchantId} belongs to a different tracking id.`);
  }
  const connected = status.paymentsReceivable === true && status.primaryEmailConfirmed === true;
  const row = await savePayPalIntegration(deps.db, {
    teamId: team.id,
    merchantId: lookup.merchantId,
    status: connected ? "connected" : "needs_attention",
    paymentsReceivable: status.paymentsReceivable === true,
    primaryEmailConfirmed: status.primaryEmailConfirmed === true,
    oauthIntegrations: status.oauthIntegrations,
  });
  if (connected && team.paypalMerchantId !== lookup.merchantId) {
    const updated = await markTeamPayPalMerchant(deps.db, { teamId: team.id, merchantId: lookup.merchantId });
    if (updated) await deps.onTeamMerchantChanged?.({ id: team.id, slug: updated.slug });
    return viewFor({ ...team, paypalMerchantId: lookup.merchantId }, row);
  }
  return viewFor(team, row);
}
```

- [ ] **Step 5: Implement the router**

`packages/api/src/routers/paypal.ts`:

```ts
import { hasStoreWideRole, type StoreRecord } from "@jendal-workspace/core";
import { findTeamAccess } from "@jendal-workspace/db/repositories/teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, router } from "../index";
import {
  getPayPalOnboardingView,
  type PayPalOnboardingDeps,
  refreshPayPalOnboarding,
  startPayPalOnboarding,
} from "../paypal/onboarding";

const teamIdInput = z.object({ teamId: z.string().min(1).max(64) });

type AuthedContext = Context & { session: NonNullable<Context["session"]> };

function requirePayPal(ctx: AuthedContext): PayPalOnboardingDeps {
  if (!ctx.paypal) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PayPal is not configured on this server." });
  }
  return { db: ctx.db, ...ctx.paypal };
}

// Connecting PayPal is an admin power (services spec §4.1): the workspace's owners and admins.
// Same leak rule as storeProcedure: a team the caller cannot administer reads as missing.
async function requireTeamAdmin(ctx: AuthedContext, teamId: string): Promise<StoreRecord> {
  const access = await findTeamAccess(ctx.db, { teamId, userId: ctx.session.user.id });
  if (!access || !hasStoreWideRole(access.role)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
  }
  return access.team;
}

export const paypalRouter = router({
  startOnboarding: protectedProcedure.input(teamIdInput).mutation(async ({ ctx, input }) => {
    const team = await requireTeamAdmin(ctx, input.teamId);
    return startPayPalOnboarding(requirePayPal(ctx), team);
  }),

  onboardingStatus: protectedProcedure
    .input(teamIdInput.extend({ refresh: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const team = await requireTeamAdmin(ctx, input.teamId);
      const deps = requirePayPal(ctx);
      return input.refresh ? refreshPayPalOnboarding(deps, team) : getPayPalOnboardingView(deps, team);
    }),
});
```

In `packages/api/src/routers/index.ts`, add the import and register the router:

```ts
import { pingDatabase } from "@jendal-workspace/db/health";

import { publicProcedure, router } from "../index";
import { paypalRouter } from "./paypal";
import { storeRouter } from "./store";

export const appRouter = router({
  healthCheck: publicProcedure.query(async ({ ctx }) => {
    await pingDatabase(ctx.db);
    return "OK";
  }),
  store: storeRouter,
  paypal: paypalRouter,
});
export type AppRouter = typeof appRouter;
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test packages/api && pnpm -F @jendal-workspace/api check-types`
Expected: all pass, including the existing store and health tests; no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api pnpm-lock.yaml
git status --short   # review: only intended files
git commit -m "feat(api): add paypal.startOnboarding and paypal.onboardingStatus" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 5: Return route, services wiring and environment variables

**Files:**
- Create: `apps/server/src/routes/paypal-onboarding.ts`
- Test: `apps/server/src/routes/paypal-onboarding.test.ts`
- Modify: `apps/server/src/services.ts`, `apps/server/src/context.ts`, `apps/server/src/index.ts`, `apps/server/package.json`, `pnpm-lock.yaml`
- Modify: `apps/server/.env.schema`, `packages/infra/.env.schema`, `packages/infra/alchemy.run.ts`, `turbo.json`

PayPal returns the seller's browser to `GET /api/paypal/onboarding/return`. House patterns this task follows: the api Worker is a module-scope Hono app whose middleware sets `db` and `auth` as per-request variables (`apps/server/src/index.ts`), routes read them with `c.get(...)` (`apps/server/src/routes/store-info.ts`), and route tests build a Hono app with fake variables (`apps/server/src/tenant/middleware.test.ts`). `ENV` re-exports `cloudflare:workers` (`apps/server/src/env.server.ts`), which does not resolve under vitest, so everything that touches `ENV` stays in `services.ts` and the route receives `PayPalServices` through a factory.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/routes/paypal-onboarding.test.ts`:

```ts
import type { PayPalServices } from "@jendal-workspace/api/context";
import type { Auth } from "@jendal-workspace/auth";
import type { Database } from "@jendal-workspace/db";
import { createPayPalClient } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse } from "@jendal-workspace/paypal/testing";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../app-env";
import { createPayPalOnboardingRoute } from "./paypal-onboarding";

const teamRow = {
  id: "team-1",
  organizationId: "org-1",
  slug: "acme",
  name: "Acme",
  status: "active",
  paypalMerchantId: null,
};
const session = { user: { id: "user-1" }, session: { id: "session-1" } };
// findTeamAccess returns the team columns plus role and teamMemberId (null = not a team member).
const ownerAccess = { ...teamRow, role: "owner", teamMemberId: null };

// Minimal drizzle query-builder stand-ins: select().from().innerJoin().leftJoin().where().limit()
// for findTeamAccess, insert().values().onConflictDoUpdate().returning() for the integration
// upsert, update().set().where().returning() for markTeamPayPalMerchant.
function fakeDb(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({ innerJoin: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => rows }) }) }) }),
    }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{}] }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ slug: "acme" }] }) }) }),
  };
}

// A fake PayPal API whose tracking lookup and status GET both report a connected seller.
function makePayPal(onTeamMerchantChanged?: PayPalServices["onTeamMerchantChanged"]): PayPalServices {
  const { fetch } = fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.url.includes("/merchant-integrations?tracking_id=")) {
      return jsonResponse(200, { merchant_id: "SELLER1", tracking_id: "team-1" });
    }
    if (request.url.includes("/merchant-integrations/")) {
      return jsonResponse(200, {
        merchant_id: "SELLER1",
        tracking_id: "team-1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_integrations: [],
      });
    }
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
  return {
    client: createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch,
      sleep: () => Promise.resolve(),
    }),
    partnerId: "PARTNER42",
    returnUrl: "http://admin.localhost:3001/api/paypal/onboarding/return",
    onTeamMerchantChanged,
  };
}

function buildApp(options: { session?: unknown; rows?: unknown[]; paypal?: PayPalServices | null } = {}) {
  const auth = { api: { getSession: async () => options.session ?? null } } as unknown as Auth;
  const app = new Hono<AppEnv>();
  app.use(evlog());
  app.use("*", async (c, next) => {
    c.set("db", fakeDb(options.rows ?? [ownerAccess]) as unknown as Database);
    c.set("auth", auth);
    await next();
  });
  const paypal = options.paypal === null ? undefined : (options.paypal ?? makePayPal());
  app.route("/api/paypal/onboarding/return", createPayPalOnboardingRoute(paypal));
  return app;
}

const RETURN = "/api/paypal/onboarding/return?merchantId=team-1&merchantIdInPayPal=SELLER1";

describe("paypal onboarding return route", () => {
  it("redirects to the login page when the request has no session", async () => {
    const res = await buildApp().request(`http://localhost${RETURN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("redirects to the store list when PayPal sends no tracking id", async () => {
    const res = await buildApp({ session }).request(
      "http://localhost/api/paypal/onboarding/return?merchantIdInPayPal=SELLER1",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("answers 404 for a team the caller cannot administer", async () => {
    expect((await buildApp({ session, rows: [] }).request(`http://localhost${RETURN}`)).status).toBe(404);
    const memberRows = [{ ...teamRow, role: "member", teamMemberId: "tm-1" }];
    expect((await buildApp({ session, rows: memberRows }).request(`http://localhost${RETURN}`)).status).toBe(404);
  });

  it("answers 503 when PayPal is not configured", async () => {
    const res = await buildApp({ session, paypal: null }).request(`http://localhost${RETURN}`);
    expect(res.status).toBe(503);
  });

  it("confirms the integration and redirects to the team's dashboard", async () => {
    const onTeamMerchantChanged = vi.fn();
    const app = buildApp({ session, paypal: makePayPal(onTeamMerchantChanged) });

    const res = await app.request(`http://localhost${RETURN}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/acme");
    expect(onTeamMerchantChanged).toHaveBeenCalledWith({ id: "team-1", slug: "acme" });
  });
});
```

Run: `pnpm test apps/server`
Expected: FAIL, the test file cannot import `./paypal-onboarding`.

- [ ] **Step 2: Implement the return route**

`apps/server/src/routes/paypal-onboarding.ts`:

```ts
import type { PayPalServices } from "@jendal-workspace/api/context";
import { refreshPayPalOnboarding } from "@jendal-workspace/api/paypal/onboarding";
import { hasStoreWideRole } from "@jendal-workspace/core";
import { findTeamAccess } from "@jendal-workspace/db/repositories/teams";
import { PayPalError } from "@jendal-workspace/paypal";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

// PayPal returns the seller's browser here (partner_config_override.return_url). The query
// parameters (merchantId = our tracking id = team id, merchantIdInPayPal = the seller account
// id, Fact 6) are hints only: refreshPayPalOnboarding always re-reads the integration from
// PayPal before anything is stored. Redirects stay path-relative: this route is reached on
// the admin host, where "/{slug}" is the team's dashboard and "/" lists the teams.
export function createPayPalOnboardingRoute(paypal: PayPalServices | undefined): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.redirect("/login");

    const teamId = c.req.query("merchantId");
    if (!teamId) return c.redirect("/");

    const access = await findTeamAccess(c.get("db"), { teamId, userId: session.user.id });
    if (!access || !hasStoreWideRole(access.role)) return c.json({ error: "team_not_found" }, 404);
    if (!paypal) return c.json({ error: "paypal_not_configured" }, 503);

    try {
      const view = await refreshPayPalOnboarding({ db: c.get("db"), ...paypal }, access.team, {
        merchantIdInPayPal: c.req.query("merchantIdInPayPal") ?? undefined,
      });
      c.get("log").set({ paypal: { teamId, state: view.state } });
      return c.redirect(`/${access.team.slug}`);
    } catch (error) {
      if (error instanceof PayPalError) {
        c.get("log").error("PayPal onboarding return failed", {
          err: error,
          paypal: { debugId: error.debugId, status: error.status, teamId },
        });
        return c.json({ error: "paypal_confirmation_failed" }, 502);
      }
      throw error;
    }
  });

  return app;
}
```

The redirect target `/{slug}` matches the dashboard URL scheme (`apps/web/src/app/admin/[storeSlug]/` plus host routing, and `create-store-form.tsx` pushing `/${store.slug}`); S1 mounts the services dashboard at the same path, so the route needs no team-type branch.

- [ ] **Step 3: Build `PayPalServices` in services.ts**

Append to `apps/server/src/services.ts`:

```ts
export function getPayPalServices(): PayPalServices | undefined {
  if (!ENV.PAYPAL_PARTNER_MERCHANT_ID || !ENV.PAYPAL_PARTNER_ATTRIBUTION_ID) return undefined;
  const environment: TenantEnvironment = ENV.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";
  return {
    client: createPayPalClient({
      clientId: ENV.PAYPAL_CLIENT_ID,
      clientSecret: ENV.PAYPAL_CLIENT_SECRET,
      environment,
      partnerAttributionId: ENV.PAYPAL_PARTNER_ATTRIBUTION_ID,
      // OAuth tokens ride the shared store-cache KV; dev emulates KV in memory.
      tokenCache: createKvTokenCache(ENV.STORE_CACHE, `paypal-token:${environment}`),
    }),
    partnerId: ENV.PAYPAL_PARTNER_MERCHANT_ID,
    // BETTER_AUTH_URL is the admin origin (apps/server/.env.schema).
    returnUrl: `${ENV.BETTER_AUTH_URL}/api/paypal/onboarding/return`,
    // team.paypal_merchant_id changed: drop the cached storefront lookups (cacheKeyFor in
    // packages/core/src/tenancy/resolve.ts). host: entries cannot be enumerated; they expire
    // within the 300-second TTL.
    onTeamMerchantChanged: async (team) => {
      const cache = createKvStoreCache(ENV.STORE_CACHE);
      await cache.delete(`id:${team.id}`);
      await cache.delete(`slug:${team.slug}`);
    },
  };
}
```

and extend the imports at the top of the file:

```ts
import type { PayPalServices } from "@jendal-workspace/api/context";
import { createAuth as createConfiguredAuth } from "@jendal-workspace/auth";
import type { TenantEnvironment } from "@jendal-workspace/core";
import { type Database, createDb } from "@jendal-workspace/db";
import { createSmtpMailer } from "@jendal-workspace/email";
import { createKvTokenCache, createPayPalClient } from "@jendal-workspace/paypal";
import type { ExecutionContext } from "hono";

import { logEmailError } from "./email-log";
import { ENV } from "./env.server";
import { createKvStoreCache } from "./tenant/kv-store-cache";
```

`ENV.STORE_CACHE` satisfies the client's structural KV types because the real `KVNamespace` has `get(key, "json")` and `put(key, value, { expirationTtl })` (same argument as `kv-store-cache.ts:5`).

- [ ] **Step 4: Pass PayPal through the tRPC context and mount the route**

Replace `apps/server/src/context.ts`:

```ts
import type { Context as ApiContext } from "@jendal-workspace/api/context";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Context as HonoContext } from "hono";

import type { AppEnv } from "./app-env";
import { getPayPalServices } from "./services";

export async function createContext(c: HonoContext<AppEnv>, environment: TenantEnvironment): Promise<ApiContext> {
  const auth = c.get("auth");
  const headers = c.req.raw.headers;
  const session = await auth.api.getSession({ headers });
  return { db: c.get("db"), session, environment, auth, headers, paypal: getPayPalServices() };
}
```

In `apps/server/src/index.ts`, extend the services import and register the route after the `trpcServer` block, before `app.route("/", storeInfoRoute)`:

```ts
import { createPayPalOnboardingRoute } from "./routes/paypal-onboarding";
import { createAuth, getDb, getPayPalServices } from "./services";
```

```ts
app.route("/api/paypal/onboarding/return", createPayPalOnboardingRoute(getPayPalServices()));
```

Registration order is what matters in Hono, and there is no path overlap: `storeInfoRoute` registers only `/api/store` and `/api/store/policy-info`, so mounting the return route before `app.route("/", storeInfoRoute)` is safe.

Add the dependency:

```bash
pnpm -F server add "@jendal-workspace/paypal@workspace:*"
```

Expected: `apps/server/package.json` lists `"@jendal-workspace/paypal": "workspace:*"`.

- [ ] **Step 5: Run the tests**

Run: `pnpm test apps/server`
Expected: all pass, including the existing middleware, kv-cache and email-log tests.

- [ ] **Step 6: Declare the two new environment variables**

`apps/server/.env.schema` already declares `PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (`:30-36`). Append:

```dotenv
# Partner merchant account ID that issues referrals, and the partner attribution (BN) code.
# Optional: without them the PayPal endpoints answer PRECONDITION_FAILED / 503.
# @required=false @type=string
PAYPAL_PARTNER_MERCHANT_ID=

# @required=false @type=string
PAYPAL_PARTNER_ATTRIBUTION_ID=
```

`packages/infra/.env.schema` imports its variables from `apps/server` with a `pick=[...]` list (`:1`); add both names to that list.

In `packages/infra/alchemy.run.ts`, extend the `server` worker's `env` block after `PAYPAL_CLIENT_SECRET`:

```ts
    PAYPAL_PARTNER_MERCHANT_ID: Config.String("PAYPAL_PARTNER_MERCHANT_ID").pipe(Config.withDefault("")),
    PAYPAL_PARTNER_ATTRIBUTION_ID: Config.String("PAYPAL_PARTNER_ATTRIBUTION_ID").pipe(Config.withDefault("")),
```

`withDefault("")` binds nothing when the variable is unset, so the Worker sees `""` and `getPayPalServices` treats PayPal as unconfigured (alchemy docs, `refs/stack/alchemy/website/src/content/docs/environments/secrets.mdx` "Transformations").

In `turbo.json`, add both names to `globalEnv` (alphabetical, after `PAYPAL_ENVIRONMENT`).

**Stop and ask** if the live PayPal partner credentials are not yet available — do not invent values. The code handles their absence, so the workstream finishes without them; the sandbox check (Task 7) needs the sandbox set.

- [ ] **Step 7: Regenerate env types and check**

Run: `pnpm env:generate && pnpm check-types && pnpm test`
Expected: no type errors; the generated `apps/server/src/env.ts` includes the two optional keys; the whole workspace test run passes.

- [ ] **Step 8: Commit**

```bash
git add apps/server packages/infra turbo.json pnpm-lock.yaml
git status --short   # review: only intended files
git commit -m "feat(server): wire the PayPal onboarding return route and credentials" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 6: "Connect PayPal" card on the dashboard

**Files:**
- Create: `apps/web/src/lib/paypal-status.ts`
- Test: `apps/web/src/lib/paypal-status.test.ts`
- Create: `apps/web/src/components/paypal-connect-card.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`

The card is keyed by `teamId` (never `product`), so S1 mounts the same component unchanged on the services dashboard. The state-to-copy mapping lives in a pure function in `lib/` — the existing web tests happen to live in `lib/` too, and a pure mapper is testable without a React renderer; same pattern as `slug-status.ts`. Resume reopens the stored PayPal action URL, which expires after one use (Fact 6), so the pending and needs-attention states also offer "Start over", which runs `startOnboarding` again for a fresh referral link.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/paypal-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { type PayPalConnection, payPalCardModel } from "./paypal-status";

const base: PayPalConnection = {
  state: "not_connected",
  merchantId: null,
  actionUrl: null,
  paymentsReceivable: null,
  primaryEmailConfirmed: null,
};

describe("payPalCardModel", () => {
  it("offers the connect action before onboarding starts", () => {
    expect(payPalCardModel(base)).toEqual({
      tone: "muted",
      title: "Not connected",
      detail: "Connect PayPal so this store can accept payments.",
      action: "connect",
      actionLabel: "Connect PayPal",
    });
  });

  it("resumes the PayPal flow while the referral is pending", () => {
    const model = payPalCardModel({ ...base, state: "pending", actionUrl: "https://paypal.example/abc" });
    expect(model.action).toBe("resume");
    expect(model.actionLabel).toBe("Continue PayPal setup");
  });

  it("falls back to a status check when the action URL is gone", () => {
    const model = payPalCardModel({ ...base, state: "pending" });
    expect(model.action).toBe("refresh");
  });

  it("names the missing pieces when PayPal has not cleared the account", () => {
    const model = payPalCardModel({
      ...base,
      state: "needs_attention",
      actionUrl: "https://paypal.example/abc",
      merchantId: "SELLER1",
      paymentsReceivable: false,
      primaryEmailConfirmed: false,
    });
    expect(model.tone).toBe("problem");
    expect(model.detail).toContain("receive payments");
    expect(model.detail).toContain("email address");
    expect(model.action).toBe("resume");
    expect(model.actionLabel).toBe("Reopen PayPal setup");
  });

  it("says the account is under review when both flags are already true", () => {
    const model = payPalCardModel({
      ...base,
      state: "needs_attention",
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
    });
    expect(model.detail).toContain("reviewing");
    expect(model.action).toBe("refresh");
  });

  it("shows the connected account and no action", () => {
    const model = payPalCardModel({
      ...base,
      state: "connected",
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
    });
    expect(model.tone).toBe("success");
    expect(model.detail).toContain("SELLER1");
    expect(model.action).toBeNull();
  });
});
```

Run: `pnpm test apps/web`
Expected: FAIL, the test file cannot import `./paypal-status`.

- [ ] **Step 2: Implement the mapper**

`apps/web/src/lib/paypal-status.ts`:

```ts
// The view shape returned by trpc.paypal.onboardingStatus (Task 4). Declared here so the
// web app does not import packages/api internals.
export type PayPalConnection = {
  state: "not_connected" | "pending" | "connected" | "needs_attention";
  merchantId: string | null;
  actionUrl: string | null;
  paymentsReceivable: boolean | null;
  primaryEmailConfirmed: boolean | null;
};

export type PayPalCardModel = {
  tone: "muted" | "success" | "problem";
  title: string;
  detail: string;
  // connect = run startOnboarding; resume = open the stored PayPal action URL; refresh = re-read PayPal.
  action: "connect" | "resume" | "refresh" | null;
  actionLabel: string;
};

function attentionDetail(connection: PayPalConnection): string {
  const missing: string[] = [];
  if (connection.paymentsReceivable === false) {
    missing.push("PayPal has not cleared the account to receive payments yet");
  }
  if (connection.primaryEmailConfirmed === false) {
    missing.push("the PayPal account email address is not confirmed");
  }
  if (missing.length === 0) return "PayPal is still reviewing the account. Check back later.";
  return `${missing.join(" and ")}. Reopen the PayPal setup or check back later.`;
}

export function payPalCardModel(connection: PayPalConnection): PayPalCardModel {
  switch (connection.state) {
    case "connected":
      return {
        tone: "success",
        title: "Connected",
        detail: `Payments are paid out to PayPal account ${connection.merchantId}.`,
        action: null,
        actionLabel: "",
      };
    case "pending":
      return {
        tone: "muted",
        title: "Connection in progress",
        detail: "Finish the PayPal sign-up to start accepting payments.",
        action: connection.actionUrl ? "resume" : "refresh",
        actionLabel: connection.actionUrl ? "Continue PayPal setup" : "Check status",
      };
    case "needs_attention":
      return {
        tone: "problem",
        title: "PayPal needs attention",
        detail: attentionDetail(connection),
        action: connection.actionUrl ? "resume" : "refresh",
        actionLabel: connection.actionUrl ? "Reopen PayPal setup" : "Check status again",
      };
    case "not_connected":
      return {
        tone: "muted",
        title: "Not connected",
        detail: "Connect PayPal so this store can accept payments.",
        action: "connect",
        actionLabel: "Connect PayPal",
      };
  }
}
```

Run: `pnpm test apps/web`
Expected: PASS.

- [ ] **Step 3: Implement the card**

`apps/web/src/components/paypal-connect-card.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@jendal-workspace/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { payPalCardModel } from "@/lib/paypal-status";
import { trpc } from "@/utils/trpc";

const TONE_CLASS = {
  muted: "text-muted-foreground",
  success: "text-emerald-700 dark:text-emerald-400",
  problem: "text-destructive",
} as const;

// Generic PayPal connection card, keyed by team id: the store dashboard mounts it, and S1
// mounts the same component on the services dashboard without changes.
export default function PayPalConnectCard({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const status = useQuery({ ...trpc.paypal.onboardingStatus.queryOptions({ teamId, refresh: false }), retry: false });
  // A disabled query fired manually: re-reads the integration from PayPal on demand.
  const recheck = useQuery({
    ...trpc.paypal.onboardingStatus.queryOptions({ teamId, refresh: true }),
    enabled: false,
    retry: false,
  });
  const start = useMutation(
    trpc.paypal.startOnboarding.mutationOptions({
      onSuccess: ({ actionUrl }) => window.location.assign(actionUrl),
    }),
  );

  // Hide the card when PayPal is not configured (PRECONDITION_FAILED) or the query failed:
  // the dashboard's detail row still shows the raw connection state.
  if (status.isPending || status.isError) return null;

  const model = payPalCardModel(status.data);

  async function handleRecheck() {
    const result = await recheck.refetch();
    if (result.data) {
      queryClient.setQueryData(trpc.paypal.onboardingStatus.queryKey({ teamId, refresh: false }), result.data);
      // team.paypal_merchant_id may have changed: refresh whatever shows the team record.
      await queryClient.invalidateQueries({ queryKey: [["store"]] });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>PayPal payments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-sm font-medium ${TONE_CLASS[model.tone]}`}>{model.title}</p>
        <p className="text-sm text-muted-foreground">{model.detail}</p>
        {model.action === "connect" && (
          <Button onClick={() => start.mutate({ teamId })} disabled={start.isPending}>
            {start.isPending ? "Opening PayPal…" : model.actionLabel}
          </Button>
        )}
        {model.action === "resume" && status.data.actionUrl && (
          <div className="flex gap-2">
            <Button render={<a href={status.data.actionUrl} />}>{model.actionLabel}</Button>
            {/* The stored action_url expires after one use (Fact 6); "Start over" mints a fresh
                referral and its onSuccess navigates straight to the new PayPal link. */}
            <Button variant="outline" onClick={() => start.mutate({ teamId })} disabled={start.isPending}>
              {start.isPending ? "Opening PayPal…" : "Start over"}
            </Button>
          </div>
        )}
        {model.action === "refresh" && (
          <Button variant="outline" onClick={handleRecheck} disabled={recheck.isFetching}>
            {recheck.isFetching ? "Checking…" : model.actionLabel}
          </Button>
        )}
        {start.isError && (
          <p className="text-sm text-destructive" role="alert">
            {start.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Mount the card on the store dashboard**

In `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`, add the import:

```tsx
import Loader from "@/components/loader";
import PayPalConnectCard from "@/components/paypal-connect-card";
import SetupChecklist from "@/components/setup-checklist";
```

and mount the card between the checklist and the details list:

```tsx
      <SetupChecklist steps={setupSteps(store.data, { storefrontUrl: url })} />
      <PayPalConnectCard teamId={store.data.id} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
```

- [ ] **Step 5: Run checks and walk through the dev app**

Run: `pnpm test apps/web && pnpm -F web check-types`
Expected: all pass (the exact package name for the filter is in `apps/web/package.json` — use `pnpm check-types` from the repo root if unsure).

Manual check: `pnpm dev`, sign in at `http://admin.localhost:3001`, open a store dashboard. Without the partner credentials the card stays hidden (the status query fails with PRECONDITION_FAILED and the detail row still shows "Not connected"). With credentials (Task 7), the full flow runs.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git status --short   # review: only intended files
git commit -m "feat(web): add the Connect PayPal card to the store dashboard" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 7: Sandbox end-to-end check

**Files:** none (verification only; if the sandbox run exposes a wrong assumption, fix the code in Tasks 1–6, extend the failing test first, and record the change in "Changes made during execution").

This is the acceptance check for contract §4.4. It needs a PayPal sandbox partner setup; if none exists yet, create it now (research.md R§4: developer account → sandbox business account that acts as the partner → REST app with "Connect with PayPal" / partner referrals enabled → a second sandbox business account that plays the seller).

- [ ] **Step 1: Configure the sandbox credentials**

In `apps/server/.env` (gitignored — never commit it; confirm with `git status --ignored` that the file is ignored), set:

```dotenv
PAYPAL_CLIENT_ID=<sandbox REST app client id>
PAYPAL_CLIENT_SECRET=<sandbox REST app secret>
PAYPAL_PARTNER_MERCHANT_ID=<sandbox partner account's merchant id>
PAYPAL_PARTNER_ATTRIBUTION_ID=<sandbox BN code, or any descriptive code for sandbox>
```

**Stop and ask** if the sandbox partner account or REST app does not exist and cannot be created — do not substitute production credentials.

- [ ] **Step 2: Run the happy path**

1. `pnpm dev`, sign in at `http://admin.localhost:3001` (the dev admin origin, `apps/server/.env.schema:14-15`), open a store's dashboard.
2. Click "Connect PayPal". The browser must land on `www.sandbox.paypal.com` with the signup flow (the `action_url`). If it lands on an error page, check the api Worker's log for the `debug_id` (Fact 1) and look it up in the PayPal dashboard.
3. Log in with the sandbox **seller** business account and approve the consent.
4. PayPal redirects back to `http://admin.localhost:3001/api/paypal/onboarding/return?merchantId=<team id>&merchantIdInPayPal=<seller id>&…`, and the route redirects to `/<slug>`.
5. The card shows "Connected" and the details list shows the sandbox seller merchant id.
6. Verify the database: `psql "$DATABASE_URL" -c 'select team_id, status, merchant_id, payments_receivable, primary_email_confirmed from paypal_onboarding'` shows `connected` / `t` / `t`, and `select paypal_merchant_id from team where id = '<team id>'` matches.

- [ ] **Step 3: Verify the tracking-lookup response against the real API**

The one shape this plan could not verify from `refs/paypal` is the response envelope of `GET /v1/customer/partners/{id}/merchant-integrations?tracking_id=…` (Fact 5: the operation is absent from the vendored OpenAPI specs; the plan assumes `{ "merchant_id", "tracking_id" }` at the top level and a 404 when unknown). With the sandbox integration from Step 2 in place, run from the api Worker's environment (or with `curl` and a token from the sandbox app):

```bash
TOKEN=$(curl -s -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
  -d grant_type=client_credentials https://api-m.sandbox.paypal.com/v1/oauth2/token | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api-m.sandbox.paypal.com/v1/customer/partners/$PAYPAL_PARTNER_MERCHANT_ID/merchant-integrations?tracking_id=<team id>"
```

If the response wraps the fields differently (for example `{ "merchant_integration": { … } }`), add a failing test in `packages/paypal/src/merchant-integrations.test.ts` reproducing the real envelope, fix `parseMerchantIntegration`/`findByTrackingId`, and record the change below. Also confirm an unknown tracking id really answers 404 and not 200 with an empty body.

- [ ] **Step 4: Run the decline path**

1. Open a second store's dashboard, click "Connect PayPal".
2. On the PayPal consent screen, cancel / decline.
3. PayPal returns to the return route with `permissionsGranted=false`; the dashboard card must show "Connection in progress" with "Continue PayPal setup" (the stored action URL) or "Not connected", and `team.paypal_merchant_id` must stay null.

- [ ] **Step 5: Record the outcome**

Append to the "Changes made during execution" section: the sandbox merchant ids used, the confirmed tracking-lookup envelope, and any fixes from Step 3. If everything matched the plan, one line stating that is enough.

---

## Task 8: Rebase, regenerate migrations, full check, merge

**Files:** none (operational).

- [ ] **Step 1: Rebase onto main**

From the worktree:

```bash
git fetch origin main 2>/dev/null || true   # main may be local-only
git -C /home/mouhamed/dev/repos/jendal/jendal-workspace log --oneline -3   # confirm where main is
git rebase main
```

Expected conflicts, per the parallel execution doc: `packages/db/src/testing/db.ts` (S1 also extends the truncate list — keep both tables), `packages/db/src/migrations/` (snapshot chain — resolved in Step 2), possibly `turbo.json` (union of the two globalEnv lists) and `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx` (keep both edits). Never drop another workstream's changes while resolving.

- [ ] **Step 2: Regenerate the migration on top of main**

Per §1.5 of the parallel execution doc: after rebasing, delete this branch's generated migration folder (`packages/db/src/migrations/<timestamp>_s3_paypal_onboarding/`) and regenerate it so its snapshot chains onto whatever main now has:

```bash
# only this workstream's generated folder, created by Task 3 on this branch
ls packages/db/src/migrations/ | grep s3_paypal_onboarding   # confirm exactly one match
rm -r packages/db/src/migrations/*_s3_paypal_onboarding
pnpm -F @jendal-workspace/db exec drizzle-kit generate --name s3_paypal_onboarding
pnpm test packages/db   # global setup rebuilds the test database from the new chain
```

Then fold the regenerated migration into the Task 3 commit instead of adding a separate commit. Non-interactive autosquash (a no-op sequence editor accepts the todo list that `--autosquash` generates):

```bash
SHA=$(git log --format=%H --grep="paypal_onboarding table" -1)
git add packages/db/src/migrations
git commit --fixup "$SHA"
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash "$SHA^"
```

If the rebase turns messy, a plain `fix(db): regenerate s3 migration after rebase` commit is acceptable instead — say so in the merge commit message.

- [ ] **Step 3: Full verification**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm check-types
```

Expected: every workspace passes. If S1 or S2 merged in the meantime and broke a shared seam (for example `truncateAll` or the store dashboard), fix on this branch with a new commit and record it below.

- [ ] **Step 4: Merge into main**

In the main worktree (`/home/mouhamed/dev/repos/jendal/jendal-workspace`, checked out on `main`):

```bash
git merge --no-ff s3-paypal-onboarding -m "Merge branch 's3-paypal-onboarding': PayPal client and partner onboarding" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

No push — pushing is a separate, explicit decision.

- [ ] **Step 5: Clean up**

```bash
git worktree remove /home/mouhamed/dev/repos/jendal/worktrees/s3-paypal-onboarding
git branch -d s3-paypal-onboarding
```

---

## Decisions made while planning

| Decision | Rationale |
| --- | --- |
| Own fetch-based client in `packages/paypal`, no PayPal SDK | research.md R§12.3: the official server SDK is deprecated; the multiparty surface we need is three endpoints. |
| `FetchLike = (request: Request) => Promise<Response>` | node and workerd type definitions conflict when `fetch` is passed directly; a structural function type accepts both (verified against packages/email's Resend usage). |
| Return route at `/api/paypal/onboarding/return`, not the spec's `admin.payleor.app/{storeSlug}/paypal/return` | The web Worker only forwards `/api/*` and `/trpc/*` to the api Worker (apps/web AGENTS.md); contract §4.4 asks only for a "return page", so the plan defines the path as `GET /api/paypal/onboarding/return` on the api Worker. The team is identified by PayPal's `merchantId` (= our tracking id = team id), not by a slug in the path. |
| Table name `paypal_onboarding`, not the spec's `paypal_connections` | Task and contract name; one row per team, keyed by `team_id`, with `tracking_id` unique. |
| `tracking_id` = team ID | Stable, already unique, works for store and services teams; PayPal echoes it back as `merchantId` on the return URL. |
| Return URL parameters are never trusted | The integration is re-read from PayPal (`refreshPayPalOnboarding`) and the hinted merchant id must match the tracking-id lookup before anything is written. |
| `team.paypal_merchant_id` written only when `payments_receivable && primary_email_confirmed` | Matches the platform spec §5 readiness rule and keeps the existing dashboard row truthful. |
| Exactly the two contract env vars are new | `PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` already exist in `apps/server/.env.schema`, `turbo.json` and `packages/infra/alchemy.run.ts` (`:30-36`); only `PAYPAL_PARTNER_MERCHANT_ID` and `PAYPAL_PARTNER_ATTRIBUTION_ID` are added, both optional — the router answers PRECONDITION_FAILED and the card hides while unset. |
| OAuth token cache reuses the `STORE_CACHE` KV binding | No new binding or alchemy change; dev's in-memory map emulates KV, so local dev works as-is. Key `paypal-token:{environment}` keeps environments separate. |
| `paypal` on the tRPC `Context` is optional | Keeps existing api tests compiling unchanged and models "PayPal not configured" as data, not a missing dependency. |
| Authorization = organization owner/admin (`hasStoreWideRole`) via a new `findTeamAccess` | services spec §4.1 calls connecting PayPal an admin power; team id keying (not slug) makes it reusable for services teams. Same NOT_FOUND-on-denied leak rule as `storeProcedure`. |
| Facts 5–7 sourced from live developer.paypal.com docs, not the vendored spec | The merchant-integrations spec named in the work order is absent from `refs/paypal/.../openapi/` (verified by listing). refs/AGENTS.md gives live PayPal docs top precedence. Task 7 Step 3 re-verifies the one unverifiable shape (tracking-lookup envelope) against sandbox. |
| No `d.transaction` around the two-write refresh | Both upserts are idempotent; the only failure mode is a crash between them, which the next refresh heals. |
| Migration regenerated at merge time with delete + regenerate + fixup | The snapshot must chain onto main's migrations (parallel execution doc §1.5); `git commit --fixup` + `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash` folds it into the Task 3 commit non-interactively. |
| Card hides on query error instead of showing an error state | Without PayPal credentials (every dev machine today) the dashboard must not sprout a permanent error card; the global query cache already toasts once. |
| The return route receives `PayPalServices` through a factory instead of reading `ENV` itself | `apps/server/src/env.server.ts` re-exports `cloudflare:workers`, which does not resolve under vitest; only `services.ts` touches `ENV`, and route tests inject fakes the way `tenant/middleware.test.ts` does. |

## Changes made during execution

| Date | Change | Why |
| --- | --- | --- |
| (fill in while executing) | | |

## Self-review before handoff

- [ ] Every task's code blocks are complete files or complete, unambiguous edits — no `...` placeholders.
- [ ] Every commit step uses the exact trailer `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`.
- [ ] Contract §4.4 items all appear: `packages/paypal` client (Tasks 1–2), `paypal_onboarding` table + `team.paypal_merchant_id` write (Task 3), `paypal.startOnboarding`/`paypal.onboardingStatus` (Task 4), `GET /api/paypal/onboarding/return` (Task 5), generic card keyed by team id on the store dashboard (Task 6), env vars through `.env.schema`/`alchemy.run.ts`/`turbo.json` with a stop-and-ask (Task 5), sandbox check (Task 7).
- [ ] No reference to `team.product` anywhere (that column belongs to S1); grep the branch for `product` before merging.
- [ ] `pnpm test` and `pnpm check-types` pass on the final rebased branch (Task 8 Step 3).
