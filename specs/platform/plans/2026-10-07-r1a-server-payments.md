# R1a: Server Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client can pay a pending project payment through PayPal on the server side. A signed pay link names the payment. Starting creates a PayPal order for the team's merchant ID, with Payleor's fee from the seller's plan. Capturing applies the capture once: the payment, the ledger, the project state and the outbox all change together. The browser page (R1b) and webhooks (R1c) build on this.

**Architecture:** `core` gains the seller plans, a plan-rate `platformFeeMinor` (replacing the old 0.5% + 0.10) and `toPayPalValue`. `packages/paypal` gains an Orders module: create, capture and get, each with the auth assertion for the seller, and a defensive capture parser. The `payment` table gains `platform_fee_minor`. `packages/api` gains pay links next to client links, a `payments` use-case module (`startPayment`, `capturePayment`, `applyCaptureFact`, `getPayPage`) and a public `payment` router (`payGet`, `payStart`, `payCapture`). The client page's data gains a `payPath` per payable payment. tRPC errors caused by PayPal are logged even when they are client errors, so a declined card's `debug_id` is kept.

**Tech Stack:** TypeScript, Drizzle ORM 1.0 rc, tRPC 11, Hono, Vitest 5, Web Crypto, pnpm workspaces.

**Spec:** [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) §5.2 (steps 3–4), §5.4 (pay page), §6.1, §6.3 (deposit and top-up postings), §6.4 (applying PayPal facts); [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §7 and §11 (run 1); [`../2026-10-07-seller-pricing-proposal.md`](../2026-10-07-seller-pricing-proposal.md) §1, §4 and §6; PayPal facts in [`../2026-10-07-r1-paypal-facts.md`](../2026-10-07-r1-paypal-facts.md).

**Builds on:** `main` at `50b821a` (R0 merged; 741 tests).

**Out of scope:**
- **R1b:** the `/pay/{token}` page with JS SDK v6 buttons, and the client page's Pay button.
- **R1c:** webhooks: verification, the event table, the Queue, re-fetching captures and refunds.
- **Run 2:** balance payments and completion postings. `startPayment` refuses balance payments until then.
- **Later:** refunds, and limits from other plan fields (members, storage, AI drafts). Billing is run 8.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/r1a-server-payments`, created in Task 0. `main` is checked out at `/home/mouhamed/dev/repos/jendal/worktrees/main`; the merge in Task 7 happens there.

**Tests that need Postgres** run against the local Docker container `jendal-pg`. `vitest.config.ts` loads `TEST_DATABASE_URL` from `.env.test.local` at the worktree root. That file is not in git, so Task 0 copies it. The global setup applies every migration in `packages/db/src/migrations` to the test database.

## Facts this plan relies on

From [`../2026-10-07-r1-paypal-facts.md`](../2026-10-07-r1-paypal-facts.md), checked on 2026-10-07:

1. **Auth assertion.** Create, capture and show order for a seller send `PayPal-Auth-Assertion` and `PayPal-Partner-Attribution-Id`. The assertion is the unsigned JWT that `buildAuthAssertion` already builds; `request()` adds it when given `merchantId`.
2. **Order body.**
   - `purchase_units[].payee.merchant_id` is the seller.
   - `payment_instruction.platform_fees` holds at most one fee, in the order's currency, as a decimal string. The seller must have granted `PARTNER_FEE`.
   - `disbursement_mode: "INSTANT"` means immediate capture.
   - `custom_id` takes up to 255 characters; `description` and `brand_name` up to 127.
   - `shipping_preference: "NO_SHIPPING"` suits services.
3. **Capture.**
   - `POST /v2/checkout/orders/{id}/capture`. With `Prefer: return=representation`, the response carries `purchase_units[0].payments.captures[0]` with `id`, `status`, `amount` and `custom_id`.
   - Capture statuses: `COMPLETED`, `PENDING`, `DECLINED`, `FAILED`, `REFUNDED`, `PARTIALLY_REFUNDED`.
   - A repeated `PayPal-Request-Id` replays the first response.
4. **Errors.**
   - A declined funding source is a 422 whose `details[].issue` is `INSTRUMENT_DECLINED`. It is recoverable: the buyer picks another funding source.
   - Capturing an order twice is a 422 with issue `ORDER_ALREADY_CAPTURED`; `GET /v2/checkout/orders/{id}` then shows the capture.
   - Every error body has `debug_id`, which `PayPalError.debugId` holds.
5. **JS SDK v6.** The browser needs only public values: the partner client ID, the seller's merchant ID, the BN code (partner attribution ID) and the environment. No client token is needed for PayPal buttons.

## Files

| File | Change | Responsibility |
|---|---|---|
| `packages/core/src/billing/seller-plans.ts` (+test) | Create | The six seller plans and `sellerPlanFor` |
| `packages/core/src/index.ts` | Modify | Export the seller plans |
| `packages/core/src/projects/pricing.ts` (+test) | Modify | `platformFeeMinor(payment, feeBps)` replaces `payleorFeeMinor` |
| `packages/core/src/money/money.ts` (+test) | Modify | `toPayPalValue` |
| `packages/paypal/src/client.ts` | Modify | `prefer` option; `orders` on the client |
| `packages/paypal/src/orders.ts` (+test) | Create | Seller orders: create, capture, get; `captureFromOrder` |
| `packages/paypal/src/index.ts` | Modify | Export the Orders module |
| `packages/db/src/schema/projects.ts` | Modify | `payment.platform_fee_minor` |
| `packages/db/src/migrations/<timestamp>_r1a_payment_platform_fee/` | Create (generated) | The migration |
| `packages/api/src/client-links.ts` (+test) | Modify | Pay links; the shared link secret helper |
| `packages/api/src/context.ts` | Modify | `PayPalServices.sdk` |
| `apps/server/src/services.ts` | Modify | Fills `sdk` |
| `apps/server/src/trpc-error-log.ts` (+test) | Modify | Logs PayPal-caused client errors |
| `packages/api/src/routers/paypal.test.ts`, `apps/server/src/routes/paypal-onboarding.test.ts` | Modify | Their `PayPalServices` fakes gain `sdk` |
| `packages/api/src/use-cases/payments.ts` | Create | `applyCaptureFact`, `startPayment`, `capturePayment`, `getPayPage` |
| `packages/api/src/routers/payment.ts` | Create | Public `payGet`, `payStart`, `payCapture` |
| `packages/api/src/routers/payment.test.ts` | Create | Database tests for the use cases and the router |
| `packages/api/src/routers/index.ts` | Modify | Mounts `payment` |
| `packages/api/src/routers/project.ts` (+test) | Modify | `clientGet` returns `payPath`; uses the shared link secret helper |

---

### Task 0: Worktree and baseline

- [ ] **Step 1: Create the worktree from `main`**

```bash
git -C /home/mouhamed/dev/repos/jendal/worktrees/main worktree add /home/mouhamed/dev/repos/jendal/worktrees/r1a-server-payments -b r1a-server-payments main
cp /home/mouhamed/dev/repos/jendal/worktrees/main/.env.test.local /home/mouhamed/dev/repos/jendal/worktrees/r1a-server-payments/.env.test.local
cd /home/mouhamed/dev/repos/jendal/worktrees/r1a-server-payments && pnpm install
```

Expected: the branch `r1a-server-payments` is at `50b821a`, and `pnpm install` ends with varlock's "Code generated successfully" lines.

- [ ] **Step 2: Baseline**

```bash
pnpm test packages/core packages/paypal packages/api/src/routers/project.test.ts packages/api/src/client-links.test.ts apps/server/src/trpc-error-log.test.ts
```

Expected: every test passes, and `project.test.ts` runs rather than being skipped.

---

### Task 1: Seller plans, the plan-rate fee and PayPal amount strings (core)

**Files:**
- Create: `packages/core/src/billing/seller-plans.ts`, `packages/core/src/billing/seller-plans.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/projects/pricing.ts`, `packages/core/src/projects/pricing.test.ts`, `packages/core/src/money/money.ts`, `packages/core/src/money/money.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/billing/seller-plans.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getSellerPlan, SELLER_PLANS, sellerPlanFor } from "./seller-plans";

