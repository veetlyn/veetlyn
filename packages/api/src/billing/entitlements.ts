import { TRPCError } from "@trpc/server";
import { type BillingAccountSnapshot, type Entitlements, entitlementsFor } from "@jendal-workspace/core";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import { billingSnapshot, getBillingAccountForTeam, teamTrialBasis } from "@jendal-workspace/db/repositories/billing";

const TRIAL_MS = 14 * 86_400_000;

export type TeamEntitlements = { product: "store" | "services"; entitlements: Entitlements };

// Billing design §4: what a team's workspace may do, and its fees. Every workspace gets a billing account when its
// first team is created (and existing ones by the migration); a team without one is treated as that first trial,
// computed here rather than written during a read.
export async function teamEntitlements(db: DbExecutor, teamId: string, now: Date = new Date()): Promise<TeamEntitlements> {
  const found = await getBillingAccountForTeam(db, teamId);
  if (found) return { product: found.product, entitlements: entitlementsFor(billingSnapshot(found.account), now) };
  const team = await teamTrialBasis(db, teamId);
  if (!team) throw new Error(`Team ${teamId} not found`);
  const snapshot: BillingAccountSnapshot = {
    servicesTier: team.product === "services" ? (team.solo ? "solo" : "team") : null,
    storeTier: team.product === "store" ? "starter" : null,
    interval: "monthly",
    trialEndsAt: new Date(team.createdAt.getTime() + TRIAL_MS),
    subscription: null,
  };
  return { product: team.product, entitlements: entitlementsFor(snapshot, now) };
}

// The fee follows the team that sells: a store team's orders take its store plan's fee; a services team's project
// payments and digital products take its services plan's fee (pricing proposal: digital products come with every
// seller plan). Null when the workspace has no plan for that product.
export function platformFeeBps({ product, entitlements }: TeamEntitlements): number | null {
  return product === "store" ? entitlements.storeFeeBps : entitlements.servicesFeeBps;
}

// Clients and shoppers read this; it never mentions the seller's billing (billing design §6).
const NOT_SELLING = "This seller is not taking payments right now.";

// The fee a new sale takes. Refused when the workspace has lapsed or its plan does not cover what this team sells;
// paid work, deliveries and refunds never come through here.
export async function saleFeeBps(db: DbExecutor, teamId: string): Promise<number> {
  const team = await teamEntitlements(db, teamId);
  const fee = platformFeeBps(team);
  if (fee === null || !team.entitlements.canSell) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOT_SELLING });
  return fee;
}

// For steps that commit the client to paying (accepting a quote or an amendment) before any payment starts.
export async function requireCanSell(db: DbExecutor, teamId: string): Promise<void> {
  await saleFeeBps(db, teamId);
}
