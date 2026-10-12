import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, importSecretKey, type JsonObject, openSecret } from "@jendal-workspace/core";
import { getTeamPayoutCredentials } from "@jendal-workspace/db/repositories/payout-credentials";
import { insertPayoutRequest, updatePayoutRequest } from "@jendal-workspace/db/repositories/payout-requests";
import { markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import {
  createTestDb,
  hasTestDatabase,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createPayPalClient } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse } from "@jendal-workspace/paypal/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { PayoutServices } from "../context";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { payoutClientForTeam } from "../use-cases/payout-credentials";
import { appRouter } from "./index";

const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const MERCHANT_ID = "MERCHANT1";
const CLIENT_ID = "team-app-client-id-WXYZ";
const CLIENT_SECRET = "team-app-secret";

// PayPal may leave out account_id; null builds that answer.
function balancesAnswer(accountId: string | null): JsonObject {
  const answer: JsonObject = {
    balances: [{ currency: "USD", primary: true, total_balance: { currency_code: "USD", value: "250.00" } }],
    as_of_time: "2026-10-12T00:00:00Z",
  };
  if (accountId !== null) answer.account_id = accountId;
  return answer;
}

// A fake PayPal API for the team's own REST app: token and balances.
function fakeTeamPayPal(options: { token?: () => Response; balances?: () => Response } = {}) {
  return fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return options.token?.() ?? jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.url.includes("/v1/reporting/balances")) {
      return options.balances?.() ?? jsonResponse(200, balancesAnswer(MERCHANT_ID));
    }
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
}

