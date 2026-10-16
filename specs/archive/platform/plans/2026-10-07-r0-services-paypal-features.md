# R0: Services Teams Skip Shipment Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Connect PayPal" works for services teams. They stop asking PayPal for `TRACKING_SHIPMENT_READWRITE`, which the sandbox partner app is not approved for (PayPal answers 422 `FEATURES_UNAUTHORIZED`). Stores keep asking for the full list.

**Architecture:** `findTeamAccess` (db) also returns the team's product. The onboarding module (api) maps the product to the list of features through a new `partnerReferralFeaturesFor`, and `startPayPalOnboarding` passes that list to `partnerReferrals.create`, which already accepts `features`. `StoreRecord` does not change, because about twenty files build it.

**Tech Stack:** TypeScript, Drizzle ORM, tRPC 11, Vitest, pnpm workspaces.

**Spec:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §11, run 0; [`../2026-10-03-payleor-platform-design.md`](../2026-10-03-payleor-platform-design.md) §5 step 1 (the feature list).

**Builds on:** `main` at `908e709` (E7 merged; 736 tests).

**Out of scope:** stores still ask for `TRACKING_SHIPMENT_READWRITE`, so Connect PayPal on a store still fails until PayPal approves the feature for the partner app. Payments, webhooks and the pay page are run 1.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/r0-services-features` (created in Task 0). `main` is checked out at `/home/mouhamed/dev/repos/jendal/worktrees/main`; the merge in Task 3 happens there.

**Tests that need Postgres** run against the local Docker container `jendal-pg`. `vitest.config.ts` loads `TEST_DATABASE_URL` from `.env.test.local` at the worktree root. That file is not in git, so Task 0 copies it. Without it, the database suites are skipped rather than failing, so check that the counts below show them running.

## Files

| File | Change | Responsibility |
|---|---|---|
| `packages/db/src/repositories/teams.ts` | Modify | `findTeamAccess` also returns `product` |
| `packages/db/src/repositories/teams.test.ts` | Modify | Product for a store and for a services team |
| `packages/api/src/paypal/onboarding.ts` | Modify | `partnerReferralFeaturesFor`; `startPayPalOnboarding` takes the product |
| `packages/api/src/paypal/onboarding.test.ts` | Create | Unit tests for the feature lists |
| `packages/api/src/routers/paypal.ts` | Modify | Passes the product from the access row |
| `packages/api/src/routers/paypal.test.ts` | Modify | The referral body for a store and for a services team |

---

### Task 0: Worktree and baseline

- [ ] **Step 1: Create the worktree from `main`**

```bash
git -C /home/mouhamed/dev/repos/jendal/worktrees/main worktree add /home/mouhamed/dev/repos/jendal/worktrees/r0-services-features -b r0-services-paypal-features main
cp /home/mouhamed/dev/repos/jendal/worktrees/main/.env.test.local /home/mouhamed/dev/repos/jendal/worktrees/r0-services-features/.env.test.local
cd /home/mouhamed/dev/repos/jendal/worktrees/r0-services-features && pnpm install
```

Expected: the worktree is on branch `r0-services-paypal-features` at `908e709`, and `pnpm install` ends without errors (its `postinstall` runs varlock codegen).

- [ ] **Step 2: Run the baseline for the files this plan touches**

```bash
pnpm test packages/paypal packages/db/src/repositories/teams.test.ts packages/api/src/routers/paypal.test.ts apps/server/src/routes/paypal-onboarding.test.ts
```

Expected: every test passes, and `teams.test.ts` and `paypal.test.ts` show their tests running, not skipped. If they are skipped, `.env.test.local` is missing or `jendal-pg` is down (`docker ps` should list it on port 5432).

---

### Task 1: `findTeamAccess` returns the team's product

**Files:**
- Modify: `packages/db/src/repositories/teams.ts`
- Test: `packages/db/src/repositories/teams.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/repositories/teams.test.ts`, add `seedServicesTeam` to the import from `../testing/db`:

```ts
import {
  addMember,
  addTeamMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedStore,
  seedUser,
  truncateAll,
} from "../testing/db";
```

Change the expectation of the first test, "finds a team by id with the caller's organization role", to:

```ts
    expect(access).toEqual({ team: store, product: "store", role: "owner", isTeamMember: false });
