import { setMemberNoticeEnabled } from "@jendal-workspace/db/repositories/operating-model";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { outboxDelivery } from "@jendal-workspace/db/schema/operating-model";
import { project as projectTable } from "@jendal-workspace/db/schema/projects";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import {
  createTestDb,
  hasTestDatabase,
  seedClientContact,
  seedProject,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer, type Mailer } from "@jendal-workspace/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { EmailServices } from "../context";
import { appendPayoutOutboxEvent, deliverDueOutboxDeliveries, fanOutOutboxEvents } from "../use-cases/outbox-dispatcher";

function emailServices(mailer: Mailer): EmailServices {
  return {
    mailer,
    siteOrigin: "https://example.com",
    dashOrigin: "https://dash.example.com",
    platformName: "Platform",
    storeOrigin: (slug: string) => `https://${slug}.example.com`,
  };
}

const failingMailer = () => ({
  async send() {
    throw new Error("provider down");
  },
});

describe.skipIf(!hasTestDatabase)("outbox dispatcher", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("delivers a client notice for a project event, once, with the client page link", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId, title: "Brand refresh" });
    await seedClientContact(db, {
      teamId,
      name: "Amadou",
      identities: [{ kind: "email", value: "client@example.com", verified: true }],
      projectId,
      isPrimary: false,
    });

    const events = await runInTransaction(db, (_tx, uow) =>
      uow.appendEvents({ id: projectId, teamId }, [{ type: "quote.created", data: {} }]),
    );
    expect(await fanOutOutboxEvents({ db }, events)).toBe(1);

    const mailer = createFakeMailer();
    const result = await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: "client@example.com", sender: "invoices", onBehalfOf: "team" });
    expect(mailer.sent[0]?.subject).toBe("Your quote from team");
    expect(mailer.sent[0]?.text).toContain('"Brand refresh"');
    expect(mailer.sent[0]?.text).toContain("/c/");

    // Sent stays sent: a second sweep sends nothing new.
    expect(await deliverDueOutboxDeliveries({ db, email: emailServices(createFakeMailer()), secret: "test-secret" })).toMatchObject({ sent: 0 });
  });

  it("skips a member who turned project notices off", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await seedProject(db, { teamId, title: "Brand refresh" });
    await db.update(projectTable).set({ assignedFreelancerId: memberId }).where(eq(projectTable.id, projectId));
    await setMemberNoticeEnabled(db, { teamId, userId: memberId, enabled: false });

    const events = await runInTransaction(db, (_tx, uow) =>
      uow.appendEvents({ id: projectId, teamId }, [{ type: "quote.accepted", data: {} }]),
    );
    await fanOutOutboxEvents({ db }, events);

    const mailer = createFakeMailer();
    const result = await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    // The opt-out skipped the row at fan-out time; the sweep has nothing pending to even claim.
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mailer.sent).toHaveLength(0);
    const [row] = await db.select().from(outboxDelivery);
    expect(row).toMatchObject({ status: "skipped", channel: "email_member" });
  });

  it("retries a failed buyer order email without duplicating it", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const events = await runInTransaction(db, (_tx, uow) =>
      uow.appendTeamOutbox({ teamId }, [
        {
          type: "order.paid",
          data: {
            buyerEmail: "buyer@example.com",
            productTitle: "Poster pack",
            teamName: "team",
            url: "https://team.example.com/orders/tok",
          },
        },
      ]),
    );
    expect(await fanOutOutboxEvents({ db }, events)).toBe(1);

    const down = failingMailer();
    const first = await deliverDueOutboxDeliveries({ db, email: emailServices(down), secret: "test-secret" });
    expect(first).toMatchObject({ sent: 0, failed: 1 });
    const [afterFailure] = await db.select().from(outboxDelivery);
    expect(afterFailure).toMatchObject({ status: "pending", attempts: 1 });

    // Not due again until the backoff passes.
    const tooSoon = await deliverDueOutboxDeliveries({
      db,
      email: emailServices(createFakeMailer()),
      secret: "test-secret",
      now: () => new Date(Date.now() + 30_000),
    });
    expect(tooSoon).toMatchObject({ sent: 0, failed: 0 });

    const mailer = createFakeMailer();
    const second = await deliverDueOutboxDeliveries({
      db,
      email: emailServices(mailer),
      secret: "test-secret",
      now: () => new Date(Date.now() + 5 * 60_000),
    });
    expect(second).toMatchObject({ sent: 1, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: "buyer@example.com", sender: "stores" });
    expect(mailer.sent[0]?.text).toContain("Poster pack");
    expect(await db.select().from(outboxDelivery)).toHaveLength(1);
  });

  it("writes payout events to the outbox with a delivery to the member", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);

    await appendPayoutOutboxEvent(db, {
      teamId,
      teamName: "team",
      type: "payout.requested",
      memberUserId: userId,
      amountMinor: 2500,
      currency: "USD",
      payoutRequestId: "pr_1",
    });

    const [event] = await db.select().from(outbox).where(eq(outbox.type, "payout.requested"));
    expect(event).toMatchObject({ teamId, projectId: null, sequence: 1 });
    const [delivery] = await db.select().from(outboxDelivery);
    expect(delivery).toMatchObject({ channel: "email_member", recipient: `${userId}@example.com` });

    const mailer = createFakeMailer();
    const result = await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    expect(result).toMatchObject({ sent: 1 });
    expect(mailer.sent[0]?.subject).toContain("requested");
  });
});
