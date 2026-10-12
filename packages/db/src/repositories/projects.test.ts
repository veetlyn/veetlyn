import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { delivery } from "../schema/projects";
import {
  createTestDb,
  hasTestDatabase,
  seedPayment,
  seedProject,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "../testing/db";
import { addPaymentRefunded, countOpenWebRequests, listProjectDeliveries, listRefundablePayments } from "./projects";

describe.skipIf(!hasTestDatabase)("countOpenWebRequests", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("counts only the email's web requests in open statuses, for that team", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const { teamId: otherTeamId } = await seedServicesTeamWithAdmin(db, { slug: "other" });
    const email = "asker@example.com";

    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "quoting" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "in_progress" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "completed" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "cancelled" });
    await seedProject(db, { teamId, clientEmail: email, source: "admin", status: "quoting" });
    await seedProject(db, { teamId, clientEmail: "other@example.com", source: "web", status: "quoting" });
    await seedProject(db, { teamId: otherTeamId, clientEmail: email, source: "web", status: "quoting" });

    await expect(countOpenWebRequests(db, { teamId, clientEmail: email })).resolves.toBe(2);
  });
});

describe.skipIf(!hasTestDatabase)("project deliveries", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("lists a project's deliveries oldest first, ignoring other projects", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const otherProjectId = await seedProject(db, { teamId, title: "Other" });
    await db.insert(delivery).values([
      { id: "d2", projectId, teamId, submittedById: userId, note: "second", createdAt: new Date("2026-01-02T00:00:00Z") },
      {
        id: "d1",
        projectId,
        teamId,
        note: "first",
        status: "changes_requested",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      { id: "d3", projectId: otherProjectId, teamId, note: "elsewhere" },
    ]);

    expect((await listProjectDeliveries(db, projectId)).map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("keeps one submitted delivery per project, after any number of change requests", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    await db.insert(delivery).values({ projectId, teamId, status: "changes_requested" });
    await db.insert(delivery).values({ projectId, teamId });

    // Drizzle wraps the postgres error; the 23505 code and constraint name live on the cause.
    const failure = await db
      .insert(delivery)
      .values({ projectId, teamId })
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ cause: { code: "23505", constraint_name: "delivery_open_idx" } });
    expect(await listProjectDeliveries(db, projectId)).toHaveLength(2);
  });
});

describe.skipIf(!hasTestDatabase)("payment refunds", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedCaptured(amountMinor = 10_000) {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId, status: "in_progress" });
    const row = await seedPayment(db, { projectId, teamId, amountMinor });
    return { teamId, projectId, payment: row };
  }

  it("keeps a partly refunded payment captured and marks it refunded once nothing is left", async () => {
    const { payment } = await seedCaptured();

    expect(await addPaymentRefunded(db, payment.id, 4_000)).toMatchObject({ refundedMinor: 4_000, status: "captured" });
    expect(await addPaymentRefunded(db, payment.id, 6_000)).toMatchObject({ refundedMinor: 10_000, status: "refunded" });
    expect(await addPaymentRefunded(db, "missing", 1)).toBeNull();
  });

  it("refuses to refund more than was captured", async () => {
    const { payment } = await seedCaptured();
    await addPaymentRefunded(db, payment.id, 9_000);

    const failure = await addPaymentRefunded(db, payment.id, 2_000).catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ cause: { code: "23514", constraint_name: "payment_refunded_check" } });
  });

  it("lists captured payments with something left to refund, newest capture first", async () => {
    const { teamId, projectId } = await seedCaptured();
    const [older] = await listRefundablePayments(db, projectId);
    const newer = await seedPayment(db, {
      projectId,
      teamId,
      kind: "top_up",
      capturedAt: new Date(Date.now() + 60_000),
    });
    const refunded = await seedPayment(db, { projectId, teamId, kind: "balance", amountMinor: 5_000 });
    await addPaymentRefunded(db, refunded.id, 5_000);
    const otherProject = await seedProject(db, { teamId });
    await seedPayment(db, { projectId: otherProject, teamId });

    expect((await listRefundablePayments(db, projectId)).map((p) => p.id)).toEqual([newer.id, older?.id]);
  });
});