describe.skipIf(!hasTestDatabase)("payouts credentials", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  async function makePayouts(fetchImpl: ReturnType<typeof fakeFetch>["fetch"]) {
    const clientsFor: { teamId: string; clientId: string; clientSecret: string }[] = [];
    const payouts: PayoutServices = {
      secretKey: await importSecretKey(TEST_KEY),
      keyId: "v1",
      clientFor(input) {
        clientsFor.push(input);
        return createPayPalClient({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          environment: "sandbox",
          fetch: fetchImpl,
          sleep: () => Promise.resolve(),
        });
      },
    };
    return { payouts, clientsFor };
  }

  const callerFor = (userId: string, payouts?: PayoutServices) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
      payouts,
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function connectedTeam() {
    const seeded = await seedServicesTeamWithAdmin(db, { slug: "acme-studio" });
    await markTeamPayPalMerchant(db, { teamId: seeded.teamId, merchantId: MERCHANT_ID });
    return seeded;
  }

  it("verifies the credentials with PayPal, stores the secret sealed for the team and never returns it", async () => {
    const { userId, teamId } = await connectedTeam();
    const paypal = fakeTeamPayPal();
    const { payouts, clientsFor } = await makePayouts(paypal.fetch);
    const admin = callerFor(userId, payouts);

    const saved = await admin.payouts.saveCredentials({ teamSlug: "acme-studio", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

    const view = { clientIdEnding: "WXYZ", accountId: MERCHANT_ID, verifiedAt: expect.any(String) };
    expect(saved).toEqual(view);
    await expect(admin.payouts.credentials({ teamSlug: "acme-studio" })).resolves.toEqual(view);
    expect(paypal.requests.map((r) => [r.method, new URL(r.url).pathname + new URL(r.url).search])).toEqual([
      ["POST", "/v1/oauth2/token"],
      ["GET", "/v1/reporting/balances?currency_code=USD"],
    ]);
    expect(paypal.requests[0]?.headers.get("authorization")).toBe(`Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`);

    const row = await getTeamPayoutCredentials(db, teamId);
    expect(row).toMatchObject({ clientId: CLIENT_ID, keyId: "v1", paypalAccountId: MERCHANT_ID });
    expect(row?.secretCiphertext).not.toContain(CLIENT_SECRET);
    const sealed = { ciphertext: row?.secretCiphertext ?? "", iv: row?.secretIv ?? "", keyId: row?.keyId ?? "" };
    await expect(openSecret(payouts.secretKey, sealed, teamId)).resolves.toBe(CLIENT_SECRET);

    await payoutClientForTeam(db, payouts, teamId);
    expect(clientsFor.at(-1)).toEqual({ teamId, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    await expect(admin.servicesTeam.get({ teamSlug: "acme-studio" })).resolves.toMatchObject({
      payoutCredentialsSaved: true,
    });
  });

  it.each([
    {
      case: "a token refusal",
      paypal: () =>
        fakeTeamPayPal({
          token: () => jsonResponse(401, { error: "invalid_client", error_description: "Client Authentication failed" }),
        }),
      message: "PayPal refused these credentials. Check the client ID and secret.",
    },
    {
      case: "a balance refusal",
      paypal: () =>
        fakeTeamPayPal({
          balances: () => jsonResponse(403, { name: "NOT_AUTHORIZED", message: "Insufficient permissions.", debug_id: "d403" }),
        }),
      message:
        "These credentials cannot read the PayPal balance. Turn on the app's balance and payouts features in the PayPal developer dashboard.",
    },
    {
      case: "another PayPal account",
      paypal: () => fakeTeamPayPal({ balances: () => jsonResponse(200, balancesAnswer("OTHERMERCHANT")) }),
      message: "These credentials belong to another PayPal account than the one connected to this team.",
    },
  ])("refuses $case and stores nothing", async ({ paypal, message }) => {
    const { userId } = await connectedTeam();
    const { payouts } = await makePayouts(paypal().fetch);
    const admin = callerFor(userId, payouts);

    await expect(
      admin.payouts.saveCredentials({ teamSlug: "acme-studio", clientId: CLIENT_ID, clientSecret: "wrong-secret" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message });
    await expect(admin.payouts.credentials({ teamSlug: "acme-studio" })).resolves.toBeNull();
  });

  it("stores no account when PayPal does not report which account the credentials belong to", async () => {
    const { userId, teamId } = await connectedTeam();
    const { payouts } = await makePayouts(fakeTeamPayPal({ balances: () => jsonResponse(200, balancesAnswer(null)) }).fetch);
    const admin = callerFor(userId, payouts);

    await expect(
      admin.payouts.saveCredentials({ teamSlug: "acme-studio", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    ).resolves.toMatchObject({ clientIdEnding: "WXYZ", accountId: null });
    await expect(getTeamPayoutCredentials(db, teamId)).resolves.toMatchObject({ paypalAccountId: null });
  });

  // Saved credentials for MERCHANT1 and a payout PayPal is working on; `report` sets the account the next balance
  // answer names.
  async function teamWithSentPayout() {
    const { userId, teamId } = await connectedTeam();
    let reported: string | null = MERCHANT_ID;
    const paypal = fakeTeamPayPal({ balances: () => jsonResponse(200, balancesAnswer(reported)) });
    const { payouts } = await makePayouts(paypal.fetch);
    const admin = callerFor(userId, payouts);
    await admin.payouts.saveCredentials({ teamSlug: "acme-studio", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const request = await insertPayoutRequest(db, {
      id: crypto.randomUUID(),
      teamId,
      userId: await seedUser(db, "Ada"),
      currency: "USD",
      amountMinor: 2_500,
      receiverPayerId: "G83JXTJ5EHCQ2",
    });
    await updatePayoutRequest(db, request?.id ?? "", { status: "sent", paypalBatchId: "BATCH1" });
    return {
      admin,
      teamId,
      report: (accountId: string | null) => {
        reported = accountId;
      },
    };
  }

  const inProgress = { code: "CONFLICT", message: "Wait for the payouts in progress to finish." };
  const otherApp = { teamSlug: "acme-studio", clientId: "other-app-ABCD", clientSecret: "other-secret" };

  it("replaces the credentials while a payout is with PayPal when they belong to the same account, but never removes them", async () => {
    const { admin } = await teamWithSentPayout();

    await expect(admin.payouts.saveCredentials(otherApp)).resolves.toMatchObject({
      clientIdEnding: "ABCD",
      accountId: MERCHANT_ID,
    });
    await expect(admin.payouts.removeCredentials({ teamSlug: "acme-studio" })).rejects.toMatchObject(inProgress);
    await expect(admin.payouts.credentials({ teamSlug: "acme-studio" })).resolves.toMatchObject({ clientIdEnding: "ABCD" });
  });

  it.each([
    { case: "another account than the saved one", merchantId: "MERCHANT2", reported: "MERCHANT2" },
    { case: "no account", merchantId: MERCHANT_ID, reported: null },
  ])("refuses replacing the credentials while a payout is with PayPal when PayPal reports $case", async (row) => {
    const { admin, teamId, report } = await teamWithSentPayout();
    await markTeamPayPalMerchant(db, { teamId, merchantId: row.merchantId });
    report(row.reported);

    await expect(admin.payouts.saveCredentials(otherApp)).rejects.toMatchObject(inProgress);
    await expect(admin.payouts.credentials({ teamSlug: "acme-studio" })).resolves.toMatchObject({
      clientIdEnding: "WXYZ",
      accountId: MERCHANT_ID,
    });
  });

  it("lets only admins see or change the credentials", async () => {
    const { organizationId, teamId } = await connectedTeam();
    const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { payouts } = await makePayouts(fakeTeamPayPal().fetch);
    const freelancer = callerFor(freelancerId, payouts);

    const forbidden = { code: "FORBIDDEN", message: "Only an admin can change the team settings." };
    await expect(
      freelancer.payouts.saveCredentials({ teamSlug: "acme-studio", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    ).rejects.toMatchObject(forbidden);
    await expect(freelancer.payouts.credentials({ teamSlug: "acme-studio" })).rejects.toMatchObject(forbidden);
    await expect(freelancer.payouts.removeCredentials({ teamSlug: "acme-studio" })).rejects.toMatchObject(forbidden);
  });
});
