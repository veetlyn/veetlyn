import type { BillingAccountSnapshot, PlanChoice, PolarSubscriptionStatus } from "@jendal-workspace/core";
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { billingAccount, polarWebhookEvent } from "../schema/billing";
import { fileUpload } from "../schema/files";
import { member, team } from "../schema/organization";
import { servicesTeamMember, servicesTeamSettings } from "../schema/services-teams";

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

// Serializes checkout and plan changes for a workspace across requests and Worker instances.
export async function lockBillingAccount(db: DbExecutor, organizationId: string): Promise<BillingAccountRow | null> {
  const [row] = await db.select().from(billingAccount).where(eq(billingAccount.organizationId, organizationId)).for("update");
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

// What a team without a billing account needs for its implied first trial.
export async function teamTrialBasis(
  db: DbExecutor,
  teamId: string,
): Promise<{ product: "store" | "services"; createdAt: Date; solo: boolean } | null> {
  const [row] = await db
    .select({ product: team.product, createdAt: team.createdAt, solo: servicesTeamSettings.solo })
    .from(team)
    .leftJoin(servicesTeamSettings, eq(servicesTeamSettings.teamId, team.id))
    .where(eq(team.id, teamId))
    .limit(1);
  return row ? { product: row.product, createdAt: row.createdAt, solo: row.solo ?? false } : null;
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

// A "Just me" seller's trial runs on Solo; the plan changes through Polar once a subscription exists.
export async function useSoloTrialTier(db: DbExecutor, organizationId: string): Promise<void> {
  await db
    .update(billingAccount)
    .set({ servicesTier: "solo" })
    .where(and(eq(billingAccount.organizationId, organizationId), isNull(billingAccount.polarSubscriptionId)));
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
      // If Polar omits its optional past_due_at, use the first snapshot's time. Retain it through the same delinquency;
      // a successful renewal clears it so a later failed renewal gets a fresh grace period.
      pastDueAt: snap.status === "past_due"
        ? sql`case when ${billingAccount.polarStatus} = 'past_due' and ${billingAccount.polarSubscriptionId} = ${snap.subscriptionId}
            then coalesce(${billingAccount.pastDueAt}, ${(snap.pastDueAt ?? snap.modifiedAt).toISOString()}::timestamptz)
            else ${(snap.pastDueAt ?? snap.modifiedAt).toISOString()}::timestamptz end`
        : null,
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

// Keyset pages ensure an unchanged subscription cannot keep later accounts out of the reconciliation sweep.
export async function billingAccountsToReconcile(db: DbExecutor, input: { before: Date; afterOrganizationId: string; limit: number }) {
  return db.select().from(billingAccount).where(and(
    isNotNull(billingAccount.polarSubscriptionId),
    gt(billingAccount.organizationId, input.afterOrganizationId),
    or(eq(billingAccount.polarStatus, "past_due"), isNull(billingAccount.polarModifiedAt), lt(billingAccount.polarModifiedAt, input.before)),
  )).orderBy(billingAccount.organizationId).limit(input.limit);
}

export async function countWorkspaceTeams(db: DbExecutor, organizationId: string, product: "store" | "services"): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(team)
    .where(and(eq(team.organizationId, organizationId), eq(team.product, product)));
  return row?.n ?? 0;
}

// People holding a services seat in a workspace: its owners and admins (admins of every services team) plus anyone on
// one of its services teams, each counted once. Whether the given user already holds one comes back too.
export async function servicesSeats(
  db: DbExecutor,
  input: { organizationId: string; userId: string },
): Promise<{ used: number; holdsSeat: boolean }> {
  const rows = await db.execute<{ user_id: string }>(sql`
    select ${member.userId} as user_id from ${member}
      where ${member.organizationId} = ${input.organizationId}
        and (${member.role} like '%owner%' or ${member.role} like '%admin%')
    union
    select ${servicesTeamMember.userId} from ${servicesTeamMember}
      join ${team} on ${team.id} = ${servicesTeamMember.teamId}
      where ${team.organizationId} = ${input.organizationId}`);
  const ids = new Set(rows.map((r) => r.user_id));
  return { used: ids.size, holdsSeat: ids.has(input.userId) };
}

// A team (store or services) by slug, with the caller's workspace role; null when they are not in its workspace.
export async function teamWorkspaceForUser(
  db: DbExecutor,
  input: { slug: string; userId: string },
): Promise<{ teamId: string; organizationId: string; role: string } | null> {
  const [row] = await db
    .select({ teamId: team.id, organizationId: team.organizationId, role: member.role })
    .from(team)
    .innerJoin(member, and(eq(member.organizationId, team.organizationId), eq(member.userId, input.userId)))
    .where(eq(team.slug, input.slug))
    .limit(1);
  return row ?? null;
}

export async function countWorkspaceMembers(db: DbExecutor, organizationId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(member).where(eq(member.organizationId, organizationId));
  return row?.n ?? 0;
}

// Bytes a team's workspace stores across all its teams: every upload row, attached or not yet swept, so an upload
// in flight counts against the limit.
export async function workspaceStorageBytes(db: DbExecutor, teamId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${fileUpload.sizeBytes}), 0)` })
    .from(fileUpload)
    .innerJoin(team, eq(team.id, fileUpload.teamId))
    .where(eq(team.organizationId, sql`(select ${team.organizationId} from ${team} where ${team.id} = ${teamId})`));
  return Number(row?.total ?? 0);
}
