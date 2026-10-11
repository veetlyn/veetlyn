import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { team } from "../schema/organization";
import { servicesTeamSettings } from "../schema/services-teams";
import { createTestDb, hasTestDatabase, seedOrganization, seedProduct, seedServicesTeam, seedStore, truncateAll } from "../testing/db";
import { createServicesDepartment, createServicesOffering, setServicesOfferingActive } from "./services-catalog";
import { findSellerPage } from "./seller-page";
import { setServicesTeamStoreEnabled } from "./services-teams";

describe.skipIf(!hasTestDatabase)("seller page repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("returns a services team's page with its departments and only its active offerings", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, {
      organizationId,
      slug: "acme-studio",
      name: "Acme Studio",
      status: "active",
    });
    await db.update(team).set({ supportEmail: "help@acme.test" }).where(eq(team.id, studio.id));
    await db
      .update(servicesTeamSettings)
      .set({ bio: "We design brands.", currency: "EUR" })
      .where(eq(servicesTeamSettings.teamId, studio.id));
    const design = await createServicesDepartment(db, { teamId: studio.id, name: "Design" });
    const web = await createServicesDepartment(db, { teamId: studio.id, name: "Web" });
    const draft = {
      description: "",
      priceMinMinor: 10_000,
      priceMaxMinor: 40_000,
      daysMin: 2,
      daysMax: 5,
      intakeQuestions: [],
    };
    const logo = await createServicesOffering(db, {
      ...draft,
      teamId: studio.id,
      departmentId: design?.id,
      name: "Logo design",
      description: "A logo and its variants.",
    });
    const hidden = await createServicesOffering(db, { ...draft, teamId: studio.id, name: "Hidden" });
    const site = await createServicesOffering(db, {
      ...draft,
      teamId: studio.id,
      departmentId: web?.id,
      name: "Website",
      priceMinMinor: 200_000,
      priceMaxMinor: 500_000,
      daysMin: 10,
      daysMax: 30,
    });
    if (!hidden) throw new Error("Hidden offering was not created");
    await setServicesOfferingActive(db, { id: hidden.id, teamId: studio.id, active: false });

    await expect(findSellerPage(db, studio.id)).resolves.toEqual({
      name: "Acme Studio",
      slug: "acme-studio",
      product: "services",
      status: "active",
      bio: "We design brands.",
      supportEmail: "help@acme.test",
      currency: "EUR",
      departments: [design, web],
      offerings: [logo, site],
      products: [],
    });
  });

  it("returns a store's page with no bio, offerings or departments", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme", name: "Acme" });

    await expect(findSellerPage(db, store.id)).resolves.toEqual({
      name: "Acme",
      slug: "acme",
      product: "store",
      status: "draft",
      bio: "",
      supportEmail: null,
      currency: "USD",
      departments: [],
      offerings: [],
      products: [],
    });
  });

  it("returns published digital products, but not drafts, while the store is on", async () => {
    const { organizationId } = await seedOrganization(db);
    const seller = await seedServicesTeam(db, { organizationId, slug: "maker", status: "active" });
    await setServicesTeamStoreEnabled(db, seller.id, true);
    const published = await seedProduct(db, {
      storeId: seller.id,
      title: "Icon pack",
      kind: "digital",
      status: "published",
      priceMinor: 1900,
    });
    await seedProduct(db, { storeId: seller.id, title: "Draft pack", kind: "digital" });

    const page = await findSellerPage(db, seller.id);
    expect(page?.products).toEqual([
      { id: published.id, title: "Icon pack", description: "", priceMinor: 1900 },
    ]);
  });

  it("lists no products while the store is off", async () => {
    const { organizationId } = await seedOrganization(db);
    const seller = await seedServicesTeam(db, { organizationId, slug: "maker", status: "active" });
    await seedProduct(db, { storeId: seller.id, kind: "digital", status: "published", priceMinor: 1900 });

    expect((await findSellerPage(db, seller.id))?.products).toEqual([]);
  });
});
