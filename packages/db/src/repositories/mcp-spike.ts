import { and, desc, eq, ilike, lte, or, type SQL } from "drizzle-orm";

import type { Database } from "../index";
import { user } from "../schema/auth";
import { member, team } from "../schema/organization";
import { payment, project } from "../schema/projects";
import { servicesOffering } from "../schema/services-catalog";

const offeringColumns = {
  id: servicesOffering.id,
  name: servicesOffering.name,
  description: servicesOffering.description,
  priceMinMinor: servicesOffering.priceMinMinor,
  priceMaxMinor: servicesOffering.priceMaxMinor,
  daysMin: servicesOffering.daysMin,
  daysMax: servicesOffering.daysMax,
  intakeQuestions: servicesOffering.intakeQuestions,
  seller: team.name,
  slug: team.slug,
};

export type ListedOffering = Awaited<ReturnType<typeof searchListedOfferings>>[number];

// Offerings of published sellers; a word of the query matches the name or the description.
export async function searchListedOfferings(
  db: Database,
  input: { words: string[]; maxPriceMinor?: number; maxDays?: number },
) {
  const wordFilters: SQL[] = input.words.flatMap((word) => [
    ilike(servicesOffering.name, `%${word}%`),
    ilike(servicesOffering.description, `%${word}%`),
  ]);
  return db
    .select(offeringColumns)
    .from(servicesOffering)
    .innerJoin(team, eq(team.id, servicesOffering.teamId))
    .where(
      and(
        eq(servicesOffering.active, true),
        eq(team.status, "active"),
        wordFilters.length ? or(...wordFilters) : undefined,
        input.maxPriceMinor === undefined ? undefined : lte(servicesOffering.priceMinMinor, input.maxPriceMinor),
        input.maxDays === undefined ? undefined : lte(servicesOffering.daysMin, input.maxDays),
      ),
    )
    .orderBy(servicesOffering.priceMinMinor)
    .limit(8);
}

export async function findListedOffering(db: Database, offeringId: string): Promise<ListedOffering | null> {
  const [row] = await db
    .select(offeringColumns)
    .from(servicesOffering)
    .innerJoin(team, eq(team.id, servicesOffering.teamId))
    .where(and(eq(servicesOffering.id, offeringId), eq(servicesOffering.active, true), eq(team.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function findUserIdentity(db: Database, userId: string) {
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}

// A member of the workspace that owns the team, whatever their team membership.
export async function isMemberOfTeamWorkspace(db: Database, input: { teamId: string; userId: string }) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(team, eq(team.organizationId, member.organizationId))
    .where(and(eq(team.id, input.teamId), eq(member.userId, input.userId)))
    .limit(1);
  return Boolean(row);
}

export async function listClientProjects(db: Database, clientEmail: string) {
  return db
    .select({
      id: project.id,
      teamId: project.teamId,
      title: project.title,
      status: project.status,
      currency: project.currency,
      createdAt: project.createdAt,
      brief: project.brief,
      seller: team.name,
    })
    .from(project)
    .innerJoin(team, eq(team.id, project.teamId))
    .where(eq(project.clientEmail, clientEmail))
    .orderBy(desc(project.updatedAt))
    .limit(20);
}

export async function findClientProject(db: Database, input: { projectId: string; clientEmail: string }) {
  const [row] = await db
    .select({ id: project.id, teamId: project.teamId, seller: team.name, slug: team.slug })
    .from(project)
    .innerJoin(team, eq(team.id, project.teamId))
    .where(and(eq(project.id, input.projectId), eq(project.clientEmail, input.clientEmail)))
    .limit(1);
  return row ?? null;
}

export async function hasPendingPayment(db: Database, projectId: string) {
  const [row] = await db
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.projectId, projectId), eq(payment.status, "pending")))
    .limit(1);
  return Boolean(row);
}
