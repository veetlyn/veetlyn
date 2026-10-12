import { desc, eq } from "drizzle-orm";

import type { DbExecutor, Transaction } from "../executor";
import { user } from "../schema/auth";
import { team } from "../schema/organization";
import { PAYOUT_REQUEST_OPEN_WHERE, payoutRequest } from "../schema/payouts";

export type PayoutRequestRow = typeof payoutRequest.$inferSelect;
export type NewPayoutRequest = Pick<
  typeof payoutRequest.$inferInsert,
  "id" | "teamId" | "userId" | "currency" | "amountMinor" | "receiverPayerId" | "receiverEmail"
>;
export type PayoutRequestPatch = Partial<
  Pick<
    typeof payoutRequest.$inferInsert,
    "status" | "decidedByUserId" | "decidedAt" | "receivedMinor" | "paypalTransactionId" | "paidAt"
  >
>;
export type TeamPayoutRequestRow = PayoutRequestRow & { memberName: string; memberEmail: string };
export type UserPayoutRequestRow = PayoutRequestRow & { teamName: string; teamSlug: string };

// Null when the member already has an open request for this team. The conflict target names the partial unique
// index (same columns and predicate), so the refusal does not abort the caller's transaction.
export async function insertPayoutRequest(tx: DbExecutor, values: NewPayoutRequest): Promise<PayoutRequestRow | null> {
  const [row] = await tx
    .insert(payoutRequest)
    .values(values)
    .onConflictDoNothing({
      target: [payoutRequest.teamId, payoutRequest.userId],
      where: PAYOUT_REQUEST_OPEN_WHERE,
    })
    .returning();
  return row ?? null;
}

export async function getPayoutRequest(db: DbExecutor, id: string): Promise<PayoutRequestRow | null> {
  const [row] = await db.select().from(payoutRequest).where(eq(payoutRequest.id, id)).limit(1);
  return row ?? null;
}

// Holds the request until the transaction ends, so a status change and its ledger post happen once.
export async function lockPayoutRequest(tx: Transaction, id: string): Promise<PayoutRequestRow | null> {
  const [row] = await tx.select().from(payoutRequest).where(eq(payoutRequest.id, id)).limit(1).for("update");
  return row ?? null;
}

export async function updatePayoutRequest(tx: DbExecutor, id: string, patch: PayoutRequestPatch): Promise<PayoutRequestRow> {
  const [row] = await tx.update(payoutRequest).set(patch).where(eq(payoutRequest.id, id)).returning();
  if (!row) throw new Error(`Update of payout_request ${id} returned no row`);
  return row;
}

export async function listTeamPayoutRequests(db: DbExecutor, teamId: string): Promise<TeamPayoutRequestRow[]> {
  const rows = await db
    .select({ request: payoutRequest, memberName: user.name, memberEmail: user.email })
    .from(payoutRequest)
    .innerJoin(user, eq(user.id, payoutRequest.userId))
    .where(eq(payoutRequest.teamId, teamId))
    .orderBy(desc(payoutRequest.createdAt), desc(payoutRequest.id));
  return rows.map(({ request, memberName, memberEmail }) => ({ ...request, memberName, memberEmail }));
}

export async function listUserPayoutRequests(db: DbExecutor, userId: string): Promise<UserPayoutRequestRow[]> {
  const rows = await db
    .select({ request: payoutRequest, teamName: team.name, teamSlug: team.slug })
    .from(payoutRequest)
    .innerJoin(team, eq(team.id, payoutRequest.teamId))
    .where(eq(payoutRequest.userId, userId))
    .orderBy(desc(payoutRequest.createdAt), desc(payoutRequest.id));
  return rows.map(({ request, teamName, teamSlug }) => ({ ...request, teamName, teamSlug }));
}
