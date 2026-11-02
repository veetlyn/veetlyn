import type { BillingAccountSnapshot, PlanChoice, PolarSubscriptionStatus } from "@jendal-workspace/core";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { billingAccount, polarWebhookEvent } from "../schema/billing";
import { fileUpload } from "../schema/files";
import { team } from "../schema/organization";

export type BillingAccountRow = typeof billingAccount.$inferSelect;

const TRIAL_MS = 14 * 86_400_000;

export function billingSnapshot(row: BillingAccountRow): BillingAccountSnapshot {
  return {
    servicesTier: row.servicesTier,
    storeTier: row.storeTier,
    interval: row.interval,
    trialEndsAt: row.trialEndsAt,
    subscription:
      row.polarSubscriptionId && row.polarStatus
        ? { status: row.polarStatus, pastDueAt: row.pastDueAt, cancelAtPeriodEnd: row.cancelAtPeriodEnd, endsAt: row.endsAt }
        : null,
  };
}

export async function getBillingAccount(db: DbExecutor, organizationId: string): Promise<BillingAccountRow | null> {
  const [row] = await db.select().from(billingAccount).where(eq(billingAccount.organizationId, organizationId)).limit(1);
  return row ?? null;
}

// A team's workspace billing account, in one query; null for a team whose workspace has none.
export async function getBillingAccountForTeam(
  db: DbExecutor,
  teamId: string,
): Promise<{ account: BillingAccountRow; product: "store" | "services" } | null> {
  const [row] = await db
    .select({ account: billingAccount, product: team.product })
    .from(team)
    .innerJoin(billingAccount, eq(billingAccount.organizationId, team.organizationId))
    .where(eq(team.id, teamId))
    .limit(1);
  return row ?? null;
}

// Starts the trial the first time a workspace gets a team. Later teams only fill a tier the trial is missing:
// once a subscription exists, the plan changes through Polar.
export async function ensureBillingAccount(
  db: DbExecutor,
  input: { organizationId: string; product: "store" | "services"; solo: boolean; now: Date },
): Promise<void> {
  const servicesTier = input.product === "services" ? (input.solo ? "solo" : "team") : null;
  const storeTier = input.product === "store" ? "starter" : null;
  await db
    .insert(billingAccount)
    .values({ organizationId: input.organizationId, servicesTier, storeTier, trialEndsAt: new Date(input.now.getTime() + TRIAL_MS) })
    .onConflictDoUpdate({
      target: billingAccount.organizationId,
      set: {
        servicesTier: sql`coalesce(${billingAccount.servicesTier}, ${servicesTier})`,
        storeTier: sql`coalesce(${billingAccount.storeTier}, ${storeTier})`,
      },
      setWhere: isNull(billingAccount.polarSubscriptionId),
    });
}

export type SubscriptionSnapshot = PlanChoice & {
  organizationId: string;
  customerId: string;
  subscriptionId: string;
  productId: string;
  status: PolarSubscriptionStatus;
  pastDueAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  endsAt: Date | null;
  modifiedAt: Date;
};

// Applies a subscription as Polar last described it. Deliveries arrive out of order, so a snapshot older than the
// one stored changes nothing. Returns whether it was applied.
export async function applySubscriptionSnapshot(db: DbExecutor, snap: SubscriptionSnapshot): Promise<boolean> {
  const updated = await db
    .update(billingAccount)
    .set({
      servicesTier: snap.servicesTier,
      storeTier: snap.storeTier,
      interval: snap.interval,
      polarCustomerId: snap.customerId,
      polarSubscriptionId: snap.subscriptionId,
      polarProductId: snap.productId,
      polarStatus: snap.status,
      pastDueAt: snap.pastDueAt,
      currentPeriodEnd: snap.currentPeriodEnd,
      cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
      endsAt: snap.endsAt,
      polarModifiedAt: snap.modifiedAt,
    })
    .where(
      and(
        eq(billingAccount.organizationId, snap.organizationId),
        or(isNull(billingAccount.polarModifiedAt), lt(billingAccount.polarModifiedAt, snap.modifiedAt)),
      ),
    )
    .returning({ organizationId: billingAccount.organizationId });
  return updated.length > 0;
}

// True the first time a webhook id is seen; a redelivery returns false.
export async function recordPolarWebhookEvent(db: DbExecutor, input: { id: string; type: string }): Promise<boolean> {
  const inserted = await db.insert(polarWebhookEvent).values(input).onConflictDoNothing().returning({ id: polarWebhookEvent.id });
  return inserted.length > 0;
}

// Bytes a team stores: every upload row, attached or not yet swept.
export async function teamStorageBytes(db: DbExecutor, teamId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${fileUpload.sizeBytes}), 0)` })
    .from(fileUpload)
    .where(eq(fileUpload.teamId, teamId));
  return Number(row?.total ?? 0);
}
