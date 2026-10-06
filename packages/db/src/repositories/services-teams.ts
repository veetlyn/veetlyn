import {
  effectiveServicesTeamRole,
  hasStoreWideRole,
  type ServicesTeamRecord,
  type ServicesTeamRole,
  type ServicesTeamSettings,
  type ServicesTeamSettingsInput,
} from "@jendal-workspace/core";
import { and, eq } from "drizzle-orm";

import type { Database } from "../index";
import { user } from "../schema/auth";
import { member, organization, team } from "../schema/organization";
import { servicesTeamMember, servicesTeamSettings } from "../schema/services-teams";

const servicesTeamColumns = {
  id: team.id,
  organizationId: team.organizationId,
  slug: team.slug,
  name: team.name,
  paypalMerchantId: team.paypalMerchantId,
};

// Listed explicitly so columns added by later plans do not change what these functions return.
const settingsColumns = {
  teamId: servicesTeamSettings.teamId,
  currency: servicesTeamSettings.currency,
  teamCutBps: servicesTeamSettings.teamCutBps,
  managementFeeBps: servicesTeamSettings.managementFeeBps,
  quotingMode: servicesTeamSettings.quotingMode,
  payoutMode: servicesTeamSettings.payoutMode,
  settingsSavedAt: servicesTeamSettings.settingsSavedAt,
};

export async function findServicesTeamBySlug(db: Database, slug: string): Promise<ServicesTeamRecord | null> {
  const [row] = await db
    .select(servicesTeamColumns)
    .from(team)
    .where(and(eq(team.slug, slug), eq(team.product, "services")))
    .limit(1);
  return row ?? null;
}

export async function getServicesTeamSettings(db: Database, teamId: string): Promise<ServicesTeamSettings | null> {
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
  db: Database,
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
  // True when the role comes from being a workspace owner or admin; such a role cannot be changed here.
  workspaceAdmin: boolean;
};

export async function listServicesTeamMembers(
  db: Database,
  servicesTeam: Pick<ServicesTeamRecord, "id" | "organizationId">,
): Promise<ServicesTeamMemberRow[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      workspaceRole: member.role,
      teamRole: servicesTeamMember.role,
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
