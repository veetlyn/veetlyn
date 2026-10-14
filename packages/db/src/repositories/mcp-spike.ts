import { and, desc, eq, lte } from "drizzle-orm";

import type { Database } from "../index";
import { team } from "../schema/organization";
import { payment, project } from "../schema/projects";
import { servicesOffering } from "../schema/services-catalog";

export async function listPublishedOfferings(db: Database, input: { maxPriceMinor?: number }) {
  return db
    .select({
      id: servicesOffering.id,
      name: servicesOffering.name,
      description: servicesOffering.description,
      priceMinMinor: servicesOffering.priceMinMinor,
      priceMaxMinor: servicesOffering.priceMaxMinor,
      daysMin: servicesOffering.daysMin,
      daysMax: servicesOffering.daysMax,
      seller: team.name,
      slug: team.slug,
    })
    .from(servicesOffering)
    .innerJoin(team, eq(team.id, servicesOffering.teamId))
    .where(
      and(
        eq(servicesOffering.active, true),
        eq(team.status, "active"),
        input.maxPriceMinor === undefined ? undefined : lte(servicesOffering.priceMinMinor, input.maxPriceMinor),
      ),
    )
    .limit(10);
}

export async function findProjectWithPendingPayment(
  db: Database,
  input: { teamSlug: string; projectId?: string },
): Promise<string | null> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .innerJoin(team, eq(team.id, project.teamId))
    .innerJoin(payment, eq(payment.projectId, project.id))
    .where(
      and(
        eq(team.slug, input.teamSlug),
        eq(payment.status, "pending"),
        input.projectId === undefined ? undefined : eq(project.id, input.projectId),
      ),
    )
    .orderBy(desc(project.createdAt))
    .limit(1);
  return row?.id ?? null;
}