describe("seller plans", () => {
  it("lists the approved prices and fees (pricing proposal §1)", () => {
    expect(SELLER_PLANS.map((p) => [p.id, p.audience, p.priceCents.monthly, p.priceCents.yearly, p.feeBps])).toEqual([
      ["solo", "freelancer", 900, 700, 200],
      ["pro", "freelancer", 2400, 1800, 100],
      ["premium", "freelancer", 5900, 4500, 50],
      ["team", "team", 3900, 2900, 100],
      ["studio", "team", 9900, 7500, 50],
      ["agency", "team", 24900, 18900, 25],
    ]);
  });

  it("raises the limits on higher plans", () => {
    expect(SELLER_PLANS.map((p) => [p.id, p.members, p.storageGb, p.aiDraftsPerMonth])).toEqual([
      ["solo", 1, 2, 20],
      ["pro", 1, 20, 100],
      ["premium", 1, 100, 300],
      ["team", 5, 50, 200],
      ["studio", 15, 200, 500],
      ["agency", 50, 500, 1500],
    ]);
    expect(
      SELLER_PLANS.map((p) => [p.id, p.customDomain, p.hideBadge, p.payoutAgent, p.publicApi, p.prioritySupport]),
    ).toEqual([
      ["solo", false, false, false, false, false],
      ["pro", true, true, false, false, false],
      ["premium", true, true, false, false, true],
      ["team", true, true, false, false, false],
      ["studio", true, true, true, true, false],
      ["agency", true, true, true, true, true],
    ]);
  });

  it("puts every services team on Team until billing ships", () => {
    expect(sellerPlanFor({ id: "team-1" })).toBe(getSellerPlan("team"));
  });

  it("rejects an unknown plan id", () => {
    expect(() => getSellerPlan("gold" as never)).toThrow(/Unknown seller plan/);
  });
});
```

In `packages/core/src/projects/pricing.test.ts`, replace `payleorFeeMinor` with `platformFeeMinor` in the import list. Replace the test "takes $3.10 on $600 and $1.85 on $350" with:

```ts
  it("takes Payleor's 1% Team fee: $6 on $600 and $3.50 on $350", () => {
    expect(platformFeeMinor(60_000, 100)).toBe(600);
    expect(platformFeeMinor(35_000, 100)).toBe(350);
  });
```

Replace the whole `describe("payleorFeeMinor", ...)` block with:

```ts
describe("platformFeeMinor", () => {
  it.each([
    [1, 100, 0], // 0.01 rounds down: no fee on the order
    [50, 100, 1], // 0.5 rounds up
    [149, 100, 1],
    [150, 100, 2], // 1.5 rounds up
    [60_000, 25, 150],
    [60_000, 200, 1_200],
  ])("charges %i at %i bps → %i", (payment, bps, fee) => {
    expect(platformFeeMinor(payment, bps)).toBe(fee);
  });

  it("rejects zero, negative and fractional payments, and rates outside 0–10000 bps", () => {
    expect(() => platformFeeMinor(0, 100)).toThrow(RangeError);
    expect(() => platformFeeMinor(-100, 100)).toThrow(RangeError);
    expect(() => platformFeeMinor(10.5, 100)).toThrow(RangeError);
    expect(() => platformFeeMinor(100, 10_001)).toThrow(RangeError);
  });
});
```

In `packages/core/src/money/money.test.ts`, add `toPayPalValue` to the import from `./money` and add:

```ts
describe("toPayPalValue", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [60_000, "600.00"],
    [123_456, "1234.56"],
  ])("writes %i minor units as %s", (minor, value) => {
    expect(toPayPalValue(minor)).toBe(value);
  });

  it("rejects negative and fractional amounts", () => {
    expect(() => toPayPalValue(-1)).toThrow(RangeError);
    expect(() => toPayPalValue(1.5)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/core/src/billing packages/core/src/projects/pricing.test.ts packages/core/src/money/money.test.ts`
Expected: FAIL. `seller-plans.test.ts` cannot import `./seller-plans`; `platformFeeMinor` and `toPayPalValue` are not exported.

- [ ] **Step 3: Implement**

Create `packages/core/src/billing/seller-plans.ts`:

```ts
import type { BillingInterval } from "./plans";

export type SellerAudience = "freelancer" | "team";
export type SellerPlanId = "solo" | "pro" | "premium" | "team" | "studio" | "agency";

export type SellerPlan = {
  id: SellerPlanId;
  name: string;
  audience: SellerAudience;
  // US cents per month. The yearly price is billed once a year as 12 times this amount.
  priceCents: Record<BillingInterval, number>;
  // Payleor's fee on each client payment and store order in basis points, taken as PayPal platform_fees.
  feeBps: number;
  members: number;
  storageGb: number;
  aiDraftsPerMonth: number;
  customDomain: boolean;
  hideBadge: boolean;
  payoutAgent: boolean;
  publicApi: boolean;
  prioritySupport: boolean;
};

export const SELLER_PLANS: readonly SellerPlan[] = [
  {
    id: "solo",
    name: "Solo",
    audience: "freelancer",
    priceCents: { monthly: 900, yearly: 700 },
    feeBps: 200,
    members: 1,
    storageGb: 2,
    aiDraftsPerMonth: 20,
    customDomain: false,
    hideBadge: false,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: false,
  },
  {
    id: "pro",
    name: "Pro",
    audience: "freelancer",
    priceCents: { monthly: 2400, yearly: 1800 },
    feeBps: 100,
    members: 1,
    storageGb: 20,
    aiDraftsPerMonth: 100,
    customDomain: true,
    hideBadge: true,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: false,
  },
  {
    id: "premium",
    name: "Premium",
    audience: "freelancer",
    priceCents: { monthly: 5900, yearly: 4500 },
    feeBps: 50,
    members: 1,
    storageGb: 100,
    aiDraftsPerMonth: 300,
    customDomain: true,
    hideBadge: true,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: true,
  },
  {
    id: "team",
    name: "Team",
    audience: "team",
    priceCents: { monthly: 3900, yearly: 2900 },
    feeBps: 100,
    members: 5,
    storageGb: 50,
    aiDraftsPerMonth: 200,
    customDomain: true,
    hideBadge: true,
    payoutAgent: false,
    publicApi: false,
    prioritySupport: false,
  },
  {
    id: "studio",
    name: "Studio",
    audience: "team",
    priceCents: { monthly: 9900, yearly: 7500 },
    feeBps: 50,
    members: 15,
    storageGb: 200,
    aiDraftsPerMonth: 500,
    customDomain: true,
    hideBadge: true,
    payoutAgent: true,
    publicApi: true,
    prioritySupport: false,
  },
  {
    id: "agency",
    name: "Agency",
    audience: "team",
    priceCents: { monthly: 24900, yearly: 18900 },
    feeBps: 25,
    members: 50,
    storageGb: 500,
    aiDraftsPerMonth: 1500,
    customDomain: true,
    hideBadge: true,
    payoutAgent: true,
    publicApi: true,
    prioritySupport: true,
  },
];

export function getSellerPlan(id: SellerPlanId): SellerPlan {
  const plan = SELLER_PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown seller plan: ${id}`);
  return plan;
}

// Until billing ships (pricing proposal §6), every services team is on Team. Sellers who work alone
// move to Solo once the "Just me" setting exists.
export function sellerPlanFor(_team: { id: string }): SellerPlan {
  return getSellerPlan("team");
}
```

In `packages/core/src/index.ts`, add after `export * from "./billing/plans";`:

```ts
export * from "./billing/seller-plans";
```

In `packages/core/src/projects/pricing.ts`, delete `PAYLEOR_FEE_BPS`, `PAYLEOR_FEE_FIXED_MINOR` and `payleorFeeMinor` with its comment, and add in their place:

```ts
// Payleor's fee on one client payment or store order, at the seller plan's rate (pricing proposal §4).
// A tiny payment can round to zero; the order then carries no platform_fees.
export function platformFeeMinor(paymentMinor: number, feeBps: number): number {
  assertAmount(paymentMinor, "payment");
  if (paymentMinor === 0) throw new RangeError("A client payment must be positive");
  assertBps(feeBps, "platform fee");
  return bpsOf(paymentMinor, feeBps);
}
```

Keep `DEPOSIT_BPS` where it is.

In `packages/core/src/money/money.ts`, add after `formatMoney`:

```ts
// PayPal amount strings ("1234.56"). USD and EUR both have two decimals.
export function toPayPalValue(minor: number): string {
  assertAmount(minor, "amount");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the tests and the type check**

```bash
pnpm test packages/core
rg -n "payleorFeeMinor|PAYLEOR_FEE" --glob '!**/node_modules/**' packages apps
pnpm -F @jendal-workspace/core check-types
```

Expected: all core tests pass. `rg` prints nothing. The type check passes.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -F - <<'EOF'
feat(core): add the seller plans and take Payleor's fee at the plan's rate

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
EOF
```

---

### Task 2: PayPal Orders for sellers (paypal package)

**Files:**
- Create: `packages/paypal/src/orders.ts`, `packages/paypal/src/orders.test.ts`
- Modify: `packages/paypal/src/client.ts`, `packages/paypal/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/paypal/src/orders.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildAuthAssertion, captureFromOrder, createPayPalClient, type PayPalOrder } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

function clientWith(respond: (url: string) => Response) {
  const { requests, fetch } = fakeFetch((request) =>
    request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : respond(request.url),
  );
  const client = createPayPalClient({
    clientId: "partner-client-id",
    clientSecret: "partner-secret",
    environment: "sandbox",
    fetch,
    sleep: () => Promise.resolve(),
    partnerAttributionId: "PAYLEOR_BN",
  });
  return { client, requests };
}

const ASSERTION = buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER1" });

const CAPTURED: PayPalOrder = {
  id: "ORDER1",
  status: "COMPLETED",
  purchase_units: [
    {
      payments: {
        captures: [{ id: "CAPTURE1", status: "COMPLETED", amount: { currency_code: "USD", value: "600.00" }, custom_id: "pay-1" }],
      },
    },
  ],
};

describe("orders.create", () => {
  it("creates an order for the seller with Payleor's fee", async () => {
    const { client, requests } = clientWith(() => jsonResponse(201, { id: "ORDER1", status: "CREATED" }));

    const order = await client.orders.create({
      requestId: "order:pay-1:abc",
      merchantId: "SELLER1",
      currency: "USD",
      value: "600.00",
      platformFeeValue: "6.00",
      customId: "pay-1",
      description: "Website redesign",
      brandName: "Acme Studio",
    });

    expect(order).toEqual({ id: "ORDER1", status: "CREATED" });
    const call = recordedAt(requests, 1);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(call.headers.get("paypal-request-id")).toBe("order:pay-1:abc");
    expect(call.headers.get("paypal-auth-assertion")).toBe(ASSERTION);
    expect(call.headers.get("paypal-partner-attribution-id")).toBe("PAYLEOR_BN");
    expect(JSON.parse(call.body ?? "")).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: "pay-1",
          description: "Website redesign",
          amount: { currency_code: "USD", value: "600.00" },
          payee: { merchant_id: "SELLER1" },
          payment_instruction: {
            disbursement_mode: "INSTANT",
            platform_fees: [{ amount: { currency_code: "USD", value: "6.00" } }],
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: { brand_name: "Acme Studio", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
        },
      },
    });
  });

  it("leaves platform_fees out when the fee rounds to nothing, and cuts long texts to 127 characters", async () => {
    const { client, requests } = clientWith(() => jsonResponse(201, { id: "ORDER2", status: "CREATED" }));

    await client.orders.create({
      requestId: "order:pay-2:abc",
      merchantId: "SELLER1",
      currency: "EUR",
      value: "0.01",
      platformFeeValue: null,
      customId: "pay-2",
      description: "d".repeat(200),
      brandName: "b".repeat(200),
    });

    const body = JSON.parse(recordedAt(requests, 1).body ?? "");
    expect(body.purchase_units[0].payment_instruction).toBeUndefined();
    expect(body.purchase_units[0].description).toHaveLength(127);
    expect(body.payment_source.paypal.experience_context.brand_name).toHaveLength(127);
  });
});

describe("orders.capture and orders.get", () => {
  it("captures for the seller and asks for the full representation", async () => {
    const { client, requests } = clientWith(() => jsonResponse(201, CAPTURED));

    const order = await client.orders.capture({ orderId: "ORDER1", requestId: "capture:ORDER1:abc", merchantId: "SELLER1" });

    expect(order).toEqual(CAPTURED);
    const call = recordedAt(requests, 1);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER1/capture");
    expect(call.headers.get("paypal-request-id")).toBe("capture:ORDER1:abc");
    expect(call.headers.get("paypal-auth-assertion")).toBe(ASSERTION);
    expect(call.headers.get("prefer")).toBe("return=representation");
  });

  it("shows an order for the seller", async () => {
    const { client, requests } = clientWith(() => jsonResponse(200, CAPTURED));

    await client.orders.get({ orderId: "ORDER1", merchantId: "SELLER1" });

    const call = recordedAt(requests, 1);
    expect(call.method).toBe("GET");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER1");
    expect(call.headers.get("paypal-auth-assertion")).toBe(ASSERTION);
  });
});

describe("captureFromOrder", () => {
  it("reads the first capture of the first purchase unit", () => {
    expect(captureFromOrder(CAPTURED)).toEqual({
      id: "CAPTURE1",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "600.00" },
      custom_id: "pay-1",
    });
  });

  it("returns null when the order has no usable capture", () => {
    expect(captureFromOrder({ id: "ORDER1", status: "CREATED" })).toBeNull();
    expect(captureFromOrder({ id: "ORDER1", status: "COMPLETED", purchase_units: [{ payments: { captures: [] } }] })).toBeNull();
    const broken = { id: "ORDER1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: 7 }] } }] };
    expect(captureFromOrder(broken as unknown as PayPalOrder)).toBeNull();
  });

  it("drops an amount whose fields are not strings", () => {
    const odd = {
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [{ payments: { captures: [{ id: "C", status: "PENDING", amount: { value: 6 } }] } }],
    };
    expect(captureFromOrder(odd as unknown as PayPalOrder)).toEqual({ id: "C", status: "PENDING", amount: undefined, custom_id: undefined });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/paypal/src/orders.test.ts`
Expected: FAIL: `captureFromOrder` is not exported, and `client.orders` is undefined.

- [ ] **Step 3: Implement**

Create `packages/paypal/src/orders.ts`:

```ts
import type { PayPalRequest } from "./client";

export type PayPalMoney = { currency_code: string; value: string };
export type PayPalCapture = { id: string; status: string; amount?: PayPalMoney; custom_id?: string };
export type PayPalOrder = {
  id: string;
  status: string;
  purchase_units?: { payments?: { captures?: PayPalCapture[] } }[];
};

export type CreateSellerOrderInput = {
  requestId: string;
  // The seller: the order's payee, and the merchant the auth assertion acts for (R1 facts §1).
  merchantId: string;
  currency: string;
  value: string;
  // Payleor's fee as a PayPal amount string; null leaves platform_fees out.
  platformFeeValue: string | null;
  customId: string;
  description: string;
  brandName: string;
};

// PayPal caps description and brand_name at 127 characters (R1 facts §1).
const MAX_TEXT = 127;

function sellerOrderBody(input: Omit<CreateSellerOrderInput, "requestId">) {
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: input.customId,
        description: input.description.slice(0, MAX_TEXT),
        amount: { currency_code: input.currency, value: input.value },
        payee: { merchant_id: input.merchantId },
        ...(input.platformFeeValue === null
          ? {}
          : {
              payment_instruction: {
                disbursement_mode: "INSTANT",
                platform_fees: [{ amount: { currency_code: input.currency, value: input.platformFeeValue } }],
              },
            }),
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: input.brandName.slice(0, MAX_TEXT),
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      },
    },
  };
}

export function createOrders(request: PayPalRequest) {
  return {
    create(input: CreateSellerOrderInput): Promise<PayPalOrder> {
      const { requestId, ...order } = input;
      return request<PayPalOrder>({
        method: "POST",
        path: "/v2/checkout/orders",
        requestId,
        merchantId: input.merchantId,
        body: sellerOrderBody(order),
      });
    },

    capture(input: { orderId: string; requestId: string; merchantId: string }): Promise<PayPalOrder> {
      return request<PayPalOrder>({
        method: "POST",
        path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
        requestId: input.requestId,
        merchantId: input.merchantId,
        prefer: "return=representation",
        body: {},
      });
    },

    get(input: { orderId: string; merchantId: string }): Promise<PayPalOrder> {
      return request<PayPalOrder>({
        method: "GET",
        path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}`,
        merchantId: input.merchantId,
      });
    },
  };
}

