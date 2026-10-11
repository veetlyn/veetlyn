import { and, eq, ne, sql } from "drizzle-orm";

import type { Database } from "../index";
import { postgresError } from "../postgres-errors";
import { servicesDepartment, servicesOffering } from "../schema/services-catalog";
import type { OfferingDraft } from "@jendal-workspace/core";

export type ServicesDepartmentRow = { id: string; name: string; position: number };

export type ServicesOfferingRow = OfferingDraft & {
  id: string;
  departmentId: string | null;
  active: boolean;
  position: number;
};

// Explicit column lists, so later schema columns never change what these return.
const departmentColumns = {
  id: servicesDepartment.id,
  name: servicesDepartment.name,
  position: servicesDepartment.position,
};

const offeringColumns = {
  id: servicesOffering.id,
  departmentId: servicesOffering.departmentId,
  name: servicesOffering.name,
  description: servicesOffering.description,
  priceMinMinor: servicesOffering.priceMinMinor,
  priceMaxMinor: servicesOffering.priceMaxMinor,
  daysMin: servicesOffering.daysMin,
  daysMax: servicesOffering.daysMax,
  intakeQuestions: servicesOffering.intakeQuestions,
  active: servicesOffering.active,
  position: servicesOffering.position,
};

// The name pre-checks give the common answer; two writes racing past them meet the unique name index instead.
async function nullOnDuplicateName<T>(write: PromiseLike<T>): Promise<T | null> {
  try {
    return await write;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

function isUniqueViolation(cause: unknown): boolean {
  return postgresError(cause)?.code === "23505";
}

export async function listServicesDepartments(db: Database, teamId: string): Promise<ServicesDepartmentRow[]> {
  return db
    .select(departmentColumns)
    .from(servicesDepartment)
    .where(eq(servicesDepartment.teamId, teamId))
    .orderBy(servicesDepartment.position, servicesDepartment.name);
}

// Null when the team already has that name (case-insensitive); the unique index is the concurrency guard.
export async function createServicesDepartment(
  db: Database,
  input: { teamId: string; name: string },
): Promise<ServicesDepartmentRow | null> {
  const name = input.name.trim();
  const [existing] = await db
    .select({ id: servicesDepartment.id })
    .from(servicesDepartment)
    .where(
      and(
        eq(servicesDepartment.teamId, input.teamId),
        sql`lower(${servicesDepartment.name}) = ${name.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (existing) return null;

  const [positionRow] = await db
    .select({ next: sql<number>`coalesce(max(${servicesDepartment.position}), -1) + 1` })
    .from(servicesDepartment)
    .where(eq(servicesDepartment.teamId, input.teamId));
  const rows = await nullOnDuplicateName(
    db
      .insert(servicesDepartment)
      .values({ id: crypto.randomUUID(), teamId: input.teamId, name, position: positionRow?.next ?? 0 })
      .returning(departmentColumns),
  );
  return rows?.[0] ?? null;
}

// False when the department is not the team's; null when the new name is already taken in that team.
export async function renameServicesDepartment(
  db: Database,
  input: { id: string; teamId: string; name: string },
): Promise<boolean | null> {
  const name = input.name.trim();
  const [owned] = await db
    .select({ id: servicesDepartment.id })
    .from(servicesDepartment)
    .where(and(eq(servicesDepartment.id, input.id), eq(servicesDepartment.teamId, input.teamId)))
    .limit(1);
  if (!owned) return false;

  const [taken] = await db
    .select({ id: servicesDepartment.id })
    .from(servicesDepartment)
    .where(
      and(
        eq(servicesDepartment.teamId, input.teamId),
        ne(servicesDepartment.id, input.id),
        sql`lower(${servicesDepartment.name}) = ${name.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (taken) return null;

  const rows = await nullOnDuplicateName(
    db
      .update(servicesDepartment)
      .set({ name })
      .where(and(eq(servicesDepartment.id, input.id), eq(servicesDepartment.teamId, input.teamId)))
      .returning({ id: servicesDepartment.id }),
  );
  if (rows === null) return null;
  return rows.length > 0;
}

// Offerings keep their rows, with departmentId set to null by the foreign key.
export async function deleteServicesDepartment(db: Database, input: { id: string; teamId: string }): Promise<boolean> {
  const rows = await db
    .delete(servicesDepartment)
    .where(and(eq(servicesDepartment.id, input.id), eq(servicesDepartment.teamId, input.teamId)))
    .returning({ id: servicesDepartment.id });
  return rows.length > 0;
}

export async function listServicesOfferings(
  db: Database,
  teamId: string,
  options?: { activeOnly?: boolean },
): Promise<ServicesOfferingRow[]> {
  const conditions = [eq(servicesOffering.teamId, teamId)];
  if (options?.activeOnly) conditions.push(eq(servicesOffering.active, true));
  return db
    .select(offeringColumns)
    .from(servicesOffering)
    .where(and(...conditions))
    .orderBy(servicesOffering.position, servicesOffering.name);
}

export async function findServicesOffering(
  db: Database,
  input: { id: string; teamId: string },
): Promise<ServicesOfferingRow | null> {
  const [row] = await db
    .select(offeringColumns)
    .from(servicesOffering)
    .where(and(eq(servicesOffering.id, input.id), eq(servicesOffering.teamId, input.teamId)))
    .limit(1);
  return row ?? null;
}

// Null on a duplicate name in this team; the unique index is the concurrency guard.
export async function createServicesOffering(
  db: Database,
  input: { teamId: string; departmentId?: string | null } & OfferingDraft,
): Promise<ServicesOfferingRow | null> {
  const name = input.name.trim();
  const [existing] = await db
    .select({ id: servicesOffering.id })
    .from(servicesOffering)
    .where(
      and(eq(servicesOffering.teamId, input.teamId), sql`lower(${servicesOffering.name}) = ${name.toLowerCase()}`),
    )
    .limit(1);
  if (existing) return null;

  const [positionRow] = await db
    .select({ next: sql<number>`coalesce(max(${servicesOffering.position}), -1) + 1` })
    .from(servicesOffering)
    .where(eq(servicesOffering.teamId, input.teamId));
  const rows = await nullOnDuplicateName(
    db
      .insert(servicesOffering)
      .values({
        id: crypto.randomUUID(),
        teamId: input.teamId,
        departmentId: input.departmentId ?? null,
        name,
        description: input.description,
        priceMinMinor: input.priceMinMinor,
        priceMaxMinor: input.priceMaxMinor,
        daysMin: input.daysMin,
        daysMax: input.daysMax,
        intakeQuestions: input.intakeQuestions,
        active: true,
        position: positionRow?.next ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning(offeringColumns),
  );
  return rows?.[0] ?? null;
}

// Null when the offering is not the team's, or the name is taken by another offering in the team.
export async function updateServicesOffering(
  db: Database,
  input: { id: string; teamId: string; departmentId?: string | null } & OfferingDraft,
): Promise<ServicesOfferingRow | null> {
  const [owned] = await db
    .select({ id: servicesOffering.id })
    .from(servicesOffering)
    .where(and(eq(servicesOffering.id, input.id), eq(servicesOffering.teamId, input.teamId)))
    .limit(1);
  if (!owned) return null;

  const name = input.name.trim();
  const [taken] = await db
    .select({ id: servicesOffering.id })
    .from(servicesOffering)
    .where(
      and(
        eq(servicesOffering.teamId, input.teamId),
        ne(servicesOffering.id, input.id),
        sql`lower(${servicesOffering.name}) = ${name.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (taken) return null;

  const values: Partial<typeof servicesOffering.$inferInsert> = {
    name,
    description: input.description,
    priceMinMinor: input.priceMinMinor,
    priceMaxMinor: input.priceMaxMinor,
    daysMin: input.daysMin,
    daysMax: input.daysMax,
    intakeQuestions: input.intakeQuestions,
    updatedAt: new Date(),
  };
  if ("departmentId" in input) values.departmentId = input.departmentId ?? null;

  const rows = await nullOnDuplicateName(
    db
      .update(servicesOffering)
      .set(values)
      .where(and(eq(servicesOffering.id, input.id), eq(servicesOffering.teamId, input.teamId)))
      .returning(offeringColumns),
  );
  return rows?.[0] ?? null;
}

export async function setServicesOfferingActive(
  db: Database,
  input: { id: string; teamId: string; active: boolean },
): Promise<boolean> {
  const rows = await db
    .update(servicesOffering)
    .set({ active: input.active, updatedAt: new Date() })
    .where(and(eq(servicesOffering.id, input.id), eq(servicesOffering.teamId, input.teamId)))
    .returning({ id: servicesOffering.id });
  return rows.length > 0;
}

// Projects keep their rows, with offeringId set to null by the foreign key.
export async function deleteServicesOffering(db: Database, input: { id: string; teamId: string }): Promise<boolean> {
  const rows = await db
    .delete(servicesOffering)
    .where(and(eq(servicesOffering.id, input.id), eq(servicesOffering.teamId, input.teamId)))
    .returning({ id: servicesOffering.id });
  return rows.length > 0;
}

export async function countServicesOfferings(
  db: Database,
  teamId: string,
  options?: { activeOnly?: boolean },
): Promise<number> {
  const conditions = [eq(servicesOffering.teamId, teamId)];
  if (options?.activeOnly) conditions.push(eq(servicesOffering.active, true));
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(servicesOffering)
    .where(and(...conditions));
  return row?.count ?? 0;
}
