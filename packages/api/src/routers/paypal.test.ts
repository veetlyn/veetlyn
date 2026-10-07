import { createTestAuth } from "@jendal-workspace/auth/testing";
import { findPayPalOnboarding, markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { team } from "@jendal-workspace/db/schema/organization";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedStore,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createPayPalClient, type FetchLike, PARTNER_REFERRAL_FEATURES } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Context, PayPalServices } from "../context";
import { refreshPayPalOnboarding } from "../paypal/onboarding";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

type SessionValue = NonNullable<Context["session"]>;

function makeSession(userId: string): SessionValue {
  const now = new Date();
  return {
    session: {
      id: "session-1",
      token: "token-1",
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Someone",
      email: `${userId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const RETURN_URL = "https://admin.example.com/api/paypal/onboarding/return";
const ACTION_URL = "https://www.sandbox.paypal.com/bizsignup/entry?token=REF-1";

function makePayPal(
  fetchImpl: FetchLike,
  onTeamMerchantChanged?: PayPalServices["onTeamMerchantChanged"],
): PayPalServices {
  return {
    client: createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
    }),
    partnerId: "PARTNER42",
    returnUrl: RETURN_URL,
    onTeamMerchantChanged,
  };
}

// A fake PayPal API: token endpoint, partner referral, tracking lookup and status GET.
// `integration: null` makes the tracking lookup answer 404 (seller has not finished).
function fakePayPalApi(options: { integration: Record<string, unknown> | null }) {
  return fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.url.endsWith("/v2/customer/partner-referrals")) {
      return jsonResponse(201, { links: [{ href: ACTION_URL, rel: "action_url", method: "GET" }] });
    }
    if (request.url.includes("/merchant-integrations?tracking_id=")) {
      if (options.integration === null) {
        return jsonResponse(404, { name: "INVALID_RESOURCE_ID", message: "Resource not found.", debug_id: "d404" });
      }
      return jsonResponse(200, {
        merchant_id: options.integration.merchant_id,
        tracking_id: options.integration.tracking_id,
      });
    }
    if (request.url.includes("/merchant-integrations/")) {
      return jsonResponse(200, options.integration ?? {});
    }
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
}

// The features list from a recorded partner referral request body.
function referralFeatures(requests: RecordedRequest[]): unknown {
  const call = requests.find((r) => r.url.endsWith("/v2/customer/partner-referrals"));
  const body = JSON.parse(call?.body ?? "{}");
  return body.operations?.[0]?.api_integration_preference?.rest_api_integration?.third_party_details?.features;
}

describe.skipIf(!hasTestDatabase)("paypal router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null, paypal?: PayPalServices) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      paypal,
      catalog: createTestCatalogServices(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("requires authentication", async () => {
    const { fetch } = fakePayPalApi({ integration: null });

    await expect(callerFor(null, makePayPal(fetch)).paypal.startOnboarding({ teamId: "team-1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("hides teams the caller cannot administer", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const outsiderId = await seedUser(db, "Outsider");
    const staffId = await addMember(db, { organizationId, role: "member" });
    const { fetch } = fakePayPalApi({ integration: null });
    const paypal = makePayPal(fetch);

    await expect(callerFor(outsiderId, paypal).paypal.startOnboarding({ teamId: store.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // A plain member can open the store but not connect PayPal (services spec §4.1: an admin power).
    await expect(
      callerFor(staffId, paypal).paypal.onboardingStatus({ teamId: store.id, refresh: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fails with PRECONDITION_FAILED when PayPal is not configured", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });

    await expect(callerFor(userId).paypal.startOnboarding({ teamId: store.id })).rejects.toThrow(
      /PayPal is not configured/,
    );
  });

  it("starts onboarding and stores the pending referral", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { requests, fetch } = fakePayPalApi({ integration: null });

    const started = await callerFor(userId, makePayPal(fetch)).paypal.startOnboarding({ teamId: store.id });

    expect(started).toEqual({ actionUrl: ACTION_URL });
    const referralCall = requests.find((r) => r.url.endsWith("/v2/customer/partner-referrals"));
    expect(referralCall?.headers.get("paypal-request-id")).toMatch(/^partner-referral:/);
    expect(JSON.parse(referralCall?.body ?? "{}")).toMatchObject({
      tracking_id: store.id,
      partner_config_override: { return_url: RETURN_URL },
      products: ["EXPRESS_CHECKOUT"],
    });
    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({ trackingId: store.id, actionUrl: ACTION_URL, status: "pending", merchantId: null });
  });

  it("asks PayPal for shipment tracking when a store connects", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { requests, fetch } = fakePayPalApi({ integration: null });

    await callerFor(userId, makePayPal(fetch)).paypal.startOnboarding({ teamId: store.id });

    expect(referralFeatures(requests)).toEqual([...PARTNER_REFERRAL_FEATURES]);
  });

  it("does not ask PayPal for shipment tracking when a services team connects", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "studio" });
    const { requests, fetch } = fakePayPalApi({ integration: null });

    const started = await callerFor(userId, makePayPal(fetch)).paypal.startOnboarding({ teamId: studio.id });

    expect(started).toEqual({ actionUrl: ACTION_URL });
    expect(referralFeatures(requests)).toEqual([
      "PAYMENT",
      "REFUND",
      "PARTNER_FEE",
      "READ_SELLER_DISPUTE",
      "UPDATE_SELLER_DISPUTE",
      "ACCESS_MERCHANT_INFORMATION",
    ]);
  });

  it("refuses a start when the return URL is longer than PayPal's 127-character limit", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { requests, fetch } = fakePayPalApi({ integration: null });
    const paypal = { ...makePayPal(fetch), returnUrl: `https://admin.example.com/${"x".repeat(120)}` };

    await expect(callerFor(userId, paypal).paypal.startOnboarding({ teamId: store.id })).rejects.toThrow(/127/);
    expect(requests).toHaveLength(0);
  });

  it("reports not_connected before anything starts", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { fetch } = fakePayPalApi({ integration: null });

    await expect(
      callerFor(userId, makePayPal(fetch)).paypal.onboardingStatus({ teamId: store.id, refresh: false }),
    ).resolves.toEqual({
      state: "not_connected",
      merchantId: null,
      actionUrl: null,
      paymentsReceivable: null,
      primaryEmailConfirmed: null,
    });
  });

  it("stays pending while PayPal has no integration for the tracking id", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { fetch } = fakePayPalApi({ integration: null });
    const caller = callerFor(userId, makePayPal(fetch));

    await caller.paypal.startOnboarding({ teamId: store.id });

    await expect(caller.paypal.onboardingStatus({ teamId: store.id, refresh: true })).resolves.toEqual({
      state: "pending",
      merchantId: null,
      actionUrl: ACTION_URL,
      paymentsReceivable: null,
      primaryEmailConfirmed: null,
    });
  });

  it("reports needs_attention while PayPal has not cleared the account", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const integration = {
      merchant_id: "SELLER1",
      tracking_id: store.id,
      payments_receivable: false,
      primary_email_confirmed: false,
      oauth_integrations: [],
    };
    const { fetch } = fakePayPalApi({ integration });
    const changed: { id: string; slug: string }[] = [];
    const caller = callerFor(
      userId,
      makePayPal(fetch, (team) => {
        changed.push(team);
      }),
    );
    await caller.paypal.startOnboarding({ teamId: store.id });

    await expect(caller.paypal.onboardingStatus({ teamId: store.id, refresh: true })).resolves.toEqual({
      state: "needs_attention",
      merchantId: "SELLER1",
      actionUrl: ACTION_URL,
      paymentsReceivable: false,
      primaryEmailConfirmed: false,
    });

    const [teamRow] = await db.select({ paypalMerchantId: team.paypalMerchantId }).from(team).where(eq(team.id, store.id));
    expect(teamRow?.paypalMerchantId).toBeNull();
    expect(changed).toEqual([]);
  });

  it("connects the team when PayPal confirms payments and email", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const integration = {
      merchant_id: "SELLER1",
      tracking_id: store.id,
      payments_receivable: true,
      primary_email_confirmed: true,
      primary_email: "seller@example.com",
      oauth_integrations: [
        {
          integration_type: "OAUTH_THIRD_PARTY",
          integration_method: "PAYPAL",
          oauth_third_party: [
            {
              partner_client_id: "partner-client-id",
              merchant_client_id: "seller-client-id",
              scopes: ["https://uri.paypal.com/services/payments/realtimepayment"],
            },
          ],
        },
      ],
    };
    const { fetch } = fakePayPalApi({ integration });
    const changed: { id: string; slug: string }[] = [];
    const caller = callerFor(
      userId,
      makePayPal(fetch, (team) => {
        changed.push(team);
      }),
    );
    await caller.paypal.startOnboarding({ teamId: store.id });

    await expect(caller.paypal.onboardingStatus({ teamId: store.id, refresh: true })).resolves.toEqual({
      state: "connected",
      merchantId: "SELLER1",
      actionUrl: null,
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
    });

    const [teamRow] = await db.select({ paypalMerchantId: team.paypalMerchantId }).from(team).where(eq(team.id, store.id));
    expect(teamRow?.paypalMerchantId).toBe("SELLER1");
    expect(changed).toEqual([{ id: store.id, slug: "acme" }]);
    const row = await findPayPalOnboarding(db, store.id);
    expect(row).toMatchObject({
      status: "connected",
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
    });
    expect(row?.oauthIntegrations?.[0]?.oauthThirdParty[0]?.scopes).toEqual([
      "https://uri.paypal.com/services/payments/realtimepayment",
    ]);
  });

  it("rejects a second start once the team is connected", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    await markTeamPayPalMerchant(db, { teamId: store.id, merchantId: "SELLER1" });
    const { fetch } = fakePayPalApi({ integration: null });

    await expect(callerFor(userId, makePayPal(fetch)).paypal.startOnboarding({ teamId: store.id })).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
  });
});

describe.skipIf(!hasTestDatabase)("refreshPayPalOnboarding", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("refuses a merchant id that does not match the tracking id lookup", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });
    const { fetch } = fakePayPalApi({ integration: { merchant_id: "SELLER1", tracking_id: store.id } });

    await expect(
      refreshPayPalOnboarding({ db, ...makePayPal(fetch) }, store, { merchantIdInPayPal: "ATTACKER99" }),
    ).rejects.toThrow(/does not match/);
    expect(await findPayPalOnboarding(db, store.id)).toBeNull();
    const [teamRow] = await db.select({ paypalMerchantId: team.paypalMerchantId }).from(team).where(eq(team.id, store.id));
    expect(teamRow?.paypalMerchantId).toBeNull();
  });
});