// request() casts response bodies without validating them, so each field is checked here.
export function captureFromOrder(order: PayPalOrder): PayPalCapture | null {
  const capture: unknown = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (typeof capture !== "object" || capture === null) return null;
  const record = capture as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.status !== "string") return null;
  const amount = typeof record.amount === "object" && record.amount !== null ? (record.amount as Record<string, unknown>) : null;
  return {
    id: record.id,
    status: record.status,
    amount:
      amount && typeof amount.currency_code === "string" && typeof amount.value === "string"
        ? { currency_code: amount.currency_code, value: amount.value }
        : undefined,
    custom_id: typeof record.custom_id === "string" ? record.custom_id : undefined,
  };
}
```

In `packages/paypal/src/client.ts`:

1. Import the module: `import { createOrders } from "./orders";`
2. Add to `PayPalRequestOptions`, after `merchantId`:

```ts
  // Sent as the Prefer header; captures use return=representation to get the capture back (R1 facts §3).
  prefer?: "return=representation" | "return=minimal";
```

3. Add `orders: ReturnType<typeof createOrders>;` to `interface PayPalClient`.
4. In `request`, after the `PayPal-Auth-Assertion` block, add:

```ts
    if (options.prefer) headers.Prefer = options.prefer;
```

5. In the returned object, add `orders: createOrders(request),`.

In `packages/paypal/src/index.ts`, add `export * from "./orders";`.

- [ ] **Step 4: Run the tests and the type check**

```bash
pnpm test packages/paypal
pnpm -F @jendal-workspace/paypal check-types
```

Expected: all paypal tests pass, including the existing client and partner referral tests. The type check passes.

- [ ] **Step 5: Commit**

```bash
git add packages/paypal
git commit -F - <<'EOF'
feat(paypal): create, capture and show orders for a connected seller

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
EOF
```

---

### Task 3: The payment's platform fee column (db)

**Files:**
- Modify: `packages/db/src/schema/projects.ts`
- Create (generated): `packages/db/src/migrations/<timestamp>_r1a_payment_platform_fee/`

- [ ] **Step 1: Add the column and its check**

In `packages/db/src/schema/projects.ts`, in the `payment` table, add after `amountMinor`:

```ts
    // Payleor's fee on the payment's current PayPal order, at the seller plan's rate; set when the order is created.
    platformFeeMinor: minor("platform_fee_minor"),
