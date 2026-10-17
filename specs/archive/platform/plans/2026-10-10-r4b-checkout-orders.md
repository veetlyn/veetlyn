# R4b: Checkout, orders, download links and refunds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer clicks Buy on a seller page, enters an email, pays with PayPal and downloads the file at once; they also get an email with the link (7 days, 5 downloads, a fresh link on request). The seller sees the order in the admin, and a refund in PayPal revokes the links.

**Architecture:** A new `orders` table (one product per order) and `download_grant` table. `core` gains the order rules, token helpers and order ledger postings. `api` gains a public `checkout` router (get, start, capture) that reuses the PayPal client the project pay page uses, an `order` router (the buyer's order page by grant token, the download, the fresh link, and the admin list), and order routing in the PayPal webhook processor (approval auto-capture, capture events, refunds and reversals). The web app gains `/buy/{productId}` and `/orders/{token}` on the store host, an Orders page in the admin, and a "Turn off the store" button. The store switch (`store_enabled`) now gates selling.

**Tech stack:** TypeScript, tRPC, Drizzle (Postgres), vitest, PayPal Orders v2 + JS SDK v6, Cloudflare Workers (vinext web app, Hono api), R2 presigned URLs, `@jendal-workspace/email`.

**Spec:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §5.2 (checkout and delivery), §5.3 (orders and refunds), §7 (payment module), §10 (testing); run 4a plan [`2026-10-09-r4a-digital-products.md`](2026-10-09-r4a-digital-products.md).

---

## Decisions (2026-10-10)

Mouhamed's answers:

1. **Orders post to the ledger.** Paid: `paypal_clearing → team_revenue` (the gross). Fees: `team_revenue → paypal_fees / payleor_fees`, once, from the capture's breakdown. Refund or reversal: `team_revenue → paypal_clearing` for the refunded amount. New transfer kinds `order_paid`, `order_fees`, `order_refunded`; `projectId` null.
2. **Any refund revokes.** A full or partial refund (or a reversal) marks the order `refunded` and revokes every download grant.
3. **The store switch gates selling.** With `store_enabled` off: the seller page lists no products, checkout refuses, published products do not count toward seller publishing, and the admin has a "Turn off the store" button.

Controller decisions:

- **Table names.** `orders` (as the design names it) and `download_grant`. In code, "order" means a store order; PayPal's orders are always "PayPal order" (`paypalOrderId`).
- **Snapshot.** An order copies the product title and price at start (`product_title`, `amount_minor`), so later edits do not change it. The file is resolved at download time (the product's current attached file), so a replaced file reaches past buyers.
- **One order per Buy click.** Each start creates a new pending order and a new PayPal order (no keep-current-order logic as on the pay page): a declined or cancelled attempt is simply left pending. Pending orders are never shown; sweeping them is backlog.
- **The browser proves it started the order** with a random checkout secret returned by `checkout.start` and stored hashed on the order (`checkout_secret_hash`). `checkout.capture` needs it. A capture call that finds the order paid (by itself, or earlier by the webhook) issues a new grant and returns the order page path.
- **The order page is the grant.** `{slug}.payleor.app/orders/{token}` where `token` is a random grant token (32 bytes, base64url), stored as a SHA-256 hex hash. The page shows the order and a Download button while the grant has downloads left, is not expired and is not revoked; otherwise "Email me a new link", which issues a new grant and emails it to the order's buyer email (never shown on the page).
- **Two grants at purchase.** When a capture first applies, one grant goes in the buyer email; the browser's capture call gets its own. Both are 7 days / 5 downloads.
- **Downloads.** `order.download` decrements `downloads_left` atomically, then presigns a GET for 300 seconds (the R2b download length) and returns the URL; the browser navigates to it.
- **Custom id.** PayPal `custom_id` is `order:{orderId}`. The webhook processor routes on that prefix, and finds refunds by capture id.
- **Refund events** carry no custom id or PayPal order id. The parser reads the refunded capture id from the refund's `up` link into a new `paypal_webhook_event.capture_id` column. Project payment refunds are then found by capture id and parked (as designed), instead of being ignored as "not a Payleor payment" today.
- **The buyer email** comes from `stores` ("{Team} via Payleor"), reply-to the team's support email, with the order page link on the team's store host. `EmailServices` gains `storeOrigin(slug)`. The webhook queue consumer gets email services, so a capture the webhook applies also emails the buyer.
- **Fee.** `platformFeeMinor(amount, sellerPlanFor({ id, solo }).feeBps)`; null `platformFeeValue` when it rounds to 0. The order's currency is the team's `services_team_settings.currency`.
- **Limits.** Start: 20 per 10 minutes per IP (`checkout-start:ip:{ip}`). Capture: 20 per 10 minutes per order (`checkout-capture:{orderId}`). Fresh link: 3 per hour per order (`order-link:{orderId}`). Download: the grant's count.
- **Admin.** `order.list` (services-team admins, `manage_settings`) lists paid and refunded orders, newest first. The Orders link shows when the store is on.

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/orders/rules.ts` (+test) | Order statuses, grant constants, `grantState`, buyer email check, custom id helpers |
| `packages/core/src/orders/tokens.ts` (+test) | `newToken`, `hashToken` |
| `packages/core/src/ledger/postings.ts`, `transfers.ts` (+tests) | `orderPaidTransfer`, `orderFeesTransfer`, `orderRefundedTransfer`; new kinds |
| `packages/db/src/schema/orders.ts` | `orders`, `download_grant` |
| `packages/db/src/schema/paypal-webhooks.ts` | `capture_id` column |
| `packages/db/src/repositories/orders.ts` (+test) | Order and grant queries |
| `packages/db/src/repositories/seller-page.ts`, `catalog.ts` | Store switch gating |
| `packages/paypal/src/webhooks.ts`, `orders.ts` (+tests) | Refund capture id; refunds on an order |
| `packages/email/src/templates.ts` (+test) | `orderDownloadEmail` |
| `packages/api/src/context.ts`, `apps/server/src/services.ts`, `apps/server/src/index.ts` | `storeOrigin`; email in the queue consumer |
| `packages/api/src/use-cases/orders.ts` (+test via routers) | Checkout start/capture, capture facts, fees, grants, buyer email, refunds |
| `packages/api/src/routers/checkout.ts`, `routers/order.ts` (+tests) | Public checkout and order page; admin list |
| `packages/api/src/use-cases/paypal-webhooks.ts` (+test) | Order routing |
| `packages/api/src/routers/seller.ts` | Publish count respects the store switch |
| `apps/web/src/app/store/buy/[productId]/…` | Checkout page |
| `apps/web/src/app/store/orders/[token]/…` | Order page |
| `apps/web/src/app/admin/[storeSlug]/orders/…` | Admin orders list |
| `services-team-dashboard.tsx`, `components/catalog/digital-products.tsx` | Orders link, Turn off the store |

Conventions: tests run from the worktree root with `npx vitest run <path>` (packages have no test scripts); `pnpm check-types` from the root. Migrations: edit the schema, then `pnpm db:generate` from the root (or `npx drizzle-kit generate --name r4b_orders` inside `packages/db`), which writes `packages/db/src/migrations/<timestamp>_r4b_orders/{migration.sql,snapshot.json}`. Comments only for reasons the code cannot show; never mention runs or tasks in comments.

---

### Task 1: core — order rules, tokens, order postings

**Files:**
- Create: `packages/core/src/orders/rules.ts`, `packages/core/src/orders/rules.test.ts`
- Create: `packages/core/src/orders/tokens.ts`, `packages/core/src/orders/tokens.test.ts`
- Create: `packages/core/src/orders/index.ts` (re-exports), export it from `packages/core/src/index.ts` the way `catalog` is exported
- Modify: `packages/core/src/ledger/transfers.ts` (`LEDGER_TRANSFER_KINDS`), `packages/core/src/ledger/postings.ts`, and their tests
- Modify: `packages/core/src/sellers/quote-request.ts` (export `EMAIL_PATTERN`)

- [ ] **Step 1: Failing tests.** `rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_GRANT_DAYS,
  DOWNLOADS_PER_GRANT,
  buyerEmailProblem,
  grantState,
  orderCustomId,
  orderIdFromCustomId,
} from "./rules";

const now = new Date("2026-10-10T12:00:00Z");
const grant = { downloadsLeft: 5, expiresAt: new Date("2026-10-17T12:00:00Z"), revokedAt: null };

describe("download grants", () => {
  it("lasts 7 days and 5 downloads", () => {
    expect(DOWNLOAD_GRANT_DAYS).toBe(7);
    expect(DOWNLOADS_PER_GRANT).toBe(5);
  });
  it("is usable with downloads left before it expires", () => {
    expect(grantState(grant, now)).toBe("usable");
  });
  it("is used up at zero downloads", () => {
    expect(grantState({ ...grant, downloadsLeft: 0 }, now)).toBe("used_up");
  });
  it("expires at its expiry time", () => {
    expect(grantState(grant, new Date("2026-10-17T12:00:00Z"))).toBe("expired");
  });
  it("revoked wins over everything", () => {
    expect(grantState({ ...grant, revokedAt: now }, now)).toBe("revoked");
  });
});

describe("buyer email", () => {
  it("accepts a normal address after trimming", () => {
    expect(buyerEmailProblem("  jo@example.com ")).toBeNull();
  });
  it("refuses a malformed or long address", () => {
    expect(buyerEmailProblem("jo@")).toBe("That email address does not look right.");
    expect(buyerEmailProblem(`${"a".repeat(320)}@example.com`)).toBe("That email address does not look right.");
  });
});

describe("custom ids", () => {
  it("round-trips an order id", () => {
    const id = "6f1c2f3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f";
    expect(orderCustomId(id)).toBe(`order:${id}`);
    expect(orderIdFromCustomId(`order:${id}`)).toBe(id);
  });
  it("is null for a payment id, a malformed value or null", () => {
    expect(orderIdFromCustomId("6f1c2f3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f")).toBeNull();
    expect(orderIdFromCustomId("order:nope")).toBeNull();
    expect(orderIdFromCustomId(null)).toBeNull();
  });
});
```

`tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { hashToken, newToken } from "./tokens";

describe("tokens", () => {
  it("makes url-safe tokens of 43 characters that differ each time", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });
  it("hashes to 64 hex characters, the same for the same token", async () => {
    const token = newToken();
    const hash = await hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(hashToken(token)).resolves.toBe(hash);
    await expect(hashToken(newToken())).resolves.not.toBe(hash);
  });
});
```

Ledger, in `packages/core/src/ledger/postings.test.ts` (add a describe):

```ts
describe("order postings", () => {
  it("books a paid order as team revenue", () => {
    const t = orderPaidTransfer({ currency: "USD", orderId: "o1", amountMinor: 1900 });
    expect(t).toMatchObject({ kind: "order_paid", reference: "order_paid:o1", projectId: null });
    expect(t.entries).toEqual(
      expect.arrayContaining([
        { account: "paypal_clearing", currency: "USD", amountMinor: -1900 },
        { account: "team_revenue", currency: "USD", amountMinor: 1900 },
      ]),
    );
  });
  it("books the fees out of team revenue, or nothing when both are zero", () => {
    const t = orderFeesTransfer({ currency: "USD", orderId: "o1", paypalFeeMinor: 115, platformFeeMinor: 19 });
    expect(t?.reference).toBe("order_fees:o1");
    expect(t?.entries).toEqual(
      expect.arrayContaining([
        { account: "team_revenue", currency: "USD", amountMinor: -134 },
        { account: "paypal_fees", currency: "USD", amountMinor: 115 },
        { account: "payleor_fees", currency: "USD", amountMinor: 19 },
      ]),
    );
    expect(orderFeesTransfer({ currency: "USD", orderId: "o1", paypalFeeMinor: 0, platformFeeMinor: 0 })).toBeNull();
  });
  it("books a refund back to PayPal, keyed by the refund", () => {
    const t = orderRefundedTransfer({ currency: "USD", orderId: "o1", refundKey: "refund:R1", amountMinor: 500 });
    expect(t).toMatchObject({ kind: "order_refunded", reference: "order_refunded:refund:R1", projectId: null });
    expect(t.entries).toEqual(
      expect.arrayContaining([
        { account: "team_revenue", currency: "USD", amountMinor: -500 },
        { account: "paypal_clearing", currency: "USD", amountMinor: 500 },
      ]),
    );
  });
});
```

- [ ] **Step 2: Run to fail.** `npx vitest run packages/core/src/orders packages/core/src/ledger` → missing modules/exports.

- [ ] **Step 3: Implement.** `rules.ts`:

```ts
import { EMAIL_PATTERN, QUOTE_REQUEST_LIMITS } from "../sellers/quote-request";

