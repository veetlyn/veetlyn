import type { StoreRecord } from "@jendal-workspace/core";
import { and, eq } from "drizzle-orm";

import type { Database } from "../index";
import { member, team, teamMember } from "../schema/organization";

const teamColumns = {
  id: team.id,
  organizationId: team.organizationId,
  slug: team.slug,
  name: team.name,
  status: team.status,
  paypalMerchantId: team.paypalMerchantId,
};

export type TeamAccessRow = { team: StoreRecord; role: string; isTeamMember: boolean };

// Null when the team does not exist or the user is not a member of its organization.
// Same access shape as findStoreAccess, keyed by team id instead of slug.
export async function findTeamAccess(
  db: Database,
  input: { teamId: string; userId: string },
): Promise<TeamAccessRow | null> {
  const [row] = await db
    .select({ ...teamColumns, role: member.role, teamMemberId: teamMember.id })
    .from(team)
    .innerJoin(member, and(eq(member.organizationId, team.organizationId), eq(member.userId, input.userId)))
    .leftJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, input.userId)))
    .where(eq(team.id, input.teamId))
    .limit(1);
  if (!row) return null;
  const { role, teamMemberId, ...teamRecord } = row;
  return { team: teamRecord, role, isTeamMember: teamMemberId !== null };
}

export async function findTeamById(db: Database, teamId: string): Promise<StoreRecord | null> {
  const [row] = await db.select(teamColumns).from(team).where(eq(team.id, teamId)).limit(1);
  return row ?? null;
}

export async function findTeamSlug(db: Database, teamId: string): Promise<string | null> {
  const [row] = await db.select({ slug: team.slug }).from(team).where(eq(team.id, teamId)).limit(1);
  return row?.slug ?? null;
}
