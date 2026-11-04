import { and, eq } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { member, organization } from "../schema/organization";

export type WorkspaceMembership = { id: string; name: string; role: string };

// The workspace with the person's role in it; null when it does not exist or they are not a member.
export async function findWorkspaceMembership(
  db: DbExecutor,
  input: { organizationId: string; userId: string },
): Promise<WorkspaceMembership | null> {
  const [row] = await db
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, input.userId)))
    .where(eq(organization.id, input.organizationId))
    .limit(1);
  return row ?? null;
}