```

In the same table's constraint list, add after `payment_amount_check`:

```ts
    check(
      "payment_platform_fee_check",
      sql`platform_fee_minor is null or (platform_fee_minor >= 0 and platform_fee_minor <= amount_minor)`,
    ),
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm -F @jendal-workspace/db db:generate --name r1a_payment_platform_fee
```

If varlock refuses to start because `DATABASE_URL` is not set, run it with the test URL, which `generate` does not connect to:

```bash
DATABASE_URL="$(sed -n 's/^TEST_DATABASE_URL=//p' .env.test.local)" pnpm -F @jendal-workspace/db db:generate --name r1a_payment_platform_fee
```

Expected: a new folder `packages/db/src/migrations/<timestamp>_r1a_payment_platform_fee/`. Its SQL adds the `platform_fee_minor` bigint column to `payment` and the `payment_platform_fee_check` constraint, and nothing else. Read it to confirm. If it contains anything else, stop and report.

- [ ] **Step 3: Run the database tests**

```bash
pnpm test packages/db packages/api/src/routers/project.test.ts
pnpm -F @jendal-workspace/db check-types
```

Expected: everything passes. The global setup applied the new migration, and the project tests still create payments without a fee.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/projects.ts packages/db/src/migrations
git commit -F - <<'EOF'
feat(db): record Payleor's platform fee on each payment

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
EOF
```

---

### Task 4: Pay links, the SDK settings and PayPal error logs

**Files:**
- Modify: `packages/api/src/client-links.ts`, `packages/api/src/client-links.test.ts`, `packages/api/src/routers/project.ts`, `packages/api/src/context.ts`, `apps/server/src/services.ts`, `apps/server/src/trpc-error-log.ts`, `apps/server/src/trpc-error-log.test.ts`, `packages/api/src/routers/paypal.test.ts`, `apps/server/src/routes/paypal-onboarding.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/api/src/client-links.test.ts`, add `signPayLink` and `verifyPayLink` to the import from `./client-links`, and add this block. Reuse the file's existing secret constant if it has one; otherwise add `const SECRET = "a-test-secret-that-is-long-enough-123";`:

```ts
describe("pay links", () => {
  it("round-trips a payment id", async () => {
    const token = await signPayLink(SECRET, "payment-1");
    expect(await verifyPayLink(SECRET, token)).toBe("payment-1");
  });

  it("never accepts a client link as a pay link, or a pay link as a client link", async () => {
    expect(await verifyPayLink(SECRET, await signClientLink(SECRET, "id-1"))).toBeNull();
    expect(await verifyClientLink(SECRET, await signPayLink(SECRET, "id-1"))).toBeNull();
  });

  it("rejects a tampered pay link", async () => {
    const token = await signPayLink(SECRET, "payment-1");
    expect(await verifyPayLink(SECRET, token.replace("payment-1", "payment-2"))).toBeNull();
  });
});
```

In `apps/server/src/trpc-error-log.test.ts`, add:

```ts
  it("logs a client error caused by PayPal, so a declined card keeps its debug_id", () => {
    const cause = new PayPalError({
      status: 422,
      message: "The instrument presented was declined.",
      debugId: "d422",
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue: "INSTRUMENT_DECLINED", description: "Declined", value: "secret-ish" }],
    });

    const context = trpcErrorContext(new TRPCError({ code: "UNPROCESSABLE_CONTENT", cause }), "payment.payCapture");

    expect(context).toEqual({
      error: cause,
      fields: {
        trpc: { path: "payment.payCapture", code: "UNPROCESSABLE_CONTENT" },
        paypal: {
          status: 422,
          name: "UNPROCESSABLE_ENTITY",
          debugId: "d422",
          details: [{ issue: "INSTRUMENT_DECLINED", field: undefined }],
        },
      },
    });
  });

  it("still skips client errors that PayPal did not cause", () => {
    expect(trpcErrorContext(new TRPCError({ code: "BAD_REQUEST", message: "nope" }), "project.create")).toBeNull();
  });
```

Use the imports the file already has (`PayPalError`, `TRPCError`, `trpcErrorContext`). If an equivalent "skips client errors" test already exists, keep only the new PayPal test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/api/src/client-links.test.ts apps/server/src/trpc-error-log.test.ts`
Expected: FAIL. `signPayLink` is not exported, and the PayPal client-error test gets `null`.

- [ ] **Step 3: Implement pay links and the shared secret helper**

Replace `packages/api/src/client-links.ts` with:

```ts
// Signed links. `/c/{token}` names one project (services spec §5.2); `/pay/{token}` names one payment and
// carries no amount (§5.4). Both prove the bearer followed a link the team sent. The keys are derived from
// the Better Auth secret, so no new secret is needed, and each label separates its domain: a client token
// is never a pay token, and neither is ever a session token.
const encoder = new TextEncoder();

const CLIENT_LINK_LABEL = "payleor client link v1";
const PAY_LINK_LABEL = "payleor pay link v1";

async function linkKey(secret: string, label: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(label));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function unbase64url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function signLink(secret: string, label: string, id: string): Promise<string> {
  const key = await linkKey(secret, label);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(id));
  return `${id}.${base64url(signature)}`;
}

// The id when the signature verifies, otherwise null. `subtle.verify` compares in constant time.
async function verifyLink(secret: string, label: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  let signature: Uint8Array;
  try {
    signature = unbase64url(token.slice(dot + 1));
  } catch {
    return null;
  }
  const key = await linkKey(secret, label);
  const ok = await crypto.subtle.verify("HMAC", key, signature as BufferSource, encoder.encode(id));
  return ok ? id : null;
}

export function signClientLink(secret: string, projectId: string): Promise<string> {
  return signLink(secret, CLIENT_LINK_LABEL, projectId);
}

export function verifyClientLink(secret: string, token: string): Promise<string | null> {
  return verifyLink(secret, CLIENT_LINK_LABEL, token);
}

export function signPayLink(secret: string, paymentId: string): Promise<string> {
  return signLink(secret, PAY_LINK_LABEL, paymentId);
}

export function verifyPayLink(secret: string, token: string): Promise<string | null> {
  return verifyLink(secret, PAY_LINK_LABEL, token);
}

