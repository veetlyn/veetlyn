import { resolveClient } from "../use-cases/clients";
import { applyDeliveryOutcome, claimDueOutboxDeliveries, ensurePublishedRulebook, setMemberNoticeEnabled } from "@jendal-workspace/db/repositories/operating-model";
import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { replaceShortlist } from "@jendal-workspace/db/repositories/conversations";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { dispute, outboxDelivery } from "@jendal-workspace/db/schema/operating-model";
import { project as projectTable } from "@jendal-workspace/db/schema/projects";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
import { team } from "@jendal-workspace/db/schema/organization";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import {
  createTestDb,
  hasTestDatabase,
  seedProject,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer, mailerWithTransports, type OutgoingEmail, type Transport, type Mailer } from "@jendal-workspace/email";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { EmailServices } from "../context";
import { appendPayoutOutboxEvent, deliverDueOutboxDeliveries, fanOutOutboxEvents } from "../use-cases/outbox-dispatcher";
import { addQuote, assignFreelancer, startProject, type ProjectActor } from "../use-cases/projects";
import { postConversationMessage } from "../use-cases/conversations";
import { requestQuote } from "../use-cases/requests";
import { giveMemberLeavingNotice } from "../use-cases/rulebooks";

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

  async function buyerDelivery() {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const events = await runInTransaction(db, (_tx, uow) => uow.appendTeamOutbox({ teamId }, [{
      type: "order.paid",
      data: { buyerEmail: "buyer@example.com", productTitle: "Poster pack", teamName: "team", url: "https://team.example.com/orders/tok" },
    }]));
    await fanOutOutboxEvents({ db }, events);
  }

  async function quotedClient() {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const actor: ProjectActor = { teamId, actorId: userId, role: "admin" };
    const { projectId } = await startProject(db, actor, { title: "Brand refresh", clientEmail: "client@example.com", clientName: "Amadou" });
    await assignFreelancer(db, actor, { projectId, freelancerId: userId });
    await addQuote(db, actor, { projectId, freelancerId: userId, items: [{ description: "Logo", amountMinor: 20_000, extraDays: 0 }], deliveryDays: 3 });
    return { teamId, projectId, userId };
  }

  it("does not verify one address from another address's actual notice link, including cached retries", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    await db.update(team).set({ status: "active" }).where(eq(team.id, teamId));
    const actor: ProjectActor = { teamId, actorId: userId, role: "admin" };
    await startProject(db, actor, { title: "First", clientEmail: "first@example.com", clientDiscordId: "shared-discord" });
    await startProject(db, actor, { title: "Second", clientEmail: "second@example.com", clientDiscordId: "shared-discord" });
    const { projectId } = await requestQuote(db, { slug: "team", offeringId: null, name: "Client", email: "first@example.com", description: "A bakery logo please", answers: [] });
    const first = createFakeMailer();
    const at = new Date(Date.now() + 1000);
    await deliverDueOutboxDeliveries({ db, secret: "test-secret", now: () => at, email: emailServices({
      send: async (message) => {
        if (message.to === "first@example.com") throw new Error("acknowledgement lost");
        await first.send(message);
      },
    }) });
    const secondAddress = first.sent.find((message) => message.to === "second@example.com");
    const link = secondAddress?.text.match(/https:\/\/[^\s]+\/c\/[A-Za-z0-9_.-]+/)?.[0];
    if (!link) throw new Error("Second address did not receive a client link");
    const retried = createFakeMailer();
    await deliverDueOutboxDeliveries({ db, secret: "test-secret", now: () => new Date(at.getTime() + 120_000), email: emailServices(retried) });
    expect(retried.sent.map((message) => message.to)).toEqual(["first@example.com"]);
    expect(await resolveClient(db, "test-secret", { token: new URL(link).pathname.slice(3) })).toMatchObject({ ok: true });
    const attached = await primaryContactFor(db, projectId);
    if (!attached) throw new Error("Missing client");
    const identities = await db.select().from(clientIdentity).where(eq(clientIdentity.contactId, attached.contactId));
    expect(identities.filter((identity) => identity.kind === "email").map((identity) => ({ email: identity.value, verifiedAt: identity.verifiedAt })).sort((a, b) => a.email.localeCompare(b.email))).toEqual([
      { email: "first@example.com", verifiedAt: null }, { email: "second@example.com", verifiedAt: null },
    ]);
  });

  it("honours request visibility and keeps a private client reply away from request-only bidders", async () => {
    const { teamId, userId, organizationId } = await seedServicesTeamWithAdmin(db);
    await db.update(team).set({ status: "active" }).where(eq(team.id, teamId));
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const picked = await seedServicesTeamMember(db, { teamId, organizationId, role: "freelancer" });
    await seedServicesTeamMember(db, { teamId, organizationId, role: "freelancer" });
    await seedServicesTeamWithAdmin(db, { slug: "stranger" });
    const { projectId } = await requestQuote(db, { slug: "team", offeringId: null, name: "Client", email: "client@example.com", description: "A bakery logo please", answers: [] });
    await replaceShortlist(db, { projectId, userIds: [picked] });
    const mailer = createFakeMailer();
    await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    expect(mailer.sent.map((message) => message.to).sort()).toEqual([`${picked}@example.com`, `${userId}@example.com`, "client@example.com"].sort());
    const contact = await primaryContactFor(db, projectId);
    if (!contact) throw new Error("Missing client contact");
    await postConversationMessage(db, { kind: "client", contactId: contact.contactId }, { projectId, kind: "text", body: "For the managers only", teamOnly: true }, "web");
    const replyMailer = createFakeMailer();
    await deliverDueOutboxDeliveries({ db, email: emailServices(replyMailer), secret: "test-secret" });
    expect(replyMailer.sent.map((message) => message.to)).toEqual([`${userId}@example.com`]);
  });

  it("notifies workspace admins about leaving members and disputes alongside the central inbox", async () => {
    const { teamId, userId, organizationId } = await seedServicesTeamWithAdmin(db);
    const leaver = await seedServicesTeamMember(db, { teamId, organizationId, role: "freelancer" });
    const published = await ensurePublishedRulebook(db, teamId);
    await giveMemberLeavingNotice(db, { teamId, userId: leaver, rulebook: published.spec });
    const leaving = createFakeMailer();
    await deliverDueOutboxDeliveries({ db, email: emailServices(leaving) });
    expect(leaving.sent.map((message) => message.to)).toEqual([`${userId}@example.com`]);
    await runInTransaction(db, (_tx, uow) => uow.appendTeamOutbox({ teamId }, [{ type: "dispute.opened", data: {
      alertEmail: "disputes@example.com", teamName: "team", projectTitle: "Logo", disputeId: "case", reason: "Not received", amount: "USD 10.00", url: "https://dash.example.com/team/projects/case",
    } }]));
    const disputeMailer = createFakeMailer();
    await deliverDueOutboxDeliveries({ db, email: emailServices(disputeMailer) });
    expect(disputeMailer.sent.map((message) => message.to).sort()).toEqual([`${userId}@example.com`, "disputes@example.com"].sort());
  });

  it("does not reuse a frozen client message after its contact is removed", async () => {
    const { projectId } = await quotedClient();
    expect((await deliverDueOutboxDeliveries({ db, email: emailServices(failingMailer()), secret: "test-secret" })).failed).toBeGreaterThan(0);
    const frozen = (await db.select().from(outboxDelivery)).find((row) => row.recipient === "client@example.com");
    expect(frozen).toMatchObject({ status: "pending", attempts: 1 });
    expect(frozen?.message).not.toBeNull();
    const now = new Date();
    await db.delete(projectClient).where(eq(projectClient.projectId, projectId));
    const mailer = createFakeMailer();
    await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret", now: () => new Date(now.getTime() + 5 * 60_000) });
    expect(mailer.sent.some((message) => message.to === "client@example.com")).toBe(false);
    expect((await db.select().from(outboxDelivery)).find((row) => row.recipient === "client@example.com")?.status).toBe("skipped");
  });

  it("does not describe pending balance and refund facts as completed money movement", async () => {
    const { projectId, teamId } = await quotedClient();
    await deliverDueOutboxDeliveries({ db, email: emailServices(createFakeMailer()), secret: "test-secret" });
    await runInTransaction(db, (_tx, uow) => uow.appendEvents({ id: projectId, teamId }, [
      { type: "project.auto_completed", data: { to: "awaiting_balance" } },
      { type: "payment.created", data: { kind: "balance", amountMinor: 1000 } },
      { type: "refund.requested", data: { amountMinor: 500 } },
    ]));
    const mailer = createFakeMailer();
    await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    const client = mailer.sent.filter((message) => message.to === "client@example.com");
    expect.soft(client.some((message) => message.tag === "notice-project_auto_completed")).toBe(false);
    expect.soft(client.find((message) => message.tag === "notice-refund_requested")?.text).toContain("recorded");
    expect(client.find((message) => message.tag === "notice-payment_created")?.subject).toContain("Payment requested");
  });

  it("honours a member opt-out made after fan-out and before the external send", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await seedProject(db, { teamId, status: "awaiting_deposit" });
    await db.update(projectTable).set({ assignedFreelancerId: memberId }).where(eq(projectTable.id, projectId));
    const events = await runInTransaction(db, (_tx, uow) => uow.appendEvents({ id: projectId, teamId }, [{ type: "quote.accepted", data: {} }]));
    await fanOutOutboxEvents({ db }, events);
    await setMemberNoticeEnabled(db, { teamId, userId: memberId, enabled: false });
    const mailer = createFakeMailer();
    await deliverDueOutboxDeliveries({ db, email: emailServices(mailer) });
    expect(mailer.sent.some((message) => message.to === `${memberId}@example.com`)).toBe(false);
    expect((await db.select().from(outboxDelivery)).find((row) => row.recipient === `${memberId}@example.com`)?.status).toBe("skipped");
  });

  it("retains delivery ownership while one independent consumer is sending", async () => {
    await buyerDelivery();
    const firstDb = createTestDb();
    const secondDb = createTestDb();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    const mailer: Mailer = { async send() {
      calls += 1;
      if (calls === 1) { entered.resolve(); await release.promise; }
    } };
    const first = deliverDueOutboxDeliveries({ db: firstDb, email: emailServices(mailer) });
    try {
      await Promise.race([entered.promise, first.then(() => { throw new Error("First consumer finished before sending"); })]);
      expect(await deliverDueOutboxDeliveries({ db: secondDb, email: emailServices(mailer) })).toEqual({ sent: 0, failed: 0, skipped: 0 });
      expect(calls).toBe(1);
    } finally {
      release.resolve();
      await Promise.allSettled([first]);
      await Promise.all([firstDb.$client.end(), secondDb.$client.end()]);
    }
    expect(await db.select().from(outboxDelivery)).toEqual([expect.objectContaining({ status: "sent", attempts: 1 })]);
  });

  it("recovers an interrupted delivery lease and fences the previous owner's outcome", async () => {
    await buyerDelivery();
    const now = new Date();
    const [first] = await claimDueOutboxDeliveries(db, now, 1);
    if (!first) throw new Error("Missing first claim");
    expect(await claimDueOutboxDeliveries(db, new Date(now.getTime() + 30_000), 1)).toEqual([]);
    const later = new Date(now.getTime() + 6 * 60_000);
    const [recovered] = await claimDueOutboxDeliveries(db, later, 1);
    expect(recovered?.id).toBe(first.id);
    if (!recovered) throw new Error("Missing recovered claim");
    await applyDeliveryOutcome(db, { record: first, providerMessageId: "stale", at: later });
    expect(await db.select().from(outboxDelivery)).toEqual([expect.objectContaining({ status: "pending", attempts: 0, providerMessageId: null })]);
    await applyDeliveryOutcome(db, { record: recovered, providerMessageId: "receipt", at: later });
    expect(await db.select().from(outboxDelivery)).toEqual([expect.objectContaining({ status: "sent", attempts: 1, providerMessageId: "receipt" })]);
  });

  it("requires confirmation instead of resending an uncertain delivery beyond provider key retention", async () => {
    await buyerDelivery();
    const now = new Date();
    expect(await claimDueOutboxDeliveries(db, now, 1)).toHaveLength(1);
    const mailer = createFakeMailer();
    expect(await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), now: () => new Date(now.getTime() + 25 * 3_600_000) }))
      .toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(mailer.sent).toEqual([]);
    expect(await db.select().from(outboxDelivery)).toEqual([expect.objectContaining({ status: "failed", lastError: expect.stringMatching(/confirmation/i) })]);
  });

  it("retries an uncertain send with the same rendered message and provider key and stores the receipt", async () => {
    await buyerDelivery();
    const seen: Array<{ message: OutgoingEmail; key: string | undefined }> = [];
    const transport: Transport = { name: "fake", async send(message, options) {
      seen.push({ message: { ...message }, key: options?.idempotencyKey });
      if (seen.length === 1) throw new Error("Acknowledgement lost");
      return { providerMessageId: "accepted-receipt" };
    } };
    const config = { PLATFORM_NAME: "Platform", EMAIL_DOMAIN: "platform.test", EMAIL_REPLY_TO: "support@platform.test" };
    const mailer = mailerWithTransports(config, [transport]);
    const now = new Date();
    expect(await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), now: () => now })).toEqual({ sent: 0, failed: 1, skipped: 0 });
    const [record] = await db.select().from(outboxDelivery);
    if (!record) throw new Error("Missing retry delivery");
    await db.update(outbox).set({ data: { buyerEmail: "buyer@example.com", productTitle: "Changed title", teamName: "team", url: "https://team.example.com/orders/tok" } }).where(eq(outbox.id, record.outboxId));
    const recoveredMailer = mailerWithTransports({ PLATFORM_NAME: "Renamed", EMAIL_DOMAIN: "new.example.com", EMAIL_REPLY_TO: "new@example.com" }, [transport]);
    expect(await deliverDueOutboxDeliveries({ db, email: emailServices(recoveredMailer), now: () => new Date(now.getTime() + 5 * 60_000) })).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.key).toBe(`delivery/${record.id}`);
    expect(seen[1]).toEqual(seen[0]);
    expect(await db.select().from(outboxDelivery)).toEqual([expect.objectContaining({ status: "sent", attempts: 2, providerMessageId: "accepted-receipt" })]);
  });

  it("delivers a client notice for a project event, once, with the client page link", async () => {
    await quotedClient();

    const mailer = createFakeMailer();
    const result = await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    expect(result.failed).toBe(0);
    const clientMessages = mailer.sent.filter((message) => message.to === "client@example.com");
    expect(clientMessages).toHaveLength(1);
    expect(clientMessages[0]).toMatchObject({ to: "client@example.com", sender: "invoices", onBehalfOf: "team" });
    expect(clientMessages[0]?.subject).toBe("Your quote from team");
    expect(clientMessages[0]?.text).toContain('"Brand refresh"');
    expect(clientMessages[0]?.text).toContain("/c/");

    // Sent stays sent: a second sweep sends nothing new.
    expect(await deliverDueOutboxDeliveries({ db, email: emailServices(createFakeMailer()), secret: "test-secret" })).toMatchObject({ sent: 0 });
  });

  it("skips an opted-out member while still notifying the eligible workspace admin", async () => {
    const { teamId, organizationId, userId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await seedProject(db, { teamId, status: "awaiting_deposit", title: "Brand refresh" });
    await db.update(projectTable).set({ assignedFreelancerId: memberId }).where(eq(projectTable.id, projectId));
    await setMemberNoticeEnabled(db, { teamId, userId: memberId, enabled: false });

    const events = await runInTransaction(db, (_tx, uow) =>
      uow.appendEvents({ id: projectId, teamId }, [{ type: "quote.accepted", data: {} }]),
    );
    await fanOutOutboxEvents({ db }, events);

    const mailer = createFakeMailer();
    const result = await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(mailer.sent.map((message) => message.to)).toEqual([`${userId}@example.com`]);
    const row = (await db.select().from(outboxDelivery)).find((delivery) => delivery.recipient === `${memberId}@example.com`);
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

  it("keeps payout notices queued through a dispute without spending provider retries", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    await appendPayoutOutboxEvent(db, { teamId, teamName: "team", type: "payout.approved", memberUserId: userId, amountMinor: 2500, currency: "USD", payoutRequestId: "pr_1" });
    const [caseRow] = await db.insert(dispute).values({ teamId, paypalDisputeId: "case-1", reason: "Not received", status: "open", amountMinor: 2500, currency: "USD" }).returning();
    if (!caseRow) throw new Error("No dispute");
    const mailer = createFakeMailer();
    let at = new Date(Date.now() + 1000);
    await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), now: () => at });
    expect(mailer.sent).toEqual([]);
    expect(await db.select().from(outboxDelivery)).toEqual([expect.objectContaining({ status: "pending", attempts: 0, firstAttemptAt: null, claimToken: null, nextAttemptAt: new Date(at.getTime() + 600_000) })]);
    at = new Date(at.getTime() + 26 * 3_600_000);
    await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), now: () => at });
    expect(mailer.sent).toEqual([]);
    await db.update(dispute).set({ status: "resolved_seller" }).where(eq(dispute.id, caseRow.id));
    at = new Date(at.getTime() + 600_000);
    expect(await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), now: () => at })).toMatchObject({ sent: 1, failed: 0 });
  });

  it("rolls back fan-out and its cursor together, then catches up without duplicate sends", async () => {
    await quotedClient();
    await db.execute(sql`alter table outbox_delivery add constraint reject_client_notice check (channel <> 'email_client')`);
    const mailer = createFakeMailer();
    try {
      await expect(deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" })).rejects.toThrow();
      expect(await db.select().from(outboxDelivery)).toEqual([]);
      expect((await db.select().from(outbox)).every((event) => event.noticesProcessedAt === null)).toBe(true);
    } finally {
      await db.execute(sql`alter table outbox_delivery drop constraint reject_client_notice`);
    }
    await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    expect(mailer.sent.filter((message) => message.to === "client@example.com")).toHaveLength(1);
    const sent = mailer.sent.length;
    await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    expect(mailer.sent).toHaveLength(sent);
    expect((await db.select().from(outbox)).every((event) => event.noticesProcessedAt !== null)).toBe(true);
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
    const mailer = createFakeMailer();
    const result = await deliverDueOutboxDeliveries({ db, email: emailServices(mailer), secret: "test-secret" });
    expect(result).toMatchObject({ sent: 1 });
    expect(await db.select().from(outboxDelivery)).toEqual([expect.objectContaining({ channel: "email_member", recipient: `${userId}@example.com`, status: "sent" })]);
    expect(mailer.sent[0]?.subject).toContain("requested");
  });
});
