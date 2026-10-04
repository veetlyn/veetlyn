import { sql } from "drizzle-orm";

import { createDb, type Database } from "../index";
import { user } from "../schema/auth";
import { member, organization, team, teamMember } from "../schema/organization";

export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export function createTestDb(): Database {
  return createDb({ DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" });
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql.raw(
      'truncate table "store_domains", "team_member", "team", "invitation", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
    ),
  );
}

export async function seedUser(db: Database, name = "Owner"): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(user).values({ id, name, email: `${id}@example.com` });
  return id;
}

export async function seedOrganization(
  db: Database,
  options: { role?: string; name?: string } = {},
): Promise<{ userId: string; organizationId: string }> {
  const userId = await seedUser(db);
  const organizationId = crypto.randomUUID();
  await db.insert(organization).values({
    id: organizationId,
    name: options.name ?? "Acme Inc",
    slug: `org-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  });
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role: options.role ?? "owner",
    createdAt: new Date(),
  });
  return { userId, organizationId };
}

export async function addMember(db: Database, input: { organizationId: string; role: string }): Promise<string> {
  const userId = await seedUser(db, "Staff");
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    userId,
    role: input.role,
    createdAt: new Date(),
  });
  return userId;
}

export async function seedStore(
  db: Database,
  input: { organizationId: string; slug: string; name?: string; status?: "draft" | "active" | "suspended" },
) {
  const [row] = await db
    .insert(team)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      slug: input.slug,
      name: input.name ?? input.slug,
      status: input.status ?? "draft",
      createdAt: new Date(),
    })
    .returning({
      id: team.id,
      organizationId: team.organizationId,
      slug: team.slug,
      name: team.name,
      status: team.status,
      paypalMerchantId: team.paypalMerchantId,
    });
  if (!row) throw new Error("Insert into team returned no row");
  return row;
}

export async function addTeamMember(db: Database, input: { teamId: string; userId: string }): Promise<void> {
  await db.insert(teamMember).values({ id: crypto.randomUUID(), ...input, createdAt: new Date() });
}
