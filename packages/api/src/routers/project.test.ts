import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import { paymentCapturedTransfer, createFakeFileStore, type FileStore, type JsonObject } from "@jendal-workspace/core";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProject,
  seedServicesTeam,
  seedServicesTeamWithAdmin,
  seedServicesOffering,
  seedServicesTeamMember,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import { savePayoutDestination } from "@jendal-workspace/db/repositories/payouts";
import { markTeamPayPalMerchant } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { setProjectRefundStatus, upsertRefundPart } from "@jendal-workspace/db/repositories/project-refunds";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { findFileUpload, insertFileUpload } from "@jendal-workspace/db/repositories/files";
import {
  findProjectById,
  getProjectFacts,
  listProjectDeliveries,
  listProjectQuotes,
} from "@jendal-workspace/db/repositories/projects";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { actionLog } from "@jendal-workspace/db/schema/action-log";
import { clientContact, clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { team as teamTable } from "@jendal-workspace/db/schema/organization";
import { payment, project } from "@jendal-workspace/db/schema/projects";
import { ledgerBalance, ledgerEntry, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { projectRefundPart } from "@jendal-workspace/db/schema/project-refunds";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import { createFakeMailer } from "@jendal-workspace/email/fake";
import { buildAuthAssertion, createPayPalClient } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, type RecordedRequest } from "@jendal-workspace/paypal/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { projectList } from "../actions/projects";
import { signClientLink, verifyClientLink } from "../client-links";
import { clientTokenFor } from "../testing/client-links";
import type { Context, EmailServices, PayPalServices } from "../context";
import { createTestCatalogServices } from "../testing/catalog";
import { applyCaptureFact } from "../use-cases/payments";
import { processPayPalWebhookEvent } from "../use-cases/paypal-webhooks";
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

function clientToken(db: Parameters<typeof clientTokenFor>[0], projectId: string): Promise<string> {
  return clientTokenFor(db, TEST_AUTH_CONFIG.BETTER_AUTH_SECRET, projectId);
}

describe.skipIf(!hasTestDatabase)("project router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null, files: FileStore = createFakeFileStore(), paypal?: PayPalServices) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files,
      paypal,
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function createProject(userId: string) {
    const caller = callerFor(userId);
    return caller.project.create({ teamSlug: "team", title: "Website redesign", clientEmail: "client@example.com" });
  }

  it("starts a project with a project.created outbox event and hands the team no client link", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const started = await createProject(userId);
    const { projectId } = started;

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({
      title: "Website redesign",
      status: "quoting",
      currency: "USD",
      managementFeeBps: 1_000,
      teamCutBps: 1_500,
    });
    expect(started).toEqual({ projectId });
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

  it("tells the project page whether the seller is solo and what the quote calculator needs", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "solo", solo: true });
    const studioTeam = await seedServicesTeam(db, { organizationId, slug: "studio" });
    await db.update(teamTable).set({ paypalCountry: "US" }).where(eq(teamTable.id, studioTeam.id));
    await savePayoutDestination(db, userId, { paypalPayerId: "G83JXTJ5EHCQ2", paypalEmail: null, paypalCountry: "FR" }, null);
    const caller = callerFor(userId);

    const solo = await caller.project.create({ teamSlug: "solo", title: "Solo site", clientEmail: "c@example.com" });
    const studio = await caller.project.create({ teamSlug: "studio", title: "Team site", clientEmail: "c@example.com" });
    await caller.project.assign({ teamSlug: "studio", projectId: studio.projectId, freelancerId: userId });

    await expect(caller.project.get({ teamSlug: "solo", projectId: solo.projectId })).resolves.toMatchObject({
      solo: true,
      quoteCalculator: { platformFeeBps: 100, senderCountry: null, receiverCountry: null },
    });
    await expect(caller.project.get({ teamSlug: "studio", projectId: studio.projectId })).resolves.toMatchObject({
      solo: false,
      quoteCalculator: { platformFeeBps: 50, senderCountry: "US", receiverCountry: "FR" },
    });
    // Only admins and the payee see the payee's country.
    const manager = await seedServicesTeamMember(db, { organizationId, teamId: studioTeam.id, role: "manager" });
    await expect(callerFor(manager).project.get({ teamSlug: "studio", projectId: studio.projectId })).resolves.toMatchObject({
      quoteCalculator: { senderCountry: "US", receiverCountry: null },
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

  it("refuses assignment on a solo team, while the client's acceptance still assigns the seller", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "solo", solo: true });
    const caller = callerFor(userId);
    const { projectId } = await caller.project.create({
      teamSlug: "solo",
      title: "Solo site",
      clientEmail: "client@example.com",
    });

    await expect(caller.project.assign({ teamSlug: "solo", projectId, freelancerId: userId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A solo seller does the work; there is no one to assign.",
    });
    expect((await findProjectById(db, projectId))?.assignedFreelancerId).toBeNull();

    const { quoteId } = await caller.project.addQuote({ teamSlug: "solo", projectId, items: ITEMS, deliveryDays: 14 });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(db, projectId), quoteId });
    expect(await findProjectById(db, projectId)).toMatchObject({ status: "awaiting_deposit", assignedFreelancerId: userId });
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
    expect(list).toEqual([
      { id: projectId, title: "Website redesign", status: "quoting", currency: "USD", clientName: "client", createdAt: expect.any(Date) },
    ]);
    const detail = await callerFor(userId).project.get({ teamSlug: "team", projectId });
    expect(detail.project.id).toBe(projectId);
    expect(detail.quotes).toEqual([]);
  });

  it("shows the team its project's contacts, and never a client link", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    const { projectId } = await createProject(userId);
    const { contactId } = await callerFor(userId).project.clientAdd({
      teamSlug: "team",
      projectId,
      email: "second@example.com",
      name: "Second",
    });

    const detail = await callerFor(userId).project.get({ teamSlug: "team", projectId });

    expect(detail.contacts).toEqual([
      {
        id: expect.any(String),
        name: "client",
        isPrimary: true,
        identities: [{ kind: "email", value: "client@example.com", verified: false }],
      },
      { id: contactId, name: "Second", isPrimary: false, identities: [{ kind: "email", value: "second@example.com", verified: false }] },
    ]);
    expect(JSON.stringify(detail)).not.toContain("/c/");
    expect(detail.project).not.toHaveProperty("clientEmail");
  });

  it("previews the client page for the team without a link, and without pay links", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await createProject(userId);
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 14 });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(db, projectId), quoteId });

    const preview = await callerFor(userId).project.clientPreview({ teamSlug: "team", projectId });

    expect(preview.project).toMatchObject({ id: projectId, title: "Website redesign" });
    expect(preview.payments).toEqual([expect.objectContaining({ kind: "deposit", payable: true, payPath: null })]);
    // The client page holds the unmasked brief and the client's team-only messages: staff only.
    await expect(callerFor(freelancer).project.clientPreview({ teamSlug: "team", projectId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const outsider = await seedServicesTeamWithAdmin(db, { slug: "other" });
    await expect(callerFor(outsider.userId).project.clientPreview({ teamSlug: "team", projectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lists projects in the shape the project.list output schema describes once on the wire", async () => {
    const { userId } = await seedServicesTeamWithAdmin(db);
    await createProject(userId);

    const list = await callerFor(userId).project.list({ teamSlug: "team" });

    expect(list).toHaveLength(1);
    expect(projectList.output?.safeParse(JSON.parse(JSON.stringify(list))).success).toBe(true);
  });

  it("shows a web request's client name and answers in the project detail", async () => {
    const { userId, teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, {
      teamId,
      clientEmail: "web@example.com",
      clientName: "Web Client",
      source: "web",
      requestAnswers: [
        { question: "Budget?", answer: "Around $1k" },
        { question: "Deadline?", answer: "Next month,\nif possible" },
      ],
    });

    const detail = await callerFor(userId).project.get({ teamSlug: "team", projectId });
    expect(detail.contacts).toEqual([
      expect.objectContaining({ name: "Web Client", identities: [{ kind: "email", value: "web@example.com", verified: false }] }),
    ]);
    expect(detail.project).toMatchObject({
      source: "web",
      requestAnswers: [
        { question: "Budget?", answer: "Around $1k" },
        { question: "Deadline?", answer: "Next month,\nif possible" },
      ],
    });
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

    const token = await clientToken(db, projectId);
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

  it("refuses a signed-in team member who opens the client link", async () => {
    const { organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const token = await clientToken(db, projectId);
    await expect(callerFor(freelancer).project.clientGet({ token })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Team members act from the project page.",
    });
    await expect(callerFor(null).project.clientGet({ token })).resolves.toMatchObject({ project: { id: projectId } });
  });

  it("logs a team member's refused client action", async () => {
    const { organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const token = await clientToken(db, projectId);
    await expect(
      callerFor(freelancer).project.clientAcceptQuote({ token, quoteId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(actionLog)).toEqual([
      expect.objectContaining({
        action: "quote.accept",
        teamId,
        projectId,
        actorKind: "user",
        actorId: freelancer,
        outcome: "forbidden",
        message: "Team members act from the project page.",
      }),
    ]);
  });

  it("answers a valid link to a missing project like a forged one", async () => {
    const token = await clientToken(db, crypto.randomUUID());
    const notValid = { code: "NOT_FOUND", message: "This link is not valid." };
    await expect(callerFor(null).project.clientGet({ token })).rejects.toMatchObject(notValid);
    await expect(callerFor(null).project.clientAcceptQuote({ token, quoteId: crypto.randomUUID() })).rejects.toMatchObject(
      notValid,
    );
  });

  it("logs the client's acceptance from the web, and not the team's page views", async () => {
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
    const before = (await db.select({ id: actionLog.id }).from(actionLog)).map((row) => row.id);

    await callerFor(userId).project.get({ teamSlug: "team", projectId });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(db, projectId), quoteId });

    const added = (await db.select().from(actionLog)).filter((row) => !before.includes(row.id));
    expect(added).toEqual([
      expect.objectContaining({
        action: "quote.accept",
        surface: "web",
        projectId,
        actorKind: "client_link",
        actorId: null,
        outcome: "ok",
      }),
    ]);
  });

  it("assigns the freelancer the quote names when the client accepts (open and team modes)", async () => {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });

    // Open mode: the quoting freelancer.
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, teamId));
    const { projectId } = await createProject(userId);
    const { quoteId } = await callerFor(freelancer).project.addQuote({ teamSlug: "team", projectId, items: ITEMS, deliveryDays: 7 });
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(db, projectId), quoteId });
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
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(db, second), quoteId: staffQuote });
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
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(db, projectId), quoteId });

    // Accepting again is refused by the state machine and changes nothing.
    await expect(
      callerFor(null).project.clientAcceptQuote({ token: await clientToken(db, projectId), quoteId }),
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
    await callerFor(null).project.clientAcceptQuote({ token: await clientToken(db, projectId), quoteId });
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

    const token = await clientToken(db, projectId);
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
    const result = await callerFor(null).project.clientAcceptAmendment({ token: await clientToken(db, projectId), amendmentId });
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

    const token = await clientToken(db, projectId);
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
      const token = await clientToken(db, projectId);
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
        reviewReason: null,
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
      const refund = { amountMinor: 16_000, currency: "USD", status: "requested", completedAt: null };
      expect((await callerFor(null).project.clientGet({ token })).refund).toEqual(refund);
      expect((await callerFor(userId).project.get({ teamSlug: "team", projectId })).refund).toEqual({ ...refund, parts: [] });
    });

    describe("refundClient", () => {
      // A refund of each part answers what PayPal would: the same refund for a repeated request id.
      // order answers PayPal's lookup of ORDER1, the deposit's order, for the webhook.
      function fakePayPalRefunds(
        answer: (captureId: string, call: number) => Response | "COMPLETED" | "PENDING" | "FAILED",
        order?: () => JsonObject,
      ) {
        const calls = new Map<string, number>();
        const api = fakeFetch((request) => {
          if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
          if (order && request.method === "GET" && request.url.endsWith("/v2/checkout/orders/ORDER1")) {
            return jsonResponse(200, order());
          }
          const match = /\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(request.url);
          if (request.method !== "POST" || !match?.[1]) return jsonResponse(404, { name: "UNEXPECTED_CALL", debug_id: "d404" });
          const captureId = match[1];
          const call = (calls.get(captureId) ?? 0) + 1;
          calls.set(captureId, call);
          const answered = answer(captureId, call);
          if (answered instanceof Response) return answered;
          const body: { amount: { currency_code: string; value: string } } = JSON.parse(request.body ?? "{}");
          return jsonResponse(201, {
            id: `REFUND-${captureId}`,
            status: answered,
            amount: body.amount,
            seller_payable_breakdown:
              answered === "COMPLETED"
                ? {
                    paypal_fee: { currency_code: "USD", value: "1.00" },
                    platform_fees: [{ amount: { currency_code: "USD", value: "0.50" } }],
                    net_amount: { currency_code: "USD", value: "0.00" },
                  }
                : null,
          });
        });
        const paypal: PayPalServices = {
          client: createPayPalClient({
            clientId: "partner-client-id",
            clientSecret: "partner-secret",
            environment: "sandbox",
            fetch: api.fetch,
            sleep: () => Promise.resolve(),
          }),
          partnerId: "PARTNER42",
          returnUrl: "https://admin.example.com/api/paypal/onboarding/return",
          sdk: { clientId: "partner-client-id", partnerAttributionId: "PLATFORM_BN", environment: "sandbox" },
        };
        const refundCalls = () => api.requests.filter((r: RecordedRequest) => r.url.includes("/v2/payments/captures/"));
        return { paypal, refundCalls };
      }

      // The $600 deposit (CAPTURE1) and a later $500 top-up (CAPTURE2) paid; removing Build ($600) leaves a $400
      // final price and a $40 fee, so $660 goes back: $500 on the top-up, $160 on the deposit.
      async function overpaidProject() {
        const seeded = await workingProject();
        const { userId, freelancer, projectId, token, teamId } = seeded;
        const [deposit] = await db.select().from(payment).where(eq(payment.projectId, projectId));
        if (!deposit) throw new Error("missing deposit");
        const topUpId = await db.transaction(async (tx) => {
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
              paypalCaptureId: "CAPTURE2",
              capturedAt: new Date(Date.now() + 60_000),
            })
            .returning();
          if (!topUp) throw new Error("missing top-up");
          await createPostgresLedger(teamId, tx).post([
            paymentCapturedTransfer({ currency: "USD", projectId, paymentId: topUp.id, quotePartMinor: 50_000, managementFeeMinor: 0 }),
          ]);
          return topUp.id;
        });
        await markTeamPayPalMerchant(db, { teamId, merchantId: "SELLER1" });
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
        expect(await callerFor(null).project.clientAcceptDelivery({ token, deliveryId })).toMatchObject({ status: "completed" });
        expect(await balanceOf("client_refunds")).toBe(66_000);
        return { ...seeded, depositId: deposit.id, topUpId, refundId: `completion-${projectId}` };
      }

      async function postingsOf(kind: "refund_confirmed" | "refund_fees") {
        const rows = await db
          .select({ reference: ledgerTransfer.reference, account: ledgerEntry.account, amountMinor: ledgerEntry.amountMinor })
          .from(ledgerTransfer)
          .innerJoin(ledgerEntry, eq(ledgerEntry.transferId, ledgerTransfer.id))
          .where(eq(ledgerTransfer.kind, kind));
        return rows.sort((a, b) => `${a.reference}${a.account}`.localeCompare(`${b.reference}${b.account}`));
      }

      const UNCERTAIN = "We could not confirm the refund with PayPal. Try again; the client will not be refunded twice.";

      // PayPal's ORDER1 (the deposit's order) listing the given refunds of CAPTURE1.
      function depositOrder(refunds: { id: string; value: string }[]): JsonObject {
        return {
          id: "ORDER1",
          status: "COMPLETED",
          purchase_units: [
            {
              payments: {
                captures: [{ id: "CAPTURE1", status: "PARTIALLY_REFUNDED", amount: { currency_code: "USD", value: "600.00" } }],
                refunds: refunds.map((r) => ({ id: r.id, status: "COMPLETED", amount: { currency_code: "USD", value: r.value } })),
              },
            },
          ],
        };
      }

      function refundWebhook(paypal: PayPalServices, refundId: string) {
        return processPayPalWebhookEvent(
          { db, paypal },
          {
            id: `WH-${refundId}`,
            eventType: "PAYMENT.CAPTURE.REFUNDED",
            resourceType: "refund",
            resourceId: refundId,
            customId: null,
            orderId: null,
            captureId: "CAPTURE1",
            merchantId: "SELLER1",
            status: "received",
            attempts: 0,
            note: null,
            receivedAt: new Date(),
            processedAt: null,
          },
        );
      }

      async function refundedOf(paymentId: string) {
        const [row] = await db.select().from(payment).where(eq(payment.id, paymentId));
        return { status: row?.status, refundedMinor: row?.refundedMinor };
      }

      it("refunds the overpayment on the newest captures first, from the seller's account, once", async () => {
        const { userId, projectId, token, depositId, topUpId, refundId } = await overpaidProject();
        const { paypal, refundCalls } = fakePayPalRefunds(() => "COMPLETED");

        const view = await callerFor(userId, undefined, paypal).project.refundClient({ teamSlug: "team", projectId });

        expect(view).toEqual({
          amountMinor: 66_000,
          currency: "USD",
          status: "completed",
          completedAt: expect.any(Date),
          parts: [
            { paymentId: topUpId, amountMinor: 50_000, status: "completed", sent: true, failureMessage: null },
            { paymentId: depositId, amountMinor: 16_000, status: "completed", sent: true, failureMessage: null },
          ],
        });
        expect(
          refundCalls().map((r) => ({
            url: r.url,
            requestId: r.headers.get("paypal-request-id"),
            assertion: r.headers.get("paypal-auth-assertion"),
            body: JSON.parse(r.body ?? ""),
          })),
        ).toEqual([
          {
            url: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE2/refund",
            requestId: `project-refund:${refundId}:${topUpId}`,
            assertion: buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER1" }),
            body: { amount: { currency_code: "USD", value: "500.00" } },
          },
          {
            url: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE1/refund",
            requestId: `project-refund:${refundId}:${depositId}`,
            assertion: buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER1" }),
            body: { amount: { currency_code: "USD", value: "160.00" } },
          },
        ]);
        expect(await postingsOf("refund_confirmed")).toEqual([
          { reference: "refund_confirmed:REFUND-CAPTURE1", account: "client_refunds", amountMinor: -16_000 },
          { reference: "refund_confirmed:REFUND-CAPTURE1", account: "paypal_clearing", amountMinor: 16_000 },
          { reference: "refund_confirmed:REFUND-CAPTURE2", account: "client_refunds", amountMinor: -50_000 },
          { reference: "refund_confirmed:REFUND-CAPTURE2", account: "paypal_clearing", amountMinor: 50_000 },
        ]);
        expect((await postingsOf("refund_fees")).map((p) => p.reference)).toEqual([
          ...Array<string>(3).fill("refund_fees:REFUND-CAPTURE1"),
          ...Array<string>(3).fill("refund_fees:REFUND-CAPTURE2"),
        ]);
        expect(await balanceOf("client_refunds")).toBe(0);
        expect(await refundedOf(topUpId)).toEqual({ status: "refunded", refundedMinor: 50_000 });
        expect(await refundedOf(depositId)).toEqual({ status: "captured", refundedMinor: 16_000 });
        expect((await callerFor(null).project.clientGet({ token })).refund).toEqual({
          amountMinor: 66_000,
          currency: "USD",
          status: "completed",
          completedAt: expect.any(Date),
        });

        await expect(
          callerFor(userId, undefined, paypal).project.refundClient({ teamSlug: "team", projectId }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This refund was already sent." });
        expect(refundCalls()).toHaveLength(2);
      });

      it("leaves refunds PayPal holds to the webhook, and refuses to send them again meanwhile", async () => {
        const { userId, projectId } = await overpaidProject();
        const { paypal, refundCalls } = fakePayPalRefunds(() => "PENDING");
        const caller = callerFor(userId, undefined, paypal);

        const pending = await caller.project.refundClient({ teamSlug: "team", projectId });
        expect(pending.status).toBe("issuing");
        expect(pending.parts.map((p) => [p.status, p.sent])).toEqual([
          ["pending", true],
          ["pending", true],
        ]);
        expect(await postingsOf("refund_confirmed")).toEqual([]);

        await expect(caller.project.refundClient({ teamSlug: "team", projectId })).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "This refund is being sent.",
        });
        expect(refundCalls()).toHaveLength(2);
      });

      it("sends the parts of a refund whose request died before PayPal answered, once each", async () => {
        const { userId, projectId, depositId, topUpId, refundId } = await overpaidProject();
        await db.transaction(async (tx) => {
          await upsertRefundPart(tx, { projectRefundId: refundId, paymentId: topUpId, captureId: "CAPTURE2", amountMinor: 50_000 });
          await upsertRefundPart(tx, { projectRefundId: refundId, paymentId: depositId, captureId: "CAPTURE1", amountMinor: 16_000 });
          await setProjectRefundStatus(tx, refundId, "issuing");
        });
        const { paypal, refundCalls } = fakePayPalRefunds(() => "COMPLETED");
        const caller = callerFor(userId, undefined, paypal);
        expect((await caller.project.get({ teamSlug: "team", projectId })).refund).toMatchObject({
          status: "issuing",
          parts: [
            { paymentId: topUpId, status: "pending", sent: false, failureMessage: null },
            { paymentId: depositId, status: "pending", sent: false, failureMessage: null },
          ],
        });

        expect((await caller.project.refundClient({ teamSlug: "team", projectId })).status).toBe("completed");
        expect(refundCalls().map((r) => r.url.split("/").at(-2))).toEqual(["CAPTURE2", "CAPTURE1"]);
        expect(await balanceOf("client_refunds")).toBe(0);
      });

      // The server's error log (apps/server trpc-error-log) reads PayPal's debug id from the error's cause.
      it("keeps PayPal's error as the cause of a refused refund, for the error log", async () => {
        const { userId, projectId } = await overpaidProject();
        const { paypal } = fakePayPalRefunds(() =>
          jsonResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "The refund was refused.", debug_id: "d422" }),
        );

        await expect(callerFor(userId, undefined, paypal).project.refundClient({ teamSlug: "team", projectId })).rejects.toMatchObject({
          code: "BAD_GATEWAY",
          cause: { status: 422, name: "UNPROCESSABLE_ENTITY", debugId: "d422" },
        });
      });

      it("shows PayPal's refusal of a part, fails the parts not sent after it, and sends both on the retry", async () => {
        const { userId, projectId, token, depositId, topUpId } = await overpaidProject();
        const refused = {
          name: "UNPROCESSABLE_ENTITY",
          message: "The refund was refused.",
          debug_id: "d422",
          details: [{ issue: "REFUND_AMOUNT_EXCEEDED", description: "The refund amount exceeds the capture." }],
        };
        const { paypal, refundCalls } = fakePayPalRefunds((captureId, call) =>
          captureId === "CAPTURE2" && call === 1 ? jsonResponse(422, refused) : "COMPLETED",
        );
        const caller = callerFor(userId, undefined, paypal);
        const refusal =
          "UNPROCESSABLE_ENTITY: The refund was refused. (REFUND_AMOUNT_EXCEEDED: The refund amount exceeds the capture.)";

        await expect(caller.project.refundClient({ teamSlug: "team", projectId })).rejects.toMatchObject({
          code: "BAD_GATEWAY",
          message: `PayPal did not refund the client: ${refusal}`,
        });
        // The admin reads PayPal's words; the action log keeps only Payleor's.
        const logged = await db
          .select({ outcome: actionLog.outcome, message: actionLog.message })
          .from(actionLog)
          .where(eq(actionLog.action, "project.refund_client"));
        expect(logged).toEqual([{ outcome: "unavailable", message: "PayPal did not refund the client." }]);
        const failed =(await caller.project.get({ teamSlug: "team", projectId })).refund;
        expect(failed).toMatchObject({
          status: "failed",
          parts: [
            { paymentId: topUpId, status: "failed", failureMessage: refusal },
            { paymentId: depositId, status: "failed", failureMessage: "Not sent because an earlier part was refused." },
          ],
        });
        const [unsent] = await db.select().from(projectRefundPart).where(eq(projectRefundPart.paymentId, depositId));
        expect(unsent).toMatchObject({ paypalRefundId: null, uncertainAt: null });
        expect((await callerFor(null).project.clientGet({ token })).refund?.status).toBe("failed");
        expect(await balanceOf("client_refunds")).toBe(66_000);

        const retried = await caller.project.refundClient({ teamSlug: "team", projectId });
        expect(retried.status).toBe("completed");
        expect(retried.parts.map((p) => p.failureMessage)).toEqual([null, null]);
        expect(refundCalls().map((r) => r.url.split("/").at(-2))).toEqual(["CAPTURE2", "CAPTURE2", "CAPTURE1"]);
        expect(await balanceOf("client_refunds")).toBe(0);
      });

      it("keeps a part PayPal may have refunded pending, holds its webhook, and confirms it once on the retry", async () => {
        const { userId, projectId, depositId, topUpId } = await overpaidProject();
        let paypalDown = true;
        let shownRefunds: { id: string; value: string }[] = [];
        const { paypal, refundCalls } = fakePayPalRefunds(
          (captureId) =>
            captureId === "CAPTURE1" && paypalDown ? jsonResponse(500, { name: "INTERNAL_SERVER_ERROR", debug_id: "d500" }) : "COMPLETED",
          () => depositOrder(shownRefunds),
        );
        const caller = callerFor(userId, undefined, paypal);
        const webhook = (refundId: string) => refundWebhook(paypal, refundId);

        await expect(caller.project.refundClient({ teamSlug: "team", projectId })).rejects.toMatchObject({
          code: "BAD_GATEWAY",
          message: UNCERTAIN,
        });
        expect((await caller.project.get({ teamSlug: "team", projectId })).refund).toMatchObject({
          status: "issuing",
          parts: [
            { paymentId: topUpId, status: "completed", failureMessage: null },
            { paymentId: depositId, status: "pending", failureMessage: UNCERTAIN },
          ],
        });
        const [held] = await db.select().from(projectRefundPart).where(eq(projectRefundPart.paymentId, depositId));
        expect(held?.paypalRefundId).toBeNull();

        // A refund the webhook cannot match may be this one: it waits for the admin's retry.
        shownRefunds = [{ id: "REFUND-UNKNOWN", value: "160.00" }];
        await expect(webhook("REFUND-UNKNOWN")).rejects.toThrow(/still being issued/);

        paypalDown = false;
        expect((await caller.project.refundClient({ teamSlug: "team", projectId })).status).toBe("completed");
        const depositCalls = refundCalls().filter((r) => r.url.includes("/CAPTURE1/"));
        expect(new Set(depositCalls.map((r) => r.headers.get("paypal-request-id"))).size).toBe(1);

        shownRefunds = [{ id: "REFUND-CAPTURE1", value: "160.00" }];
        expect(await webhook("REFUND-CAPTURE1")).toEqual({ status: "processed", note: "refunded" });
        expect((await postingsOf("refund_confirmed")).filter((p) => p.reference === "refund_confirmed:REFUND-CAPTURE1")).toHaveLength(2);
        expect(await db.select().from(ledgerTransfer).where(eq(ledgerTransfer.kind, "payment_refunded"))).toEqual([]);
        expect(await refundedOf(depositId)).toEqual({ status: "captured", refundedMinor: 16_000 });
        expect(await balanceOf("client_refunds")).toBe(0);
      });

      it("never trusts a refusal or a failed refund after an unknown outcome", async () => {
        const { userId, projectId, depositId, refundId } = await overpaidProject();
        const inProgress = {
          name: "RESOURCE_CONFLICT",
          message: "The server has detected a conflict while processing this request.",
          debug_id: "d409",
          details: [{ issue: "PREVIOUS_REQUEST_IN_PROGRESS", description: "A previous request is still in progress." }],
        };
        const refused = {
          name: "UNPROCESSABLE_ENTITY",
          message: "The refund was refused.",
          debug_id: "d422",
          details: [{ issue: "REFUND_AMOUNT_EXCEEDED", description: "The refund amount exceeds the capture." }],
        };
        const { paypal, refundCalls } = fakePayPalRefunds((captureId, call) => {
          if (captureId !== "CAPTURE1") return "COMPLETED";
          if (call === 1) return jsonResponse(409, inProgress);
          if (call === 2) return jsonResponse(422, refused);
          return call === 3 ? "FAILED" : "COMPLETED";
        });
        const caller = callerFor(userId, undefined, paypal);
        const refundClient = () => caller.project.refundClient({ teamSlug: "team", projectId });
        // The top-up part is refunded on the first attempt; only the deposit's $160 stays owed.
        const expectDepositUncertain = async () => {
          await expect(refundClient()).rejects.toMatchObject({ code: "BAD_GATEWAY", message: UNCERTAIN });
          expect((await caller.project.get({ teamSlug: "team", projectId })).refund).toMatchObject({
            status: "issuing",
            parts: [{ status: "completed" }, { paymentId: depositId, status: "pending", failureMessage: UNCERTAIN }],
          });
          expect(await balanceOf("client_refunds")).toBe(16_000);
        };

        // PayPal is still running an earlier request with this id, which may refund.
        await expectDepositUncertain();
        // A settled refusal, then a FAILED refund, may not be the answer to the request that refunded.
        await expectDepositUncertain();
        await expectDepositUncertain();

        expect((await refundClient()).status).toBe("completed");
        expect(await balanceOf("client_refunds")).toBe(0);
        expect(await refundedOf(depositId)).toEqual({ status: "captured", refundedMinor: 16_000 });
        const depositRequestIds = refundCalls()
          .filter((r) => r.url.includes("/CAPTURE1/"))
          .map((r) => r.headers.get("paypal-request-id"));
        expect(depositRequestIds).toEqual(Array<string>(4).fill(`project-refund:${refundId}:${depositId}`));
      });

      it("refuses to retry a refund whose outcome has been unknown for over 30 days", async () => {
        const { userId, projectId, depositId } = await overpaidProject();
        let paypalDown = true;
        const { paypal, refundCalls } = fakePayPalRefunds((captureId) =>
          captureId === "CAPTURE1" && paypalDown ? jsonResponse(500, { name: "INTERNAL_SERVER_ERROR", debug_id: "d500" }) : "COMPLETED",
        );
        const caller = callerFor(userId, undefined, paypal);
        await expect(caller.project.refundClient({ teamSlug: "team", projectId })).rejects.toMatchObject({ message: UNCERTAIN });
        await db
          .update(projectRefundPart)
          .set({ uncertainAt: new Date(Date.now() - 31 * 86_400_000) })
          .where(eq(projectRefundPart.paymentId, depositId));
        paypalDown = false;
        const callsBefore = refundCalls().length;

        await expect(caller.project.refundClient({ teamSlug: "team", projectId })).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "This refund is too old to retry safely. Contact support.",
        });
        expect(refundCalls()).toHaveLength(callsBefore);
        expect((await caller.project.get({ teamSlug: "team", projectId })).refund?.status).toBe("issuing");
      });

      it("tells the admin to contact support when PayPal refuses the refund it created", async () => {
        const { userId, projectId, depositId } = await overpaidProject();
        const { paypal } = fakePayPalRefunds((captureId) => (captureId === "CAPTURE1" ? "FAILED" : "COMPLETED"));
        const caller = callerFor(userId, undefined, paypal);
        const message = "PayPal refused this refund. Contact support; do not refund the client in PayPal.";

        await expect(caller.project.refundClient({ teamSlug: "team", projectId })).rejects.toMatchObject({
          code: "BAD_GATEWAY",
          message: `PayPal did not refund the client: ${message}`,
        });
        expect((await caller.project.get({ teamSlug: "team", projectId })).refund).toMatchObject({
          status: "failed",
          parts: [{ status: "completed" }, { paymentId: depositId, status: "failed", failureMessage: message }],
        });
        const [refused] = await db.select().from(projectRefundPart).where(eq(projectRefundPart.paymentId, depositId));
        expect(refused?.paypalRefundId).toBe("REFUND-CAPTURE1");
      });

      it("lets only the team's admins refund, and only a project with a refund", async () => {
        const { userId, organizationId, teamId, freelancer, projectId } = await overpaidProject();
        const manager = await seedServicesTeamMember(db, { organizationId, teamId, role: "manager" });
        const { paypal, refundCalls } = fakePayPalRefunds(() => "COMPLETED");
        for (const someone of [freelancer, manager]) {
          await expect(
            callerFor(someone, undefined, paypal).project.refundClient({ teamSlug: "team", projectId }),
          ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only an admin can refund the client." });
        }
        const { projectId: unpaid } = await createProject(userId);
        await expect(
          callerFor(userId, undefined, paypal).project.refundClient({ teamSlug: "team", projectId: unpaid }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This project has nothing to refund." });
        expect(refundCalls()).toEqual([]);
      });
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
      const otherToken = await clientToken(db, otherId);
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
        const otherToken = await clientToken(db, otherId);
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

  // Sellers design §4.2: the public quote request form.
  describe("requestQuote", () => {
    type RequestInput = {
      slug: string;
      offeringId: string | null;
      name: string;
      email: string;
      description: string;
      answers: { question: string; answer: string }[];
      website: string;
    };

    function validRequest(overrides: Partial<RequestInput> = {}): RequestInput {
      return {
        slug: "seller",
        offeringId: null,
        name: "Jo",
        email: "jo@x.com",
        description: "I need a landing page for my shop.",
        answers: [{ question: "Colors?", answer: "Blue" }],
        website: "",
        ...overrides,
      };
    }

    // A caller with the email port wired to a fake mailer, unless `email: false`.
    function requestCaller(options: { headers?: Headers; email?: boolean } = {}) {
      const mailer = createFakeMailer();
      const context: Context = {
        db,
        session: null,
        environment: "sandbox",
        auth,
        headers: options.headers ?? new Headers(),
        catalog: createTestCatalogServices(),
        files: createFakeFileStore(),
      };
      if (options.email !== false) {
        context.email = {
          mailer,
          siteOrigin: "https://payleor.test",
          platformName: "Platform",
          dashOrigin: "https://dash.payleor.test",
          storeOrigin: (slug: string) => `https://${slug}.payleor.test`,
        };
      }
      const caller = appRouter.createCaller(context);
      return { caller, mailer };
    }

    // An active services team with a support email and one active offering.
    async function setupSeller() {
      const { organizationId } = await seedOrganization(db);
      const team = await seedServicesTeam(db, { organizationId, slug: "seller", name: "Walk Crew", status: "active" });
      await db.update(teamTable).set({ supportEmail: "support@walkcrew.test" }).where(eq(teamTable.id, team.id));
      const offeringId = await seedServicesOffering(db, { teamId: team.id, name: "Landing page" });
      return { organizationId, team, offeringId };
    }

    it("creates a quoting project from a public request and emails the client and the team", async () => {
      const { team, offeringId } = await setupSeller();
      const { caller, mailer } = requestCaller();

      const result = await caller.project.requestQuote(validRequest({ offeringId }));
      expect(result).toEqual({ ok: true, projectId: null });

      const rows = await db.select().from(project);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        teamId: team.id,
        status: "quoting",
        source: "web",
        title: "Landing page",
        brief: "I need a landing page for my shop.",
        requestAnswers: [{ question: "Colors?", answer: "Blue" }],
        currency: "USD",
        managementFeeBps: 1_000,
        teamCutBps: 1_500,
        createdById: null,
      });
      const projectId = rows[0]!.id;
      const [contact] = await db.select().from(clientContact);
      expect(contact).toMatchObject({ teamId: team.id, name: "Jo" });
      expect(await db.select().from(clientIdentity)).toEqual([
        expect.objectContaining({ contactId: contact!.id, kind: "email", value: "jo@x.com", source: "request", verifiedAt: null }),
      ]);
      expect(await db.select().from(projectClient)).toEqual([
        expect.objectContaining({ projectId, contactId: contact!.id, isPrimary: true, linkVersion: 1, linkEmail: "jo@x.com" }),
      ]);
      expect(await db.select().from(outbox)).toEqual([
        expect.objectContaining({
          type: "project.created",
          projectId,
          data: { projectId, title: "Landing page", contactIds: [contact!.id], clientName: "Jo", channelId: null },
        }),
      ]);

      expect(mailer.sent).toHaveLength(2);
      const [toClient, toTeam] = mailer.sent;
      expect(toClient).toMatchObject({
        to: "jo@x.com",
        subject: "Your request to Walk Crew",
        replyTo: "support@walkcrew.test",
      });
      expect(toClient!.html).toContain("https://seller.payleor.test/c/");
      expect(toTeam).toMatchObject({ to: "support@walkcrew.test", subject: "New request from Jo" });

      const match = /https:\/\/seller\.payleor\.test\/c\/(\S+)/.exec(toClient!.text);
      expect(match).toBeTruthy();
      expect(await verifyClientLink(TEST_AUTH_CONFIG.BETTER_AUTH_SECRET, match![1]!)).toEqual({
        projectId,
        contactId: contact!.id,
        version: 1,
        emailed: true,
      });
    });

    it("gives a request carrying a verified client's email its own contact, with no hold on that client's projects", async () => {
      const { team, offeringId } = await setupSeller();
      const clientProject = await seedProject(db, { teamId: team.id, clientEmail: "jo@x.com" });
      await db.update(clientIdentity).set({ verifiedAt: new Date() });
      const [verified] = await db.select().from(projectClient).where(eq(projectClient.projectId, clientProject));
      const { caller, mailer } = requestCaller();

      await caller.project.requestQuote(validRequest({ offeringId }));

      const requested = (await db.select().from(project)).find((p) => p.id !== clientProject)!;
      const [attached] = await db.select().from(projectClient).where(eq(projectClient.projectId, requested.id));
      expect(attached!.contactId).not.toBe(verified!.contactId);
      const token = /https:\/\/seller\.payleor\.test\/c\/(\S+)/.exec(mailer.sent[0]!.text)![1]!;
      expect(await verifyClientLink(TEST_AUTH_CONFIG.BETTER_AUTH_SECRET, token)).toMatchObject({
        projectId: requested.id,
        contactId: attached!.contactId,
      });
      // Even a correctly signed link for the requester's contact opens nothing on the client's project.
      const theirs = await signClientLink(TEST_AUTH_CONFIG.BETTER_AUTH_SECRET, {
        projectId: clientProject,
        contactId: attached!.contactId,
        version: 1,
      });
      await expect(callerFor(null).project.clientGet({ token: theirs })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("pretends success for a filled honeypot without writing anything", async () => {
      const { offeringId } = await setupSeller();
      const { caller, mailer } = requestCaller();

      const result = await caller.project.requestQuote(validRequest({ offeringId, website: "https://spam.example" }));
      expect(result).toEqual({ ok: true, projectId: null });
      expect(await db.select().from(project)).toEqual([]);
      expect(mailer.sent).toEqual([]);
    });

    it("reports draft teams and stores as not found", async () => {
      const { organizationId } = await seedOrganization(db);
      await seedServicesTeam(db, { organizationId, slug: "draft-team", status: "draft" });
      await seedStore(db, { organizationId, slug: "a-store", status: "active" });
      const { caller } = requestCaller();

      for (const slug of ["draft-team", "a-store"]) {
        await expect(caller.project.requestQuote(validRequest({ slug }))).rejects.toMatchObject({
          code: "NOT_FOUND",
          message: "Seller not found.",
        });
      }
    });

    it("rejects an offering that is not an active service of the team", async () => {
      const { team, offeringId } = await setupSeller();
      const { organizationId: otherOrgId } = await seedOrganization(db);
      const otherTeam = await seedServicesTeam(db, { organizationId: otherOrgId, slug: "other", status: "active" });
      const otherOffering = await seedServicesOffering(db, { teamId: otherTeam.id });
      const inactive = await seedServicesOffering(db, { teamId: team.id, name: "Old service", active: false });
      const { caller } = requestCaller();

      for (const id of [otherOffering, inactive]) {
        await expect(caller.project.requestQuote(validRequest({ offeringId: id }))).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "That service is not on this seller's list.",
        });
      }
      // The team's own active offering still works.
      await expect(caller.project.requestQuote(validRequest({ offeringId }))).resolves.toEqual({ ok: true, projectId: null });
    });

    it("refuses a fourth open request from the same email on the team, even when two arrive at once", async () => {
      const { team, offeringId } = await setupSeller();
      for (let i = 0; i < 2; i += 1) {
        await seedProject(db, { teamId: team.id, clientEmail: "jo@x.com", status: "quoting", source: "web" });
      }
      const { caller } = requestCaller();

      const results = await Promise.allSettled([
        caller.project.requestQuote(validRequest({ offeringId })),
        caller.project.requestQuote(validRequest({ offeringId })),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.reason).toMatchObject({
        code: "BAD_REQUEST",
        message: "You already have 3 open requests with this team. Wait for an answer before sending another.",
      });
      expect(await db.select().from(project).where(eq(project.teamId, team.id))).toHaveLength(3);
    });

    it("rate limits valid requests per email and team; invalid ones do not use the budget", async () => {
      const { offeringId } = await setupSeller();
      const { caller, mailer } = requestCaller();
      for (let i = 0; i < 5; i += 1) {
        await expect(
          caller.project.requestQuote(validRequest({ offeringId, description: "short" })),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      await expect(caller.project.requestQuote(validRequest({ offeringId }))).resolves.toEqual({ ok: true, projectId: null });

      for (let i = 0; i < 4; i += 1) {
        await hitRequestLimit(db, { key: "quote-request:email:seller:jo@x.com", windowMs: 3_600_000, max: 5 });
      }
      await expect(caller.project.requestQuote(validRequest({ offeringId }))).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Wait a little and try again.",
      });
      expect(await db.select().from(project)).toHaveLength(1);
      expect(mailer.sent).toHaveLength(2);
    });

    it("rate limits requests per IP and skips the IP limit when there is no IP", async () => {
      const { offeringId } = await setupSeller();
      for (let i = 0; i < 20; i += 1) {
        await hitRequestLimit(db, { key: "quote-request:ip:203.0.113.9", windowMs: 3_600_000, max: 20 });
      }
      const blocked = requestCaller({ headers: new Headers({ "cf-connecting-ip": "203.0.113.9" }) });

      await expect(blocked.caller.project.requestQuote(validRequest({ offeringId }))).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Wait a little and try again.",
      });

      const { caller } = requestCaller();
      await expect(caller.project.requestQuote(validRequest({ offeringId }))).resolves.toEqual({ ok: true, projectId: null });
    });

    it("validates the name and description", async () => {
      const { offeringId } = await setupSeller();
      const { caller } = requestCaller();

      await expect(caller.project.requestQuote(validRequest({ offeringId, name: "  " }))).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Tell us your name.",
      });
      await expect(
        caller.project.requestQuote(validRequest({ offeringId, description: "short" })),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Describe what you need in at least a sentence.",
      });
    });

    it("fails with PRECONDITION_FAILED when the email port is absent", async () => {
      const { offeringId } = await setupSeller();
      const { caller } = requestCaller({ email: false });

      await expect(caller.project.requestQuote(validRequest({ offeringId }))).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "Requests are not available right now.",
      });
      expect(await db.select().from(project)).toEqual([]);
    });

    it("answers a generic error when the client email cannot be sent", async () => {
      const { offeringId } = await setupSeller();
      const send = vi.fn().mockRejectedValue(new Error("resend: 422 invalid address"));
      const email: EmailServices = {
        mailer: { send },
        siteOrigin: "https://payleor.test",
        platformName: "Platform",
        dashOrigin: "https://dash.payleor.test",
        storeOrigin: (slug) => `https://${slug}.payleor.test`,
      };
      const caller = appRouter.createCaller({
        db,
        session: null,
        environment: "sandbox",
        auth,
        headers: new Headers(),
        catalog: createTestCatalogServices(),
        files: createFakeFileStore(),
        email,
      });

      // The provider's error text must not leak to the caller.
      await expect(caller.project.requestQuote(validRequest({ offeringId }))).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "We could not send the email. Try again in a moment.",
      });

      // The use case committed before the send.
      expect(await db.select().from(project)).toHaveLength(1);
      // The team notice is skipped after the client's mail failed.
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
