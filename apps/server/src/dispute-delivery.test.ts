import type { PayPalServices } from "@jendal-workspace/api/context";
import { processPayPalWebhookEvent } from "@jendal-workspace/api/use-cases/paypal-webhooks";
import { findWebhookEvent, finishWebhookEvent, noteWebhookAttempt } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { dispute, scheduleItem } from "@jendal-workspace/db/schema/operating-model";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { payment } from "@jendal-workspace/db/schema/projects";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { createPayPalClient } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse } from "@jendal-workspace/paypal/testing";
import { fromPartial } from "@total-typescript/shoehorn";
import { eq, sql } from "drizzle-orm";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "./app-env";
import { handlePayPalWebhookBatch } from "./paypal-webhook-queue";
import { createPayPalWebhookRoute } from "./routes/paypal-webhooks";

describe.skipIf(!hasTestDatabase)("durable dispute delivery", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("retries a verified stored dispute after case persistence fails and applies redeliveries once", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId, status: "in_progress" });
    await db.insert(payment).values({ projectId, teamId, kind: "deposit", status: "captured", currency: "USD", quotePartMinor: 12050, managementFeeMinor: 0, amountMinor: 12050, lines: [], paypalCaptureId: "CAP-1" });
    await db.insert(scheduleItem).values({ teamId, subjectId: projectId, kind: "member.updateLate", runAt: new Date(Date.now() + 86_400_000) });
    const api = fakeFetch((request) => request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(200, { verification_status: "SUCCESS" }));
    const paypal = fromPartial<PayPalServices>({ client: createPayPalClient({ clientId: "test-client", clientSecret: "test-secret", environment: "sandbox", fetch: api.fetch }) });
    const enqueue = vi.fn(async () => {});
    const app = new Hono<AppEnv>();
    app.use(evlog());
    app.use(async (c, next) => { c.set("db", db); await next(); });
    app.route("/webhooks/paypal", createPayPalWebhookRoute({ paypal, webhookId: "WEBHOOK-1", enqueue }));
    const send = () => app.request("/webhooks/paypal", { method: "POST", headers: {
      "content-type": "application/json", "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "paypal-transmission-id": "transmission", "paypal-transmission-sig": "signature", "paypal-transmission-time": "2026-10-25T12:00:00Z",
    }, body: JSON.stringify({ id: "WH-D1", event_type: "CUSTOMER.DISPUTE.CREATED", resource_type: "dispute", resource: {
      dispute_id: "CASE-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "OPEN", dispute_amount: { value: "120.50", currency_code: "USD" }, disputed_transactions: [{ seller_transaction_id: "CAP-1" }],
    } }) });
    expect((await send()).status).toBe(200);
    expect(await findWebhookEvent(db, "WH-D1")).toMatchObject({ disputePayload: expect.objectContaining({ id: "WH-D1" }), status: "received" });
    expect(await db.select().from(dispute)).toEqual([]);
    const deps = {
      find: (id: string) => findWebhookEvent(db, id),
      finish: (id: string, outcome: Parameters<typeof finishWebhookEvent>[2]) => finishWebhookEvent(db, id, outcome),
      noteAttempt: (id: string, note: string) => noteWebhookAttempt(db, id, note),
      process: (event: NonNullable<Awaited<ReturnType<typeof findWebhookEvent>>>) => processPayPalWebhookEvent({ db, paypal, disputes: { alertEmail: "disputes@example.com", dashOrigin: "https://dash.example.com" } }, event),
    };
    const message = (attempts: number) => ({ body: { eventId: "WH-D1" }, attempts, ack: vi.fn(), retry: vi.fn() });
    await db.execute(sql`alter table outbox add constraint reject_case_notice check (type <> 'dispute.opened')`);
    const failed = message(1);
    try {
      await handlePayPalWebhookBatch([failed], deps);
      expect(failed.retry).toHaveBeenCalledOnce();
      expect(failed.ack).not.toHaveBeenCalled();
      expect(await db.select().from(dispute)).toEqual([]);
      expect(await db.select().from(scheduleItem)).toEqual([expect.objectContaining({ status: "pending" })]);
      expect(await findWebhookEvent(db, "WH-D1")).toMatchObject({ status: "received", attempts: 1 });
    } finally { await db.execute(sql`alter table outbox drop constraint reject_case_notice`); }
    const recovered = message(2);
    await handlePayPalWebhookBatch([recovered], deps);
    expect(recovered.ack).toHaveBeenCalledOnce();
    expect(await findWebhookEvent(db, "WH-D1")).toMatchObject({ status: "processed" });
    expect(await db.select().from(dispute)).toEqual([expect.objectContaining({ teamId, projectId, status: "open" })]);
    expect(await db.select().from(scheduleItem)).toEqual([expect.objectContaining({ status: "paused" })]);
    await handlePayPalWebhookBatch([message(3)], deps);
    expect((await send()).status).toBe(200);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(await db.select().from(outbox).where(eq(outbox.type, "dispute.opened"))).toHaveLength(1);
  });
});
