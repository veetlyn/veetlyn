import type { StoreStatus, TeamProduct } from "@jendal-workspace/core";
import { eq } from "drizzle-orm";

import type { Database } from "../index";
import { team } from "../schema/organization";
import { servicesTeamSettings } from "../schema/services-teams";
import { listPublishedDigitalProducts, type SellerProductRow } from "./catalog";
import {
  listServicesDepartments,
  listServicesOfferings,
  type ServicesDepartmentRow,
  type ServicesOfferingRow,
} from "./services-catalog";

// Sellers design §3.3: what the seller page shows. The same data feeds the public host and the admin preview.
export type SellerPageData = {
  name: string;
  slug: string;
  product: TeamProduct;
  status: StoreStatus;
  bio: string;
  currency: string;
  departments: ServicesDepartmentRow[];
  offerings: ServicesOfferingRow[];
  products: SellerProductRow[];
};

export async function findSellerPage(db: Database, teamId: string): Promise<SellerPageData | null> {
  const [row] = await db
    .select({
      name: team.name,
      slug: team.slug,
      product: team.product,
      status: team.status,
      bio: servicesTeamSettings.bio,
      currency: servicesTeamSettings.currency,
      storeEnabled: servicesTeamSettings.storeEnabled,
    })
    .from(team)
    .leftJoin(servicesTeamSettings, eq(servicesTeamSettings.teamId, team.id))
    .where(eq(team.id, teamId))
    .limit(1);
  if (!row) return null;

  const [departments, offerings, products] = await Promise.all([
    row.product === "services" ? listServicesDepartments(db, teamId) : [],
    row.product === "services" ? listServicesOfferings(db, teamId, { activeOnly: true }) : [],
    // The store switch gates selling: with the store off the page lists no products.
    row.product === "services" && row.storeEnabled === true ? listPublishedDigitalProducts(db, teamId) : [],
  ]);

  return {
    name: row.name,
    slug: row.slug,
    product: row.product,
    status: row.status,
    bio: row.bio ?? "",
    currency: row.currency ?? "USD",
    departments,
    offerings,
    products,
  };
}
