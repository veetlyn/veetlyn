import { createTestAuth } from "@jendal-workspace/auth/testing";
import { completionTransfer, createFakeFileStore, paymentCapturedTransfer } from "@jendal-workspace/core";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import { savePayoutDestination } from "@jendal-workspace/db/repositories/payouts";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { payoutRequest } from "@jendal-workspace/db/schema/payouts";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProject,
  seedServicesTeam,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

const TEAM = { teamSlug: "acme-studio" };
const PAYER_ID = "G83JXTJ5EHCQ2";
const PAYPAL_EMAIL = "ada@example.com";
const ALREADY_DECIDED = { code: "BAD_REQUEST", message: "This payout request was already decided." };

describe.skipIf(!hasTestDatabase)("payouts", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  const callerFor = (userId: string) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  // A completed $1,000 project with a 15% team cut: $850 owed to the freelancer, $150 team revenue.
  async function earn(teamId: string, freelancerId: string) {
    const projectId = await seedProject(db, { teamId });
    await db.transaction((tx) =>
      createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({
          currency: "USD",
          projectId,
          paymentId: crypto.randomUUID(),
          quotePartMinor: 100_000,
          managementFeeMinor: 0,
        }),
        completionTransfer({ currency: "USD", projectId, freelancerId, finalPriceMinor: 100_000, teamCutBps: 1_500 }),
      ]),
    );
  }

  async function confirmedDestination(userId: string, paypalEmail: string | null = PAYPAL_EMAIL) {
    await savePayoutDestination(db, userId, { paypalPayerId: PAYER_ID, paypalEmail }, { confirmedAt: new Date(), source: "self" });
  }

  // Ada, a freelancer owed $850 with a confirmed destination, in a team whose admin pays payouts.
  async function payoutTeam() {
    const { userId: adminId, organizationId, teamId } = await seedServicesTeamWithAdmin(db, { slug: "acme-studio" });
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Ada" });
    await confirmedDestination(memberId);
    await earn(teamId, memberId);
    return { organizationId, teamId, memberId, admin: callerFor(adminId), member: callerFor(memberId) };
  }

  async function ledgerOf(teamId: string, userId: string) {
    const rows = await db.select().from(ledgerBalance).where(eq(ledgerBalance.teamId, teamId));
    const balance = (account: string) => rows.find((row) => row.account === account)?.balanceMinor ?? 0;
    return {
      available: balance(`owed:${userId}:available`),
      reserved: balance(`owed:${userId}:reserved`),
      paidOut: balance(`paid_out:${userId}`),
    };
  }

  async function payoutReferences(teamId: string) {
    const rows = await db
      .select({ reference: ledgerTransfer.reference })
      .from(ledgerTransfer)
      .where(eq(ledgerTransfer.teamId, teamId));
    return rows
      .map((row) => row.reference)
      .filter((reference) => reference.startsWith("payout_"))
      .sort();
  }

  it("reserves the requested amount and snapshots the member's PayPal payer ID and email", async () => {
    const { teamId, memberId, member } = await payoutTeam();

    const requested = await member.payouts.request({ ...TEAM, amount: "500.00" });

    expect(requested).toMatchObject({
      status: "requested",
      amountMinor: 50_000,
      receiverEmail: PAYPAL_EMAIL,
      receivedMinor: null,
      paidAt: null,
      teamSlug: "acme-studio",
    });
    const [row] = await db.select().from(payoutRequest).where(eq(payoutRequest.id, requested.id));
    expect(row).toMatchObject({ receiverPayerId: PAYER_ID, receiverEmail: PAYPAL_EMAIL });
    expect(await ledgerOf(teamId, memberId)).toEqual({ available: 35_000, reserved: 50_000, paidOut: 0 });
  });

  type Team = Awaited<ReturnType<typeof payoutTeam>>;

  it.each([
    {
      case: "without a PayPal destination",
      requester: async (team: Team) =>
        seedServicesTeamMember(db, { organizationId: team.organizationId, teamId: team.teamId, role: "freelancer" }),
      amount: "10.00",
      error: { code: "PRECONDITION_FAILED", message: "Connect your PayPal account on this page first." },
    },
    {
      case: "without the age confirmation",
      requester: async (team: Team) => {
        const userId = await seedServicesTeamMember(db, { organizationId: team.organizationId, teamId: team.teamId, role: "freelancer" });
        await savePayoutDestination(db, userId, { paypalPayerId: "PAYER2", paypalEmail: "cy@example.com" }, null);
        return userId;
      },
      amount: "10.00",
      error: { code: "PRECONDITION_FAILED", message: "Confirm you are 18 or older first." },
    },
    {
      case: "when PayPal shared no email",
      requester: async (team: Team) => {
        await confirmedDestination(team.memberId, null);
        return team.memberId;
      },
      amount: "10.00",
      error: {
        code: "PRECONDITION_FAILED",
        message: "PayPal did not share your email. Connect your PayPal account again on this page.",
      },
    },
    {
      case: "from a solo seller",
      requester: async (team: Team) => {
        const solo = await seedOrganization(db);
        await seedServicesTeam(db, { organizationId: solo.organizationId, slug: "solo-seller", solo: true });
        return team.memberId;
      },
      teamSlug: "solo-seller",
      amount: "10.00",
      error: { code: "PRECONDITION_FAILED", message: "A solo seller has no payouts to send." },
    },
    {
      case: "over the available balance",
      requester: async (team: Team) => team.memberId,
      amount: "850.01",
      error: { code: "BAD_REQUEST", message: "You can request up to 850.00." },
    },
    {
      // Someone with no earnings in the team, such as a stranger, has nothing to request.
      case: "with no earnings in the team",
      requester: async () => {
        const stranger = await seedUser(db, "Eve");
        await confirmedDestination(stranger);
        return stranger;
      },
      amount: "1.00",
      error: { code: "BAD_REQUEST", message: "You can request up to 0.00." },
    },
    {
      case: "while another request is open",
      requester: async (team: Team) => {
        await team.member.payouts.request({ ...TEAM, amount: "100.00" });
        return team.memberId;
      },
      amount: "100.00",
      error: { code: "CONFLICT", message: "You already have a payout in progress for this team." },
    },
  ])("refuses a request $case", async (row) => {
    const team = await payoutTeam();
    const userId = await row.requester(team);
    const before = await ledgerOf(team.teamId, team.memberId);

    await expect(
      callerFor(userId).payouts.request({ teamSlug: row.teamSlug ?? TEAM.teamSlug, amount: row.amount }),
    ).rejects.toMatchObject(row.error);
    expect(await ledgerOf(team.teamId, team.memberId)).toEqual(before);
  });

  it.each([
    { case: "with the amount received and a transaction ID", received: "807.59", transactionId: "8MC585209K746392H", receivedMinor: 80_759 },
    { case: "defaulting the received amount when it is left out", received: undefined, transactionId: undefined, receivedMinor: 85_000 },
    { case: "treating empty fields as left out", received: "", transactionId: "", receivedMinor: 85_000 },
  ])("marks a request paid $case and pays out the full amount once", async (row) => {
    const { teamId, memberId, admin, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "850.00" });
    const input = { ...TEAM, requestId: id, received: row.received, paypalTransactionId: row.transactionId };

    await expect(admin.payouts.markPaid(input)).resolves.toMatchObject({
      status: "paid",
      amountMinor: 85_000,
      receivedMinor: row.receivedMinor,
      paypalTransactionId: row.transactionId || null,
      decidedAt: expect.any(String),
      paidAt: expect.any(String),
    });
    expect(await ledgerOf(teamId, memberId)).toEqual({ available: 0, reserved: 0, paidOut: 85_000 });

    await expect(admin.payouts.markPaid(input)).rejects.toMatchObject(ALREADY_DECIDED);
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`, `payout_succeeded:${id}`]);
  });

  it.each([
    { case: "more than the amount requested", received: "500.01", message: "Enter at most 500.00, the amount requested." },
    { case: "zero", received: "0", message: "Enter an amount like 25.00." },
    { case: "not an amount", received: "abc", message: "Enter an amount like 25.00." },
  ])("refuses a received amount of $case and posts nothing", async ({ received, message }) => {
    const { teamId, admin, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });

    await expect(admin.payouts.markPaid({ ...TEAM, requestId: id, received })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message,
    });
    await expect(admin.payouts.list(TEAM)).resolves.toMatchObject({ requests: [{ id, status: "requested" }] });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);
  });

  it("refuses a transaction ID that is not letters and digits", async () => {
    const { admin, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });

    await expect(
      admin.payouts.markPaid({ ...TEAM, requestId: id, paypalTransactionId: "8MC5-8520" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("releases the reserved earnings once when an admin rejects the request, and accepts a new one", async () => {
    const { teamId, memberId, admin, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });

    await expect(admin.payouts.reject({ ...TEAM, requestId: id })).resolves.toMatchObject({
      status: "rejected",
      decidedAt: expect.any(String),
      paidAt: null,
    });
    expect(await ledgerOf(teamId, memberId)).toEqual({ available: 85_000, reserved: 0, paidOut: 0 });
    await expect(admin.payouts.reject({ ...TEAM, requestId: id })).rejects.toMatchObject(ALREADY_DECIDED);
    await expect(admin.payouts.markPaid({ ...TEAM, requestId: id })).rejects.toMatchObject(ALREADY_DECIDED);
    expect(await payoutReferences(teamId)).toEqual([`payout_released:${id}`, `payout_requested:${id}`]);

    await expect(member.payouts.request({ ...TEAM, amount: "850.00" })).resolves.toMatchObject({ status: "requested" });
    expect(await ledgerOf(teamId, memberId)).toEqual({ available: 0, reserved: 85_000, paidOut: 0 });
  });

  it("lists the team's requests with the member and PayPal's sandbox send page", async () => {
    const { memberId, admin, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });

    await expect(admin.payouts.list(TEAM)).resolves.toEqual({
      sendMoneyUrl: "https://www.sandbox.paypal.com/myaccount/transfer/homepage/pay",
      requests: [
        expect.objectContaining({
          id,
          userId: memberId,
          memberName: "Ada",
          memberEmail: `${memberId}@example.com`,
          receiverEmail: PAYPAL_EMAIL,
          amountMinor: 50_000,
          status: "requested",
        }),
      ],
    });
  });

  it.each([
    { procedure: "list" as const, call: (caller: ReturnType<typeof callerFor>) => caller.payouts.list(TEAM) },
    {
      procedure: "reject" as const,
      call: (caller: ReturnType<typeof callerFor>, requestId: string) => caller.payouts.reject({ ...TEAM, requestId }),
    },
    {
      procedure: "markPaid" as const,
      call: (caller: ReturnType<typeof callerFor>, requestId: string) => caller.payouts.markPaid({ ...TEAM, requestId }),
    },
  ])("refuses $procedure to a freelancer", async ({ call }) => {
    const { teamId, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });

    await expect(call(member, id)).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only an admin can approve payouts." });
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);
  });

  it("keeps an admin of another team from reaching the request through their own team", async () => {
    const { teamId, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    const other = await seedServicesTeamWithAdmin(db, { slug: "other-studio" });
    const otherAdmin = callerFor(other.userId).payouts;
    const notFound = { code: "NOT_FOUND", message: "Payout request not found." };

    await expect(otherAdmin.reject({ teamSlug: "other-studio", requestId: id })).rejects.toMatchObject(notFound);
    await expect(otherAdmin.markPaid({ teamSlug: "other-studio", requestId: id })).rejects.toMatchObject(notFound);
    expect(await payoutReferences(teamId)).toEqual([`payout_requested:${id}`]);
  });

  it("shows the member their earnings per team and their requests", async () => {
    const { teamId, admin, member } = await payoutTeam();
    const { id } = await member.payouts.request({ ...TEAM, amount: "500.00" });
    await admin.payouts.markPaid({ ...TEAM, requestId: id, received: "475.56" });

    await expect(member.payouts.mine()).resolves.toEqual({
      earnings: [
        {
          teamId,
          teamName: "acme-studio",
          teamSlug: "acme-studio",
          currency: "USD",
          availableMinor: 35_000,
          reservedMinor: 0,
          paidOutMinor: 50_000,
        },
      ],
      requests: [
        expect.objectContaining({
          id,
          status: "paid",
          amountMinor: 50_000,
          receivedMinor: 47_556,
          paidAt: expect.any(String),
          teamName: "acme-studio",
          teamSlug: "acme-studio",
        }),
      ],
    });
  });
});