// The links are signed with the Better Auth secret.
export function linkSecret(auth: { options: Record<string, unknown> }): string {
  const secret = auth.options.secret;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("The link secret (BETTER_AUTH_SECRET) is not configured.");
  }
  return secret;
}
```

In `packages/api/src/routers/project.ts`:
- change the import to `import { linkSecret, signClientLink, verifyClientLink } from "../client-links";`;
- delete the local `clientLinkSecret` function and its comment;
- replace every `clientLinkSecret(` call with `linkSecret(`. A missing secret now throws a plain `Error`, which tRPC reports as INTERNAL_SERVER_ERROR, the same code as before.

- [ ] **Step 4: Implement the SDK settings and the error log rule**

In `packages/api/src/context.ts`, add to `PayPalServices` after `returnUrl`:

```ts
  // What the browser's JS SDK v6 needs. All public values (R1 facts §5).
  sdk: { clientId: string; partnerAttributionId: string; environment: "sandbox" | "live" };
```

In `apps/server/src/services.ts`, in the object returned by `getPayPalServices`, add after `returnUrl`:

```ts
    sdk: { clientId: ENV.PAYPAL_CLIENT_ID, partnerAttributionId: ENV.PAYPAL_ATTRIBUTION_ID, environment },
```

Add the same field to the two test fakes:
- in `packages/api/src/routers/paypal.test.ts`, inside `makePayPal`'s returned object;
- in `apps/server/src/routes/paypal-onboarding.test.ts`, inside `makePayPal`'s returned object.

```ts
    sdk: { clientId: "partner-client-id", partnerAttributionId: "PAYLEOR_BN", environment: "sandbox" },
```

In `apps/server/src/trpc-error-log.ts`, replace the comment above `trpcErrorContext` and its first line with:

```ts
// Client errors (4xx codes) are already explained to the caller, so only server errors need a log trail.
// Errors PayPal caused are the exception: a declined payment method still needs its debug_id on record.
// PayPal detail values can echo request data, so only the issue and the field are kept.
export function trpcErrorContext(error: TRPCError, path: string | undefined): TrpcErrorContext | null {
  if (error.code !== "INTERNAL_SERVER_ERROR" && !(error.cause instanceof PayPalError)) return null;
```

The rest of the function stays.

- [ ] **Step 5: Run the tests and the type checks**

```bash
pnpm test packages/api/src/client-links.test.ts apps/server/src/trpc-error-log.test.ts packages/api/src/routers/project.test.ts packages/api/src/routers/paypal.test.ts apps/server/src/routes/paypal-onboarding.test.ts
pnpm check-types
```

Expected: everything passes, and `check-types` reports no errors in any package.

- [ ] **Step 6: Commit**

```bash
git add packages/api apps/server
git commit -F - <<'EOF'
feat(api): sign pay links, expose the JS SDK settings and log PayPal client errors

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
EOF
```

---

### Task 5: Apply a capture once (`applyCaptureFact`)

**Files:**
- Create: `packages/api/src/use-cases/payments.ts`, `packages/api/src/routers/payment.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/routers/payment.test.ts`:

```ts
import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import { ledgerAccounts } from "@jendal-workspace/core";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { payment } from "@jendal-workspace/db/schema/projects";
import {
  createTestDb,
  hasTestDatabase,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink } from "../client-links";
import type { PayPalServices } from "../context";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { applyCaptureFact, type CaptureFact } from "../use-cases/payments";
import { appRouter } from "./index";

const SECRET = TEST_AUTH_CONFIG.BETTER_AUTH_SECRET;
const DAY_MS = 86_400_000;
const ITEMS = [
  { description: "Design", amountMinor: 40_000, extraDays: 0 },
  { description: "Build", amountMinor: 60_000, extraDays: 0 },
];

describe.skipIf(!hasTestDatabase)("payments", () => {
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
      catalog: createTestCatalogServices(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  // A $1,000 quote accepted by the client: a pending $600 deposit ($500 + the 10% management fee).
  async function pendingDeposit() {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await callerFor(userId).project.create({
      teamSlug: "team",
      title: "Website redesign",
      clientEmail: "client@example.com",
    });
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 14,
    });
    const { paymentId } = await callerFor(null).project.clientAcceptQuote({
      token: await signClientLink(SECRET, projectId),
      quoteId,
    });
    return { userId, teamId, projectId, paymentId };
  }

  async function depositWithOrder() {
    const seeded = await pendingDeposit();
    await db.update(payment).set({ paypalOrderId: "ORDER1" }).where(eq(payment.id, seeded.paymentId));
    return seeded;
  }

  function fact(paymentId: string, overrides: Partial<CaptureFact> = {}): CaptureFact {
    return {
      paymentId,
      orderId: "ORDER1",
      captureId: "CAPTURE1",
      status: "COMPLETED",
      amountMinor: 60_000,
      currency: "USD",
      ...overrides,
    };
  }

  async function paymentRow(paymentId: string) {
    const [row] = await db.select().from(payment).where(eq(payment.id, paymentId));
    return row;
  }

  describe("applyCaptureFact", () => {
    it("applies a completed deposit capture once: payment, ledger, project and outbox", async () => {
      const { projectId, paymentId } = await depositWithOrder();
      const before = Date.now();

      expect(await applyCaptureFact(db, fact(paymentId))).toBe("applied");
      expect(await applyCaptureFact(db, fact(paymentId))).toBe("already_applied");

      expect(await paymentRow(paymentId)).toMatchObject({ status: "captured", paypalCaptureId: "CAPTURE1" });
      const project = await findProjectById(db, projectId);
      expect(project?.status).toBe("in_progress");
      // Services spec §5.2 step 4: the deadline runs from the capture, for the quote's 14 days.
      expect(project?.deadlineAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before + 14 * DAY_MS);
      expect(await db.select().from(ledgerTransfer)).toHaveLength(1);
      expect(await db.select().from(ledgerBalance)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: ledgerAccounts.clientHeld(projectId), balanceMinor: 50_000 }),
          expect.objectContaining({ account: ledgerAccounts.teamRevenue, balanceMinor: 10_000 }),
        ]),
      );
      const events = await db.select().from(outbox).where(eq(outbox.type, "payment.captured"));
      expect(events).toEqual([
        expect.objectContaining({ projectId, data: expect.objectContaining({ paymentId, captureId: "CAPTURE1" }) }),
      ]);
    });

    it("refuses a capture whose amount or currency differs from the payment", async () => {
      const { paymentId } = await depositWithOrder();

      await expect(applyCaptureFact(db, fact(paymentId, { amountMinor: 59_999 }))).rejects.toThrow(/does not match/);
      await expect(applyCaptureFact(db, fact(paymentId, { currency: "EUR" }))).rejects.toThrow(/does not match/);
      expect((await paymentRow(paymentId))?.status).toBe("pending");
    });

    it("records a pending capture, then applies its completion", async () => {
      const { projectId, paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId, { status: "PENDING", amountMinor: null, currency: null }))).toBe(
        "pending",
      );
      expect(await paymentRow(paymentId)).toMatchObject({ status: "pending", paypalCaptureId: "CAPTURE1" });
      expect((await findProjectById(db, projectId))?.status).toBe("awaiting_deposit");

      expect(await applyCaptureFact(db, fact(paymentId))).toBe("applied");
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("marks a declined capture failed, once, and leaves the project waiting", async () => {
      const { projectId, paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId, { status: "DECLINED" }))).toBe("failed");
      expect(await applyCaptureFact(db, fact(paymentId, { status: "DECLINED" }))).toBe("already_applied");

      expect(await paymentRow(paymentId)).toMatchObject({ status: "failed", paypalCaptureId: "CAPTURE1" });
      expect((await findProjectById(db, projectId))?.status).toBe("awaiting_deposit");
      expect(await db.select().from(outbox).where(eq(outbox.type, "payment.failed"))).toHaveLength(1);
    });

    it("ignores news about an order the payment no longer uses, unless money moved", async () => {
      const { paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId, { orderId: "OLD", captureId: "C-OLD", status: "DECLINED" }))).toBe(
        "stale",
      );
      await expect(applyCaptureFact(db, fact(paymentId, { orderId: "OLD", captureId: "C-OLD" }))).rejects.toThrow(
        /no longer uses/,
      );
    });

    it("refuses a second capture for the same payment", async () => {
      const { paymentId } = await depositWithOrder();
      await applyCaptureFact(db, fact(paymentId));

      await expect(applyCaptureFact(db, fact(paymentId, { captureId: "CAPTURE2" }))).rejects.toThrow(/already has capture/);
    });
  });
});
```

`makeSession` comes from `packages/api/src/testing.ts`. If that module exports it under another name, use that name. If it does not export it, copy the `makeSession` function from `packages/api/src/routers/project.test.ts` into this file instead.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/api/src/routers/payment.test.ts`
Expected: FAIL: `../use-cases/payments` does not exist.

- [ ] **Step 3: Implement `applyCaptureFact`**

Create `packages/api/src/use-cases/payments.ts`:

```ts
import { paymentCapturedTransfer, transitionProject, transitionRefusalMessage } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { findProjectById, getCurrentQuote, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { payment, type project } from "@jendal-workspace/db/schema/projects";
import { and, eq } from "drizzle-orm";

// One capture as PayPal reports it: from a capture response, an order lookup or a webhook (R1c).
export type CaptureFact = {
  paymentId: string;
  orderId: string;
  captureId: string;
  status: string;
  // Null when PayPal sent no amount (a pending capture can omit it).
  amountMinor: number | null;
  currency: string | null;
};

// "stale": the fact is about an order this payment no longer uses, and no money moved.
export type CaptureFactResult = "applied" | "already_applied" | "pending" | "failed" | "stale";

const DAY_MS = 86_400_000;

type PaymentRow = typeof payment.$inferSelect;

class FactAlreadyApplied extends Error {}
class StaleFact extends Error {}

async function lockPayment(tx: Transaction, paymentId: string): Promise<PaymentRow> {
  const [row] = await tx.select().from(payment).where(eq(payment.id, paymentId)).limit(1).for("update");
  if (!row) throw new Error(`PayPal reported capture news for unknown payment ${paymentId}`);
  return row;
}

// A payment has one capture. Another capture id, or a completed capture on an abandoned order, means money
// moved in a way Payleor did not ask for; that needs a person, so it throws instead of guessing.
function checkCaptureBelongs(row: PaymentRow, fact: CaptureFact): void {
  if (row.paypalCaptureId && row.paypalCaptureId !== fact.captureId) {
    throw new Error(`Payment ${row.id} already has capture ${row.paypalCaptureId}; PayPal reported ${fact.captureId}`);
  }
  if (row.paypalOrderId !== fact.orderId && row.paypalCaptureId !== fact.captureId) {
    if (fact.status === "COMPLETED") {
      throw new Error(`Capture ${fact.captureId} completed on order ${fact.orderId}, which payment ${row.id} no longer uses`);
    }
    throw new StaleFact();
  }
}

async function projectChangeOnCapture(
  tx: Transaction,
  row: ProjectRow,
  kind: PaymentRow["kind"],
): Promise<Partial<typeof project.$inferInsert>> {
  if (kind === "top_up") return {};
  if (kind === "balance") {
    // The balance capture completes the project with the completion postings (services spec §6.3, run 2).
    throw new Error(`Payment kind ${kind} cannot be captured yet`);
  }
  const result = transitionProject(row.status, "deposit_captured");
  if (!result.ok) {
    throw new Error(`Project ${row.id} cannot take its deposit: ${transitionRefusalMessage(result.reason)}`);
  }
  const quote = await getCurrentQuote(tx, row.id);
  if (!quote) throw new Error(`Project ${row.id} has a deposit but no accepted quote`);
  // Services spec §5.2 step 4: the deadline runs from the capture.
  return { status: result.to, deadlineAt: new Date(Date.now() + quote.deliveryDays * DAY_MS) };
}

// A pending capture changes no money: it only records the capture id, so the later outcome matches it.
async function recordPendingCapture(db: Database, fact: CaptureFact): Promise<CaptureFactResult> {
  const updated = await db
    .update(payment)
    .set({ paypalCaptureId: fact.captureId })
    .where(and(eq(payment.id, fact.paymentId), eq(payment.status, "pending"), eq(payment.paypalOrderId, fact.orderId)))
    .returning({ id: payment.id });
  return updated.length > 0 ? "pending" : "stale";
}

// Services spec §6.4: applies each capture outcome at most once, whichever input reports it first. The
// payment row stays locked for the transaction, so the pay page and a webhook cannot both apply it.
export async function applyCaptureFact(db: Database, fact: CaptureFact): Promise<CaptureFactResult> {
  if (fact.status === "PENDING") return recordPendingCapture(db, fact);
  if (fact.status !== "COMPLETED" && fact.status !== "DECLINED" && fact.status !== "FAILED") {
    // REFUNDED and PARTIALLY_REFUNDED are refund news, handled with refunds.
    throw new Error(`Capture ${fact.captureId} has status ${fact.status}, which is not a capture outcome`);
  }
  try {
    return await runInTransaction(db, async (tx, uow) => {
      const row = await lockPayment(tx, fact.paymentId);
      checkCaptureBelongs(row, fact);
      if (row.status === "captured" || (row.status === "failed" && row.paypalCaptureId === fact.captureId)) {
        throw new FactAlreadyApplied();
      }
      const projectRow = await findProjectById(tx, row.projectId);
      if (!projectRow) throw new Error(`Payment ${row.id} has no project`);

      if (fact.status === "COMPLETED") {
        if (fact.amountMinor !== row.amountMinor || fact.currency !== row.currency) {
          throw new Error(
            `Capture ${fact.captureId} (${fact.currency} ${fact.amountMinor}) does not match payment ${row.id} (${row.currency} ${row.amountMinor})`,
          );
        }
        await tx
          .update(payment)
          .set({ status: "captured", paypalCaptureId: fact.captureId, capturedAt: new Date(), version: row.version + 1 })
          .where(eq(payment.id, row.id));
        await uow.apply({
          project: projectRow,
          set: await projectChangeOnCapture(tx, projectRow, row.kind),
          transfers: [
            paymentCapturedTransfer({
              currency: row.currency,
              projectId: row.projectId,
              paymentId: row.id,
              quotePartMinor: row.quotePartMinor,
              managementFeeMinor: row.managementFeeMinor,
            }),
          ],
          events: [
            {
              type: "payment.captured",
              data: { paymentId: row.id, kind: row.kind, amountMinor: row.amountMinor, captureId: fact.captureId },
            },
          ],
        });
        return "applied";
      }

      await tx
        .update(payment)
        .set({ status: "failed", paypalCaptureId: fact.captureId, version: row.version + 1 })
        .where(eq(payment.id, row.id));
      await uow.apply({
        project: projectRow,
        set: {},
        events: [{ type: "payment.failed", data: { paymentId: row.id, kind: row.kind, captureId: fact.captureId, status: fact.status } }],
      });
      return "failed";
    });
  } catch (error) {
    // Thrown inside the transaction to roll it back: nothing was written.
    if (error instanceof FactAlreadyApplied) return "already_applied";
    if (error instanceof StaleFact) return "stale";
    throw error;
  }
}
```

