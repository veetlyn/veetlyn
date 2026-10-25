import { outbox } from "@jendal-workspace/db/schema/outbox";
import { createTestAuth } from "@jendal-workspace/auth/testing";
import {
  ANY_AMOUNT_MINOR,
  completionTransfer,
  createFakeFileStore,
  importSecretKey,
  type JsonObject,
  openSecret,
  paymentCapturedTransfer,
  payoutRequestedTransfer,
  presetRules,
} from "@jendal-workspace/core";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import { getTeamPayoutCredentials } from "@jendal-workspace/db/repositories/payout-credentials";
import { insertPayoutRequest, updatePayoutRequest } from "@jendal-workspace/db/repositories/payout-requests";
import { deletePayoutDestination, savePayoutDestination } from "@jendal-workspace/db/repositories/payouts";
import { getTeamPayPalCountry, markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { payoutConnectAttempt, payoutRequest } from "@jendal-workspace/db/schema/payouts";
import { project } from "@jendal-workspace/db/schema/projects";
import { servicesTeamMember } from "@jendal-workspace/db/schema/services-teams";
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
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PayoutServices, PayPalServices } from "../context";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { createProjectPayouts, sendDuePayouts } from "../use-cases/payout-sweeps";
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
const REPORTING_SCOPE = "https://uri.paypal.com/services/reporting/search/read";
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
  balances?: () => Response;
};

