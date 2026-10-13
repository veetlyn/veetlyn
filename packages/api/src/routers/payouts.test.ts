import { createTestAuth } from "@jendal-workspace/auth/testing";
import {
  completionTransfer,
  createFakeFileStore,
  importSecretKey,
  type JsonObject,
  openSecret,
  paymentCapturedTransfer,
} from "@jendal-workspace/core";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import { getTeamPayoutCredentials } from "@jendal-workspace/db/repositories/payout-credentials";
import { insertPayoutRequest, updatePayoutRequest } from "@jendal-workspace/db/repositories/payout-requests";
import { deletePayoutDestination, savePayoutDestination } from "@jendal-workspace/db/repositories/payouts";
import { getTeamPayPalCountry, markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { payoutConnectAttempt, payoutRequest } from "@jendal-workspace/db/schema/payouts";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProject,
  seedServicesTeam,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createPayPalClient, type FetchLike } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PayoutServices, PayPalServices } from "../context";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const MERCHANT_ID = "MERCHANT1";
const PARTNER_ID = "PARTNER42";
const CLIENT_ID = "team-app-client-id-WXYZ";
const CLIENT_SECRET = "team-app-secret";
const AUTH_CODE = "auth-code-1";
const SHARED_ID = "shared-id-1";
const ACTION_URL = "https://www.sandbox.paypal.com/bizsignup/entry?token=REF-1";
const CREDENTIALS_PATH = `/v1/customer/partners/${PARTNER_ID}/merchant-integrations/credentials/`;

const PAYOUTS_SCOPE = "https://uri.paypal.com/payments/payouts";
const PARTNER_APP_AUTH = `Basic ${btoa("partner-client-id:partner-secret")}`;

function teamTokenAnswer(scope = `https://uri.paypal.com/services/payments/refund ${PAYOUTS_SCOPE} openid`): Response {
  return jsonResponse(200, { ...FAKE_TOKEN_RESPONSE, scope });
}

function sellerCredentialsAnswer(payerId = MERCHANT_ID, clientId = CLIENT_ID): Response {
  return jsonResponse(200, { client_id: clientId, client_secret: CLIENT_SECRET, payer_id: payerId });
}

// Answers of the fake PayPal API; a test may swap one between calls.
type TeamPayPalAnswers = {
  exchange?: () => Response;
  sellerCredentials?: () => Response;
  // The token answer for the team's own REST app.
  teamToken?: () => Response;
  payout?: () => Response;
  batch?: () => Response;
};

// A fake PayPal API for the partner app (first-party referral, the seller's authorization code and credentials) and
// for the team's own REST app (token, payouts).
function fakeTeamPayPal(answers: TeamPayPalAnswers = {}) {
  return fakeFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path === "/v1/oauth2/token") {
      const grant = new URLSearchParams(request.body ?? "").get("grant_type");
      if (grant === "authorization_code") {
        return answers.exchange?.() ?? jsonResponse(200, { access_token: "seller-token", expires_in: 28800 });
      }
      if (request.headers.get("authorization") === PARTNER_APP_AUTH) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      return answers.teamToken?.() ?? teamTokenAnswer();
    }
    if (path === "/v2/customer/partner-referrals") {
      return jsonResponse(201, { links: [{ href: ACTION_URL, rel: "action_url", method: "GET" }] });
    }
    if (path === CREDENTIALS_PATH) return answers.sellerCredentials?.() ?? sellerCredentialsAnswer();
    if (path.startsWith(`/v1/customer/partners/${PARTNER_ID}/merchant-integrations/`)) {
      return jsonResponse(200, { merchant_id: path.split("/").at(-1) ?? "", country: "US" });
    }
    if (path === "/v1/payments/payouts" && answers.payout) return answers.payout();
    if (path.startsWith("/v1/payments/payouts/") && answers.batch) return answers.batch();
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
}

// While `on`, payout POSTs wait in `held` until the test answers them by hand.
type PayoutGate = { on: boolean; held: { request: Request; answer: (response: Response) => void }[] };

const pathOf = (request: RecordedRequest) => new URL(request.url).pathname;
const payoutPosts = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.method === "POST" && pathOf(r) === "/v1/payments/payouts");
const teamTokenCalls = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.headers.get("authorization") === `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`);

// The first-party details of the recorded referral.
function referralDetails(requests: RecordedRequest[]): JsonObject {
  const call = requests.find((r) => pathOf(r) === "/v2/customer/partner-referrals");
  return JSON.parse(call?.body ?? "{}").operations[0].api_integration_preference.rest_api_integration;
}

const TEAM = { teamSlug: "acme-studio" };

