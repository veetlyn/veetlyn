import { createTestDb, hasTestDatabase, truncateAll } from "@jendal-workspace/db/testing/db";
import { launchWaitlist } from "@jendal-workspace/db/schema/waitlist";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../app-env";
import { createWaitlistRoute } from "./waitlist";

describe.skipIf(!hasTestDatabase)("launch waitlist HTTP boundary", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());
  function app() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => { c.set("db", db); await next(); });
    app.route("/", createWaitlistRoute("platform.test"));
    return app;
  }
  const headers = { Origin: "https://platform.test", "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" };
  function join(body: { email: string; consent: boolean; website?: string }, overrides: Record<string, string | undefined> = {}) {
    const requestHeaders = new Headers(headers);
    for (const [key, value] of Object.entries(overrides)) if (value !== undefined) requestHeaders.set(key, value);
    return app().request("https://platform.test/api/waitlist", { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
  }

  it("persists normalized consent once and does not disclose duplicate subscriptions", async () => {
    const first = await join({ email: " Person@Example.com ", consent: true });
    const duplicate = await join({ email: "person@example.com", consent: true });
    expect(first.status).toBe(200);
    expect(await duplicate.json()).toEqual(await first.json());
    expect(await db.select({ email: launchWaitlist.email }).from(launchWaitlist)).toEqual([{ email: "person@example.com" }]);
  });

  it.each([
    { body: { email: "not-an-email", consent: true }, overrides: {}, status: 400 },
    { body: { email: "person@example.com", consent: false }, overrides: {}, status: 400 },
    { body: { email: "person@example.com", consent: true }, overrides: { Origin: "https://attacker.test" }, status: 403 },
    { body: { email: "person@example.com", consent: true }, overrides: { Origin: "" }, status: 403 },
    { body: { email: "person@example.com", consent: true }, overrides: { "Content-Type": "text/plain" }, status: 415 },
  ])("rejects invalid consent/input and foreign submissions ($status)", async ({ body, overrides, status }) => {
    expect((await join(body, overrides)).status).toBe(status);
    expect(await db.select().from(launchWaitlist)).toEqual([]);
  });

  it("ignores honeypots without exposing the trap", async () => {
    const response = await join({ email: "bot@example.com", consent: true, website: "spam" });
    expect(await response.json()).toEqual({ ok: true });
    expect(await db.select().from(launchWaitlist)).toEqual([]);
  });

  it("limits repeated submissions across separate app instances", async () => {
    for (let i = 0; i < 10; i++) expect((await join({ email: "person@example.com", consent: true })).status).toBe(200);
    const response = await join({ email: "other@example.com", consent: true });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(await db.select({ email: launchWaitlist.email }).from(launchWaitlist)).toEqual([{ email: "person@example.com" }]);
  });
});
