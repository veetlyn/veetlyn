import type { ProjectSource, ProjectStatus, QuoteRequestAnswer } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";

import { createDb, type Database } from "../index";
import { user } from "../schema/auth";
import { member, organization, team, teamMember } from "../schema/organization";
import { project } from "../schema/projects";
import { servicesOffering } from "../schema/services-catalog";
import { servicesTeamMember, servicesTeamSettings } from "../schema/services-teams";

export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export function createTestDb(): Database {
  return createDb({ DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" });
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql.raw(
      'truncate table "outbox", "paypal_webhook_event", "ledger_balance", "ledger_entry", "ledger_transfer", "delivery", "file_upload", "payment", "amendment", "quote_item", "quote", "project", "paypal_onboarding", "product_images", "product_variants", "products", "rate_limit", "request_limit", "services_offering", "services_department", "services_team_settings", "services_team_member", "discord_link_code", "payout_destination", "store_domains", "team_member", "team", "invitation", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
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

export async function addMember(
  db: Database,
  input: { organizationId: string; role: string; name?: string },
): Promise<string> {
  const userId = await seedUser(db, input.name ?? "Staff");
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
      product: team.product,
      paypalMerchantId: team.paypalMerchantId,
    });
  if (!row) throw new Error("Insert into team returned no row");
  return row;
}

// Mirrors what the Better Auth create hooks do for a services team: the team row and its default settings.
export async function seedServicesTeam(
  db: Database,
  input: {
    organizationId: string;
    slug: string;
    name?: string;
    status?: "draft" | "active" | "suspended";
    withSettings?: boolean;
    solo?: boolean;
  },
) {
  const [row] = await db
    .insert(team)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      slug: input.slug,
      name: input.name ?? input.slug,
      status: input.status ?? "draft",
      product: "services",
      createdAt: new Date(),
    })
    .returning({
      id: team.id,
      organizationId: team.organizationId,
      slug: team.slug,
      name: team.name,
      status: team.status,
      product: team.product,
      paypalMerchantId: team.paypalMerchantId,
    });
  if (!row) throw new Error("Insert into team returned no row");
  if (input.withSettings ?? true) {
    await db.insert(servicesTeamSettings).values(
      input.solo ? { teamId: row.id, solo: true, teamCutBps: 10_000, managementFeeBps: 0 } : { teamId: row.id },
    );
  }
  return row;
}

// A catalog service (sellers design §4.1); prices in minor units, days as a range.
export async function seedServicesOffering(
  db: Database,
  input: { teamId: string; name?: string; departmentId?: string; active?: boolean },
): Promise<string> {
  const [row] = await db
    .insert(servicesOffering)
    .values({
      teamId: input.teamId,
      departmentId: input.departmentId ?? null,
      name: input.name ?? "Logo design",
      description: "",
      priceMinMinor: 10_000,
      priceMaxMinor: 40_000,
      daysMin: 2,
      daysMax: 5,
      intakeQuestions: [],
      active: input.active ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: servicesOffering.id });
  if (!row) throw new Error("Insert into services_offering returned no row");
  return row.id;
}

export async function addTeamMember(db: Database, input: { teamId: string; userId: string }): Promise<void> {
  await db.insert(teamMember).values({ id: crypto.randomUUID(), ...input, createdAt: new Date() });
}

// A services team with its workspace and an owner, whose servicesTeamRoleFor is "admin"
// (S1's effectiveServicesTeamRole maps workspace owner/admin to "admin").
export async function seedServicesTeamWithAdmin(
  db: Database,
  options: { slug?: string } = {},
): Promise<{ userId: string; organizationId: string; teamId: string }> {
  const { userId, organizationId } = await seedOrganization(db);
  const teamRow = await seedServicesTeam(db, { organizationId, slug: options.slug ?? "team" });
  return { userId, organizationId, teamId: teamRow.id };
}

// Adds a freelancer or manager: the workspace member row (role "member") that S1's
// servicesTeamRoleFor inner-joins, plus the services_team_member row that carries the role.
export async function seedServicesTeamMember(
  db: Database,
  input: { organizationId: string; teamId: string; role: "manager" | "freelancer"; name?: string },
): Promise<string> {
  const userId = await seedUser(db, input.name ?? input.role);
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    userId,
    role: "member",
    createdAt: new Date(),
  });
  await db.insert(servicesTeamMember).values({
    id: crypto.randomUUID(),
    teamId: input.teamId,
    userId,
    role: input.role,
    createdAt: new Date(),
  });
  return userId;
}

export async function seedProject(
  db: Database,
  input: {
    teamId: string;
    title?: string;
    clientEmail?: string;
    clientName?: string;
    status?: ProjectStatus;
    source?: ProjectSource;
    requestAnswers?: QuoteRequestAnswer[];
  },
): Promise<string> {
  const [row] = await db
    .insert(project)
    .values({
      teamId: input.teamId,
      title: input.title ?? "Website",
      clientEmail: input.clientEmail ?? "client@example.com",
      clientName: input.clientName,
      status: input.status,
      source: input.source,
      requestAnswers: input.requestAnswers,
      currency: "USD",
      managementFeeBps: 1_000,
      teamCutBps: 1_500,
    })
    .returning({ id: project.id });
  if (!row) throw new Error("Insert into project returned no row");
  return row.id;
}
