import { Hono, type ExecutionContext } from "hono";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDatabase, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { project } from "@jendal-workspace/db/schema/projects";
import { team } from "@jendal-workspace/db/schema/organization";
import { eq } from "drizzle-orm";
import { createFakeMailer } from "@jendal-workspace/email/fake";
import { requestQuote } from "@jendal-workspace/api/use-cases/requests";
import { deliverDueOutboxDeliveries } from "@jendal-workspace/api/use-cases/outbox-dispatcher";

import { wakeNoticesAfterMutation } from "./notice-wakeup";

describe.skipIf(!hasTestDatabase)("request notice wake-up", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("delivers a committed request in the background without using the request connection", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    await db.update(team).set({ status: "active" }).where(eq(team.id, teamId));
    const mailer = createFakeMailer();
    const pending: Promise<unknown>[] = [];
    const execution = fromPartial<ExecutionContext>({ waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } });
    const app = new Hono();
    let wakes = 0;
    app.use(wakeNoticesAfterMutation(async () => {
      wakes += 1;
      const backgroundDb = createTestDb();
      try {
        await deliverDueOutboxDeliveries({ db: backgroundDb, secret: "test-secret", email: {
          mailer, platformName: "Platform", siteOrigin: "https://platform.test", dashOrigin: "https://dash.platform.test",
          storeOrigin: (slug) => `https://${slug}.platform.test`,
        } });
      } finally { await backgroundDb.$client.end(); }
    }));
    app.get("/trpc/request.list", (c) => c.json({ ok: true }));
    app.post("/trpc/request.refused", (c) => c.json({ error: "refused" }, 403));
    app.post("/trpc/request.create", async (c) => {
      const result = await requestQuote(db, { slug: "team", offeringId: null, name: "Client", email: "client@example.com", description: "A bakery logo please", answers: [] });
      return c.json(result);
    });
    await app.request("/trpc/request.list", {}, {}, execution);
    await app.request("/trpc/request.refused", { method: "POST" }, {}, execution);
    expect(wakes).toBe(0);
    const response = await app.request("/trpc/request.create", { method: "POST" }, {}, execution);
    expect(response.status).toBe(200);
    expect(await db.select().from(project)).toHaveLength(1);
    await Promise.all(pending);
    expect(wakes).toBe(1);
    expect(mailer.sent.map((message) => message.to).sort()).toEqual([`${userId}@example.com`, "client@example.com"].sort());
  });
});
