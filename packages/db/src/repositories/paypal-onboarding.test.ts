import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { team } from "../schema/organization";
import { createTestDb, hasTestDatabase, seedOrganization, seedStore, truncateAll } from "../testing/db";
import {
  findPayPalOnboarding,
  markTeamPayPalMerchant,
  savePayPalIntegration,
  savePayPalReferral,
} from "./paypal-onboarding";

describe.skipIf(!hasTestDatabase)("paypal onboarding repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedTeam(slug = "acme") {
    const { organizationId } = await seedOrganization(db);
    return seedStore(db, { organizationId, slug });
  }

  it("saves a referral and finds it by team", async () => {
    const store = await seedTeam();

    await savePayPalReferral(db, { teamId: store.id, trackingId: store.id, actionUrl: "https://paypal.example/abc" });

    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({
      teamId: store.id,
      trackingId: store.id,
      actionUrl: "https://paypal.example/abc",
      status: "pending",
      merchantId: null,
      paymentsReceivable: null,
      primaryEmailConfirmed: null,
      oauthIntegrations: null,
    });
    expect(await findPayPalOnboarding(db, "missing")).toBeNull();
  });

  it("a new referral replaces the action URL and resets the status, keeping the integration fields", async () => {
    const store = await seedTeam();
    await savePayPalReferral(db, { teamId: store.id, trackingId: store.id, actionUrl: "https://paypal.example/one" });
    await savePayPalIntegration(db, {
      teamId: store.id,
      merchantId: "SELLER1",
      status: "needs_attention",
      paymentsReceivable: false,
      primaryEmailConfirmed: true,
      oauthIntegrations: [],
    });

    const saved = await savePayPalReferral(db, {
      teamId: store.id,
      trackingId: store.id,
      actionUrl: "https://paypal.example/two",
    });

    expect(saved).toMatchObject({
      actionUrl: "https://paypal.example/two",
      status: "pending",
      merchantId: "SELLER1",
      primaryEmailConfirmed: true,
    });
  });

  it("saves the integration over an existing referral, keeping the action URL", async () => {
    const store = await seedTeam();
    await savePayPalReferral(db, { teamId: store.id, trackingId: store.id, actionUrl: "https://paypal.example/abc" });
    const oauthIntegrations = [
      {
        integrationType: "OAUTH_THIRD_PARTY",
        integrationMethod: "PAYPAL",
        oauthThirdParty: [{ partnerClientId: "p", merchantClientId: "m", scopes: ["scope-a"] }],
      },
    ];

    await savePayPalIntegration(db, {
      teamId: store.id,
      merchantId: "SELLER1",
      status: "connected",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      oauthIntegrations,
    });

    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({
      status: "connected",
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      actionUrl: "https://paypal.example/abc",
    });
    expect(row?.oauthIntegrations).toEqual(oauthIntegrations);
  });

  it("inserts a row when the integration arrives before any referral", async () => {
    const store = await seedTeam();

    await savePayPalIntegration(db, {
      teamId: store.id,
      merchantId: "SELLER1",
      status: "needs_attention",
      paymentsReceivable: false,
      primaryEmailConfirmed: false,
      oauthIntegrations: [],
    });

    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({
      teamId: store.id,
      trackingId: store.id,
      actionUrl: null,
      merchantId: "SELLER1",
      status: "needs_attention",
    });
  });

  it("writes the merchant id on the team and returns the slug", async () => {
    const store = await seedTeam();

    await expect(markTeamPayPalMerchant(db, { teamId: store.id, merchantId: "SELLER1" })).resolves.toEqual({
      slug: "acme",
    });
    const [row] = await db
      .select({ paypalMerchantId: team.paypalMerchantId })
      .from(team)
      .where(eq(team.id, store.id));
    expect(row?.paypalMerchantId).toBe("SELLER1");
    await expect(markTeamPayPalMerchant(db, { teamId: "missing", merchantId: "X" })).resolves.toBeNull();
  });

  it("deletes the onboarding row with its team", async () => {
    const store = await seedTeam();
    await savePayPalReferral(db, { teamId: store.id, trackingId: store.id, actionUrl: "https://paypal.example/abc" });

    await db.delete(team).where(eq(team.id, store.id));

    expect(await findPayPalOnboarding(db, store.id)).toBeNull();
  });
});