Two type notes:
- `import { payment, type project }` imports the `project` table only for its `$inferInsert` type. If the linter or TypeScript rejects `type` on a value import, use `import type { project } from "@jendal-workspace/db/schema/projects";` as a separate line.
- If Drizzle's builder rejects `.limit(1).for("update")`, use `.for("update").limit(1)`; both produce `select … limit 1 for update`.

- [ ] **Step 4: Run the tests**

```bash
pnpm test packages/api/src/routers/payment.test.ts
pnpm -F @jendal-workspace/api check-types
```

Expected: the 6 `applyCaptureFact` tests pass (not skipped), and the type check passes.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/use-cases/payments.ts packages/api/src/routers/payment.test.ts
git commit -F - <<'EOF'
feat(api): apply each PayPal capture once to the payment, ledger, project and outbox

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
EOF
```

---

### Task 6: Start and capture payments; the payment router; pay paths on the client page

**Files:**
- Modify: `packages/api/src/use-cases/payments.ts`, `packages/api/src/routers/payment.test.ts`, `packages/api/src/routers/index.ts`, `packages/api/src/routers/project.ts`, `packages/api/src/routers/project.test.ts`
- Create: `packages/api/src/routers/payment.ts`

- [ ] **Step 1: Write the failing router tests**

In `packages/api/src/routers/payment.test.ts`, add these imports:

```ts
import { markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { buildAuthAssertion, createPayPalClient } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
```

Change the `client-links` import to `import { signClientLink, signPayLink, verifyPayLink } from "../client-links";`.

Add these helpers at the top level, above `describe.skipIf(...)`:

```ts
function capturedOrder(status: string, value = "600.00") {
  return {
    id: "ORDER1",
    status: status === "COMPLETED" ? "COMPLETED" : "PENDING",
    purchase_units: [{ payments: { captures: [{ id: "CAPTURE1", status, amount: { currency_code: "USD", value } }] } }],
  };
}

const DECLINED = {
  name: "UNPROCESSABLE_ENTITY",
  message: "The requested action could not be performed.",
  debug_id: "d422",
  details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was declined." }],
};

const ALREADY_CAPTURED = { ...DECLINED, details: [{ issue: "ORDER_ALREADY_CAPTURED", description: "Already captured." }] };

// A fake PayPal API: token, order create (always ORDER1), capture and order lookup.
function fakePayPalApi(options: { capture?: () => Response; lookup?: () => Response } = {}) {
  return fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.method === "POST" && request.url.endsWith("/v2/checkout/orders")) {
      return jsonResponse(201, { id: "ORDER1", status: "CREATED" });
    }
    if (request.url.endsWith("/v2/checkout/orders/ORDER1/capture")) {
      return options.capture?.() ?? jsonResponse(201, capturedOrder("COMPLETED"));
    }
    if (request.method === "GET" && request.url.endsWith("/v2/checkout/orders/ORDER1")) {
      return options.lookup?.() ?? jsonResponse(200, capturedOrder("COMPLETED"));
    }
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
}

function makePayPal(fetchImpl: Parameters<typeof createPayPalClient>[0]["fetch"]): PayPalServices {
  return {
    client: createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
      partnerAttributionId: "PAYLEOR_BN",
    }),
    partnerId: "PARTNER42",
    returnUrl: "https://admin.example.com/api/paypal/onboarding/return",
    sdk: { clientId: "partner-client-id", partnerAttributionId: "PAYLEOR_BN", environment: "sandbox" },
  };
}

