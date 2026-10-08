import type { StoreDirectory, StoreRecord } from "@jendal-workspace/core";
import { and, eq, ne, sql } from "drizzle-orm";

import type { Database } from "../index";
import { products } from "../schema/catalog";
import { member, organization, team, teamMember } from "../schema/organization";
import { storeDomains } from "../schema/stores";

const storeColumns = {
  id: team.id,
  organizationId: team.organizationId,
  slug: team.slug,
  name: team.name,
  status: team.status,
  product: team.product,
  paypalMerchantId: team.paypalMerchantId,
};

// The storefront host serves stores and services teams' seller pages; the admin's store lists and store access stay store-only.
const isStore = () => eq(team.product, "store");

export function createStoreDirectory(db: Database): StoreDirectory {
  return {
    async findById(id) {
      const [row] = await db
        .select(storeColumns)
        .from(team)
        .where(eq(team.id, id))
        .limit(1);
      return row ?? null;
    },
    async findBySlug(slug) {
      const [row] = await db
        .select(storeColumns)
        .from(team)
        .where(eq(team.slug, slug))
        .limit(1);
      return row ?? null;
    },
    async findByHostname(hostname) {
      const [row] = await db
        .select(storeColumns)
        .from(storeDomains)
        .innerJoin(team, eq(storeDomains.storeId, team.id))
        .where(and(eq(storeDomains.hostname, hostname), eq(storeDomains.status, "active")))
        .limit(1);
      return row ?? null;
    },
  };
}

export async function isStoreSlugTaken(db: Database, slug: string): Promise<boolean> {
  const [row] = await db.select({ id: team.id }).from(team).where(eq(team.slug, slug)).limit(1);
  return row !== undefined;
}

export type StoreAccessRow = { store: StoreRecord; role: string; isTeamMember: boolean };

// Null when the store does not exist or the user is not a member of its organization.
export async function findStoreAccess(
  db: Database,
  input: { slug: string; userId: string },
): Promise<StoreAccessRow | null> {
  const [row] = await db
    .select({ ...storeColumns, role: member.role, teamMemberId: teamMember.id })
    .from(team)
    .innerJoin(member, and(eq(member.organizationId, team.organizationId), eq(member.userId, input.userId)))
    .leftJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, input.userId)))
    .where(and(eq(team.slug, input.slug), isStore()))
    .limit(1);
  if (!row) return null;
  const { role, teamMemberId, ...store } = row;
  return { store, role, isTeamMember: teamMemberId !== null };
}

export type OrganizationStores = {
  organization: { id: string; name: string };
  role: string;
  stores: Array<{ store: StoreRecord; isTeamMember: boolean }>;
};

export async function listOrganizationsWithStores(db: Database, userId: string): Promise<OrganizationStores[]> {
  const rows = await db
    .select({
      organizationId: organization.id,
      organizationName: organization.name,
      role: member.role,
      store: storeColumns,
      teamMemberId: teamMember.id,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .leftJoin(team, and(eq(team.organizationId, organization.id), isStore()))
    .leftJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, userId)))
    .where(eq(member.userId, userId))
    // Ordering by name keeps the dashboard list stable; created_at can tie within a millisecond.
    .orderBy(organization.name, organization.id, team.name, team.id);

  const byOrganization = new Map<string, OrganizationStores>();
  for (const row of rows) {
    let entry = byOrganization.get(row.organizationId);
    if (!entry) {
      entry = { organization: { id: row.organizationId, name: row.organizationName }, role: row.role, stores: [] };
      byOrganization.set(row.organizationId, entry);
    }
    if (row.store) entry.stores.push({ store: row.store, isTeamMember: row.teamMemberId !== null });
  }
  return [...byOrganization.values()];
}

export type StorePolicyInfo = { supportEmail: string | null; createdAt: Date };

// Kept out of StoreRecord so the KV-cached store lookup stays small.
export async function findStorePolicyInfo(db: Database, storeId: string): Promise<StorePolicyInfo | null> {
  const [row] = await db
    .select({ supportEmail: team.supportEmail, createdAt: team.createdAt })
    .from(team)
    .where(eq(team.id, storeId))
    .limit(1);
  return row ?? null;
}

// team.status is input: false in Better Auth, so publishing writes it here. A suspended team stays suspended.
export async function setTeamStatus(
  db: Database,
  input: { teamId: string; status: "draft" | "active" },
): Promise<{ slug: string } | null> {
  const [row] = await db
    .update(team)
    .set({ status: input.status })
    .where(and(eq(team.id, input.teamId), ne(team.status, "suspended")))
    .returning({ slug: team.slug });
  return row ?? null;
}

export async function countPublishedProducts(db: Database, storeId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.status, "published")));
  return row?.count ?? 0;
}
