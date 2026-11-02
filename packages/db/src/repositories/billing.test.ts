import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { fileUpload } from "../schema/files";
import { createTestDb, hasTestDatabase, seedOrganization, seedServicesTeam, truncateAll } from "../testing/db";
import {
  applySubscriptionSnapshot,
  billingSnapshot,
  ensureBillingAccount,
  getBillingAccount,
  getBillingAccountForTeam,
  recordPolarWebhookEvent,
  type SubscriptionSnapshot,
  teamStorageBytes,
} from "./billing";

describe.skipIf(!hasTestDatabase)("billing accounts", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const now = new Date("2026-11-10T12:00:00Z");

  function snapshot(organizationId: string, overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
    return {
      organizationId,
      servicesTier: "agency",
      storeTier: null,
      interval: "yearly",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      productId: "prod_1",
      status: "active",
      pastDueAt: null,
      currentPeriodEnd: new Date("2027-11-10T12:00:00Z"),
      cancelAtPeriodEnd: false,
      endsAt: null,
      modifiedAt: new Date("2026-11-10T12:00:00Z"),
      ...overrides,
    };
  }

  it("starts a 14-day trial with the first team's plan, and fills the other product's tier only during the trial", async () => {
    const { organizationId } = await seedOrganization(db);
    await ensureBillingAccount(db, { organizationId, product: "services", solo: true, now });
    await ensureBillingAccount(db, { organizationId, product: "store", solo: false, now: new Date("2026-11-12T00:00:00Z") });
    expect(await getBillingAccount(db, organizationId)).toMatchObject({
      servicesTier: "solo",
      storeTier: "starter",
      trialEndsAt: new Date("2026-11-24T12:00:00Z"),
    });

    const other = await seedOrganization(db);
    await ensureBillingAccount(db, { organizationId: other.organizationId, product: "services", solo: false, now });
    await applySubscriptionSnapshot(db, snapshot(other.organizationId, { servicesTier: "team" }));
    await ensureBillingAccount(db, { organizationId: other.organizationId, product: "store", solo: false, now });
    expect(await getBillingAccount(db, other.organizationId)).toMatchObject({ servicesTier: "team", storeTier: null });
  });

  it("applies a newer subscription snapshot and ignores an older one delivered late", async () => {
    const { organizationId } = await seedOrganization(db);
    const servicesTeam = await seedServicesTeam(db, { organizationId, slug: "crew" });
    await ensureBillingAccount(db, { organizationId, product: "services", solo: false, now });

    expect(await applySubscriptionSnapshot(db, snapshot(organizationId, { status: "past_due", pastDueAt: now, modifiedAt: new Date("2026-11-11T00:00:00Z") }))).toBe(true);
    expect(await applySubscriptionSnapshot(db, snapshot(organizationId, { status: "active", modifiedAt: new Date("2026-11-10T00:00:00Z") }))).toBe(false);

    const found = await getBillingAccountForTeam(db, servicesTeam.id);
    expect(found?.product).toBe("services");
    expect(found && billingSnapshot(found.account)).toEqual({
      servicesTier: "agency",
      storeTier: null,
      interval: "yearly",
      trialEndsAt: new Date("2026-11-24T12:00:00Z"),
      subscription: { status: "past_due", pastDueAt: now, cancelAtPeriodEnd: false, endsAt: null },
    });
  });

  it("records each webhook delivery once", async () => {
    expect(await recordPolarWebhookEvent(db, { id: "wh_1", type: "subscription.updated" })).toBe(true);
    expect(await recordPolarWebhookEvent(db, { id: "wh_1", type: "subscription.updated" })).toBe(false);
  });

  it("totals a team's stored bytes, attached or not, and no other team's", async () => {
    const { organizationId } = await seedOrganization(db);
    const mine = await seedServicesTeam(db, { organizationId, slug: "mine" });
    const theirs = await seedServicesTeam(db, { organizationId, slug: "theirs" });
    const upload = (teamId: string, sizeBytes: number, attached: boolean) => ({
      teamId,
      purpose: "delivery" as const,
      r2Key: crypto.randomUUID(),
      fileName: "f.zip",
      contentType: "application/zip",
      sizeBytes,
      attachedAt: attached ? now : null,
    });
    await db.insert(fileUpload).values([upload(mine.id, 3_000_000_000, true), upload(mine.id, 500, false), upload(theirs.id, 7, true)]);
    expect(await teamStorageBytes(db, mine.id)).toBe(3_000_000_500);
    expect(await teamStorageBytes(db, "no-such-team")).toBe(0);
  });
});
