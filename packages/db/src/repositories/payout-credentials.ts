import { eq } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { teamPayoutCredentials } from "../schema/payouts";

export type TeamPayoutCredentialsRow = typeof teamPayoutCredentials.$inferSelect;
export type TeamPayoutCredentialsInput = Pick<
  typeof teamPayoutCredentials.$inferInsert,
  "teamId" | "clientId" | "secretCiphertext" | "secretIv" | "keyId" | "paypalAccountId" | "verifiedAt"
>;

export async function getTeamPayoutCredentials(db: DbExecutor, teamId: string): Promise<TeamPayoutCredentialsRow | null> {
  const [row] = await db
    .select()
    .from(teamPayoutCredentials)
    .where(eq(teamPayoutCredentials.teamId, teamId))
    .limit(1);
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