function calls(requests: RecordedRequest[], suffix: string): RecordedRequest[] {
  return requests.filter((r) => r.url.endsWith(suffix));
}
```

Inside `describe.skipIf(!hasTestDatabase)("payments", ...)`, after the `applyCaptureFact` block, add:

```ts
  async function connectedDeposit() {
    const seeded = await pendingDeposit();
    await markTeamPayPalMerchant(db, { teamId: seeded.teamId, merchantId: "SELLER1" });
    return { ...seeded, token: await signPayLink(SECRET, seeded.paymentId) };
  }

  describe("payment router", () => {
    it("shows the pay page with the SDK settings and a way back to the project", async () => {
      const { projectId, paymentId, token } = await connectedDeposit();
      const { fetch } = fakePayPalApi();

      const page = await callerFor(null, makePayPal(fetch)).payment.payGet({ token });

      expect(page).toMatchObject({
        payment: { id: paymentId, kind: "deposit", status: "pending", currency: "USD", amountMinor: 60_000 },
        project: { id: projectId, title: "Website redesign" },
        team: { name: "team" },
        paypal: {
          clientId: "partner-client-id",
          partnerAttributionId: "PAYLEOR_BN",
          environment: "sandbox",
          merchantId: "SELLER1",
        },
        clientPath: `/c/${await signClientLink(SECRET, projectId)}`,
      });
      await expect(callerFor(null).payment.payGet({ token: `${paymentId}.bad` })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("says PayPal is not available while the team is not connected", async () => {
      const { paymentId } = await pendingDeposit();
      const { fetch } = fakePayPalApi();
      const token = await signPayLink(SECRET, paymentId);

      expect((await callerFor(null, makePayPal(fetch)).payment.payGet({ token })).paypal).toBeNull();
      await expect(callerFor(null, makePayPal(fetch)).payment.payStart({ token })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await expect(callerFor(null).payment.payStart({ token })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("creates an order for the team with Payleor's 1% Team fee", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi();

      expect(await callerFor(null, makePayPal(fetch)).payment.payStart({ token })).toEqual({ orderId: "ORDER1" });

      const [create] = calls(requests, "/v2/checkout/orders");
      expect(create?.headers.get("paypal-auth-assertion")).toBe(
        buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER1" }),
      );
      expect(JSON.parse(create?.body ?? "{}").purchase_units[0]).toMatchObject({
        custom_id: paymentId,
        description: "Website redesign",
        amount: { currency_code: "USD", value: "600.00" },
        payee: { merchant_id: "SELLER1" },
        payment_instruction: { platform_fees: [{ amount: { currency_code: "USD", value: "6.00" } }] },
      });
      expect(await paymentRow(paymentId)).toMatchObject({ paypalOrderId: "ORDER1", platformFeeMinor: 600, status: "pending" });
    });

    it("captures the deposit, starts the work, and answers a repeated capture without calling PayPal again", async () => {
      const { projectId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi();
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "captured" });
      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "captured" });

      expect(calls(requests, "/capture")).toHaveLength(1);
      expect(calls(requests, "/capture")[0]?.headers.get("paypal-request-id")).toMatch(/^capture:ORDER1:/);
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("lets the client choose another way to pay after INSTRUMENT_DECLINED", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { fetch } = fakePayPalApi({ capture: () => jsonResponse(422, DECLINED) });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      await expect(caller.payment.payCapture({ token, orderId: "ORDER1" })).rejects.toMatchObject({
        code: "UNPROCESSABLE_CONTENT",
        message: "PayPal declined this payment method. Choose another way to pay.",
      });
      expect((await paymentRow(paymentId))?.status).toBe("pending");
      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });
    });

    it("applies the capture from the order when PayPal says it is already captured", async () => {
      const { projectId, token } = await connectedDeposit();
      const { requests, fetch } = fakePayPalApi({ capture: () => jsonResponse(422, ALREADY_CAPTURED) });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "captured" });

      expect(requests.some((r) => r.method === "GET" && r.url.endsWith("/v2/checkout/orders/ORDER1"))).toBe(true);
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("reports a declined capture and lets the client start again", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { fetch } = fakePayPalApi({ capture: () => jsonResponse(201, capturedOrder("DECLINED")) });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "declined" });
      expect((await paymentRow(paymentId))?.status).toBe("failed");

      expect(await caller.payment.payStart({ token })).toEqual({ orderId: "ORDER1" });
      expect(await paymentRow(paymentId)).toMatchObject({ status: "pending", paypalCaptureId: null });
    });

    it("reports a pending capture and refuses to start a second order while PayPal finishes it", async () => {
      const { paymentId, token } = await connectedDeposit();
      const { fetch } = fakePayPalApi({ capture: () => jsonResponse(201, capturedOrder("PENDING")) });
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      expect(await caller.payment.payCapture({ token, orderId: "ORDER1" })).toEqual({ outcome: "pending" });
      expect(await paymentRow(paymentId)).toMatchObject({ status: "pending", paypalCaptureId: "CAPTURE1" });
      await expect(caller.payment.payStart({ token })).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("refuses to capture an order the payment no longer uses", async () => {
      const { token } = await connectedDeposit();
      const { fetch } = fakePayPalApi();
      const caller = callerFor(null, makePayPal(fetch));
      await caller.payment.payStart({ token });

      await expect(caller.payment.payCapture({ token, orderId: "ORDER9" })).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  it("gives the client page a pay path for a payment that can be paid, and none once it is paid", async () => {
    const { projectId, paymentId, token } = await connectedDeposit();
    const clientToken = await signClientLink(SECRET, projectId);

    const before = await callerFor(null).project.clientGet({ token: clientToken });
    const payPath = before.payments[0]?.payPath ?? "";
    expect(payPath).toBe(`/pay/${token}`);
    expect(await verifyPayLink(SECRET, payPath.slice("/pay/".length))).toBe(paymentId);

    await db.update(payment).set({ paypalOrderId: "ORDER1" }).where(eq(payment.id, paymentId));
    await applyCaptureFact(db, fact(paymentId));
    const after = await callerFor(null).project.clientGet({ token: clientToken });
    expect(after.payments[0]?.payPath).toBeNull();
  });
```

The team created by `seedServicesTeamWithAdmin` has slug `team`, and its name defaults to the slug, so `team: { name: "team" }` is right. If the seeder names it differently, read `packages/db/src/testing/db.ts` and use that name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/api/src/routers/payment.test.ts`
Expected: the `applyCaptureFact` tests still pass. The router tests fail: `payment` is not on the router, and `clientGet` has no `payPath`.

- [ ] **Step 3: Implement the use cases**

In `packages/api/src/use-cases/payments.ts`, extend the imports:

```ts
import {
  parseMajorAmount,
  paymentCapturedTransfer,
  platformFeeMinor,
  sellerPlanFor,
  toPayPalValue,
  transitionProject,
  transitionRefusalMessage,
} from "@jendal-workspace/core";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import { captureFromOrder, PayPalError, type PayPalOrder } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";

import type { PayPalServices } from "../context";
```

Then append:

```ts
export type PaymentDeps = { db: Database; paypal: PayPalServices };

async function requirePayment(db: Database, paymentId: string): Promise<PaymentRow> {
  const [row] = await db.select().from(payment).where(eq(payment.id, paymentId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return row;
}

async function requireSeller(db: Database, teamId: string): Promise<{ merchantId: string; name: string }> {
  const team = await findTeamById(db, teamId);
  if (!team?.paypalMerchantId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This team cannot take PayPal payments yet." });
  }
  return { merchantId: team.paypalMerchantId, name: team.name };
}

export async function getPayPage(deps: { db: Database; paypal: PayPalServices | undefined }, paymentId: string) {
  const row = await requirePayment(deps.db, paymentId);
  const [projectRow, team] = await Promise.all([findProjectById(deps.db, row.projectId), findTeamById(deps.db, row.teamId)]);
  if (!projectRow || !team) throw new Error(`Payment ${row.id} has no project or team`);
  return {
    payment: {
      id: row.id,
      kind: row.kind,
      status: row.status,
      currency: row.currency,
      amountMinor: row.amountMinor,
      lines: row.lines,
      capturedAt: row.capturedAt,
    },
    project: { id: projectRow.id, title: projectRow.title },
    team: { name: team.name },
    // Null until the server has PayPal configured and the team has connected its account.
    paypal: deps.paypal && team.paypalMerchantId ? { ...deps.paypal.sdk, merchantId: team.paypalMerchantId } : null,
  };
}

// Services spec §5.4. Every start creates a fresh order for the payment's amount and makes it the only
// order this payment can be captured on, so an abandoned order can never be paid as well.
export async function startPayment(deps: PaymentDeps, paymentId: string): Promise<{ orderId: string }> {
  const row = await requirePayment(deps.db, paymentId);
  if (row.status === "captured") throw new TRPCError({ code: "CONFLICT", message: "This payment is already paid." });
  if (row.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This payment was cancelled." });
  if (row.status === "pending" && row.paypalCaptureId) {
    throw new TRPCError({ code: "CONFLICT", message: "PayPal is still processing this payment. Check back soon." });
  }
  if (row.kind === "balance") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Balance payments open once deliveries can be accepted." });
  }
  const projectRow = await findProjectById(deps.db, row.projectId);
  if (!projectRow) throw new Error(`Payment ${row.id} has no project`);
  const seller = await requireSeller(deps.db, row.teamId);
  const fee = platformFeeMinor(row.amountMinor, sellerPlanFor({ id: row.teamId }).feeBps);
  const order = await deps.paypal.client.orders.create({
    // A new key per start: each start is a new order, while the client's own retries reuse this key.
    requestId: `order:${row.id}:${crypto.randomUUID()}`,
    merchantId: seller.merchantId,
    currency: row.currency,
    value: toPayPalValue(row.amountMinor),
    platformFeeValue: fee > 0 ? toPayPalValue(fee) : null,
    customId: row.id,
    description: projectRow.title,
    brandName: seller.name,
  });
  const updated = await deps.db
    .update(payment)
    .set({ paypalOrderId: order.id, platformFeeMinor: fee, status: "pending", paypalCaptureId: null, version: row.version + 1 })
    .where(and(eq(payment.id, row.id), eq(payment.version, row.version)))
    .returning({ id: payment.id });
  if (updated.length === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "This payment changed. Reload the page and try again." });
  }
  return { orderId: order.id };
}

export type CaptureOutcome = "captured" | "pending" | "declined";

function hasIssue(error: PayPalError, issue: string): boolean {
  return error.details.some((detail) => detail.issue === issue);
}

export async function capturePayment(
  deps: PaymentDeps,
  input: { paymentId: string; orderId: string },
): Promise<{ outcome: CaptureOutcome }> {
  const row = await requirePayment(deps.db, input.paymentId);
  if (row.paypalOrderId !== input.orderId) {
    throw new TRPCError({ code: "CONFLICT", message: "This payment was restarted. Reload the page and try again." });
  }
  if (row.status === "captured") return { outcome: "captured" };
  const seller = await requireSeller(deps.db, row.teamId);
  let order: PayPalOrder;
  try {
    order = await deps.paypal.client.orders.capture({
      orderId: input.orderId,
      // A new key per attempt: after INSTRUMENT_DECLINED the client approves again, and a reused key would
      // replay the decline. PayPal refuses a second capture of the order (ORDER_ALREADY_CAPTURED).
      requestId: `capture:${input.orderId}:${crypto.randomUUID()}`,
      merchantId: seller.merchantId,
    });
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    if (hasIssue(error, "INSTRUMENT_DECLINED")) {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: "PayPal declined this payment method. Choose another way to pay.",
        cause: error,
      });
    }
    if (!hasIssue(error, "ORDER_ALREADY_CAPTURED")) throw error;
    // An earlier capture succeeded but its answer was lost: the order holds the capture to apply.
    order = await deps.paypal.client.orders.get({ orderId: input.orderId, merchantId: seller.merchantId });
  }
  const capture = captureFromOrder(order);
  if (!capture) throw new Error(`PayPal order ${input.orderId} has no capture`);
  const result = await applyCaptureFact(deps.db, {
    paymentId: row.id,
    orderId: input.orderId,
    captureId: capture.id,
    status: capture.status,
    amountMinor: capture.amount ? parseMajorAmount(capture.amount.value) : null,
    currency: capture.amount?.currency_code ?? null,
  });
  if (result === "stale") {
    throw new TRPCError({ code: "CONFLICT", message: "This payment was restarted. Reload the page and try again." });
  }
  if (capture.status === "COMPLETED") return { outcome: "captured" };
  if (capture.status === "PENDING") return { outcome: "pending" };
  return { outcome: "declined" };
}
```

- [ ] **Step 4: Implement the router and the pay paths**

Create `packages/api/src/routers/payment.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { linkSecret, signClientLink, verifyPayLink } from "../client-links";
import type { Context, PayPalServices } from "../context";
import { publicProcedure, router } from "../index";
import { capturePayment, getPayPage, startPayment } from "../use-cases/payments";

const tokenInput = z.object({ token: z.string().min(1).max(200) });

async function paymentIdFromToken(auth: Context["auth"], token: string): Promise<string> {
  const paymentId = await verifyPayLink(linkSecret(auth), token);
  if (!paymentId) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return paymentId;
}

function requirePayPal(paypal: PayPalServices | undefined): PayPalServices {
  if (!paypal) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PayPal is not configured on this server." });
  return paypal;
}

// The pay page (services spec §5.4): a signed link, no account. The amount always comes from the database.
export const paymentRouter = router({
  payGet: publicProcedure.input(tokenInput).query(async ({ ctx, input }) => {
    const paymentId = await paymentIdFromToken(ctx.auth, input.token);
    const page = await getPayPage({ db: ctx.db, paypal: ctx.paypal }, paymentId);
    return { ...page, clientPath: `/c/${await signClientLink(linkSecret(ctx.auth), page.project.id)}` };
  }),

  payStart: publicProcedure.input(tokenInput).mutation(async ({ ctx, input }) => {
    const paymentId = await paymentIdFromToken(ctx.auth, input.token);
    return startPayment({ db: ctx.db, paypal: requirePayPal(ctx.paypal) }, paymentId);
  }),

  payCapture: publicProcedure
    .input(tokenInput.extend({ orderId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const paymentId = await paymentIdFromToken(ctx.auth, input.token);
      return capturePayment({ db: ctx.db, paypal: requirePayPal(ctx.paypal) }, { paymentId, orderId: input.orderId });
    }),
});
```

If `Context["auth"]` does not satisfy `linkSecret`'s `{ options: Record<string, unknown> }` parameter, use `{ options: Record<string, unknown> }` as the type of `auth`, as `project.ts` does.

In `packages/api/src/routers/index.ts`, import `paymentRouter` from `./payment` and add `payment: paymentRouter,` after `catalog`, keeping the keys alphabetical.

In `packages/api/src/routers/project.ts`, change the client-links import to `import { linkSecret, signClientLink, signPayLink, verifyClientLink } from "../client-links";`. In `clientGet`, before the `return`, build the payment views:

```ts
    const secret = linkSecret(ctx.auth);
    // Pending and failed payments can be paid; the pay link names the payment, never the amount (§5.4).
    const paymentViews = await Promise.all(
      payments.map(async (p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        amountMinor: p.amountMinor,
        lines: p.lines,
        createdAt: p.createdAt,
        payPath: p.status === "pending" || p.status === "failed" ? `/pay/${await signPayLink(secret, p.id)}` : null,
      })),
    );
```

Then return `payments: paymentViews,` instead of the inline `payments.map(...)`.

- [ ] **Step 5: Run the tests and the type check**

```bash
pnpm test packages/api/src/routers/payment.test.ts packages/api/src/routers/project.test.ts
pnpm check-types
```

Expected: every test passes (the payment suite runs 6 `applyCaptureFact` tests, 9 router tests and the pay-path test), and `check-types` reports no errors. If `apps/web` fails to type-check because `payPath` is new on the client page data, nothing in the web app should need it yet; stop and report the error.

- [ ] **Step 6: Commit**

```bash
git add packages/api
git commit -F - <<'EOF'
feat(api): start and capture project payments through PayPal from a signed pay link

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
EOF
```

---

### Task 7: Full suite, merge and specs

- [ ] **Step 1: Run the full suite and the type checks in the worktree**

```bash
pnpm test
pnpm check-types
```

Expected: every test passes, with more than 741 tests. The type checks pass in all 11 packages. Record the test count.

- [ ] **Step 2: Merge into `main` without fast-forward**

```bash
test -z "$(git -C /home/mouhamed/dev/repos/jendal/worktrees/main status --porcelain)" && echo clean
git -C /home/mouhamed/dev/repos/jendal/worktrees/main merge --no-ff r1a-server-payments \
  -m "Merge branch 'r1a-server-payments': start and capture project payments on the server (R1a)" \
  -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

Expected: `clean` is printed before the merge (stop and ask if it is not), and the merge succeeds. `git merge` cannot read its message from stdin, so the message goes in `-m` paragraphs.

- [ ] **Step 3: Run the full suite and the type checks on `main`**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main && pnpm test && pnpm check-types
```

Expected: the same count as Step 1, all passing.

- [ ] **Step 4: Update the specs (not in git)**

- `/home/mouhamed/dev/repos/jendal/specs/platform/2026-10-07-sellers-minimal-flow-design.md` §11, run 1's scope cell: append "R1a (server payments) done 2026-10-07; R1b (pay page) and R1c (webhooks) next".
- `/home/mouhamed/dev/repos/jendal/specs/platform/2026-10-05-services-teams-design.md` §5.3, the "Payleor fee" row: replace it with `| Payleor fee | The seller plan's rate on each payment (pricing proposal); Team is 1%: $6 on $600, $3.50 on $350 |`.
- `/home/mouhamed/dev/repos/jendal/specs/README.md`: add a row for this plan after the R0 row.

---

## Outcome (2026-10-07)

Merged into `main` as `17a6499`: 789 tests (741 before), type checks clean in all 11 packages.

The Task 6 review found that "every start creates a fresh order" let a second order be paid: a restart during a capture, after a lost capture answer, or during a pending capture. The fix (`30aa386`, `a2be555`) keeps the payment's order while PayPal can still capture it, reconciles it with a lookup before replacing it, refuses captures on cancelled and failed payments, and recovers any failed capture from the order. Task 5's review added a retry after a lost project compare-and-set and the cancelled-payment rule (`26b2925`).

## Carried forward

- **R1b (pay page):**
  - a per-payment cooldown or rate limit on `payStart`;
  - show `processing` (a pending capture) and the "already paid" state;
  - the pay page links back to the client page, so a pay link grants client-page access, which is acceptable because both links are sent in the same message;
  - `payPath` is also issued for pending balance payments, which `startPayment` refuses until run 2.
- **R1c (webhooks):**
  - a capture that cannot be applied (amount mismatch, cancelled payment, second capture) must be logged with its capture id and parked, not retried forever;
  - pass PayPal's capture time into `CaptureFact` for the deadline;
  - check that evlog does not print a `PayPalError`'s detail values.
- **Before a walkthrough:** apply the new migration to the dev database (`pnpm db:migrate:dev` from the main worktree).

## Sandbox walkthrough (2026-10-07)

End to end on the dev stack with the PayPal sandbox: Walk Crew (services team) connected PayPal (merchant `TR4W3HLBT75MG`), a $300 quote was sent and accepted, `payStart` created order `18F87843UD7854704`, a sandbox buyer approved $180 on PayPal checkout, and `payCapture` returned `captured` (capture `5K696237F8772480U`).

Checked in the dev database: payment `captured`, `platform_fee_minor` 180 (1% of $180), version 2; project `in_progress`; one balanced `payment_captured` transfer (clearing −18000, team revenue +3000, client held +15000); outbox `payment.captured`. A second `payCapture` returned `captured` with no new transfer; a second `payStart` returned CONFLICT "already paid". The client page shows the deposit as captured.

Findings:

- **Solo owner cannot quote (run 2 or the solo-seller run).** The org owner acts as admin but has no `services_team_member` row, so the assignment list is empty and `requireTeamMember` refuses the owner. The test added the row by hand. Creating a services team should add its creator as a member, and a solo seller should be able to quote without an assignment step.
- **tRPC error responses include stack traces.** No `isDev` is set on `initTRPC`, so tRPC falls back to `NODE_ENV`, which Workers may not set. Set `isDev` from the environment explicitly (R1b, since the pay page is public).
- **The paying browser must not be signed in to PayPal as the seller** (`CANNOT_PAY_SELF`). Use a separate browser profile for buyer tests.
- **Platform fee confirmed in the sandbox seller account:** gross $180.00, PayPal fee −$7.32, "Partner Commission" −$1.80, net $170.88; the custom id is the payment id. The ledger records neither fee yet (backlog, sellers design §11.1).

The gaps are tracked in the sellers design, §11.1.
