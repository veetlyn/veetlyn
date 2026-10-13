import {
  completionTransfer,
  importSecretKey,
  paymentCapturedTransfer,
  payoutRequestedTransfer,
  sealSecret,
} from "@jendal-workspace/core";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import { saveTeamPayoutCredentials } from "@jendal-workspace/db/repositories/payout-credentials";
import {
  getPayoutRequest,
  insertPayoutRequest,
  updatePayoutRequest,
} from "@jendal-workspace/db/repositories/payout-requests";
import {
  createTestDb,
  hasTestDatabase,
  seedProject,
  seedServicesTeamWithAdmin,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { type JsonKv, PayPalError } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { log } from "evlog";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPayoutServices, settleSentPayouts } from "./payouts";

const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const CLIENT_ID = "team-app-client-id";
const GOOD_SECRET = "team-app-secret";
const basicAuth = (secret: string) => `Basic ${btoa(`${CLIENT_ID}:${secret}`)}`;

function fakeKv() {
  const entries = new Map<string, string>();
  const kv: JsonKv = {
    async get(key) {
      const value = entries.get(key);
      return value === undefined ? null : JSON.parse(value);
    },
    async put(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
  };
  return { kv, entries };
}

const pathOf = (request: RecordedRequest) => new URL(request.url).pathname;
const tokenCalls = (requests: RecordedRequest[]) => requests.filter((r) => pathOf(r) === "/v1/oauth2/token");

describe("createPayoutServices", () => {
  it("never uses a token cached for one secret with another, and keys the cache without the secret", async () => {
    const { kv, entries } = fakeKv();
    const paypal = fakeFetch((request) => {
      if (pathOf(request) === "/v1/oauth2/token") {
        return request.headers.get("authorization") === basicAuth(GOOD_SECRET)
          ? jsonResponse(200, FAKE_TOKEN_RESPONSE)
          : jsonResponse(401, { error: "invalid_client", error_description: "Client Authentication failed" });
      }
      return jsonResponse(200, { batch_header: { payout_batch_id: "BATCH1", batch_status: "SUCCESS" }, items: [] });
    });
    const services = createPayoutServices({
      secretKey: await importSecretKey(TEST_KEY),
      environment: "sandbox",
      tokenKv: kv,
      fetch: paypal.fetch,
    });
    const batchWith = (clientSecret: string) =>
      services.clientFor({ teamId: "team-1", clientId: CLIENT_ID, clientSecret }).payouts.getBatch("BATCH1");

    await batchWith(GOOD_SECRET);
    const wrong = await batchWith("wrong-secret").catch((error: Error) => error);
    await batchWith(GOOD_SECRET);

    expect(wrong).toBeInstanceOf(PayPalError);
    expect(wrong).toMatchObject({ status: 401 });
    expect(tokenCalls(paypal.requests).map((r) => r.headers.get("authorization"))).toEqual([
      basicAuth(GOOD_SECRET),
      basicAuth("wrong-secret"),
    ]);
    const keys = [...entries.keys()];
    expect(keys).toEqual([expect.stringMatching(/^paypal-token:sandbox:team:team-1:[0-9a-f]{64}$/)]);
    expect(keys[0]).not.toContain(GOOD_SECRET);
    expect(paypal.requests.every((r) => !r.headers.has("PayPal-Partner-Attribution-Id"))).toBe(true);
  });
});

const NOW = new Date("2026-10-12T12:00:00Z");
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe.skipIf(!hasTestDatabase)("settleSentPayouts", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => db.$client.end());

  async function sentRequest(input: { teamId: string; userId: string; batchId: string; sentAt: Date; updatedAt?: Date }) {
    const request = await insertPayoutRequest(db, {
      id: crypto.randomUUID(),
      teamId: input.teamId,
      userId: input.userId,
      currency: "USD",
      amountMinor: 2_500,
      receiverPayerId: "G83JXTJ5EHCQ2",
    });
    if (!request) throw new Error("No payout request inserted");
    return updatePayoutRequest(db, request.id, {
      status: "sent",
      feeEstimateMinor: 25,
      sentMinor: 2_475,
      paypalBatchId: input.batchId,
      sentAt: input.sentAt,
      updatedAt: input.updatedAt,
    });
  }

  async function saveCredentials(teamId: string) {
    const sealed = await sealSecret(await importSecretKey(TEST_KEY), "v1", GOOD_SECRET, teamId);
    await saveTeamPayoutCredentials(db, {
      teamId,
      clientId: CLIENT_ID,
      secretCiphertext: sealed.ciphertext,
      secretIv: sealed.iv,
      keyId: sealed.keyId,
      paypalAccountId: null,
      verifiedAt: NOW,
    });
  }

  // $850 earned on a completed project, $25 of it reserved by the payout request.
  async function reserve(teamId: string, freelancerId: string, payoutRequestId: string) {
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
        payoutRequestedTransfer({ currency: "USD", payoutRequestId, freelancerId, amountMinor: 2_500 }),
      ]),
    );
  }

  it("settles the other teams' payouts when one team's settle fails, and leaves payouts sent under a minute ago", async () => {
    const secretKey = await importSecretKey(TEST_KEY);
    const noCredentials = await seedServicesTeamWithAdmin(db, { slug: "no-credentials" });
    const paying = await seedServicesTeamWithAdmin(db, { slug: "paying" });
    const ada = await seedUser(db, "Ada");
    const grace = await seedUser(db, "Grace");
    const stuck = await sentRequest({ teamId: noCredentials.teamId, userId: ada, batchId: "BATCH-A", sentAt: secondsAgo(600) });
    const settled = await sentRequest({ teamId: paying.teamId, userId: ada, batchId: "BATCH-B", sentAt: secondsAgo(300) });
    const recent = await sentRequest({ teamId: paying.teamId, userId: grace, batchId: "BATCH-C", sentAt: secondsAgo(30) });
    await reserve(paying.teamId, ada, settled.id);
    await saveCredentials(paying.teamId);
    const paypal = fakeFetch((request) => {
      if (pathOf(request) === "/v1/oauth2/token") return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      if (pathOf(request) !== "/v1/payments/payouts/BATCH-B") return jsonResponse(500, { name: "UNEXPECTED_CALL" });
      return jsonResponse(200, {
        batch_header: { payout_batch_id: "BATCH-B", batch_status: "SUCCESS" },
        items: [
          {
            payout_item_id: "ITEM-B",
            transaction_status: "SUCCESS",
            payout_item_fee: { currency: "USD", value: "0.25" },
            payout_item: { sender_item_id: settled.id, receiver: "G83JXTJ5EHCQ2", amount: { value: "25.00", currency: "USD" } },
          },
        ],
      });
    });
    const payouts = createPayoutServices({ secretKey, environment: "sandbox", tokenKv: fakeKv().kv, fetch: paypal.fetch });
    const error = vi.spyOn(log, "error");

    await expect(settleSentPayouts({ db, payouts, now: () => NOW })).resolves.toEqual({ checked: 2, settled: 1 });

    await expect(getPayoutRequest(db, settled.id)).resolves.toMatchObject({ status: "succeeded", feeMinor: 25 });
    await expect(getPayoutRequest(db, stuck.id)).resolves.toMatchObject({ status: "sent" });
    await expect(getPayoutRequest(db, recent.id)).resolves.toMatchObject({ status: "sent" });
    expect(paypal.requests.filter((r) => pathOf(r).startsWith("/v1/payments/payouts/")).map(pathOf)).toEqual([
      "/v1/payments/payouts/BATCH-B",
    ]);
    expect(error).toHaveBeenCalledExactlyOnceWith({
      action: "maintenance.payouts.settle",
      payoutRequest: { id: stuck.id },
      team: { id: noCredentials.teamId },
      error: { code: "PRECONDITION_FAILED", note: expect.any(String) },
    });
  });

  it("moves each checked payout to the back, so payouts that stay pending or fail never block the others", async () => {
    const noCredentials = await seedServicesTeamWithAdmin(db, { slug: "no-credentials" });
    const paying = await seedServicesTeamWithAdmin(db, { slug: "paying" });
    await saveCredentials(paying.teamId);
    const ada = await seedUser(db, "Ada");
    const grace = await seedUser(db, "Grace");
    const longAgo = (day: number) => new Date(Date.UTC(2000, 0, day));
    await sentRequest({ teamId: noCredentials.teamId, userId: ada, batchId: "BATCH-A", sentAt: secondsAgo(900), updatedAt: longAgo(1) });
    const pending = await sentRequest({ teamId: paying.teamId, userId: ada, batchId: "BATCH-B", sentAt: secondsAgo(600), updatedAt: longAgo(2) });
    const newest = await sentRequest({ teamId: paying.teamId, userId: grace, batchId: "BATCH-C", sentAt: secondsAgo(300), updatedAt: longAgo(3) });
    const paypal = fakeFetch((request) => {
      if (pathOf(request) === "/v1/oauth2/token") return jsonResponse(200, FAKE_TOKEN_RESPONSE);
      const batchId = pathOf(request).split("/").at(-1) ?? "";
      const requestId = batchId === "BATCH-B" ? pending.id : newest.id;
      return jsonResponse(200, {
        batch_header: { payout_batch_id: batchId, batch_status: "PROCESSING" },
        items: [{ payout_item_id: `ITEM-${batchId}`, transaction_status: "PENDING", payout_item: { sender_item_id: requestId } }],
      });
    });
    const payouts = createPayoutServices({
      secretKey: await importSecretKey(TEST_KEY),
      environment: "sandbox",
      tokenKv: fakeKv().kv,
      fetch: paypal.fetch,
    });
    vi.spyOn(log, "error").mockImplementation(() => undefined);

    for (let run = 0; run < 3; run++) {
      await expect(settleSentPayouts({ db, payouts, now: () => NOW, limit: 1 })).resolves.toEqual({ checked: 1, settled: 0 });
    }

    expect(paypal.requests.filter((r) => pathOf(r).startsWith("/v1/payments/payouts/")).map(pathOf)).toEqual([
      "/v1/payments/payouts/BATCH-B",
      "/v1/payments/payouts/BATCH-C",
    ]);
  });
});
