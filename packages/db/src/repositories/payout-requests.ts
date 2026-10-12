import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";

import type { DbExecutor, Transaction } from "../executor";
import { user } from "../schema/auth";
import { team } from "../schema/organization";
import { PAYOUT_REQUEST_OPEN_WHERE, payoutRequest } from "../schema/payouts";

export type PayoutRequestRow = typeof payoutRequest.$inferSelect;
export type NewPayoutRequest = Pick<
  typeof payoutRequest.$inferInsert,
  "id" | "teamId" | "userId" | "currency" | "amountMinor" | "receiverPayerId"
>;
export type PayoutRequestPatch = Partial<
  Pick<
    typeof payoutRequest.$inferInsert,
    | "status"
    | "sendAttempt"
    | "paypalBatchId"
    | "paypalItemId"
    | "paypalItemStatus"
    | "feeEstimateMinor"
    | "sentMinor"
    | "feeMinor"
    | "failureMessage"
    | "reviewReason"
    | "uncertainAt"
    | "decidedByUserId"
    | "decidedAt"
    | "sentAt"
    | "settledAt"
    | "updatedAt"
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

// Least recently checked first: every check rewrites the row (or touches it), so a sweep with a limit moves on to
// the others instead of rereading the same requests while they stay pending.
export async function listSentPayoutRequests(
  db: DbExecutor,
  input: { sentBefore: Date; limit: number },
): Promise<PayoutRequestRow[]> {
  return db
    .select()
    .from(payoutRequest)
    .where(and(eq(payoutRequest.status, "sent"), lt(payoutRequest.sentAt, input.sentBefore)))
    .orderBy(asc(payoutRequest.updatedAt), asc(payoutRequest.id))
    .limit(input.limit);
}

// Moves a sent request to the back of the settle sweep. Only `sent` rows: on a `sending` row updated_at names the
// current send claim.
export async function touchSentPayoutRequest(db: DbExecutor, id: string): Promise<void> {
  await db
    .update(payoutRequest)
    .set({ updatedAt: new Date() })
    .where(and(eq(payoutRequest.id, id), eq(payoutRequest.status, "sent")));
}

// A payout PayPal may be working on with the team's current credentials.
export async function hasActivePayoutSend(db: DbExecutor, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: payoutRequest.id })
    .from(payoutRequest)
    .where(and(eq(payoutRequest.teamId, teamId), inArray(payoutRequest.status, ["sending", "sent"])))
    .limit(1);
  return row !== undefined;
}
