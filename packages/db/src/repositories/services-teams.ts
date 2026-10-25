import {
  effectiveServicesTeamRole,
  hasStoreWideRole,
  SOLO_MANAGEMENT_FEE_BPS,
  SOLO_TEAM_CUT_BPS,
  type ServicesTeamRecord,
  type ServicesTeamRole,
  type ServicesTeamSettings,
  type ServicesTeamSettingsInput,
} from "@jendal-workspace/core";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import type { Database } from "../index";
import { user } from "../schema/auth";
import { member, organization, team } from "../schema/organization";
import { servicesTeamMember, servicesTeamSettings } from "../schema/services-teams";

const servicesTeamColumns = {
  id: team.id,
  organizationId: team.organizationId,
  slug: team.slug,
  name: team.name,
  status: team.status,
  paypalMerchantId: team.paypalMerchantId,
};

// Listed explicitly so columns added by later plans do not change what these functions return.
const settingsColumns = {
  teamId: servicesTeamSettings.teamId,
  solo: servicesTeamSettings.solo,
  kind: servicesTeamSettings.kind,
  managerCutBps: servicesTeamSettings.managerCutBps,
  storeEnabled: servicesTeamSettings.storeEnabled,
  bio: servicesTeamSettings.bio,
  currency: servicesTeamSettings.currency,
  teamCutBps: servicesTeamSettings.teamCutBps,
  managementFeeBps: servicesTeamSettings.managementFeeBps,
  quotingMode: servicesTeamSettings.quotingMode,
  settingsSavedAt: servicesTeamSettings.settingsSavedAt,
  discordGuildId: servicesTeamSettings.discordGuildId,
};

export async function findServicesTeamBySlug(db: Database, slug: string): Promise<ServicesTeamRecord | null> {
  const [row] = await db
    .select(servicesTeamColumns)
    .from(team)
    .where(and(eq(team.slug, slug), eq(team.product, "services")))
    .limit(1);
  return row ?? null;
}

export async function getServicesTeamSettings(db: DbExecutor, teamId: string): Promise<ServicesTeamSettings | null> {
  const [row] = await db
    .select(settingsColumns)
    .from(servicesTeamSettings)
    .where(eq(servicesTeamSettings.teamId, teamId))
    .limit(1);
  return row ?? null;
}

export async function createServicesTeamSettings(db: Database, teamId: string): Promise<void> {
  await db.insert(servicesTeamSettings).values({ teamId }).onConflictDoNothing();
}

// Sellers design §3.1: a solo seller keeps the whole price. Written right after createTeam, which made the
// row with the team defaults; settings_saved_at stays null so the setup checklist still asks for the rates.
export async function applySoloTeamDefaults(db: Database, teamId: string): Promise<void> {
  const values = { solo: true, teamCutBps: SOLO_TEAM_CUT_BPS, managementFeeBps: SOLO_MANAGEMENT_FEE_BPS };
  await db
    .insert(servicesTeamSettings)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: servicesTeamSettings.teamId, set: values });
}

// Undoes a services team whose creation failed halfway. Only a team with no orders, projects or files
// can go: those references restrict the delete, and everything else cascades.
export async function deleteNewServicesTeam(db: Database, teamId: string): Promise<void> {
  await db.delete(team).where(and(eq(team.id, teamId), eq(team.product, "services")));
}

// A solo seller's workspace holds that seller alone (sellers design §3.1), so other teams go elsewhere.
export async function organizationsWithSoloSellers(db: Database, organizationIds: string[]): Promise<Set<string>> {
  if (organizationIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ organizationId: team.organizationId })
    .from(team)
    .innerJoin(servicesTeamSettings, eq(servicesTeamSettings.teamId, team.id))
    .where(and(inArray(team.organizationId, organizationIds), eq(servicesTeamSettings.solo, true)));
  return new Set(rows.map((row) => row.organizationId));
}

// The bio is not part of the rates, so saving it does not count as "Set your rates" for the checklist.
export async function saveServicesTeamBio(db: Database, teamId: string, bio: string): Promise<void> {
  const values = { bio };
  await db
    .insert(servicesTeamSettings)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: servicesTeamSettings.teamId, set: values });
}

// Sellers design §3.2: the store section of the seller page (run 4a) turns on and off on its own.
export async function setServicesTeamStoreEnabled(db: Database, teamId: string, enabled: boolean): Promise<void> {
  const values = { storeEnabled: enabled };
  await db
    .insert(servicesTeamSettings)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: servicesTeamSettings.teamId, set: values });
}

// Sellers design §3.1: a solo seller can become a team; the cut and the fee go back to the team defaults
// (1500/1000, the column defaults) unless the seller already set other rates.
export async function switchToTeam(db: Database, teamId: string): Promise<void> {
  await db
    .update(servicesTeamSettings)
    .set({
      solo: false,
      teamCutBps: sql`case when ${servicesTeamSettings.teamCutBps} = ${SOLO_TEAM_CUT_BPS} then 1500 else ${servicesTeamSettings.teamCutBps} end`,
      managementFeeBps: sql`case when ${servicesTeamSettings.managementFeeBps} = ${SOLO_MANAGEMENT_FEE_BPS} then 1000 else ${servicesTeamSettings.managementFeeBps} end`,
      // Rates a solo seller saved were never a team's choice, so the checklist asks the team to confirm them.
      settingsSavedAt: null,
    })
    .where(eq(servicesTeamSettings.teamId, teamId));
}