```

Add this test after it:

```ts
  it("returns a services team's product next to the team record", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "studio" });

    const access = await findTeamAccess(db, { teamId: studio.id, userId });

    expect(access).toMatchObject({ team: { id: studio.id, slug: "studio" }, product: "services", role: "owner" });
    expect(access?.team).not.toHaveProperty("product");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/db/src/repositories/teams.test.ts`
Expected: FAIL. Both tests report a missing `product` property.

- [ ] **Step 3: Implement**

In `packages/db/src/repositories/teams.ts`, change the import, the type and `findTeamAccess`:

```ts
import type { StoreRecord, TeamProduct } from "@jendal-workspace/core";
```

```ts
export type TeamAccessRow = { team: StoreRecord; product: TeamProduct; role: string; isTeamMember: boolean };
```

```ts
export async function findTeamAccess(
  db: Database,
  input: { teamId: string; userId: string },
): Promise<TeamAccessRow | null> {
  const [row] = await db
    .select({ ...teamColumns, product: team.product, role: member.role, teamMemberId: teamMember.id })
    .from(team)
    .innerJoin(member, and(eq(member.organizationId, team.organizationId), eq(member.userId, input.userId)))
    .leftJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, input.userId)))
    .where(eq(team.id, input.teamId))
    .limit(1);
  if (!row) return null;
  const { role, teamMemberId, product, ...teamRecord } = row;
  return { team: teamRecord, product, role, isTeamMember: teamMemberId !== null };
}
```

`teamColumns`, `findTeamById` and `findTeamSlug` stay as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test packages/db/src/repositories/teams.test.ts apps/server/src/routes/paypal-onboarding.test.ts`
Expected: PASS. The server route test uses a fake database whose row has no `product`; the return route does not read it, so it still passes.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/teams.ts packages/db/src/repositories/teams.test.ts
git commit -F - <<'EOF'
feat(db): return the team's product with the caller's team access

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
EOF
```

---

### Task 2: Services teams leave shipment tracking out of the referral

**Files:**
- Create: `packages/api/src/paypal/onboarding.test.ts`
- Modify: `packages/api/src/paypal/onboarding.ts`
- Modify: `packages/api/src/routers/paypal.ts`
- Test: `packages/api/src/routers/paypal.test.ts`
- Modify: `apps/server/src/routes/paypal-onboarding.test.ts` (its fake database row gains `product`, added after Task 1's review)

- [ ] **Step 1: Write the failing unit tests**

Create `packages/api/src/paypal/onboarding.test.ts`:

```ts
import { PARTNER_REFERRAL_FEATURES } from "@jendal-workspace/paypal";
import { describe, expect, it } from "vitest";

import { partnerReferralFeaturesFor } from "./onboarding";

