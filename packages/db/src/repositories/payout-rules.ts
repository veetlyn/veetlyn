import { presetRules, type PayoutRules } from "@jendal-workspace/core";
import { asc, eq } from "drizzle-orm";

import type { DbExecutor } from "../executor";
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
};

// A team without a rules row follows the manual preset.
export async function getPayoutRules(db: DbExecutor, teamId: string): Promise<PayoutRules> {
  const [row] = await db.select(rulesColumns).from(teamPayoutRules).where(eq(teamPayoutRules.teamId, teamId)).limit(1);
  const trusted = await db
    .select({ userId: teamPayoutTrustedMember.userId })
    .from(teamPayoutTrustedMember)
    .where(eq(teamPayoutTrustedMember.teamId, teamId))
    .orderBy(asc(teamPayoutTrustedMember.userId));
  return { ...(row ?? presetRules("manual")), trustedMemberIds: trusted.map((t) => t.userId) };
}

export async function savePayoutRules(db: DbExecutor, teamId: string, rules: PayoutRules): Promise<void> {
  const { trustedMemberIds, ...settings } = rules;
  await db.transaction(async (tx) => {
    await tx
      .insert(teamPayoutRules)
      .values({ teamId, ...settings })
      .onConflictDoUpdate({ target: teamPayoutRules.teamId, set: settings });
    await tx.delete(teamPayoutTrustedMember).where(eq(teamPayoutTrustedMember.teamId, teamId));
    const userIds = [...new Set(trustedMemberIds)];
    if (userIds.length > 0) {
      await tx.insert(teamPayoutTrustedMember).values(userIds.map((userId) => ({ teamId, userId })));
    }
  });
}

export async function listTeamsPayingCompletedProjects(db: DbExecutor): Promise<string[]> {
  const rows = await db
    .select({ teamId: teamPayoutRules.teamId })
    .from(teamPayoutRules)
    .where(eq(teamPayoutRules.payCompletedProjects, true))
    .orderBy(asc(teamPayoutRules.teamId));
  return rows.map((row) => row.teamId);
}
