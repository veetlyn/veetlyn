import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import { paymentCapturedTransfer, createFakeFileStore, type FileStore } from "@jendal-workspace/core";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedServicesTeamWithAdmin,
  seedServicesOffering,
  seedServicesTeamMember,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { findFileUpload, insertFileUpload } from "@jendal-workspace/db/repositories/files";
import {
  findProjectById,
  getProjectFacts,
  listProjectDeliveries,
  listProjectQuotes,
} from "@jendal-workspace/db/repositories/projects";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { payment, project } from "@jendal-workspace/db/schema/projects";
import { ledgerBalance } from "@jendal-workspace/db/schema/ledger";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink } from "../client-links";
import type { Context } from "../context";
import { createTestCatalogServices } from "../testing/catalog";
import { applyCaptureFact } from "../use-cases/payments";
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
  const callerFor = (userId: string | null, files: FileStore = createFakeFileStore()) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files,
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

  it("stores the team's own active offering and the admin source", async () => {
    const { userId, teamId } = await seedServicesTeamWithAdmin(db);
    const offeringId = await seedServicesOffering(db, { teamId, name: "Logo design" });

    const caller = callerFor(userId);
    const { projectId } = await caller.project.create({
      teamSlug: "team",
      title: "Website redesign",
      clientEmail: "client@example.com",
      offeringId,
    });

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ offeringId, source: "admin" });
  });

  it("refuses another team's offering and the team's own inactive offering", async () => {
    const { userId, teamId } = await seedServicesTeamWithAdmin(db);
    const { teamId: otherTeamId } = await seedServicesTeamWithAdmin(db, { slug: "other" });
    const foreignOfferingId = await seedServicesOffering(db, { teamId: otherTeamId, name: "Their service" });
    const inactiveOfferingId = await seedServicesOffering(db, { teamId, name: "Paused service", active: false });

    const caller = callerFor(userId);
    for (const offeringId of [foreignOfferingId, inactiveOfferingId]) {
      await expect(
        caller.project.create({
          teamSlug: "team",
          title: "Website redesign",
          clientEmail: "client@example.com",
          offeringId,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "That service is not on your team's list." });
    }
    expect(await db.select({ id: project.id }).from(project)).toEqual([]);
  });

  it("starts a project without an offering, recording a null offering and the admin source", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ offeringId: null, source: "admin" });
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

  it("tells the project page whether the seller is solo", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "solo", solo: true });
    await seedServicesTeam(db, { organizationId, slug: "studio" });
    const caller = callerFor(userId);

    const solo = await caller.project.create({ teamSlug: "solo", title: "Solo site", clientEmail: "c@example.com" });
    const studio = await caller.project.create({ teamSlug: "studio", title: "Team site", clientEmail: "c@example.com" });

    await expect(caller.project.get({ teamSlug: "solo", projectId: solo.projectId })).resolves.toMatchObject({
      solo: true,
    });
    await expect(caller.project.get({ teamSlug: "studio", projectId: studio.projectId })).resolves.toMatchObject({
      solo: false,
    });
  });

  it("lets a solo seller quote as themselves with no assignment, while a team seller still needs one", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "solo", solo: true });
    const soloCaller = callerFor(userId);

    const { projectId } = await soloCaller.project.create({
      teamSlug: "solo",
      title: "Solo site",
      clientEmail: "client@example.com",
    });
    const { quoteId } = await soloCaller.project.addQuote({ teamSlug: "solo", projectId, items: ITEMS, deliveryDays: 14 });

    const quote = (await listProjectQuotes(db, projectId))[0];
    expect(quote).toMatchObject({ id: quoteId, freelancerId: userId, authorId: userId, status: "proposed" });
    // Solo quotes do not assign the freelancer; accepting the quote does (§5.2 step 3).
    expect((await findProjectById(db, projectId))?.assignedFreelancerId).toBeNull();

    const team = await seedServicesTeamWithAdmin(db);
    const teamCaller = callerFor(team.userId);
    const teamProject = await teamCaller.project.create({
      teamSlug: "team",
      title: "Team site",
      clientEmail: "client@example.com",
    });
    await expect(
      teamCaller.project.addQuote({ teamSlug: "team", projectId: teamProject.projectId, items: ITEMS, deliveryDays: 14 }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Assign a freelancer first; in this team the assigned freelancer quotes.",
    });
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

  it("gives a pay link for deposits, top-ups and the balance", async () => {
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
    expect(view.payments.find((p) => p.kind === "balance")?.payPath).toMatch(/^\/pay\//);
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

  describe("deliveries", () => {
    // A $1,000 quote with its $600 deposit ($500 + the 10% management fee) captured through the capture path.
    async function workingProject() {
      const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
      const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
      const { projectId } = await createProject(userId);
      await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
      const { quoteId } = await callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 14 });
      const token = await clientToken(projectId);
      const { paymentId } = await callerFor(null).project.clientAcceptQuote({ token, quoteId });
      await db.update(payment).set({ paypalOrderId: "ORDER1" }).where(eq(payment.id, paymentId));
      const result = await applyCaptureFact(db, {
        paymentId,
        orderId: "ORDER1",
        captureId: "CAPTURE1",
        status: "COMPLETED",
        amountMinor: 60_000,
        currency: "USD",
        capturedAt: null,
        paypalFeeMinor: null,
        platformFeeMinor: null,
      });
      if (result !== "applied") throw new Error(`deposit capture was ${result}`);
      return { userId, organizationId, freelancer, projectId, token, teamId };
    }

    async function deliver(userId: string, projectId: string) {
      return callerFor(userId).project.deliver({ teamSlug: "team", projectId, note: "Here it is", link: "https://example.com/files" });
    }

    async function outboxTypes(projectId: string) {
      const rows = await db.select().from(outbox).where(eq(outbox.projectId, projectId));
      return rows.sort((a, b) => a.sequence - b.sequence).map((e) => e.type);
    }

    async function balanceOf(account: string) {
      const [row] = await db.select().from(ledgerBalance).where(eq(ledgerBalance.account, account));
      return row?.balanceMinor ?? 0;
    }

    it("delivers and asks the client", async () => {
      const { freelancer, projectId, token } = await workingProject();
      const { deliveryId } = await deliver(freelancer, projectId);

      expect((await findProjectById(db, projectId))?.status).toBe("delivered");
      const page = await callerFor(null).project.clientGet({ token });
      expect(page.deliveries).toEqual([
        {
          id: deliveryId,
          status: "submitted",
          note: "Here it is",
          link: "https://example.com/files",
          clientNote: "",
          createdAt: expect.any(Date),
          decidedAt: null,
          file: null,
        },
      ]);
      expect(await outboxTypes(projectId)).toContain("delivery.submitted");

      await expect(deliver(freelancer, projectId)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This action is not available at this stage of the project.",
      });
    });

    it("lets only the assigned freelancer or a manager deliver, with a note or an https link", async () => {
      const { organizationId, teamId, freelancer, projectId } = await workingProject();
      const other = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
      await expect(deliver(other, projectId)).rejects.toMatchObject({ code: "FORBIDDEN" });

      await expect(
        callerFor(freelancer).project.deliver({ teamSlug: "team", projectId, note: "  ", link: "" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Add a note, a link or a file." });
      await expect(
        callerFor(freelancer).project.deliver({ teamSlug: "team", projectId, note: "a".repeat(5_001), link: "" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "The note is too long." });
      for (const link of ["http://x", "javascript:alert(1)", "not a url", `https://example.com/${"a".repeat(2_000)}`]) {
        await expect(
          callerFor(freelancer).project.deliver({ teamSlug: "team", projectId, note: "", link }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Use an https link." });
      }

      const manager = await seedServicesTeamMember(db, { organizationId, teamId, role: "manager" });
      const { deliveryId } = await callerFor(manager).project.deliver({ teamSlug: "team", projectId, note: "From the manager" });
      expect(await listProjectDeliveries(db, projectId)).toEqual([
        expect.objectContaining({ id: deliveryId, submittedById: manager, note: "From the manager", link: null }),
      ]);
    });

    it("sends the work back when the client requests changes, counting a revision", async () => {
      const { freelancer, projectId, token } = await workingProject();
      const { deliveryId } = await deliver(freelancer, projectId);

      await expect(
        callerFor(null).project.clientRequestChanges({ token, deliveryId, note: "   " }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Say what should change." });

      await callerFor(null).project.clientRequestChanges({ token, deliveryId, note: "Make the logo bigger" });
      expect(await findProjectById(db, projectId)).toMatchObject({ status: "in_progress", revisions: 1 });
      expect(await listProjectDeliveries(db, projectId)).toEqual([
        expect.objectContaining({
          id: deliveryId,
          status: "changes_requested",
          clientNote: "Make the logo bigger",
          decidedAt: expect.any(Date),
        }),
      ]);
      expect(await outboxTypes(projectId)).toContain("delivery.changes_requested");

      const second = await deliver(freelancer, projectId);
      expect(second.deliveryId).not.toBe(deliveryId);
      expect((await findProjectById(db, projectId))?.status).toBe("delivered");
    });

    it("accepts the delivery and opens the $500 balance payment (§5.3)", async () => {
      const { freelancer, projectId, token } = await workingProject();
      const { deliveryId } = await deliver(freelancer, projectId);

      const result = await callerFor(null).project.clientAcceptDelivery({ token, deliveryId });
      expect(result).toEqual({ status: "awaiting_balance", balancePaymentId: expect.any(String) });
      expect(await findProjectById(db, projectId)).toMatchObject({ status: "awaiting_balance", finalPriceMinor: 100_000 });

      const payments = await db.select().from(payment).where(eq(payment.projectId, projectId));
      // The management fee was paid in full with the deposit.
      expect(payments.find((p) => p.kind === "balance")).toMatchObject({
        id: result.balancePaymentId,
        status: "pending",
        quotePartMinor: 50_000,
        managementFeeMinor: 0,
        amountMinor: 50_000,
        lines: [{ kind: "balance", label: "Balance", amountMinor: 50_000 }],
      });
      expect(await listProjectDeliveries(db, projectId)).toEqual([
        expect.objectContaining({ id: deliveryId, status: "accepted", decidedAt: expect.any(Date) }),
      ]);
      const types = await outboxTypes(projectId);
      expect(types.slice(-2)).toEqual(["delivery.accepted", "payment.created"]);

      const page = await callerFor(null).project.clientGet({ token });
      expect(page.project.finalPriceMinor).toBe(100_000);
      expect(page.payments.find((p) => p.id === result.balancePaymentId)?.payPath).toMatch(/^\/pay\//);
    });

    it("completes the project when nothing is left to pay, splitting the final price in the ledger", async () => {
      const { freelancer, projectId, token, teamId } = await workingProject();
      // The rest of the quote is already paid (a captured top-up for the remaining $500, no fee).
      await db.transaction(async (tx) => {
        const [topUp] = await tx
          .insert(payment)
          .values({
            projectId,
            teamId,
            kind: "top_up",
            status: "captured",
            currency: "USD",
            quotePartMinor: 50_000,
            managementFeeMinor: 0,
            amountMinor: 50_000,
            lines: [{ kind: "top_up", label: "Top-up", amountMinor: 50_000 }],
            capturedAt: new Date(),
          })
          .returning();
        if (!topUp) throw new Error("missing top-up");
        await createPostgresLedger(teamId, tx).post([
          paymentCapturedTransfer({ currency: "USD", projectId, paymentId: topUp.id, quotePartMinor: 50_000, managementFeeMinor: 0 }),
        ]);
      });
      const { deliveryId } = await deliver(freelancer, projectId);

      const result = await callerFor(null).project.clientAcceptDelivery({ token, deliveryId });
      expect(result).toEqual({ status: "completed", balancePaymentId: null });
      expect(await findProjectById(db, projectId)).toMatchObject({ status: "completed", finalPriceMinor: 100_000 });
      expect((await db.select().from(payment).where(eq(payment.projectId, projectId))).map((p) => p.kind).sort()).toEqual([
        "deposit",
        "top_up",
      ]);
      expect(await balanceOf(`client_held:${projectId}`)).toBe(0);
      // The $100 management fee plus the 15% team cut of the $1,000 final price.
      expect(await balanceOf("team_revenue")).toBe(25_000);
      expect(await balanceOf(`owed:${freelancer}:available`)).toBe(85_000);
      expect((await outboxTypes(projectId)).slice(-2)).toEqual(["delivery.accepted", "project.completed"]);
    });

    it("completes and refunds the client when a decrease left them overpaid", async () => {
      const { userId, freelancer, projectId, token } = await workingProject();
      const [current] = await listProjectQuotes(db, projectId);
      const build = current?.items.find((i) => i.description === "Build");
      if (!build) throw new Error("missing item");
      const { deliveryId } = await deliver(freelancer, projectId);
      const { amendmentId } = await callerFor(userId).project.proposeAmendment({
        teamSlug: "team",
        projectId,
        add: [],
        removeItemIds: [build.id],
      });
      await callerFor(null).project.clientAcceptAmendment({ token, amendmentId });
      expect(await balanceOf(`client_held:${projectId}`)).toBe(56_000);
      expect(await balanceOf("team_revenue")).toBe(4_000);

      const result = await callerFor(null).project.clientAcceptDelivery({ token, deliveryId });
      expect(result).toEqual({ status: "completed", balancePaymentId: null });
      expect(await findProjectById(db, projectId)).toMatchObject({ status: "completed", finalPriceMinor: 40_000 });
      expect(await balanceOf(`client_held:${projectId}`)).toBe(0);
      expect(await balanceOf("client_refunds")).toBe(16_000);
      expect(await balanceOf("team_revenue")).toBe(10_000);
      expect(await balanceOf(`owed:${freelancer}:available`)).toBe(34_000);
      expect((await outboxTypes(projectId)).slice(-3)).toEqual(["delivery.accepted", "project.completed", "refund.requested"]);
      const [event] = await db.select().from(outbox).where(eq(outbox.type, "refund.requested"));
      expect(event?.data).toEqual({ amountMinor: 16_000, refundId: `completion-${projectId}` });
    });

    it("refuses to accept the delivery while a failed top-up is still unpaid", async () => {
      const { userId, freelancer, projectId, token } = await workingProject();
      const { deliveryId } = await deliver(freelancer, projectId);
      const { amendmentId } = await callerFor(userId).project.proposeAmendment({
        teamSlug: "team",
        projectId,
        add: [{ description: "Blog", amountMinor: 40_000, extraDays: 3 }],
        removeItemIds: [],
      });
      const { topUpPaymentId } = await callerFor(null).project.clientAcceptAmendment({ token, amendmentId });
      if (!topUpPaymentId) throw new Error("missing top-up");
      // A failed payment can still be paid, so it blocks acceptance like a pending one.
      await db.update(payment).set({ status: "failed" }).where(eq(payment.id, topUpPaymentId));

      await expect(callerFor(null).project.clientAcceptDelivery({ token, deliveryId })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "The top-up for the last amendment is not paid yet.",
      });
      expect((await findProjectById(db, projectId))?.status).toBe("delivered");
    });

    it("refuses to accept the delivery while an amendment waits for the client", async () => {
      const { userId, freelancer, projectId, token } = await workingProject();
      const { deliveryId } = await deliver(freelancer, projectId);
      await callerFor(userId).project.proposeAmendment({
        teamSlug: "team",
        projectId,
        add: [{ description: "Extra", amountMinor: 5_000, extraDays: 0 }],
        removeItemIds: [],
      });

      await expect(callerFor(null).project.clientAcceptDelivery({ token, deliveryId })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "An amendment is waiting for the client's answer.",
      });
      expect((await findProjectById(db, projectId))?.status).toBe("delivered");
      expect(await listProjectDeliveries(db, projectId)).toEqual([expect.objectContaining({ status: "submitted" })]);
    });

    it("answers only the open delivery of the token's project", async () => {
      const first = await workingProject();
      const { deliveryId } = await deliver(first.freelancer, first.projectId);
      // A second project of the same team, with an accepted quote.
      const { projectId: otherId } = await createProject(first.userId);
      await callerFor(first.userId).project.assign({ teamSlug: "team", projectId: otherId, freelancerId: first.freelancer });
      const { quoteId } = await callerFor(first.freelancer).project.addQuote({
        teamSlug: "team",
        projectId: otherId,
        items: ITEMS,
        deliveryDays: 14,
      });
      const otherToken = await clientToken(otherId);
      await callerFor(null).project.clientAcceptQuote({ token: otherToken, quoteId });

      const notWaiting = { code: "BAD_REQUEST", message: "This delivery is not waiting for an answer." };
      await expect(
        callerFor(null).project.clientAcceptDelivery({ token: otherToken, deliveryId }),
      ).rejects.toMatchObject(notWaiting);
      await expect(
        callerFor(null).project.clientRequestChanges({ token: otherToken, deliveryId, note: "No" }),
      ).rejects.toMatchObject(notWaiting);
      await expect(
        callerFor(null).project.clientAcceptDelivery({ token: first.token, deliveryId: crypto.randomUUID() }),
      ).rejects.toMatchObject(notWaiting);

      await callerFor(null).project.clientRequestChanges({ token: first.token, deliveryId, note: "Again" });
      await expect(
        callerFor(null).project.clientAcceptDelivery({ token: first.token, deliveryId }),
      ).rejects.toMatchObject(notWaiting);
      await expect(
        callerFor(null).project.clientAcceptDelivery({ token: "nope", deliveryId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("shows deliveries to staff with who submitted them, and to the client without", async () => {
      const { userId, freelancer, projectId, token } = await workingProject();
      const { deliveryId } = await deliver(freelancer, projectId);

      const detail = await callerFor(userId).project.get({ teamSlug: "team", projectId });
      expect(detail.deliveries).toEqual([expect.objectContaining({ id: deliveryId, submittedById: freelancer })]);
      const page = await callerFor(null).project.clientGet({ token });
      expect(page.deliveries[0]).not.toHaveProperty("submittedById");
      expect(page.deliveries[0]).not.toHaveProperty("teamId");
    });

    describe("files", () => {
      const PDF = { fileName: "Logo final.pdf", sizeBytes: 2_000_000 };

      async function startUpload(userId: string, projectId: string, files: FileStore, file = PDF) {
        return callerFor(userId, files).project.deliveryUploadStart({ teamSlug: "team", projectId, ...file });
      }

      // An upload the browser finished: the object is in the fake store with the announced size.
      async function uploadedFile(userId: string, projectId: string, files: ReturnType<typeof createFakeFileStore>) {
        const { uploadId } = await startUpload(userId, projectId, files);
        const row = await findFileUpload(db, uploadId);
        if (!row) throw new Error("missing upload");
        files.put(row.r2Key, row.sizeBytes);
        return row;
      }

      it("starts an upload for the assigned freelancer with a presigned PUT", async () => {
        const { freelancer, projectId, teamId } = await workingProject();
        const files = createFakeFileStore();

        const result = await startUpload(freelancer, projectId, files);

        expect(result).toEqual({
          uploadId: expect.any(String),
          url: expect.any(String),
          headers: { "content-type": "application/pdf" },
        });
        const key = `deliveries/${teamId}/${projectId}/${result.uploadId}`;
        expect(await findFileUpload(db, result.uploadId)).toMatchObject({
          teamId,
          projectId,
          purpose: "delivery",
          r2Key: key,
          fileName: "Logo final.pdf",
          contentType: "application/pdf",
          sizeBytes: 2_000_000,
          createdById: freelancer,
          attachedAt: null,
        });
        expect(files.puts).toEqual([
          { key, contentType: "application/pdf", sizeBytes: 2_000_000, expiresInSeconds: 900 },
        ]);
      });

      it("refuses uploads with a bad file, from other freelancers, or outside work", async () => {
        const { organizationId, teamId, freelancer, projectId } = await workingProject();
        const files = createFakeFileStore();

        for (const [file, message] of [
          [{ fileName: "run.exe", sizeBytes: 10 }, "This file type is not allowed."],
          [{ fileName: "brand.zip", sizeBytes: 0 }, "The file is empty."],
          [{ fileName: "brand.zip", sizeBytes: 100 * 1024 * 1024 + 1 }, "Files can be up to 100 MB."],
        ] as const) {
          await expect(startUpload(freelancer, projectId, files, file)).rejects.toMatchObject({ code: "BAD_REQUEST", message });
        }
        const other = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
        await expect(startUpload(other, projectId, files)).rejects.toMatchObject({ code: "FORBIDDEN" });

        await deliver(freelancer, projectId);
        await expect(startUpload(freelancer, projectId, files)).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "Files can be added while the project is in progress.",
        });
        expect(files.puts).toEqual([]);
      });

      it("limits each person to 20 upload starts in 10 minutes", async () => {
        const { freelancer, projectId } = await workingProject();
        const files = createFakeFileStore();
        for (let i = 0; i < 20; i += 1) await startUpload(freelancer, projectId, files);

        await expect(startUpload(freelancer, projectId, files)).rejects.toMatchObject({
          code: "TOO_MANY_REQUESTS",
          message: "Too many uploads. Wait a few minutes and try again.",
        });
        expect(files.puts).toHaveLength(20);
      });

      it("delivers with an uploaded file and shows it to staff and the client", async () => {
        const { userId, freelancer, projectId, token } = await workingProject();
        const files = createFakeFileStore();
        const { deliveryId: plainId } = await deliver(freelancer, projectId);
        await callerFor(null).project.clientRequestChanges({ token, deliveryId: plainId, note: "Add the logo file" });
        const upload = await uploadedFile(freelancer, projectId, files);

        const { deliveryId } = await callerFor(freelancer, files).project.deliver({
          teamSlug: "team",
          projectId,
          note: "",
          link: "",
          fileUploadId: upload.id,
        });

        expect(await listProjectDeliveries(db, projectId)).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: deliveryId, fileUploadId: upload.id })]),
        );
        expect((await findFileUpload(db, upload.id))?.attachedAt).toEqual(expect.any(Date));

        const file = { name: "Logo final.pdf", sizeBytes: 2_000_000 };
        const page = await callerFor(null).project.clientGet({ token });
        const clientDelivery = page.deliveries.find((d) => d.id === deliveryId);
        expect(clientDelivery?.file).toEqual(file);
        expect(page.deliveries.find((d) => d.id === plainId)?.file).toBeNull();
        expect(Object.keys(clientDelivery ?? {}).sort()).toEqual(
          ["id", "status", "note", "link", "clientNote", "createdAt", "decidedAt", "file"].sort(),
        );

        const detail = await callerFor(userId).project.get({ teamSlug: "team", projectId });
        expect(detail.deliveries.find((d) => d.id === deliveryId)?.file).toEqual(file);
        expect(detail.deliveries.find((d) => d.id === plainId)?.file).toBeNull();
        expect(JSON.stringify(detail)).not.toContain(upload.r2Key);
        expect(JSON.stringify(page)).not.toContain(upload.r2Key);
      });

      it("refuses a file that did not finish uploading or does not belong to the delivery", async () => {
        const { userId, freelancer, projectId, token } = await workingProject();
        const files = createFakeFileStore();
        const deliverFile = (fileUploadId: string) =>
          callerFor(freelancer, files).project.deliver({ teamSlug: "team", projectId, note: "", link: "", fileUploadId });
        const notFinished = { code: "BAD_REQUEST", message: "The file did not finish uploading." };
        const cannotUse = { code: "BAD_REQUEST", message: "This file cannot be used for this delivery." };

        const { uploadId: missing } = await startUpload(freelancer, projectId, files);
        await expect(deliverFile(missing)).rejects.toMatchObject(notFinished);
        const wrongSize = await uploadedFile(freelancer, projectId, files);
        files.put(wrongSize.r2Key, 1_999_999);
        await expect(deliverFile(wrongSize.id)).rejects.toMatchObject(notFinished);

        // An upload of another project in the same team.
        const { projectId: otherProjectId } = await createProject(userId);
        const otherProject = await insertFileUpload(db, {
          teamId: wrongSize.teamId,
          projectId: otherProjectId,
          purpose: "delivery",
          r2Key: `deliveries/${wrongSize.teamId}/${otherProjectId}/x`,
          fileName: "a.pdf",
          contentType: "application/pdf",
          sizeBytes: 10,
        });
        files.put(otherProject.r2Key, 10);
        await expect(deliverFile(otherProject.id)).rejects.toMatchObject(cannotUse);

        // An upload of another team.
        const outsider = await seedServicesTeamWithAdmin(db, { slug: "other" });
        const otherTeam = await insertFileUpload(db, {
          teamId: outsider.teamId,
          projectId: null,
          purpose: "delivery",
          r2Key: `deliveries/${outsider.teamId}/none/y`,
          fileName: "b.pdf",
          contentType: "application/pdf",
          sizeBytes: 10,
        });
        files.put(otherTeam.r2Key, 10);
        await expect(deliverFile(otherTeam.id)).rejects.toMatchObject(cannotUse);
        await expect(deliverFile(crypto.randomUUID())).rejects.toMatchObject(cannotUse);

        // An upload already attached to an earlier delivery.
        const used = await uploadedFile(freelancer, projectId, files);
        const { deliveryId } = await deliverFile(used.id);
        await callerFor(null).project.clientRequestChanges({ token, deliveryId, note: "Again" });
        await expect(deliverFile(used.id)).rejects.toMatchObject(cannotUse);

        expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
      });

      it("gives the client and staff a short download link for a delivery file", async () => {
        const first = await workingProject();
        const files = createFakeFileStore();
        const upload = await uploadedFile(first.freelancer, first.projectId, files);
        const { deliveryId } = await callerFor(first.freelancer, files).project.deliver({
          teamSlug: "team",
          projectId: first.projectId,
          note: "",
          link: "",
          fileUploadId: upload.id,
        });

        const { url } = await callerFor(null, files).project.clientDeliveryFileUrl({ token: first.token, deliveryId });
        expect(url).toBe(`https://files.test/${upload.r2Key}?op=get`);
        expect(files.gets).toEqual([{ key: upload.r2Key, fileName: "Logo final.pdf", expiresInSeconds: 300 }]);

        const staff = await callerFor(first.freelancer, files).project.deliveryFileUrl({
          teamSlug: "team",
          projectId: first.projectId,
          deliveryId,
        });
        expect(staff).toEqual({ url: `https://files.test/${upload.r2Key}?op=get` });
        const manager = await seedServicesTeamMember(db, {
          organizationId: first.organizationId,
          teamId: first.teamId,
          role: "manager",
        });
        await expect(
          callerFor(manager, files).project.deliveryFileUrl({ teamSlug: "team", projectId: first.projectId, deliveryId }),
        ).resolves.toEqual({ url: expect.any(String) });

        const noFile = { code: "BAD_REQUEST", message: "This delivery has no file." };
        const { projectId: otherId } = await createProject(first.userId);
        const otherToken = await clientToken(otherId);
        await expect(
          callerFor(null, files).project.clientDeliveryFileUrl({ token: otherToken, deliveryId }),
        ).rejects.toMatchObject(noFile);
        await expect(
          callerFor(first.userId, files).project.deliveryFileUrl({ teamSlug: "team", projectId: otherId, deliveryId }),
        ).rejects.toMatchObject(noFile);
        await callerFor(null).project.clientRequestChanges({ token: first.token, deliveryId, note: "Again" });
        const { deliveryId: plainId } = await deliver(first.freelancer, first.projectId);
        await expect(
          callerFor(null, files).project.clientDeliveryFileUrl({ token: first.token, deliveryId: plainId }),
        ).rejects.toMatchObject(noFile);
        await expect(
          callerFor(null, files).project.clientDeliveryFileUrl({ token: "nope", deliveryId }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });

        const other = await seedServicesTeamMember(db, {
          organizationId: first.organizationId,
          teamId: first.teamId,
          role: "freelancer",
        });
        await expect(
          callerFor(other, files).project.deliveryFileUrl({ teamSlug: "team", projectId: first.projectId, deliveryId }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const outsider = await seedServicesTeamWithAdmin(db, { slug: "other" });
        await expect(
          callerFor(outsider.userId, files).project.deliveryFileUrl({ teamSlug: "team", projectId: first.projectId, deliveryId }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(files.gets).toHaveLength(3);
      });
    });
  });
});