// Sellers design §5.3.
export const ORDER_STATUSES = ["pending", "paid", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Sellers design §5.2: a download link lasts 7 days and allows 5 downloads.
export const DOWNLOAD_GRANT_DAYS = 7;
export const DOWNLOADS_PER_GRANT = 5;

export type GrantState = "usable" | "used_up" | "expired" | "revoked";

export function grantState(
  grant: { downloadsLeft: number; expiresAt: Date; revokedAt: Date | null },
  now: Date,
): GrantState {
  if (grant.revokedAt) return "revoked";
  if (now.getTime() >= grant.expiresAt.getTime()) return "expired";
  if (grant.downloadsLeft <= 0) return "used_up";
  return "usable";
}

export function grantExpiry(now: Date): Date {
  return new Date(now.getTime() + DOWNLOAD_GRANT_DAYS * 86_400_000);
}

export function buyerEmailProblem(email: string): string | null {
  const trimmed = email.trim();
  return EMAIL_PATTERN.test(trimmed) && trimmed.length <= QUOTE_REQUEST_LIMITS.maxEmail
    ? null
    : "That email address does not look right.";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PayPal's custom_id for a store order. Project payments use the bare payment id, so the prefix tells them apart.
export function orderCustomId(orderId: string): string {
  return `order:${orderId}`;
}

export function orderIdFromCustomId(customId: string | null): string | null {
  if (!customId?.startsWith("order:")) return null;
  const id = customId.slice("order:".length);
  return UUID.test(id) ? id : null;
}
```

Export `EMAIL_PATTERN` from `quote-request.ts` (change `const` to `export const`).

`tokens.ts`:

```ts
// Bearer tokens for download links. Only the SHA-256 hash is stored, so a database read cannot be replayed as a link.
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

`transfers.ts`: append `"order_paid", "order_fees", "order_refunded"` to `LEDGER_TRANSFER_KINDS`.

`postings.ts` (after `paymentFeesTransfer`):

```ts
type OrderPosting = { currency: MoneyCurrency; orderId: string };

// Sellers design §5.3: a store order is the team's revenue at capture; there is no client money to hold.
export function orderPaidTransfer(input: OrderPosting & { amountMinor: number }): LedgerTransferDraft {
  return transferFromMoves({
    kind: "order_paid",
    reference: `order_paid:${input.orderId}`,
    projectId: null,
    currency: input.currency,
    moves: [{ from: a.paypalClearing, to: a.teamRevenue, amountMinor: input.amountMinor }],
  });
}

export function orderFeesTransfer(
  input: OrderPosting & { paypalFeeMinor: number; platformFeeMinor: number },
): LedgerTransferDraft | null {
  const moves = [
    { from: a.teamRevenue, to: a.paypalFees, amountMinor: input.paypalFeeMinor },
    { from: a.teamRevenue, to: a.payleorFees, amountMinor: input.platformFeeMinor },
  ].filter((move) => move.amountMinor > 0);
  if (moves.length === 0) return null;
  return transferFromMoves({
    kind: "order_fees",
    reference: `order_fees:${input.orderId}`,
    projectId: null,
    currency: input.currency,
    moves,
  });
}

// refundKey names the PayPal fact: "refund:{refundId}" or "reversal:{captureId}", so each is posted once.
export function orderRefundedTransfer(
  input: OrderPosting & { refundKey: string; amountMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "order_refunded",
    reference: `order_refunded:${input.refundKey}`,
    projectId: null,
    currency: input.currency,
    moves: [{ from: a.teamRevenue, to: a.paypalClearing, amountMinor: input.amountMinor }],
  });
}
```

Check `packages/core/src/ledger/index.ts` (or wherever postings are re-exported) exports the three builders, and that the in-memory ledger tests or any exhaustive switch over `LedgerTransferKind` still compile.

- [ ] **Step 4: Run** `npx vitest run packages/core` and `pnpm check-types` → pass.

- [ ] **Step 5: Commit** `feat(core): order rules, download tokens, order postings` (Co-authored-by trailer).

---

### Task 2: db — orders, download grants, webhook capture id, store switch gating

**Files:**
- Create: `packages/db/src/schema/orders.ts`; export from `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/paypal-webhooks.ts` (`captureId`)
- Create: `packages/db/src/repositories/orders.ts`, `packages/db/src/repositories/orders.test.ts`
- Modify: `packages/db/src/repositories/seller-page.ts` (+test), `packages/db/src/repositories/paypal-webhooks.ts` (input type carries `captureId`)
- Modify: `packages/db/src/testing/db.ts` (truncate list; `seedOrder`; `seedProductFile`)
- Generate: migration `…_r4b_orders`

- [ ] **Step 1: Schema.** `schema/orders.ts`:

```ts
import { ORDER_STATUSES } from "@jendal-workspace/core";
import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { products } from "./catalog";
import { team } from "./organization";

const minor = (name: string) => bigint(name, { mode: "number" });

// Sellers design §5.3: one product per order. Title and amount are copied at checkout so later product edits
// do not change what the buyer paid for. Orders keep the money history, so neither team nor product can be deleted under them.
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull().references(() => team.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    productTitle: text("product_title").notNull(),
    buyerEmail: text("buyer_email").notNull(),
    currency: text("currency", { enum: ["USD", "EUR"] }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    platformFeeMinor: minor("platform_fee_minor"),
    paypalFeeMinor: minor("paypal_fee_minor"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    // SHA-256 of the secret checkout.start gave the browser; checkout.capture must present it.
    checkoutSecretHash: text("checkout_secret_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    paidAt: timestamp("paid_at"),
    refundedAt: timestamp("refunded_at"),
  },
  (t) => [index("orders_team_created_idx").on(t.teamId, t.createdAt)],
);

export const downloadGrant = pgTable(
  "download_grant",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    downloadsLeft: integer("downloads_left").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("download_grant_order_idx").on(t.orderId)],
);
```

(Check `schema/projects.ts` for whether the `currency` enum constant is shared; reuse it if exported.) Add a check constraint `orders_amount_positive` (`amount_minor > 0`) and `download_grant_downloads_left_check` (`downloads_left >= 0`) in the catalog style (`check(name, sql\`…\`)`).

`schema/paypal-webhooks.ts`: add `captureId: text("capture_id"),` after `orderId`, and an index `paypal_webhook_event_capture_idx` on it is not needed (lookups go to `orders`/`payment` by capture id, which are unique).

Truncate list in `testing/db.ts`: add `"download_grant", "orders"` right after `"paypal_webhook_event"` (orders reference products and team, so they go before them).

- [ ] **Step 2: Generate the migration** (`pnpm db:generate` from the root) and read the SQL: two tables, the check constraints, the FKs (`orders.team_id` restrict, `orders.product_id` restrict, `download_grant.order_id` cascade), unique indexes on `paypal_order_id`, `paypal_capture_id`, `token_hash`, and `paypal_webhook_event.capture_id`.

- [ ] **Step 3: Failing repository tests** (`repositories/orders.test.ts`, setup copied from `catalog.test.ts`: `createTestDb`, truncate in `beforeEach`, `seedOrganization` + `seedServicesTeam` + `seedProduct({ kind: "digital", status: "published", priceMinor: 1900 })`):
  - `insertOrder` returns the row with status `pending`; `setOrderPayPalOrder(db, orderId, { paypalOrderId, platformFeeMinor })` stores both; `findOrderByPayPalOrderId` and `findOrderById` find it; `findOrderByCaptureId` finds it after `markOrderPaid`.
  - `lockOrder(tx, id)` inside `db.transaction` returns the row (`FOR UPDATE`).
  - `markOrderPaid(tx, { orderId, captureId, paidAt })` sets status `paid`, capture id and `paid_at` only from `pending` (returns false when already paid).
  - `setOrderFees(tx, { orderId, paypalFeeMinor, platformFeeMinor })`.
  - `markOrderRefunded(tx, { orderId, refundedAt })` changes `paid` → `refunded` once (returns false the second time) and `revokeOrderGrants(tx, orderId, now)` sets `revoked_at` on every unrevoked grant.
  - `insertGrant(tx, { orderId, tokenHash, expiresAt, downloadsLeft })`; `findGrantByTokenHash` returns `{ grant, order }` joined; `useDownload(db, grantId, now)` decrements and returns true while usable, returns false at 0 left, when expired, or when revoked (one atomic `UPDATE … WHERE downloads_left > 0 AND expires_at > now AND revoked_at IS NULL RETURNING`).
  - `listTeamOrders(db, teamId)` returns paid and refunded orders only, newest first, with `{ id, productTitle, buyerEmail, amountMinor, currency, status, createdAt, paidAt, refundedAt }`.
  - Seller page gating (`seller-page.test.ts`): a services team with a published digital product and `store_enabled = false` gets `products: []`; with `store_enabled = true` it gets the product. `countSellableDigitalProducts(db, teamId)` (new, in `catalog.ts`): 0 when the store is off, the published count when on.

- [ ] **Step 4: Implement** `repositories/orders.ts` with the functions above (use `DbExecutor` for reads/updates that may run in or out of a transaction, `Transaction` for `lockOrder`; follow `repositories/files.ts` style). Types: `export type OrderRow = typeof orders.$inferSelect; export type DownloadGrantRow = typeof downloadGrant.$inferSelect;`.

`seller-page.ts`: select `storeEnabled: servicesTeamSettings.storeEnabled` and list products only when `row.product === "services" && row.storeEnabled === true` (otherwise `[]`).

`catalog.ts`:

```ts
// The store switch gates selling: with the store off, published products are not on sale.
export async function countSellableDigitalProducts(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(products)
    .innerJoin(servicesTeamSettings, eq(servicesTeamSettings.teamId, products.storeId))
    .where(
      and(
        eq(products.storeId, storeId),
        eq(products.kind, "digital"),
        eq(products.status, "published"),
        eq(servicesTeamSettings.storeEnabled, true),
      ),
    );
  return row?.count ?? 0;
}
```

`testing/db.ts`: `seedProductFile(db, { teamId, productId, fileName?, sizeBytes? })` inserting an attached `file_upload` row (purpose `product`, `r2Key` `products/{teamId}/{productId}/{uuid}`, `attachedAt: new Date()`; check the `fileUpload` columns, `createdById` may need a seeded user — accept `createdById` as input); `seedOrder(db, { teamId, productId, status?, amountMinor?, buyerEmail?, paypalOrderId?, paypalCaptureId? })` returning the row (with `checkoutSecretHash: "x".repeat(64)` and `productTitle: "Test product"` defaults); and `setStoreEnabled` is already `setServicesTeamStoreEnabled` in `repositories/services-teams.ts` — use it in tests.

`paypal-webhooks.ts` repo: `PayPalWebhookEventInput` gains `captureId: string | null` (it probably derives from the table's insert type; then nothing changes beyond callers passing it).

- [ ] **Step 5: Run** `npx vitest run packages/db` and `pnpm check-types` (callers of `recordWebhookEvent` may need `captureId` — Task 3 passes the real value; pass `captureId: null` temporarily only if the type requires it and note it). Pass.

- [ ] **Step 6: Commit** `feat(db): orders, download grants, refund capture ids, the store switch gates the seller page`.

---

### Task 3: paypal — refund capture id, refunds on an order

**Files:**
- Modify: `packages/paypal/src/webhooks.ts` (+ `webhooks.test.ts`)
- Modify: `packages/paypal/src/orders.ts` (+ its test file; find it with `rg -l captureFromOrder packages/paypal`)
- Modify: `apps/server/src/routes/paypal-webhooks.ts` (+test) — records `captureId`

- [ ] **Step 1: Failing tests.**
  - `parseWebhookEvent` on a `PAYMENT.CAPTURE.REFUNDED` body (resource_type `refund`, resource `{ id: "R1", status: "COMPLETED", amount: { currency_code: "USD", value: "19.00" }, payer: { merchant_id: "SELLER1" }, links: [{ rel: "self", href: "https://api.sandbox.paypal.com/v2/payments/refunds/R1" }, { rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP1" }] }`) → `{ resourceId: "R1", customId: null, orderId: null, captureId: "CAP1", merchantId: "SELLER1" }`. Without an `up` link → `captureId: null`.
  - A `PAYMENT.CAPTURE.COMPLETED` / `REVERSED` body (resource_type `capture`) → `captureId` equals the resource id. An order resource (`CHECKOUT.ORDER.APPROVED`) → `captureId: null`.
  - `refundsFromOrder(order)` on `{ purchase_units: [{ payments: { refunds: [{ id: "R1", status: "COMPLETED", amount: { currency_code: "USD", value: "5.00" } }, { id: "R2", status: "PENDING", amount: {...} }, { bad: true }] } }] }` → `[{ id: "R1", status: "COMPLETED", amount: {…} }, { id: "R2", status: "PENDING", amount: {…} }]` (malformed entries dropped); no refunds → `[]`.
  - The route test records `captureId` on the stored event.

- [ ] **Step 2: Implement.** `ParsedWebhookEvent` gains `captureId: string | null`. Refund branch:

```ts
  if (resourceType === "refund") {
    return { ...base, customId: null, orderId: null, captureId: refundedCaptureId(resource), merchantId: text(record(resource?.payer)?.merchant_id) };
  }
```

with

```ts
// R1 facts §4: a refund names its capture only through the "up" link, …/v2/payments/captures/{id}.
function refundedCaptureId(resource: Record<string, unknown> | null): string | null {
  const links = Array.isArray(resource?.links) ? resource.links : [];
  for (const link of links) {
    const entry = record(link);
    const href = text(entry?.href);
    if (entry?.rel === "up" && href) {
      const match = /\/v2\/payments\/captures\/([^/?#]+)/.exec(href);
      if (match?.[1]) return decodeURIComponent(match[1]);
    }
  }
  return null;
}
```

and for the rest: `captureId: isOrder ? null : text(resource?.id)`. Update the comment above the refund branch (refunds are now read).

`orders.ts`: `PayPalOrder.purchase_units` payments gains `refunds?: PayPalRefund[]` with `export type PayPalRefund = { id: string; status: string; amount?: PayPalMoney };` and

```ts
export function refundsFromOrder(order: PayPalOrder): PayPalRefund[] {
  const raw: unknown = order.purchase_units?.[0]?.payments?.refunds;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const r = value as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.status !== "string") return [];
    return [{ id: r.id, status: r.status, amount: parseMoney(r.amount) }];
  });
}
```

Export `refundsFromOrder` and `PayPalRefund` from the package index next to `captureFromOrder`. The webhook route passes `captureId: parsed.captureId` to `recordWebhookEvent`.

- [ ] **Step 3: Run** `npx vitest run packages/paypal apps/server/src/routes` and `pnpm check-types`. Pass.

- [ ] **Step 4: Commit** `feat(paypal): read the refunded capture from refund events, list an order's refunds`.

---

### Task 4: email — the buyer email, the store origin, email in the webhook consumer

**Files:**
- Modify: `packages/email/src/templates.ts` (+ `templates.test.ts`), export from `packages/email/src/index.ts`
- Modify: `packages/api/src/context.ts` (`EmailServices.storeOrigin`)
- Modify: `apps/server/src/services.ts` (`storeOrigin` + `storeOriginFor` helper, + test if `services.test.ts` exists, else a small `apps/server/src/store-origin.test.ts`)
- Modify: `apps/server/src/index.ts` (queue consumer passes email)
- Modify: every test that builds `email: { mailer, siteOrigin, adminOrigin }` — add `storeOrigin: (slug) => \`https://${slug}.payleor.test\`` (grep `adminOrigin:` in `packages/api/src`)

- [ ] **Step 1: Failing tests.**

```ts
describe("orderDownloadEmail", () => {
  it("links the order page and names the product and the seller", () => {
    const email = orderDownloadEmail({ teamName: "Walk Crew", productTitle: "Icon pack", url: "https://walk-crew.payleor.app/orders/tok" });
    expect(email.subject).toBe("Your download: Icon pack");
    expect(email.text).toContain("Hi there,");
    expect(email.text).toContain("Walk Crew");
    expect(email.text).toContain("https://walk-crew.payleor.app/orders/tok");
    expect(email.html).toContain("https://walk-crew.payleor.app/orders/tok");
    expect(email.text).toContain("7 days");
  });
  it("keeps CR/LF out of the subject", () => {
    expect(orderDownloadEmail({ teamName: "T", productTitle: "A\r\nBcc: x", url: "https://x" }).subject).not.toMatch(/[\r\n]/);
  });
});
```

Store origin (pure function, exported from `apps/server/src/store-origin.ts`):

```ts
it("uses https and the store domain", () => {
  expect(storeOriginFor({ storeDomain: "payleor.app", adminOrigin: "https://admin.payleor.com" })("walk-crew")).toBe("https://walk-crew.payleor.app");
});
it("uses http and the admin port on localhost", () => {
  expect(storeOriginFor({ storeDomain: "localhost", adminOrigin: "http://admin.localhost:3001" })("walk-crew")).toBe("http://walk-crew.localhost:3001");
});
```

- [ ] **Step 2: Implement.**

```ts
export function orderDownloadEmail(input: { teamName: string; productTitle: string; url: string }): EmailContent {
  return render({
    subject: `Your download: ${input.productTitle}`,
    name: "there",
    intro: `Thanks for your purchase from ${input.teamName}. Download ${input.productTitle} from your order page:`,
    action: "Download",
    url: input.url,
    outro:
      "The link works for 7 days and 5 downloads. After that, open it and ask for a new link; it comes to this address.",
  });
}
```

`apps/server/src/store-origin.ts`:

```ts
// Mirrors apps/web lib/store-url.ts: local stages serve stores over http on the web port; other hosts use https.
export function storeOriginFor(input: { storeDomain: string; adminOrigin: string }): (slug: string) => string {
  const local = input.storeDomain === "localhost";
  const port = local ? new URL(input.adminOrigin).port : "";
  return (slug) => `${local ? "http" : "https"}://${slug}.${input.storeDomain}${port ? `:${port}` : ""}`;
}
```

`EmailServices` gains `// Absolute origin of a team's store host, e.g. https://walk-crew.payleor.app.\n storeOrigin: (slug: string) => string;`. `getEmailServices` sets `storeOrigin: storeOriginFor({ storeDomain: ENV.STORE_DOMAIN || ENV.PLATFORM_DOMAIN, adminOrigin })`. Make `getEmailServices` accept `{ waitUntil(promise): void }` (the queue handler's `ctx` has `waitUntil` too).

Queue consumer in `apps/server/src/index.ts`: build `const email = getEmailServices(ctx);` and pass `processPayPalWebhookEvent({ db, paypal, email }, event)` — Task 7 widens the deps type; until then pass it only if it compiles, otherwise leave a one-line change for Task 7 (say so in the report).

- [ ] **Step 3: Run** `npx vitest run packages/email apps/server packages/api` and `pnpm check-types`. Pass.

- [ ] **Step 4: Commit** `feat(email,server): the buyer download email and store origins`.

---

### Task 5: api — checkout (get, start, capture), capture facts, grants, buyer email; the publish count

**Files:**
- Create: `packages/api/src/use-cases/orders.ts`
- Create: `packages/api/src/routers/checkout.ts`, `packages/api/src/routers/checkout.test.ts`
- Modify: `packages/api/src/routers/index.ts` (mount `checkout`)
- Modify: `packages/api/src/routers/seller.ts` (+ `seller.test.ts`): `listedCount` uses `countSellableDigitalProducts`

Context: copy the router test setup from `packages/api/src/routers/payment.test.ts` (the PayPal fakes: `fakeFetch`, `jsonResponse`, `FAKE_TOKEN_RESPONSE` from `@jendal-workspace/paypal/testing`, and the `makePayPal(fetch)` helper in `packages/api/src/use-cases/paypal-webhooks.test.ts:69`) and the email fake (`createFakeMailer` from `@jendal-workspace/email/fake`, caller pattern at `packages/api/src/routers/project.test.ts:1174`). A caller: `appRouter.createCaller({ db, session: null, environment: "sandbox", auth, headers: new Headers({ "cf-connecting-ip": "203.0.113.9" }), catalog: createTestCatalogServices(), files: createFakeFileStore(), paypal, email })`.

- [ ] **Step 1: Failing router tests** (`checkout.test.ts`). Seed: an active services team with `paypalMerchantId: "SELLER1"` (set it with an update; see how `payment.test.ts` connects a team), store on (`setServicesTeamStoreEnabled`), support email set, a published digital product at 1900 with `seedProductFile`.
  1. `checkout.get({ slug, productId })` → `{ product: { id, title, description, priceMinor: 1900 }, currency: "USD", team: { name }, paypal: { clientId, partnerAttributionId, environment, merchantId: "SELLER1" } }`.
  2. `checkout.get` → NOT_FOUND "This product is not for sale." for: a draft team; the store off; a draft product; a physical product; a product of another team; an unknown slug.
  3. `checkout.start({ slug, productId, email: "jo@example.com" })` → `{ orderId: "ORDER1", secret }` (secret 43 chars). The PayPal create request has `purchase_units[0].custom_id = "order:{ourId}"`, `amount.value "19.00"`, `payee.merchant_id "SELLER1"`, `platform_fees[0].amount.value "0.19"` (team plan 1%), `description "Icon pack"`, `PayPal-Request-Id` starting `checkout:`. The `orders` row: pending, `buyer_email` trimmed and lowercased, `product_title`, `amount_minor 1900`, `platform_fee_minor 19`, `paypal_order_id "ORDER1"`, `checkout_secret_hash = hashToken(secret)`.
  4. `checkout.start` refusals: bad email → BAD_REQUEST "That email address does not look right." (nothing written); the store off / unpublished → NOT_FOUND "This product is not for sale."; no merchant id → PRECONDITION_FAILED "This seller cannot take payments yet."; no file attached → PRECONDITION_FAILED "This product is not available right now."; the 21st start from one IP in 10 minutes → TOO_MANY_REQUESTS.
  5. `checkout.capture({ orderId: "ORDER1", secret })` with a fake capture response `COMPLETED` 19.00 USD with a fee breakdown (paypal_fee 1.21, platform_fees 0.19) → `{ outcome: "captured", orderPath: "/orders/{token}" }`. The order: `paid`, capture id, `paid_at`, `paypal_fee_minor 121`, `platform_fee_minor 19`. Two grants exist (one for the email, one returned), each 5 downloads and 7 days. The ledger has `order_paid:{id}` and `order_fees:{id}` for the team (query `ledger_transfer` by reference). The fake mailer sent one email: sender `stores`, `onBehalfOf` the team name, `replyTo` the support email, `to: "jo@example.com"`, subject "Your download: Icon pack", text containing `https://{slug}.payleor.test/orders/`.
  6. A second `checkout.capture` with the same secret → `captured` with a new `orderPath`; no second email, no second ledger posting; three grants now.
  7. A wrong secret → NOT_FOUND "This checkout is not valid."; an unknown PayPal order id → same.
  8. INSTRUMENT_DECLINED from PayPal → UNPROCESSABLE_CONTENT "PayPal declined this payment method. Choose another way to pay."; the order stays pending.
  9. A capture whose amount differs from the order (PayPal says 10.00) → the order stays pending and the call fails (INTERNAL_SERVER_ERROR); nothing is posted.
  10. A `PENDING` capture → `{ outcome: "pending" }`, the capture id recorded, status still pending, no grant, no email.
  Plus in `seller.test.ts`: a services team with PayPal, no active service and a published digital product refuses to publish when the store is off ("Add at least one active service or product before you publish.") and publishes when it is on.

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement `use-cases/orders.ts`.** Shape (fill in following `use-cases/payments.ts`, reusing `captureFromOrder`, `PayPalError`, `parseMajorAmount`, `toPayPalValue`, `platformFeeMinor`, `sellerPlanFor`, `databaseErrorFields`):

```ts
export type OrderDeps = { db: Database; paypal: PayPalServices; email?: EmailServices };

export type OrderCaptureFact = {
  orderId: string;          // ours
  paypalOrderId: string;
  captureId: string;
  status: string;           // COMPLETED | PENDING | DECLINED | FAILED
  amountMinor: number | null;
  currency: string | null;
  capturedAt: Date | null;
  paypalFeeMinor: number | null;
  platformFeeMinor: number | null;
};

export type OrderCaptureResult = "applied" | "already_applied" | "pending" | "failed" | "stale";
```

- `sellableProduct(db, { slug, productId })` → `{ team, settings, product, priceMinor }` or throws NOT_FOUND "This product is not for sale." Rules: `findServicesTeamBySlug`; `team.status === "active"`; settings `storeEnabled`; `getProduct(db, createTenantContext(...), productId)` — or a direct query by `products.storeId = team.id and id = productId` — kind `digital`, status `published`; the variant price > 0. (A non-uuid `productId` must read as NOT_FOUND, not a database error: validate with `z.uuid()` in the router.)
- `getCheckout(deps: { db; paypal?: PayPalServices }, input)` → the shape of test 1 (`paypal` null when PayPal is not configured or the team has no merchant id).
- `startCheckout(deps, { slug, productId, email })`: `buyerEmailProblem` → BAD_REQUEST; `sellableProduct`; merchant id (PRECONDITION_FAILED "This seller cannot take payments yet."); `findAttachedProductFile` (PRECONDITION_FAILED "This product is not available right now."); `secret = newToken()`; insert the order (`buyerEmail: email.trim().toLowerCase()`, title, amount, currency from settings, `checkoutSecretHash: await hashToken(secret)`); create the PayPal order (`requestId: \`checkout:${order.id}\``, `customId: orderCustomId(order.id)`, `description: product.title`, `brandName: team.name`, `items: [{ name: product.title, value }]`, fee as in `startPayment`); `setOrderPayPalOrder`; return `{ orderId: paypalOrder.id, secret }`.
- `captureCheckout(deps, { paypalOrderId, secret })`: `findOrderByPayPalOrderId`, compare `await hashToken(secret)` with `checkoutSecretHash` → NOT_FOUND "This checkout is not valid." on any mismatch; if `refunded` → BAD_REQUEST "This order was refunded."; if `paid` → issue a grant, return captured; else capture at PayPal exactly like `capturePayment` (fresh `requestId` `capture:${paypalOrderId}:${uuid}`, INSTRUMENT_DECLINED → UNPROCESSABLE_CONTENT, other PayPalError → `orders.get` fallback); `applyOrderCaptureFact`; on `applied`/`already_applied` with COMPLETED → issue the browser grant and return `{ outcome: "captured", orderPath: \`/orders/${token}\` }`; PENDING → `{ outcome: "pending" }`; otherwise `{ outcome: "declined" }`.
- `orderCaptureFact(order, paypalOrderId, capture)` mirrors `captureFact`.
- `applyOrderCaptureFact(deps, fact)`:
  - PENDING: record the capture id on a pending order with that PayPal order id (`UPDATE … WHERE status = 'pending' AND paypal_order_id = … AND (paypal_capture_id IS NULL OR = …)`); "pending" or "stale".
  - COMPLETED, in one transaction: `lockOrder`; a different capture id already on the order → throw `CaptureFactConflict` (import from `./payments`); `paypal_order_id` differs → COMPLETED throws `CaptureFactConflict`, else "stale"; already `paid`/`refunded` → "already_applied"; amount or currency mismatch → `CaptureFactConflict`; `markOrderPaid`; post `orderPaidTransfer` with `createPostgresLedger(order.teamId, tx)`; issue the email grant (`insertGrant` with `hashToken(newToken())`, keep the raw token for the email); "applied". After commit: `recordOrderFees(deps.db, fact)` (logged on failure, like `applyCaptureFact`), then send the buyer email (below).
  - DECLINED/FAILED: record the capture id only when the order is still pending on that PayPal order (the buyer can try again with a new order); "failed".
- `recordOrderFees(db, fact)`: COMPLETED with a non-null `paypalFeeMinor`, in a transaction: lock, skip unless `paid` with this capture id and `paypal_fee_minor` null; `setOrderFees`; post `orderFeesTransfer` when non-null.
- `issueGrant(db, orderId, now = new Date())` → raw token; `insertGrant({ tokenHash: await hashToken(token), expiresAt: grantExpiry(now), downloadsLeft: DOWNLOADS_PER_GRANT })`.
- `sendDownloadEmail(deps, { order, token })`: needs `deps.email` (absent → `log.warn` and return); `findTeamById` for the name, slug and support email; `deps.email.mailer.send({ sender: "stores", onBehalfOf: team.name, replyTo: team.supportEmail ?? undefined, tag: "order-download", to: order.buyerEmail, ...orderDownloadEmail({ teamName: team.name, productTitle: order.productTitle, url: \`${deps.email.storeOrigin(team.slug)}/orders/${token}\` }) })`. Build everything first, then send; wrap the send in `try/catch` and report failures to `deps.email.onError?.(error, { kind: "order-download", to })` — a failed email never fails the capture (the buyer has the page and can ask for a new link). Await it (do not use `waitUntil`: the queue path's db client closes at the end).

Router `routers/checkout.ts`:

```ts
const slugInput = z.string().min(1).max(63);
const productInput = z.object({ slug: slugInput, productId: z.uuid() });

export const checkoutRouter = router({
  get: publicProcedure.input(productInput).query(({ ctx, input }) => getCheckout({ db: ctx.db, paypal: ctx.paypal }, input)),
  start: publicProcedure
    .input(productInput.extend({ email: z.string().max(400) }))
    .mutation(async ({ ctx, input }) => {
      await limit(ctx, `checkout-start:ip:${ctx.headers.get("cf-connecting-ip") ?? "unknown"}`, 20);
      return startCheckout(orderDeps(ctx), input);
    }),
  capture: publicProcedure
    .input(z.object({ orderId: z.string().min(1).max(64), secret: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await limit(ctx, `checkout-capture:${input.orderId}`, 20);
      return captureCheckout(orderDeps(ctx), { paypalOrderId: input.orderId, secret: input.secret });
    }),
});
```

with `limit` as in `routers/payment.ts` (10-minute window, TOO_MANY_REQUESTS "Too many attempts. Wait a few minutes and try again.") and `orderDeps(ctx)` → `{ db, paypal: requirePayPal(ctx.paypal), email: ctx.email }` (copy `requirePayPal`). Mount as `checkout` in `routers/index.ts`.

`routers/seller.ts`: replace `countPublishedDigitalProducts(db, seller.id)` with `countSellableDigitalProducts(db, seller.id)`.

- [ ] **Step 4: Run** `npx vitest run packages/api` and `pnpm check-types`. Pass.

- [ ] **Step 5: Commit** `feat(api): guest checkout for digital products, order captures with grants, postings and the buyer email`.

---

### Task 6: api — the order page, downloads, a fresh link, the admin list

**Files:**
- Modify: `packages/api/src/use-cases/orders.ts`
- Create: `packages/api/src/routers/order.ts`, `packages/api/src/routers/order.test.ts`; mount as `order` in `routers/index.ts`

- [ ] **Step 1: Failing tests** (seed a paid order with `seedOrder`, a grant via `issueGrant`, `seedProductFile`, the fake file store):
  1. `order.get({ token })` → `{ order: { productTitle, amountMinor, currency, status: "paid", paidAt }, team: { name }, grant: { state: "usable", downloadsLeft: 5, expiresAt }, maskedEmail: "j•@example.com" }` (mask: first character, a bullet, the domain). An unknown token → NOT_FOUND "This link is not valid.".
  2. `order.download({ token })` → `{ url }` from the fake (`presignGet` recorded with the product file's key and name, 300 seconds); `downloadsLeft` becomes 4. After five downloads the sixth → BAD_REQUEST "This link has no downloads left. Ask for a new one." and `get` shows `used_up`. An expired grant → BAD_REQUEST "This link has expired. Ask for a new one.". A refunded order → BAD_REQUEST "This order was refunded." (and `get` shows `status: "refunded"`, `grant.state: "revoked"`). The product's file missing → PRECONDITION_FAILED "This file is not available. Contact the seller.".
  3. `order.sendNewLink({ token })` on a used-up grant → `{ sentTo: "j•@example.com" }`, a new grant row, one email to the buyer with a link to the new token; the 4th call in an hour → TOO_MANY_REQUESTS; a refunded order → BAD_REQUEST "This order was refunded."; a pending order → NOT_FOUND "This link is not valid." (grants only exist for paid orders, so this is defensive).
  4. `order.list({ teamSlug })` as a services-team admin → paid and refunded orders only (a pending one is left out), newest first, `{ id, productTitle, buyerEmail, amountMinor, currency, status, paidAt, refundedAt }`; a freelancer → FORBIDDEN "Only an admin can see orders."; an outsider → NOT_FOUND.

- [ ] **Step 2: Implement.** In `use-cases/orders.ts`: `getOrderPage(db, token, now)`, `downloadOrderFile(deps: { db; files }, token, now)` (check order status, then `useDownload`; when it returns false, report by `grantState`), `sendNewOrderLink(deps: OrderDeps-like { db; email? }, token)` (limit `order-link:{orderId}` 3/hour via `hitRequestLimit`, `issueGrant`, `sendDownloadEmail`; here a failed send throws INTERNAL_SERVER_ERROR "We could not send the email. Try again in a few minutes." because the email is the whole point), `listOrders(db, teamId)`. `maskEmail(email)` in `core/orders/rules.ts` with a unit test (`"jo@example.com"` → `"j•@example.com"`).

Router: `get` and `download`/`sendNewLink` are `publicProcedure` with `z.object({ token: z.string().min(20).max(100) })`; `list` is `servicesTeamProcedure` with `canServicesTeam(ctx.servicesTeamRole, "manage_settings")` → FORBIDDEN "Only an admin can see orders.". `download` uses `ctx.files`; `sendNewLink` needs `ctx.email` (absent → PRECONDITION_FAILED "Email is not configured on this server.").

- [ ] **Step 3: Run** `npx vitest run packages/api packages/core` and `pnpm check-types`. Pass.

- [ ] **Step 4: Commit** `feat(api): the buyer's order page with downloads and fresh links, the admin orders list`.

---

### Task 7: api — order webhooks: approval capture, capture events, refunds and reversals

**Files:**
- Modify: `packages/api/src/use-cases/paypal-webhooks.ts` (+ `paypal-webhooks.test.ts`)
- Modify: `packages/api/src/use-cases/orders.ts` (`captureOrderFromWebhook`, `applyOrderRefund`)
- Modify: `apps/server/src/index.ts` if Task 4 could not pass `email` yet

- [ ] **Step 1: Failing tests** in `paypal-webhooks.test.ts` (reuse its helpers; seed orders with `seedOrder` and a paid order's capture id):
  1. `CHECKOUT.ORDER.APPROVED` with `customId: "order:{id}"`, `orderId: "ORDER1"` on a pending order → captures at PayPal, the order becomes paid, the buyer email is sent once (pass a fake `email` in deps), outcome `processed / applied`. On an order already paid → `processed / nothing to do`, no PayPal call.
  2. `PAYMENT.CAPTURE.COMPLETED` with `customId: "order:{id}"` → `orders.get` re-fetch, the fact applied, fees recorded; a redelivery → `already_applied`, still one email and one `order_paid` posting.
  3. `PAYMENT.CAPTURE.REFUNDED` with `customId: null`, `orderId: null`, `captureId: "CAP1"` (the paid order's capture), merchant `SELLER1` → the order lookup (`orders.get` returns the capture `PARTIALLY_REFUNDED` and `refunds: [{ id: "R1", status: "COMPLETED", amount 5.00 }]`) → order `refunded`, every grant revoked, ledger `order_refunded:refund:R1` for 500; outcome `processed / refunded`. Redelivery → no second posting (`processed / already refunded`). A second refund R2 later (order lookup lists R1 and R2) → only `order_refunded:refund:R2` is added.
  4. `PAYMENT.CAPTURE.REVERSED` (`captureId: "CAP1"`, resource type capture) → refunded, grants revoked, `order_refunded:reversal:CAP1` for the full amount.
  5. A refund whose merchant does not match the team → `parked / merchant does not match the team`.
  6. A project payment refund (`captureId` equal to a captured payment's `paypal_capture_id`) → `parked / refunds and reversals need a person` (it used to be `ignored`). Update the existing "parks refunds and reversals" test to use `captureId` instead of `customId`, and rename `REFUND_NOTE` to drop "(run 4)".
  7. An event with `customId: "order:{unknown uuid}"` → `ignored / not a Payleor payment`.

- [ ] **Step 2: Implement.** `processPayPalWebhookEvent(deps: PaymentDeps & { email?: EmailServices }, event)`:
  - First: `const orderId = orderIdFromCustomId(event.customId)`. If set → `processOrderEvent(deps, orderId, event)`.
  - For refund/reversal events with `event.captureId`: `findOrderByCaptureId` → `processOrderRefund(deps, order, event)`; else find a payment by `paypalCaptureId = captureId` and park it with the refund note; else ignored.
  - Otherwise the existing payment flow unchanged.
  - `processOrderEvent`: load the order (missing → ignored); team merchant check (as for payments); approval → if the order is pending with no capture id and the event's PayPal order id matches, call `captureOrderFromWebhook(deps, order)` (the capture half of `captureCheckout` without the secret or a browser grant) and return its outcome; capture events → `orders.get`, `captureFromOrder`; a capture `REFUNDED`/`PARTIALLY_REFUNDED`/`REVERSED` → `processOrderRefund`; else `applyOrderCaptureFact` and `recordOrderFees` (throwing on fee failure, as the payment path does). Map errors the same way as the payment path (CaptureFactConflict → parked; PayPal 4xx other than 401/408/429 → parked; TRPCError client refusals → processed).
  - `applyOrderRefund(deps, order, { captureId, reversal })`: re-fetch the PayPal order (`orders.get` with the team merchant); in one transaction: lock the order; if `paid`, `markOrderRefunded` and `revokeOrderGrants` (any refund revokes, decision 2); then post, each in its own `db.transaction`, `orderRefundedTransfer` per COMPLETED refund from `refundsFromOrder` (`refundKey: \`refund:${refund.id}\``, amount via `parseMajorAmount` when the currency matches) and, for a reversal (capture status `REVERSED`), one with `refundKey: \`reversal:${captureId}\`` for the order amount; catch `LedgerError` with code `duplicate_reference` as already posted. Outcome note: `refunded` the first time, `already refunded` after.

Queue consumer: `processPayPalWebhookEvent({ db, paypal, email: getEmailServices(ctx) }, event)`.

- [ ] **Step 3: Run** `npx vitest run packages/api apps/server` and `pnpm check-types`. Pass.

- [ ] **Step 4: Commit** `feat(api): order webhooks: approval capture, capture events, refunds and reversals revoke downloads`.

---

### Task 8: web storefront — the checkout page and the order page

**Files:**
- Create: `apps/web/src/app/store/buy/[productId]/page.tsx`, `checkout-form.tsx`
- Create: `apps/web/src/app/store/orders/[token]/page.tsx`, `order-page.tsx`
- Create: `apps/web/src/lib/checkout.ts` (+ `checkout.test.ts`) — small pure helpers
- Reuse: `@/lib/pay-page` (`sdkEnvironment`), `@/lib/money` (`formatMinor`), `@/components/delivery-file.tsx` pattern for navigating to a download URL

Context: store pages live under `apps/web/src/app/store/` (the proxy rewrites `{slug}.payleor.app/x` to `/store/x`). `app/store/request/page.tsx` + `request-form.tsx` are the model: the server page calls `fetchSellerPage()` (`@/lib/server-api`) for 404s and passes `page.slug`; the client form uses `trpc`/`trpcClient` from `@/utils/trpc` (relative `/trpc`, same origin on every host). The PayPal button pattern is `apps/web/src/app/(site)/pay/[token]/paypal-checkout.tsx` — copy its SDK setup, the click guards, `start({ presentationMode: "auto" }, orderPromise)` inside the click, and the always-mounted `role="alert"`.

- [ ] **Step 1: Helpers with tests.** `lib/checkout.ts`:

```ts
// Null when the address looks right; the server checks again.
export function checkoutEmailProblem(email: string): string | null {
  const trimmed = email.trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) ? null : "That email address does not look right.";
}

export type GrantState = "usable" | "used_up" | "expired" | "revoked";

export function grantMessage(state: GrantState, status: "paid" | "refunded" | "pending"): string | null {
  if (status === "refunded" || state === "revoked") return "This order was refunded, so the download is no longer available.";
  if (state === "expired") return "This link has expired. Ask for a new one and we'll email it to you.";
  if (state === "used_up") return "This link has no downloads left. Ask for a new one and we'll email it to you.";
  return null;
}
```

Tests for each branch.

- [ ] **Step 2: Checkout page.** `buy/[productId]/page.tsx` (server): `const page = await fetchSellerPage(); const product = page?.products.find((p) => p.id === productId); if (!page || !product) notFound();` then render a `main` with a back link to `/` ("← {page.name}"), the heading "Buy {product.title}", the description, the price (`formatMinor(product.priceMinor, page.currency)`) and `<CheckoutForm slug={page.slug} productId={product.id} currency={page.currency} />`. (`fetchSellerPage` only lists products when the store is on, so a store-off seller 404s here too.)

`checkout-form.tsx` (client):
- `const checkout = useQuery({ ...trpc.checkout.get.queryOptions({ slug, productId }), retry: false })` for the PayPal setup (`checkout.data.paypal`); error → `role="alert"` with the server message; `paypal === null` → "This seller cannot take payments yet."
- An email field (`<Label htmlFor="checkout-email">Your email</Label>`, `type="email"`, `autoComplete="email"`, hint "We'll send your download link here."). The PayPal button is shown but a click with a bad email shows the email problem and does not start (check `checkoutEmailProblem` at click time, set `aria-invalid` and focus the field).
- The PayPal session as in `paypal-checkout.tsx`, with: the click → `const started = trpcClient.checkout.start.mutate({ slug, productId, email: emailRef.current })`, keep `started.then((r) => (secret = r.secret))`, pass `started.then((r) => ({ orderId: r.orderId }))` to `created.start(...)`. Read the email from a ref (the effect must not re-run on every keystroke).
- `onApprove({ orderId })` → `trpcClient.checkout.capture.mutate({ orderId, secret })`: `captured` → `window.location.assign(result.orderPath)`; `pending` → a status message "PayPal is still processing your payment. We'll email your download link as soon as it clears."; `declined` → "PayPal declined this payment. Try again or choose another way to pay." Errors → the server message.
- A short line under the button: "Payments go to {team name} through PayPal." (from `checkout.data.team.name`).

- [ ] **Step 3: Order page.** `orders/[token]/page.tsx` (server) renders `<OrderPage token={token} />` (no server fetch: the token is the auth). `order-page.tsx` (client):
- `useQuery(trpc.order.get.queryOptions({ token }), retry: false)`; NOT_FOUND → "This link is not valid. Check the link in your email." with no other content.
- Shows "Order from {team.name}", the product title, the amount, "Paid {date}" (`toLocaleDateString`), and:
  - `grant.state === "usable"` and status paid → a Download button (`useMutation(trpc.order.download.mutationOptions({ onSuccess: ({ url }) => window.location.assign(url) }))`, then invalidate `order.get`) and "{n} downloads left · link works until {date}".
  - otherwise the `grantMessage` text and, unless refunded, a "Email me a new link" button → `order.sendNewLink`; success → `role="status"` "We sent a new link to {sentTo}."; errors in `role="alert"`.
- Keep the sandbox banner as the layout renders it.

- [ ] **Step 4: Run** `npx vitest run apps/web` and `pnpm check-types`. Pass.

- [ ] **Step 5: Commit** `feat(web): the checkout page and the buyer's order page`.

---

### Task 9: web admin — orders list, turning the store off

**Files:**
- Create: `apps/web/src/app/admin/[storeSlug]/orders/page.tsx`, `orders-list.tsx`
- Modify: `apps/web/src/app/admin/[storeSlug]/services-team-dashboard.tsx` (Orders link; Turn off in the Store card)
- Modify: `apps/web/src/components/catalog/digital-products.tsx` (Turn off on the products page)

- [ ] **Step 1: Orders page.** `orders/page.tsx` mirrors `projects/page.tsx` (`requireSession()`, then `<OrdersList teamSlug={storeSlug} />`). `orders-list.tsx` mirrors `projects-list.tsx`: heading "Orders" with the team link above, `useQuery({ ...trpc.order.list.queryOptions({ teamSlug }), retry: false })`, `Loader`, the error message in `role="alert"` (a freelancer sees "Only an admin can see orders."), an empty state "No orders yet. They show up here once a buyer pays.", and a `ul.divide-y` of rows: product title, buyer email, `formatMinor(amountMinor, currency)`, "Paid {date}" or "Refunded {date}" (a `Badge`-like muted label for refunded). No row links (there is no order detail page in this run).

- [ ] **Step 2: Dashboard.** In the nav, after Products: `{settings?.storeEnabled ? <Link href={\`/${team.slug}/orders\`}>Orders</Link> : null}`. In the Store card, when the store is on: an "Open orders" link next to "Open products", and a "Turn off the store" outline button (admins only) that asks `window.confirm("Turn off the store? Your products leave your seller page and buyers can't check out until you turn it back on.")` and calls `setStoreEnabled({ teamSlug, enabled: false })`, invalidating `servicesTeam.get` and `seller.preview`. Same button at the bottom of the enabled products list in `digital-products.tsx`.

- [ ] **Step 3: Run** `pnpm check-types` (and `npx vitest run apps/web`). Pass.

- [ ] **Step 4: Commit** `feat(web): the orders list and turning the store off`.

---

### Task 10: Final review, merge, walkthrough (controller)

- [ ] **Step 1: Full verification** in the worktree: `npx vitest run` and `pnpm check-types`.
- [ ] **Step 2: Final whole-branch review** against this plan and design §5.2/§5.3/§7: money paths (amount from the database only, the secret check, the capture conflict rules, idempotent postings), grants (hash only, atomic decrement, revocation), refunds (both paths, ledger once per refund), the store switch everywhere, email never failing a capture, the webhook consumer's email wiring, tenancy on every query.
- [ ] **Step 3: Merge.** Migrate the dev database (`pnpm db:migrate:dev` from main after the merge), `git merge --no-ff` with a message file, `pnpm install`, restart the dev stack (kill the dev PIDs, `rm -rf apps/web/node_modules/.vite` in a foreground command, then `pnpm dev > /tmp/jendal-dev.log 2>&1` with fireAndForget; the tunnel keeps running), clear the browser cache over CDP, and grant Playwright `local-network-access` for the admin and store hosts.
- [ ] **Step 4: Walkthrough** over the tunnel (walk-crew is published, store on, "Icon pack" $19 published with `icon-pack.zip`):
  1. `walk-crew.payleor.app` → Buy on Icon pack → `/buy/{id}` shows the title, $19.00, the email field and the PayPal button. A bad email blocks the click with "That email address does not look right.".
  2. Enter `tester@example.com`, click PayPal, and **ask Mouhamed to pay in the sandbox popup**. The page lands on `/orders/{token}`: "Order from Walk Crew", Paid, Download, "5 downloads left".
  3. Download → the zip downloads (byte-identical to `/tmp/r4a-walk/icon-pack.zip`); the page shows 4 left.
  4. The buyer email arrives in the AgentMail inbox: from "Walk Crew via Payleor" `stores@…`, reply-to `walk-crew@example.com`, subject "Your download: Icon pack", link to `https://walk-crew.payleor.app/orders/…` (fetch the full message; URL-encode the message id).
  5. Use up the downloads (curl `order.download` four more times), then the page shows "no downloads left" and "Email me a new link" → "We sent a new link to t•@example.com", a second email arrives, its link works.
  6. Admin `/walk-crew/orders` lists the order (buyer, Icon pack, $19.00, Paid). The database has `order_paid` and `order_fees` postings for walk-crew, and the order's fees match PayPal's capture breakdown.
  7. Refund: refund the capture in the sandbox (ask Mouhamed to refund it from the walk-crew sandbox merchant account, or call `POST /v2/payments/captures/{id}/refund` with the partner credentials and the seller's auth assertion from a one-off script). The webhook marks the order refunded (`paypal_webhook_event` row `processed / refunded`), the order page says the order was refunded, Download is gone, and the ledger has `order_refunded:refund:{id}`. The admin list shows Refunded.
  8. Store switch: Turn off the store → the seller page has no Store section, `/buy/{id}` 404s, `checkout.start` via curl → NOT_FOUND "This product is not for sale.". Turn it back on.
- [ ] **Step 5: Record the outcome** in this plan, design §11 run 4 row (4b done) and §11.1 (close the Buy-links and store-switch rows; add new gaps), and `specs/README.md`.

### Out of scope

A refund button in Payleor, partial refunds that keep access, pending-order sweeping, product images, physical orders, the agent's `list_products`/buy tools (next phase), sales tax.

---

## Outcome

Merged into `main` as `60bed6c` on 2026-10-11 (1218 tests, check-types clean). Migration `20261010193741_r4b_orders` applied to the dev database.

Commits:
- `2bef5ef`: core.
- `e32c6f1` and `5077db1`: db. The fix makes the expiry test independent of revocation.
- `eab87c0` and `99cbead`: paypal. The fix stops the refund parser from throwing on unverified bodies.
- `d4bdc02`: email and the store origin.
- `08850fc` and `dc81e42`: checkout. The fixes read the team for the email inside the capture transaction, so a failure after commit cannot lose the email. The browser grant is issued under the order lock, and refunded captures get a clear refusal.
- `a16a5e8`: the order page and the admin list.
- `429e6a8` and `10ac82f`: order webhooks. The fixes retry when PayPal's lookup does not list the expected refund yet, net a reversal of earlier refunds, and add tests for email-once across paths.
- `7d6460d`: the checkout and order pages.
- `2e02c50` and `afa597e`: the admin orders list and turning the store on and off. The fix makes the switch refresh the publish status.
- `3742fdc`: final-review fixes. The Orders links show for admins only, and fees are still recorded after an early refund.

Deviations from the plan:
- `captureAndApply` is shared by the browser and webhook captures.
- `applyOrderRefund` takes the PayPal order the caller already fetched, plus the refund id it expects.
- `sendDownloadEmail` never throws and returns whether the email went out. `sendNewOrderLink` fails when it returns false.
- The order page reports a refunded order as revoked, whatever the grant row says. `download` checks the file before spending a download.
- The capture rate limit counts before the secret check (noted in §11.1).

Walkthrough on 2026-10-11 over the tunnel. Everything passed:
1. **Checkout page.** Buy on walk-crew's seller page opened `/buy/{id}` with Icon pack, $19.00, the email field and the PayPal button. A bad email showed "That email address does not look right.", marked the field invalid, focused it and opened no popup.
2. **Purchase.** With `tester@example.com`, the PayPal sandbox popup opened and Mouhamed paid. The page landed on `/orders/{token}`: "Order from Walk Crew", Icon pack, $19.00, Paid, Download, "5 downloads left · link works until 10/18/2026". The order was pending at $19.00 with a $0.19 fee before payment, then paid with capture `7PF4242403213591M`, PayPal fee $1.04 and Payleor fee $0.19.
3. **Download.** The file was byte-identical to the uploaded `icon-pack.zip` (same SHA-256), and the page showed 4 left. The ledger has `order_paid` (paypal_clearing −1900, team_revenue +1900) and `order_fees` (team_revenue −123, paypal_fees 104, payleor_fees 19). The webhooks agreed: COMPLETED was `already_applied` and APPROVED was `nothing to do`.
4. **Buyer email.** From "Walk Crew via Payleor" `<stores@payleor.com>`, reply-to `walk-crew@example.com`, subject "Your download: Icon pack", linking `https://walk-crew.payleor.app/orders/…` with its own token.
5. **Fresh link.** I used up the email link's 5 downloads by curl; the 6th answered "This link has no downloads left. Ask for a new one.". The page then showed that message with no Download button. "Email me a new link" answered "We sent a new link to t•@example.com.", a second email arrived, and its link showed 5 downloads.
6. **Admin.** The Orders link and "Open orders" show when the store is on. `/walk-crew/orders` lists Icon pack, the buyer, $19.00 and Paid.
7. **Refund.** A $5.00 partial refund through the API (partner credentials with the seller's auth assertion) returned refund `96J18915S7072594A` COMPLETED. The `PAYMENT.CAPTURE.REFUNDED` event recorded capture id `7PF4242403213591M` and was processed as `refunded`. The order is refunded, all 3 grants are revoked, and the ledger has `order_refunded:refund:96J18915S7072594A` (team_revenue −500, paypal_clearing +500). The order page now says "This order was refunded, so the download is no longer available." with no buttons, and the admin list shows "Refunded".
8. **Store switch.** "Turn off the store" asked for confirmation with the planned text. With the store off, the seller page had no Store section, `/buy/{id}` returned 404, and `checkout.start` answered "This product is not for sale.". Turning it back on restored all three.

walk-crew keeps the refunded test order. Because of the restrict foreign keys, Icon pack and walk-crew can only be deleted after deleting that order and its ledger rows.