describe.skipIf(!hasTestDatabase)("payouts", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  type Services = { payouts: PayoutServices; paypal: PayPalServices };

  async function makePayouts(fetchImpl: FetchLike): Promise<Services> {
    const client = (clientId: string, clientSecret: string) =>
      createPayPalClient({ clientId, clientSecret, environment: "sandbox", fetch: fetchImpl, sleep: () => Promise.resolve() });
    const payouts: PayoutServices = {
      secretKey: await importSecretKey(TEST_KEY),
      keyId: "v1",
      clientFor: (input) => client(input.clientId, input.clientSecret),
    };
    const paypal: PayPalServices = {
      client: client("partner-client-id", "partner-secret"),
      partnerId: PARTNER_ID,
      returnUrl: "https://admin.example.com/api/paypal/onboarding/return",
      sdk: { clientId: "partner-client-id", partnerAttributionId: "PAYLEOR_BN", environment: "sandbox" },
    };
    return { payouts, paypal };
  }

  const callerFor = (userId: string, services?: Services) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
      payouts: services?.payouts,
      paypal: services?.paypal,
    });

  type Caller = ReturnType<typeof callerFor>;

  async function turnOnAutomaticPayouts(admin: Caller) {
    const { attemptId } = await admin.payouts.connectStart(TEAM);
    return admin.payouts.connectComplete({ ...TEAM, attemptId, authCode: AUTH_CODE, sharedId: SHARED_ID });
  }

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function connectedTeam() {
    const seeded = await seedServicesTeamWithAdmin(db, { slug: "acme-studio" });
    await markTeamPayPalMerchant(db, { teamId: seeded.teamId, merchantId: MERCHANT_ID });
    return seeded;
  }

  it("starts PayPal's first-party onboarding with a fresh seller nonce for the team", async () => {
    const { userId, teamId } = await connectedTeam();
    const paypal = fakeTeamPayPal();
    const admin = callerFor(userId, await makePayouts(paypal.fetch));

    const started = await admin.payouts.connectStart(TEAM);

    expect(started).toEqual({ actionUrl: ACTION_URL, attemptId: expect.any(String) });
    const [attempt] = await db.select().from(payoutConnectAttempt).where(eq(payoutConnectAttempt.id, started.attemptId));
    expect(attempt).toMatchObject({ teamId, createdByUserId: userId, usedAt: null });
    expect(attempt?.sellerNonce).toMatch(/^[\w-]{86}$/);
    expect(referralDetails(paypal.requests)).toEqual({
      integration_method: "PAYPAL",
      integration_type: "FIRST_PARTY",
      first_party_details: { features: ["PAYMENT", "REFUND", "PAYOUTS"], seller_nonce: attempt?.sellerNonce },
    });
    const referral = paypal.requests.find((r) => pathOf(r) === "/v2/customer/partner-referrals");
    expect(JSON.parse(referral?.body ?? "").partner_config_override).toEqual({
      return_url: "https://admin.example.com/acme-studio/payouts",
    });
  });

  it("saves the credentials PayPal shares after consent, sealed for the team, and never returns them", async () => {
    const { userId, teamId } = await connectedTeam();
    const paypal = fakeTeamPayPal();
    const services = await makePayouts(paypal.fetch);
    const admin = callerFor(userId, services);
    const { attemptId } = await admin.payouts.connectStart(TEAM);

    const saved = await admin.payouts.connectComplete({ ...TEAM, attemptId, authCode: AUTH_CODE, sharedId: SHARED_ID });

    const view = { accountId: MERCHANT_ID, verifiedAt: expect.any(String) };
    expect(saved).toEqual(view);
    await expect(admin.payouts.credentials(TEAM)).resolves.toEqual(view);
    const [attempt] = await db.select().from(payoutConnectAttempt).where(eq(payoutConnectAttempt.id, attemptId));
    const exchange = paypal.requests.find((r) => new URLSearchParams(r.body ?? "").get("grant_type") === "authorization_code");
    expect(exchange?.headers.get("authorization")).toBe(`Basic ${btoa(`${SHARED_ID}:`)}`);
    expect(new URLSearchParams(exchange?.body ?? "").get("code_verifier")).toBe(attempt?.sellerNonce);
    expect(attempt?.usedAt).toEqual(expect.any(Date));
    // The shared credentials must get a token with the payouts scope before they are kept.
    expect(teamTokenCalls(paypal.requests)).toHaveLength(1);

    const row = await getTeamPayoutCredentials(db, teamId);
    expect(row).toMatchObject({ clientId: CLIENT_ID, keyId: "v1", paypalAccountId: MERCHANT_ID });
    expect(row?.secretCiphertext).not.toContain(CLIENT_SECRET);
    const sealed = { ciphertext: row?.secretCiphertext ?? "", iv: row?.secretIv ?? "", keyId: row?.keyId ?? "" };
    await expect(openSecret(services.payouts.secretKey, sealed, teamId)).resolves.toBe(CLIENT_SECRET);

    await expect(admin.servicesTeam.get(TEAM)).resolves.toMatchObject({ payoutCredentialsSaved: true });
    // Teams connected before Payleor kept the PayPal country get it now; it sets PayPal's payout fee.
    await expect(getTeamPayPalCountry(db, teamId)).resolves.toBe("US");
  });

  const CONNECT_EXPIRED = { code: "BAD_REQUEST", message: "This PayPal connection expired. Turn on automatic payouts again." };

  it.each([
    {
      case: "credentials of another PayPal account",
      answers: { sellerCredentials: () => sellerCredentialsAnswer("OTHERMERCHANT") },
      error: { code: "PRECONDITION_FAILED", message: "Connect the PayPal account this team already uses (••••ANT1)." },
    },
    {
      case: "PayPal refusing the authorization code",
      answers: { exchange: () => jsonResponse(400, { error: "invalid_grant", error_description: "Invalid code" }) },
      error: { code: "BAD_GATEWAY", message: "PayPal did not confirm the connection. Try again." },
    },
    {
      case: "credentials whose token lacks the payouts scope",
      answers: { teamToken: () => teamTokenAnswer("https://uri.paypal.com/services/payments/refund openid") },
      error: {
        code: "PRECONDITION_FAILED",
        message: "PayPal has not turned on Payouts for this PayPal account. Ask PayPal to turn it on, then try again.",
      },
    },
    {
      case: "credentials PayPal will not give a token",
      answers: {
        teamToken: () => jsonResponse(401, { error: "invalid_client", error_description: "Client Authentication failed" }),
      },
      error: { code: "BAD_GATEWAY", message: "PayPal did not confirm the connection. Try again." },
    },
    {
      case: "PayPal failing to answer for the credentials' token",
      answers: { teamToken: () => jsonResponse(500, { name: "INTERNAL_SERVICE_ERROR", debug_id: "d500" }) },
      error: { code: "BAD_GATEWAY", message: "PayPal did not answer. Try again." },
    },
  ])("refuses $case and saves nothing", async ({ answers, error }) => {
    const { userId } = await connectedTeam();
    const admin = callerFor(userId, await makePayouts(fakeTeamPayPal(answers).fetch));

    await expect(turnOnAutomaticPayouts(admin)).rejects.toMatchObject(error);
    await expect(admin.payouts.credentials(TEAM)).resolves.toBeNull();
  });

  it.each([
    {
      case: "is more than an hour old",
      spoil: async (attemptId: string) => {
        await db
          .update(payoutConnectAttempt)
          .set({ createdAt: new Date(Date.now() - 61 * 60_000) })
          .where(eq(payoutConnectAttempt.id, attemptId));
      },
    },
    {
      case: "was already used",
      spoil: async (attemptId: string) => {
        await db.update(payoutConnectAttempt).set({ usedAt: new Date() }).where(eq(payoutConnectAttempt.id, attemptId));
      },
    },
    {
      case: "belongs to another team",
      spoil: async (attemptId: string) => {
        const other = await seedServicesTeamWithAdmin(db, { slug: "other-studio" });
        await db.update(payoutConnectAttempt).set({ teamId: other.teamId }).where(eq(payoutConnectAttempt.id, attemptId));
      },
    },
  ])("refuses a connection whose attempt $case, before asking PayPal", async ({ spoil }) => {
    const { userId } = await connectedTeam();
    const paypal = fakeTeamPayPal();
    const admin = callerFor(userId, await makePayouts(paypal.fetch));
    const { attemptId } = await admin.payouts.connectStart(TEAM);
    await spoil(attemptId);
    paypal.requests.splice(0);

    await expect(
      admin.payouts.connectComplete({ ...TEAM, attemptId, authCode: AUTH_CODE, sharedId: SHARED_ID }),
    ).rejects.toMatchObject(CONNECT_EXPIRED);
    expect(paypal.requests).toEqual([]);
    await expect(admin.payouts.credentials(TEAM)).resolves.toBeNull();
  });

  it("refuses a connection started by another admin of the team, before asking PayPal", async () => {
    const { userId, organizationId, teamId } = await connectedTeam();
    const otherAdminId = await seedServicesTeamMember(db, { organizationId, teamId, role: "admin", name: "Bo" });
    const paypal = fakeTeamPayPal();
    const services = await makePayouts(paypal.fetch);
    const { attemptId } = await callerFor(userId, services).payouts.connectStart(TEAM);
    paypal.requests.splice(0);

    const otherAdmin = callerFor(otherAdminId, services);
    await expect(
      otherAdmin.payouts.connectComplete({ ...TEAM, attemptId, authCode: AUTH_CODE, sharedId: SHARED_ID }),
    ).rejects.toMatchObject(CONNECT_EXPIRED);
    expect(paypal.requests).toEqual([]);
    await expect(otherAdmin.payouts.credentials(TEAM)).resolves.toBeNull();
  });

  it("refuses to start a connection whose return URL PayPal would reject, and keeps no attempt", async () => {
    const slug = `studio-${"a".repeat(100)}`;
    const seeded = await seedServicesTeamWithAdmin(db, { slug });
    await markTeamPayPalMerchant(db, { teamId: seeded.teamId, merchantId: MERCHANT_ID });
    const paypal = fakeTeamPayPal();
    const admin = callerFor(seeded.userId, await makePayouts(paypal.fetch));

    await expect(admin.payouts.connectStart({ teamSlug: slug })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "The PayPal return URL is longer than 127 characters.",
    });
    expect(paypal.requests).toEqual([]);
    await expect(db.select().from(payoutConnectAttempt)).resolves.toEqual([]);
  });

  it("keeps no connection attempt when PayPal does not start the onboarding", async () => {
    const { userId } = await connectedTeam();
    const failing = fakeFetch(() => jsonResponse(500, { name: "INTERNAL_SERVICE_ERROR", debug_id: "d500" }));
    const admin = callerFor(userId, await makePayouts(failing.fetch));

    await expect(admin.payouts.connectStart(TEAM)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: "PayPal did not answer. Try again.",
    });
    await expect(db.select().from(payoutConnectAttempt)).resolves.toEqual([]);
  });

  // Credentials saved for MERCHANT1 and a payout PayPal is working on; the next shared credentials carry `clientId`.
  async function teamWithSentPayout() {
    const { userId, teamId } = await connectedTeam();
    const answers: TeamPayPalAnswers = {};
    const admin = callerFor(userId, await makePayouts(fakeTeamPayPal(answers).fetch));
    await turnOnAutomaticPayouts(admin);
    const request = await insertPayoutRequest(db, {
      id: crypto.randomUUID(),
      teamId,
      userId: await seedUser(db, "Ada"),
      currency: "USD",
      amountMinor: 2_500,
      receiverPayerId: "G83JXTJ5EHCQ2",
    });
    await updatePayoutRequest(db, request?.id ?? "", { status: "sent", paypalBatchId: "BATCH1" });
    return { admin, teamId, answers };
  }

  const inProgress = { code: "CONFLICT", message: "Wait for the payouts in progress to finish." };

  it("replaces the credentials while a payout is with PayPal when they belong to the same account, but never removes them", async () => {
    const { admin, teamId, answers } = await teamWithSentPayout();
    answers.sellerCredentials = () => sellerCredentialsAnswer(MERCHANT_ID, "other-app");

    await expect(turnOnAutomaticPayouts(admin)).resolves.toMatchObject({ accountId: MERCHANT_ID });
    await expect(admin.payouts.removeCredentials(TEAM)).rejects.toMatchObject(inProgress);
    await expect(getTeamPayoutCredentials(db, teamId)).resolves.toMatchObject({ clientId: "other-app" });
  });

  it("refuses replacing the credentials while a payout is with PayPal when the team now uses another account", async () => {
    const { admin, teamId, answers } = await teamWithSentPayout();
    await markTeamPayPalMerchant(db, { teamId, merchantId: "MERCHANT2" });
    answers.sellerCredentials = () => sellerCredentialsAnswer("MERCHANT2", "other-app");

    await expect(turnOnAutomaticPayouts(admin)).rejects.toMatchObject(inProgress);
    await expect(getTeamPayoutCredentials(db, teamId)).resolves.toMatchObject({
      clientId: CLIENT_ID,
      paypalAccountId: MERCHANT_ID,
    });
  });

  it("lets only admins see or change the credentials", async () => {
    const { organizationId, teamId } = await connectedTeam();
    const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const freelancer = callerFor(freelancerId, await makePayouts(fakeTeamPayPal().fetch));

    const forbidden = { code: "FORBIDDEN", message: "Only an admin can change the team settings." };
    await expect(freelancer.payouts.connectStart(TEAM)).rejects.toMatchObject(forbidden);
    await expect(
      freelancer.payouts.connectComplete({ ...TEAM, attemptId: "attempt", authCode: AUTH_CODE, sharedId: SHARED_ID }),
    ).rejects.toMatchObject(forbidden);
    await expect(freelancer.payouts.credentials(TEAM)).rejects.toMatchObject(forbidden);
    await expect(freelancer.payouts.removeCredentials(TEAM)).rejects.toMatchObject(forbidden);
  });

  const PAYER_ID = "G83JXTJ5EHCQ2";
  const LOW_BALANCE = "The team's PayPal balance is too low. Add funds, then retry.";
  const receiverRefusal = {
    name: "UNPROCESSABLE_ENTITY",
    message: "Receiver is unregistered.",
    details: [{ issue: "RECEIVER_UNREGISTERED", description: "Receiver is unregistered." }],
    debug_id: "d422",
  };

  // A completed $1,000 project with a 15% team cut: $850 owed to the freelancer, $150 team revenue.
  async function earn(teamId: string, freelancerId: string) {
    const projectId = await seedProject(db, { teamId });
    await db.transaction((tx) =>
      createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({
          currency: "USD",
          projectId,
          paymentId: crypto.randomUUID(),
          quotePartMinor: 100_000,
          managementFeeMinor: 0,
        }),
        completionTransfer({ currency: "USD", projectId, freelancerId, finalPriceMinor: 100_000, teamCutBps: 1_500 }),
      ]),
    );
  }

  async function confirmedDestination(userId: string, paypalCountry: string | null = "US") {
    await savePayoutDestination(
      db,
      userId,
      { paypalPayerId: PAYER_ID, paypalEmail: "ada@example.com", paypalCountry },
      { confirmedAt: new Date(), source: "self" },
    );
  }

  function batchCreated(batchId: string) {
    return jsonResponse(201, {
      batch_header: { payout_batch_id: batchId, batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } },
    });
  }

  function batchAnswer(requestId: string, item: JsonObject) {
    return jsonResponse(200, {
      batch_header: { payout_batch_id: "BATCH1", batch_status: "SUCCESS" },
      items: [
        {
          payout_item_id: "ITEM1",
          payout_item: { sender_item_id: requestId, receiver: PAYER_ID, amount: { value: "500.00", currency: "USD" } },
          ...item,
        },
      ],
    });
  }

  // Automatic payouts on for MERCHANT1, a US account, and Ada, a
  // freelancer owed $850 with a confirmed destination in `memberCountry`: between two US accounts PayPal's fee is
  // estimated at $0.25. PayPal requests made while turning payouts on are dropped. While `gate.on` is true, each
  // payout POST waits in `gate.held` until the test answers it, so two sends can interleave.
  async function payoutTeam(memberCountry: string | null = "US") {
    const { userId: adminId, organizationId, teamId } = await connectedTeam();
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Ada" });
    await confirmedDestination(memberId, memberCountry);
    await earn(teamId, memberId);
    const answers: TeamPayPalAnswers = { payout: () => batchCreated("BATCH1") };
    const paypal = fakeTeamPayPal(answers);
    const gate: PayoutGate = { on: false, held: [] };
    const gatedFetch: FetchLike = (request) =>
      gate.on && new URL(request.url).pathname === "/v1/payments/payouts"
        ? new Promise((resolve) => gate.held.push({ request, answer: resolve }))
        : paypal.fetch(request);
    const services = await makePayouts(gatedFetch);
    const admin = callerFor(adminId, services);
    await turnOnAutomaticPayouts(admin);
    paypal.requests.splice(0);
    return { organizationId, teamId, memberId, admin, member: callerFor(memberId, services), answers, paypal, services, gate };
  }

  const batchIdsOf = (posts: RecordedRequest[]) =>
    posts.map((post) => [post.headers.get("paypal-request-id"), JSON.parse(post.body ?? "").sender_batch_header.sender_batch_id]);

  async function ledgerOf(teamId: string, userId: string) {
    const rows = await db.select().from(ledgerBalance).where(eq(ledgerBalance.teamId, teamId));
    const balance = (account: string) => rows.find((row) => row.account === account)?.balanceMinor ?? 0;
    return {
      available: balance(`owed:${userId}:available`),
      reserved: balance(`owed:${userId}:reserved`),
      paidOut: balance(`paid_out:${userId}`),
      teamRevenue: balance("team_revenue"),
      paypalFees: balance("paypal_fees"),
    };
  }

  async function payoutReferences(teamId: string) {
    const rows = await db
      .select({ reference: ledgerTransfer.reference })
      .from(ledgerTransfer)
      .where(eq(ledgerTransfer.teamId, teamId));
    return rows
      .map((row) => row.reference)
      .filter((reference) => reference.startsWith("payout_"))
      .sort();
  }

  it("pays an approved request less PayPal's estimated fee from the team's PayPal account and settles it once", async () => {
    const { teamId, memberId, admin, member, answers, paypal } = await payoutTeam();

    const requested = await member.payouts.request({ ...TEAM, amount: "500.00" });
    const { id } = requested;
    expect(requested).toMatchObject({ status: "requested", amountMinor: 50_000, receiverPayerId: PAYER_ID, teamSlug: "acme-studio" });
    expect(await ledgerOf(teamId, memberId)).toEqual({
      available: 35_000,
      reserved: 50_000,
      paidOut: 0,
      teamRevenue: 15_000,
      paypalFees: 0,
    });

    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "sent",
      paypalBatchId: "BATCH1",
      feeEstimateMinor: 25,
      sentMinor: 49_975,
      failureMessage: null,
      uncertain: false,
    });
    const posts = payoutPosts(paypal.requests);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.headers.get("paypal-request-id")).toBe(`payout:${id}:0`);
    expect(JSON.parse(posts[0]?.body ?? "")).toEqual({
      sender_batch_header: { sender_batch_id: `${id}-0`, email_subject: "You have a payout from acme-studio" },
      items: [
        {
          recipient_type: "PAYPAL_ID",
          receiver: PAYER_ID,
          amount: { value: "499.75", currency: "USD" },
          note: "Payout from acme-studio via Payleor",
          sender_item_id: id,
        },
      ],
    });

    answers.batch = () =>
      batchAnswer(id, { transaction_status: "SUCCESS", payout_item_fee: { currency: "USD", value: "0.25" } });
    await expect(admin.payouts.refresh({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "succeeded",
      paypalItemStatus: "SUCCESS",
      feeMinor: 25,
      reviewReason: null,
    });
    expect(paypal.requests.map((r) => `${r.method} ${pathOf(r)}`).at(-1)).toBe("GET /v1/payments/payouts/BATCH1");
    // The team's balance paid the $0.25 fee and took it back from Ada's payout.
    const settled = { available: 35_000, reserved: 0, paidOut: 49_975, teamRevenue: 15_000, paypalFees: 25 };
    expect(await ledgerOf(teamId, memberId)).toEqual(settled);

    await admin.payouts.refresh({ ...TEAM, requestId: id });
    expect(await ledgerOf(teamId, memberId)).toEqual(settled);
    expect(await payoutReferences(teamId)).toEqual([
      `payout_fee_recovered:${id}`,
      `payout_fees:${id}`,
      `payout_requested:${id}`,
      `payout_succeeded:${id}`,
    ]);

    await expect(member.payouts.mine()).resolves.toEqual({
      earnings: [
        {
          teamId,
          teamName: "acme-studio",
          teamSlug: "acme-studio",
          currency: "USD",
          availableMinor: 35_000,
          reservedMinor: 0,
          paidOutMinor: 49_975,
          senderCountry: "US",
          receiverCountry: "US",
        },
      ],
      requests: [
        expect.objectContaining({
          id,
          status: "succeeded",
          sentMinor: 49_975,
          feeMinor: 25,
          teamName: "acme-studio",
          teamSlug: "acme-studio",
        }),
      ],
    });
    await expect(admin.payouts.list(TEAM)).resolves.toEqual([
      expect.objectContaining({ id, userId: memberId, memberName: "Ada", status: "succeeded", sentMinor: 49_975, feeMinor: 25 }),
    ]);
  });

  it("estimates PayPal's international fee when PayPal did not share the member's country", async () => {
    const { admin, member, paypal } = await payoutTeam(null);
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });

    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "sent",
      feeEstimateMinor: 1_000,
      sentMinor: 49_000,
    });
    expect(JSON.parse(payoutPosts(paypal.requests)[0]?.body ?? "").items[0].amount).toEqual({ value: "490.00", currency: "USD" });
  });

  it.each([
    {
      case: "below the estimate releases the rest of the estimate to the member",
      fee: { currency: "USD", value: "0.10" },
      feeMinor: 10,
      reviewReason: null,
      ledger: { available: 35_015, teamRevenue: 15_000, paypalFees: 10 },
      released: true,
    },
    {
      case: "above the estimate is absorbed by the team",
      fee: { currency: "USD", value: "0.40" },
      feeMinor: 40,
      reviewReason: null,
      ledger: { available: 35_000, teamRevenue: 14_985, paypalFees: 40 },
      released: false,
    },
    {
      case: "in another currency stands at the estimate and is flagged for review",
      fee: { currency: "EUR", value: "0.23" },
      feeMinor: null,
      reviewReason: "Payout fee in another currency",
      ledger: { available: 35_000, teamRevenue: 15_000, paypalFees: 25 },
      released: false,
    },
    {
      case: "unreadable stands at the estimate and is flagged for review",
      fee: { currency: "USD", value: "abc" },
      feeMinor: null,
      reviewReason: "Payout fee unreadable",
      ledger: { available: 35_000, teamRevenue: 15_000, paypalFees: 25 },
      released: false,
    },
    {
      case: "missing stands at the estimate and is flagged for review",
      fee: undefined,
      feeMinor: null,
      reviewReason: "Payout fee missing",
      ledger: { available: 35_000, teamRevenue: 15_000, paypalFees: 25 },
      released: false,
    },
  ])("settles a payout whose PayPal fee $case", async ({ fee, feeMinor, reviewReason, ledger, released }) => {
    const { teamId, memberId, admin, member, answers } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    await admin.payouts.approve({ ...TEAM, requestId: id });

    answers.batch = () =>
      batchAnswer(id, fee ? { transaction_status: "SUCCESS", payout_item_fee: fee } : { transaction_status: "SUCCESS" });
    await expect(admin.payouts.refresh({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "succeeded",
      feeMinor,
      reviewReason,
    });
    expect(await ledgerOf(teamId, memberId)).toEqual({ reserved: 0, paidOut: 49_975, ...ledger });
    expect(await payoutReferences(teamId)).toEqual(
      [
        `payout_fee_recovered:${id}`,
        `payout_fees:${id}`,
        ...(released ? [`payout_released:${id}`] : []),
        `payout_requested:${id}`,
        `payout_succeeded:${id}`,
      ].sort(),
    );
  });

  it("refuses to approve a payout that became too small to cover PayPal's fee after it was requested", async () => {
    // The 2% international estimate leaves $1.17 of $1.20; once the member's account reads as US, the flat $0.25
    // fee leaves $0.95, below PayPal's minimum.
    const { teamId, memberId, admin, member, paypal } = await payoutTeam(null);
    const { id } = await member.payouts.request({ ...TEAM, amount: "1.20" });
    await confirmedDestination(memberId, "US");

    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This payout is too small to cover PayPal's fee.",
    });
    await expect(admin.payouts.list(TEAM)).resolves.toEqual([
      expect.objectContaining({ id, status: "requested", decidedAt: null, sentMinor: null }),
    ]);
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 84_880, reserved: 120 });
    expect(paypal.requests).toEqual([]);
  });

  it("leaves a payout sent and flags it for review when PayPal's batch only has another payout's item", async () => {
    const { teamId, admin, member, answers } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    await admin.payouts.approve({ ...TEAM, requestId: id });

    answers.batch = () => batchAnswer("another-request", { transaction_status: "FAILED" });
    await expect(admin.payouts.refresh({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "sent",
      reviewReason: "PayPal's batch has no item for this payout",
      settledAt: null,
    });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);
  });

  it("releases the reserved earnings when an admin rejects the request, and accepts a new one", async () => {
    const { teamId, memberId, admin, member, paypal } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });

    await expect(admin.payouts.reject({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "rejected",
      decidedAt: expect.any(String),
    });
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 85_000, reserved: 0 });
    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).rejects.toMatchObject({
      message: "This payout request was already decided.",
    });

    await expect(member.payouts.request({ ...TEAM, amount: "850.00" })).resolves.toMatchObject({ status: "requested" });
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 0, reserved: 85_000 });
    expect(paypal.requests).toEqual([]);
  });

  it("keeps an approved request queued with its earnings reserved when PayPal answers INSUFFICIENT_FUNDS, and sends it on retry with fresh ids", async () => {
    const { teamId, memberId, admin, member, answers, paypal } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    answers.payout = () =>
      jsonResponse(422, {
        name: "UNPROCESSABLE_ENTITY",
        message: "Sender does not have sufficient funds.",
        details: [{ issue: "INSUFFICIENT_FUNDS" }],
        debug_id: "d422",
      });

    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "queued",
      failureMessage: LOW_BALANCE,
      decidedAt: expect.any(String),
    });
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 35_000, reserved: 50_000, paidOut: 0 });

    answers.payout = () => batchCreated("BATCH1");
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "sent",
      failureMessage: null,
    });
    expect(batchIdsOf(payoutPosts(paypal.requests))).toEqual([
      [`payout:${id}:0`, `${id}-0`],
      [`payout:${id}:1`, `${id}-1`],
    ]);
  });

  const authenticationFailure = { name: "AUTHENTICATION_FAILURE", message: "Authentication failed.", debug_id: "d401" };

  it.each([
    {
      case: "refuses the team's token",
      refuse: (answers: TeamPayPalAnswers) => {
        answers.teamToken = () => jsonResponse(401, { error: "invalid_client", error_description: "Client Authentication failed" });
      },
    },
    {
      case: "refuses the payout as unauthenticated",
      refuse: (answers: TeamPayPalAnswers) => {
        answers.payout = () => jsonResponse(401, authenticationFailure);
      },
    },
  ])("keeps an approved request queued with its earnings reserved when PayPal $case", async ({ refuse }) => {
    const { teamId, memberId, admin, member, answers } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    refuse(answers);

    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "queued",
      failureMessage: "PayPal refused the team's automatic payouts connection. Turn on automatic payouts again.",
    });
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 35_000, reserved: 50_000, paidOut: 0 });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);
  });

  const UNCERTAIN = {
    code: "BAD_GATEWAY",
    message: "We could not confirm the payout with PayPal. Try again; the member will not be paid twice.",
  };

  function duplicateRefusal(batchId: string) {
    return jsonResponse(400, {
      name: "USER_BUSINESS_ERROR",
      message: "Batch with given sender_batch_id already exists",
      debug_id: "d400",
      links: [{ href: `https://api-m.sandbox.paypal.com/v1/payments/payouts/${batchId}`, rel: "self", method: "GET" }],
    });
  }

  it.each([
    {
      case: "the batch it created",
      answer: (answers: TeamPayPalAnswers) => {
        answers.payout = () => batchCreated("BATCH1");
      },
      batchId: "BATCH1",
    },
    {
      case: "a duplicate refusal linking that batch",
      answer: (answers: TeamPayPalAnswers, requestId: string) => {
        answers.payout = () => duplicateRefusal("BATCH-FIRST");
        answers.batch = () => batchAnswer(requestId, { transaction_status: "PENDING" });
      },
      batchId: "BATCH-FIRST",
    },
  ])("keeps an unconfirmed send open and resends the same batch until PayPal answers with $case", async (row) => {
    const { teamId, memberId, admin, member, answers, paypal } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    const unconfirmed = [expect.objectContaining({ status: "sending", uncertain: true, failureMessage: UNCERTAIN.message })];

    answers.payout = () => jsonResponse(500, { name: "INTERNAL_SERVICE_ERROR", message: "Internal error", debug_id: "d500" });
    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).rejects.toMatchObject(UNCERTAIN);
    await expect(admin.payouts.list(TEAM)).resolves.toEqual(unconfirmed);

    // PayPal may hold the first batch, so neither a refusal nor INSUFFICIENT_FUNDS is final now.
    answers.payout = () => jsonResponse(422, receiverRefusal);
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).rejects.toMatchObject(UNCERTAIN);
    answers.payout = () =>
      jsonResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "No funds.", details: [{ issue: "INSUFFICIENT_FUNDS" }] });
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).rejects.toMatchObject(UNCERTAIN);
    await expect(admin.payouts.list(TEAM)).resolves.toEqual(unconfirmed);
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 35_000, reserved: 50_000 });

    row.answer(answers, id);
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "sent",
      paypalBatchId: row.batchId,
      uncertain: false,
      failureMessage: null,
    });

    const ids = batchIdsOf(payoutPosts(paypal.requests));
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids.map((pair) => pair.join(" ")))).toEqual(new Set([`payout:${id}:0 ${id}-0`]));
  });

  it.each([
    { case: "has no item for the request", batch: () => batchAnswer("another-request", { transaction_status: "SUCCESS" }) },
    { case: "cannot be read", batch: () => jsonResponse(404, { name: "RESOURCE_NOT_FOUND", debug_id: "d404" }) },
  ])("keeps a send unconfirmed when the batch a duplicate refusal links $case", async (row) => {
    const { teamId, memberId, admin, member, answers, paypal } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    answers.payout = () => duplicateRefusal("BATCH-X");
    answers.batch = row.batch;

    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).rejects.toMatchObject(UNCERTAIN);

    expect(paypal.requests.map((r) => `${r.method} ${pathOf(r)}`).at(-1)).toBe("GET /v1/payments/payouts/BATCH-X");
    await expect(admin.payouts.list(TEAM)).resolves.toEqual([
      expect.objectContaining({ status: "sending", uncertain: true, paypalBatchId: null }),
    ]);
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 35_000, reserved: 50_000, paidOut: 0 });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);
  });

  it("records an attempt's answer only while its claim is current, so a takeover's batch is never released", async () => {
    const { teamId, memberId, admin, member, gate } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    gate.on = true;

    const first = admin.payouts.approve({ ...TEAM, requestId: id });
    await vi.waitFor(() => expect(gate.held).toHaveLength(1));
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This payout is being sent.",
    });

    // Five minutes on, the first attempt looks dead: the request reads as unconfirmed so the admin can retry it.
    await db
      .update(payoutRequest)
      .set({ updatedAt: new Date(Date.now() - 6 * 60_000) })
      .where(eq(payoutRequest.id, id));
    await expect(admin.payouts.list(TEAM)).resolves.toEqual([
      expect.objectContaining({ status: "sending", uncertain: true }),
    ]);
    const takeover = admin.payouts.retry({ ...TEAM, requestId: id });
    await vi.waitFor(() => expect(gate.held).toHaveLength(2));

    gate.held[0]?.answer(jsonResponse(422, receiverRefusal));
    await expect(first).resolves.toMatchObject({ status: "sending", uncertain: true });
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 35_000, reserved: 50_000 });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);

    gate.held[1]?.answer(batchCreated("BATCH1"));
    await expect(takeover).resolves.toMatchObject({ status: "sent", paypalBatchId: "BATCH1" });
    expect(gate.held.map((held) => held.request.headers.get("paypal-request-id"))).toEqual([
      `payout:${id}:0`,
      `payout:${id}:0`,
    ]);
  });

  it.each([
    {
      case: "refuses the payout",
      answer: (answers: TeamPayPalAnswers) => {
        answers.payout = () => jsonResponse(422, receiverRefusal);
      },
      message: "UNPROCESSABLE_ENTITY: Receiver is unregistered. (RECEIVER_UNREGISTERED: Receiver is unregistered.)",
    },
    {
      case: "fails the item",
      answer: (answers: TeamPayPalAnswers, requestId: string) => {
        answers.batch = () =>
          batchAnswer(requestId, {
            transaction_status: "FAILED",
            errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" },
          });
      },
      message: "RECEIVER_UNREGISTERED: Receiver is unregistered",
    },
  ])("releases the reserved earnings and keeps PayPal's reason when PayPal $case", async ({ answer, message }) => {
    const { teamId, memberId, admin, member, answers } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    answer(answers, id);

    await admin.payouts.approve({ ...TEAM, requestId: id });
    await expect(admin.payouts.refresh({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "failed",
      failureMessage: message,
      settledAt: expect.any(String),
    });
    expect(await ledgerOf(teamId, memberId)).toEqual({
      available: 85_000,
      reserved: 0,
      paidOut: 0,
      teamRevenue: 15_000,
      paypalFees: 0,
    });
    expect(await payoutReferences(teamId)).toEqual([`payout_released:${id}`, `payout_requested:${id}`]);
  });

  it.each([
    {
      case: "the team has no payout credentials",
      unsettle: async (team: Awaited<ReturnType<typeof payoutTeam>>) => {
        await team.admin.payouts.removeCredentials(TEAM);
      },
      message: "Turn on automatic payouts to pay requests.",
    },
    {
      case: "automatic payouts are on for another PayPal account than the team's",
      unsettle: async (team: Awaited<ReturnType<typeof payoutTeam>>) => {
        await markTeamPayPalMerchant(db, { teamId: team.teamId, merchantId: "MERCHANT2" });
      },
      message:
        "Automatic payouts are on for another PayPal account than the one connected to this team. Turn them on again.",
    },
    {
      case: "the member removed their PayPal destination after requesting",
      unsettle: async (team: Awaited<ReturnType<typeof payoutTeam>>) => {
        await deletePayoutDestination(db, team.memberId);
      },
      message: "The member's PayPal account no longer qualifies for payouts.",
    },
    {
      case: "the member changed their PayPal account after requesting",
      unsettle: async (team: Awaited<ReturnType<typeof payoutTeam>>) => {
        await savePayoutDestination(db, team.memberId, { paypalPayerId: "WDJJHEBZ4X2LY", paypalEmail: null, paypalCountry: "US" }, null);
      },
      message: "The member changed their PayPal account. Reject this request; they can request again.",
    },
  ])("keeps an approved request queued and sends nothing when $case", async ({ unsettle, message }) => {
    const team = await payoutTeam();
    const { id } = await team.member.payouts.request({ ...TEAM, amount: "500.00" });
    await unsettle(team);

    await expect(team.admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "queued",
      failureMessage: message,
    });
    expect(team.paypal.requests).toEqual([]);
  });

  it("lets an admin reject an approved request held before sending, releasing the whole amount", async () => {
    const { teamId, memberId, admin, member, paypal } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    await savePayoutDestination(db, memberId, { paypalPayerId: "WDJJHEBZ4X2LY", paypalEmail: null, paypalCountry: "US" }, null);
    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({ status: "queued" });

    await expect(admin.payouts.reject({ ...TEAM, requestId: id })).resolves.toMatchObject({ status: "rejected" });
    await expect(admin.payouts.reject({ ...TEAM, requestId: id })).rejects.toMatchObject({
      message: "This payout request was already decided.",
    });
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 85_000, reserved: 0, paidOut: 0 });
    expect(await payoutReferences(teamId)).toEqual([`payout_released:${id}`, `payout_requested:${id}`]);
    expect(paypal.requests).toEqual([]);
  });

  it("refuses to reject an approved request whose send PayPal may already hold", async () => {
    const { teamId, memberId, admin, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    await updatePayoutRequest(db, id, { status: "queued", uncertainAt: new Date() });

    await expect(admin.payouts.reject({ ...TEAM, requestId: id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "PayPal may already have this payout. Retry it to find out.",
    });
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 35_000, reserved: 50_000 });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);
  });

  it("refuses requests the member cannot make, and approvals from anyone but an admin", async () => {
    const { organizationId, teamId, memberId, member, paypal, services } = await payoutTeam();
    const caller = (userId: string) => callerFor(userId, services).payouts;

    const noDestination = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Bo" });
    await expect(caller(noDestination).request({ ...TEAM, amount: "10.00" })).rejects.toMatchObject({
      message: "Connect your PayPal account on this page first.",
    });
    const unconfirmed = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Cy" });
    await savePayoutDestination(db, unconfirmed, { paypalPayerId: "PAYER2", paypalEmail: null, paypalCountry: null }, null);
    await expect(caller(unconfirmed).request({ ...TEAM, amount: "10.00" })).rejects.toMatchObject({
      message: "Confirm you are 18 or older first.",
    });
    // Someone with no earnings in the team, such as a stranger, has nothing to request.
    const stranger = await seedUser(db, "Eve");
    await confirmedDestination(stranger);
    await expect(caller(stranger).request({ ...TEAM, amount: "1.00" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "You can request up to 0.00.",
    });
    const solo = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId: solo.organizationId, slug: "solo-seller", solo: true });
    await expect(member.payouts.request({ teamSlug: "solo-seller", amount: "10.00" })).rejects.toMatchObject({
      message: "A solo seller has no payouts to send.",
    });

    // Between two US accounts PayPal's $0.25 fee would leave $0.95, below PayPal's minimum.
    await expect(member.payouts.request({ ...TEAM, amount: "1.20" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This payout is too small to cover PayPal's fee.",
    });
    await expect(member.payouts.request({ ...TEAM, amount: "850.01" })).rejects.toMatchObject({
      message: "You can request up to 850.00.",
    });
    const { id } = await member.payouts.request({ ...TEAM, amount: "100.00" });
    await expect(member.payouts.request({ ...TEAM, amount: "100.00" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "You already have a payout in progress for this team.",
    });

    const forbidden = { code: "FORBIDDEN", message: "Only an admin can approve payouts." };
    await expect(member.payouts.approve({ ...TEAM, requestId: id })).rejects.toMatchObject(forbidden);
    await expect(member.payouts.list(TEAM)).rejects.toMatchObject(forbidden);

    // An admin of another team cannot reach the request through their own team.
    const other = await seedServicesTeamWithAdmin(db, { slug: "other-studio" });
    const otherTeam = { teamSlug: "other-studio", requestId: id };
    const notFound = { code: "NOT_FOUND", message: "Payout request not found." };
    await expect(caller(other.userId).approve(otherTeam)).rejects.toMatchObject(notFound);
    await expect(caller(other.userId).reject(otherTeam)).rejects.toMatchObject(notFound);
    await expect(caller(other.userId).retry(otherTeam)).rejects.toMatchObject(notFound);
    await expect(caller(other.userId).refresh(otherTeam)).rejects.toMatchObject(notFound);
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 75_000, reserved: 10_000 });
    expect(paypal.requests).toEqual([]);
  });
});