describe("partnerReferralFeaturesFor", () => {
  it("asks a store for every platform feature", () => {
    expect(partnerReferralFeaturesFor("store")).toEqual([...PARTNER_REFERRAL_FEATURES]);
  });

  it("leaves shipment tracking out for a services team", () => {
    expect(partnerReferralFeaturesFor("services")).toEqual([
      "PAYMENT",
      "REFUND",
      "PARTNER_FEE",
      "READ_SELLER_DISPUTE",
      "UPDATE_SELLER_DISPUTE",
      "ACCESS_MERCHANT_INFORMATION",
    ]);
  });
});
```

- [ ] **Step 2: Write the failing router tests**

In `packages/api/src/routers/paypal.test.ts`, add `seedServicesTeam` to the import from `@jendal-workspace/db/testing/db`:

```ts
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedStore,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
```

Add `PARTNER_REFERRAL_FEATURES` to the import from `@jendal-workspace/paypal`, and `RecordedRequest` to the import from `@jendal-workspace/paypal/testing`:

```ts
import { createPayPalClient, type FetchLike, PARTNER_REFERRAL_FEATURES } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
```

Add this helper after `fakePayPalApi`:

```ts
// The features list from a recorded partner referral request body.
function referralFeatures(requests: RecordedRequest[]): unknown {
  const call = requests.find((r) => r.url.endsWith("/v2/customer/partner-referrals"));
  const body = JSON.parse(call?.body ?? "{}");
  return body.operations?.[0]?.api_integration_preference?.rest_api_integration?.third_party_details?.features;
}
```

Add these two tests inside `describe.skipIf(!hasTestDatabase)("paypal router", ...)`, after "starts onboarding and stores the pending referral":

```ts
  it("asks PayPal for shipment tracking when a store connects", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { requests, fetch } = fakePayPalApi({ integration: null });

    await callerFor(userId, makePayPal(fetch)).paypal.startOnboarding({ teamId: store.id });

    expect(referralFeatures(requests)).toEqual([...PARTNER_REFERRAL_FEATURES]);
  });

  it("does not ask PayPal for shipment tracking when a services team connects", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "studio" });
    const { requests, fetch } = fakePayPalApi({ integration: null });

    const started = await callerFor(userId, makePayPal(fetch)).paypal.startOnboarding({ teamId: studio.id });

    expect(started).toEqual({ actionUrl: ACTION_URL });
    expect(referralFeatures(requests)).toEqual([
      "PAYMENT",
      "REFUND",
      "PARTNER_FEE",
      "READ_SELLER_DISPUTE",
      "UPDATE_SELLER_DISPUTE",
      "ACCESS_MERCHANT_INFORMATION",
    ]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test packages/api/src/paypal/onboarding.test.ts packages/api/src/routers/paypal.test.ts`
Expected: FAIL. `onboarding.test.ts` fails because `partnerReferralFeaturesFor` is not exported. The services team test fails because the body still lists `TRACKING_SHIPMENT_READWRITE`. The store test passes already, because the default list is the full list.

- [ ] **Step 4: Implement the feature list and pass it on start**

In `packages/api/src/paypal/onboarding.ts`, change the two imports:

```ts
import type { StoreRecord, TeamProduct } from "@jendal-workspace/core";
```

```ts
import { actionUrlFromLinks, PARTNER_REFERRAL_FEATURES, type PayPalClient } from "@jendal-workspace/paypal";
```

Add this function above `startPayPalOnboarding`:

```ts
// Services teams ship nothing, so they leave shipment tracking out. PayPal rejects the whole referral
// with 422 FEATURES_UNAUTHORIZED when the partner app is not approved for any feature it asks for.
export function partnerReferralFeaturesFor(product: TeamProduct): readonly string[] {
  if (product === "store") return PARTNER_REFERRAL_FEATURES;
  return PARTNER_REFERRAL_FEATURES.filter((feature) => feature !== "TRACKING_SHIPMENT_READWRITE");
}
```

Change `startPayPalOnboarding` to take the product and pass the list:

```ts
export async function startPayPalOnboarding(
  deps: PayPalOnboardingDeps,
  team: StoreRecord,
  product: TeamProduct,
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
    features: partnerReferralFeaturesFor(product),
  });
  const actionUrl = actionUrlFromLinks(referral.links);
  if (!actionUrl) throw new Error("PayPal's partner referral response has no action_url link.");
  await savePayPalReferral(deps.db, { teamId: team.id, trackingId: team.id, actionUrl });
  return { actionUrl };
}
```

- [ ] **Step 5: Pass the product from the router**

In `packages/api/src/routers/paypal.ts`, replace the first two imports:

```ts
import { hasStoreWideRole } from "@jendal-workspace/core";
import { findTeamAccess, type TeamAccessRow } from "@jendal-workspace/db/repositories/teams";
```

Replace `requireTeamAdmin` and the router:

```ts
// Connecting PayPal is an admin power (services spec §4.1): the workspace's owners and admins.
// Same leak rule as storeProcedure: a team the caller cannot administer reads as missing.
async function requireTeamAdmin(ctx: AuthedContext, teamId: string): Promise<TeamAccessRow> {
  const access = await findTeamAccess(ctx.db, { teamId, userId: ctx.session.user.id });
  if (!access || !hasStoreWideRole(access.role)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
  }
  return access;
}

