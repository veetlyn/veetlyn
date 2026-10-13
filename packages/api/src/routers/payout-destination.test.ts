import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, type JsonValue } from "@jendal-workspace/core";
import { getPayoutDestination } from "@jendal-workspace/db/repositories/payouts";
import { account } from "@jendal-workspace/db/schema/auth";
import { createTestDb, hasTestDatabase, seedUser, truncateAll } from "@jendal-workspace/db/testing/db";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

// PayPal's user_id for the linked account (the Better Auth account ID) and its separate payer ID (Fact 14).
const PAYPAL_USER_ID = "https://www.paypal.com/webapps/auth/identity/user/abc123";
const PAYER_ID = "G83JXTJ5EHCQ2";

function stubUserInfo(body: JsonValue, status = 200) {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  vi.stubGlobal("fetch", async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe.skipIf(!hasTestDatabase)("payoutDestination", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => db.$client.end());

  const caller = (userId: string) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

  async function linkPayPal(userId: string) {
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: PAYPAL_USER_ID,
      providerId: "paypal",
      userId,
      accessToken: "paypal-access-token",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
  }

  it("returns null before any PayPal connection, and rejects anonymous callers", async () => {
    const userId = await seedUser(db, "Ada");

    await expect(caller(userId).payoutDestination.get()).resolves.toBeNull();
    await expect(
      appRouter
        .createCaller({
          db,
          session: null,
          environment: "sandbox",
          auth,
          headers: new Headers(),
          catalog: createTestCatalogServices(),
          files: createFakeFileStore(),
        })
        .payoutDestination.get(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("asks PayPal for the linked account's payer ID and country, saves them and reads them back", async () => {
    const userId = await seedUser(db, "Bea");
    await linkPayPal(userId);
    const calls = stubUserInfo({
      user_id: PAYPAL_USER_ID,
      payer_id: PAYER_ID,
      email: "bea@example.com",
      email_verified: true,
      address: { country: "SN", postal_code: "12500" },
    });

    const saved = await caller(userId).payoutDestination.connect();

    expect(saved).toEqual({
      paypalPayerId: PAYER_ID,
      paypalEmail: "bea@example.com",
      verifiedAt: expect.any(String),
      ageConfirmed: false,
    });
    expect(calls).toEqual([
      {
        url: "https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo?schema=paypalv1.1",
        authorization: "Bearer paypal-access-token",
      },
    ]);
    await expect(caller(userId).payoutDestination.get()).resolves.toMatchObject({ paypalPayerId: PAYER_ID });
    await expect(getPayoutDestination(db, userId)).resolves.toMatchObject({ paypalCountry: "SN" });
  });

  it("fails clearly without a linked PayPal account, without calling PayPal", async () => {
    const userId = await seedUser(db, "Cleo");
    const calls = stubUserInfo({});

    await expect(caller(userId).payoutDestination.connect()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Connect PayPal first, then come back to this page.",
    });
    expect(calls).toEqual([]);
  });

  it("saves nothing when PayPal's answer is for another account, has no payer ID, is not an object, or is an error", async () => {
    const userId = await seedUser(db, "Dee");
    await linkPayPal(userId);
    const unconfirmed = { code: "PRECONDITION_FAILED", message: "PayPal did not confirm your payer ID. Connect PayPal again." };

    stubUserInfo({ user_id: "https://www.paypal.com/webapps/auth/identity/user/other", payer_id: PAYER_ID });
    await expect(caller(userId).payoutDestination.connect()).rejects.toMatchObject(unconfirmed);
    stubUserInfo({ user_id: PAYPAL_USER_ID });
    await expect(caller(userId).payoutDestination.connect()).rejects.toMatchObject(unconfirmed);
    stubUserInfo(PAYER_ID);
    await expect(caller(userId).payoutDestination.connect()).rejects.toMatchObject(unconfirmed);
    stubUserInfo({ name: "invalid_token" }, 401);
    await expect(caller(userId).payoutDestination.connect()).rejects.toMatchObject(unconfirmed);
    await expect(caller(userId).payoutDestination.get()).resolves.toBeNull();
  });

  it.each<{ name: string; userInfo: JsonValue; confirmAdult: boolean; source: string }>([
    {
      name: "PayPal's age range",
      userInfo: { user_id: PAYPAL_USER_ID, payer_id: PAYER_ID, age_range: "18-24" },
      confirmAdult: false,
      source: "paypal",
    },
    {
      name: "the member's confirmation when PayPal sends no age",
      userInfo: { user_id: PAYPAL_USER_ID, payer_id: PAYER_ID },
      confirmAdult: true,
      source: "self",
    },
  ])("records the age from $name", async ({ userInfo, confirmAdult, source }) => {
    const userId = await seedUser(db, "Eve");
    await linkPayPal(userId);
    stubUserInfo(userInfo);

    await expect(caller(userId).payoutDestination.connect({ confirmAdult })).resolves.toMatchObject({
      ageConfirmed: true,
    });
    await expect(getPayoutDestination(db, userId)).resolves.toMatchObject({
      ageSource: source,
      ageConfirmedAt: expect.any(Date),
    });
  });

  it("refuses an account PayPal reports as under 18 and removes the destination saved before", async () => {
    const userId = await seedUser(db, "Fay");
    await linkPayPal(userId);
    stubUserInfo({ user_id: PAYPAL_USER_ID, payer_id: PAYER_ID });
    await caller(userId).payoutDestination.connect({ confirmAdult: true });

    stubUserInfo({ user_id: PAYPAL_USER_ID, payer_id: PAYER_ID, age_range: "13-17" });
    await expect(caller(userId).payoutDestination.connect({ confirmAdult: true })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "PayPal says this account belongs to someone under 18. Payouts need a recipient who is 18 or older.",
    });
    await expect(caller(userId).payoutDestination.get()).resolves.toBeNull();
  });

  it("saves without an age when PayPal sends none, until the member confirms", async () => {
    const userId = await seedUser(db, "Gus");
    await linkPayPal(userId);
    stubUserInfo({ user_id: PAYPAL_USER_ID, payer_id: PAYER_ID });

    await expect(caller(userId).payoutDestination.connect()).resolves.toMatchObject({ ageConfirmed: false });
    await expect(caller(userId).payoutDestination.confirmAdult()).resolves.toMatchObject({ ageConfirmed: true });
    await expect(caller(userId).payoutDestination.get()).resolves.toMatchObject({ ageConfirmed: true });
    await expect(getPayoutDestination(db, userId)).resolves.toMatchObject({ ageSource: "self" });
  });

  it("refuses an age confirmation without a destination", async () => {
    const userId = await seedUser(db, "Hal");

    await expect(caller(userId).payoutDestination.confirmAdult()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Connect PayPal first, then confirm your age.",
    });
  });
});
