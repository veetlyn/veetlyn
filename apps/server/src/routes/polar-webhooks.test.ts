import { createHmac } from "node:crypto";

import type { PolarSubscriptionLike } from "@jendal-workspace/api/billing/polar";
import { ensureBillingAccount, getBillingAccount } from "@jendal-workspace/db/repositories/billing";
import { polarWebhookEvent } from "@jendal-workspace/db/schema/billing";
import { createTestDb, hasTestDatabase, seedOrganization, truncateAll } from "@jendal-workspace/db/testing/db";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../app-env";
import { createPolarWebhookRoute } from "./polar-webhooks";

// A test-only signing key. Sign independently of the verifier to exercise the wire protocol and exact bytes.
const key = Buffer.from("polar-webhook-test-signing-key");
const secret = `whsec_${key.toString("base64")}`;

function subscription(organizationId: string, overrides: Partial<PolarSubscriptionLike> = {}): PolarSubscriptionLike {
  return {
    id: "sub_1", status: "active", customer_id: "cus_1", product_id: "prod_1",
    current_period_end: "2026-12-10T00:00:00Z", cancel_at_period_end: false, ends_at: null,
    modified_at: "2026-11-10T00:00:00Z", created_at: "2026-10-10T00:00:00Z", metadata: {},
    customer: { external_id: organizationId }, product: { metadata: { plan_key: "team:grow:monthly" } },
    ...overrides,
  };
}

function signed(body: string, id: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}` };
}

describe.skipIf(!hasTestDatabase)("POST /webhooks/polar", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function appFor(signingSecret = secret) {
    const app = new Hono<AppEnv>();
    app.use(evlog({ drain: () => undefined }));
    app.use("*", async (c, next) => { c.set("db", db); await next(); });
    app.onError((_error, c) => c.json({ error: "internal" }, 500));
    app.route("/webhooks/polar", createPolarWebhookRoute({ secret: signingSecret }));
    return app;
  }

  async function startTrial() {
    const { organizationId } = await seedOrganization(db);
    await ensureBillingAccount(db, { organizationId, product: "services", solo: true, now: new Date() });
    return organizationId;
  }

  function post(app: Hono<AppEnv>, id: string, sub: PolarSubscriptionLike) {
    // Deliberate whitespace: reserializing the JSON before verification must fail this test.
    const body = JSON.stringify({ type: "subscription.updated", data: sub }, null, 2);
    return app.request("/webhooks/polar", { method: "POST", body, headers: signed(body, id) });
  }

  it("verifies raw bytes, applies the plan once, and ignores older snapshots", async () => {
    const organizationId = await startTrial();
    const app = appFor();
    const newer = subscription(organizationId);
    const responses = await Promise.all([post(app, "wh_1", newer), post(app, "wh_1", newer)]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    expect((await post(app, "wh_old", subscription(organizationId, {
      status: "canceled", modified_at: "2026-11-09T00:00:00Z", ends_at: "2026-11-09T00:00:00Z",
    }))).status).toBe(202);
    expect(await getBillingAccount(db, organizationId)).toMatchObject({ servicesTier: "team", storeTier: "grow", polarStatus: "active" });
    expect(await db.select().from(polarWebhookEvent)).toHaveLength(2);
  });

  it("rejects tampering, expired signatures, missing configuration, and oversized bodies without storing a receipt", async () => {
    const app = appFor();
    const body = JSON.stringify({ type: "subscription.updated", data: subscription("org_1") });
    const send = (target: Hono<AppEnv>, content: string, headers: Record<string, string>) => target.request("/webhooks/polar", { method: "POST", body: content, headers });
    expect((await send(app, body + " ", signed(body, "wh_bad"))).status).toBe(403);
    expect((await send(app, body, signed(body, "wh_old", Math.floor(Date.now() / 1000) - 600))).status).toBe(403);
    expect((await send(appFor(""), body, signed(body, "wh_off"))).status).toBe(503);
    expect((await send(app, "x".repeat(256 * 1024 + 1), {})).status).toBe(413);
    expect(await db.select().from(polarWebhookEvent)).toHaveLength(0);
  });

  it("validates signed subscription data instead of trusting SDK types", async () => {
    const organizationId = await startTrial();
    const app = appFor();
    for (const data of [null, { ...subscription(organizationId), modified_at: "not-a-date" }]) {
      const body = JSON.stringify({ type: "subscription.updated", data });
      expect((await app.request("/webhooks/polar", { method: "POST", body, headers: signed(body, "wh_invalid") })).status).toBe(400);
    }
    expect((await getBillingAccount(db, organizationId))?.polarSubscriptionId).toBeNull();
    expect(await db.select().from(polarWebhookEvent)).toHaveLength(0);
  });

  it("rolls back the receipt on an unavailable account so the same delivery can be retried", async () => {
    const { organizationId } = await seedOrganization(db);
    const app = appFor();
    const sub = subscription(organizationId);
    expect((await post(app, "wh_retry", sub)).status).toBe(500);
    expect(await db.select().from(polarWebhookEvent)).toHaveLength(0);
    await ensureBillingAccount(db, { organizationId, product: "services", solo: true, now: new Date() });
    expect((await post(app, "wh_retry", sub)).status).toBe(202);
    expect((await getBillingAccount(db, organizationId))?.polarSubscriptionId).toBe("sub_1");
  });

  it("keeps the first past-due timestamp through updates and starts a new grace period only after recovery", async () => {
    const organizationId = await startTrial();
    const app = appFor();
    const deliver = (id: string, status: PolarSubscriptionLike["status"], day: number) => post(app, id, subscription(organizationId, {
      status, modified_at: `2026-11-${day}T00:00:00Z`,
    }));
    expect((await deliver("wh_due", "past_due", 10)).status).toBe(202);
    expect((await deliver("wh_due_again", "past_due", 11)).status).toBe(202);
    expect((await getBillingAccount(db, organizationId))?.pastDueAt).toEqual(new Date("2026-11-10T00:00:00Z"));
    expect((await deliver("wh_paid", "active", 12)).status).toBe(202);
    expect((await getBillingAccount(db, organizationId))?.pastDueAt).toBeNull();
    expect((await deliver("wh_next_due", "past_due", 20)).status).toBe(202);
    expect((await getBillingAccount(db, organizationId))?.pastDueAt).toEqual(new Date("2026-11-20T00:00:00Z"));
  });
});
