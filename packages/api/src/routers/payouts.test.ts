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
import { savePayoutDestination } from "@jendal-workspace/db/repositories/payouts";
import { markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { payoutRequest } from "@jendal-workspace/db/schema/payouts";
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
function balancesAnswer(accountId: string | null, available = "250.00"): JsonObject {
  const answer: JsonObject = {
    balances: [{ currency: "USD", primary: true, total_balance: { currency_code: "USD", value: available } }],
    as_of_time: "2026-10-12T00:00:00Z",
  };
  if (accountId !== null) answer.account_id = accountId;
  return answer;
}

// Answers of the fake PayPal API; a test may swap one between calls.
type TeamPayPalAnswers = {
  token?: () => Response;
  balances?: () => Response;
  payout?: () => Response;
  batch?: () => Response;
};

// A fake PayPal API for the team's own REST app: token, balances, payouts.
function fakeTeamPayPal(answers: TeamPayPalAnswers = {}) {
  return fakeFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path === "/v1/oauth2/token") return answers.token?.() ?? jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (path === "/v1/reporting/balances") return answers.balances?.() ?? jsonResponse(200, balancesAnswer(MERCHANT_ID));
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
const balanceReads = (requests: RecordedRequest[]) => requests.filter((r) => pathOf(r) === "/v1/reporting/balances");

describe.skipIf(!hasTestDatabase)("payouts", () => {
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

  const TEAM = { teamSlug: "acme-studio" };
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

  async function confirmedDestination(userId: string) {
    await savePayoutDestination(
      db,
      userId,
      { paypalPayerId: PAYER_ID, paypalEmail: "ada@example.com" },
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

  // Saved credentials for MERCHANT1, $900 available in the team's PayPal balance, and Ada, a freelancer owed $850
  // with a confirmed destination. PayPal requests made while saving the credentials are dropped. While `gate.on`
  // is true, each payout POST waits in `gate.held` until the test answers it, so two sends can interleave.
  async function payoutTeam() {
    const { userId: adminId, organizationId, teamId } = await connectedTeam();
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Ada" });
    await confirmedDestination(memberId);
    await earn(teamId, memberId);
    const answers: TeamPayPalAnswers = {
      balances: () => jsonResponse(200, balancesAnswer(MERCHANT_ID, "900.00")),
      payout: () => batchCreated("BATCH1"),
    };
    const paypal = fakeTeamPayPal(answers);
    const gate: PayoutGate = { on: false, held: [] };
    const gatedFetch: FetchLike = (request) =>
      gate.on && new URL(request.url).pathname === "/v1/payments/payouts"
        ? new Promise((resolve) => gate.held.push({ request, answer: resolve }))
        : paypal.fetch(request);
    const { payouts } = await makePayouts(gatedFetch);
    const admin = callerFor(adminId, payouts);
    await admin.payouts.saveCredentials({ ...TEAM, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    paypal.requests.splice(0);
    return { organizationId, teamId, memberId, admin, member: callerFor(memberId, payouts), answers, paypal, payouts, gate };
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

  it("pays an approved request from the team's PayPal account and settles it once", async () => {
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
          amount: { value: "500.00", currency: "USD" },
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
    const settled = { available: 35_000, reserved: 0, paidOut: 50_000, teamRevenue: 14_975, paypalFees: 25 };
    expect(await ledgerOf(teamId, memberId)).toEqual(settled);

    await admin.payouts.refresh({ ...TEAM, requestId: id });
    expect(await ledgerOf(teamId, memberId)).toEqual(settled);
    expect(await payoutReferences(teamId)).toEqual([`payout_fees:${id}`, `payout_requested:${id}`, `payout_succeeded:${id}`]);

    await expect(member.payouts.mine()).resolves.toEqual({
      earnings: [
        {
          teamId,
          teamName: "acme-studio",
          teamSlug: "acme-studio",
          currency: "USD",
          availableMinor: 35_000,
          reservedMinor: 0,
          paidOutMinor: 50_000,
        },
      ],
      requests: [expect.objectContaining({ id, status: "succeeded", teamName: "acme-studio", teamSlug: "acme-studio" })],
    });
    await expect(admin.payouts.list(TEAM)).resolves.toEqual([
      expect.objectContaining({ id, userId: memberId, memberName: "Ada", status: "succeeded", feeMinor: 25 }),
    ]);
  });

  it("posts no fee and flags the payout for review when PayPal charges the fee in another currency", async () => {
    const { teamId, memberId, admin, member, answers } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    await admin.payouts.approve({ ...TEAM, requestId: id });

    answers.batch = () =>
      batchAnswer(id, { transaction_status: "SUCCESS", payout_item_fee: { currency: "EUR", value: "0.23" } });
    await expect(admin.payouts.refresh({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "succeeded",
      feeMinor: null,
      reviewReason: "Payout fee in another currency",
    });
    expect(await ledgerOf(teamId, memberId)).toEqual({
      available: 35_000,
      reserved: 0,
      paidOut: 50_000,
      teamRevenue: 15_000,
      paypalFees: 0,
    });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`, `payout_succeeded:${id}`]);
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

  it.each([
    {
      case: "the team's balance is below the amount",
      hold: (answers: TeamPayPalAnswers) => {
        answers.balances = () => jsonResponse(200, balancesAnswer(MERCHANT_ID, "100.00"));
      },
      attempts: [1],
    },
    {
      case: "PayPal answers INSUFFICIENT_FUNDS",
      hold: (answers: TeamPayPalAnswers) => {
        answers.payout = () =>
          jsonResponse(422, {
            name: "UNPROCESSABLE_ENTITY",
            message: "The requested action could not be performed.",
            details: [{ issue: "INSUFFICIENT_FUNDS" }],
            debug_id: "d422",
          });
      },
      attempts: [0, 1],
    },
  ])("keeps an approved request queued when $case, and sends it on retry with fresh ids", async ({ hold, attempts }) => {
    const { teamId, memberId, admin, member, answers, paypal } = await payoutTeam();
    const ready = { ...answers };
    hold(answers);
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });

    await expect(admin.payouts.approve({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "queued",
      failureMessage: LOW_BALANCE,
      decidedAt: expect.any(String),
    });
    expect(payoutPosts(paypal.requests)).toHaveLength(attempts.length - 1);
    expect(await ledgerOf(teamId, memberId)).toMatchObject({ available: 35_000, reserved: 50_000, paidOut: 0 });

    Object.assign(answers, ready);
    await expect(admin.payouts.retry({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "sent",
      failureMessage: null,
    });
    expect(batchIdsOf(payoutPosts(paypal.requests))).toEqual(
      attempts.map((attempt) => [`payout:${id}:${attempt}`, `${id}-${attempt}`]),
    );
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
    // Only the first attempt reads the balance: after an unknown outcome PayPal may already have paid from it.
    expect(balanceReads(paypal.requests)).toHaveLength(1);
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

    // Five minutes on, the first attempt looks dead and a retry takes the request over.
    await db
      .update(payoutRequest)
      .set({ updatedAt: new Date(Date.now() - 6 * 60_000) })
      .where(eq(payoutRequest.id, id));
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
      message: "Add the team's payout credentials first.",
    },
    {
      case: "the saved credentials belong to another PayPal account than the team's",
      unsettle: async (team: Awaited<ReturnType<typeof payoutTeam>>) => {
        await markTeamPayPalMerchant(db, { teamId: team.teamId, merchantId: "MERCHANT2" });
      },
      message:
        "These payout credentials belong to another PayPal account than the one connected to this team. Replace them.",
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

  it("refuses requests the member cannot make, and approvals from anyone but an admin", async () => {
    const { organizationId, teamId, memberId, member, paypal, payouts } = await payoutTeam();
    const caller = (userId: string) => callerFor(userId, payouts).payouts;

    const noDestination = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Bo" });
    await expect(caller(noDestination).request({ ...TEAM, amount: "10.00" })).rejects.toMatchObject({
      message: "Connect your PayPal account on this page first.",
    });
    const unconfirmed = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Cy" });
    await savePayoutDestination(db, unconfirmed, { paypalPayerId: "PAYER2", paypalEmail: null }, null);
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
