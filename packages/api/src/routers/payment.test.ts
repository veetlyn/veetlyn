import { createTestAuth, TEST_AUTH_CONFIG } from "@jendal-workspace/auth/testing";
import { ledgerAccounts } from "@jendal-workspace/core";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { ledgerBalance, ledgerTransfer } from "@jendal-workspace/db/schema/ledger";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { payment } from "@jendal-workspace/db/schema/projects";
import {
  createTestDb,
  hasTestDatabase,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink } from "../client-links";
import type { PayPalServices } from "../context";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { applyCaptureFact, type CaptureFact } from "../use-cases/payments";
import { appRouter } from "./index";

const SECRET = TEST_AUTH_CONFIG.BETTER_AUTH_SECRET;
const DAY_MS = 86_400_000;
const ITEMS = [
  { description: "Design", amountMinor: 40_000, extraDays: 0 },
  { description: "Build", amountMinor: 60_000, extraDays: 0 },
];

describe.skipIf(!hasTestDatabase)("payments", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const callerFor = (userId: string | null, paypal?: PayPalServices) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      paypal,
      catalog: createTestCatalogServices(),
    });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  // A $1,000 quote accepted by the client: a pending $600 deposit ($500 + the 10% management fee).
  async function pendingDeposit() {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const { projectId } = await callerFor(userId).project.create({
      teamSlug: "team",
      title: "Website redesign",
      clientEmail: "client@example.com",
    });
    await callerFor(userId).project.assign({ teamSlug: "team", projectId, freelancerId: freelancer });
    const { quoteId } = await callerFor(freelancer).project.addQuote({
      teamSlug: "team",
      projectId,
      items: ITEMS,
      deliveryDays: 14,
    });
    const { paymentId } = await callerFor(null).project.clientAcceptQuote({
      token: await signClientLink(SECRET, projectId),
      quoteId,
    });
    return { userId, teamId, projectId, paymentId };
  }

  async function depositWithOrder() {
    const seeded = await pendingDeposit();
    await db.update(payment).set({ paypalOrderId: "ORDER1" }).where(eq(payment.id, seeded.paymentId));
    return seeded;
  }

  function fact(paymentId: string, overrides: Partial<CaptureFact> = {}): CaptureFact {
    return {
      paymentId,
      orderId: "ORDER1",
      captureId: "CAPTURE1",
      status: "COMPLETED",
      amountMinor: 60_000,
      currency: "USD",
      ...overrides,
    };
  }

  async function paymentRow(paymentId: string) {
    const [row] = await db.select().from(payment).where(eq(payment.id, paymentId));
    return row;
  }

  describe("applyCaptureFact", () => {
    it("applies a completed deposit capture once: payment, ledger, project and outbox", async () => {
      const { projectId, paymentId } = await depositWithOrder();
      const before = Date.now();

      expect(await applyCaptureFact(db, fact(paymentId))).toBe("applied");
      expect(await applyCaptureFact(db, fact(paymentId))).toBe("already_applied");

      expect(await paymentRow(paymentId)).toMatchObject({ status: "captured", paypalCaptureId: "CAPTURE1" });
      const project = await findProjectById(db, projectId);
      expect(project?.status).toBe("in_progress");
      // Services spec §5.2 step 4: the deadline runs from the capture, for the quote's 14 days.
      expect(project?.deadlineAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before + 14 * DAY_MS);
      expect(await db.select().from(ledgerTransfer)).toHaveLength(1);
      expect(await db.select().from(ledgerBalance)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: ledgerAccounts.clientHeld(projectId), balanceMinor: 50_000 }),
          expect.objectContaining({ account: ledgerAccounts.teamRevenue, balanceMinor: 10_000 }),
        ]),
      );
      const events = await db.select().from(outbox).where(eq(outbox.type, "payment.captured"));
      expect(events).toEqual([
        expect.objectContaining({ projectId, data: expect.objectContaining({ paymentId, captureId: "CAPTURE1" }) }),
      ]);
    });

    it("refuses a capture whose amount or currency differs from the payment", async () => {
      const { paymentId } = await depositWithOrder();

      await expect(applyCaptureFact(db, fact(paymentId, { amountMinor: 59_999 }))).rejects.toThrow(/does not match/);
      await expect(applyCaptureFact(db, fact(paymentId, { currency: "EUR" }))).rejects.toThrow(/does not match/);
      expect((await paymentRow(paymentId))?.status).toBe("pending");
    });

    it("records a pending capture, then applies its completion", async () => {
      const { projectId, paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId, { status: "PENDING", amountMinor: null, currency: null }))).toBe(
        "pending",
      );
      expect(await paymentRow(paymentId)).toMatchObject({ status: "pending", paypalCaptureId: "CAPTURE1" });
      expect((await findProjectById(db, projectId))?.status).toBe("awaiting_deposit");

      expect(await applyCaptureFact(db, fact(paymentId))).toBe("applied");
      expect((await findProjectById(db, projectId))?.status).toBe("in_progress");
    });

    it("marks a declined capture failed, once, and leaves the project waiting", async () => {
      const { projectId, paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId, { status: "DECLINED" }))).toBe("failed");
      expect(await applyCaptureFact(db, fact(paymentId, { status: "DECLINED" }))).toBe("already_applied");

      expect(await paymentRow(paymentId)).toMatchObject({ status: "failed", paypalCaptureId: "CAPTURE1" });
      expect((await findProjectById(db, projectId))?.status).toBe("awaiting_deposit");
      expect(await db.select().from(outbox).where(eq(outbox.type, "payment.failed"))).toHaveLength(1);
    });

    it("ignores news about an order the payment no longer uses, unless money moved", async () => {
      const { paymentId } = await depositWithOrder();

      expect(await applyCaptureFact(db, fact(paymentId, { orderId: "OLD", captureId: "C-OLD", status: "DECLINED" }))).toBe(
        "stale",
      );
      await expect(applyCaptureFact(db, fact(paymentId, { orderId: "OLD", captureId: "C-OLD" }))).rejects.toThrow(
        /no longer uses/,
      );
    });

    it("refuses a second capture for the same payment", async () => {
      const { paymentId } = await depositWithOrder();
      await applyCaptureFact(db, fact(paymentId));

      await expect(applyCaptureFact(db, fact(paymentId, { captureId: "CAPTURE2" }))).rejects.toThrow(/already has capture/);
    });
  });
});