export const paypalRouter = router({
  startOnboarding: protectedProcedure.input(teamIdInput).mutation(async ({ ctx, input }) => {
    const { team, product } = await requireTeamAdmin(ctx, input.teamId);
    return startPayPalOnboarding(requirePayPal(ctx), team, product);
  }),

  onboardingStatus: protectedProcedure
    .input(teamIdInput.extend({ refresh: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const { team } = await requireTeamAdmin(ctx, input.teamId);
      const deps = requirePayPal(ctx);
      return input.refresh ? refreshPayPalOnboarding(deps, team) : getPayPalOnboardingView(deps, team);
    }),
});
```

- [ ] **Step 5b: Keep the return route's fake row faithful**

In `apps/server/src/routes/paypal-onboarding.test.ts`, the fake database returns the row that `findTeamAccess` selects, which now includes `product`. Replace the comment and `ownerAccess`:

```ts
// findTeamAccess selects the team columns plus product, role and teamMemberId (null = not a team member).
const ownerAccess = { ...teamRow, product: "store", role: "owner", teamMemberId: null };
```

- [ ] **Step 6: Run the tests and the type checks**

```bash
pnpm test packages/paypal packages/db/src/repositories/teams.test.ts packages/api/src/paypal/onboarding.test.ts packages/api/src/routers/paypal.test.ts apps/server/src/routes/paypal-onboarding.test.ts
pnpm check-types
```

Expected: every test passes, and `check-types` reports no errors in any package. `startPayPalOnboarding` has no other callers (`rg -n "startPayPalOnboarding" --glob '!**/node_modules/**'` lists only `onboarding.ts` and `routers/paypal.ts`).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/paypal/onboarding.ts packages/api/src/paypal/onboarding.test.ts packages/api/src/routers/paypal.ts packages/api/src/routers/paypal.test.ts apps/server/src/routes/paypal-onboarding.test.ts
git commit -F - <<'EOF'
fix(api): stop asking PayPal for shipment tracking when a services team connects

PayPal rejects the whole partner referral with 422 FEATURES_UNAUTHORIZED when the
partner app is not approved for a feature it asks for. Services teams ship nothing,
so they leave TRACKING_SHIPMENT_READWRITE out; stores still ask for it.

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
EOF
```

---

### Task 3: Full suite, merge and specs

- [ ] **Step 1: Run the full suite in the worktree**

```bash
pnpm test
```

Expected: every test passes. The total is 5 more than on `main` at `908e709` (736 then, so 741): 1 new test in `teams.test.ts`, 2 in `onboarding.test.ts` and 2 in `paypal.test.ts`.

- [ ] **Step 2: Merge into `main` without fast-forward**

```bash
git -C /home/mouhamed/dev/repos/jendal/worktrees/main status --short
git -C /home/mouhamed/dev/repos/jendal/worktrees/main merge --no-ff r0-services-paypal-features \
  -m "Merge branch 'r0-services-paypal-features': services teams skip shipment tracking (R0)" \
  -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

`git merge` cannot read its message from stdin (`-F -` fails with "could not read file '-'"), so the message goes in `-m` paragraphs.

Expected: `status --short` prints nothing before the merge (stop and ask if it does), and the merge succeeds without conflicts.

- [ ] **Step 3: Run the full suite on `main`**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main && pnpm test
```

Expected: the same count as Step 1, all passing.

- [ ] **Step 4: Update the specs (not in git)**

In `/home/mouhamed/dev/repos/jendal/specs/platform/2026-10-03-payleor-platform-design.md` §5 step 1, after the sentence that lists the features, add: "Services teams ask for the same features except `TRACKING_SHIPMENT_READWRITE`, because they ship nothing and PayPal rejects a referral that asks for a feature the partner app is not approved for (2026-10-07, R0)."

In `/home/mouhamed/dev/repos/jendal/specs/platform/2026-10-07-sellers-minimal-flow-design.md` §11, change run 0's scope cell to end with "(done 2026-10-07, merged as R0)".

- [ ] **Step 5: Manual check (optional, needs the PayPal sandbox login)**

Start the dev stack and the tunnel from `/home/mouhamed/dev/repos/jendal/worktrees/main` as in the earlier walkthroughs (`pnpm dev`, then `pnpm tunnel`). Log in, open a services team's dashboard and click Connect PayPal. Expected: the browser goes to PayPal's sandbox sign-up page instead of showing an error. The api Worker's log has no `FEATURES_UNAUTHORIZED`.