// Null clears the title; false when the user has no row in this team.
export async function setServicesTeamMemberTitle(
  db: Database,
  input: { teamId: string; userId: string; title: string | null },
): Promise<boolean> {
  const updated = await db
    .update(servicesTeamMember)
    .set({ title: input.title })
    .where(and(eq(servicesTeamMember.teamId, input.teamId), eq(servicesTeamMember.userId, input.userId)))
    .returning({ id: servicesTeamMember.id });
  return updated.length > 0;
}

// An upsert, so a team whose settings row is missing can still save.
export async function saveServicesTeamSettings(
  db: Database,
  teamId: string,
  input: ServicesTeamSettingsInput,
): Promise<ServicesTeamSettings> {
  const values = { ...input, settingsSavedAt: new Date() };
  const [row] = await db
    .insert(servicesTeamSettings)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: servicesTeamSettings.teamId, set: values })
    .returning(settingsColumns);
  if (!row) throw new Error("Upsert into services_team_settings returned no row");
  return row;
}

// Null when the team is not a services team, or the user is not in its organization or has no role in it.
export async function servicesTeamRoleFor(
  db: DbExecutor,
  teamId: string,
  userId: string,
): Promise<ServicesTeamRole | null> {
  const [row] = await db
    .select({ workspaceRole: member.role, teamRole: servicesTeamMember.role })
    .from(team)
    .innerJoin(member, and(eq(member.organizationId, team.organizationId), eq(member.userId, userId)))
    .leftJoin(servicesTeamMember, and(eq(servicesTeamMember.teamId, team.id), eq(servicesTeamMember.userId, userId)))
    .where(and(eq(team.id, teamId), eq(team.product, "services")))
    .limit(1);
  if (!row) return null;
  return effectiveServicesTeamRole(row.workspaceRole, row.teamRole);
}

export async function workspaceRoleFor(db: Database, organizationId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

export type UserSummary = { id: string; name: string; email: string };

// Better Auth stores emails in lowercase.
export async function findUserByEmail(db: Database, email: string): Promise<UserSummary | null> {
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export type ServicesTeamMemberRow = {
  userId: string;
  name: string;
  email: string;
  role: ServicesTeamRole;
  // Sellers design §4.1: a free-text label ("Brand designer") shown next to the member's name.
  title: string | null;
  // True when the role comes from being a workspace owner or admin; such a role cannot be changed here.
  workspaceAdmin: boolean;
};

export async function listServicesTeamMembers(
  db: DbExecutor,
  servicesTeam: Pick<ServicesTeamRecord, "id" | "organizationId">,
): Promise<ServicesTeamMemberRow[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      workspaceRole: member.role,
      teamRole: servicesTeamMember.role,
      title: servicesTeamMember.title,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      servicesTeamMember,
      and(eq(servicesTeamMember.teamId, servicesTeam.id), eq(servicesTeamMember.userId, member.userId)),
    )
    .where(eq(member.organizationId, servicesTeam.organizationId))
    .orderBy(user.name, user.id);

  return rows.flatMap(({ workspaceRole, teamRole, ...person }) => {
    const role = effectiveServicesTeamRole(workspaceRole, teamRole);
    return role ? [{ ...person, role, workspaceAdmin: hasStoreWideRole(workspaceRole) }] : [];
  });
}

// False when the user already has a row in this team.
export async function addServicesTeamMember(
  db: Database,
  input: { teamId: string; userId: string; role: ServicesTeamRole },
): Promise<boolean> {
  const inserted = await db
    .insert(servicesTeamMember)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoNothing({ target: [servicesTeamMember.teamId, servicesTeamMember.userId] })
    .returning({ id: servicesTeamMember.id });
  return inserted.length > 0;
}

// False when the user has no row in this team.
export async function setServicesTeamMemberRole(
  db: Database,
  input: { teamId: string; userId: string; role: ServicesTeamRole },
): Promise<boolean> {
  const updated = await db
    .update(servicesTeamMember)
    .set({ role: input.role })
    .where(and(eq(servicesTeamMember.teamId, input.teamId), eq(servicesTeamMember.userId, input.userId)))
    .returning({ id: servicesTeamMember.id });
  return updated.length > 0;
}

export type OrganizationServicesTeams = {
  organization: { id: string; name: string };
  role: string;
  servicesTeams: Array<{ team: ServicesTeamRecord; role: ServicesTeamRole }>;
};

// Every organization of the user, with the services teams they can open and their role in each.
export async function listOrganizationsWithServicesTeams(
  db: Database,
  userId: string,
): Promise<OrganizationServicesTeams[]> {
  const rows = await db
    .select({
      organizationId: organization.id,
      organizationName: organization.name,
      role: member.role,
      team: servicesTeamColumns,
      teamRole: servicesTeamMember.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .leftJoin(team, and(eq(team.organizationId, organization.id), eq(team.product, "services")))
    .leftJoin(servicesTeamMember, and(eq(servicesTeamMember.teamId, team.id), eq(servicesTeamMember.userId, userId)))
    .where(eq(member.userId, userId))
    .orderBy(organization.name, organization.id, team.name, team.id);

  const byOrganization = new Map<string, OrganizationServicesTeams>();
  for (const row of rows) {
    let entry = byOrganization.get(row.organizationId);
    if (!entry) {
      entry = { organization: { id: row.organizationId, name: row.organizationName }, role: row.role, servicesTeams: [] };
      byOrganization.set(row.organizationId, entry);
    }
    const role = row.team ? effectiveServicesTeamRole(row.role, row.teamRole) : null;
    if (row.team && role) entry.servicesTeams.push({ team: row.team, role });
  }
  return [...byOrganization.values()];
}
