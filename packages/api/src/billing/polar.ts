import { type BillingProduct, parsePolarProductKey, type PolarSubscriptionStatus } from "@jendal-workspace/core";
import type { SubscriptionSnapshot } from "@jendal-workspace/db/repositories/billing";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { z } from "zod";

// Billing design §1: Polar's API and webhooks are pinned to 2026-10 (Current until early 2027). Upgrade between
// January and March 2027, before 2026-10 is removed in April.
export type PolarClient = ReturnType<typeof createPolar>;
export type PolarServer = "sandbox" | "production";

// The product metadata key that carries the plan choice (core polarProductKey).
export const PRODUCT_KEY_FIELD = "plan_key";

export function createPolarClient(input: { accessToken: string; server: PolarServer }): PolarClient {
  return createPolar({ accessToken: input.accessToken, environment: input.server });
}

const STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const satisfies readonly PolarSubscriptionStatus[];

const metadata = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type PolarMetadata = z.infer<typeof metadata>;

// The parts of a Polar subscription (API 2026-10) the snapshot reads, parsed at the boundary: webhook bodies and
// API answers both pass through here.
export const polarSubscription = z.object({
  id: z.string().min(1),
  status: z.enum(STATUSES),
  customer_id: z.string().min(1),
  product_id: z.string().min(1),
  past_due_at: z.iso.datetime({ offset: true }).nullish(),
  current_period_end: z.iso.datetime({ offset: true }).nullable(),
  cancel_at_period_end: z.boolean(),
  ends_at: z.iso.datetime({ offset: true }).nullable(),
  modified_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  metadata,
  customer: z.object({ external_id: z.string().nullable() }),
  product: z.object({ metadata }),
});
export type PolarSubscriptionLike = z.infer<typeof polarSubscription>;

const date = (value: string | null | undefined) => (value ? new Date(value) : null);

export function productKeyOf(fields: PolarMetadata): string | null {
  const key = z.string().safeParse(fields[PRODUCT_KEY_FIELD]);
  return key.success ? key.data : null;
}

// The workspace a subscription belongs to: the customer's external id, set at checkout to the organization id.
// Null when it is not a subscription to one of our plans. Callers parse the SDK's webhook or API answer through
// polarSubscription: SDK types alone do not validate incoming JSON.
export function subscriptionSnapshot(sub: PolarSubscriptionLike): SubscriptionSnapshot | null {
  const fromMetadata = z.string().safeParse(sub.metadata.organization_id);
  const organizationId = sub.customer.external_id ?? (fromMetadata.success ? fromMetadata.data : null);
  const key = productKeyOf(sub.product.metadata);
  const choice = key ? parsePolarProductKey(key) : null;
  const status = z.enum(STATUSES).safeParse(sub.status);
  if (!organizationId || !choice || !status.success) return null;
  return {
    ...choice,
    organizationId,
    customerId: sub.customer_id,
    subscriptionId: sub.id,
    productId: sub.product_id,
    status: status.data,
    pastDueAt: date(sub.past_due_at),
    currentPeriodEnd: date(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    endsAt: date(sub.ends_at),
    modifiedAt: new Date(sub.modified_at ?? sub.created_at),
  };
}

// A Polar product as the catalog sync compares it.
export type CatalogProduct = {
  id: string;
  key: string | null;
  isArchived: boolean;
  recurringInterval: string | null;
  // Fixed USD price in cents, or null when the product has no single fixed USD price.
  priceCents: number | null;
};

export type CatalogChange =
  | { kind: "create"; product: BillingProduct }
  | { kind: "replace"; product: BillingProduct; archiveId: string; fromCents: number | null }
  | { kind: "archive"; id: string; key: string };

const POLAR_INTERVAL = { monthly: "month", yearly: "year" } as const;

// Billing design §3: what the sync must do so Polar has exactly one live product per plan choice at its price.
// Polar prices are immutable for existing subscribers, so a changed price archives the product and creates a new
// one; subscribers keep the old product until they change plan.
export function planCatalogChanges(existing: readonly CatalogProduct[], desired: readonly BillingProduct[]): CatalogChange[] {
  const live = existing.filter((p) => !p.isArchived && p.key !== null);
  const changes: CatalogChange[] = [];
  for (const product of desired) {
    const matches = live.filter((p) => p.key === product.key);
    const current = matches.find((p) => p.priceCents === product.chargeCents && p.recurringInterval === POLAR_INTERVAL[product.interval]);
    if (current) {
      for (const extra of matches) if (extra !== current) changes.push({ kind: "archive", id: extra.id, key: product.key });
      continue;
    }
    const [first, ...rest] = matches;
    if (first) changes.push({ kind: "replace", product, archiveId: first.id, fromCents: first.priceCents });
    else changes.push({ kind: "create", product });
    for (const extra of rest) changes.push({ kind: "archive", id: extra.id, key: product.key });
  }
  const wanted = new Set(desired.map((p) => p.key));
  for (const p of live) if (p.key !== null && !wanted.has(p.key)) changes.push({ kind: "archive", id: p.id, key: p.key });
  return changes;
}

export function polarInterval(product: BillingProduct): "month" | "year" {
  return POLAR_INTERVAL[product.interval];
}
