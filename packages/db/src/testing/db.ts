import type { OrderStatus, PaymentKind, PaymentStatus, ProjectSource, ProjectStatus, QuoteRequestAnswer } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";

import { createDb, type Database } from "../index";
import { user } from "../schema/auth";
import { products, productVariants } from "../schema/catalog";
import {
  type ClientIdentityKind,
  type ClientIdentitySource,
  clientContact,
  clientIdentity,
  projectClient,
} from "../schema/contacts";
import { fileUpload } from "../schema/files";
import { orders } from "../schema/orders";
import { member, organization, team, teamMember } from "../schema/organization";
import { payment, project } from "../schema/projects";
import { servicesOffering } from "../schema/services-catalog";
import { servicesTeamMember, servicesTeamSettings } from "../schema/services-teams";

export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export function createTestDb(): Database {
  return createDb({ DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" });
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql.raw(
      'truncate table "action_log", "outbox", "outbox_delivery", "oauth_access_token", "oauth_refresh_token", "oauth_consent", "oauth_client_resource", "oauth_client_assertion", "oauth_client", "jwks", "conversation_message", "request_shortlist", "member_department", "paypal_webhook_event", "download_grant", "orders", "ledger_balance", "ledger_entry", "ledger_transfer", "schedule_item", "delivery", "file_upload", "project_refund_part", "project_refund", "payment", "amendment", "quote_item", "quote", "project_client", "client_identity", "client_contact", "project", "dispute", "paypal_onboarding", "product_images", "product_variants", "products", "rate_limit", "request_limit", "services_offering", "services_department", "services_team_settings", "services_team_member", "discord_link_code", "payout_approval", "payout_request", "team_payout_trusted_member", "team_payout_rules", "payout_connect_attempt", "team_payout_credentials", "payout_destination", "store_domains", "team_member", "team", "invitation", "member_mark", "member_notice_preference", "rulebook_acceptance", "rulebook", "member", "organization", "session", "account", "verification", "user" restart identity cascade',
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
      input.solo ? { teamId: row.id, solo: true, kind: "solo", teamCutBps: 10_000, managementFeeBps: 0 } : { teamId: row.id },
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

// Adds a team member (admin, manager or freelancer): the workspace member row (role "member") that S1's
// servicesTeamRoleFor inner-joins, plus the services_team_member row that carries the role.
export async function seedServicesTeamMember(
  db: Database,
  input: { organizationId: string; teamId: string; role: "admin" | "manager" | "freelancer"; name?: string },
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

// A client contact of the team with the given identities, optionally attached to a project.
export async function seedClientContact(
  db: Database,
  input: {
    teamId: string;
    name?: string;
    identities?: { kind: ClientIdentityKind; value: string; verified?: boolean; source?: ClientIdentitySource }[];
    projectId?: string;
    isPrimary?: boolean;
    linkVersion?: number;
  },
): Promise<string> {
  const [contact] = await db
    .insert(clientContact)
    .values({ teamId: input.teamId, name: input.name ?? "Client" })
    .returning({ id: clientContact.id });
  if (!contact) throw new Error("Insert into client_contact returned no row");
  for (const identity of input.identities ?? []) {
    await db.insert(clientIdentity).values({
      contactId: contact.id,
      teamId: input.teamId,
      kind: identity.kind,
      value: identity.value,
      source: identity.source ?? "typed",
      verifiedAt: identity.verified ? new Date() : null,
    });
  }
  if (input.projectId) {
    await db.insert(projectClient).values({
      projectId: input.projectId,
      contactId: contact.id,
      isPrimary: input.isPrimary ?? false,
      linkVersion: input.linkVersion ?? 1,
    });
  }
  return contact.id;
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
    // The primary contact's link version; 0 is what migrated projects have.
    linkVersion?: number;
  },
): Promise<string> {
  const [row] = await db
    .insert(project)
    .values({
      teamId: input.teamId,
      title: input.title ?? "Website",
      status: input.status,
      source: input.source,
      requestAnswers: input.requestAnswers,
      currency: "USD",
      managementFeeBps: 1_000,
      teamCutBps: 1_500,
    })
    .returning({ id: project.id });
  if (!row) throw new Error("Insert into project returned no row");
  await seedClientContact(db, {
    teamId: input.teamId,
    name: input.clientName ?? "Client",
    identities: [{ kind: "email", value: input.clientEmail ?? "client@example.com" }],
    projectId: row.id,
    isPrimary: true,
    linkVersion: input.linkVersion,
  });
  return row.id;
}

// A services payment with no management fee; captured ones get a capture id.
export async function seedPayment(
  db: Database,
  input: {
    projectId: string;
    teamId: string;
    kind?: PaymentKind;
    status?: PaymentStatus;
    amountMinor?: number;
    capturedAt?: Date;
  },
): Promise<typeof payment.$inferSelect> {
  const kind = input.kind ?? "deposit";
  const status = input.status ?? "captured";
  const amountMinor = input.amountMinor ?? 10_000;
  const [row] = await db
    .insert(payment)
    .values({
      projectId: input.projectId,
      teamId: input.teamId,
      kind,
      status,
      currency: "USD",
      quotePartMinor: amountMinor,
      managementFeeMinor: 0,
      amountMinor,
      lines: [{ kind, label: kind, amountMinor }],
      paypalCaptureId: status === "pending" ? null : `CAP-${crypto.randomUUID()}`,
      capturedAt: status === "pending" ? null : (input.capturedAt ?? new Date()),
    })
    .returning();
  if (!row) throw new Error("Insert into payment returned no row");
  return row;
}

// A catalog product with one variant (run 4a: digital products always have exactly one).
export async function seedProduct(
  db: Database,
  input: { storeId: string; title?: string; kind?: "physical" | "digital"; status?: "draft" | "published"; priceMinor?: number },
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.insert(products).values({
    id,
    storeId: input.storeId,
    kind: input.kind ?? "physical",
    status: input.status ?? "draft",
    title: input.title ?? "Test product",
  });
  await db.insert(productVariants).values({
    id: crypto.randomUUID(),
    storeId: input.storeId,
    productId: id,
    priceMinor: input.priceMinor ?? 0,
  });
  return { id };
}

// An attached product file, as the digital product upload leaves it.
export async function seedProductFile(
  db: Database,
  input: { teamId: string; productId: string; fileName?: string; sizeBytes?: number; createdById?: string },
): Promise<typeof fileUpload.$inferSelect> {
  const [row] = await db
    .insert(fileUpload)
    .values({
      teamId: input.teamId,
      productId: input.productId,
      purpose: "product",
      r2Key: `products/${input.teamId}/${input.productId}/${crypto.randomUUID()}`,
      fileName: input.fileName ?? "pack.zip",
      contentType: "application/zip",
      sizeBytes: input.sizeBytes ?? 1024,
      createdById: input.createdById ?? null,
      attachedAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("Insert into file_upload returned no row");
  return row;
}

export async function seedOrder(
  db: Database,
  input: {
    teamId: string;
    productId: string;
    status?: OrderStatus;
    amountMinor?: number;
    buyerEmail?: string;
    paypalOrderId?: string;
    paypalCaptureId?: string;
    createdAt?: Date;
  },
): Promise<typeof orders.$inferSelect> {
  const status = input.status ?? "pending";
  const [row] = await db
    .insert(orders)
    .values({
      teamId: input.teamId,
      productId: input.productId,
      productTitle: "Test product",
      buyerEmail: input.buyerEmail ?? "buyer@example.com",
      currency: "USD",
      amountMinor: input.amountMinor ?? 1900,
      status,
      paypalOrderId: input.paypalOrderId ?? null,
      paypalCaptureId: input.paypalCaptureId ?? null,
      checkoutSecretHash: "x".repeat(64),
      paidAt: status === "pending" ? null : new Date(),
      refundedAt: status === "refunded" ? new Date() : null,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) throw new Error("Insert into orders returned no row");
  return row;
}
