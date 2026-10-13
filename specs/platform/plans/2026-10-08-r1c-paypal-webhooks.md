# R1c: PayPal Webhooks and Fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PayPal's webhooks reach Payleor, are verified, stored once and processed from a Queue. A capture the browser never reported (the client closed the page after approving, or a pending capture completed later) is applied from the webhook. Every captured payment records PayPal's fee and Payleor's platform fee, and the ledger posts both against the team's revenue, so the ledger matches the team's PayPal balance. The deadline runs from PayPal's capture time. Facts that cannot be applied are parked for a person instead of retried forever.

**Architecture:** `packages/paypal` gains webhook signature verification (the postback API, sending PayPal's body unchanged), a webhook event parser, and the capture's fee breakdown and time. `core` gains two ledger accounts (`paypal_fees`, `payleor_fees`) and a `payment_fees` transfer. `db` gains `paypal_webhook_event` (the event's ids only, no payload) and `payment.paypal_fee_minor`. `api` gains `recordCaptureFees`, a `CaptureFactConflict` error for facts a person must look at, capture time in `CaptureFact`, and `processPayPalWebhookEvent`, which re-fetches the order from PayPal and applies its current state. `apps/server` gains `POST /webhooks/paypal` (verify, store, enqueue, 200) and a `queue()` handler; Alchemy declares the Queue and its consumer.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Cloudflare Queues through Alchemy 2 (beta 80), Drizzle ORM 1.0 rc, Vitest 5, evlog.

**Spec:** [`../2026-10-05-services-teams-design.md`](../2026-10-05-services-teams-design.md) §6.1–6.4; [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §11 (run 1) and §11.1 (backlog: fees in the ledger); PayPal facts in [`../2026-10-07-r1-paypal-facts.md`](../2026-10-07-r1-paypal-facts.md) §2–4; R1a "Carried forward" and R1b "Outcome" in this folder.

**Builds on:** `main` at `a46bcf2` (R1b merged; 802 tests).

**Out of scope:**
- **Refunds and reversals** (`PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`): parked for a person here; refunds are run 4, chargebacks the disputes phase.
- **Onboarding events** (`MERCHANT.*`, `CUSTOMER.MERCHANT-INTEGRATION.*`): ignored here; the return URL already refreshes onboarding.
- **The deployed webhook** (a second registration for the deployed API host, its webhook ID in the deployed env): run 7.
- **Outgoing webhooks and the outbox consumer:** later runs.

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/r1c-paypal-webhooks`, created in Task 0. `main` is at `/home/mouhamed/dev/repos/jendal/worktrees/main`; the merge in Task 9 happens there.

**Tests that need Postgres** use the Docker container `jendal-pg` through `.env.test.local` (copied in Task 0). The full suite takes about 6 minutes; run targeted tests per task.

## Facts this plan relies on

Checked on 2026-10-08 against the sandbox and the sources in [`../2026-10-07-r1-paypal-facts.md`](../2026-10-07-r1-paypal-facts.md):

1. **The sandbox partner app already has a webhook:** ID `3EJ41953HX9926248`, URL `https://api.payleor.com/webhooks/paypal`, event types `*` (all). The dev tunnel sends `api.payleor.com` straight to the api Worker (port 3000). So the route path is `/webhooks/paypal` on the api Worker, and the dev env sets `PAYPAL_WEBHOOK_ID=3EJ41953HX9926248`. Nothing changes at PayPal.
2. **Delivery:** PayPal retries any non-2xx up to 25 times over 3 days; answer within 30 seconds. Events from the R1a and R1b deposits got 404s, so their retries reach the new route by themselves.
3. **Verification:** `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from the `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time` headers), `webhook_id` and `webhook_event`. Answer: `{"verification_status": "SUCCESS" | "FAILURE"}`. `webhook_event` must be the body **exactly as received**; re-serializing can fail verification.
4. **Event fields:** `id` (`WH-...`), `event_type`, `resource_type`, `resource`. In capture events (`resource_type: "capture"`), `resource.id` is the capture ID, `resource.custom_id` our payment ID, `resource.supplementary_data.related_ids.order_id` the order ID, `resource.payee.merchant_id` the seller. In order events (`CHECKOUT.ORDER.*`), `resource.id` is the order ID and `resource.purchase_units[0]` has `custom_id` and `payee.merchant_id`.
5. **Events Payleor acts on:** `PAYMENT.CAPTURE.COMPLETED`, `.PENDING`, `.DECLINED`, `.DENIED` (apply the capture); `CHECKOUT.ORDER.APPROVED` (capture if the browser did not); `PAYMENT.CAPTURE.REFUNDED`, `.REVERSED` (park). Everything else is ignored. PayPal does not guarantee order, so the processor re-fetches the order and applies its current state.
6. **Fees:** `GET /v2/checkout/orders/{id}` with the seller's auth assertion returns the capture with `create_time` and `seller_receivable_breakdown` (`gross_amount`, `paypal_fee`, `platform_fees[0].amount`, `net_amount`). Checked on order `3FN75227YT094032E`: gross $120.00, PayPal fee $4.98, platform fee $1.20, net $113.82. The breakdown is missing while a capture is pending.
7. **Queues in Alchemy 2:** `Cloudflare.Queues.Queue(id)` is a resource; bound in a Worker's `env` it becomes a `Queue<unknown>` binding (`InferEnv`). `Cloudflare.Queues.Consumer(id, { queueId, scriptName, settings })` attaches a Worker's `queue()` handler; settings include `batchSize`, `maxRetries`, `maxWaitTimeMs`, `retryDelay`. Alchemy's local runtime wires consumers to local Workers in `alchemy dev` (`LocalRuntime.queueConsumers`). Source: `packages/infra/node_modules/alchemy/src/Cloudflare/Queues/{Queue,Consumer}.ts`.
8. **evlog** serializes an error as `name`, `message`, `stack` and only the keys `code`, `status`, `statusText`, `statusCode`, `statusMessage`, `data`, `cause`, `internal`. `PayPalError.details` is never printed, and `PayPalError.message` is PayPal's top-level message. The R1a carried-forward check is settled; Task 7 adds a test so it stays true.

## Design decisions

- **Fees in the ledger.** The team bears PayPal's fee and Payleor's fee (services spec §5). The capture posting stays as it is (`paypal_clearing` → `client_held` + `team_revenue`, gross). A second transfer, `payment_fees:{paymentId}`, moves `team_revenue → paypal_fees` and `team_revenue → payleor_fees`. Then `client_held + team_revenue` is what is in the team's PayPal, and the fee accounts show where the rest went. `team_revenue` may go negative (already allowed).
- **Fees are recorded separately from the capture**, by `recordCaptureFees`, after `applyCaptureFact` returns `applied` or `already_applied`. It is idempotent (it does nothing once `payment.paypal_fee_minor` is set), so a capture applied without a breakdown gets its fees from the next fact: the webhook's re-fetch. That is also how the two dev deposits captured before R1c get their fees.
- **The event table stores ids, not the payload.** Order resources carry the buyer's name and email; the processor re-fetches from PayPal anyway.
- **`CaptureFactConflict`** replaces the plain `Error`s that mean "money moved in a way Payleor did not ask for" (second capture, completed capture on an abandoned order or a cancelled payment, amount mismatch). The processor parks those; anything else (PayPal 5xx, database) is retried by the Queue.
- **Retries:** the consumer retries a message up to 5 attempts with growing delays, then marks the event `failed`. The Queue's own `maxRetries` is higher (10) so Payleor always records the outcome.

## Files

| File | Change | Responsibility |
|---|---|---|
| `packages/paypal/src/client.ts` | Modify | `rawBody` request option; `webhooks` on the client |
| `packages/paypal/src/orders.ts` (+test) | Modify | Capture `create_time` and fee breakdown |
| `packages/paypal/src/webhooks.ts` (+test) | Create | `verifySignature`, `parseWebhookEvent` |
| `packages/paypal/src/index.ts` | Modify | Export webhooks |
| `packages/core/src/ledger/accounts.ts`, `transfers.ts`, `postings.ts` (+tests) | Modify | `paypal_fees`, `payleor_fees`, `payment_fees` |
| `packages/db/src/schema/paypal-webhooks.ts`, `schema/index.ts`, `schema/projects.ts` | Create / Modify | `paypal_webhook_event`; `payment.paypal_fee_minor` |
| `packages/db/src/migrations/<timestamp>_r1c_paypal_webhooks/` | Create (generated) | Migration |
| `packages/db/src/repositories/paypal-webhooks.ts` (+test) | Create | Record, find, finish, note attempts |
| `packages/db/src/testing/db.ts` | Modify | Truncate the new table |
| `packages/api/src/use-cases/payments.ts`, `routers/payment.test.ts` | Modify | Capture time, fees, `CaptureFactConflict`, `recordCaptureFees` |
| `packages/api/src/use-cases/paypal-webhooks.ts` (+test) | Create | `processPayPalWebhookEvent` |
| `apps/server/.env.schema`, `packages/infra/.env.schema`, `packages/infra/alchemy.run.ts` | Modify | `PAYPAL_WEBHOOK_ID`, the Queue, its consumer |
| `apps/server/src/routes/paypal-webhooks.ts` (+test) | Create | `POST /webhooks/paypal` |
| `apps/server/src/paypal-webhook-queue.ts` (+test) | Create | The `queue()` batch handler |
| `apps/server/src/index.ts` | Modify | Mount the route; export `{ fetch, queue }` |
| `apps/server/src/trpc-error-log.test.ts` | Modify | evlog never prints PayPal detail values |

---

### Task 0: Worktree

- [ ] **Step 1**

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git status --short   # must be empty
git worktree add -b r1c-paypal-webhooks ../r1c-paypal-webhooks main
cp .env.test.local ../r1c-paypal-webhooks/.env.test.local
cd ../r1c-paypal-webhooks && pnpm install
pnpm check-types
```

Expected: types clean. (The controller runs the full suite once at the end; the baseline is 802 at `a46bcf2`.)

---

### Task 1: PayPal webhooks and the capture breakdown

**Files:** Modify `packages/paypal/src/client.ts`, `orders.ts`, `orders.test.ts`, `index.ts`; Create `packages/paypal/src/webhooks.ts`, `webhooks.test.ts`.

- [ ] **Step 1: Failing tests for the capture fields** — in `orders.test.ts`, add to the `captureFromOrder` describe:

```ts
  it("reads the capture time and the fee breakdown", () => {
    const order: PayPalOrder = {
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: "CAPTURE1",
                status: "COMPLETED",
                amount: { currency_code: "USD", value: "120.00" },
                create_time: "2026-10-08T00:28:21Z",
                seller_receivable_breakdown: {
                  gross_amount: { currency_code: "USD", value: "120.00" },
                  paypal_fee: { currency_code: "USD", value: "4.98" },
                  platform_fees: [{ amount: { currency_code: "USD", value: "1.20" }, payee: { merchant_id: "PAYLEOR" } }],
                  net_amount: { currency_code: "USD", value: "113.82" },
                },
              },
            ],
          },
        },
      ],
    };
    expect(captureFromOrder(order)).toMatchObject({
      id: "CAPTURE1",
      create_time: "2026-10-08T00:28:21Z",
      seller_receivable_breakdown: {
        paypal_fee: { currency_code: "USD", value: "4.98" },
        platform_fees: [{ amount: { currency_code: "USD", value: "1.20" } }],
      },
    });
  });

  it("drops a malformed breakdown instead of trusting it", () => {
    const order = {
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [
        { payments: { captures: [{ id: "C", status: "COMPLETED", seller_receivable_breakdown: { paypal_fee: { value: 4.98 } } }] } },
      ],
    } as unknown as PayPalOrder;
    expect(captureFromOrder(order)?.seller_receivable_breakdown).toEqual({ paypal_fee: undefined, platform_fees: [] });
  });
```

(The `as unknown as` is test input that deliberately breaks the type, as the existing "drops an amount whose fields are not strings" test does; follow that test's style if it differs.)

- [ ] **Step 2: Failing tests for webhooks** — `packages/paypal/src/webhooks.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createPayPalClient, parseWebhookEvent } from "./index";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

function clientWith(status: "SUCCESS" | "FAILURE") {
  const { requests, fetch } = fakeFetch((request) =>
    request.url.endsWith("/v1/oauth2/token")
      ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
      : jsonResponse(200, { verification_status: status }),
  );
  const client = createPayPalClient({
    clientId: "partner-client-id",
    clientSecret: "partner-secret",
    environment: "sandbox",
    fetch,
    sleep: () => Promise.resolve(),
  });
  return { client, requests };
}

const HEADERS = {
  authAlgo: "SHA256withRSA",
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  transmissionId: "tx-1",
  transmissionSig: "sig==",
  transmissionTime: "2026-10-08T00:28:22Z",
};

describe("webhooks.verifySignature", () => {
  it("posts the event body back exactly as received", async () => {
    const { client, requests } = clientWith("SUCCESS");
    // Key order and spacing that JSON.stringify would not reproduce.
    const rawBody = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"b":1,"a":2}}';

    expect(await client.webhooks.verifySignature({ webhookId: "WEBHOOK1", headers: HEADERS, rawBody })).toBe(true);

    const call = recordedAt(requests, 1);
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    expect(call.body).toBe(
      '{"auth_algo":"SHA256withRSA","cert_url":"https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1","transmission_id":"tx-1","transmission_sig":"sig==","transmission_time":"2026-10-08T00:28:22Z","webhook_id":"WEBHOOK1","webhook_event":' +
        rawBody +
        "}",
    );
  });

  it("reports a failed verification", async () => {
    const { client } = clientWith("FAILURE");
    expect(await client.webhooks.verifySignature({ webhookId: "WEBHOOK1", headers: HEADERS, rawBody: "{}" })).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  it("reads the ids of a capture event", () => {
    expect(
      parseWebhookEvent({
        id: "WH-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource_type: "capture",
        resource: {
          id: "CAPTURE1",
          custom_id: "pay-1",
          payee: { merchant_id: "SELLER1" },
          supplementary_data: { related_ids: { order_id: "ORDER1" } },
        },
      }),
    ).toEqual({
      id: "WH-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceType: "capture",
      resourceId: "CAPTURE1",
      customId: "pay-1",
      orderId: "ORDER1",
      merchantId: "SELLER1",
    });
  });

  it("reads the ids of an order event", () => {
    expect(
      parseWebhookEvent({
        id: "WH-2",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource_type: "checkout-order",
        resource: { id: "ORDER1", purchase_units: [{ custom_id: "pay-1", payee: { merchant_id: "SELLER1" } }] },
      }),
    ).toEqual({
      id: "WH-2",
      eventType: "CHECKOUT.ORDER.APPROVED",
      resourceType: "checkout-order",
      resourceId: "ORDER1",
      customId: "pay-1",
      orderId: "ORDER1",
      merchantId: "SELLER1",
    });
  });

  it("keeps unknown events with what it can read, and rejects bodies without an id or type", () => {
    expect(parseWebhookEvent({ id: "WH-3", event_type: "MERCHANT.ONBOARDING.COMPLETED", resource: {} })).toEqual({
      id: "WH-3",
      eventType: "MERCHANT.ONBOARDING.COMPLETED",
      resourceType: null,
      resourceId: null,
      customId: null,
      orderId: null,
      merchantId: null,
    });
    expect(parseWebhookEvent({ event_type: "X" })).toBeNull();
    expect(parseWebhookEvent("nope")).toBeNull();
  });
});
```

- [ ] **Step 3: Run them**

Run: `pnpm test packages/paypal`
Expected: FAIL (missing fields, `client.webhooks`, `parseWebhookEvent`).

- [ ] **Step 4: Capture fields** — in `orders.ts`, extend the types:

```ts
export type PayPalCaptureBreakdown = { paypal_fee?: PayPalMoney; platform_fees: { amount: PayPalMoney }[] };
export type PayPalCapture = {
  id: string;
  status: string;
  amount?: PayPalMoney;
  custom_id?: string;
  create_time?: string;
  // Missing while a capture is pending (R1 facts §2).
  seller_receivable_breakdown?: PayPalCaptureBreakdown;
};
```

In `parseCapture`, factor the existing amount check into `function parseMoney(value: unknown): PayPalMoney | undefined` and add to the returned object:

```ts
    create_time: typeof record.create_time === "string" ? record.create_time : undefined,
    seller_receivable_breakdown: parseBreakdown(record.seller_receivable_breakdown),
```

with

```ts
function parseBreakdown(value: unknown): PayPalCaptureBreakdown | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const fees = Array.isArray(record.platform_fees) ? record.platform_fees : [];
  return {
    paypal_fee: parseMoney(record.paypal_fee),
    platform_fees: fees.flatMap((fee) => {
      const amount = typeof fee === "object" && fee !== null ? parseMoney((fee as Record<string, unknown>).amount) : undefined;
      return amount ? [{ amount }] : [];
    }),
  };
}
```

Keep the existing `as Record<string, unknown>` narrowing style of this file.

- [ ] **Step 5: Raw request bodies** — in `client.ts`, add to `PayPalRequestOptions`:

```ts
  // Sent as is instead of JSON.stringify(body): webhook verification must echo PayPal's bytes (R1 facts §4).
  rawBody?: string;
```

In `request`, set the content type when either is present, and send `options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))`.

- [ ] **Step 6: The webhooks module** — `packages/paypal/src/webhooks.ts`:

```ts
import type { PayPalRequest } from "./client";

export type WebhookTransmission = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

// The ids Payleor keeps from a verified event. The payload itself is not stored: order resources carry the
// buyer's name and email, and the processor re-fetches the resource from PayPal anyway.
export type ParsedWebhookEvent = {
  id: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  customId: string | null;
  orderId: string | null;
  merchantId: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// R1 facts §4: capture resources carry custom_id, payee and the order id in supplementary_data; order
// resources carry them on their first purchase unit.
export function parseWebhookEvent(body: unknown): ParsedWebhookEvent | null {
  const event = record(body);
  const id = text(event?.id);
  const eventType = text(event?.event_type);
  if (!event || !id || !eventType) return null;
  const resource = record(event.resource);
  const isOrder = eventType.startsWith("CHECKOUT.ORDER.");
  const unit = isOrder && Array.isArray(resource?.purchase_units) ? record(resource.purchase_units[0]) : resource;
  const relatedIds = record(record(resource?.supplementary_data)?.related_ids);
  return {
    id,
    eventType,
    resourceType: text(event.resource_type),
    resourceId: text(resource?.id),
    customId: text(unit?.custom_id),
    orderId: isOrder ? text(resource?.id) : text(relatedIds?.order_id),
    merchantId: text(record(unit?.payee)?.merchant_id),
  };
}

export function createWebhooks(request: PayPalRequest) {
  return {
    // The postback check (R1 facts §4). webhook_event is spliced in as received: re-serializing it can
    // change its bytes and fail verification.
    async verifySignature(input: { webhookId: string; headers: WebhookTransmission; rawBody: string }): Promise<boolean> {
      const fields = JSON.stringify({
        auth_algo: input.headers.authAlgo,
        cert_url: input.headers.certUrl,
        transmission_id: input.headers.transmissionId,
        transmission_sig: input.headers.transmissionSig,
        transmission_time: input.headers.transmissionTime,
        webhook_id: input.webhookId,
      });
      const response = await request<{ verification_status?: string }>({
        method: "POST",
        path: "/v1/notifications/verify-webhook-signature",
        requestId: `verify:${input.headers.transmissionId}`,
        rawBody: `${fields.slice(0, -1)},"webhook_event":${input.rawBody}}`,
      });
      return response.verification_status === "SUCCESS";
    },
  };
}
```

Add `webhooks: ReturnType<typeof createWebhooks>;` to `PayPalClient`, `webhooks: createWebhooks(request)` to the returned client, and `export * from "./webhooks";` to `index.ts`.

- [ ] **Step 7: Run tests and types**

```bash
pnpm test packages/paypal
pnpm -F @jendal-workspace/paypal check-types && pnpm -F @jendal-workspace/api check-types
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/paypal
git commit -m "feat(paypal): verify webhooks and read the capture's fees and time" -m "verifySignature posts PayPal's event body back unchanged; parseWebhookEvent keeps only the ids Payleor needs. Captures now carry create_time and the seller receivable breakdown." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 2: Fee accounts and the fee transfer

**Files:** Modify `packages/core/src/ledger/accounts.ts`, `accounts.test.ts`, `transfers.ts`, `postings.ts`, `postings.test.ts` (and `packages/core/src/index.ts` if postings are exported one by one).

- [ ] **Step 1: Failing tests** — in `accounts.test.ts`, extend the first test with:

```ts
    expect([ledgerAccounts.paypalFees, ledgerAccounts.payleorFees]).toEqual(["paypal_fees", "payleor_fees"]);
```

and the `it.each` table with `["paypal_fees", "paypal_fees"]` and `["payleor_fees", "payleor_fees"]`. In `postings.test.ts` add:

```ts
describe("paymentFeesTransfer", () => {
  it("charges PayPal's fee and Payleor's fee to the team's revenue", () => {
    expect(
      paymentFeesTransfer({ currency: "USD", projectId: "p1", paymentId: "pay1", paypalFeeMinor: 498, platformFeeMinor: 120 }),
    ).toEqual({
      kind: "payment_fees",
      reference: "payment_fees:pay1",
      projectId: "p1",
      entries: [
        { account: "team_revenue", currency: "USD", amountMinor: -618 },
        { account: "paypal_fees", currency: "USD", amountMinor: 498 },
        { account: "payleor_fees", currency: "USD", amountMinor: 120 },
      ],
    });
  });

  it("leaves out a fee of zero, and returns null when there is no fee at all", () => {
    expect(
      paymentFeesTransfer({ currency: "USD", projectId: "p1", paymentId: "pay1", paypalFeeMinor: 498, platformFeeMinor: 0 })?.entries,
    ).toEqual([
      { account: "team_revenue", currency: "USD", amountMinor: -498 },
      { account: "paypal_fees", currency: "USD", amountMinor: 498 },
    ]);
    expect(paymentFeesTransfer({ currency: "USD", projectId: "p1", paymentId: "pay1", paypalFeeMinor: 0, platformFeeMinor: 0 })).toBeNull();
  });
});
```

(Import `paymentFeesTransfer` where the file imports the other builders. If `transferFromMoves` orders entries differently, assert with `expect.arrayContaining` and a length check instead, and say so in the report.)

- [ ] **Step 2: Run them** — `pnpm test packages/core/src/ledger` — Expected: FAIL.

- [ ] **Step 3: Implement**
  - `accounts.ts`: add `"paypal_fees" | "payleor_fees"` to `LedgerAccountKey` and `LedgerAccountKind`; `paypalFees: "paypal_fees"` and `payleorFees: "payleor_fees"` to `ledgerAccounts`; recognise both in `ledgerAccountKind` next to `team_revenue`. They are not in `NON_NEGATIVE` (they only grow; a later fee refund would reduce them).
  - `transfers.ts`: add `"payment_fees"` to `LEDGER_TRANSFER_KINDS` after `"payment_captured"`. (The `ledger_transfer.kind` column is a text enum in Drizzle only; no migration.)
  - `postings.ts`:

```ts
// The team bears PayPal's fee and Payleor's platform fee (services spec §5); both leave the team's PayPal
// balance at capture. Null when PayPal charged nothing.
export function paymentFeesTransfer(
  input: ProjectPosting & { paymentId: string; paypalFeeMinor: number; platformFeeMinor: number },
): LedgerTransferDraft | null {
  const moves = [
    { from: a.teamRevenue, to: a.paypalFees, amountMinor: input.paypalFeeMinor },
    { from: a.teamRevenue, to: a.payleorFees, amountMinor: input.platformFeeMinor },
  ].filter((move) => move.amountMinor > 0);
  if (moves.length === 0) return null;
  return transferFromMoves({
    kind: "payment_fees",
    reference: `payment_fees:${input.paymentId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves,
  });
}
```

  Export it the way the other builders are exported from `packages/core/src/index.ts`.

- [ ] **Step 4: Run** — `pnpm test packages/core && pnpm -F @jendal-workspace/core check-types && pnpm -F @jendal-workspace/db check-types` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): post PayPal's and Payleor's fees against the team's revenue" -m "Two ledger accounts, paypal_fees and payleor_fees, and a payment_fees transfer from team_revenue, so client_held plus team_revenue matches what the team's PayPal received." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 3: The webhook event table and the payment's PayPal fee

**Files:** Create `packages/db/src/schema/paypal-webhooks.ts`, `packages/db/src/repositories/paypal-webhooks.ts`, `paypal-webhooks.test.ts`; Modify `schema/index.ts`, `schema/projects.ts`, `testing/db.ts`; migration (generated).

- [ ] **Step 1: Schema** — `packages/db/src/schema/paypal-webhooks.ts`:

```ts
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const PAYPAL_WEBHOOK_EVENT_STATUSES = ["received", "processed", "ignored", "parked", "failed"] as const;
export type PayPalWebhookEventStatus = (typeof PAYPAL_WEBHOOK_EVENT_STATUSES)[number];

// Services spec §6.4: verified PayPal events, one row per event id, so a redelivery is dropped. Only ids are
// kept; the processor re-fetches the resource from PayPal. "parked" needs a person; "failed" ran out of retries.
export const paypalWebhookEvent = pgTable(
  "paypal_webhook_event",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    customId: text("custom_id"),
    orderId: text("order_id"),
    merchantId: text("merchant_id"),
    status: text("status", { enum: PAYPAL_WEBHOOK_EVENT_STATUSES }).notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    note: text("note"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [index("paypal_webhook_event_status_idx").on(t.status, t.receivedAt)],
);
```

Add `export * from "./paypal-webhooks";` to `schema/index.ts`. In `schema/projects.ts`, in `payment`, after `platformFeeMinor` add:

```ts
    // PayPal's fee on the capture, from its seller receivable breakdown; null until a fact carried it (R1c).
    paypalFeeMinor: minor("paypal_fee_minor"),
```

update the `platformFeeMinor` comment to "Payleor's fee: set at order creation at the plan's rate, then replaced by the fee PayPal charged once known", and add the check `check("payment_paypal_fee_check", sql\`paypal_fee_minor is null or (paypal_fee_minor >= 0 and paypal_fee_minor <= amount_minor)\`)`. In `testing/db.ts`, add `"paypal_webhook_event", ` after `"outbox", ` in the truncate list.

- [ ] **Step 2: Migration**

```bash
DATABASE_URL="$(sed -n 's/^TEST_DATABASE_URL=//p' .env.test.local)" pnpm -F @jendal-workspace/db db:generate --name r1c_paypal_webhooks
```

Expected SQL: create `paypal_webhook_event` with its index; add `paypal_fee_minor` and `payment_paypal_fee_check` to `payment`. Nothing else; read it, stop and report if it differs.

- [ ] **Step 3: Failing repository test** — `packages/db/src/repositories/paypal-webhooks.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, hasTestDatabase, truncateAll } from "../testing/db";
import { findWebhookEvent, finishWebhookEvent, noteWebhookAttempt, recordWebhookEvent } from "./paypal-webhooks";

const EVENT = {
  id: "WH-1",
  eventType: "PAYMENT.CAPTURE.COMPLETED",
  resourceType: "capture",
  resourceId: "CAPTURE1",
  customId: "pay-1",
  orderId: "ORDER1",
  merchantId: "SELLER1",
};

describe.skipIf(!hasTestDatabase)("paypal webhook events", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("records an event once and reports the stored status on redelivery", async () => {
    expect(await recordWebhookEvent(db, EVENT)).toBe("received");
    await finishWebhookEvent(db, "WH-1", { status: "processed", note: "applied" });
    expect(await recordWebhookEvent(db, { ...EVENT, eventType: "CHANGED" })).toBe("processed");
    expect(await findWebhookEvent(db, "WH-1")).toMatchObject({
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      status: "processed",
      note: "applied",
      processedAt: expect.any(Date),
    });
  });

  it("counts attempts and keeps the last error", async () => {
    await recordWebhookEvent(db, EVENT);
    expect(await noteWebhookAttempt(db, "WH-1", "PayPal 503")).toBe(1);
    expect(await noteWebhookAttempt(db, "WH-1", "PayPal 503 again")).toBe(2);
    expect(await findWebhookEvent(db, "WH-1")).toMatchObject({ status: "received", attempts: 2, note: "PayPal 503 again" });
    expect(await findWebhookEvent(db, "WH-404")).toBeNull();
  });
});
```

- [ ] **Step 4: Run it** — `pnpm test packages/db/src/repositories/paypal-webhooks.test.ts` — Expected: FAIL.

- [ ] **Step 5: Implement** — `packages/db/src/repositories/paypal-webhooks.ts`:

```ts
import { eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { type PayPalWebhookEventStatus, paypalWebhookEvent } from "../schema/paypal-webhooks";

export type PayPalWebhookEventInput = {
  id: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  customId: string | null;
  orderId: string | null;
  merchantId: string | null;
};

export type PayPalWebhookEventRow = typeof paypalWebhookEvent.$inferSelect;

// PayPal redelivers until it gets a 2xx; the event id makes every redelivery a no-op. Returns the stored status,
// so the caller enqueues only events still waiting.
export async function recordWebhookEvent(db: DbExecutor, input: PayPalWebhookEventInput): Promise<PayPalWebhookEventStatus> {
  const [inserted] = await db
    .insert(paypalWebhookEvent)
    .values(input)
    .onConflictDoNothing({ target: paypalWebhookEvent.id })
    .returning({ status: paypalWebhookEvent.status });
  if (inserted) return inserted.status;
  const existing = await findWebhookEvent(db, input.id);
  if (!existing) throw new Error(`PayPal webhook event ${input.id} vanished after a conflicting insert`);
  return existing.status;
}

export async function findWebhookEvent(db: DbExecutor, id: string): Promise<PayPalWebhookEventRow | null> {
  const [row] = await db.select().from(paypalWebhookEvent).where(eq(paypalWebhookEvent.id, id)).limit(1);
  return row ?? null;
}

export async function finishWebhookEvent(
  db: DbExecutor,
  id: string,
  outcome: { status: Exclude<PayPalWebhookEventStatus, "received">; note?: string },
): Promise<void> {
  await db
    .update(paypalWebhookEvent)
    .set({ status: outcome.status, note: outcome.note ?? null, processedAt: new Date() })
    .where(eq(paypalWebhookEvent.id, id));
}

// Returns the attempt count after this one.
export async function noteWebhookAttempt(db: DbExecutor, id: string, error: string): Promise<number> {
  const [row] = await db
    .update(paypalWebhookEvent)
    .set({ attempts: sql`${paypalWebhookEvent.attempts} + 1`, note: error.slice(0, 500) })
    .where(eq(paypalWebhookEvent.id, id))
    .returning({ attempts: paypalWebhookEvent.attempts });
  return row?.attempts ?? 0;
}
```

- [ ] **Step 6: Run** — `pnpm test packages/db && pnpm -F @jendal-workspace/db check-types` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): store PayPal webhook events once and the payment's PayPal fee" -m "paypal_webhook_event keeps the ids of each verified event and its processing status; payment.paypal_fee_minor holds PayPal's fee from the capture breakdown." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 4: Capture time, fees and conflicts in the payment module

**Files:** Modify `packages/api/src/use-cases/payments.ts`, `packages/api/src/routers/payment.test.ts`.

- [ ] **Step 1: Failing tests** — in `payment.test.ts`:

  1. Extend the `fact()` helper's defaults with `capturedAt: null, paypalFeeMinor: null, platformFeeMinor: null`.
  2. In "applies a completed deposit capture once…", pass `capturedAt: new Date("2026-10-08T00:00:00Z")` to the first `applyCaptureFact` and replace the `before`-based deadline assertion with `expect(project?.deadlineAt?.toISOString()).toBe("2026-10-22T00:00:00.000Z")` (14 days after the capture) and `expect((await paymentRow(paymentId))?.capturedAt?.toISOString()).toBe("2026-10-08T00:00:00.000Z")`.
  3. Add to `describe("applyCaptureFact")`:

```ts
    it("records the fees once, with the capture or from a later fact", async () => {
      const { projectId, paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId))).toBe("applied");
      expect(await paymentRow(paymentId)).toMatchObject({ paypalFeeMinor: null });

      const withFees = fact(paymentId, { paypalFeeMinor: 2_370, platformFeeMinor: 600 });
      expect(await applyCaptureFact(db, withFees)).toBe("already_applied");
      expect(await applyCaptureFact(db, withFees)).toBe("already_applied");

      expect(await paymentRow(paymentId)).toMatchObject({ paypalFeeMinor: 2_370, platformFeeMinor: 600 });
      const fees = await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "payment_fees"));
      expect(fees).toHaveLength(1);
      expect(fees[0]?.projectId).toBe(projectId);
      expect(await db.select().from(ledgerBalance)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: ledgerAccounts.teamRevenue, balanceMinor: 10_000 - 2_970 }),
          expect.objectContaining({ account: ledgerAccounts.paypalFees, balanceMinor: 2_370 }),
          expect.objectContaining({ account: ledgerAccounts.payleorFees, balanceMinor: 600 }),
        ]),
      );
    });

    it("reports money PayPal moved without Payleor asking as a conflict", async () => {
      const { paymentId } = await depositWithOrder();
      await expect(applyCaptureFact(db, fact(paymentId, { amountMinor: 1 }))).rejects.toBeInstanceOf(CaptureFactConflict);
      await applyCaptureFact(db, fact(paymentId));
      await expect(applyCaptureFact(db, fact(paymentId, { captureId: "CAPTURE2" }))).rejects.toBeInstanceOf(CaptureFactConflict);
    });
```

  Import `CaptureFactConflict` from `../use-cases/payments`. If the existing tests "refuses a capture whose amount or currency differs" and "refuses a second capture for the same payment" assert on `Error` messages, keep them; `CaptureFactConflict` extends `Error` and keeps the messages.

  4. In the router test "captures the deposit, starts the work…", make the fake capture response carry `create_time: "2026-10-08T00:00:00Z"` and a breakdown (`paypal_fee` "23.70", `platform_fees` [{ amount "6.00" }]) by extending `capturedOrder` with an optional `extra` argument, and assert `paypalFeeMinor: 2_370, platformFeeMinor: 600` on the payment row after `payCapture`.

- [ ] **Step 2: Run** — `pnpm test packages/api/src/routers/payment.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** in `payments.ts`:
  - `CaptureFact` gains:

```ts
  // PayPal's capture time (create_time); the deadline runs from it. Null when PayPal sent none.
  capturedAt: Date | null;
  // From the seller receivable breakdown, in the payment's currency; null while PayPal has not reported them.
  paypalFeeMinor: number | null;
  platformFeeMinor: number | null;
```

  - Add and export:

```ts
// Money moved in a way Payleor did not ask for (a second capture, a capture on an abandoned order or a
// cancelled payment, a wrong amount). A person has to look; retrying cannot fix it.
export class CaptureFactConflict extends Error {
  override name = "CaptureFactConflict";
}
```

  and throw it instead of `new Error(...)` in `checkCaptureBelongs` (both), the cancelled-payment completed capture and the amount mismatch in `applyInTransaction`. Leave the other `Error`s (unknown payment, missing project, unsupported kind) as they are.
  - `projectChangeOnCapture` takes `capturedAt: Date` and computes `deadlineAt: new Date(capturedAt.getTime() + quote.deliveryDays * DAY_MS)`. In `applyInTransaction`, `const capturedAt = fact.capturedAt ?? new Date();` and use it for both `payment.capturedAt` and the project change.
  - Add:

```ts
// Records PayPal's fee and Payleor's fee for a captured payment, once: the first fact that carries the
// breakdown wins, whether it is the capture itself or a later webhook re-fetch.
async function recordCaptureFees(db: Database, fact: CaptureFact): Promise<void> {
  const { paypalFeeMinor } = fact;
  if (fact.status !== "COMPLETED" || paypalFeeMinor === null) return;
  await db.transaction(async (tx) => {
    const row = await lockPayment(tx, fact.paymentId);
    if (row.status !== "captured" || row.paypalCaptureId !== fact.captureId || row.paypalFeeMinor !== null) return;
    const platformFeeMinor = fact.platformFeeMinor ?? 0;
    await tx
      .update(payment)
      .set({ paypalFeeMinor, platformFeeMinor, version: row.version + 1 })
      .where(eq(payment.id, row.id));
    const transfer = paymentFeesTransfer({
      currency: row.currency,
      projectId: row.projectId,
      paymentId: row.id,
      paypalFeeMinor,
      platformFeeMinor,
    });
    if (transfer) await createPostgresLedger(row.teamId, tx).post([transfer]);
  });
}
```

  (`createPostgresLedger` from `@jendal-workspace/db/repositories/ledger`; `paymentFeesTransfer` from core. If `db.transaction`'s `tx` type does not match `lockPayment`'s `Transaction`, use the same transaction helper the file already uses elsewhere; do not cast.)
  - In `applyCaptureFact`, after a result of `"applied"` or `"already_applied"`, call `await recordCaptureFees(db, fact)` before returning the result. Restructure the loop so both return paths go through it.
  - Replace the local `captureFact` builder with an exported one that also reads the new fields:

```ts
function minorIn(currency: string | null, money: PayPalMoney | undefined): number | null {
  return money && money.currency_code === currency ? parseMajorAmount(money.value) : null;
}

export function captureFact(paymentId: string, orderId: string, capture: PayPalCapture): CaptureFact {
  const currency = capture.amount?.currency_code ?? null;
  const breakdown = capture.seller_receivable_breakdown;
  const capturedAt = capture.create_time ? new Date(capture.create_time) : null;
  return {
    paymentId,
    orderId,
    captureId: capture.id,
    status: capture.status,
    amountMinor: capture.amount ? parseMajorAmount(capture.amount.value) : null,
    currency,
    capturedAt: capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt : null,
    // A fee in another currency (a converted receivable) is not posted; the reconciliation job will show it.
    paypalFeeMinor: breakdown ? minorIn(currency, breakdown.paypal_fee) : null,
    platformFeeMinor: breakdown ? (minorIn(currency, breakdown.platform_fees[0]?.amount) ?? 0) : null,
  };
}
```

  (Import `PayPalMoney` as a type from `@jendal-workspace/paypal`.)

- [ ] **Step 4: Run** — `pnpm test packages/api packages/core && pnpm -F @jendal-workspace/api check-types` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api
git commit -m "feat(api): record capture fees and time, and flag captures Payleor did not ask for" -m "The deadline runs from PayPal's capture time. PayPal's fee and Payleor's fee are recorded once, from the first fact that carries the breakdown, and posted against the team's revenue. Captures that cannot be applied raise CaptureFactConflict." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 5: Processing a webhook event

**Files:** Create `packages/api/src/use-cases/paypal-webhooks.ts`, `paypal-webhooks.test.ts`.

- [ ] **Step 1: Failing tests** — `packages/api/src/use-cases/paypal-webhooks.test.ts`. Copy from `routers/payment.test.ts` the setup it needs (`callerFor`, `pendingDeposit`/`connectedDeposit`, `makePayPal`, a fake PayPal API). The fake API answers `GET /v2/checkout/orders/ORDER1` with a configurable order and `POST .../ORDER1/capture` with a completed capture. Tests:

```ts
  function storedEvent(overrides: Partial<PayPalWebhookEventRow> = {}): PayPalWebhookEventRow {
    return {
      id: "WH-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceType: "capture",
      resourceId: "CAPTURE1",
      customId: null,
      orderId: "ORDER1",
      merchantId: "SELLER1",
      status: "received",
      attempts: 0,
      note: null,
      receivedAt: new Date(),
      processedAt: null,
      ...overrides,
    };
  }
```

  1. **A completed capture the browser never reported is applied, with its fees:** a connected deposit, `payStart` (ORDER1), the lookup returns a `COMPLETED` capture with `create_time` and a breakdown. `processPayPalWebhookEvent(deps, storedEvent({ customId: paymentId }))` returns `{ status: "processed", note: "applied" }`; the payment is captured with its fees; the project is in progress.
  2. **A redelivered or late event changes nothing:** the same call again returns `{ status: "processed", note: "already_applied" }`, with one `payment_captured` and one `payment_fees` transfer.
  3. **An approved order the browser did not capture is captured:** `storedEvent({ eventType: "CHECKOUT.ORDER.APPROVED", resourceType: "checkout-order", resourceId: "ORDER1", customId: paymentId })` returns `{ status: "processed", note: "captured" }`, and exactly one capture call reached the fake PayPal. Running it again after capture returns `{ status: "processed", note: "nothing to do" }` without calling capture.
  4. **Events about other payments are ignored:** no `customId` → `{ status: "ignored", note: "not a Payleor payment" }`; a `customId` that is not a payment id → the same; `MERCHANT.ONBOARDING.COMPLETED` → `{ status: "ignored", note: "event type not handled" }`.
  5. **Refunds and reversals are parked:** `PAYMENT.CAPTURE.REFUNDED` with a known `customId` → `{ status: "parked", note: "refunds and reversals need a person (run 4)" }`.
  6. **A conflict is parked:** the lookup returns a completed capture of `"1.00"` → `{ status: "parked" }` with a note containing "does not match".
  7. **A seller mismatch is parked:** `merchantId: "SOMEONE_ELSE"` → `{ status: "parked", note: "merchant does not match the team" }`, without calling PayPal.
  8. **A PayPal outage is retried:** the lookup answers 503 → the call rejects (a `PayPalError`), so the queue retries it. A 404 on the lookup → `{ status: "parked" }`.

- [ ] **Step 2: Run** — `pnpm test packages/api/src/use-cases/paypal-webhooks.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `packages/api/src/use-cases/paypal-webhooks.ts`:

```ts
import type { PayPalWebhookEventRow } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import { payment } from "@jendal-workspace/db/schema/projects";
import { captureFromOrder, PayPalError } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { applyCaptureFact, CaptureFactConflict, captureFact, capturePayment, type PaymentDeps } from "./payments";

export type WebhookOutcome = { status: "processed" | "ignored" | "parked"; note: string };

const CAPTURE_EVENTS = new Set([
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.DENIED",
]);
const PARKED_EVENTS = new Set(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findPayment(deps: PaymentDeps, event: PayPalWebhookEventRow) {
  const byCustomId = event.customId && UUID.test(event.customId) ? eq(payment.id, event.customId) : null;
  const byOrder = event.orderId ? eq(payment.paypalOrderId, event.orderId) : null;
  const where = byCustomId ?? byOrder;
  if (!where) return null;
  const [row] = await deps.db.select().from(payment).where(where).limit(1);
  return row ?? null;
}

// Services spec §6.4: PayPal does not guarantee order, so the event only says which payment to look at; the
// order is re-fetched and its current capture applied through the same idempotent step as the pay page.
export async function processPayPalWebhookEvent(deps: PaymentDeps, event: PayPalWebhookEventRow): Promise<WebhookOutcome> {
  const isCapture = CAPTURE_EVENTS.has(event.eventType);
  const isApproval = event.eventType === "CHECKOUT.ORDER.APPROVED";
  if (!isCapture && !isApproval && !PARKED_EVENTS.has(event.eventType)) {
    return { status: "ignored", note: "event type not handled" };
  }
  const row = await findPayment(deps, event);
  if (!row) return { status: "ignored", note: "not a Payleor payment" };
  if (PARKED_EVENTS.has(event.eventType)) return { status: "parked", note: "refunds and reversals need a person (run 4)" };

  const team = await findTeamById(deps.db, row.teamId);
  const merchantId = team?.paypalMerchantId;
  if (!merchantId || (event.merchantId && event.merchantId !== merchantId)) {
    return { status: "parked", note: "merchant does not match the team" };
  }
  const orderId = event.orderId ?? row.paypalOrderId;
  if (!orderId) return { status: "parked", note: "no order id" };

  try {
    if (isApproval) {
      if (row.status !== "pending" || row.paypalCaptureId || row.paypalOrderId !== orderId) {
        return { status: "processed", note: "nothing to do" };
      }
      try {
        const { outcome } = await capturePayment(deps, { paymentId: row.id, orderId });
        return { status: "processed", note: outcome };
      } catch (error) {
        // The pay page reports these to the client (declined, restarted); nothing is left for the webhook.
        if (error instanceof TRPCError && error.code !== "INTERNAL_SERVER_ERROR") {
          return { status: "processed", note: error.message };
        }
        throw error;
      }
    }
    const order = await deps.paypal.client.orders.get({ orderId, merchantId });
    const capture = captureFromOrder(order);
    if (!capture) return { status: "ignored", note: "the order has no capture yet" };
    if (capture.status === "REFUNDED" || capture.status === "PARTIALLY_REFUNDED") {
      return { status: "parked", note: "refunds and reversals need a person (run 4)" };
    }
    const result = await applyCaptureFact(deps.db, captureFact(row.id, orderId, capture));
    return { status: "processed", note: result };
  } catch (error) {
    if (error instanceof CaptureFactConflict) return { status: "parked", note: error.message };
    // 4xx from PayPal will not change on retry (gone, forbidden); 429 and 5xx are retried by the queue.
    if (error instanceof PayPalError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      return { status: "parked", note: `PayPal ${error.status} ${error.name} (debug_id ${error.debugId ?? "none"})` };
    }
    throw error;
  }
}
```

  If `capturePayment`'s refusal for an already-captured payment is a plain return, the "nothing to do" guard above already covers it. Check `findTeamById`'s import path in `payments.ts` and reuse it.

- [ ] **Step 4: Run** — `pnpm test packages/api && pnpm -F @jendal-workspace/api check-types` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api
git commit -m "feat(api): process PayPal webhook events by re-fetching the order" -m "Capture events apply the order's current capture; an approved order the browser did not capture is captured; refunds, reversals, conflicts and PayPal 4xx answers are parked; other events are ignored." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 6: The webhook route, the Queue and its consumer

**Files:** Create `apps/server/src/routes/paypal-webhooks.ts` (+test), `apps/server/src/paypal-webhook-queue.ts` (+test); Modify `apps/server/src/index.ts`, `apps/server/.env.schema`, `packages/infra/.env.schema`, `packages/infra/alchemy.run.ts`.

- [ ] **Step 1: Config and infra**
  - `apps/server/.env.schema`, after `PAYPAL_ATTRIBUTION_ID`:

```
# The id of the webhook registered on the partner app for this deployment's URL (R1c). Optional: without it
# POST /webhooks/paypal answers 503 and PayPal keeps retrying.
# @required=false @type=string
PAYPAL_WEBHOOK_ID=
```

  - `packages/infra/.env.schema`: add `PAYPAL_WEBHOOK_ID` to the `pick=[...]` list after `PAYPAL_ATTRIBUTION_ID`.
  - `packages/infra/alchemy.run.ts`: declare `export const PayPalWebhookQueue = Cloudflare.Queues.Queue("PayPalWebhooks");` next to `StoreCache`; add to the server's `env`: `PAYPAL_WEBHOOK_ID: Config.String("PAYPAL_WEBHOOK_ID").pipe(Config.withDefault("")),` and `PAYPAL_WEBHOOKS: PayPalWebhookQueue,`. In the stack's `Effect.gen`, after `const serverWorker = yield* server;`:

```ts
    const webhookQueue = yield* PayPalWebhookQueue;
    // One consumer: the api Worker's queue() handler. maxRetries is above the handler's own limit (5), so the
    // handler always records the final outcome itself.
    yield* Cloudflare.Queues.Consumer("PayPalWebhooksConsumer", {
      queueId: webhookQueue.queueId,
      scriptName: serverWorker.workerName,
      settings: { batchSize: 10, maxRetries: 10, maxWaitTimeMs: 1000, retryDelay: 30 },
    });
```

  Check the exact output names (`queueId`, `workerName`) in `packages/infra/node_modules/alchemy/src/Cloudflare/Queues/Queue.ts` and the Worker resource; if `yield* PayPalWebhookQueue` and the `env` reference resolve to two different queues, follow how Alchemy's docs in `Queue.ts` bind a queue resource (the same pattern as `StoreCache`) and report what you did.
  - Run `pnpm env:generate` at the repo root and `pnpm -F server check-types` (the `ENV` type comes from `InferEnv`; `PAYPAL_WEBHOOKS` should be a `Queue<unknown>`).

- [ ] **Step 2: Failing route test** — `apps/server/src/routes/paypal-webhooks.test.ts`. Build the route with injected dependencies and a fake PayPal (`verify-webhook-signature` answers SUCCESS or FAILURE) following `paypal-onboarding.test.ts`. Cases:
  1. Valid signature, new event → 200; `record` got the parsed ids; `enqueue` got `"WH-1"`; the verification request's body ends with the raw body unchanged.
  2. Redelivery (`record` returns `"processed"`) → 200, no enqueue.
  3. Redelivery of an event still `"received"` (a previous enqueue failed) → 200 and enqueued again.
  4. FAILURE → 400, nothing recorded.
  5. Missing `paypal-transmission-sig` header → 400 without calling PayPal.
  6. No webhook id configured, or no PayPal services → 503.
  7. PayPal verification answers 503 → 502 (PayPal will retry); `enqueue` throws → 500.
  8. A body that is not JSON or has no `id` → 400.

- [ ] **Step 3: Implement the route** — `apps/server/src/routes/paypal-webhooks.ts`:

```ts
import type { PayPalServices } from "@jendal-workspace/api/context";
import type { Database } from "@jendal-workspace/db";
import { recordWebhookEvent } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { type ParsedWebhookEvent, parseWebhookEvent, PayPalError } from "@jendal-workspace/paypal";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

export type PayPalWebhookRouteDeps = {
  paypal: PayPalServices | undefined;
  webhookId: string;
  enqueue: (eventId: string) => Promise<void>;
  record?: (db: Database, event: ParsedWebhookEvent) => ReturnType<typeof recordWebhookEvent>;
};

const HEADER_NAMES = {
  authAlgo: "paypal-auth-algo",
  certUrl: "paypal-cert-url",
  transmissionId: "paypal-transmission-id",
  transmissionSig: "paypal-transmission-sig",
  transmissionTime: "paypal-transmission-time",
} as const;

// Services spec §6.4: verify, store by event id, acknowledge, process from the Queue. PayPal retries any
// non-2xx for 3 days, so a 5xx here is a request to try again later.
export function createPayPalWebhookRoute(deps: PayPalWebhookRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const record = deps.record ?? recordWebhookEvent;

  app.post("/", async (c) => {
    const log = c.get("log");
    if (!deps.paypal || !deps.webhookId) {
      log.set({ paypalWebhook: { refused: "not_configured" } });
      return c.json({ error: "paypal_webhooks_not_configured" }, 503);
    }
    const headers = {
      authAlgo: c.req.header(HEADER_NAMES.authAlgo),
      certUrl: c.req.header(HEADER_NAMES.certUrl),
      transmissionId: c.req.header(HEADER_NAMES.transmissionId),
      transmissionSig: c.req.header(HEADER_NAMES.transmissionSig),
      transmissionTime: c.req.header(HEADER_NAMES.transmissionTime),
    };
    const { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime } = headers;
    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      return c.json({ error: "missing_signature_headers" }, 400);
    }
    const rawBody = await c.req.text();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    const event = parseWebhookEvent(body);
    if (!event) return c.json({ error: "invalid_event" }, 400);
    log.set({ paypalWebhook: { eventId: event.id, eventType: event.eventType, transmissionId } });

    let verified: boolean;
    try {
      verified = await deps.paypal.client.webhooks.verifySignature({
        webhookId: deps.webhookId,
        headers: { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime },
        rawBody,
      });
    } catch (error) {
      if (!(error instanceof PayPalError)) throw error;
      log.error(error, { paypal: { status: error.status, debugId: error.debugId } });
      return c.json({ error: "verification_unavailable" }, 502);
    }
    if (!verified) {
      log.set({ paypalWebhook: { refused: "signature" } });
      return c.json({ error: "invalid_signature" }, 400);
    }

    const status = await record(c.get("db"), event);
    if (status === "received") await deps.enqueue(event.id);
    log.set({ paypalWebhook: { stored: status } });
    return c.json({ ok: true }, 200);
  });

  return app;
}
```

  An exception from `enqueue` or `record` propagates; check that Hono answers 500 in that case (the test covers it), and that the evlog middleware logs it.

- [ ] **Step 4: Failing queue handler test** — `apps/server/src/paypal-webhook-queue.test.ts`. The handler is `handlePayPalWebhookBatch(batch, deps)` with `deps = { find, process, finish, noteAttempt }` injected, and messages faked as `{ body: { eventId }, attempts, ack: vi.fn(), retry: vi.fn() }`. Cases:
  1. A received event is processed, finished with the outcome and acked.
  2. An event already finished (status not `received`) or missing is acked without processing.
  3. A thrown error on attempt 1 is noted and retried with `{ delaySeconds: 30 }`; on attempt 3, `{ delaySeconds: 90 }`.
  4. On attempt 5, the event is finished as `failed` with the error message, and acked.
  5. A malformed message body is acked and logged.

- [ ] **Step 5: Implement the handler** — `apps/server/src/paypal-webhook-queue.ts`:

```ts
import type { WebhookOutcome } from "@jendal-workspace/api/use-cases/paypal-webhooks";
import type { PayPalWebhookEventRow } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { log } from "evlog";

export const MAX_WEBHOOK_ATTEMPTS = 5;
const RETRY_STEP_SECONDS = 30;

export type WebhookMessage = {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type PayPalWebhookQueueDeps = {
  find: (eventId: string) => Promise<PayPalWebhookEventRow | null>;
  process: (event: PayPalWebhookEventRow) => Promise<WebhookOutcome>;
  finish: (eventId: string, outcome: { status: "processed" | "ignored" | "parked" | "failed"; note?: string }) => Promise<void>;
  noteAttempt: (eventId: string, error: string) => Promise<number>;
};

function eventIdOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("eventId" in body)) return null;
  return typeof body.eventId === "string" ? body.eventId : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// Services spec §6.4. Messages are processed one at a time so a slow PayPal call cannot fail the batch;
// each message is acked or retried on its own.
export async function handlePayPalWebhookBatch(messages: readonly WebhookMessage[], deps: PayPalWebhookQueueDeps): Promise<void> {
  for (const message of messages) {
    const eventId = eventIdOf(message.body);
    if (!eventId) {
      log.error({ action: "paypal.webhook.process", error: { name: "MalformedMessage" } });
      message.ack();
      continue;
    }
    const event = await deps.find(eventId);
    if (!event || event.status !== "received") {
      message.ack();
      continue;
    }
    try {
      const outcome = await deps.process(event);
      await deps.finish(eventId, outcome);
      log.info({ action: "paypal.webhook.process", paypalWebhook: { eventId, eventType: event.eventType, ...outcome } });
      message.ack();
    } catch (error) {
      const note = describe(error);
      await deps.noteAttempt(eventId, note);
      if (message.attempts >= MAX_WEBHOOK_ATTEMPTS) {
        await deps.finish(eventId, { status: "failed", note });
        log.error({ action: "paypal.webhook.process", paypalWebhook: { eventId, eventType: event.eventType, status: "failed" }, error: { name: error instanceof Error ? error.name : "unknown" } });
        message.ack();
      } else {
        message.retry({ delaySeconds: RETRY_STEP_SECONDS * message.attempts });
      }
    }
  }
}
```

  (Rename the local `describe` to `errorNote` if it clashes with anything; it must not shadow Vitest in the test file.) Check evlog's `log.info`/`log.error` signatures against `apps/server/src/email-log.ts` and follow them.

- [ ] **Step 6: Wire it** — in `apps/server/src/index.ts`:

```ts
import { processPayPalWebhookEvent } from "@jendal-workspace/api/use-cases/paypal-webhooks";
import {
  findWebhookEvent,
  finishWebhookEvent,
  noteWebhookAttempt,
} from "@jendal-workspace/db/repositories/paypal-webhooks";

import { handlePayPalWebhookBatch, type WebhookMessage } from "./paypal-webhook-queue";
import { createPayPalWebhookRoute } from "./routes/paypal-webhooks";
```

  Mount before `app.route("/", discordRoute)`:

```ts
// The URL registered on the partner app (R1c plan, fact 1); api.D reaches this Worker directly.
app.route(
  "/webhooks/paypal",
  createPayPalWebhookRoute({
    paypal: getPayPalServices(),
    webhookId: ENV.PAYPAL_WEBHOOK_ID,
    enqueue: (eventId) => ENV.PAYPAL_WEBHOOKS.send({ eventId }),
  }),
);
```

  Replace `export default app;` with:

```ts
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, _env: unknown, ctx: ExecutionContext) {
    const db = getDb();
    const paypal = getPayPalServices();
    try {
      await handlePayPalWebhookBatch(batch.messages as readonly WebhookMessage[], {
        find: (eventId) => findWebhookEvent(db, eventId),
        process: (event) => {
          if (!paypal) throw new Error("PayPal is not configured on this server");
          return processPayPalWebhookEvent({ db, paypal }, event);
        },
        finish: (eventId, outcome) => finishWebhookEvent(db, eventId, outcome),
        noteAttempt: (eventId, error) => noteWebhookAttempt(db, eventId, error),
      });
    } finally {
      ctx.waitUntil(db.$client.end());
    }
  },
} satisfies ExportedHandler;
```

  `MessageBatch`, `ExecutionContext` and `ExportedHandler` come from `@cloudflare/workers-types` (already referenced by `env.server.ts`). If `batch.messages` already satisfies `readonly WebhookMessage[]` structurally, drop the `as`; otherwise widen `WebhookMessage` instead of casting. Check that nothing imports `app` as the default export (`rg -n "from \"\\.\\./index\"|from \"\\./index\"" apps/server/src`), and that `satisfies ExportedHandler` type-checks against how Alchemy loads `main`.

- [ ] **Step 7: Run** — `pnpm test apps/server && pnpm -F server check-types && pnpm -F @jendal-workspace/infra check-types` (if the infra package has `check-types`; otherwise `pnpm check-types`). Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server packages/infra
git commit -m "feat(server): receive PayPal webhooks and process them from a Queue" -m "POST /webhooks/paypal verifies the signature with PayPal, stores the event once and enqueues it; the queue() handler processes it, retrying up to five attempts before marking it failed." -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 7: Logs never carry PayPal's detail values

**Files:** Modify `apps/server/src/trpc-error-log.test.ts`.

- [ ] **Step 1: Test** — add a test that builds a `PayPalError` with `details: [{ issue: "INSTRUMENT_DECLINED", field: "/payment_source", value: "4111111111111111", description: "secret detail" }]`, wraps it in a `TRPCError` with code `UNPROCESSABLE_CONTENT`, runs `trpcErrorContext`, then logs the result through evlog's request logger the way `apps/server/src/index.ts` does (`createRequestLogger` from `evlog`, then `.error(context.error, context.fields)` and `.emit()` — check the exported names in `node_modules/evlog/dist/logger.d.mts`) and asserts that `JSON.stringify` of the emitted event contains `INSTRUMENT_DECLINED` and does not contain `4111111111111111` or `secret detail`. If evlog's emitter is awkward to capture, assert on `JSON.stringify(context)` plus evlog's serialized error (the keys listed in fact 8), and explain in the report.

- [ ] **Step 2: Run** — `pnpm test apps/server/src/trpc-error-log.test.ts` — Expected: PASS (this documents current behaviour; it should pass without code changes).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/trpc-error-log.test.ts
git commit -m "test(server): logs never carry PayPal's error detail values" -m "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

---

### Task 8: Full check

- [ ] `pnpm test && pnpm check-types` in the worktree. Expected: all pass (802 before, plus the new tests).

### Task 9: Merge, migrate, configure (controller)

1. Merge `r1c-paypal-webhooks` into `main` with `--no-ff` and a message describing the run; `pnpm install`.
2. `pnpm db:migrate:dev`.
3. Add `PAYPAL_WEBHOOK_ID=3EJ41953HX9926248` to `apps/server/.env` (dev only; not a secret).
4. Restart the dev stack (stop the main worktree's `pnpm dev` process groups, keep the tunnel), wait for `Done: 2 succeeded`, and confirm the log shows the Queue and consumer were created.

### Task 10: Sandbox walkthrough (controller)

1. **Retried deliveries:** PayPal retries the 404ed events from the R1a and R1b deposits. Watch `paypal_webhook_event` fill; capture events for the two deposits end `processed / already_applied`; `CHECKOUT.ORDER.APPROVED` ends `processed / nothing to do`; onboarding events end `ignored`. The two payments get their fees: $7.32 + $1.80 on the $180 deposit, $4.98 + $1.20 on the $120 deposit, with one `payment_fees` transfer each.
2. **A capture the browser never reported:** on the pending $12 "Pay page checks" deposit, open the pay page, click PayPal, approve as the sandbox buyer (ask Mouhamed), and close the Payleor tab before the popup returns. The `CHECKOUT.ORDER.APPROVED` webhook captures it; the payment ends captured with fees and the project in progress.
3. **A forged delivery:** `curl -X POST https://api.payleor.com/webhooks/paypal` with fake signature headers and a body → 400, nothing stored.
4. Record the results in an Outcome section here, update the services spec §6.2–6.3 (fee accounts and the fee posting) and the sellers design §11 and §11.1.

## Outcome (2026-10-08)

Merged into `main` as `e2fcebf`: 864 tests (802 before), type checks clean in all 11 packages. The dev database has the `r1c_paypal_webhooks` migration; `apps/server/.env` has `PAYPAL_WEBHOOK_ID=3EJ41953HX9926248`.

Review changes beyond the plan:
- Finishing an event or noting an attempt only touches events still `received`, so a slow retry cannot overwrite a processed event (`5465334`). Refund events read the seller from `payer`; a malformed fee breakdown counts as unknown, never as zero.
- A capture event whose order shows no capture yet is retried, not ignored; PayPal 401, 408 and 429 are retried; only client-side refusals of a webhook capture count as processed. A failing fee step no longer turns a committed capture into a pay-page error; the webhook path records fees visibly (`9073a41`). The fee-failure log keeps the database error code, not the query (`1abce78`).
- The route caps bodies at 1 MB (413), answers 400 when PayPal's verification rejects the delivery itself, and delays approval events by 60 seconds so the pay page's own capture usually wins (`a31d771`). Stored error notes keep only the error name and database code.

### Sandbox walkthrough

1. **Forged deliveries:** fake signature headers → PayPal answered FAILURE → 400; no headers → 400. Nothing stored.
2. **Resent events:** with Mouhamed's go-ahead, the 10 sandbox events from 2026-10-07/08 (two deposits, their approvals and order completions, onboarding) were resent through `POST /v1/notifications/webhooks-events/{id}/resend`. All passed verification. Capture events → `processed / already_applied`, which recorded the fees of the two deposits captured before R1c: $7.32 + $1.80 on the $180 deposit and $4.98 + $1.20 on the $120 deposit, matching PayPal's transaction pages, each with one balanced `payment_fees` transfer. Approvals → `processed / nothing to do` (after the 60 s delay). Order completions and onboarding events → `ignored`.
3. **A capture only the webhook saw:** on the $12 "Pay page checks" deposit the buyer approved order `27E72918BJ184522B` while the pay page was gone. `CHECKOUT.ORDER.APPROVED` → `processed / captured` (capture `2YL55210169209346`); the later approval and capture events → `nothing to do` / `already_applied`. Payment captured with PayPal's fee $0.77 and Payleor's $0.12; project in progress with its deadline 7 days after PayPal's capture time; balanced ledger.

Final event table: 8 processed, 7 ignored, none parked or failed.

Notes:
- Navigating the pay page away closes the SDK's popup (the popup belongs to the page). A client who closes the tab after approving is still covered by the approval webhook.
- `alchemy dev` created the local Queue and consumer while the old dev stack was still running at merge time (its watcher re-planned); the restart showed them as `noop (local)`.
