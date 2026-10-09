import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { products, productVariants } from "../schema/catalog";
import { member } from "../schema/organization";
import { createTestDb, hasTestDatabase, seedOrganization, seedProduct, seedStore, truncateAll } from "./db";

describe.skipIf(!hasTestDatabase)("test database", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("seeds an organization with an owner", async () => {
    const { organizationId, userId } = await seedOrganization(db);
    const rows = await db.select().from(member);

    expect(rows).toEqual([expect.objectContaining({ organizationId, userId, role: "owner" })]);
  });

  it("seeds a draft physical product with one free variant, honoring overrides", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "shop" });

    const product = await seedProduct(db, { storeId: store.id });
    const custom = await seedProduct(db, {
      storeId: store.id,
      title: "Icons",
      kind: "digital",
      status: "published",
      priceMinor: 1900,
    });

    const productRows = await db.select().from(products);
    expect(productRows).toHaveLength(2);
    expect(productRows.find((row) => row.id === product.id)).toMatchObject({
      storeId: store.id,
      kind: "physical",
      status: "draft",
      title: "Test product",
    });
    expect(productRows.find((row) => row.id === custom.id)).toMatchObject({
      kind: "digital",
      status: "published",
      title: "Icons",
    });

    const variants = await db.select().from(productVariants);
    expect(variants).toHaveLength(2);
    expect(variants.find((row) => row.productId === product.id)).toMatchObject({ storeId: store.id, priceMinor: 0 });
    expect(variants.find((row) => row.productId === custom.id)).toMatchObject({ priceMinor: 1900 });
  });
});