function balancesAnswer(value = "5000.00"): Response {
  return jsonResponse(200, {
    account_id: MERCHANT_ID,
    balances: [
      {
        currency: "USD",
        total_balance: { currency_code: "USD", value },
        available_balance: { currency_code: "USD", value },
      },
    ],
  });
}

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
    if (request.method === "GET" && path === "/v1/reporting/balances") return answers.balances?.() ?? balancesAnswer();
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
      platformName: "Platform",
      clientFor: (input) => client(input.clientId, input.clientSecret),
    };
    const paypal: PayPalServices = {
      client: client("partner-client-id", "partner-secret"),
      partnerId: PARTNER_ID,
      returnUrl: "https://admin.example.com/api/paypal/onboarding/return",
      sdk: { clientId: "partner-client-id", partnerAttributionId: "PLATFORM_BN", environment: "sandbox" },
    };
    return { payouts, paypal };
  }

  const callerFor = (userId: string, services?: Services, now?: () => Date) =>
    appRouter.createCaller({
      db,
      now,
      session: makeSession(userId),
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
      payouts: services?.payouts,
      paypal: services?.paypal,
    });

  type Caller = ReturnType<typeof callerFor>;

  const listed = async (admin: Caller) => (await admin.payouts.list(TEAM)).payouts;

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
      first_party_details: {
        features: ["PAYMENT", "REFUND", "PAYOUTS", "ADVANCED_TRANSACTIONS_SEARCH", "PAYPAL_BALANCE"],
        seller_nonce: attempt?.sellerNonce,
      },
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

    const view = { accountId: MERCHANT_ID, verifiedAt: expect.any(String), canReadBalance: false };
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
    expect(atob(row?.secretCiphertext ?? "")).not.toContain(CLIENT_SECRET);
    const sealed = { ciphertext: row?.secretCiphertext ?? "", iv: row?.secretIv ?? "", keyId: row?.keyId ?? "" };
    await expect(openSecret(services.payouts.secretKey, sealed, teamId)).resolves.toBe(CLIENT_SECRET);

    await expect(admin.servicesTeam.get(TEAM)).resolves.toMatchObject({ payoutCredentialsSaved: true });
    // Teams connected before the platform kept the PayPal country get it now; it sets PayPal's payout fee.
    await expect(getTeamPayPalCountry(db, teamId)).resolves.toBe("US");
  });

  it.each([
    { case: "carries the reporting scope", scope: `${PAYOUTS_SCOPE} ${REPORTING_SCOPE} openid`, canReadBalance: true },
    { case: "lacks the reporting scope", scope: `${PAYOUTS_SCOPE} openid`, canReadBalance: false },
  ])("connects and records whether the balance can be read when the token $case", async ({ scope, canReadBalance }) => {
    const { userId, teamId } = await connectedTeam();
    const admin = callerFor(userId, await makePayouts(fakeTeamPayPal({ teamToken: () => teamTokenAnswer(scope) }).fetch));

    await expect(turnOnAutomaticPayouts(admin)).resolves.toMatchObject({ canReadBalance });

    await expect(admin.payouts.credentials(TEAM)).resolves.toMatchObject({ accountId: MERCHANT_ID, canReadBalance });
    await expect(getTeamPayoutCredentials(db, teamId)).resolves.toMatchObject({ canReadBalance });
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

  it("completes an attempt once when two completions race, keeping the credentials of the one that finished", async () => {
    const { userId, teamId } = await connectedTeam();
    const shared = ["first-app", CLIENT_ID];
    // The fake takes the same authorization code twice, so only the attempt's own check can refuse the second use.
    const paypal = fakeTeamPayPal({ sellerCredentials: () => sellerCredentialsAnswer(MERCHANT_ID, shared.shift()) });
    // The first completion waits in `held` when it asks for a token with the credentials it was shared.
    const held: ((response: Response) => void)[] = [];
    const gatedFetch: FetchLike = (request) =>
      request.headers.get("authorization") === `Basic ${btoa(`first-app:${CLIENT_SECRET}`)}`
        ? new Promise((resolve) => held.push(resolve))
        : paypal.fetch(request);
    const admin = callerFor(userId, await makePayouts(gatedFetch));
    const { attemptId } = await admin.payouts.connectStart(TEAM);
    const complete = () => admin.payouts.connectComplete({ ...TEAM, attemptId, authCode: AUTH_CODE, sharedId: SHARED_ID });

    const first = complete();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await expect(complete()).resolves.toMatchObject({ accountId: MERCHANT_ID });

    held[0]?.(teamTokenAnswer());
    await expect(first).rejects.toMatchObject(CONNECT_EXPIRED);
    await expect(getTeamPayoutCredentials(db, teamId)).resolves.toMatchObject({ clientId: CLIENT_ID });
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

  // A completed $1,000 project (unless `finalPriceMinor` says otherwise) with a 15% team cut: $850 owed to the
  // freelancer, $150 team revenue.
  async function earn(teamId: string, freelancerId: string, finalPriceMinor = 100_000): Promise<string> {
    const projectId = await seedProject(db, { teamId, status: "completed" });
    await db.update(project).set({ assignedFreelancerId: freelancerId }).where(eq(project.id, projectId));
    await db.transaction((tx) =>
      createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({
          currency: "USD",
          projectId,
          paymentId: crypto.randomUUID(),
          quotePartMinor: finalPriceMinor,
          managementFeeMinor: 0,
        }),
        completionTransfer({ currency: "USD", projectId, freelancerId, finalPriceMinor, teamCutBps: 1_500 }),
      ]),
    );
    return projectId;
  }

  // The completion transfer's time is the project's completion time. Postgres keeps microseconds, so this rounds up to
  // the next millisecond.
  async function completionOf(projectId: string): Promise<Date> {
    const [transfer] = await db
      .select({ createdAt: ledgerTransfer.createdAt })
      .from(ledgerTransfer)
      .where(eq(ledgerTransfer.reference, `completion:${projectId}`));
    if (!transfer) throw new Error(`Project ${projectId} has no completion`);
    return new Date(transfer.createdAt.getTime() + 1);
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
  // payout POST waits in `gate.held` until the test answers it, so two sends can interleave. `rules` are saved before
  // Ada's project completes, so a team paying completed projects pays it.
  async function payoutTeam(
    memberCountry: string | null = "US",
    initialAnswers: TeamPayPalAnswers = {},
    rules?: Parameters<Caller["payouts"]["saveRules"]>[0],
  ) {
    const { userId: adminId, organizationId, teamId } = await connectedTeam();
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Ada" });
    await confirmedDestination(memberId, memberCountry);
    if (rules) await callerFor(adminId).payouts.saveRules(rules);
    const projectId = await earn(teamId, memberId);
    const answers: TeamPayPalAnswers = { payout: () => batchCreated("BATCH1"), ...initialAnswers };
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
    return {
      organizationId,
      teamId,
      adminId,
      memberId,
      projectId,
      admin,
      member: callerFor(memberId, services),
      answers,
      paypal,
      services,
      gate,
    };
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

  it("keeps the payout reservation and its requested notice atomic", async () => {
    const { member, teamId, memberId, paypal } = await payoutTeam();
    await db.execute(sql`alter table outbox add constraint reject_payout_notice check (type <> 'payout.requested')`);
    try {
      await expect(member.payouts.request({ ...TEAM, amount: "500.00" })).rejects.toThrow();
      expect(await db.select().from(payoutRequest)).toEqual([]);
      expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 85_000, reserved: 0 });
      expect(paypal.requests.filter((request) => request.url.endsWith("/v1/payments/payouts"))).toEqual([]);
    } finally {
      await db.execute(sql`alter table outbox drop constraint reject_payout_notice`);
    }
    const requested = await member.payouts.request({ ...TEAM, amount: "500.00" });
    expect(await db.select().from(outbox)).toEqual([expect.objectContaining({ type: "payout.requested", data: expect.objectContaining({ payoutRequestId: requested.id }) })]);
  });

  it("recovers the same PayPal batch when persisting its sent notice fails", async () => {
    const { member, admin, paypal } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    await db.execute(sql`alter table outbox add constraint reject_sent_notice check (type <> 'payout.sent')`);
    try {
      await expect(admin.payouts.approve({ ...TEAM, requestId: id })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
      const [row] = await db.select().from(payoutRequest).where(eq(payoutRequest.id, id));
      expect(row).toMatchObject({ status: "sending", paypalBatchId: null, uncertainAt: expect.any(Date) });
    } finally {
      await db.execute(sql`alter table outbox drop constraint reject_sent_notice`);
    }
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).resolves.toMatchObject({ status: "sent", paypalBatchId: "BATCH1" });
    const posts = paypal.requests.filter((request) => request.url.endsWith("/v1/payments/payouts"));
    expect(posts).toHaveLength(2);
    expect(batchIdsOf(posts)[0]).toEqual(batchIdsOf(posts)[1]);
    expect(await db.select().from(outbox).where(eq(outbox.type, "payout.sent"))).toHaveLength(1);
  });

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
          note: "Payout from acme-studio via Platform",
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
    await expect(listed(admin)).resolves.toEqual([
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
    await expect(listed(admin)).resolves.toEqual([
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

  const CREDENTIALS_REFUSED = "PayPal refused the team's automatic payouts connection. Turn on automatic payouts again.";
  const PAYOUTS_NOT_ENABLED =
    "PayPal has not turned on Payouts for the team's PayPal account. Ask PayPal to turn it on, then retry.";
  const notAuthorized = {
    name: "NOT_AUTHORIZED",
    message: "Authorization failed due to insufficient permissions.",
    debug_id: "d403",
  };

  it.each([
    {
      case: "refuses the team's token",
      refuse: (answers: TeamPayPalAnswers) => {
        answers.teamToken = () => jsonResponse(401, { error: "invalid_client", error_description: "Client Authentication failed" });
      },
      message: CREDENTIALS_REFUSED,
    },
    {
      case: "refuses the payout as unauthenticated",
      refuse: (answers: TeamPayPalAnswers) => {
        answers.payout = () => jsonResponse(401, authenticationFailure);
      },
      message: CREDENTIALS_REFUSED,
    },
    {
      case: "refuses the team's token as not authorized",
      refuse: (answers: TeamPayPalAnswers) => {
        answers.teamToken = () => jsonResponse(403, notAuthorized);
      },
      message: PAYOUTS_NOT_ENABLED,
    },
    {
      case: "refuses the payout as not authorized",
      refuse: (answers: TeamPayPalAnswers) => {
        answers.payout = () => jsonResponse(403, notAuthorized);
      },
      message: PAYOUTS_NOT_ENABLED,
    },
  ])("keeps an approved request queued with its earnings reserved when PayPal $case, and sends it on retry", async ({ refuse, message }) => {
    const { teamId, memberId, admin, member, answers } = await payoutTeam();
    const ready = { ...answers };
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    refuse(answers);

    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "queued",
      failureMessage: message,
    });
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 35_000, reserved: 50_000, paidOut: 0 });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);

    delete answers.teamToken;
    Object.assign(answers, ready);
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "sent",
      failureMessage: null,
    });
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
    await expect(listed(admin)).resolves.toEqual(unconfirmed);

    // PayPal may hold the first batch, so neither a refusal nor INSUFFICIENT_FUNDS is final now.
    answers.payout = () => jsonResponse(422, receiverRefusal);
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).rejects.toMatchObject(UNCERTAIN);
    answers.payout = () =>
      jsonResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "No funds.", details: [{ issue: "INSUFFICIENT_FUNDS" }] });
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).rejects.toMatchObject(UNCERTAIN);
    await expect(listed(admin)).resolves.toEqual(unconfirmed);
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
    await expect(listed(admin)).resolves.toEqual([
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
    await expect(listed(admin)).resolves.toEqual([
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
    ...["DENIED", "CANCELED"].map((batchStatus) => ({
      case: `marks the batch ${batchStatus} before it has an item`,
      answer: (answers: TeamPayPalAnswers) => {
        answers.batch = () => jsonResponse(200, { batch_header: { payout_batch_id: "BATCH1", batch_status: batchStatus }, items: [] });
      },
      message: `PayPal did not pay this payout (batch ${batchStatus}).`,
    })),
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
    expect(await db.select().from(outbox).where(eq(outbox.type, "payout.failed"))).toEqual([expect.objectContaining({ data: expect.objectContaining({ payoutRequestId: id }) })]);
  });

  it.each([
    {
      case: "the team has no payout credentials",
      unsettle: async (team: Awaited<ReturnType<typeof payoutTeam>>) => {
        await team.admin.payouts.removeCredentials(TEAM);
      },
      message: "Waiting for export or for automatic payouts.",
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

  it("refuses requests the member cannot make, and listing or deciding payouts from anyone but an admin", async () => {
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
    await expect(member.payouts.reject({ ...TEAM, requestId: id })).rejects.toMatchObject(forbidden);
    await expect(member.payouts.retry({ ...TEAM, requestId: id })).rejects.toMatchObject(forbidden);
    await expect(member.payouts.refresh({ ...TEAM, requestId: id })).rejects.toMatchObject(forbidden);
    await expect(member.payouts.list(TEAM)).rejects.toMatchObject(forbidden);
    await expect(member.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [id] })).rejects.toMatchObject(forbidden);
    await expect(member.payouts.importPayoutsWeb({ ...TEAM, csv: "Transaction ID" })).rejects.toMatchObject(forbidden);
    await expect(member.payouts.cancelExport({ ...TEAM, requestId: id })).rejects.toMatchObject(forbidden);

    // An admin of another team cannot reach the request through their own team.
    const other = await seedServicesTeamWithAdmin(db, { slug: "other-studio" });
    const otherTeam = { teamSlug: "other-studio", requestId: id };
    const notFound = { code: "NOT_FOUND", message: "Payout request not found." };
    await expect(caller(other.userId).approve(otherTeam)).rejects.toMatchObject(notFound);
    await expect(caller(other.userId).reject(otherTeam)).rejects.toMatchObject(notFound);
    await expect(caller(other.userId).retry(otherTeam)).rejects.toMatchObject(notFound);
    await expect(caller(other.userId).refresh(otherTeam)).rejects.toMatchObject(notFound);
    await expect(caller(other.userId).cancelExport(otherTeam)).rejects.toMatchObject(notFound);
    await expect(
      caller(other.userId).exportPayoutsWeb({ teamSlug: "other-studio", requestIds: [id] }),
    ).rejects.toMatchObject(notFound);
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 75_000, reserved: 10_000 });
    expect(paypal.requests).toEqual([]);
  });

  it("refuses a request that a project payout overtook, saying how much is left", async () => {
    const { teamId, memberId, member } = await payoutTeam();
    // Each test database has one connection: the overtaking payout and the lock watch need their own.
    const [other, watch] = [createTestDb(), createTestDb()];
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posted = () => {};
    const reserved = new Promise<void>((resolve) => {
      posted = resolve;
    });
    try {
      // The other payout reserves $800 of Ada's $850 and keeps her balance locked while she asks for $500.
      const overtaking = other.transaction(async (tx) => {
        await createPostgresLedger(teamId, tx).post([
          payoutRequestedTransfer({
            currency: "USD",
            payoutRequestId: crypto.randomUUID(),
            freelancerId: memberId,
            amountMinor: 80_000,
          }),
        ]);
        posted();
        await released;
      });
      await reserved;
      const refused = expect(member.payouts.request({ ...TEAM, amount: "500.00" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "You can request up to 50.00.",
      });
      await vi.waitFor(async () => {
        const waiting = await watch.execute(sql`select 1 from pg_stat_activity where wait_event_type = 'Lock'`);
        expect(waiting.length).toBeGreaterThan(0);
      });
      release();
      await overtaking;

      await refused;
    } finally {
      release();
      await Promise.all([other.$client.end(), watch.$client.end()]);
    }
  });

  describe("payout rules", () => {
    const noTrustedMembers: string[] = [];
    const CUSTOM_RULES = {
      ...TEAM,
      autoApproveUpTo: "50.00",
      autoApproveScope: "requests",
      trustedScope: "both",
      trustedMemberIds: noTrustedMembers,
      secondApproverAbove: null,
      secondApproverScope: "both",
      payCompletedProjects: true,
      holdDays: 7,
      payday: "weekly",
      paydayWeekday: 5,
      paydayMonthDay: null,
      balanceFloor: "200.00",
      minimumPayout: "20.00",
    } as const;

    async function rulesTeam() {
      const { userId: adminId, organizationId, teamId } = await seedServicesTeamWithAdmin(db, { slug: "acme-studio" });
      const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Ada" });
      return { adminId, organizationId, teamId, memberId, admin: callerFor(adminId) };
    }

    it("reads the manual preset for a new team, then saves custom rules with trusted members", async () => {
      const { memberId, admin } = await rulesTeam();
      expect(await admin.payouts.rules(TEAM)).toEqual({
        currency: "USD",
        preset: "manual",
        autoApproveUpToMinor: null,
        autoApproveScope: "requests",
        trustedScope: "requests",
        trustedMemberIds: [],
        secondApproverAboveMinor: null,
        secondApproverScope: "both",
        payCompletedProjects: false,
        holdDays: 0,
        payday: "immediate",
        paydayWeekday: null,
        paydayMonthDay: null,
        balanceFloorMinor: null,
        minimumPayoutMinor: 100,
        payCompletedProjectsSince: null,
        adminCount: 1,
      });

      await admin.payouts.saveRules({ ...CUSTOM_RULES, trustedMemberIds: [memberId] });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({
        preset: "custom",
        autoApproveUpToMinor: 5_000,
        trustedScope: "both",
        trustedMemberIds: [memberId],
        payCompletedProjects: true,
        holdDays: 7,
        payday: "weekly",
        paydayWeekday: 5,
        balanceFloorMinor: 20_000,
        minimumPayoutMinor: 2_000,
      });
    });

    it("applies a preset's settings and keeps the trusted list", async () => {
      const { memberId, admin } = await rulesTeam();
      await admin.payouts.saveRules({ ...CUSTOM_RULES, autoApproveUpTo: "any", trustedMemberIds: [memberId] });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ autoApproveUpToMinor: ANY_AMOUNT_MINOR });

      await admin.payouts.applyRulesPreset({ ...TEAM, preset: "automatic" });
      const { adminCount, currency, payCompletedProjectsSince, ...rules } = await admin.payouts.rules(TEAM);
      expect(rules).toEqual({ ...presetRules("automatic"), trustedMemberIds: [memberId] });
      expect(payCompletedProjectsSince).toEqual(expect.any(String));
      expect({ adminCount, currency }).toEqual({ adminCount: 1, currency: "USD" });
    });

    it("refuses rules the team cannot follow and trusted members who are not on the team", async () => {
      const { admin } = await rulesTeam();
      await expect(
        admin.payouts.saveRules({ ...CUSTOM_RULES, autoApproveUpTo: null, secondApproverAbove: "500.00" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Add a second admin before requiring two approvals." });
      await expect(admin.payouts.saveRules({ ...CUSTOM_RULES, minimumPayout: "30000000.00" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Enter an amount up to 1,000,000.00.",
      });

      const stranger = await seedUser(db, "Eve");
      await expect(admin.payouts.saveRules({ ...CUSTOM_RULES, trustedMemberIds: [stranger] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Trusted members must be on the team.",
      });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ preset: "manual" });
    });

    it("stores only the payday fields the payday uses", async () => {
      const { admin } = await rulesTeam();
      await admin.payouts.saveRules({ ...CUSTOM_RULES, payday: "immediate", paydayWeekday: 9, paydayMonthDay: 40 });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ payday: "immediate", paydayWeekday: null, paydayMonthDay: null });

      await admin.payouts.saveRules({ ...CUSTOM_RULES, payday: "weekly", paydayWeekday: 5, paydayMonthDay: 40 });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ payday: "weekly", paydayWeekday: 5, paydayMonthDay: null });
    });

    it("lets only another admin add an admin to the trusted list", async () => {
      const { adminId, organizationId, teamId, admin } = await rulesTeam();
      await expect(admin.payouts.saveRules({ ...CUSTOM_RULES, trustedMemberIds: [adminId] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Another admin has to add you to the trusted list.",
      });

      const secondAdmin = callerFor(await seedServicesTeamMember(db, { organizationId, teamId, role: "admin" }));
      await secondAdmin.payouts.saveRules({ ...CUSTOM_RULES, trustedMemberIds: [adminId] });
      await admin.payouts.saveRules({ ...CUSTOM_RULES, holdDays: 3, trustedMemberIds: [adminId] });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ holdDays: 3, trustedMemberIds: [adminId], adminCount: 2 });
    });

    it("drops a trusted member who left the team instead of blocking later saves", async () => {
      const { teamId, memberId, admin } = await rulesTeam();
      await admin.payouts.saveRules({ ...CUSTOM_RULES, trustedMemberIds: [memberId] });
      await db
        .delete(servicesTeamMember)
        .where(and(eq(servicesTeamMember.teamId, teamId), eq(servicesTeamMember.userId, memberId)));
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ trustedMemberIds: [] });

      // The form still sends the stale id; the save succeeds and the stored list drops it.
      await admin.payouts.saveRules({ ...CUSTOM_RULES, holdDays: 3, trustedMemberIds: [memberId] });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ holdDays: 3, trustedMemberIds: [] });
    });

    it("lets only admins read or change the rules", async () => {
      const { memberId } = await rulesTeam();
      const freelancer = callerFor(memberId);
      const forbidden = { code: "FORBIDDEN", message: "Only an admin can change the team settings." };
      await expect(freelancer.payouts.rules(TEAM)).rejects.toMatchObject(forbidden);
      await expect(freelancer.payouts.saveRules(CUSTOM_RULES)).rejects.toMatchObject(forbidden);
      await expect(freelancer.payouts.applyRulesPreset({ ...TEAM, preset: "rules" })).rejects.toMatchObject(forbidden);
    });

    it("moves queued payouts waiting for a payday to the new payday and keeps their decision", async () => {
      const { adminId, teamId, memberId, admin } = await rulesTeam();
      await admin.payouts.saveRules(CUSTOM_RULES);
      const decidedAt = new Date("2026-10-01T12:00:00Z");
      const waiting = await insertPayoutRequest(db, {
        id: crypto.randomUUID(),
        teamId,
        userId: memberId,
        currency: "USD",
        amountMinor: 10_000,
        receiverPayerId: PAYER_ID,
      });
      if (!waiting) throw new Error("seed payout not inserted");
      await updatePayoutRequest(db, waiting.id, {
        status: "queued",
        decidedByUserId: adminId,
        decidedAt,
        sendAfter: new Date(Date.now() + 3 * 86_400_000),
      });

      const before = Date.now();
      await admin.payouts.saveRules({ ...CUSTOM_RULES, payday: "immediate", paydayWeekday: null });
      const after = Date.now();

      const [row] = await db.select().from(payoutRequest).where(eq(payoutRequest.id, waiting.id));
      expect(row).toMatchObject({ status: "queued", decidedByUserId: adminId, decidedAt });
      expect(row?.sendAfter?.getTime()).toBeGreaterThanOrEqual(before);
      expect(row?.sendAfter?.getTime()).toBeLessThanOrEqual(after);
    });
  });

  const noTrustedMembers: string[] = [];
  // The manual preset as saveRules takes it; each test turns on the rules it needs.
  const MANUAL = {
    ...TEAM,
    autoApproveUpTo: null,
    autoApproveScope: "requests",
    trustedScope: "requests",
    trustedMemberIds: noTrustedMembers,
    secondApproverAbove: null,
    secondApproverScope: "both",
    payCompletedProjects: false,
    holdDays: 0,
    payday: "immediate",
    paydayWeekday: null,
    paydayMonthDay: null,
    balanceFloor: null,
    minimumPayout: "1.00",
  } as const;
  const WEDNESDAY_14TH = new Date("2026-10-14T10:00:00Z");
  const atWednesday = () => WEDNESDAY_14TH;
  const readsBalance = () => teamTokenAnswer(`${PAYOUTS_SCOPE} ${REPORTING_SCOPE} openid`);

  const rowOf = async (id: string) => (await db.select().from(payoutRequest).where(eq(payoutRequest.id, id)))[0];

  describe("payouts under the team's rules", () => {
    it("sends a request the rules auto-approve at once, with no admin as the decider", async () => {
      const { admin, member, paypal } = await payoutTeam();
      await admin.payouts.saveRules({ ...MANUAL, autoApproveUpTo: "1000.00" });

      const requested = await member.payouts.request({ ...TEAM, amount: "100.00" });

      expect(requested).toMatchObject({ status: "sent", paypalBatchId: "BATCH1", decidedAt: expect.any(String) });
      expect(payoutPosts(paypal.requests)).toHaveLength(1);
      expect(await rowOf(requested.id)).toMatchObject({ decidedByUserId: null });
    });

    it("leaves the request of a trusted member who left the team for an admin", async () => {
      const { teamId, memberId, admin, member, paypal } = await payoutTeam();
      await admin.payouts.saveRules({ ...MANUAL, trustedMemberIds: [memberId] });
      await db
        .delete(servicesTeamMember)
        .where(and(eq(servicesTeamMember.teamId, teamId), eq(servicesTeamMember.userId, memberId)));

      await expect(member.payouts.request({ ...TEAM, amount: "100.00" })).resolves.toMatchObject({ status: "requested" });
      expect(payoutPosts(paypal.requests)).toEqual([]);
    });

    it("keeps an auto-approved request queued until the weekly payday, without calling PayPal", async () => {
      const { memberId, admin, paypal, services } = await payoutTeam();
      await admin.payouts.saveRules({ ...MANUAL, autoApproveUpTo: "1000.00", payday: "weekly", paydayWeekday: 5 });

      const requested = await callerFor(memberId, services, atWednesday).payouts.request({ ...TEAM, amount: "100.00" });

      expect(requested).toMatchObject({ status: "queued", sendAfter: "2026-10-16T00:00:00.000Z" });
      expect(paypal.requests).toEqual([]);
    });

    it("refuses a request below the team minimum and reserves nothing", async () => {
      const { teamId, memberId, admin, member } = await payoutTeam();
      await admin.payouts.saveRules({ ...MANUAL, minimumPayout: "50.00" });

      await expect(member.payouts.request({ ...TEAM, amount: "20.00" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Payouts start at $50.00 for this team.",
      });
      expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 85_000, reserved: 0 });
      expect(await listed(admin)).toEqual([]);
    });

    it("leaves a request for an admin when auto-approving it would take the balance under the floor", async () => {
      const { admin, member, paypal } = await payoutTeam("US", { teamToken: readsBalance });
      await admin.payouts.saveRules({ ...MANUAL, autoApproveUpTo: "1000.00", balanceFloor: "4950.00" });

      // The fake balance is $5,000.00, so $100.00 would leave $4,900.00.
      await expect(member.payouts.request({ ...TEAM, amount: "100.00" })).resolves.toMatchObject({ status: "requested" });
      expect(paypal.requests.map((r) => `${r.method} ${pathOf(r)}`)).toContain("GET /v1/reporting/balances");
      expect(payoutPosts(paypal.requests)).toEqual([]);
    });

    it("sends a payout above the second-approver amount once two different admins approve it", async () => {
      const { organizationId, teamId, admin, member, paypal, services } = await payoutTeam();
      const secondAdminId = await seedServicesTeamMember(db, { organizationId, teamId, role: "admin", name: "Bo" });
      await admin.payouts.saveRules({ ...MANUAL, secondApproverAbove: "500.00" });
      const { id } = await member.payouts.request({ ...TEAM, amount: "600.00" });

      await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
        status: "requested",
        approvalsNeeded: 1,
      });
      await expect(admin.payouts.approve({ ...TEAM, requestId: id })).rejects.toMatchObject({
        code: "CONFLICT",
        message: "You already approved this payout.",
      });
      expect(payoutPosts(paypal.requests)).toEqual([]);
      expect(await listed(admin)).toEqual([expect.objectContaining({ id, approvalsNeeded: 1, eligibleApprovers: 1 })]);

      await expect(callerFor(secondAdminId, services).payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
        status: "sent",
        approvalsNeeded: 0,
      });
      expect(await rowOf(id)).toMatchObject({ decidedByUserId: secondAdminId });
    });

    it("lists the approvals a payout still needs and the team's admin count after an admin leaves", async () => {
      const { organizationId, teamId, admin, member } = await payoutTeam();
      const secondAdminId = await seedServicesTeamMember(db, { organizationId, teamId, role: "admin", name: "Bo" });
      await admin.payouts.saveRules({ ...MANUAL, secondApproverAbove: "500.00" });
      const { id } = await member.payouts.request({ ...TEAM, amount: "600.00" });
      await db
        .delete(servicesTeamMember)
        .where(and(eq(servicesTeamMember.teamId, teamId), eq(servicesTeamMember.userId, secondAdminId)));

      await expect(admin.payouts.list(TEAM)).resolves.toEqual({
        adminCount: 1,
        waitingForDestination: [],
        payouts: [
          expect.objectContaining({
            id,
            source: "member",
            projectId: null,
            projectTitle: null,
            approvals: 0,
            approvalsNeeded: 2,
            sendAfter: null,
            nextAttemptAt: null,
          }),
        ],
      });
    });

    it("refuses an admin approving a payout to themselves", async () => {
      const { teamId, adminId, admin, paypal } = await payoutTeam();
      await savePayoutDestination(
        db,
        adminId,
        { paypalPayerId: "WDJJHEBZ4X2LY", paypalEmail: null, paypalCountry: "US" },
        { confirmedAt: new Date(), source: "self" },
      );
      await earn(teamId, adminId);
      const { id } = await admin.payouts.request({ ...TEAM, amount: "100.00" });

      await expect(admin.payouts.approve({ ...TEAM, requestId: id })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "You cannot approve a payout to yourself.",
      });
      expect(await rowOf(id)).toMatchObject({ status: "requested" });
      expect(await listed(admin)).toEqual([expect.objectContaining({ id, eligibleApprovers: 0 })]);
      expect(paypal.requests).toEqual([]);
    });

    it("queues an approved payout until the monthly payday and refuses retrying it before then", async () => {
      const { adminId, admin, member, paypal, services } = await payoutTeam();
      await admin.payouts.saveRules({ ...MANUAL, payday: "monthly", paydayMonthDay: 28 });
      const { id } = await member.payouts.request({ ...TEAM, amount: "100.00" });
      const clockedAdmin = callerFor(adminId, services, atWednesday);

      await expect(clockedAdmin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
        status: "queued",
        sendAfter: "2026-10-28T00:00:00.000Z",
        approvalsNeeded: 0,
      });
      await expect(clockedAdmin.payouts.retry({ ...TEAM, requestId: id })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This payout goes on payday, October 28, 2026.",
      });
      expect(paypal.requests).toEqual([]);
    });
  });

  describe("payout sweeps", () => {
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const T = WEDNESDAY_14TH;
    const later = (from: Date, ms: number) => new Date(from.getTime() + ms);
    const at = (ms: number) => later(T, ms);
    // The automatic preset with a three-day hold.
    const PROJECT_RULES = {
      ...MANUAL,
      payCompletedProjects: true,
      holdDays: 3,
      autoApproveUpTo: "any",
      autoApproveScope: "automatic",
    } as const;
    const insufficientFunds = () =>
      jsonResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "No funds.", details: [{ issue: "INSUFFICIENT_FUNDS" }] });

    const projectPayouts = async (admin: Caller) => (await listed(admin)).filter((payout) => payout.source === "project");

    it("pays a completed project once its hold has passed, and only once", async () => {
      const { teamId, memberId, projectId, admin, member, paypal, services } = await payoutTeam("US", {}, PROJECT_RULES);
      const completed = await completionOf(projectId);
      const sweep = (now: Date) => createProjectPayouts({ db, payouts: services.payouts }, { now });

      await expect(sweep(later(completed, 2 * DAY))).resolves.toEqual({ created: 0 });
      await expect(sweep(later(completed, 3 * DAY))).resolves.toEqual({ created: 1 });
      await expect(sweep(later(completed, 4 * DAY))).resolves.toEqual({ created: 0 });

      expect(await listed(admin)).toEqual([
        expect.objectContaining({
          source: "project",
          projectId,
          projectTitle: "Website",
          userId: memberId,
          amountMinor: 85_000,
          status: "sent",
          decidedAt: later(completed, 3 * DAY).toISOString(),
        }),
      ]);
      expect((await member.payouts.mine()).requests).toEqual([
        expect.objectContaining({ source: "project", projectTitle: "Website" }),
      ]);
      expect(payoutPosts(paypal.requests)).toHaveLength(1);
      expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 0, reserved: 85_000 });
    });

    it("pays only projects completed after paying completed projects was turned on", async () => {
      const { teamId, memberId, admin, services } = await payoutTeam();
      await admin.payouts.saveRules(PROJECT_RULES);
      const { payCompletedProjectsSince } = await admin.payouts.rules(TEAM);
      expect(payCompletedProjectsSince).toEqual(expect.any(String));
      const newer = await earn(teamId, memberId);
      // Staying on keeps the date.
      await admin.payouts.saveRules({ ...PROJECT_RULES, holdDays: 2 });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ payCompletedProjectsSince });

      await expect(
        createProjectPayouts({ db, payouts: services.payouts }, { now: later(await completionOf(newer), 3 * DAY) }),
      ).resolves.toEqual({ created: 1 });
      expect((await projectPayouts(admin)).map((payout) => payout.projectId)).toEqual([newer]);

      await admin.payouts.saveRules({ ...PROJECT_RULES, payCompletedProjects: false });
      expect(await admin.payouts.rules(TEAM)).toMatchObject({ payCompletedProjectsSince: null });
    });

    it.each([
      { requested: "800.00", amounts: [5_000] },
      { requested: "850.00", amounts: [] },
    ])("caps a project payout at what the member has left after requesting $requested", async ({ requested, amounts }) => {
      const { projectId, admin, member, services } = await payoutTeam("US", {}, PROJECT_RULES);
      const completed = await completionOf(projectId);
      await member.payouts.request({ ...TEAM, amount: requested });

      await createProjectPayouts({ db, payouts: services.payouts }, { now: later(completed, 3 * DAY) });

      expect((await projectPayouts(admin)).map((payout) => payout.amountMinor)).toEqual(amounts);
    });

    it("caps a project payout at PayPal's per-item maximum", async () => {
      const { teamId, memberId, admin, services } = await payoutTeam();
      await admin.payouts.saveRules(PROJECT_RULES);
      // $30,000 less the 15% team cut leaves $25,500, over PayPal's $20,000 maximum.
      const large = await earn(teamId, memberId, 3_000_000);

      await createProjectPayouts({ db, payouts: services.payouts }, { now: later(await completionOf(large), 3 * DAY) });

      expect((await projectPayouts(admin)).map((payout) => payout.amountMinor)).toEqual([2_000_000]);
    });

    it("never pays an older project out of a newer project's earnings still inside the hold", async () => {
      const { teamId, memberId, projectId, admin, member, services } = await payoutTeam("US", {}, PROJECT_RULES);
      await member.payouts.request({ ...TEAM, amount: "850.00" });
      const newer = await earn(teamId, memberId);
      const sweep = (now: Date) => createProjectPayouts({ db, payouts: services.payouts }, { now });

      await expect(sweep(later(await completionOf(projectId), 3 * DAY))).resolves.toEqual({ created: 0 });
      await expect(sweep(later(await completionOf(newer), 3 * DAY))).resolves.toEqual({ created: 1 });

      expect((await projectPayouts(admin)).map((payout) => payout.amountMinor)).toEqual([85_000]);
    });

    it("lists a member without a PayPal destination as waiting, and pays them once they connect", async () => {
      const { adminId, memberId, projectId, services } = await payoutTeam("US", {}, PROJECT_RULES);
      const completed = await completionOf(projectId);
      await deletePayoutDestination(db, memberId);
      const sweep = () => createProjectPayouts({ db, payouts: services.payouts }, { now: later(completed, 3 * DAY) });
      const clockedAdmin = callerFor(adminId, services, () => later(completed, 3 * DAY));

      await expect(sweep()).resolves.toEqual({ created: 0 });
      await expect(clockedAdmin.payouts.list(TEAM)).resolves.toEqual({
        adminCount: 1,
        payouts: [],
        waitingForDestination: [{ projectId, title: "Website", memberName: "Ada", earningsMinor: 85_000, currency: "USD" }],
      });

      await confirmedDestination(memberId);
      await expect(sweep()).resolves.toEqual({ created: 1 });
      await expect(clockedAdmin.payouts.list(TEAM)).resolves.toMatchObject({ waitingForDestination: [] });
    });

    it("sends a queued payout on its payday and not before", async () => {
      const { memberId, admin, paypal, services } = await payoutTeam();
      await admin.payouts.saveRules({ ...MANUAL, autoApproveUpTo: "1000.00", payday: "weekly", paydayWeekday: 5 });
      const { id } = await callerFor(memberId, services, atWednesday).payouts.request({ ...TEAM, amount: "100.00" });
      const sweep = (now: Date) => sendDuePayouts({ db, payouts: services.payouts }, { now });

      await expect(sweep(at(13 * HOUR))).resolves.toEqual({ sent: 0, held: 0 });
      expect(payoutPosts(paypal.requests)).toEqual([]);

      await expect(sweep(new Date("2026-10-16T00:00:00Z"))).resolves.toEqual({ sent: 1, held: 0 });
      expect(await rowOf(id)).toMatchObject({ status: "sent" });
    });

    it("holds an approved payout that would take the balance under the floor, then sends it when the balance allows", async () => {
      const { adminId, admin, member, answers, paypal, services } = await payoutTeam("US", { teamToken: readsBalance });
      await admin.payouts.saveRules({ ...MANUAL, balanceFloor: "4950.00" });
      const { id } = await member.payouts.request({ ...TEAM, amount: "100.00" });
      const sweep = (now: Date) => sendDuePayouts({ db, payouts: services.payouts }, { now });

      await expect(callerFor(adminId, services, () => T).payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
        status: "queued",
        failureMessage: "Waiting until the team's PayPal balance stays above $4,950.00.",
        nextAttemptAt: at(15 * MINUTE).toISOString(),
      });
      expect(await rowOf(id)).toMatchObject({ waitCount: 1 });

      await expect(sweep(at(14 * MINUTE))).resolves.toEqual({ sent: 0, held: 0 });
      answers.balances = () => balancesAnswer("6000.00");
      await expect(sweep(at(15 * MINUTE))).resolves.toEqual({ sent: 1, held: 0 });
      expect(await rowOf(id)).toMatchObject({ status: "sent", failureMessage: null, waitCount: 0, nextAttemptAt: null });
      expect(payoutPosts(paypal.requests)).toHaveLength(1);
    });

    it("backs off 15 minutes, 1 hour, then 6 hours while PayPal answers INSUFFICIENT_FUNDS", async () => {
      const { adminId, admin, member, answers, services } = await payoutTeam();
      const { id } = await member.payouts.request({ ...TEAM, amount: "100.00" });
      answers.payout = insufficientFunds;

      await callerFor(adminId, services, () => T).payouts.approve({ ...TEAM, requestId: id });
      const delays: number[] = [];
      let tried = T;
      for (const sweepAgain of [true, true, false]) {
        const next = (await rowOf(id))?.nextAttemptAt ?? tried;
        delays.push(next.getTime() - tried.getTime());
        tried = next;
        if (sweepAgain) {
          await expect(sendDuePayouts({ db, payouts: services.payouts }, { now: next })).resolves.toEqual({ sent: 0, held: 1 });
        }
      }

      expect(delays).toEqual([15 * MINUTE, HOUR, 6 * HOUR]);
      expect(await listed(admin)).toEqual([expect.objectContaining({ id, status: "queued", failureMessage: LOW_BALANCE })]);
    });

    it("holds a payout under a floor when the team's connection cannot read the balance", async () => {
      const { admin, member, paypal } = await payoutTeam();
      await admin.payouts.saveRules({ ...MANUAL, balanceFloor: "100.00" });
      const { id } = await member.payouts.request({ ...TEAM, amount: "100.00" });

      await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
        status: "queued",
        failureMessage: "Turn on automatic payouts again so we can read your PayPal balance.",
      });
      expect(paypal.requests).toEqual([]);
    });

    it.each([
      { case: "PayPal fails to answer", balances: () => jsonResponse(503, { name: "SERVICE_UNAVAILABLE", debug_id: "d503" }) },
      {
        case: "PayPal lists no balance in the team's currency",
        balances: () => jsonResponse(200, { account_id: MERCHANT_ID, balances: [] }),
      },
    ])("holds a payout under a floor when $case, and sends it once there is no floor", async ({ balances }) => {
      const { admin, member } = await payoutTeam("US", { teamToken: readsBalance, balances });
      await admin.payouts.saveRules({ ...MANUAL, balanceFloor: "100.00" });
      const { id } = await member.payouts.request({ ...TEAM, amount: "100.00" });

      await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
        status: "queued",
        failureMessage: "Turn on automatic payouts again so we can read your PayPal balance.",
      });
      await admin.payouts.saveRules(MANUAL);
      await expect(admin.payouts.retry({ ...TEAM, requestId: id })).resolves.toMatchObject({ status: "sent" });
    });

    it("creates a project payout the rules leave for an admin, and sends it once approved", async () => {
      const { projectId, admin, paypal, services } = await payoutTeam("US", {}, { ...PROJECT_RULES, autoApproveUpTo: null });

      await expect(
        createProjectPayouts({ db, payouts: services.payouts }, { now: later(await completionOf(projectId), 3 * DAY) }),
      ).resolves.toEqual({ created: 1 });
      const [payout] = await projectPayouts(admin);
      expect(payout).toMatchObject({ status: "requested", approvalsNeeded: 1 });
      expect(payoutPosts(paypal.requests)).toEqual([]);

      await expect(admin.payouts.approve({ ...TEAM, requestId: payout?.id ?? "" })).resolves.toMatchObject({
        status: "sent",
      });
    });

    it("creates and approves project payouts of a team without automatic payouts, which wait for an export", async () => {
      const { teamId, projectId, admin, paypal, services } = await payoutTeam("US", {}, PROJECT_RULES);
      await admin.payouts.removeCredentials(TEAM);
      const completed = await completionOf(projectId);

      await expect(createProjectPayouts({ db }, { now: later(completed, 3 * DAY) })).resolves.toEqual({ created: 1 });
      await expect(sendDuePayouts({ db, payouts: services.payouts }, { now: later(completed, 4 * DAY) })).resolves.toEqual({
        sent: 0,
        held: 0,
      });

      const [payout] = await projectPayouts(admin);
      expect(payout).toMatchObject({
        status: "queued",
        failureMessage: "Waiting for export or for automatic payouts.",
        nextAttemptAt: null,
      });
      expect(await rowOf(payout?.id ?? "")).toMatchObject({ teamId, waitCount: 0 });
      expect(paypal.requests).toEqual([]);
    });
  });

  describe("PayPal Payouts Web", () => {
    const BO_PAYER_ID = "BQWJ7Z9TNXYV2";
    const WAITING_FOR_EXPORT = "Waiting for export or for automatic payouts.";
    const LOG_MISMATCH = "PayPal's log shows another amount or currency for this payout.";
    const LOG_HEADER =
      "Transaction ID,Recipient,Recipient Name,Unique Identifier,Amount,Fee,Total,Status,Reason Code,Custom Note,Message";
    const PAID_TWICE = "PayPal paid this payout twice. Recover the extra payment in PayPal.";
    const noResults = { settled: 0, failed: 0, pending: 0, unmatched: 0, mismatched: 0, paidTwice: 0 };

    type LogRow = {
      reference: string;
      amount: string;
      fee: string;
      status: string;
      message?: string;
      transactionId?: string;
    };

    // PayPal's Payouts Web log layout: a preamble, then one row per payout with money in the account's locale.
    function payoutsWebLog(rows: LogRow[]): string {
      const lines = rows.map(
        (row, index) =>
          `${row.transactionId ?? `TX${index + 1}`},PAYER,,${row.reference},"${row.amount}","${row.fee}",,${row.status},,,${row.message ?? ""}`,
      );
      return ["\uFEFFTransaction Type: Mass Payment", "", LOG_HEADER, ...lines].join("\n");
    }

    const referenceOf = async (id: string) => (await rowOf(id))?.offlineReference ?? "";

    // payoutTeam with automatic payouts turned off, and two approved payouts waiting for an export: Ada's $500.00 and
    // Bo's $100.00, each with PayPal's $0.25 fee estimated between two US accounts.
    async function exportTeam() {
      const team = await payoutTeam();
      const { organizationId, teamId, adminId, member, services } = team;
      // On the export's clock: an approval on the real clock would set a payday after the export.
      const admin = callerFor(adminId, services, atWednesday);
      await admin.payouts.removeCredentials(TEAM);
      const boId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Bo" });
      await savePayoutDestination(
        db,
        boId,
        { paypalPayerId: BO_PAYER_ID, paypalEmail: null, paypalCountry: "US" },
        { confirmedAt: new Date(), source: "self" },
      );
      await earn(teamId, boId);
      const ada = await member.payouts.request({ ...TEAM, amount: "500.00" });
      const bo = await callerFor(boId, services).payouts.request({ ...TEAM, amount: "100.00" });
      for (const { id } of [ada, bo]) await admin.payouts.approve({ ...TEAM, requestId: id });
      return { ...team, boId, adaPayoutId: ada.id, boPayoutId: bo.id };
    }

    it("exports approved payouts as PayPal's upload file, less the fee estimate, and marks them exported", async () => {
      const { adminId, adaPayoutId, boPayoutId, admin, paypal, services } = await exportTeam();
      expect(await listed(admin)).toEqual([
        expect.objectContaining({ id: boPayoutId, status: "queued", failureMessage: WAITING_FOR_EXPORT }),
        expect.objectContaining({ id: adaPayoutId, status: "queued", failureMessage: WAITING_FOR_EXPORT }),
      ]);

      const exported = await callerFor(adminId, services, atWednesday).payouts.exportPayoutsWeb({
        ...TEAM,
        requestIds: [adaPayoutId, boPayoutId],
      });

      const [ada, bo] = [await rowOf(adaPayoutId), await rowOf(boPayoutId)];
      expect(exported).toEqual({
        filename: "payouts-2026-10-14.csv",
        count: 2,
        csv: [
          `${PAYER_ID},499.75,USD,${ada?.offlineReference},Payout from acme-studio via Platform,PAYPAL`,
          `${BO_PAYER_ID},99.75,USD,${bo?.offlineReference},Payout from acme-studio via Platform,PAYPAL`,
        ].join("\r\n"),
      });
      const exportedRow = {
        status: "exported",
        failureMessage: null,
        feeEstimateMinor: 25,
        sentAt: expect.any(Date),
        offlineReference: expect.stringMatching(/^PL[A-Z2-9]{12}$/),
      };
      expect(ada).toMatchObject({ ...exportedRow, sentMinor: 49_975 });
      expect(bo).toMatchObject({ ...exportedRow, sentMinor: 9_975 });
      expect(ada?.offlineBatchId).toEqual(expect.any(String));
      expect(bo?.offlineBatchId).toBe(ada?.offlineBatchId);
      expect(paypal.requests).toEqual([]);
    });

    it.each([
      {
        case: "a payout still waiting for approval",
        patch: { status: "requested", decidedAt: null },
        message: "Only approved payouts can be exported.",
      },
      {
        case: "a payout PayPal may already have",
        patch: { uncertainAt: new Date() },
        message: "PayPal may already have this payout. Turn on automatic payouts and retry it to find out.",
      },
      {
        case: "a payout waiting for its payday",
        patch: { sendAfter: new Date("2026-10-28T00:00:00Z") },
        message: "This payout goes on payday, October 28, 2026.",
      },
    ] as const)("refuses to export $case, and exports nothing", async ({ patch, message }) => {
      const { adminId, adaPayoutId, boPayoutId, services } = await exportTeam();
      await updatePayoutRequest(db, boPayoutId, patch);
      const clockedAdmin = callerFor(adminId, services, atWednesday);

      await expect(
        clockedAdmin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId, boPayoutId] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message });
      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "queued", offlineReference: null, sentMinor: null });
    });

    it("refuses to export for a team with automatic payouts on", async () => {
      const { admin, member } = await payoutTeam();
      const { id } = await member.payouts.request({ ...TEAM, amount: "100.00" });

      await expect(admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [id] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Automatic payouts send these for you.",
      });
    });

    it("settles exported payouts from PayPal's log with the automatic payouts' postings, once", async () => {
      const { teamId, memberId, boId, adaPayoutId, boPayoutId, admin } = await exportTeam();
      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId, boPayoutId] });
      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: "Name,Amount\nAda,1.00\n" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This file has no Customer ID column. Download the payout's CSV log from PayPal.",
      });
      const log = payoutsWebLog([
        { reference: await referenceOf(adaPayoutId), amount: "$499,75 USD", fee: "$0,20 USD", status: "Completed" },
        {
          reference: await referenceOf(boPayoutId),
          amount: "$99,75 USD",
          fee: "$0,00 USD",
          status: "Denied",
          message: "Receiver is unregistered",
        },
        { reference: "PLNOTEXPORTED", amount: "$5,00 USD", fee: "$0,00 USD", status: "Completed" },
      ]);
      const counts = { ...noResults, settled: 1, failed: 1, unmatched: 1 };

      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: log })).resolves.toEqual(counts);

      expect(await rowOf(adaPayoutId)).toMatchObject({
        status: "succeeded",
        feeMinor: 20,
        paypalItemId: "TX1",
        paypalItemStatus: "Completed",
        reviewReason: null,
        settledAt: expect.any(Date),
      });
      expect(await rowOf(boPayoutId)).toMatchObject({
        status: "failed",
        failureMessage: "PayPal did not pay this payout (Denied): Receiver is unregistered",
      });
      // PayPal's $0.20 fee came in under the $0.25 estimate, so the other $0.05 goes back to Ada.
      const adaLedger = { available: 35_005, reserved: 0, paidOut: 49_975, teamRevenue: 30_000, paypalFees: 20 };
      expect(await ledgerOf(teamId, memberId)).toEqual(adaLedger);
      expect(await ledgerOf(teamId, boId)).toMatchObject({ available: 85_000, reserved: 0, paidOut: 0 });
      const references = [
        `payout_fee_recovered:${adaPayoutId}`,
        `payout_fees:${adaPayoutId}`,
        `payout_released:${adaPayoutId}`,
        `payout_requested:${adaPayoutId}`,
        `payout_succeeded:${adaPayoutId}`,
        `payout_released:${boPayoutId}`,
        `payout_requested:${boPayoutId}`,
      ].sort();
      expect(await payoutReferences(teamId)).toEqual(references);

      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: log })).resolves.toEqual(counts);
      expect(await ledgerOf(teamId, memberId)).toEqual(adaLedger);
      expect(await payoutReferences(teamId)).toEqual(references);
    });

    const mismatched = { counted: { mismatched: 1 }, reviewReason: LOG_MISMATCH };

    it.each([
      { case: "still pending", amount: "$499,75 USD", status: "Unclaimed", counted: { pending: 1 }, reviewReason: null },
      { case: "for another amount", amount: "$400,00 USD", status: "Completed", ...mismatched },
      { case: "in another currency", amount: "€499,75 EUR", status: "Completed", ...mismatched },
    ])("leaves a payout exported when PayPal's log shows it $case", async ({ amount, status, counted, reviewReason }) => {
      const { teamId, adaPayoutId, admin } = await exportTeam();
      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId] });
      const log = payoutsWebLog([{ reference: await referenceOf(adaPayoutId), amount, fee: "$0,20 USD", status }]);

      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: log })).resolves.toEqual({ ...noResults, ...counted });

      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "exported", reviewReason, settledAt: null });
      expect((await payoutReferences(teamId)).filter((reference) => reference.endsWith(adaPayoutId))).toEqual([
        `payout_requested:${adaPayoutId}`,
      ]);
    });

    it("puts a cancelled export back with the approved payouts, and exports it again under the same reference", async () => {
      const { adaPayoutId, admin } = await exportTeam();
      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId] });
      const reference = await referenceOf(adaPayoutId);

      await expect(admin.payouts.cancelExport({ ...TEAM, requestId: adaPayoutId })).resolves.toMatchObject({
        status: "queued",
        sentAt: null,
        failureMessage: WAITING_FOR_EXPORT,
      });
      expect(await rowOf(adaPayoutId)).toMatchObject({ offlineReference: reference, offlineBatchId: null });
      await expect(admin.payouts.cancelExport({ ...TEAM, requestId: adaPayoutId })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Only a payout exported for PayPal Payouts Web can be cancelled.",
      });

      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId] });
      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "exported", offlineReference: reference });
    });

    it("settles a cancelled export from PayPal's log when PayPal paid or refused it after all", async () => {
      const { teamId, memberId, boId, adaPayoutId, boPayoutId, admin } = await exportTeam();
      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId, boPayoutId] });
      for (const requestId of [adaPayoutId, boPayoutId]) await admin.payouts.cancelExport({ ...TEAM, requestId });
      const log = payoutsWebLog([
        { reference: await referenceOf(adaPayoutId), amount: "$499,75 USD", fee: "$0,25 USD", status: "Completed" },
        { reference: await referenceOf(boPayoutId), amount: "$99,75 USD", fee: "$0,00 USD", status: "Denied" },
      ]);

      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: log })).resolves.toEqual({
        ...noResults,
        settled: 1,
        failed: 1,
      });

      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "succeeded", paypalItemId: "TX1" });
      expect(await rowOf(boPayoutId)).toMatchObject({ status: "failed" });
      expect(await ledgerOf(teamId, memberId)).toMatchObject({ reserved: 0, paidOut: 49_975 });
      expect(await ledgerOf(teamId, boId)).toMatchObject({ available: 85_000, reserved: 0 });
    });

    it("holds a cancelled export PayPal shows as pending until PayPal's log settles it", async () => {
      const { adaPayoutId, boPayoutId, admin, services } = await exportTeam();
      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId] });
      await admin.payouts.cancelExport({ ...TEAM, requestId: adaPayoutId });
      const reference = await referenceOf(adaPayoutId);
      const logOf = (status: string) => payoutsWebLog([{ reference, amount: "$499,75 USD", fee: "$0,25 USD", status }]);
      const pendingReason = "PayPal shows this cancelled export as pending. Check PayPal before paying it again.";

      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: logOf("Unclaimed") })).resolves.toEqual({
        ...noResults,
        pending: 1,
      });
      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "queued", reviewReason: pendingReason });
      const refusal = { code: "BAD_REQUEST", message: pendingReason };
      await expect(admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId] })).rejects.toMatchObject(refusal);
      await expect(admin.payouts.retry({ ...TEAM, requestId: adaPayoutId })).rejects.toMatchObject(refusal);
      await turnOnAutomaticPayouts(admin);
      await sendDuePayouts({ db, payouts: services.payouts }, { now: new Date() });
      // Only Bo's approved payout went.
      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "queued" });
      expect(await rowOf(boPayoutId)).toMatchObject({ status: "sent" });

      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: logOf("Completed") })).resolves.toEqual({
        ...noResults,
        settled: 1,
      });
      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "succeeded", reviewReason: null });
    });

    it("flags a payout PayPal paid from both the cancelled and the new export", async () => {
      const { adaPayoutId, admin } = await exportTeam();
      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId] });
      await admin.payouts.cancelExport({ ...TEAM, requestId: adaPayoutId });
      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId] });
      const paid = { reference: await referenceOf(adaPayoutId), amount: "$499,75 USD", fee: "$0,25 USD", status: "Completed" };
      const secondLog = payoutsWebLog([{ ...paid, transactionId: "TX2" }]);
      await admin.payouts.importPayoutsWeb({ ...TEAM, csv: secondLog });

      await expect(
        admin.payouts.importPayoutsWeb({ ...TEAM, csv: payoutsWebLog([{ ...paid, transactionId: "TX1" }]) }),
      ).resolves.toEqual({ ...noResults, paidTwice: 1 });
      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "succeeded", paypalItemId: "TX2", reviewReason: PAID_TWICE });
      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: secondLog })).resolves.toEqual({ ...noResults, settled: 1 });
    });

    it("flags a payout PayPal paid from a cancelled export after automatic payouts sent it", async () => {
      const { adaPayoutId, admin } = await exportTeam();
      await admin.payouts.exportPayoutsWeb({ ...TEAM, requestIds: [adaPayoutId] });
      await admin.payouts.cancelExport({ ...TEAM, requestId: adaPayoutId });
      const log = payoutsWebLog([
        { reference: await referenceOf(adaPayoutId), amount: "$499,75 USD", fee: "$0,25 USD", status: "Completed" },
      ]);
      await turnOnAutomaticPayouts(admin);
      await expect(admin.payouts.retry({ ...TEAM, requestId: adaPayoutId })).resolves.toMatchObject({ status: "sent" });

      await expect(admin.payouts.importPayoutsWeb({ ...TEAM, csv: log })).resolves.toEqual({ ...noResults, paidTwice: 1 });
      expect(await rowOf(adaPayoutId)).toMatchObject({ status: "sent", reviewReason: PAID_TWICE });
    });
  });
});
