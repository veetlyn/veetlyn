# W1-D: Public Site, Auth, Onboarding and Legal Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant lands on `payleor.app`, reads what Payleor does and costs, signs up with email (verified by a real email) or PayPal, creates a store in one form, and lands on the store dashboard with a setup checklist. The platform has its Terms, Privacy Policy and Acceptable Use Policy; every store has four default policies; every page shows the sandbox banner.

**Architecture:** Pure rules go into `@jendal-workspace/core` (plans and `planFor`, `suggestStoreSlug`, `setupSteps`, `storePolicyUrls`). A new `@jendal-workspace/email` package holds the `Mailer` port, an SMTP adapter (`@opencoredev/email-sdk`), a fake mailer and two templates. `createAuth` takes a mailer and `waitUntil`, turns on required email verification, password reset, database-backed rate limits and terms acceptance. The tRPC context gains `auth` and the request headers so `store.create` can create the organization and the store through Better Auth. The web app gets a `(site)` route tree (landing, pricing, MDX legal pages), new admin auth pages, `/new`, a checklist on the dashboard, and store policy pages.

**Tech Stack:** Better Auth 1.7.7, `@opencoredev/email-sdk` 2.0.0 (SMTP over Nodemailer, port 587 STARTTLS), Drizzle ORM 1.0.0-rc.4, tRPC 11, Hono 4.13, vinext 1.0.1 with `@mdx-js/rollup`, React 19, TanStack Query 5, Tailwind 4, Vitest 5, Alchemy 2.0.0-beta.80 with Effect 4 `Config`, varlock, evlog.

**Spec:** [`../2026-10-04-public-site-auth-onboarding-design.md`](../2026-10-04-public-site-auth-onboarding-design.md) (all sections). Pricing: parent spec §6.7.

**Builds on:** W1-A (all tasks done, branch `w1a-foundations`, last commit `c63d5bd`).

**Out of scope (later plans):** see spec §11, plus:
- W1-B adds the "Connect PayPal" link to `setupSteps`.
- The checkout plan renders `<SandboxBanner variant="checkout" />` on checkout pages (this plan builds the variant).
- The billing plan (Nov 2–8) makes `planFor` read the store's subscription and adds the Billing page.
- W1-C makes `supportEmail` and shipping rates editable.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/jendal-workspace` (its own git repository).

**Library sources:** read the pinned clones in `/home/mouhamed/dev/repos/jendal/refs/stack/` (read-only). Load the matching skill before each task:

| Task | Skills |
|---|---|
| 1–3 | `vitest`, `test-driven-development` |
| 4 | `vitest` |
| 5 | `drizzle-orm` |
| 6, 7 | `better-auth-best-practices`, `email-and-password-best-practices`, `organization-best-practices` |
| 8 | `workers-best-practices`, `effect-ts`, `varlock`, `review-logging-patterns` |
| 9–15 | `migrate-to-vinext`, `better-writing`, `better-accessibility` |
| 13 | also `frontend-design` or `hallmark` for the landing visuals |
| 16 | `verification-before-completion` |

---

## Facts this plan relies on

Each was checked against the pinned sources on 2026-10-05. If code fails in a way that contradicts one of them, re-read the cited file before changing the design.

1. **Rate limit table.** With `rateLimit.storage: "database"`, Better Auth adds the model `rateLimit` with `key` (string, unique), `count` (number) and `lastRequest` (number, `bigint: true`) (`refs/stack/better-auth/packages/core/src/db/get-tables.ts:59-84`). The Drizzle adapter finds it by the schema export key `rateLimit`.
2. **Rate limiter behaviour** (`packages/better-auth/src/api/rate-limiter/index.ts:345-470`).
   - It runs only inside `auth.handler` (HTTP), never for `auth.api.*` calls. Tests must send real `Request`s.
   - The path is relative to the base path: `/sign-in/email`, `/request-password-reset`.
   - `customRules` are applied after the built-in special rules, so ours win. Keys match exactly unless they contain `*`.
   - Without a client IP it falls back to one shared bucket per path. `advanced.ipAddress.ipAddressHeaders` picks the header (`packages/core/src/types/init-options.ts:296-311`).
   - Rate limiting is off by default outside production (`init-options.ts:256-259`), so we set `enabled: true`.
   - A blocked request gets status 429 and an `X-Retry-After` header.
3. **Background tasks.** `advanced.backgroundTasks.handler` receives promises that should finish after the response; on Workers it is `ctx.waitUntil` (`init-options.ts:505-526`).
4. **Verification emails.**
   - Sign-up sends one when `emailVerification.sendOnSignUp` is true. The link is `${baseURL}/verify-email?token=…&callbackURL=…`; `callbackURL` comes from the request body and defaults to `/` (`packages/better-auth/src/api/routes/sign-up.ts:381-400`). The client therefore passes `callbackURL: "/new"`.
   - With `requireEmailVerification`, an unverified email sign-in throws `FORBIDDEN` with code `EMAIL_NOT_VERIFIED`, after sending a fresh link when `sendOnSignIn` is true (`sign-in.ts:572-600`).
   - With `requireEmailVerification`, `signUpEmail` returns `token: null` and sets no session cookie.
   - `baseURL` here includes `/api/auth`.
5. **Password reset** (`packages/better-auth/src/api/routes/password.ts`).
   - `requestPasswordReset({ email, redirectTo })` emails `${baseURL}/reset-password/{token}?callbackURL={redirectTo}` (lines 39-150).
   - Opening that link redirects to `{redirectTo}?token={token}`, or to `{redirectTo}?error=INVALID_TOKEN` (lines 156-230).
   - `resetPassword({ newPassword, token })` throws `BAD_REQUEST` `INVALID_TOKEN` for a bad token and deletes the user's sessions when `revokeSessionsOnPasswordReset` is true (lines 233-330).
6. **Team hook input.** `beforeCreateTeam` receives `{ team, user: session?.user, organization }`, and its returned `data` is merged into the new team (`packages/better-auth/src/plugins/organization/routes/crud-team.ts:183-203`; type in `types.ts:678-688`).
7. **User create hook.** `databaseHooks.user.create.before` may return `{ data }`, which is merged into the user being created (`packages/better-auth/src/db/with-hooks.ts:41-73`). It runs for email sign-up and for social sign-in.
8. **email-sdk** (`refs/stack/email-sdk/packages/email-sdk/`).
   - `createEmailClient({ adapters, telemetry: false })` (`src/core.ts:60-100`); `client.send({ from, to, subject, text, html })` (`src/types.ts:265-280`).
   - `smtp({ host, port, secure, auth })` from `@opencoredev/email-sdk/smtp`; `secure` defaults to `port === 465`, and `requireTLS` defaults to true when `auth` is set, so port 587 uses STARTTLS (`src/smtp.ts:15-71`).
   - `from` may be a string such as `"Payleor <no-reply@payleor.app>"` (`src/types.ts:5-10`).
9. **MDX in vinext.** vinext injects `@mdx-js/rollup` on demand for any `.mdx` module that enters the graph, including MDX outside `app/` (`refs/stack/vinext/packages/vinext/src/index.ts:2044-2120`). Installing `@mdx-js/rollup` is enough; no `vite.config.ts` change.
10. **Hono wildcard.** `app.use("/api/store/*", …)` also matches `/api/store` (`refs/stack/hono/src/router/common.case.test.ts:174-187`).
11. **Effect config defaults.** `Config.String("X").pipe(Config.withDefault("587"))` uses the default when the variable is missing (`effect/dist/Config.d.ts`, `withDefault`).
12. **evlog.** `log.error({ … })` from `evlog` emits a wide event with the given fields (`refs/stack/evlog/packages/evlog/src/logger.ts:821-837`).
13. **tRPC over HTTP.** A query without input answers `GET /trpc/store.listMine` with `{"result":{"data":…}}` (seen in the W1-A deploy smoke test for `healthCheck`).
14. **Sign-in redirects.** Email sign-in answers `redirect: !!callbackURL` (`packages/better-auth/src/api/routes/sign-in.ts:633`), and the client then sets `window.location.href` to it (`packages/better-auth/src/client/fetch-plugins.ts:17`). So the sign-in form sends **no** `callbackURL`. The fresh verification link sent on an unverified sign-in then returns to `/`, which redirects a user without stores to `/new`. Sign-up and "Send a new link" pass `callbackURL: "/new"`; sign-up does not redirect.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/core/src/billing/plans.ts` (+test) | Create | Plan catalog, `planFor`, price and fee formatting |
| `packages/core/src/tenancy/slug.ts` (+test) | Modify | `suggestStoreSlug`, `storeSlugProblem` |
| `packages/core/src/onboarding/setup-steps.ts` (+test) | Create | `setupSteps`, `countDone` |
| `packages/core/src/policies/store-policies.ts` (+test) | Create | Policy names, `isStorePolicy`, `storePolicyUrls` |
| `packages/core/src/index.ts` | Modify | Exports |
| `packages/email/**` | Create | `Mailer` port, SMTP adapter, fake mailer, templates |
| `packages/db/src/schema/auth.ts`, `organization.ts` | Modify | `rate_limit`, `user.accepted_terms_at`, `team.support_email` |
| `packages/db/src/migrations/<ts>_w1d_auth_email/` | Generate | Migration |
| `packages/db/src/testing/db.ts` | Modify | Truncate `rate_limit` |
| `packages/db/src/repositories/stores.ts` (+test) | Modify | `findStorePolicyInfo` |
| `packages/auth/src/index.ts` (+test) | Modify | Verification, reset, rate limits, terms, `supportEmail` |
| `packages/auth/src/testing.ts` | Create | `createTestAuth`, `signUpVerified`, `cookieHeaders` |
| `packages/api/src/context.ts` | Modify | `auth` and `headers` in the context |
| `packages/api/src/routers/store.ts` (+test) | Modify | `store.checkSlug`, `store.create` |
| `apps/server/src/email-log.ts` (+test) | Create | Hashed-recipient email error logging |
| `apps/server/src/services.ts`, `index.ts`, `context.ts`, `routes/store-info.ts` | Modify | Mailer wiring, context, `/api/store/policy-info` |
| `apps/server/.env.schema`, `packages/infra/.env.schema`, `packages/infra/alchemy.run.ts`, `turbo.json` | Modify | SMTP, sandbox and demo settings |
| `apps/web/src/lib/{platform-url,sandbox-banner,auth-flow,slug-status,legal-date}.ts` (+tests) | Create | Pure web helpers |
| `apps/web/src/lib/use-debounced-value.ts` | Create | Debounce hook |
| `apps/web/src/lib/server-api.ts` | Modify | Session, origins, store list, policy info |
| `apps/web/src/components/sandbox-banner.tsx` | Create | Banner |
| `apps/web/src/app/layout.tsx`, `app/admin/layout.tsx` | Modify | Banner placement, flex layout |
| `apps/web/src/app/admin/(auth)/**`, `components/auth/**` | Create | Auth pages and forms |
| `apps/web/src/app/admin/login/page.tsx`, `components/sign-in-form.tsx`, `components/sign-up-form.tsx` | Delete | Replaced by `(auth)` pages and `components/auth/*` |
| `apps/web/src/components/paypal-sign-in-button.tsx` | Modify | Label prop |
| `apps/web/src/app/admin/new/**` | Create | "Create your store" |
| `apps/web/src/app/admin/page.tsx` | Modify | Store list, redirect to `/new` |
| `apps/web/src/app/admin/stores-overview.tsx`, `components/create-organization-form.tsx`, `components/create-store-form.tsx` | Delete | Replaced by `/new` |
| `apps/web/src/components/setup-checklist.tsx`, `app/admin/[storeSlug]/store-dashboard.tsx` | Create, Modify | Checklist |
| `apps/web/src/app/(site)/**`, `components/site/**` | Create | Landing, pricing, header, footer, legal routes |
| `apps/web/src/app/page.tsx` | Delete | Scaffold page |
| `apps/web/src/content/legal/*.mdx`, `meta.ts`, `components/legal/**` | Create | Legal text and layout |
| `apps/web/src/content/store-policies/**`, `app/store/policies/[policy]/page.tsx`, `app/store/layout.tsx` | Create | Store policies and storefront footer |

---

## Task 0: Branch and dependencies

**Files:**
- Modify: `packages/auth/package.json`, `packages/api/package.json`, `apps/server/package.json`, `apps/web/package.json`, `apps/web/tsconfig.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Create the branch**

```bash
git status --short   # must be empty
git checkout -b w1d-public-site-auth
```

- [ ] **Step 2: Add web MDX packages**

```bash
pnpm -F web add -D @mdx-js/rollup @types/mdx
```

In `apps/web/tsconfig.json`, add `"mdx"` to `compilerOptions.types`:

```json
    "types": ["vinext/types", "@cloudflare/workers-types", "mdx"]
```

- [ ] **Step 3: Add Better Auth to the api package**

```bash
pnpm -F @jendal-workspace/api add better-auth@catalog:
```

Expected: `packages/api/package.json` lists `"better-auth": "catalog:"`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json packages/api/package.json pnpm-lock.yaml
git commit -m "chore: add MDX and Better Auth dependencies for W1-D" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 1: Plan catalog and `planFor` in core

**Files:**
- Create: `packages/core/src/billing/plans.ts`
- Test: `packages/core/src/billing/plans.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/billing/plans.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatOrderFee, formatPlanPrice, getPlan, PLANS, planFor, TRIAL_DAYS } from "./plans";

