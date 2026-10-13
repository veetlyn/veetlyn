import { presetRules, type PayoutRules } from "@jendal-workspace/core";
import { asc, eq } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { team } from "../schema/organization";
import { teamPayoutRules, teamPayoutTrustedMember } from "../schema/payouts";

const rulesColumns = {
  preset: teamPayoutRules.preset,
  autoApproveUpToMinor: teamPayoutRules.autoApproveUpToMinor,
  autoApproveScope: teamPayoutRules.autoApproveScope,
  trustedScope: teamPayoutRules.trustedScope,
  secondApproverAboveMinor: teamPayoutRules.secondApproverAboveMinor,
  secondApproverScope: teamPayoutRules.secondApproverScope,
  payCompletedProjects: teamPayoutRules.payCompletedProjects,
  holdDays: teamPayoutRules.holdDays,
  payday: teamPayoutRules.payday,
  paydayWeekday: teamPayoutRules.paydayWeekday,
  paydayMonthDay: teamPayoutRules.paydayMonthDay,
  balanceFloorMinor: teamPayoutRules.balanceFloorMinor,
  minimumPayoutMinor: teamPayoutRules.minimumPayoutMinor,
  payCompletedProjectsSince: teamPayoutRules.payCompletedProjectsSince,
};

// The rules with when paying completed projects was turned on: set exactly while it is on.
export type StoredPayoutRules = PayoutRules & { payCompletedProjectsSince: Date | null };

// A team without a rules row follows the manual preset.
export async function getPayoutRules(db: DbExecutor, teamId: string): Promise<StoredPayoutRules> {
  const [row] = await db.select(rulesColumns).from(teamPayoutRules).where(eq(teamPayoutRules.teamId, teamId)).limit(1);
  const trusted = await db
    .select({ userId: teamPayoutTrustedMember.userId })
    .from(teamPayoutTrustedMember)
    .where(eq(teamPayoutTrustedMember.teamId, teamId))
    .orderBy(asc(teamPayoutTrustedMember.userId));
  return {
    ...(row ?? { ...presetRules("manual"), payCompletedProjectsSince: null }),
    trustedMemberIds: trusted.map((t) => t.userId),
  };
}

export async function savePayoutRules(db: DbExecutor, teamId: string, rules: StoredPayoutRules): Promise<void> {
  const { trustedMemberIds, ...settings } = rules;
  await db.transaction(async (tx) => {
    await tx
      .insert(teamPayoutRules)
      .values({ teamId, ...settings })
      // $onUpdate only fires on db.update(), so the upsert sets the timestamp itself.
      .onConflictDoUpdate({ target: teamPayoutRules.teamId, set: { ...settings, updatedAt: new Date() } });
    await tx.delete(teamPayoutTrustedMember).where(eq(teamPayoutTrustedMember.teamId, teamId));
    const userIds = [...new Set(trustedMemberIds)];
    if (userIds.length > 0) {
      await tx.insert(teamPayoutTrustedMember).values(userIds.map((userId) => ({ teamId, userId })));
    }
  });
}

export type TeamPayingCompletedProjects = { id: string; name: string; paypalMerchantId: string | null };

export async function listTeamsPayingCompletedProjects(db: DbExecutor): Promise<TeamPayingCompletedProjects[]> {
  return db
    .select({ id: team.id, name: team.name, paypalMerchantId: team.paypalMerchantId })
    .from(teamPayoutRules)
    .innerJoin(team, eq(team.id, teamPayoutRules.teamId))
    .where(eq(teamPayoutRules.payCompletedProjects, true))
    .orderBy(asc(teamPayoutRules.teamId));
}
