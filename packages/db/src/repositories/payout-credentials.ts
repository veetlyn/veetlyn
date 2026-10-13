import { eq } from "drizzle-orm";

import type { DbExecutor, Transaction } from "../executor";
import { payoutConnectAttempt, teamPayoutCredentials } from "../schema/payouts";

export type PayoutConnectAttemptRow = typeof payoutConnectAttempt.$inferSelect;

export async function insertPayoutConnectAttempt(
  db: DbExecutor,
  input: Pick<typeof payoutConnectAttempt.$inferInsert, "id" | "teamId" | "sellerNonce" | "createdByUserId">,
): Promise<PayoutConnectAttemptRow> {
  const [row] = await db.insert(payoutConnectAttempt).values(input).returning();
  if (!row) throw new Error(`Insert into payout_connect_attempt returned no row for team ${input.teamId}`);
  return row;
}

export async function getPayoutConnectAttempt(db: DbExecutor, id: string): Promise<PayoutConnectAttemptRow | null> {
  const [row] = await db.select().from(payoutConnectAttempt).where(eq(payoutConnectAttempt.id, id)).limit(1);
  return row ?? null;
}

// Held while the credentials it produced are saved, so an attempt is used once.
export async function lockPayoutConnectAttempt(tx: Transaction, id: string): Promise<PayoutConnectAttemptRow | null> {
  const [row] = await tx
    .select()
    .from(payoutConnectAttempt)
    .where(eq(payoutConnectAttempt.id, id))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function markPayoutConnectAttemptUsed(tx: DbExecutor, id: string): Promise<void> {
  await tx.update(payoutConnectAttempt).set({ usedAt: new Date() }).where(eq(payoutConnectAttempt.id, id));
}

export type TeamPayoutCredentialsRow = typeof teamPayoutCredentials.$inferSelect;
export type TeamPayoutCredentialsInput = Pick<
  typeof teamPayoutCredentials.$inferInsert,
  "teamId" | "clientId" | "secretCiphertext" | "secretIv" | "keyId" | "paypalAccountId" | "verifiedAt" | "canReadBalance"
>;

export async function getTeamPayoutCredentials(db: DbExecutor, teamId: string): Promise<TeamPayoutCredentialsRow | null> {
  const [row] = await db
    .select()
    .from(teamPayoutCredentials)
    .where(eq(teamPayoutCredentials.teamId, teamId))
    .limit(1);
  return row ?? null;
}

// Replacing or removing the credentials holds this lock while it re-checks for payouts in progress, so no send can be
// claimed in between. Null when the team has none (nothing is locked then).
export async function lockTeamPayoutCredentials(tx: Transaction, teamId: string): Promise<TeamPayoutCredentialsRow | null> {
  const [row] = await tx
    .select()
    .from(teamPayoutCredentials)
    .where(eq(teamPayoutCredentials.teamId, teamId))
    .limit(1)
    .for("update");
  return row ?? null;
}

// A send claim takes this in the transaction that moves a request to `sending`: it waits for a replacement in
// progress, and a replacement after it sees the request as in progress.
export async function lockTeamPayoutCredentialsForSend(
  tx: Transaction,
  teamId: string,
): Promise<TeamPayoutCredentialsRow | null> {
  const [row] = await tx
    .select()
    .from(teamPayoutCredentials)
    .where(eq(teamPayoutCredentials.teamId, teamId))
    .limit(1)
    .for("share");
  return row ?? null;
}

export async function hasTeamPayoutCredentials(db: DbExecutor, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ teamId: teamPayoutCredentials.teamId })
    .from(teamPayoutCredentials)
    .where(eq(teamPayoutCredentials.teamId, teamId))
    .limit(1);
  return row !== undefined;
}

export async function saveTeamPayoutCredentials(
  db: DbExecutor,
  input: TeamPayoutCredentialsInput,
): Promise<TeamPayoutCredentialsRow> {
  const { teamId, ...values } = input;
  const [row] = await db
    .insert(teamPayoutCredentials)
    .values(input)
    .onConflictDoUpdate({ target: teamPayoutCredentials.teamId, set: { ...values, updatedAt: new Date() } })
    .returning();
  if (!row) throw new Error(`Upsert into team_payout_credentials returned no row for team ${teamId}`);
  return row;
}

export async function deleteTeamPayoutCredentials(db: DbExecutor, teamId: string): Promise<void> {
  await db.delete(teamPayoutCredentials).where(eq(teamPayoutCredentials.teamId, teamId));
}