describe("plans", () => {
  it("lists Starter, Grow and Scale with the prices and fees of parent spec §6.7", () => {
    expect(PLANS.map((p) => [p.id, p.priceCents.monthly, p.priceCents.yearly, p.orderFeeBps])).toEqual([
      ["starter", 1200, 900, 200],
      ["grow", 3900, 2900, 100],
      ["scale", 12900, 9900, 50],
    ]);
  });

  it("raises the limits on higher plans", () => {
    expect(PLANS.map((p) => [p.staffSeats, p.customDomain, p.adminAgent, p.disputeAgent])).toEqual([
      [2, false, false, false],
      [5, true, true, true],
      [15, true, true, true],
    ]);
  });

  it("has a 14-day trial", () => {
    expect(TRIAL_DAYS).toBe(14);
  });

  it("puts every store on Starter until billing ships", () => {
    expect(planFor({ id: "store-1" })).toBe(getPlan("starter"));
  });

  it("formats fees and prices for display", () => {
    expect(formatOrderFee(200)).toBe("2%");
    expect(formatOrderFee(50)).toBe("0.5%");
    expect(formatPlanPrice(1200)).toBe("$12");
    expect(formatPlanPrice(108_00)).toBe("$108");
    expect(formatPlanPrice(1250)).toBe("$12.50");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/core/src/billing/plans.test.ts`
Expected: FAIL, cannot resolve `./plans`.

- [ ] **Step 3: Implement**

`packages/core/src/billing/plans.ts`:

```ts
import type { StoreRecord } from "../tenancy/store";

export type PlanId = "starter" | "grow" | "scale";
export type BillingInterval = "monthly" | "yearly";

export type Plan = {
  id: PlanId;
  name: string;
  // US cents per month. The yearly price is billed once a year as 12 times this amount.
  priceCents: Record<BillingInterval, number>;
  // Payleor's fee on each order in basis points (100 = 1%), taken through PayPal's partner fee.
  orderFeeBps: number;
  staffSeats: number;
  customDomain: boolean;
  adminAgent: boolean;
  disputeAgent: boolean;
  highlights: readonly string[];
};

export const TRIAL_DAYS = 14;

export const PLANS: readonly Plan[] = [
  {
    id: "starter",
    name: "Starter",
    priceCents: { monthly: 1200, yearly: 900 },
    orderFeeBps: 200,
    staffSeats: 2,
    customDomain: false,
    adminAgent: false,
    disputeAgent: false,
    highlights: [
      "Storefront",
      "ChatGPT and Claude plugins",
      "AI shopper protocols",
      "Shopping agent",
      "2 staff accounts",
      "AI credits",
    ],
  },
  {
    id: "grow",
    name: "Grow",
    priceCents: { monthly: 3900, yearly: 2900 },
    orderFeeBps: 100,
    staffSeats: 5,
    customDomain: true,
    adminAgent: true,
    disputeAgent: true,
    highlights: ["Everything in Starter", "Custom domain", "Admin agent", "Dispute agent", "5 staff accounts", "More AI credits"],
  },
  {
    id: "scale",
    name: "Scale",
    priceCents: { monthly: 12900, yearly: 9900 },
    orderFeeBps: 50,
    staffSeats: 15,
    customDomain: true,
    adminAgent: true,
    disputeAgent: true,
    highlights: ["Everything in Grow", "15 staff accounts", "Priority support", "The most AI credits"],
  },
];

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

// Until billing ships (parent spec §6.7, Nov 2–8), every store is on Starter and the trial is not enforced.
export function planFor(_store: Pick<StoreRecord, "id">): Plan {
  return getPlan("starter");
}

export function formatOrderFee(bps: number): string {
  return `${bps / 100}%`;
}

export function formatPlanPrice(cents: number): string {
  return `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from "./billing/plans";
```

- [ ] **Step 4: Run the test and type check**

Run: `pnpm test packages/core/src/billing/plans.test.ts && pnpm -F @jendal-workspace/core check-types`
Expected: 5 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/billing packages/core/src/index.ts
git commit -m "feat(core): add the plan catalog and planFor" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 2: `suggestStoreSlug` and slug messages

**Files:**
- Modify: `packages/core/src/tenancy/slug.ts`
- Test: `packages/core/src/tenancy/slug.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/tenancy/slug.test.ts` (and add `storeSlugProblem, suggestStoreSlug` to its import from `./slug`):

```ts
describe("suggestStoreSlug", () => {
  it.each([
    ["Acme Goods", "acme-goods"],
    ["  Café Noël!  ", "cafe-noel"],
    ["Bob's  Bikes & Boards", "bob-s-bikes-boards"],
    ["Shop #2", "shop-2"],
  ])("turns %j into %j", (name, slug) => {
    expect(suggestStoreSlug(name)).toBe(slug);
  });

  it("adds -store to reserved or too-short results", () => {
    expect(suggestStoreSlug("Demo")).toBe("demo-store");
    expect(suggestStoreSlug("Login")).toBe("login-store");
    expect(suggestStoreSlug("AB")).toBe("ab-store");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(suggestStoreSlug("   ")).toBe("");
    expect(suggestStoreSlug("日本の店")).toBe("");
  });

  it("keeps long names within 40 characters and valid", () => {
    const slug = suggestStoreSlug("The Very Long Name Of A Store That Sells Many Things");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(validateStoreSlug(slug)).toEqual({ ok: true, slug });
  });
});

describe("storeSlugProblem", () => {
  it("explains each problem in plain words", () => {
    expect(storeSlugProblem("format")).toBe("Use 3 to 40 lowercase letters, numbers or single hyphens.");
    expect(storeSlugProblem("reserved")).toBe("This store address is reserved.");
    expect(storeSlugProblem("taken")).toBe("This store address is already taken.");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test packages/core/src/tenancy/slug.test.ts`
Expected: FAIL, `suggestStoreSlug` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/core/src/tenancy/slug.ts`:

```ts
const SLUG_MAX_LENGTH = 40;
const FALLBACK_SUFFIX = "-store";

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

// Returns "" when the name has no usable letters or digits; the merchant then types an address.
export function suggestStoreSlug(name: string): string {
  const base = trimHyphens(
    trimHyphens(
      name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    ).slice(0, SLUG_MAX_LENGTH),
  );
  if (!base) return "";
  if (validateStoreSlug(base).ok) return base;
  const withSuffix = `${trimHyphens(base.slice(0, SLUG_MAX_LENGTH - FALLBACK_SUFFIX.length))}${FALLBACK_SUFFIX}`;
  return validateStoreSlug(withSuffix).ok ? withSuffix : "";
}

export type StoreSlugProblem = "format" | "reserved" | "taken";

export function storeSlugProblem(problem: StoreSlugProblem): string {
  switch (problem) {
    case "format":
      return "Use 3 to 40 lowercase letters, numbers or single hyphens.";
    case "reserved":
      return "This store address is reserved.";
    case "taken":
      return "This store address is already taken.";
  }
}
```

- [ ] **Step 4: Use the messages in auth**

In `packages/auth/src/index.ts`, import `storeSlugProblem` next to `validateStoreSlug` and replace the two inline message literals in `claimStoreSlug`:

```ts
async function claimStoreSlug(database: Database, input: unknown): Promise<string> {
  const result = validateStoreSlug(typeof input === "string" ? input : "");
  if (!result.ok) {
    throw new APIError("BAD_REQUEST", {
      code: result.reason === "reserved" ? "STORE_SLUG_RESERVED" : "STORE_SLUG_INVALID",
      message: storeSlugProblem(result.reason),
    });
  }
  // The unique index on team.slug still guards against a concurrent claim.
  if (await isStoreSlugTaken(database, result.slug)) {
    throw new APIError("CONFLICT", { code: "STORE_SLUG_TAKEN", message: storeSlugProblem("taken") });
  }
  return result.slug;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test packages/core packages/auth`
Expected: all pass (auth tests unchanged in behaviour).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tenancy packages/auth/src/index.ts
git commit -m "feat(core): suggest store addresses from names and share slug messages" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 3: `setupSteps` and `storePolicyUrls`

**Files:**
- Create: `packages/core/src/onboarding/setup-steps.ts`, `packages/core/src/policies/store-policies.ts`
- Test: `packages/core/src/onboarding/setup-steps.test.ts`, `packages/core/src/policies/store-policies.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/onboarding/setup-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { countDone, setupSteps } from "./setup-steps";

const links = { storefrontUrl: "https://acme.payleor.site" };

describe("setupSteps", () => {
  it("starts a new store with only the first step done", () => {
    const steps = setupSteps({ status: "draft", paypalMerchantId: null }, links);

    expect(steps).toEqual([
      { id: "create-store", label: "Create your store", done: true },
      { id: "connect-paypal", label: "Connect PayPal", done: false },
      { id: "visit-storefront", label: "Visit your storefront", done: false, href: "https://acme.payleor.site" },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("marks PayPal done once a merchant ID is stored, and the storefront once the store is live", () => {
    const steps = setupSteps({ status: "active", paypalMerchantId: "MERCHANT1" }, links);

    expect(steps.map((s) => s.done)).toEqual([true, true, true]);
    expect(countDone(steps)).toBe(3);
  });
});
```

`packages/core/src/policies/store-policies.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isStorePolicy, STORE_POLICIES, storePolicyUrls } from "./store-policies";

describe("store policies", () => {
  it("lists the four default policies", () => {
    expect(STORE_POLICIES).toEqual(["returns", "shipping", "terms", "privacy"]);
  });

  it("recognises policy names only", () => {
    expect(isStorePolicy("returns")).toBe(true);
    expect(isStorePolicy("refunds")).toBe(false);
  });

  it("builds the policy URLs from the store's base URL, with or without a trailing slash", () => {
    const expected = {
      returns: "https://acme.payleor.site/policies/returns",
      shipping: "https://acme.payleor.site/policies/shipping",
      terms: "https://acme.payleor.site/policies/terms",
      privacy: "https://acme.payleor.site/policies/privacy",
    };
    expect(storePolicyUrls("https://acme.payleor.site")).toEqual(expected);
    expect(storePolicyUrls("https://acme.payleor.site/")).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test packages/core/src/onboarding packages/core/src/policies`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/onboarding/setup-steps.ts`:

```ts
import type { StoreRecord } from "../tenancy/store";

// Later plans append steps (W1-B links PayPal onboarding; W1-C adds products and branding; billing adds a plan).
export type SetupStep = { id: string; label: string; done: boolean; href?: string };

export function setupSteps(
  store: Pick<StoreRecord, "status" | "paypalMerchantId">,
  links: { storefrontUrl: string },
): SetupStep[] {
  return [
    { id: "create-store", label: "Create your store", done: true },
    { id: "connect-paypal", label: "Connect PayPal", done: store.paypalMerchantId !== null },
    // A visit cannot be detected, so the step counts as done once the storefront is live.
    { id: "visit-storefront", label: "Visit your storefront", done: store.status === "active", href: links.storefrontUrl },
  ];
}

export function countDone(steps: readonly SetupStep[]): number {
  return steps.filter((step) => step.done).length;
}
```

`packages/core/src/policies/store-policies.ts`:

```ts
export const STORE_POLICIES = ["returns", "shipping", "terms", "privacy"] as const;

export type StorePolicy = (typeof STORE_POLICIES)[number];

export function isStorePolicy(value: string): value is StorePolicy {
  return STORE_POLICIES.some((policy) => policy === value);
}

// The ACP and UCP adapters reuse these for their policy links.
export function storePolicyUrls(storeBaseUrl: string): Record<StorePolicy, string> {
  const base = storeBaseUrl.replace(/\/+$/, "");
  return {
    returns: `${base}/policies/returns`,
    shipping: `${base}/policies/shipping`,
    terms: `${base}/policies/terms`,
    privacy: `${base}/policies/privacy`,
  };
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from "./onboarding/setup-steps";
export * from "./policies/store-policies";
```

- [ ] **Step 4: Run tests and type check**

Run: `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add store setup steps and store policy URLs" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 4: `packages/email`

**Files:**
- Create: `packages/email/package.json`, `packages/email/tsconfig.json`, `packages/email/src/{index,mailer,fake,smtp,templates}.ts`
- Test: `packages/email/src/templates.test.ts`, `packages/email/src/fake.test.ts`

- [ ] **Step 1: Create the package**

`packages/email/package.json`:

```json
{
  "name": "@jendal-workspace/email",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "scripts": {
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@opencoredev/email-sdk": "2.0.0"
  },
  "devDependencies": {
    "@jendal-workspace/config": "workspace:*",
    "typescript": "catalog:"
  }
}
```

`packages/email/tsconfig.json`:

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
Expected: `@opencoredev/email-sdk@2.0.0` installed for `@jendal-workspace/email`.

- [ ] **Step 2: Write the failing tests**

`packages/email/src/templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { passwordResetEmail, verificationEmail } from "./templates";

const url = "https://admin.payleor.app/api/auth/verify-email?token=abc&callbackURL=%2Fnew";

describe("verificationEmail", () => {
  it("links to the verification URL in both parts", () => {
    const email = verificationEmail({ name: "Ada", url });

    expect(email.subject).toBe("Verify your email for Payleor");
    expect(email.text).toContain(url);
    expect(email.text).toContain("expires in 1 hour");
    expect(email.html).toContain('href="https://admin.payleor.app/api/auth/verify-email?token=abc&amp;callbackURL=%2Fnew"');
  });

  it("escapes the name in the HTML part", () => {
    const email = verificationEmail({ name: "<script>alert(1)</script>", url });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("passwordResetEmail", () => {
  it("links to the reset URL and says what happens if it was not requested", () => {
    const resetUrl = "https://admin.payleor.app/api/auth/reset-password/tok?callbackURL=%2Freset-password";
    const email = passwordResetEmail({ name: "Ada", url: resetUrl });

    expect(email.subject).toBe("Reset your Payleor password");
    expect(email.text).toContain(resetUrl);
    expect(email.text).toContain("your password stays the same");
    expect(email.html).toContain(`href="${resetUrl}"`);
  });
});
```

`packages/email/src/fake.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createFakeMailer } from "./fake";

describe("createFakeMailer", () => {
  it("records every message it is asked to send", async () => {
    const mailer = createFakeMailer();
    const message = { to: "ada@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>" };

    await mailer.send(message);

    expect(mailer.sent).toEqual([message]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test packages/email`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`packages/email/src/mailer.ts`:

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}
```

`packages/email/src/fake.ts`:

```ts
import type { EmailMessage, Mailer } from "./mailer";

export type FakeMailer = Mailer & { readonly sent: EmailMessage[] };

export function createFakeMailer(): FakeMailer {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
```

`packages/email/src/smtp.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { smtp } from "@opencoredev/email-sdk/smtp";

import type { Mailer } from "./mailer";

export type SmtpConfig = {
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  EMAIL_FROM: string;
};

// Port 587 with STARTTLS works inside workerd; port 465 (implicit TLS) failed there (spec §5.2).
export function createSmtpMailer(config: SmtpConfig): Mailer {
  const port = Number(config.SMTP_PORT || "587");
  const client = createEmailClient({
    adapters: [
      smtp({
        host: config.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      }),
    ],
    telemetry: false,
  });
  return {
    async send(message) {
      await client.send({ from: config.EMAIL_FROM, ...message });
    },
  };
}
```

`packages/email/src/templates.ts`:

```ts
export type EmailContent = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(input: { greeting: string; intro: string; action: string; url: string; outro: string }): string {
  const url = escapeHtml(input.url);
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111">
<div style="max-width:480px;margin:0 auto;background:#fff;padding:32px;border-radius:8px">
<p style="margin:0 0 16px;font-size:18px;font-weight:600">Payleor</p>
<p style="margin:0 0 16px">${escapeHtml(input.greeting)}</p>
<p style="margin:0 0 24px">${escapeHtml(input.intro)}</p>
<p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(input.action)}</a></p>
<p style="margin:0 0 16px;font-size:14px;color:#555">Or paste this link into your browser:<br><a href="${url}" style="color:#555;word-break:break-all">${url}</a></p>
<p style="margin:0;font-size:14px;color:#555">${escapeHtml(input.outro)}</p>
</div>
</body>
</html>`;
}

function render(input: { subject: string; name: string; intro: string; action: string; url: string; outro: string }): EmailContent {
  const greeting = `Hi ${input.name},`;
  return {
    subject: input.subject,
    text: [greeting, "", input.intro, input.url, "", input.outro].join("\n"),
    html: renderHtml({ greeting, intro: input.intro, action: input.action, url: input.url, outro: input.outro }),
  };
}

export function verificationEmail(input: { name: string; url: string }): EmailContent {
  return render({
    subject: "Verify your email for Payleor",
    name: input.name,
    intro: "Confirm your email address to finish creating your Payleor account.",
    action: "Verify email",
    url: input.url,
    outro: "This link expires in 1 hour. If you did not sign up for Payleor, you can ignore this email.",
  });
}

export function passwordResetEmail(input: { name: string; url: string }): EmailContent {
  return render({
    subject: "Reset your Payleor password",
    name: input.name,
    intro: "Use this link to choose a new password for your Payleor account.",
    action: "Choose a new password",
    url: input.url,
    outro:
      "This link expires in 1 hour. If you did not ask to reset your password, you can ignore this email; your password stays the same.",
  });
}
```

`packages/email/src/index.ts`:

```ts
export * from "./fake";
export * from "./mailer";
export * from "./smtp";
export * from "./templates";
```

- [ ] **Step 5: Run tests and type check**

Run: `pnpm test packages/email && pnpm -F @jendal-workspace/email check-types`
Expected: 4 tests pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/email pnpm-lock.yaml
git commit -m "feat(email): add the mailer port, SMTP adapter, fake mailer and account email templates" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 5: Schema, migration and policy info repository

**Files:**
- Modify: `packages/db/src/schema/auth.ts`, `packages/db/src/schema/organization.ts`, `packages/db/src/testing/db.ts`, `packages/db/src/repositories/stores.ts`
- Generate: `packages/db/src/migrations/<timestamp>_w1d_auth_email/`
- Test: `packages/db/src/repositories/stores.test.ts`

- [ ] **Step 1: Write the failing repository test**

In `packages/db/src/repositories/stores.test.ts`, add `team` to the `../schema/organization` import, `eq` from `drizzle-orm`, and `findStorePolicyInfo` to the `./stores` import. Add inside the `describe` block:

```ts
  it("returns the support email and creation date used by the store policies", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    await db.update(team).set({ supportEmail: "help@acme.test" }).where(eq(team.id, store.id));

    await expect(findStorePolicyInfo(db, store.id)).resolves.toEqual({
      supportEmail: "help@acme.test",
      createdAt: expect.any(Date),
    });
    await expect(findStorePolicyInfo(db, "missing")).resolves.toBeNull();
  });
```

- [ ] **Step 2: Change the schema**

In `packages/db/src/schema/auth.ts`, change the import line and the `user` table, and add `rateLimit` at the end of the file:

```ts
import { bigint, boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
```

```ts
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  // Set by a Better Auth create hook for every new account (spec §5.1).
  acceptedTermsAt: timestamp("accepted_terms_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
```

```ts
// Better Auth's database rate limiter (rateLimit.storage = "database"); Worker isolates share no memory.
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
```

In `packages/db/src/schema/organization.ts`, add to the `team` columns after `paypalMerchantId`:

```ts
    supportEmail: text("support_email"),
```

and update the comment above `team`:

```ts
// Each team is a store (spec §4.1). slug, status, paypalMerchantId and supportEmail are team additionalFields in packages/auth.
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm -F @jendal-workspace/db exec drizzle-kit generate --name w1d_auth_email`
Expected: a new folder `packages/db/src/migrations/<timestamp>_w1d_auth_email/` whose `migration.sql` creates `rate_limit` (with a unique constraint on `key`) and adds `user.accepted_terms_at` (timestamp) and `team.support_email` (text). Read the SQL; it must contain no `DROP`.

- [ ] **Step 4: Truncate the new table in tests**

In `packages/db/src/testing/db.ts`, add `"rate_limit"` to the truncate list:

```ts
      'truncate table "rate_limit", "store_domains", "team_member", "team", "invitation", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
```

- [ ] **Step 5: Implement the repository function**

Append to `packages/db/src/repositories/stores.ts`:

```ts
export type StorePolicyInfo = { supportEmail: string | null; createdAt: Date };

// Kept out of StoreRecord so the KV-cached store lookup stays small.
export async function findStorePolicyInfo(db: Database, storeId: string): Promise<StorePolicyInfo | null> {
  const [row] = await db
    .select({ supportEmail: team.supportEmail, createdAt: team.createdAt })
    .from(team)
    .where(eq(team.id, storeId))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test packages/db`
Expected: all pass, including the new test (the global setup re-creates the test database from all migrations).

- [ ] **Step 7: Migrate the local dev database**

Run: `pnpm db:migrate:dev`
Expected: the new migration applies to `jendal-dev`.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src
git commit -m "feat(db): add rate_limit, user.accepted_terms_at and team.support_email" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 6: Auth: verification, reset, rate limits, terms, support email

**Files:**
- Modify: `packages/auth/package.json`, `packages/auth/src/index.ts`
- Create: `packages/auth/src/testing.ts`
- Test: `packages/auth/src/index.test.ts` (rewritten)

- [ ] **Step 1: Add the email dependency**

In `packages/auth/package.json` `dependencies`, add `"@jendal-workspace/email": "workspace:*"`. Run `pnpm install`.

- [ ] **Step 2: Write the test helpers**

`packages/auth/src/testing.ts`:

```ts
import type { Database } from "@jendal-workspace/db";
import { user } from "@jendal-workspace/db/schema/auth";
import { createFakeMailer, type Mailer } from "@jendal-workspace/email";
import { eq } from "drizzle-orm";

import { type Auth, type AuthConfig, type AuthEmailKind, createAuth } from "./index";

export const TEST_AUTH_CONFIG: AuthConfig = {
  BETTER_AUTH_URL: "http://admin.localhost:3001",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  PAYPAL_CLIENT_ID: "sandbox-client-id",
  PAYPAL_CLIENT_SECRET: "sandbox-client-secret",
  PAYPAL_ENVIRONMENT: "sandbox",
};

export const TEST_PASSWORD = "correct-horse-battery";

export function createTestAuth(db: Database, options: { config?: Partial<AuthConfig>; mailer?: Mailer } = {}) {
  const mailer = createFakeMailer();
  const pending: Promise<unknown>[] = [];
  const emailErrors: Array<{ kind: AuthEmailKind; to: string }> = [];
  const auth = createAuth({ ...TEST_AUTH_CONFIG, ...options.config }, db, {
    mailer: options.mailer ?? mailer,
    waitUntil: (promise) => {
      pending.push(promise);
    },
    onEmailError: (_error, email) => {
      emailErrors.push(email);
    },
  });
  return { auth, mailer, emailErrors, settle: () => Promise.all(pending) };
}

export function cookieHeaders(source: Headers): Headers {
  const cookie = source
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

// Email sign-in needs a verified address, so tests that only need a session skip the email round trip.
export async function signUpVerified(auth: Auth, db: Database, email: string, name = "Ada") {
  const { user: created } = await auth.api.signUpEmail({ body: { name, email, password: TEST_PASSWORD } });
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, created.id));
  const { headers } = await auth.api.signInEmail({ body: { email, password: TEST_PASSWORD }, returnHeaders: true });
  return { userId: created.id, email, headers: cookieHeaders(headers) };
}
```

- [ ] **Step 3: Write the failing tests**

Replace `packages/auth/src/index.test.ts` with:

```ts
import { user } from "@jendal-workspace/db/schema/auth";
import { team } from "@jendal-workspace/db/schema/organization";
import { createTestDb, hasTestDatabase, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cookieHeaders, createTestAuth, signUpVerified, TEST_AUTH_CONFIG, TEST_PASSWORD } from "./testing";

const BASE = TEST_AUTH_CONFIG.BETTER_AUTH_URL;

function linkIn(text: string): URL {
  const match = /https?:\/\/\S+/.exec(text);
  if (!match) throw new Error(`No link in: ${text}`);
  return new URL(match[0]);
}

describe.skipIf(!hasTestDatabase)("stores as Better Auth teams", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function ownerWithOrganization(slug = "acme-inc") {
    const owner = await signUpVerified(auth, db, `owner-${slug}@example.com`);
    const organization = await auth.api.createOrganization({
      body: { name: "Acme Inc", slug },
      headers: owner.headers,
    });
    if (!organization) throw new Error("organization was not created");
    return { ...owner, organizationId: organization.id };
  }

  it("creates a draft store from a normalized slug, with the creator's email as support email", async () => {
    const { headers, organizationId, email } = await ownerWithOrganization();

    const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: " Acme " }, headers });

    const [row] = await db.select().from(team).where(eq(team.id, store.id));
    expect(row).toMatchObject({
      organizationId,
      name: "Acme",
      slug: "acme",
      status: "draft",
      paypalMerchantId: null,
      supportEmail: email,
    });
  });

  it("ignores client attempts to set the status, PayPal merchant or support email", async () => {
    const { headers, organizationId, email } = await ownerWithOrganization();
    const extra: Record<string, unknown> = { status: "active", paypalMerchantId: "FAKE", supportEmail: "x@evil.test" };

    const store = await auth.api.createTeam({
      body: { name: "Acme", organizationId, slug: "acme", ...extra },
      headers,
    });

    const [row] = await db.select().from(team).where(eq(team.id, store.id));
    expect(row).toMatchObject({ status: "draft", paypalMerchantId: null, supportEmail: email });
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
    const staff = await signUpVerified(auth, db, "staff@example.com");
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

describe.skipIf(!hasTestDatabase)("email verification", () => {
  const db = createTestDb();
  const { auth, mailer, settle } = createTestAuth(db);

  beforeEach(async () => {
    await truncateAll(db);
    mailer.sent.length = 0;
  });
  afterAll(() => db.$client.end());

  async function signUp(email = "ada@example.com") {
    return auth.api.signUpEmail({
      body: { name: "Ada", email, password: TEST_PASSWORD, callbackURL: "/new" },
    });
  }

  it("sends one verification email on sign-up, linking back to /new, and starts no session", async () => {
    const result = await signUp();
    await settle();

    expect(result.token).toBeNull();
    expect(mailer.sent).toHaveLength(1);
    const [message] = mailer.sent;
    expect(message).toMatchObject({ to: "ada@example.com", subject: "Verify your email for Payleor" });
    const link = linkIn(message?.text ?? "");
    expect(link.origin + link.pathname).toBe(`${BASE}/api/auth/verify-email`);
    expect(link.searchParams.get("callbackURL")).toBe("/new");
  });

  it("rejects passwords shorter than 10 characters", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: "short-pw1" } }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
  });

  it("refuses email sign-in before verification and sends a fresh link", async () => {
    await signUp();

    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: TEST_PASSWORD, callbackURL: "/new" } }),
    ).rejects.toMatchObject({ status: "FORBIDDEN", body: { code: "EMAIL_NOT_VERIFIED" } });
    await settle();
    expect(mailer.sent).toHaveLength(2);
  });

  it("verifies the address and signs the user in from the emailed link", async () => {
    await signUp();
    await settle();
    const link = linkIn(mailer.sent[0]?.text ?? "");

    const response = await auth.handler(new Request(link));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/\/new$/);
    const session = await auth.api.getSession({ headers: cookieHeaders(response.headers) });
    expect(session?.user).toMatchObject({ email: "ada@example.com", emailVerified: true });
  });

  it("records when each new user accepted the terms", async () => {
    const before = new Date();
    const { user: created } = await signUp();

    const [row] = await db.select().from(user).where(eq(user.id, created.id));
    expect(row?.acceptedTermsAt).toBeInstanceOf(Date);
    expect(row?.acceptedTermsAt?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});

describe.skipIf(!hasTestDatabase)("password reset", () => {
  const db = createTestDb();
  const { auth, mailer, settle } = createTestAuth(db);

  beforeEach(async () => {
    await truncateAll(db);
    mailer.sent.length = 0;
  });
  afterAll(() => db.$client.end());

  async function resetToken(email: string): Promise<string> {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    await settle();
    const message = mailer.sent.find((m) => m.subject === "Reset your Payleor password");
    const response = await auth.handler(new Request(linkIn(message?.text ?? "")));
    const location = new URL(response.headers.get("location") ?? "", BASE);
    expect(location.pathname).toBe("/reset-password");
    const token = location.searchParams.get("token");
    if (!token) throw new Error("no token in the reset redirect");
    return token;
  }

  it("emails a link that leads to the reset page with a token", async () => {
    await signUpVerified(auth, db, "ada@example.com");

    await expect(resetToken("ada@example.com")).resolves.toEqual(expect.any(String));
  });

  it("changes the password and signs out every session", async () => {
    const { headers } = await signUpVerified(auth, db, "ada@example.com");
    const token = await resetToken("ada@example.com");

    await auth.api.resetPassword({ body: { newPassword: "a-brand-new-password", token } });

    await expect(auth.api.getSession({ headers })).resolves.toBeNull();
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: TEST_PASSWORD } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: "a-brand-new-password" } }),
    ).resolves.toMatchObject({ user: { email: "ada@example.com" } });
  });

  it("rejects an unknown token", async () => {
    await expect(
      auth.api.resetPassword({ body: { newPassword: "a-brand-new-password", token: "nope" } }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "INVALID_TOKEN" } });
  });
});

describe.skipIf(!hasTestDatabase)("rate limits", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function post(path: string, ip: string, body: unknown): Request {
    return new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    });
  }

  async function statuses(count: number, request: () => Request): Promise<number[]> {
    const result: number[] = [];
    for (let i = 0; i < count; i++) result.push((await auth.handler(request())).status);
    return result;
  }

  it("allows 5 email sign-in attempts per minute from one IP", async () => {
    const attempt = () => post("/sign-in/email", "203.0.113.7", { email: "nobody@example.com", password: "wrong-password-1" });

    const result = await statuses(6, attempt);

    expect(result.slice(0, 5)).not.toContain(429);
    expect(result[5]).toBe(429);
  });

  it("counts each IP separately", async () => {
    await statuses(6, () => post("/sign-in/email", "203.0.113.7", { email: "a@example.com", password: "wrong-password-1" }));

    const other = await auth.handler(
      post("/sign-in/email", "203.0.113.8", { email: "a@example.com", password: "wrong-password-1" }),
    );
    expect(other.status).not.toBe(429);
  });

  it("allows 3 password reset requests per 10 minutes", async () => {
    const request = () => post("/request-password-reset", "203.0.113.9", { email: "a@example.com", redirectTo: "/reset-password" });

    const result = await statuses(4, request);

    expect(result.slice(0, 3)).not.toContain(429);
    expect(result[3]).toBe(429);
  });
});

describe.skipIf(!hasTestDatabase)("email failures", () => {
  const db = createTestDb();
  const failing = { send: () => Promise.reject(new Error("SMTP down")) };
  const { auth, emailErrors, settle } = createTestAuth(db, { mailer: failing });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("completes sign-up and reports the failed send", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: TEST_PASSWORD } }),
    ).resolves.toMatchObject({ user: { email: "ada@example.com" } });
    await settle();

    expect(emailErrors).toEqual([{ kind: "verification", to: "ada@example.com" }]);
  });
});

describe.skipIf(!hasTestDatabase)("Log in with PayPal", () => {
  const db = createTestDb();
  afterAll(() => db.$client.end());

  async function authorizeUrl(environment: string) {
    const { auth } = createTestAuth(db, { config: { PAYPAL_ENVIRONMENT: environment } });
    const { url } = await auth.api.signInSocial({ body: { provider: "paypal", disableRedirect: true } });
    if (!url) throw new Error("no authorize URL");
    return new URL(url);
  }

  it("asks PayPal for the OpenID scopes, which its authorize page requires", async () => {
    const url = await authorizeUrl("sandbox");

    expect(url.origin + url.pathname).toBe("https://www.sandbox.paypal.com/signin/authorize");
    expect(url.searchParams.get("scope")).toBe(
      "openid profile email https://uri.paypal.com/services/paypalattributes",
    );
    expect(url.searchParams.get("redirect_uri")).toBe("http://admin.localhost:3001/api/auth/callback/paypal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("uses the live authorize page in the live environment", async () => {
    const url = await authorizeUrl("live");

    expect(url.origin + url.pathname).toBe("https://www.paypal.com/signin/authorize");
    expect(url.searchParams.get("scope")).toContain("openid");
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm test packages/auth`
Expected: FAIL: `testing.ts` does not compile because `createAuth` takes two arguments and `AuthEmailKind` does not exist.

- [ ] **Step 5: Implement**

Replace `packages/auth/src/index.ts` with:

```ts
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { storeSlugProblem, validateStoreSlug } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { isStoreSlugTaken } from "@jendal-workspace/db/repositories/stores";
import * as schema from "@jendal-workspace/db/schema/index";
import { type EmailMessage, type Mailer, passwordResetEmail, verificationEmail } from "@jendal-workspace/email";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";

import { paypalAuthorizationEndpoint, paypalEmail } from "./paypal";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_ENVIRONMENT: string;
};

export type AuthEmailKind = "verification" | "password-reset";

export type AuthServices = {
  mailer: Mailer;
  // The Worker's ctx.waitUntil: emails and Better Auth background tasks finish after the response.
  waitUntil: (promise: Promise<unknown>) => void;
  // This package does not log; the api Worker logs with the recipient hashed.
  onEmailError: (error: unknown, email: { kind: AuthEmailKind; to: string }) => void | Promise<void>;
};

const ONE_HOUR_IN_SECONDS = 60 * 60;

// A store is a team (spec §4.1). Fields with input: false are set by our own code only.
const storeFields = {
  slug: { type: "string", required: true, unique: true, input: true },
  status: { type: "string", required: true, defaultValue: "draft", input: false },
  paypalMerchantId: { type: "string", required: false, unique: true, input: false },
  supportEmail: { type: "string", required: false, input: false },
} as const;

const userFields = {
  acceptedTermsAt: { type: "date", required: false, input: false },
} as const;

async function claimStoreSlug(database: Database, input: unknown): Promise<string> {
  const result = validateStoreSlug(typeof input === "string" ? input : "");
  if (!result.ok) {
    throw new APIError("BAD_REQUEST", {
      code: result.reason === "reserved" ? "STORE_SLUG_RESERVED" : "STORE_SLUG_INVALID",
      message: storeSlugProblem(result.reason),
    });
  }
  // The unique index on team.slug still guards against a concurrent claim.
  if (await isStoreSlugTaken(database, result.slug)) {
    throw new APIError("CONFLICT", { code: "STORE_SLUG_TAKEN", message: storeSlugProblem("taken") });
  }
  return result.slug;
}

// Not awaited, so response times do not reveal whether an account exists (spec §5.1).
function sendInBackground(services: AuthServices, kind: AuthEmailKind, message: EmailMessage): void {
  services.waitUntil(
    services.mailer.send(message).catch((error: unknown) => services.onEmailError(error, { kind, to: message.to })),
  );
}

export function createAuth(env: AuthConfig, database: Database, services: AuthServices) {
  const paypalLive = env.PAYPAL_ENVIRONMENT === "live";
  return betterAuth({
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      resetPasswordTokenExpiresIn: ONE_HOUR_IN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        sendInBackground(services, "password-reset", { to: user.email, ...passwordResetEmail({ name: user.name, url }) });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: ONE_HOUR_IN_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        sendInBackground(services, "verification", { to: user.email, ...verificationEmail({ name: user.name, url }) });
      },
    },
    user: { additionalFields: userFields },
    databaseHooks: {
      user: {
        create: {
          // Every sign-up form and the PayPal button state that continuing accepts the terms.
          before: async (user) => ({ data: { ...user, acceptedTermsAt: new Date() } }),
        },
      },
    },
    rateLimit: {
      // Better Auth enables it only in production by default; the limits are part of the product.
      enabled: true,
      // Worker isolates share no memory.
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 600, max: 3 },
        "/send-verification-email": { window: 600, max: 3 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      backgroundTasks: { handler: services.waitUntil },
    },
    socialProviders: {
      paypal: {
        clientId: env.PAYPAL_CLIENT_ID,
        clientSecret: env.PAYPAL_CLIENT_SECRET,
        environment: paypalLive ? "live" : "sandbox",
        authorizationEndpoint: paypalAuthorizationEndpoint(paypalLive),
        mapProfileToUser: (profile) => paypalEmail(profile),
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
          beforeCreateTeam: async ({ team, user }) => ({
            data: {
              slug: await claimStoreSlug(database, team.slug),
              status: "draft",
              paypalMerchantId: null,
              supportEmail: user?.email ?? null,
            },
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

- [ ] **Step 6: Run the tests**

Run: `pnpm test packages/auth`
Expected: all pass. If the verification redirect test fails on `location`, print it and compare with Fact 4 before changing the assertion. If the rate-limit tests see no 429, check that the requests reach `auth.handler` with the `cf-connecting-ip` header (Fact 2).

- [ ] **Step 7: Type check the packages that use auth**

Run: `pnpm -F @jendal-workspace/auth check-types`
Expected: no errors. `apps/server` and `packages/api` still fail to compile until Tasks 7 and 8; that is expected.

- [ ] **Step 8: Commit**

```bash
git add packages/auth pnpm-lock.yaml
git commit -m "feat(auth): require email verification, add password reset, database rate limits and terms acceptance" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 7: `store.checkSlug` and `store.create`

**Files:**
- Modify: `packages/api/src/context.ts`, `packages/api/src/routers/store.ts`
- Test: `packages/api/src/routers/store.test.ts`, `packages/api/src/routers/index.test.ts`

- [ ] **Step 1: Extend the context**

Replace `packages/api/src/context.ts`:

```ts
import type { Auth, Session } from "@jendal-workspace/auth";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";

export type Context = {
  session: Session | null;
  db: Database;
  environment: TenantEnvironment;
  // Procedures that act through Better Auth (organizations, stores) pass the caller's headers on.
  auth: Auth;
  headers: Headers;
};
```

- [ ] **Step 2: Update the existing callers in tests**

In `packages/api/src/routers/index.test.ts`, import `createTestAuth` from `@jendal-workspace/auth/testing` and build the caller with:

```ts
    const { auth } = createTestAuth(db);
    const caller = appRouter.createCaller({ db, session: null, environment: "sandbox", auth, headers: new Headers() });
```

In `packages/api/src/routers/store.test.ts`, import `createTestAuth` and `signUpVerified` from `@jendal-workspace/auth/testing`, and change `callerFor` inside the existing `describe`:

```ts
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
    });
```

- [ ] **Step 3: Write the failing tests**

Append to `packages/api/src/routers/store.test.ts`:

```ts
describe.skipIf(!hasTestDatabase)("store creation", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function signedInCaller(email = "ada@example.com") {
    const { headers } = await signUpVerified(auth, db, email);
    const session = await auth.api.getSession({ headers });
    return appRouter.createCaller({ db, session, environment: "sandbox", auth, headers });
  }

  it("reports an address as available, taken or invalid", async () => {
    const caller = await signedInCaller();
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "taken-shop" });

    await expect(caller.store.checkSlug({ slug: " Acme " })).resolves.toEqual({ status: "available", slug: "acme" });
    await expect(caller.store.checkSlug({ slug: "taken-shop" })).resolves.toEqual({ status: "taken", slug: "taken-shop" });
    await expect(caller.store.checkSlug({ slug: "login" })).resolves.toEqual({ status: "invalid", reason: "reserved" });
    await expect(caller.store.checkSlug({ slug: "a_b" })).resolves.toEqual({ status: "invalid", reason: "format" });
  });

  it("creates one organization, named after the first store, for all of a new merchant's stores", async () => {
    const caller = await signedInCaller();

    await expect(caller.store.create({ name: "Acme", slug: "acme" })).resolves.toEqual({ slug: "acme" });
    await expect(caller.store.create({ name: "Beta", slug: "beta" })).resolves.toEqual({ slug: "beta" });

    const organizations = await caller.store.listMine();
    expect(organizations).toHaveLength(1);
    expect(organizations[0]).toMatchObject({ name: "Acme", role: "owner" });
    expect(organizations[0]?.stores.map((s) => s.slug).sort()).toEqual(["acme", "beta"]);
  });

  it("sets the store's support email to the merchant's email", async () => {
    const caller = await signedInCaller("owner@acme.test");

    await caller.store.create({ name: "Acme", slug: "acme" });

    const [row] = await db.select().from(team).where(eq(team.slug, "acme"));
    expect(row?.supportEmail).toBe("owner@acme.test");
  });

  it("reports a taken address and reuses the organization on retry", async () => {
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });
    const caller = await signedInCaller();

    await expect(caller.store.create({ name: "Acme", slug: "acme" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This store address is already taken.",
    });
    await expect(caller.store.create({ name: "Acme", slug: "acme-shop" })).resolves.toEqual({ slug: "acme-shop" });

    const organizations = await caller.store.listMine();
    expect(organizations).toHaveLength(1);
    expect(organizations[0]?.stores.map((s) => s.slug)).toEqual(["acme-shop"]);
  });

  it("rejects an invalid address before creating anything", async () => {
    const caller = await signedInCaller();

    await expect(caller.store.create({ name: "Acme", slug: "login" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This store address is reserved.",
    });
    await expect(caller.store.listMine()).resolves.toEqual([]);
  });

  it("rejects anonymous callers", async () => {
    const caller = appRouter.createCaller({ db, session: null, environment: "sandbox", auth, headers: new Headers() });

    await expect(caller.store.create({ name: "Acme", slug: "acme" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
```

Add to the imports at the top of the file: `team` from `@jendal-workspace/db/schema/organization` and `eq` from `drizzle-orm`.

- [ ] **Step 4: Run to verify failure**

Run: `pnpm test packages/api`
Expected: the new tests FAIL (`checkSlug` and `create` do not exist); the existing tests pass.

- [ ] **Step 5: Implement**

Replace `packages/api/src/routers/store.ts`:

```ts
import { canOpenStore, hasStoreWideRole, storeSlugProblem, validateStoreSlug } from "@jendal-workspace/core";
import { isStoreSlugTaken, listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { storeProcedure } from "../store-procedure";

const slugInput = z.string().max(100);

function toTRPCError(error: unknown): unknown {
  if (!(error instanceof APIError)) return error;
  const code = error.status === "CONFLICT" ? "CONFLICT" : error.status === "FORBIDDEN" ? "FORBIDDEN" : "BAD_REQUEST";
  return new TRPCError({ code, message: error.body?.message ?? error.message, cause: error });
}

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

  checkSlug: protectedProcedure.input(z.object({ slug: slugInput })).query(async ({ ctx, input }) => {
    const result = validateStoreSlug(input.slug);
    if (!result.ok) return { status: "invalid", reason: result.reason } as const;
    if (await isStoreSlugTaken(ctx.db, result.slug)) return { status: "taken", slug: result.slug } as const;
    return { status: "available", slug: result.slug } as const;
  }),

  // Spec §6.1: the store goes into the first organization the user can create stores in, or a new one.
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(2).max(80), slug: slugInput }))
    .mutation(async ({ ctx, input }) => {
      const slug = validateStoreSlug(input.slug);
      if (!slug.ok) throw new TRPCError({ code: "BAD_REQUEST", message: storeSlugProblem(slug.reason) });

      try {
        const organizations = await listOrganizationsWithStores(ctx.db, ctx.session.user.id);
        let organizationId = organizations.find((o) => hasStoreWideRole(o.role))?.organization.id;
        if (!organizationId) {
          // The organization slug is never shown; stores carry the public address.
          const created = await ctx.auth.api.createOrganization({
            body: { name: input.name, slug: `org-${crypto.randomUUID()}` },
            headers: ctx.headers,
          });
          if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the organization." });
          organizationId = created.id;
        }
        // createTeam runs the W1-A slug hooks; if it fails, the organization stays for the retry.
        await ctx.auth.api.createTeam({
          body: { name: input.name, organizationId, slug: slug.slug },
          headers: ctx.headers,
        });
        return { slug: slug.slug };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
```

- [ ] **Step 6: Run the tests and type check**

Run: `pnpm test packages/api && pnpm -F @jendal-workspace/api check-types`
Expected: all pass; no type errors. If `error.body?.message` does not type-check, read `APIError` in `refs/stack/better-auth/packages/core/src/error/` and adjust the access, not the behaviour.

- [ ] **Step 7: Commit**

```bash
git add packages/api
git commit -m "feat(api): check store addresses and create stores with their organization" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 8: Server wiring and settings

**Files:**
- Create: `apps/server/src/email-log.ts`
- Test: `apps/server/src/email-log.test.ts`
- Modify: `apps/server/package.json`, `apps/server/src/services.ts`, `apps/server/src/index.ts`, `apps/server/src/context.ts`, `apps/server/src/routes/store-info.ts`, `apps/server/.env.schema`, `packages/infra/.env.schema`, `packages/infra/alchemy.run.ts`, `turbo.json`

- [ ] **Step 1: Write the failing test**

`apps/server/src/email-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { hashRecipient } from "./email-log";

describe("hashRecipient", () => {
  it("gives the same 16-character hex hash whatever the case or spacing", async () => {
    const hash = await hashRecipient("Ada@Example.com ");

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    await expect(hashRecipient("ada@example.com")).resolves.toBe(hash);
  });

  it("gives different hashes for different addresses and never contains the address", async () => {
    const hash = await hashRecipient("ada@example.com");

    await expect(hashRecipient("bob@example.com")).resolves.not.toBe(hash);
    expect(hash).not.toContain("ada");
  });
});
```

Run: `pnpm test apps/server/src/email-log.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement the logging helper**

`apps/server/src/email-log.ts`:

```ts
import type { AuthEmailKind } from "@jendal-workspace/auth";
import { log } from "evlog";

// Logs never hold email addresses (parent spec §12.1); a short hash still links repeated failures.
export async function hashRecipient(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// SMTP error messages can quote the recipient, so only the error's name and code are logged.
export async function logEmailError(error: unknown, email: { kind: AuthEmailKind; to: string }): Promise<void> {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  log.error({
    action: "email.send",
    email: { kind: email.kind, recipientHash: await hashRecipient(email.to) },
    error: { name: error instanceof Error ? error.name : typeof error, code },
  });
}
```

Run: `pnpm test apps/server/src/email-log.test.ts`
Expected: 2 tests pass.

- [ ] **Step 3: Wire the mailer**

In `apps/server/package.json` `dependencies`, add `"@jendal-workspace/email": "workspace:*"`, then run `pnpm install`.

Replace `apps/server/src/services.ts`:

```ts
import { createAuth as createConfiguredAuth } from "@jendal-workspace/auth";
import { type Database, createDb } from "@jendal-workspace/db";
import { createSmtpMailer } from "@jendal-workspace/email";

import { logEmailError } from "./email-log";
import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb({ DATABASE_URL: ENV.HYPERDRIVE.connectionString });
}

export function createAuth(database: Database, executionCtx: ExecutionContext) {
  return createConfiguredAuth(ENV, database, {
    mailer: createSmtpMailer(ENV),
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    onEmailError: logEmailError,
  });
}
```

In `apps/server/src/index.ts`:

1. Change `const auth = createAuth(db);` to `const auth = createAuth(db, c.executionCtx);`.
2. Change the tenant middleware path from `"/api/store"` to `"/api/store/*"` (Fact 10: it also matches `/api/store`).

Replace `apps/server/src/context.ts`:

```ts
import type { Context as ApiContext } from "@jendal-workspace/api/context";
import type { TenantEnvironment } from "@jendal-workspace/core";
import type { Context as HonoContext } from "hono";

import type { AppEnv } from "./app-env";

export async function createContext(c: HonoContext<AppEnv>, environment: TenantEnvironment): Promise<ApiContext> {
  const auth = c.get("auth");
  const headers = c.req.raw.headers;
  const session = await auth.api.getSession({ headers });
  return { db: c.get("db"), session, environment, auth, headers };
}
```

- [ ] **Step 4: Add the policy info route**

Replace `apps/server/src/routes/store-info.ts`:

```ts
import { findStorePolicyInfo } from "@jendal-workspace/db/repositories/stores";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

export const storeInfoRoute = new Hono<AppEnv>()
  .get("/api/store", (c) => {
    const store = c.get("store");
    if (!store) return c.json({ error: "not_a_store_host" }, 404);
    return c.json({ storeId: store.id, slug: store.slug, name: store.name });
  })
  .get("/api/store/policy-info", async (c) => {
    const store = c.get("store");
    if (!store) return c.json({ error: "not_a_store_host" }, 404);
    const info = await findStorePolicyInfo(c.get("db"), store.id);
    if (!info) return c.json({ error: "store_not_found" }, 404);
    return c.json({
      slug: store.slug,
      name: store.name,
      supportEmail: info.supportEmail,
      createdAt: info.createdAt.toISOString(),
    });
  });
```

- [ ] **Step 5: Add the settings**

Append to `apps/server/.env.schema`:

```
# SMTP server for account emails (verification, password reset). Port 587 uses STARTTLS; 465 fails in workerd.
# @public @type=string(minLength=1)
SMTP_HOST=

# @public @type=string(minLength=1)
SMTP_PORT=587

# @type=string(minLength=1)
SMTP_USER=

# @type=string(minLength=1)
SMTP_PASS=

# Sender of account emails, e.g. "Payleor <no-reply@payleor.app>".
# @public @type=string(minLength=3)
EMAIL_FROM=
```

In `packages/infra/.env.schema`, extend the `@import` pick list with `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM`, and append:

```
# Sandbox buyer login and test card shown on checkout pages. Sandbox-only values, meant to be public.
# Leave any of them empty and the banner shows only its default text.
# @public
SANDBOX_BUYER_EMAIL=
# @public
SANDBOX_BUYER_PASSWORD=
# @public
SANDBOX_CARD_NUMBER=
# @public
SANDBOX_CARD_EXPIRY=
# @public
SANDBOX_CARD_CVV=

# Slug of the seeded demo store, linked from the landing page. Leave empty to hide the link.
# @public
DEMO_STORE_SLUG=
```

In `packages/infra/alchemy.run.ts`, add a helper under the imports:

```ts
// Optional public settings; the web app treats "" as not set.
const optionalString = (name: string) => Config.String(name).pipe(Config.withDefault(""));
```

Add to the `server` Worker `env`:

```ts
    SMTP_HOST: Config.String("SMTP_HOST"),
    SMTP_PORT: Config.String("SMTP_PORT").pipe(Config.withDefault("587")),
    SMTP_USER: Config.String("SMTP_USER"),
    SMTP_PASS: Config.Redacted("SMTP_PASS"),
    EMAIL_FROM: Config.String("EMAIL_FROM"),
```

Add to the `Web` `env`:

```ts
    SANDBOX_BUYER_EMAIL: optionalString("SANDBOX_BUYER_EMAIL"),
    SANDBOX_BUYER_PASSWORD: optionalString("SANDBOX_BUYER_PASSWORD"),
    SANDBOX_CARD_NUMBER: optionalString("SANDBOX_CARD_NUMBER"),
    SANDBOX_CARD_EXPIRY: optionalString("SANDBOX_CARD_EXPIRY"),
    SANDBOX_CARD_CVV: optionalString("SANDBOX_CARD_CVV"),
    DEMO_STORE_SLUG: optionalString("DEMO_STORE_SLUG"),
```

In `turbo.json` `globalEnv`, add (keeping the list sorted): `DEMO_STORE_SLUG`, `EMAIL_FROM`, `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`, `SANDBOX_CARD_CVV`, `SANDBOX_CARD_EXPIRY`, `SANDBOX_CARD_NUMBER`, `SMTP_HOST`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_USER`.

- [ ] **Step 6: Ask the user for the SMTP values**

Stop and ask the user to add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` to `apps/server/.env`, and optionally the sandbox buyer, test card and `DEMO_STORE_SLUG` values to `packages/infra/.env`. Never print or echo these values. Check only that the keys exist:

```bash
grep -o '^SMTP_[A-Z]*=\|^EMAIL_FROM=' apps/server/.env
```

Expected: five keys listed.

- [ ] **Step 7: Regenerate env types and type check**

Run: `pnpm env:generate && pnpm check-types`
Expected: `apps/server/src/env.ts` gains the SMTP keys, and every package type-checks.

- [ ] **Step 8: Run all tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/server packages/infra/.env.schema packages/infra/alchemy.run.ts turbo.json pnpm-lock.yaml
git commit -m "feat(server): send account emails over SMTP, log failures with hashed recipients, serve store policy info" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 9: Web helpers

**Files:**
- Create: `apps/web/src/lib/platform-url.ts`, `sandbox-banner.ts`, `auth-flow.ts`, `slug-status.ts`, `legal-date.ts`, `use-debounced-value.ts`, `use-cooldown.ts`
- Test: `apps/web/src/lib/platform-url.test.ts`, `sandbox-banner.test.ts`, `auth-flow.test.ts`, `slug-status.test.ts`, `legal-date.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/platform-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { platformOrigins } from "./platform-url";

describe("platformOrigins", () => {
  it("uses http and keeps the port on local stages", () => {
    expect(platformOrigins("localhost", "admin.localhost:3001")).toEqual({
      site: "http://localhost:3001",
      admin: "http://admin.localhost:3001",
    });
  });

  it("uses https without a port on deployed and tunnel hosts", () => {
    expect(platformOrigins("payleor.app", "payleor.app")).toEqual({
      site: "https://payleor.app",
      admin: "https://admin.payleor.app",
    });
    expect(platformOrigins("elysiumjs.com", "admin.elysiumjs.com:443")).toEqual({
      site: "https://elysiumjs.com",
      admin: "https://admin.elysiumjs.com",
    });
  });
});
```

`apps/web/src/lib/sandbox-banner.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { SANDBOX_NOTICE, sandboxBannerContent } from "./sandbox-banner";

const all = {
  SANDBOX_BUYER_EMAIL: "buyer@example.com",
  SANDBOX_BUYER_PASSWORD: "buyer-password",
  SANDBOX_CARD_NUMBER: "4111111111111111",
  SANDBOX_CARD_EXPIRY: "12/2030",
  SANDBOX_CARD_CVV: "123",
};

describe("sandboxBannerContent", () => {
  it("shows the notice on ordinary pages", () => {
    expect(sandboxBannerContent("default", all)).toEqual({ kind: "notice", text: SANDBOX_NOTICE });
  });

  it("adds the buyer login and test card on checkout pages", () => {
    expect(sandboxBannerContent("checkout", all)).toEqual({
      kind: "checkout",
      text: SANDBOX_NOTICE,
      buyer: { email: "buyer@example.com", password: "buyer-password" },
      card: { number: "4111111111111111", expiry: "12/2030", cvv: "123" },
    });
  });

  it("falls back to the notice when any checkout value is missing", () => {
    expect(sandboxBannerContent("checkout", { ...all, SANDBOX_CARD_CVV: "" })).toEqual({
      kind: "notice",
      text: SANDBOX_NOTICE,
    });
  });
});
```

`apps/web/src/lib/auth-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { authErrorMessage, isEmailNotVerified, TOO_MANY_ATTEMPTS, verifyEmailPath } from "./auth-flow";

describe("auth flow helpers", () => {
  it("explains rate limits the same way everywhere", () => {
    expect(authErrorMessage({ status: 429, message: "Too many requests" }, "Fallback")).toBe(TOO_MANY_ATTEMPTS);
  });

  it("uses the server message, or the fallback when there is none", () => {
    expect(authErrorMessage({ status: 401, message: "Invalid email or password" }, "Fallback")).toBe(
      "Invalid email or password",
    );
    expect(authErrorMessage({ status: 500 }, "Fallback")).toBe("Fallback");
  });

  it("recognises an unverified email", () => {
    expect(isEmailNotVerified({ status: 403, code: "EMAIL_NOT_VERIFIED" })).toBe(true);
    expect(isEmailNotVerified({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(false);
  });

  it("builds the verify-email path with the address encoded", () => {
    expect(verifyEmailPath("ada+shop@example.com")).toBe("/verify-email?email=ada%2Bshop%40example.com");
  });
});
```

`apps/web/src/lib/slug-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { slugStatus } from "./slug-status";

const url = (slug: string) => `https://${slug}.payleor.site`;

describe("slugStatus", () => {
  it("shows nothing for an empty address", () => {
    expect(slugStatus("", undefined, url)).toBeNull();
  });

  it("shows a pending message until the check for this address returns", () => {
    expect(slugStatus("acme", undefined, url)).toEqual({ tone: "pending", text: "Checking the address…" });
  });

  it("shows the full URL when the address is available", () => {
    expect(slugStatus("acme", { status: "available", slug: "acme" }, url)).toEqual({
      tone: "available",
      text: "https://acme.payleor.site is available.",
    });
  });

  it("explains taken and invalid addresses", () => {
    expect(slugStatus("acme", { status: "taken", slug: "acme" }, url)).toEqual({
      tone: "problem",
      text: "This store address is already taken.",
    });
    expect(slugStatus("login", { status: "invalid", reason: "reserved" }, url)).toEqual({
      tone: "problem",
      text: "This store address is reserved.",
    });
  });
});
```

`apps/web/src/lib/legal-date.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatLegalDate } from "./legal-date";

describe("formatLegalDate", () => {
  it("formats in UTC so the date does not shift by time zone", () => {
    expect(formatLegalDate(new Date("2026-10-05T23:30:00Z"))).toBe("October 5, 2026");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test apps/web/src/lib`
Expected: the five new files FAIL (modules not found); `host-routing` and `store-url` tests pass.

- [ ] **Step 3: Implement**

`apps/web/src/lib/platform-url.ts`:

```ts
export type PlatformOrigins = { site: string; admin: string };

// Same rule as storeUrlParts: local stages use http and keep the port; deployed and tunnel hosts use https.
export function platformOrigins(platformDomain: string, requestHost: string): PlatformOrigins {
  const local = platformDomain === "localhost";
  const port = local ? (/:\d+$/.exec(requestHost)?.[0] ?? "") : "";
  const scheme = local ? "http://" : "https://";
  return { site: `${scheme}${platformDomain}${port}`, admin: `${scheme}admin.${platformDomain}${port}` };
}
```

`apps/web/src/lib/sandbox-banner.ts`:

```ts
export const SANDBOX_NOTICE = "Sandbox: payments use PayPal test accounts. No real money moves.";

export type SandboxSettings = {
  SANDBOX_BUYER_EMAIL?: string;
  SANDBOX_BUYER_PASSWORD?: string;
  SANDBOX_CARD_NUMBER?: string;
  SANDBOX_CARD_EXPIRY?: string;
  SANDBOX_CARD_CVV?: string;
};

export type SandboxBannerContent =
  | { kind: "notice"; text: string }
  | {
      kind: "checkout";
      text: string;
      buyer: { email: string; password: string };
      card: { number: string; expiry: string; cvv: string };
    };

export function sandboxBannerContent(variant: "default" | "checkout", settings: SandboxSettings): SandboxBannerContent {
  const email = settings.SANDBOX_BUYER_EMAIL;
  const password = settings.SANDBOX_BUYER_PASSWORD;
  const number = settings.SANDBOX_CARD_NUMBER;
  const expiry = settings.SANDBOX_CARD_EXPIRY;
  const cvv = settings.SANDBOX_CARD_CVV;
  if (variant === "checkout" && email && password && number && expiry && cvv) {
    return { kind: "checkout", text: SANDBOX_NOTICE, buyer: { email, password }, card: { number, expiry, cvv } };
  }
  return { kind: "notice", text: SANDBOX_NOTICE };
}
```

`apps/web/src/lib/auth-flow.ts`:

```ts
// Sign-up and "Send a new link" return here after verification. Sign-in must not pass it (Fact 14).
export const VERIFIED_EMAIL_REDIRECT = "/new";
export const RESET_PASSWORD_PATH = "/reset-password";
export const TOO_MANY_ATTEMPTS = "Too many attempts. Try again in a few minutes.";

export type AuthClientError = { status: number; code?: string | undefined; message?: string | undefined };

export function authErrorMessage(error: AuthClientError, fallback: string): string {
  if (error.status === 429) return TOO_MANY_ATTEMPTS;
  return error.message || fallback;
}

export function isEmailNotVerified(error: AuthClientError): boolean {
  return error.code === "EMAIL_NOT_VERIFIED";
}

export function verifyEmailPath(email: string): string {
  return `/verify-email?email=${encodeURIComponent(email)}`;
}
```

`apps/web/src/lib/slug-status.ts`:

```ts
import { storeSlugProblem } from "@jendal-workspace/core";

export type SlugCheckResult =
  | { status: "available"; slug: string }
  | { status: "taken"; slug: string }
  | { status: "invalid"; reason: "format" | "reserved" };

export type SlugStatus = { tone: "pending" | "available" | "problem"; text: string };

// `result` must be the check for `slug`, or undefined while that check is still running.
export function slugStatus(
  slug: string,
  result: SlugCheckResult | undefined,
  storeUrl: (slug: string) => string,
): SlugStatus | null {
  if (!slug) return null;
  if (!result) return { tone: "pending", text: "Checking the address…" };
  switch (result.status) {
    case "available":
      return { tone: "available", text: `${storeUrl(result.slug)} is available.` };
    case "taken":
      return { tone: "problem", text: storeSlugProblem("taken") };
    case "invalid":
      return { tone: "problem", text: storeSlugProblem(result.reason) };
  }
}
```

`apps/web/src/lib/legal-date.ts`:

```ts
export function formatLegalDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
}
```

`apps/web/src/lib/use-debounced-value.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

`apps/web/src/lib/use-cooldown.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

// Starts counting down on mount, because the page opens right after an email was sent.
export function useCooldown(seconds: number): { remaining: number; restart: () => void } {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return { remaining, restart: () => setRemaining(seconds) };
}
```

- [ ] **Step 4: Run tests and type check**

Run: `pnpm test apps/web/src/lib && pnpm -F web check-types`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib
git commit -m "feat(web): add platform URL, sandbox banner, auth flow, slug status and legal date helpers" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 10: Sandbox banner and layouts

**Files:**
- Create: `apps/web/src/components/sandbox-banner.tsx`
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/admin/layout.tsx`

- [ ] **Step 1: Create the banner**

`apps/web/src/components/sandbox-banner.tsx`:

```tsx
import { env } from "cloudflare:workers";

import { sandboxBannerContent } from "@/lib/sandbox-banner";

// Rendered by the root layout on every host. It cannot be dismissed (spec §4.3).
export default function SandboxBanner({ variant = "default" }: { variant?: "default" | "checkout" }) {
  const content = sandboxBannerContent(variant, env);
  return (
    <aside
      aria-label="Sandbox notice"
      className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <p>{content.text}</p>
      {content.kind === "checkout" ? (
        <dl className="mt-1 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs">
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
      ) : null}
    </aside>
  );
}
```

- [ ] **Step 2: Put it in the root layout**

In `apps/web/src/app/layout.tsx`, import the banner and change the `body`:

```tsx
import SandboxBanner from "@/components/sandbox-banner";
```

```tsx
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-svh flex-col antialiased`}>
        <PwaRegistration />
        <SandboxBanner />
        <Providers>{children}</Providers>
      </body>
```

- [ ] **Step 3: Let the admin layout fill the rest**

Replace `apps/web/src/app/admin/layout.tsx`:

```tsx
import Header from "@/components/header";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Header />
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Check it in the browser**

Start the dev stack in the background (`pnpm -F @jendal-workspace/infra dev`; restart with `kill $(pgrep -f 'alchemy/(bin|lib)')` if one is running). Open `http://admin.localhost:3001/login` and a store host such as `http://acme.localhost:3001` (any existing local store). Expected: the amber banner is at the top of both, stays visible when scrolling, and the admin header sits under it.

- [ ] **Step 5: Type check and commit**

Run: `pnpm -F web check-types`

```bash
git add apps/web/src/components/sandbox-banner.tsx apps/web/src/app/layout.tsx apps/web/src/app/admin/layout.tsx
git commit -m "feat(web): show the sandbox banner on every page" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 11: Auth pages

**Files:**
- Modify: `apps/web/src/lib/server-api.ts`, `apps/web/src/components/paypal-sign-in-button.tsx`
- Create: `apps/web/src/components/auth/{auth-card,or-divider,text-field,terms-notice,sign-in-form,sign-up-form,verify-email-panel,forgot-password-form,reset-password-form,invalid-reset-link}.tsx`
- Create: `apps/web/src/app/admin/(auth)/layout.tsx` and `login/`, `signup/`, `verify-email/`, `forgot-password/`, `reset-password/` `page.tsx`
- Delete: `apps/web/src/app/admin/login/page.tsx`, `apps/web/src/components/sign-in-form.tsx`, `apps/web/src/components/sign-up-form.tsx`

- [ ] **Step 1: Extend the server helpers**

Replace `apps/web/src/lib/server-api.ts`:

```ts
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { type PlatformOrigins, platformOrigins } from "./platform-url";
import { type StoreUrlParts, storeUrlParts } from "./store-url";

async function requestHost(): Promise<string> {
  return (await headers()).get("host") ?? "";
}

// The api Worker resolves stores from the original host, so the request keeps it.
export async function callApi(path: string, init?: RequestInit): Promise<Response> {
  const host = (await requestHost()) || "localhost";
  return env.SERVER.fetch(new Request(`http://${host}${path}`, init));
}

async function callApiAsUser(path: string): Promise<Response> {
  const cookie = (await headers()).get("cookie") ?? "";
  return callApi(path, { headers: { cookie } });
}

export async function getStoreUrlParts(): Promise<StoreUrlParts> {
  return storeUrlParts(env.STORE_DOMAIN, await requestHost());
}

export async function getPlatformOrigins(): Promise<PlatformOrigins> {
  return platformOrigins(env.PLATFORM_DOMAIN, await requestHost());
}

const storeInfoSchema = z.object({ storeId: z.string(), slug: z.string(), name: z.string() });
export type StoreInfo = z.infer<typeof storeInfoSchema>;

export async function fetchStoreInfo(): Promise<StoreInfo | null> {
  const response = await callApi("/api/store");
  if (!response.ok) return null;
  const parsed = storeInfoSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

const sessionSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
});
export type SessionInfo = z.infer<typeof sessionSchema>;

async function fetchSession(): Promise<SessionInfo | null> {
  const response = await callApiAsUser("/api/auth/get-session");
  const parsed = sessionSchema.safeParse(response.ok ? await response.json() : null);
  return parsed.success ? parsed.data : null;
}

export async function requireSession(): Promise<SessionInfo> {
  const session = await fetchSession();
  if (!session) redirect("/login");
  return session;
}

export async function redirectIfSignedIn(): Promise<void> {
  if (await fetchSession()) redirect("/");
}
```

- [ ] **Step 2: Shared auth components**

`apps/web/src/components/auth/auth-card.tsx`:

```tsx
export default function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
      {footer ? <div className="space-y-2 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
```

`apps/web/src/components/auth/or-divider.tsx`:

```tsx
export default function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
```

`apps/web/src/components/auth/text-field.tsx`:

```tsx
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";

export default function TextField({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-describedby={hint ? hintId : undefined} {...input} />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
```

`apps/web/src/components/auth/terms-notice.tsx`:

```tsx
// Legal pages live on the site host; auth stays on the admin host (spec §3).
export default function TermsNotice({ siteOrigin }: { siteOrigin: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      By continuing you agree to the{" "}
      <a href={`${siteOrigin}/legal/terms`} className="underline underline-offset-2">
        Terms of Service
      </a>{" "}
      and the{" "}
      <a href={`${siteOrigin}/legal/acceptable-use`} className="underline underline-offset-2">
        Acceptable Use Policy
      </a>
      .
    </p>
  );
}
```

`apps/web/src/components/auth/invalid-reset-link.tsx`:

```tsx
import Link from "next/link";

export default function InvalidResetLink() {
  return (
    <div className="space-y-2 text-sm">
      <p role="alert">This reset link is invalid or has expired.</p>
      <Link href="/forgot-password" className="underline underline-offset-4">
        Get a new link
      </Link>
    </div>
  );
}
```

Replace `apps/web/src/components/paypal-sign-in-button.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

// PayPal needs an HTTPS return URL, so this works on deployed hosts and the tunnel only (spec §5.3).
export default function PayPalSignInButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    // On success the client follows the redirect to PayPal, so the button stays disabled.
    const { error } = await authClient.signIn.social({ provider: "paypal", callbackURL: "/" });
    if (error) {
      setPending(false);
      toast.error(error.message ?? "Could not start PayPal sign-in.");
    }
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={signIn} disabled={pending}>
      {pending ? "Redirecting to PayPal…" : label}
    </Button>
  );
}
```

- [ ] **Step 3: Forms**

`apps/web/src/components/auth/sign-in-form.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage, isEmailNotVerified, verifyEmailPath } from "@/lib/auth-flow";

import TermsNotice from "./terms-notice";
import TextField from "./text-field";

export default function SignInForm({ siteOrigin }: { siteOrigin: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    setPending(true);
    setError(null);
    // No callbackURL: the client would redirect to it on success (Fact 14).
    const result = await authClient.signIn.email({ email, password: String(data.get("password") ?? "") });
    if (!result.error) {
      router.replace("/");
      return;
    }
    setPending(false);
    if (isEmailNotVerified(result.error)) {
      router.push(verifyEmailPath(email));
      return;
    }
    setError(authErrorMessage(result.error, "Could not log you in. Check your email and password."));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField id="email" name="email" label="Email" type="email" autoComplete="email" required />
      <TextField id="password" name="password" label="Password" type="password" autoComplete="current-password" required />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <TermsNotice siteOrigin={siteOrigin} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
```

`apps/web/src/components/auth/sign-up-form.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage, VERIFIED_EMAIL_REDIRECT, verifyEmailPath } from "@/lib/auth-flow";

import TermsNotice from "./terms-notice";
import TextField from "./text-field";

export default function SignUpForm({ siteOrigin }: { siteOrigin: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const result = await authClient.signUp.email({
      name: String(data.get("name") ?? "").trim(),
      email,
      password: String(data.get("password") ?? ""),
      callbackURL: VERIFIED_EMAIL_REDIRECT,
    });
    if (!result.error) {
      router.push(verifyEmailPath(email));
      return;
    }
    setPending(false);
    setError(authErrorMessage(result.error, "Could not create your account. Try again."));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField id="name" name="name" label="Your name" autoComplete="name" required minLength={2} />
      <TextField id="email" name="email" label="Email" type="email" autoComplete="email" required />
      <TextField
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <TermsNotice siteOrigin={siteOrigin} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
```

`apps/web/src/components/auth/verify-email-panel.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage, VERIFIED_EMAIL_REDIRECT } from "@/lib/auth-flow";
import { useCooldown } from "@/lib/use-cooldown";

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailPanel({ email }: { email: string }) {
  const { remaining, restart } = useCooldown(RESEND_COOLDOWN_SECONDS);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "status" | "alert"; text: string } | null>(null);

  async function resend() {
    setPending(true);
    setMessage(null);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: VERIFIED_EMAIL_REDIRECT });
    setPending(false);
    if (error) {
      setMessage({ tone: "alert", text: authErrorMessage(error, "Could not send the email. Try again.") });
      return;
    }
    setMessage({ tone: "status", text: "We sent a new link." });
    restart();
  }

  return (
    <div className="space-y-4 text-sm">
      <p>
        We sent a link to <strong className="font-medium">{email}</strong>. Open it to verify your address. The link
        expires in 1 hour.
      </p>
      <p className="text-muted-foreground">No email? Check your spam folder, or send a new link.</p>
      {message ? (
        <p role={message.tone} className={message.tone === "alert" ? "text-destructive" : undefined}>
          {message.text}
        </p>
      ) : null}
      <Button type="button" variant="outline" className="w-full" onClick={resend} disabled={pending || remaining > 0}>
        {remaining > 0 ? `Send a new link in ${remaining}s` : pending ? "Sending…" : "Send a new link"}
      </Button>
    </div>
  );
}
```

`apps/web/src/components/auth/forgot-password-form.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { RESET_PASSWORD_PATH, TOO_MANY_ATTEMPTS } from "@/lib/auth-flow";

import TextField from "./text-field";

export default function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const { error: requestError } = await authClient.requestPasswordReset({ email, redirectTo: RESET_PASSWORD_PATH });
    setPending(false);
    // Every other outcome shows the same confirmation, so the page never reveals whether an account exists.
    if (requestError?.status === 429) {
      setError(TOO_MANY_ATTEMPTS);
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <p role="status" className="text-sm">
        If an account exists for <strong className="font-medium">{sentTo}</strong>, we sent a link to reset your
        password. The link expires in 1 hour.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField id="email" name="email" label="Email" type="email" autoComplete="email" required />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
```

`apps/web/src/components/auth/reset-password-form.tsx`:

```tsx
"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-flow";

import InvalidResetLink from "./invalid-reset-link";
import TextField from "./text-field";

export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("password") ?? "");
    if (newPassword !== String(data.get("confirm") ?? "")) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword, token });
    if (!result.error) {
      router.replace("/login?reset=1");
      return;
    }
    setPending(false);
    if (result.error.code === "INVALID_TOKEN") {
      setInvalid(true);
      return;
    }
    setError(authErrorMessage(result.error, "Could not change your password. Try again."));
  }

  if (invalid) return <InvalidResetLink />;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField
        id="password"
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      <TextField id="confirm" name="confirm" label="Repeat the new password" type="password" autoComplete="new-password" required />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Pages**

`apps/web/src/app/admin/(auth)/layout.tsx`:

```tsx
import { redirectIfSignedIn } from "@/lib/server-api";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await redirectIfSignedIn();
  return (
    <main className="flex flex-1 justify-center px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
```

`apps/web/src/app/admin/(auth)/login/page.tsx`:

```tsx
import Link from "next/link";

import AuthCard from "@/components/auth/auth-card";
import OrDivider from "@/components/auth/or-divider";
import SignInForm from "@/components/auth/sign-in-form";
import PayPalSignInButton from "@/components/paypal-sign-in-button";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const [{ reset }, origins] = await Promise.all([searchParams, getPlatformOrigins()]);

  return (
    <AuthCard
      title="Log in to Payleor"
      footer={
        <>
          <p>
            <Link href="/forgot-password" className="underline underline-offset-4">
              Forgot your password?
            </Link>
          </p>
          <p>
            New to Payleor?{" "}
            <Link href="/signup" className="underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </>
      }
    >
      {reset === "1" ? (
        <p
          role="status"
          className="border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50"
        >
          Your password was changed. Log in with your new password.
        </p>
      ) : null}
      <SignInForm siteOrigin={origins.site} />
      <OrDivider />
      <PayPalSignInButton label="Log in with PayPal" />
    </AuthCard>
  );
}
```

`apps/web/src/app/admin/(auth)/signup/page.tsx`:

```tsx
import Link from "next/link";

import AuthCard from "@/components/auth/auth-card";
import OrDivider from "@/components/auth/or-divider";
import SignUpForm from "@/components/auth/sign-up-form";
import PayPalSignInButton from "@/components/paypal-sign-in-button";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function SignUpPage() {
  const origins = await getPlatformOrigins();

  return (
    <AuthCard
      title="Create your Payleor account"
      description="Free for 14 days. No setup fee."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-4">
            Log in
          </Link>
        </p>
      }
    >
      <SignUpForm siteOrigin={origins.site} />
      <OrDivider />
      <PayPalSignInButton label="Sign up with PayPal" />
    </AuthCard>
  );
}
```

`apps/web/src/app/admin/(auth)/verify-email/page.tsx`:

```tsx
import Link from "next/link";

import AuthCard from "@/components/auth/auth-card";
import VerifyEmailPanel from "@/components/auth/verify-email-panel";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;

  return (
    <AuthCard
      title="Check your inbox"
      footer={
        <p>
          <Link href="/login" className="underline underline-offset-4">
            Back to log in
          </Link>
        </p>
      }
    >
      {typeof email === "string" && email ? (
        <VerifyEmailPanel email={email} />
      ) : (
        <p className="text-sm">Log in or sign up to get a verification link.</p>
      )}
    </AuthCard>
  );
}
```

`apps/web/src/app/admin/(auth)/forgot-password/page.tsx`:

```tsx
import Link from "next/link";

import AuthCard from "@/components/auth/auth-card";
import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you signed up with. We'll send you a link to choose a new password."
      footer={
        <p>
          <Link href="/login" className="underline underline-offset-4">
            Back to log in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
```

`apps/web/src/app/admin/(auth)/reset-password/page.tsx`:

```tsx
import AuthCard from "@/components/auth/auth-card";
import InvalidResetLink from "@/components/auth/invalid-reset-link";
import ResetPasswordForm from "@/components/auth/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  return (
    <AuthCard title="Choose a new password">
      {typeof token === "string" && token && !error ? <ResetPasswordForm token={token} /> : <InvalidResetLink />}
    </AuthCard>
  );
}
```

- [ ] **Step 5: Remove the old login page and forms**

```bash
git rm apps/web/src/app/admin/login/page.tsx apps/web/src/components/sign-in-form.tsx apps/web/src/components/sign-up-form.tsx
rg -n "@tanstack/react-form" apps/web/src || pnpm -F web remove @tanstack/react-form
```

Expected: `rg` finds nothing, so the unused form library is removed.

- [ ] **Step 6: Type check**

Run: `pnpm -F web check-types`
Expected: no errors. If `redirect` is not typed `never` and `requireSession` fails to narrow, add `throw new Error("unreachable")` after the redirect call rather than a type assertion.

- [ ] **Step 7: Walk through the pages**

With the dev stack running and real SMTP settings:

1. `http://admin.localhost:3001/signup`: create an account with an inbox you can read. Expected: `/verify-email?email=…`, the resend button counts down from 60.
2. Open the email. Expected: the link signs you in and lands on `/new`. Until Task 12 builds that page, `/new` falls through to the store dashboard route and shows "Store not found"; that is fine here.
3. Sign out from the user menu, then log in. Expected: `/`.
4. `/forgot-password` with the same email, then with an unknown one. Expected: the same confirmation both times; one email arrives for the real account; its link opens `/reset-password?token=…`; changing the password lands on `/login?reset=1` with the confirmation.
5. Open `/reset-password?token=nope` and submit. Expected: "This reset link is invalid or has expired."
6. Submit `/login` with a wrong password six times within a minute. Expected: the sixth shows "Too many attempts. Try again in a few minutes."
7. While signed in, open `/login`. Expected: redirect to `/`.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add log in, sign up, email verification and password reset pages" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 12: "Create your store", admin home and checklist

**Files:**
- Modify: `apps/web/src/lib/server-api.ts`, `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`
- Create: `apps/web/src/app/admin/new/page.tsx`, `apps/web/src/app/admin/new/create-store-form.tsx`, `apps/web/src/components/setup-checklist.tsx`
- Delete: `apps/web/src/app/admin/stores-overview.tsx`, `apps/web/src/components/create-organization-form.tsx`, `apps/web/src/components/create-store-form.tsx`

- [ ] **Step 1: List stores on the server**

Append to `apps/web/src/lib/server-api.ts`:

```ts
const myStoresSchema = z.object({
  result: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        canCreateStores: z.boolean(),
        stores: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), status: z.string() })),
      }),
    ),
  }),
});
export type MyOrganization = z.infer<typeof myStoresSchema>["result"]["data"][number];

export async function listMyStores(): Promise<MyOrganization[]> {
  const response = await callApiAsUser("/trpc/store.listMine");
  if (!response.ok) throw new Error(`store.listMine answered ${response.status}`);
  return myStoresSchema.parse(await response.json()).result.data;
}
```

- [ ] **Step 2: The form**

`apps/web/src/app/admin/new/create-store-form.tsx`:

```tsx
"use client";

import { suggestStoreSlug } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@jendal-workspace/ui/components/input-group";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { slugStatus } from "@/lib/slug-status";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { trpc } from "@/utils/trpc";

const TONE_CLASS = {
  pending: "text-muted-foreground",
  available: "text-emerald-700 dark:text-emerald-400",
  problem: "text-destructive",
} as const;

export default function CreateStoreForm({ urlParts }: { urlParts: StoreUrlParts }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  // The address follows the name until the merchant edits it.
  const slug = (typedSlug ?? suggestStoreSlug(name)).trim().toLowerCase();
  const debouncedSlug = useDebouncedValue(slug, 300);

  const check = useQuery({
    ...trpc.store.checkSlug.queryOptions({ slug: debouncedSlug }),
    enabled: debouncedSlug.length > 0,
  });
  const create = useMutation(trpc.store.create.mutationOptions({ onSuccess: (store) => router.push(`/${store.slug}`) }));

  const settled = debouncedSlug === slug && !check.isFetching;
  const status = create.error
    ? { tone: "problem" as const, text: create.error.message }
    : slugStatus(slug, settled ? check.data : undefined, (s) => storeUrl(s, urlParts));
  const canSubmit = name.trim().length >= 2 && status?.tone === "available" && !create.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) create.mutate({ name: name.trim(), slug });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
      <div className="space-y-2">
        <Label htmlFor="store-name">Store name</Label>
        <Input
          id="store-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            create.reset();
          }}
          required
          minLength={2}
          maxLength={80}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="store-slug">Store URL</Label>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>{urlParts.prefix}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="store-slug"
            value={typedSlug ?? suggestStoreSlug(name)}
            onChange={(e) => {
              setTypedSlug(e.target.value);
              create.reset();
            }}
            placeholder="acme"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="store-slug-status"
            required
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{urlParts.suffix}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <p id="store-slug-status" aria-live="polite" className={`min-h-5 text-sm ${status ? TONE_CLASS[status.tone] : ""}`}>
          {status?.text}
        </p>
      </div>
      <Button type="submit" disabled={!canSubmit} className="justify-self-start">
        {create.isPending ? "Creating your store…" : "Create store"}
      </Button>
    </form>
  );
}
```

`apps/web/src/app/admin/new/page.tsx`:

```tsx
import { getStoreUrlParts, requireSession } from "@/lib/server-api";

import CreateStoreForm from "./create-store-form";

export default async function NewStorePage() {
  await requireSession();
  const urlParts = await getStoreUrlParts();

  return (
    <main className="container mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Create your store</h1>
      <p className="mt-1 text-sm text-muted-foreground">You can rename the store later. Its address cannot be changed.</p>
      <CreateStoreForm urlParts={urlParts} />
    </main>
  );
}
```

- [ ] **Step 3: Admin home**

Replace `apps/web/src/app/admin/page.tsx`:

```tsx
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getStoreUrlParts, listMyStores, requireSession } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", active: "Live", suspended: "Suspended" };

export default async function AdminHome() {
  await requireSession();
  const organizations = (await listMyStores()).filter((o) => o.stores.length > 0);
  if (organizations.length === 0) redirect("/new");
  const urlParts = await getStoreUrlParts();

  return (
    <main className="container mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your stores</h1>
        {organizations.some((o) => o.canCreateStores) ? (
          <Link href="/new" className={buttonVariants({ variant: "outline" })}>
            Create a store
          </Link>
        ) : null}
      </div>
      {organizations.map((organization) => (
        <section key={organization.id} aria-labelledby={`org-${organization.id}`} className="space-y-3">
          <h2 id={`org-${organization.id}`} className="text-sm font-medium text-muted-foreground">
            {organization.name}
          </h2>
          <ul className="divide-y border">
            {organization.stores.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/${store.slug}`} className="font-medium hover:underline">
                    {store.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">{storeUrl(store.slug, urlParts)}</p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">{STATUS_LABEL[store.status] ?? store.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 4: Checklist**

`apps/web/src/components/setup-checklist.tsx`:

```tsx
import { countDone, type SetupStep } from "@jendal-workspace/core";
import { Circle, CircleCheck } from "lucide-react";

export default function SetupChecklist({ steps }: { steps: readonly SetupStep[] }) {
  return (
    <section aria-labelledby="setup-heading" className="border p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="setup-heading" className="font-medium">
          Set up your store
        </h2>
        <p className="text-sm text-muted-foreground">
          {countDone(steps)} of {steps.length} done
        </p>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-sm">
            {step.done ? (
              <CircleCheck aria-hidden className="size-4 text-emerald-600" />
            ) : (
              <Circle aria-hidden className="size-4 text-muted-foreground" />
            )}
            <span className="sr-only">{step.done ? "Done:" : "To do:"}</span>
            {step.href ? (
              <a href={step.href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {step.label}
              </a>
            ) : (
              <span>{step.label}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

Replace `apps/web/src/app/admin/[storeSlug]/store-dashboard.tsx`:

```tsx
"use client";

import { setupSteps } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import SetupChecklist from "@/components/setup-checklist";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import { trpc } from "@/utils/trpc";

export default function StoreDashboard({ storeSlug, urlParts }: { storeSlug: string; urlParts: StoreUrlParts }) {
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

  const url = storeUrl(store.data.slug, urlParts);

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href="/" className="text-sm text-muted-foreground">
          All stores
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{store.data.name}</h1>
      </div>
      <SetupChecklist steps={setupSteps(store.data, { storefrontUrl: url })} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Store URL</dt>
        <dd>
          <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            {url}
          </a>
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{store.data.status === "draft" ? "Draft · Connect PayPal to start selling." : store.data.status}</dd>
        <dt className="text-muted-foreground">Your role</dt>
        <dd>{store.data.role}</dd>
        <dt className="text-muted-foreground">PayPal</dt>
        <dd>{store.data.paypalMerchantId ?? "Not connected"}</dd>
      </dl>
    </main>
  );
}
```

- [ ] **Step 5: Remove the W1-A forms**

```bash
git rm apps/web/src/app/admin/stores-overview.tsx apps/web/src/components/create-organization-form.tsx apps/web/src/components/create-store-form.tsx
```

- [ ] **Step 6: Type check and walk through**

Run: `pnpm -F web check-types`. Then, signed in as the account from Task 11 (no stores yet):

1. Open `http://admin.localhost:3001/`. Expected: redirect to `/new`.
2. Type "Café Noël". Expected: the address fills in as `cafe-noel`; after a moment "http://cafe-noel.localhost:3001 is available."
3. Change the address to `login`. Expected: "This store address is reserved." and the button disabled. Change it to an existing store's slug. Expected: "This store address is already taken."
4. Submit a free address. Expected: `/{slug}` with "1 of 3 done" and the storefront link.
5. Open `/`. Expected: the store list with "Create a store".

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): create a store in one form and show a setup checklist" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 13: Landing page and pricing

**Files:**
- Create: `apps/web/src/content/legal/meta.ts`, `apps/web/src/components/site/{site-header,site-footer,pricing}.tsx`, `apps/web/src/app/(site)/layout.tsx`, `apps/web/src/app/(site)/page.tsx`
- Delete: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Shared contact details**

`apps/web/src/content/legal/meta.ts`:

```ts
export const OPERATOR_NAME = "Mouhamed Bakhoum";
export const CONTACT_EMAIL = "bakhoumouhamed@gmail.com";
export const LEGAL_LAST_UPDATED = new Date("2026-10-05T00:00:00Z");
```

- [ ] **Step 2: Header and footer**

`apps/web/src/components/site/site-header.tsx`:

```tsx
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import Link from "next/link";

export default function SiteHeader({ adminOrigin }: { adminOrigin: string }) {
  return (
    <header className="border-b">
      <div className="container mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Payleor
        </Link>
        <nav aria-label="Main" className="flex items-center gap-5 text-sm">
          <a href="/#pricing" className="underline-offset-4 hover:underline">
            Pricing
          </a>
          <a href={`${adminOrigin}/login`} className="underline-offset-4 hover:underline">
            Log in
          </a>
          <a href={`${adminOrigin}/signup`} className={buttonVariants({ size: "sm" })}>
            Create your store
          </a>
        </nav>
      </div>
    </header>
  );
}
```

`apps/web/src/components/site/site-footer.tsx`:

```tsx
import Link from "next/link";

import { CONTACT_EMAIL } from "@/content/legal/meta";

export default function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/legal/terms" className="hover:text-foreground">
            Terms of Service
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link href="/legal/acceptable-use" className="hover:text-foreground">
            Acceptable Use Policy
          </Link>
        </nav>
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground">
            {CONTACT_EMAIL}
          </a>{" "}
          · © 2026 Payleor
        </p>
      </div>
    </footer>
  );
}
```

`apps/web/src/app/(site)/layout.tsx`:

```tsx
import SiteFooter from "@/components/site/site-footer";
import SiteHeader from "@/components/site/site-header";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { admin } = await getPlatformOrigins();
  return (
    <>
      <SiteHeader adminOrigin={admin} />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 3: Pricing**

`apps/web/src/components/site/pricing.tsx`:

```tsx
"use client";

import { type BillingInterval, formatOrderFee, formatPlanPrice, PLANS, TRIAL_DAYS } from "@jendal-workspace/core";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Check } from "lucide-react";
import { useState } from "react";

const INTERVALS: Array<{ id: BillingInterval; label: string }> = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly · save about 25%" },
];

export default function Pricing({ signupUrl }: { signupUrl: string }) {
  const [billing, setBilling] = useState<BillingInterval>("monthly");

  return (
    <div className="space-y-8">
      <div role="group" aria-label="Billing period" className="mx-auto flex w-fit border p-1">
        {INTERVALS.map((interval) => (
          <button
            key={interval.id}
            type="button"
            aria-pressed={billing === interval.id}
            onClick={() => setBilling(interval.id)}
            className="px-4 py-1.5 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {interval.label}
          </button>
        ))}
      </div>
      <ul className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <li key={plan.id} className="flex flex-col border p-6">
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <p className="mt-4">
              <span className="text-4xl font-semibold tabular-nums">{formatPlanPrice(plan.priceCents[billing])}</span>
              <span className="text-muted-foreground"> /month</span>
            </p>
            <p className="mt-1 min-h-5 text-sm text-muted-foreground">
              {billing === "yearly" ? `Billed yearly at ${formatPlanPrice(plan.priceCents.yearly * 12)}` : "Billed monthly"}
            </p>
            <p className="mt-3 text-sm font-medium">+ {formatOrderFee(plan.orderFeeBps)} per order</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {plan.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {highlight}
                </li>
              ))}
            </ul>
            <a href={signupUrl} className={`${buttonVariants({ size: "lg" })} mt-6 w-full`}>
              Start free trial
            </a>
          </li>
        ))}
      </ul>
      <div className="space-y-1 text-center text-sm text-muted-foreground">
        <p>{TRIAL_DAYS}-day free trial. No setup fee.</p>
        <p>PayPal's processing fees apply and are charged by PayPal.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Landing page**

`apps/web/src/app/(site)/page.tsx`:

```tsx
import { env } from "cloudflare:workers";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Bot, Scale, Store, Wallet } from "lucide-react";
import type { Metadata } from "next";

import Pricing from "@/components/site/pricing";
import { getPlatformOrigins, getStoreUrlParts } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

export const metadata: Metadata = {
  title: "Payleor: sell to people and AI shoppers, paid through PayPal",
  description: "A store that sells on the web, in ChatGPT and Claude, and to AI shopping agents. Payments go straight to your PayPal account.",
};

const STEPS = [
  { title: "Create your store", text: "Pick a name and an address. It takes a minute." },
  { title: "Connect PayPal", text: "Link your PayPal business account. Buyers pay you directly." },
  { title: "Sell everywhere", text: "Your storefront, ChatGPT, Claude and AI shopping agents all sell the same catalog." },
];

const FEATURES = [
  {
    icon: Bot,
    title: "Agent checkout protocols",
    text: "Store Sync, ACP, UCP and AP2, so AI shoppers can find your products and check out.",
  },
  {
    icon: Scale,
    title: "A dispute agent",
    text: "It gathers the order evidence and drafts your reply before PayPal's deadline. You approve every reply.",
  },
  {
    icon: Wallet,
    title: "Paid straight to you",
    text: "Payments land in your PayPal account. Payleor never holds your money.",
  },
  {
    icon: Store,
    title: "Several stores per team",
    text: "Run more than one store from one account, and give staff access store by store.",
  },
];

export default async function LandingPage() {
  const [{ admin }, urlParts] = await Promise.all([getPlatformOrigins(), getStoreUrlParts()]);
  const signupUrl = `${admin}/signup`;
  const demoUrl = env.DEMO_STORE_SLUG ? storeUrl(env.DEMO_STORE_SLUG, urlParts) : null;

  return (
    <main>
      <section className="container mx-auto max-w-5xl px-4 py-20 text-center sm:py-28">
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Sell to people and to their AI shoppers
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground text-pretty">
          Payleor gives you a store that takes PayPal payments on the web, inside ChatGPT and Claude, and from AI
          agents. Payments go straight to your PayPal account.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <a href={signupUrl} className={buttonVariants({ size: "lg" })}>
            Create your store
          </a>
          {demoUrl ? (
            <a href={demoUrl} className={buttonVariants({ size: "lg", variant: "outline" })}>
              See the demo store
            </a>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="how-heading" className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <p className="text-sm font-medium text-muted-foreground tabular-nums">Step {index + 1}</p>
                <h3 className="mt-1 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="features-heading" className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="features-heading" className="text-2xl font-semibold tracking-tight">
            Built for agentic commerce
          </h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex gap-4">
                <feature.icon aria-hidden className="mt-0.5 size-5 shrink-0" />
                <div>
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-16 border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 id="pricing-heading" className="text-center text-2xl font-semibold tracking-tight">
            One plan per store
          </h2>
          <p className="mt-2 text-center text-muted-foreground">Pay monthly or yearly. The order fee drops as you grow.</p>
          <div className="mt-10">
            <Pricing signupUrl={signupUrl} />
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="container mx-auto max-w-5xl px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Open your store today</h2>
          <p className="mt-2 text-muted-foreground">Start your 14-day free trial. No setup fee.</p>
          <a href={signupUrl} className={`${buttonVariants({ size: "lg" })} mt-6`}>
            Create your store
          </a>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Remove the scaffold page**

```bash
git rm apps/web/src/app/page.tsx
```

- [ ] **Step 6: Type check and look at it**

Run: `pnpm -F web check-types`. Open `http://localhost:3001/`. Expected: hero, how it works, features, pricing with the toggle (Starter $12 → $9 yearly, "Billed yearly at $108"; Grow $39 → $29; Scale $129 → $99; fees 2%, 1%, 0.5%), closing call to action, footer. "Create your store" goes to `http://admin.localhost:3001/signup`. Without `DEMO_STORE_SLUG`, there is no demo button.

- [ ] **Step 7: Refine the visuals and copy, then get approval**

Load the `frontend-design` (or `hallmark`) skill and the `better-writing` skill. Improve the layout, type scale and spacing within the existing tokens; keep every section, link and number above. Check the page at 375 px and 1280 px wide, in light and dark mode. Take a screenshot of each and show them to the user. **Do not commit until the user approves the landing page** (spec §4.1).

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): add the landing page with live pricing from core" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 14: Platform legal pages

**Files:**
- Create: `apps/web/src/components/legal/{prose,mdx-components,legal-page}.tsx`
- Create: `apps/web/src/content/legal/{terms,privacy,acceptable-use}.mdx`
- Create: `apps/web/src/app/(site)/legal/{terms,privacy,acceptable-use}/page.tsx`

- [ ] **Step 1: Prose components and page layout**

`apps/web/src/components/legal/prose.tsx`:

```tsx
export function H2(props: React.ComponentProps<"h2">) {
  return <h2 {...props} className="mt-10 text-xl font-semibold tracking-tight" />;
}

export function P(props: React.ComponentProps<"p">) {
  return <p {...props} className="leading-relaxed" />;
}

export function UL(props: React.ComponentProps<"ul">) {
  return <ul {...props} className="list-disc space-y-1 pl-6" />;
}

export function OL(props: React.ComponentProps<"ol">) {
  return <ol {...props} className="list-decimal space-y-1 pl-6" />;
}

export function LI(props: React.ComponentProps<"li">) {
  return <li {...props} className="leading-relaxed" />;
}

export function A(props: React.ComponentProps<"a">) {
  return <a {...props} className="underline underline-offset-4" />;
}

export function Strong(props: React.ComponentProps<"strong">) {
  return <strong {...props} className="font-semibold" />;
}
```

`apps/web/src/components/legal/mdx-components.tsx`:

```tsx
import type { MDXComponents } from "mdx/types";

import { A, H2, LI, OL, P, Strong, UL } from "./prose";

export const legalMdxComponents: MDXComponents = { h2: H2, p: P, ul: UL, ol: OL, li: LI, a: A, strong: Strong };
```

`apps/web/src/components/legal/legal-page.tsx`:

```tsx
import { formatLegalDate } from "@/lib/legal-date";

export default function LegalPage({
  title,
  subtitle,
  updatedOn,
  children,
}: {
  title: string;
  subtitle?: string;
  updatedOn: Date;
  children: React.ReactNode;
}) {
  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      {subtitle ? <p className="mt-1 text-muted-foreground">{subtitle}</p> : null}
      <p className="mt-2 text-sm text-muted-foreground">Last updated {formatLegalDate(updatedOn)}</p>
      <div className="mt-8 space-y-4">{children}</div>
      <p className="mt-12 border-t pt-4 text-sm text-muted-foreground">This text is a template and is not legal advice.</p>
    </main>
  );
}
```

- [ ] **Step 2: Terms of Service**

`apps/web/src/content/legal/terms.mdx`:

```mdx
These terms are an agreement between you and Mouhamed Bakhoum, who operates Payleor as an individual ("Payleor", "we", "us"). They apply when you create an account or use Payleor, including payleor.app, admin.payleor.app and the store addresses we host. Contact: [bakhoumouhamed@gmail.com](mailto:bakhoumouhamed@gmail.com).

## 1. What Payleor provides

Payleor lets merchants run online stores that sell to people and to AI shopping agents. A store can have a storefront, apps for ChatGPT and Claude, and endpoints for agent checkout protocols. Payments are processed by PayPal.

## 2. Your account

- You must be at least 18 and able to enter into a contract.
- Give accurate details and keep your password secret. You are responsible for what happens under your account and in your stores.
- Each store belongs to an organization. The organization's owners and admins control the store and decide who can access it.

## 3. Plans, trial and billing

- Each store has its own plan: Starter, Grow or Scale, billed monthly or yearly. Prices are listed on [payleor.app](/#pricing).
- A new store gets a 14-day free trial with Starter's limits. When the trial ends, choose a plan to keep selling.
- Plans are billed through PayPal Subscriptions and renew automatically at the end of each period until you cancel.
- You can cancel at any time. The plan stays active until the end of the period you paid for. We do not refund partial periods.
- If a payment fails, PayPal retries it and the store keeps selling for 7 days. After that, the store stops taking orders until the plan is paid. Your admin stays available.
- We may change prices with at least 30 days' notice by email. A new price applies from your next billing period.

## 4. Order fees

For each order paid through your store, Payleor takes a fee of 2% on Starter, 1% on Grow and 0.5% on Scale. PayPal deducts it from the payment as a partner fee, so you receive the payment minus this fee and minus PayPal's own fees.

## 5. Payments and PayPal

- You need your own PayPal business account, and you accept PayPal's terms when you connect it. Your contract for payment processing is with PayPal.
- Buyers pay you directly. Payleor is not a payment processor and never holds your funds.
- Refunds, disputes and chargebacks are between you, the buyer and PayPal. Payleor's tools help you handle them.

## 6. AI agents

Payleor includes AI agents that help shoppers and merchants. An agent never captures a payment, issues a refund or accepts a dispute without confirmation from a person. AI output can be wrong, so check what an agent drafts before you approve it.

## 7. Your content and responsibilities

- You keep ownership of your products, images, text and data. You let us host, copy and display them as needed to run your stores.
- You are the seller. You are responsible for your products, prices, taxes, shipping and returns, and for following the laws that apply to your sales.
- You must follow the [Acceptable Use Policy](/legal/acceptable-use).

## 8. Our intellectual property

Payleor's software, design and brand belong to us. These terms give you the right to use the service, not to copy or resell it.

## 9. Suspension and closing an account

- You can close your account at any time by contacting us.
- We may suspend or close a store or an account that breaks these terms or the Acceptable Use Policy, or when the law or PayPal requires it. Where we can, we tell you first and give you a chance to fix the problem.
- After an account is closed, you can ask for an export of your store data for 30 days. After that we delete it, except what the law requires us to keep.

## 10. The service is provided as is

We work to keep Payleor available and secure, but we do not promise that it will be uninterrupted or free of errors. To the extent the law allows, we give no warranties beyond those in these terms.

## 11. Limits of liability

To the extent the law allows, we are not liable for indirect losses, such as lost profits, lost data or lost business. Our total liability for any claim is limited to the fees you paid us for the affected store in the 12 months before the claim. Nothing in these terms limits liability that the law does not allow us to limit.

## 12. Governing law and disputes

These terms are governed by the laws of Senegal. Before going to court, contact us so we can try to resolve the problem. If we cannot, the courts of Dakar have jurisdiction.

## 13. Changes to these terms

We may update these terms. We announce material changes by email and on this page at least 30 days before they take effect. If you keep using Payleor after that, the new terms apply.
```

- [ ] **Step 3: Privacy Policy**

`apps/web/src/content/legal/privacy.mdx`:

```mdx
This policy explains how Mouhamed Bakhoum, who operates Payleor as an individual ("Payleor", "we"), handles personal data. Contact: [bakhoumouhamed@gmail.com](mailto:bakhoumouhamed@gmail.com).

## 1. What we collect

- **Account details:** your name, email address and password (stored only as a hash). If you sign in with PayPal, also your PayPal account ID and email.
- **Store data:** store names and settings, products, orders, and the buyer details each order needs, such as name, email and shipping address.
- **Logs:** technical records of requests and errors. We remove or hash personal data, such as email addresses, before it reaches our logs.
- **Payment data:** card and bank details go to PayPal, not to us. We receive payment status and IDs from PayPal.

## 2. Why we use it

- To run your account and stores and process orders, as part of our contract with you.
- To send account emails, such as verification and password reset links.
- To keep the service secure and prevent fraud and abuse, which is our legitimate interest.
- To meet legal obligations, such as keeping billing records.

We do not sell personal data or use it for advertising.

## 3. Merchants and buyers

For buyer data in a store, the merchant decides how it is used and is responsible for it. Payleor processes it on the merchant's behalf. Buyers should read the store's privacy policy and contact the store first.

## 4. Who processes data for us

- **Cloudflare:** hosting, networking, storage and AI Gateway.
- **Aiven:** the database.
- **PayPal:** payments, Log in with PayPal, and billing for Payleor plans.
- **Our email provider:** account emails, sent over SMTP.
- **AI model providers**, reached through Cloudflare AI Gateway: they run the AI agents and receive only the data a task needs.

Each of them processes data under its own terms and data protection commitments.

## 5. How long we keep it

- Account and store data: while the account is open, then 30 days for exports, then deleted.
- Order and billing records: as long as tax and accounting law requires.
- Logs: up to 30 days.

## 6. Your rights

Under Senegal's Law No. 2008-12 of 25 January 2008 on the protection of personal data, you can ask to access, correct or delete your data, and you can object to its processing. Email us and we reply within 30 days. You can also complain to the Commission de Protection des Données Personnelles (CDP).

## 7. Transfers outside Senegal

Our processors store and process data in other countries, including the United States and the European Union. We use providers that commit to protecting it.

## 8. Cookies

We use only the cookies needed to keep you signed in and to secure your session. We do not use tracking or advertising cookies.

## 9. Security

Data is encrypted in transit. Passwords are stored only as hashes. Access to production data is limited to the operator.

## 10. Governing law

This policy is governed by the laws of Senegal.

## 11. Changes

We announce material changes by email and on this page before they take effect.
```

- [ ] **Step 4: Acceptable Use Policy**

`apps/web/src/content/legal/acceptable-use.mdx`:

```mdx
This policy lists what you may not do with Payleor. It is part of the [Terms of Service](/legal/terms). Payleor is operated by Mouhamed Bakhoum. Report abuse to [bakhoumouhamed@gmail.com](mailto:bakhoumouhamed@gmail.com).

## 1. Prohibited goods and services

You may not sell anything that PayPal prohibits under its [Acceptable Use Policy](https://www.paypal.com/us/legalhub/paypal/acceptableuse-full). This includes, among other things:

- illegal drugs and drug paraphernalia, and prescription drugs sold without the required authorisation
- weapons, ammunition and explosives where their sale is restricted
- stolen goods, counterfeits, and items that infringe someone's intellectual property
- content that sexually exploits minors, and any other illegal content
- gambling, lotteries and get-rich-quick schemes without the required licences
- items that promote hate, violence or discrimination

Some categories, such as alcohol or tobacco, are allowed only where the law and PayPal allow them, and you must follow those rules.

## 2. Fraud and deceptive listings

- Do not mislead buyers about products, prices, delivery or who you are.
- Do not take payments for goods you do not intend to deliver.
- Do not use fake reviews, hidden fees or misleading claims.

## 3. Agents and commerce protocols

- Do not give AI agents false product, price or stock data, or instructions meant to manipulate shoppers' agents.
- Do not use Payleor's agent endpoints (Store Sync, ACP, UCP, AP2 and MCP) to place fake orders or to test stolen payment details.
- Do not try to make an agent move money without the confirmation it requires.

## 4. Attacks and scraping

- Do not probe, scan or test the security of Payleor, or try to access accounts, stores or data that are not yours. If you find a vulnerability, report it to us privately.
- Do not overload the service, get around its rate limits, or scrape it with automated tools beyond the public APIs and protocols.
- Do not upload malware or use Payleor to send spam.

## 5. What happens on a breach

We may remove listings, suspend a store or close an account that breaks this policy. Where the risk allows, we tell you first and give you time to fix the problem. We may report illegal activity to the authorities and to PayPal.

## 6. Governing law

This policy is governed by the laws of Senegal, like the Terms of Service.
```

- [ ] **Step 5: Routes**

`apps/web/src/app/(site)/legal/terms/page.tsx`:

```tsx
import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";
import Terms from "@/content/legal/terms.mdx";

export const metadata: Metadata = { title: "Terms of Service · Payleor" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updatedOn={LEGAL_LAST_UPDATED}>
      <Terms components={legalMdxComponents} />
    </LegalPage>
  );
}
```

`apps/web/src/app/(site)/legal/privacy/page.tsx`:

```tsx
import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";
import Privacy from "@/content/legal/privacy.mdx";

export const metadata: Metadata = { title: "Privacy Policy · Payleor" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updatedOn={LEGAL_LAST_UPDATED}>
      <Privacy components={legalMdxComponents} />
    </LegalPage>
  );
}
```

`apps/web/src/app/(site)/legal/acceptable-use/page.tsx`:

```tsx
import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import AcceptableUse from "@/content/legal/acceptable-use.mdx";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";

export const metadata: Metadata = { title: "Acceptable Use Policy · Payleor" };

export default function AcceptableUsePage() {
  return (
    <LegalPage title="Acceptable Use Policy" updatedOn={LEGAL_LAST_UPDATED}>
      <AcceptableUse components={legalMdxComponents} />
    </LegalPage>
  );
}
```

- [ ] **Step 6: Type check and look at them**

Run: `pnpm -F web check-types`. Open `http://localhost:3001/legal/terms`, `/legal/privacy` and `/legal/acceptable-use`. Expected: the dev log shows "[vinext] Auto-injected @mdx-js/rollup for on-demand MDX support"; each page has its title, "Last updated October 5, 2026", styled headings and lists, and the template note; the footer links work. Open the PayPal Acceptable Use Policy link and confirm it loads a PayPal page; if it redirects elsewhere, use the final URL. `http://admin.localhost:3001/legal/terms` must return 404.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/legal apps/web/src/content/legal apps/web/src/app/\(site\)/legal
git commit -m "feat(web): add the Terms of Service, Privacy Policy and Acceptable Use Policy" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 15: Store policies

**Files:**
- Modify: `apps/web/src/lib/server-api.ts`
- Create: `apps/web/src/content/store-policies/{shared,returns,shipping,terms,privacy}.tsx`, `apps/web/src/content/store-policies/index.ts`
- Create: `apps/web/src/app/store/policies/[policy]/page.tsx`, `apps/web/src/app/store/layout.tsx`

- [ ] **Step 1: Fetch the policy info**

Append to `apps/web/src/lib/server-api.ts`:

```ts
const storePolicyInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  supportEmail: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type StorePolicyInfo = z.infer<typeof storePolicyInfoSchema>;

export async function fetchStorePolicyInfo(): Promise<StorePolicyInfo | null> {
  const response = await callApi("/api/store/policy-info");
  if (!response.ok) return null;
  const parsed = storePolicyInfoSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}
```

- [ ] **Step 2: Templates**

`apps/web/src/content/store-policies/shared.tsx`:

```tsx
import { A } from "@/components/legal/prose";

export type PolicyStore = { name: string; url: string; supportEmail: string | null };

export function StoreContact({ store }: { store: PolicyStore }) {
  if (!store.supportEmail) return <>the contact details on this website</>;
  return <A href={`mailto:${store.supportEmail}`}>{store.supportEmail}</A>;
}

export function StoreLink({ store }: { store: PolicyStore }) {
  return <A href={store.url}>{store.url}</A>;
}
```

`apps/web/src/content/store-policies/returns.tsx`:

```tsx
import { H2, LI, OL, P } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "./shared";

export default function ReturnsPolicy({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        This policy explains how to return items bought from {store.name} at <StoreLink store={store} />.
      </P>
      <H2>Returns within 30 days</H2>
      <P>
        You can return most items within 30 days of delivery. Items must be unused and in their original condition and
        packaging, with proof of purchase.
      </P>
      <P>Digital products and gift cards cannot be returned once delivered.</P>
      <H2>How to return an item</H2>
      <OL>
        <LI>
          Contact us at <StoreContact store={store} /> with your order number and the items you want to return.
        </LI>
        <LI>We reply with the return address and instructions.</LI>
        <LI>Send the items back. Unless an item arrived damaged or wrong, you pay for return shipping.</LI>
      </OL>
      <H2>Refunds</H2>
      <P>
        Once we receive and check the items, we refund your original PayPal payment, usually within 5 business days.
        PayPal returns the money to the account or card you paid with.
      </P>
      <H2>Damaged or wrong items</H2>
      <P>
        If an item arrives damaged or is not what you ordered, contact us within 7 days of delivery with a photo. We
        send a replacement or refund you in full, including shipping.
      </P>
    </>
  );
}
```

`apps/web/src/content/store-policies/shipping.tsx`:

```tsx
import { H2, P } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "./shared";

export default function ShippingPolicy({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        This policy explains how {store.name} ships orders placed at <StoreLink store={store} />.
      </P>
      <H2>Processing time</H2>
      <P>
        We prepare orders within 2 business days. Orders placed on a weekend or public holiday are prepared on the next
        business day.
      </P>
      <H2>Delivery options and rates</H2>
      <P>Shipping options, rates and estimated delivery times are shown at checkout before you pay.</P>
      <H2>Tracking</H2>
      <P>When your order ships, we email you a tracking link if the carrier provides one.</P>
      <H2>International orders</H2>
      <P>
        Customs duties and import taxes are set by the destination country and paid by the buyer, unless checkout says
        otherwise.
      </P>
      <H2>Lost or late parcels</H2>
      <P>
        If your order has not arrived by the estimated date, contact us at <StoreContact store={store} />. We work with
        the carrier to find it, or send a replacement or a refund.
      </P>
    </>
  );
}
```

`apps/web/src/content/store-policies/terms.tsx`:

```tsx
import { A, H2, P } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "./shared";

export default function StoreTerms({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        These terms apply to purchases from {store.name} at <StoreLink store={store} />.
      </P>
      <H2>Who you are buying from</H2>
      <P>
        {store.name} is the seller of the products on this website. Payleor provides the online store platform and does
        not sell, ship or guarantee the products.
      </P>
      <H2>Orders and prices</H2>
      <P>
        Prices, taxes and shipping costs are shown at checkout before you pay. Your order is accepted when we confirm it
        by email. If a product cannot be supplied or a price was clearly wrong, we may cancel the order and refund you
        in full.
      </P>
      <H2>Payment</H2>
      <P>Payments are processed by PayPal. We never see or store your card details.</P>
      <H2>Orders placed by AI agents</H2>
      <P>
        You can buy through AI assistants and shopping agents. An order that an agent places on your behalf is your
        order. The agent must ask for your confirmation before it pays.
      </P>
      <H2>Returns and shipping</H2>
      <P>
        See our <A href="/policies/returns">return policy</A> and <A href="/policies/shipping">shipping policy</A>.
      </P>
      <H2>Your rights</H2>
      <P>Nothing in these terms limits the rights you have as a consumer under the law.</P>
      <H2>Contact</H2>
      <P>
        Questions about an order: <StoreContact store={store} />.
      </P>
    </>
  );
}
```

`apps/web/src/content/store-policies/privacy.tsx`:

```tsx
import { H2, LI, P, UL } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "./shared";

export default function StorePrivacy({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        This policy explains how {store.name} handles your personal data when you shop at <StoreLink store={store} />.
      </P>
      <H2>Who is responsible</H2>
      <P>
        {store.name} controls the personal data you give when you shop here. Payleor, the platform that runs this store,
        processes it on the store's behalf.
      </P>
      <H2>What we collect</H2>
      <UL>
        <LI>your name and email address</LI>
        <LI>your shipping address</LI>
        <LI>your order history</LI>
        <LI>messages you send us</LI>
      </UL>
      <P>Card and bank details go to PayPal and are not shared with us.</P>
      <H2>Why we use it</H2>
      <P>
        To process and deliver your order, answer your questions, handle returns and keep the records the law requires.
        We do not sell your data.
      </P>
      <H2>Who we share it with</H2>
      <UL>
        <LI>PayPal, to take your payment</LI>
        <LI>shipping carriers, to deliver your order</LI>
        <LI>Payleor, which hosts this store</LI>
      </UL>
      <H2>How long we keep it</H2>
      <P>We keep order records as long as tax and accounting law requires, and delete other data when we no longer need it.</P>
      <H2>Your rights</H2>
      <P>
        You can ask to see, correct or delete your data, or object to how it is used. Contact us at{" "}
        <StoreContact store={store} />.
      </P>
      <H2>Cookies</H2>
      <P>This store uses only the cookies needed to run the store and checkout. It does not use tracking cookies.</P>
    </>
  );
}
```

`apps/web/src/content/store-policies/index.ts`:

```ts
import type { StorePolicy } from "@jendal-workspace/core";

import PrivacyPolicy from "./privacy";
import ReturnsPolicy from "./returns";
import type { PolicyStore } from "./shared";
import ShippingPolicy from "./shipping";
import StoreTerms from "./terms";

export const STORE_POLICY_PAGES: Record<
  StorePolicy,
  { title: string; Body: (props: { store: PolicyStore }) => React.ReactNode }
> = {
  returns: { title: "Return policy", Body: ReturnsPolicy },
  shipping: { title: "Shipping policy", Body: ShippingPolicy },
  terms: { title: "Terms of service", Body: StoreTerms },
  privacy: { title: "Privacy policy", Body: PrivacyPolicy },
};
```

- [ ] **Step 3: Route and storefront footer**

`apps/web/src/app/store/policies/[policy]/page.tsx`:

```tsx
import { isStorePolicy } from "@jendal-workspace/core";
import { notFound } from "next/navigation";

import LegalPage from "@/components/legal/legal-page";
import { STORE_POLICY_PAGES } from "@/content/store-policies";
import { fetchStorePolicyInfo, getStoreUrlParts } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

export default async function StorePolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy } = await params;
  if (!isStorePolicy(policy)) notFound();
  const info = await fetchStorePolicyInfo();
  if (!info) notFound();

  const { title, Body } = STORE_POLICY_PAGES[policy];
  const store = { name: info.name, url: storeUrl(info.slug, await getStoreUrlParts()), supportEmail: info.supportEmail };

  return (
    <LegalPage title={title} subtitle={info.name} updatedOn={new Date(info.createdAt)}>
      <Body store={store} />
    </LegalPage>
  );
}
```

`apps/web/src/app/store/layout.tsx`:

```tsx
import { STORE_POLICIES } from "@jendal-workspace/core";
import Link from "next/link";

import { STORE_POLICY_PAGES } from "@/content/store-policies";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="flex-1">{children}</div>
      <footer className="border-t">
        <div className="container mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Store policies" className="flex flex-wrap gap-x-5 gap-y-2">
            {STORE_POLICIES.map((policy) => (
              <Link key={policy} href={`/policies/${policy}`} className="hover:text-foreground">
                {STORE_POLICY_PAGES[policy].title}
              </Link>
            ))}
          </nav>
          <p>Powered by Payleor</p>
        </div>
      </footer>
    </>
  );
}
```

- [ ] **Step 4: Type check and look at them**

Run: `pnpm -F web check-types`. Open the store created in Task 12 at `http://{slug}.localhost:3001/`. Expected: the footer lists the four policies; each opens with the store's name, its URL, its support email (the creator's), the creation date as "Last updated", and the template note. `/policies/refunds` returns 404, and so does `http://unknown-store.localhost:3001/policies/returns`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server-api.ts apps/web/src/content/store-policies apps/web/src/app/store
git commit -m "feat(web): add default return, shipping, terms and privacy policies to every store" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

## Task 16: Full check, walkthrough and deploy

**Files:**
- Modify: `specs/platform/plans/2026-10-03-w1a-foundations-tenancy.md` (Task 17 note), this plan (results)

- [ ] **Step 1: Run every automated check**

```bash
pnpm test && pnpm check-types
```

Expected: all tests pass (W1-A's 168 plus the new ones); no type errors.

- [ ] **Step 2: Manual walkthrough over the tunnel**

Start the dev stack and `pnpm tunnel`, then on `https://elysiumjs.com` and its subdomains (spec §9):

1. Landing page and pricing toggle; the three legal pages and the footer.
2. Sign up with email; the real verification email; the link lands on `/new`.
3. Create a store; the checklist shows "1 of 3 done"; open the storefront and the four policies.
4. Password reset from `/forgot-password` to `/login?reset=1`.
5. Sign up with PayPal (sandbox personal account). Expected: no verification step; `/` redirects to `/new`.
6. The sandbox banner on the site, admin and store hosts.

Record anything that fails as a new task in this plan before fixing it.

- [ ] **Step 3: Note the walkthrough in W1-A**

In `specs/platform/plans/2026-10-03-w1a-foundations-tenancy.md`, at the end of Task 17, add:

```markdown
> W1-D adds its own walkthrough (landing, legal pages, email sign-up and verification, `/new`, checklist, store policies, password reset, PayPal sign-in, sandbox banner) in [`2026-10-05-w1d-public-site-auth-onboarding.md`](2026-10-05-w1d-public-site-auth-onboarding.md) Task 16.
```

- [ ] **Step 4: Migrate Aiven and deploy**

```bash
pnpm -F @jendal-workspace/db db:migrate
cd packages/infra && pnpm exec alchemy deploy --yes --no-input
```

Expected: the migration applies to Aiven; the stage deploys with the new SMTP and web settings.

- [ ] **Step 5: Check SMTP from a deployed Worker**

Ask the user for an inbox address they can read (a plus address works) and for the deployed api URL. Then:

```bash
curl -sS -X POST "$API_URL/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -H "origin: $BETTER_AUTH_URL" \
  -d '{"name":"Deploy check","email":"'"$CHECK_EMAIL"'","password":"deploy-check-password","callbackURL":"/new"}'
```

Expected: a JSON body with `"token":null`, and the verification email in the inbox within a minute. If it does not arrive, look for an `email.send` error event in the api Worker's logs in the Cloudflare dashboard (it carries the error name and code, never the address). Port 587 was verified in local workerd only (spec §5.2), so record the result either way in `specs/platform/research.md` §12.3.

- [ ] **Step 6: Record the results and commit**

Tick the steps in this plan, add a "Result" note under this task (date, test count, deploy outcome, SMTP outcome), then:

```bash
git add -A
git status --short   # review: only intended files
git commit -m "chore: record the W1-D walkthrough and deploy check" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

(`specs/` is outside the workspace repository, so the plan edits are not part of this commit.)

---

## Decisions made while planning

These fill gaps the spec leaves open. Each is small and reversible.

| Topic | Decision | Why |
|---|---|---|
| Which organization `store.create` uses | The first organization where the user is owner or admin; otherwise a new one | The spec says "no organization → create one". A staff member who can't create stores in their employer's organization still gets their own |
| "Visit your storefront" step | Done when the store's status is `active` | A visit cannot be detected; once live, the step no longer needs attention |
| Demo store button | Shown only when `DEMO_STORE_SLUG` is set | The demo store is seeded in Nov 9–12 (parent spec §14) |
| Checkout banner | Built and tested now; the root layout renders the default variant | The checkout pages come in a later plan, which renders `variant="checkout"` |
| Store policy data | A separate `/api/store/policy-info` route | Keeps the KV-cached `StoreRecord` unchanged |
| MDX setup | Only `@mdx-js/rollup` installed; no Vite config | vinext injects it on demand (Fact 9) |
| Sign-in `callbackURL` | Not sent | It would redirect on success (Fact 14) |
| Rate limiting in development | On | The same code path runs everywhere; local requests share one bucket, which is fine for one developer |


## Changes made during execution

| Task | Change | Why |
|---|---|---|
| 6 | `vitest.config.ts` sets `testTimeout: 20_000` (commit after `a95dac0`) | Auth tests hash 6–7 passwords with scrypt each; under machine load some exceeded the 5 s default |
| 7 | `packages/api` gets `drizzle-orm` as a dev dependency (`04dbfd6`) | `store.test.ts` imports `eq` from `drizzle-orm`, which the package did not declare |
| 8 | `services.ts` imports `type ExecutionContext` from `hono` (`749f595`) | `c.executionCtx` is Hono's `ExecutionContext`; the global workers-types one also requires `tracing` and `abort` |
| 8 | Values with `$` in `.env` must be single-quoted | varlock expands `$NAME` in unquoted and double-quoted values (`refs/stack/varlock/packages/varlock-website/src/content/docs/env-spec/reference.mdx`) |
