import type { StoreStatus, TeamProduct } from "@jendal-workspace/core";
import { eq } from "drizzle-orm";

import type { Database } from "../index";
import { team } from "../schema/organization";
import { servicesTeamSettings } from "../schema/services-teams";
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
  supportEmail: string | null;
  currency: string;
  departments: ServicesDepartmentRow[];
  offerings: ServicesOfferingRow[];
};

export async function findSellerPage(db: Database, teamId: string): Promise<SellerPageData | null> {
  const [row] = await db
    .select({
      name: team.name,
      slug: team.slug,
      product: team.product,
      status: team.status,
      supportEmail: team.supportEmail,
      bio: servicesTeamSettings.bio,
      currency: servicesTeamSettings.currency,
    })
    .from(team)
    .leftJoin(servicesTeamSettings, eq(servicesTeamSettings.teamId, team.id))
    .where(eq(team.id, teamId))
    .limit(1);
  if (!row) return null;

  const [departments, offerings] =
    row.product === "services"
      ? await Promise.all([
          listServicesDepartments(db, teamId),
          listServicesOfferings(db, teamId, { activeOnly: true }),
        ])
      : [[], []];

  return {
    name: row.name,
    slug: row.slug,
    product: row.product,
    status: row.status,
    bio: row.bio ?? "",
    supportEmail: row.supportEmail,
    currency: row.currency ?? "USD",
    departments,
    offerings,
  };
}
