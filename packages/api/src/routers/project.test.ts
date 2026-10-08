import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import { paymentCapturedTransfer } from "@jendal-workspace/core";
import {
  createTestDb,
  hasTestDatabase,
  seedServicesTeamWithAdmin,
  seedServicesTeamMember,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { findProjectById, getProjectFacts, listProjectQuotes } from "@jendal-workspace/db/repositories/projects";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { payment } from "@jendal-workspace/db/schema/projects";
import { ledgerBalance } from "@jendal-workspace/db/schema/ledger";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink } from "../client-links";
import type { Context } from "../context";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

type SessionValue = NonNullable<Context["session"]>;

function makeSession(userId: string): SessionValue {
  const now = new Date();
  return {
    session: {
      id: "session-1",
      token: "token-1",
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Someone",
      email: `${userId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const ITEMS = [
  { description: "Design", amountMinor: 40_000, extraDays: 0 },
  { description: "Build", amountMinor: 60_000, extraDays: 0 },
];

async function clientToken(projectId: string): Promise<string> {
  return signClientLink(TEST_AUTH_CONFIG.BETTER_AUTH_SECRET, projectId);
}

describe.skipIf(!hasTestDatabase)("project router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function createProject(userId: string) {
    const caller = callerFor(userId);
    return caller.project.create({ teamSlug: "team", title: "Website redesign", clientEmail: "client@example.com" });
  }

  it("starts a project with a project.created outbox event and a signed client link", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId, clientPath } = await createProject(userId);

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({
      title: "Website redesign",
      status: "quoting",
      clientEmail: "client@example.com",
      currency: "USD",
      managementFeeBps: 1_000,
      teamCutBps: 1_500,
    });
    expect(clientPath).toBe(`/c/${await clientToken(projectId)}`);
    expect(await db.select().from(outbox)).toEqual([
      expect.objectContaining({ type: "project.created", projectId, sequence: 1 }),
    ]);
  });

  it("refuses freelancers and anonymous callers to start projects, and projects without a client", async () => {
    const { organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    await expect(
      callerFor(freelancer).project.create({ teamSlug: "team", title: "Nope", clientEmail: "c@example.com" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerFor(null).project.create({ teamSlug: "team", title: "Nope", clientEmail: "c@example.com" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const { userId } = await seedServicesTeamWithAdmin(db, { slug: "other" });
    await expect(callerFor(userId).project.create({ teamSlug: "other", title: "No client" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Add the client's email or Discord user.",
    });
  });

  it("quotes in assigned mode only through the assigned freelancer", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);

    await expect(
      callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 14 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Assign a freelancer first; in this team the assigned freelancer quotes." });

    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });

    await expect(
      callerFor(userId).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 14 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 14,
    });
    const quotes = await listProjectQuotes(db, projectId);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ id: quoteId, amountMinor: 100_000, deliveryDays: 14, freelancerId: freelancer, status: "proposed" });
    expect(quotes[0]?.items.map((i) => [i.description, i.amountMinor])).toEqual([
      ["Design", 40_000],
      ["Build", 60_000],
    ]);
  });

  it("lets the workspace owner be assigned and quote without a services team member row", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);

    const members = await callerFor(userId).project.members({ teamSlug: "team" });
    expect(members).toEqual([expect.objectContaining({ id: userId, role: "admin" })]);

    await expect(
      callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: "someone-else" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "That person is not a member of this team." });

    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: userId });
    const { quoteId } = await callerFor(userId).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 14 });
    expect((await listProjectQuotes(db, projectId))[0]).toMatchObject({ id: quoteId, freelancerId: userId });
  });

  it("lets any freelancer quote in open mode, and staff quote for a named freelancer in team mode", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);
    const { quoteId } = await callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 7 });
    expect(quoteId).toBeTruthy();

    await db.update(servicesTeamSettings).set({ quotingMode: "team" }).where(eq(servicesTeamSettings.teamId, teamId));
    const { projectId: second } = await createProject(userId);
    await expect(
      callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId: second, items: ITEMS, deliveryDays: 7 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { quoteId: staffQuote } = await callerFor(userId).project.addQuote({
      teamSlug: "team",
      projectId: second,
      items: ITEMS,
      deliveryDays: 7,
      freelancerId: freelancer,
    });
    const quotes = await listProjectQuotes(db, second);
    expect(quotes.find((q) => q.id === staffQuote)).toMatchObject({ freelancerId: freelancer, authorId: userId });
  });

  it("lists and shows projects only to members who may see them", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);
    const outsider = await seedServicesTeamWithAdmin(db, { slug: "other" });

    await expect(callerFor(outsider.userId).project.list({ teamSlug: "team" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerFor(outsider.userId).project.get({ teamSlug: "team", projectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const list = await callerFor(userId).project.list({ teamSlug: "team" });
    expect(list).toEqual([expect.objectContaining({ id: projectId, title: "Website redesign", status: "quoting" })]);
    const detail = await callerFor(userId).project.get({ teamSlug: "team", projectId });
    expect(detail.project.id).toBe(projectId);
    expect(detail.clientPath).toBe(`/c/${await clientToken(projectId)}`);
    expect(detail.quotes).toEqual([]);
  });

  it("accepts a quote through the client link and creates the $600 deposit payment (§5.3)", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 14,
    });

    const token = await clientToken(projectId);
    const result = await callerFor(null).project.clientAcceptQuote({ token, quoteId });
    expect(result).toEqual({ paymentId: expect.any(String), amountMinor: 60_000 });

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ status: "awaiting_deposit" });
    const payments = await db.select().from(payment);
    expect(payments).toEqual([
      expect.objectContaining({
        id: result.paymentId,
        kind: "deposit",
        status: "pending",
        quotePartMinor: 50_000,
        managementFeeMinor: 10_000,
        amountMinor: 60_000,
        lines: [
          { kind: "deposit", label: "Deposit (50% of the quote)", amountMinor: 50_000 },
          { kind: "management_fee", label: "Management fee (10%)", amountMinor: 10_000 },
        ],
      }),
    ]);
    const quotes = await listProjectQuotes(db, projectId);
    expect(quotes.find((q) => q.id === quoteId)).toMatchObject({ status: "accepted", acceptedAt: expect.any(Date) });
    expect((await db.select().from(outbox)).map((e) => e.type)).toEqual([
      "project.created",
      "project.assigned",
      "quote.created",
      "quote.accepted",
      "payment.created",
    ]);
  });

  it("gives a pay link for deposits and top-ups but not yet for the balance", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 14 });
    const token = await clientToken(projectId);
    const { paymentId } = await callerFor(null).project.clientAcceptQuote({ token, quoteId });
    await db.insert(payment).values({
      projectId,
      teamId,
      kind: "balance",
      currency: "USD",
      quotePartMinor: 50_000,
      managementFeeMinor: 0,
      amountMinor: 50_000,
      lines: [{ kind: "balance", label: "Balance", amountMinor: 50_000 }],
    });

    const view = await callerFor(null).project.clientGet({ token });
    expect(view.payments.find((p) => p.id === paymentId)?.payPath).toMatch(/^\/pay\//);
    expect(view.payments.find((p) => p.kind === "balance")?.payPath).toBeNull();
  });

  it("rejects a forged or missing client token", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);
    await expect(callerFor(null).project.clientGet({ token: `${projectId}.forged` })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(callerFor(null).project.clientAcceptQuote({ token: "nope", quoteId: crypto.randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("assigns the freelancer the quote names when the client accepts (open and team modes)", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });

    // Open mode: the quoting freelancer.
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const { projectId } = await createProject(userId);
    const { quoteId } = await callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 7 });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(projectId), quoteId });
    expect((await findProjectById(db, projectId))?.assignedFreelancerId).toBe(freelancer);

    // Team mode: the freelancer the staff member named.
    await db.update(servicesTeamSettings).set({ quotingMode: "team" }).where(eq(servicesTeamSettings.teamId, teamId));
    const { projectId: second } = await createProject(userId);
    const { quoteId: staffQuote } = await callerFor(userId).project.addQuote({
      teamSlug: "team",
      projectId: second,
      items: ITEMS,
      deliveryDays: 7,
      freelancerId: freelancer,
    });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(second), quoteId: staffQuote });
    expect((await findProjectById(db, second))?.assignedFreelancerId).toBe(freelancer);
  });
  it("rolls everything back when the client accepts a quote on a project that changed underneath", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 7,
    });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(projectId), quoteId });

    // Accepting again is refused by the state machine and changes nothing.
    await expect(
      callerFor(null).project.clientAcceptQuote({ token: await clientToken(projectId), quoteId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const payments = await db.select().from(payment).where(eq(payment.projectId, projectId));
    expect(payments).toHaveLength(1);
    const quotes = await listProjectQuotes(db, projectId);
    expect(quotes.filter((q) => q.status === "accepted")).toHaveLength(1);
  });

  async function projectInProgress(userId: string, organizationId: string, teamId: string, items = ITEMS) {
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items,
      deliveryDays: 14,
    });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(projectId), quoteId });
    // The deposit capture is S6's; here the payment_captured posting moves the project along.
    const [deposit] = await db.select().from(payment).where(eq(payment.projectId, projectId));
    await runInTransaction(db, async (tx, uow) => {
      const row = await findProjectById(tx, projectId);
      if (!row || !deposit) throw new Error("missing rows");
      await tx.update(payment).set({ status: "captured", capturedAt: new Date() }).where(eq(payment.id, deposit.id));
      await uow.apply({
        project: row,
        set: { status: "in_progress" },
        transfers: [
          paymentCapturedTransfer({
            currency: "USD",
            projectId,
            paymentId: deposit.id,
            quotePartMinor: deposit.quotePartMinor,
            managementFeeMinor: deposit.managementFeeMinor,
          }),
        ],
        events: [{ type: "payment.captured", data: { paymentId: deposit.id } }],
      });
    });
    return { projectId, freelancer };
  }

  it("runs an increase amendment: top-up payment, new quote version (§5.5 +$400)", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await projectInProgress(userId, organizationId, teamId);

    const { amendmentId } = await callerFor(userId).project.proposeAmendment({
      teamSlug: "team",
      projectId,
      add: [{ description: "Blog", amountMinor: 40_000, extraDays: 3 }],
      removeItemIds: [],
    });

    const token = await clientToken(projectId);
    const result = await callerFor(null).project.clientAcceptAmendment({ token, amendmentId });
    expect(result).toEqual({ quoteVersion: 2, topUpPaymentId: expect.any(String) });

    const quotes = await listProjectQuotes(db, projectId);
    expect(quotes.map((q) => [q.version, q.status, q.amountMinor])).toEqual([
      [1, "superseded", 100_000],
      [2, "accepted", 140_000],
    ]);
    expect(quotes[1]?.items.map((i) => i.description)).toEqual(["Design", "Build", "Blog"]);
    const payments = await db.select().from(payment).where(eq(payment.projectId, projectId));
    const topUp = payments.find((p) => p.kind === "top_up");
    expect(topUp).toMatchObject({
      amendmentId,
      quotePartMinor: 20_000,
      managementFeeMinor: 4_000,
      amountMinor: 24_000,
      status: "pending",
    });
    const facts = await getProjectFacts(db, projectId);
    expect(facts.unpaidTopUp).toBe(true);
    expect((await db.select().from(outbox)).map((e) => e.type)).toContain("amendment.accepted");
  });

  it("runs the §5.5 decrease amendment: −$300 on the $1,000 quote credits the $30 fee", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    // §5.5's example: a $1,000 quote (Design $300 + Build $700) loses the $300 item.
    const { projectId } = await projectInProgress(userId, organizationId, teamId, [
      { description: "Design", amountMinor: 30_000, extraDays: 0 },
      { description: "Build", amountMinor: 70_000, extraDays: 0 },
    ]);
    const quotes = await listProjectQuotes(db, projectId);
    const designItem = quotes[0]?.items.find((i) => i.description === "Design");
    if (!designItem) throw new Error("missing item");

    const { amendmentId } = await callerFor(userId).project.proposeAmendment({
      teamSlug: "team",
      projectId,
      add: [],
      removeItemIds: [designItem.id],
    });
    const result = await callerFor(null).project.clientAcceptAmendment({ token: await clientToken(projectId), amendmentId });
    expect(result).toEqual({ quoteVersion: 2, topUpPaymentId: null });

    const versions = await listProjectQuotes(db, projectId);
    expect(versions.map((q) => [q.version, q.status, q.amountMinor])).toEqual([
      [1, "superseded", 100_000],
      [2, "accepted", 70_000],
    ]);
    const balances = await db.select().from(ledgerBalance);
    // The $30 overpaid management fee moved from team_revenue back to client_held (§5.5).
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: "team_revenue", balanceMinor: 7_000 }),
        expect.objectContaining({ account: `client_held:${projectId}`, balanceMinor: 53_000 }),
      ]),
    );
    const facts = await getProjectFacts(db, projectId);
    expect(facts.managementFeeCreditedMinor).toBe(3_000);
    const payments = await db.select().from(payment).where(eq(payment.projectId, projectId));
    expect(payments.filter((p) => p.kind === "top_up")).toHaveLength(0);
  });

  it("blocks a second pending amendment and declines the first", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await projectInProgress(userId, organizationId, teamId);
    const input = {
      teamSlug: "team",
      projectId,
      add: [{ description: "Extra", amountMinor: 5_000, extraDays: 0 }],
      removeItemIds: [],
    };
    await callerFor(userId).project.proposeAmendment(input);
    await expect(callerFor(userId).project.proposeAmendment(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "An amendment is waiting for the client's answer.",
    });

    const token = await clientToken(projectId);
    const page = await callerFor(null).project.clientGet({ token });
    const pending = page.amendments.find((a) => a.status === "pending");
    if (!pending) throw new Error("no pending amendment");
    await callerFor(null).project.clientDeclineAmendment({ token, amendmentId: pending.id });
    // After the decline another amendment can be proposed.
    await callerFor(userId).project.proposeAmendment(input);
  });
});
