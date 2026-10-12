import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestDb,
  hasTestDatabase,
  seedPayment,
  seedProject,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "../testing/db";
import {
  completeProjectRefundIfDone,
  createProjectRefund,
  findProjectRefundForProject,
  listRefundParts,
  lockProjectRefund,
  markRefundPartCompleted,
  markRefundPartFailed,
  setRefundPartPayPalRefund,
  upsertRefundPart,
} from "./project-refunds";

describe.skipIf(!hasTestDatabase)("project refunds repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedRefund() {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId, status: "completed" });
    const deposit = await seedPayment(db, { projectId, teamId, kind: "deposit", amountMinor: 30_000 });
    const topUp = await seedPayment(db, { projectId, teamId, kind: "top_up", amountMinor: 10_000 });
    const refund = await createProjectRefund(db, {
      id: `completion-${projectId}`,
      teamId,
      projectId,
      currency: "USD",
      amountMinor: 15_000,
    });
    return { teamId, projectId, deposit, topUp, refund };
  }

  function partFor(refundId: string, payment: { id: string; paypalCaptureId: string | null }, amountMinor: number) {
    return { projectRefundId: refundId, paymentId: payment.id, captureId: payment.paypalCaptureId ?? "", amountMinor };
  }

  it("blocks a second transaction on a locked refund until the first ends", async () => {
    const { refund } = await seedRefund();
    const other = createTestDb();
    try {
      await db.transaction(async (tx) => {
        expect((await lockProjectRefund(tx, refund.id))?.id).toBe(refund.id);
        const blocked = await other
          .transaction(async (otherTx) => {
            await otherTx.execute(sql`set local lock_timeout = '200ms'`);
            return lockProjectRefund(otherTx, refund.id);
          })
          .catch((cause: unknown) => cause);
        expect(blocked).toMatchObject({ cause: { code: "55P03" } });
      });
      expect((await other.transaction((tx) => lockProjectRefund(tx, refund.id)))?.id).toBe(refund.id);
    } finally {
      await other.$client.end();
    }
  });

  it("finds the project's refund", async () => {
    const { projectId, refund } = await seedRefund();
    expect(await findProjectRefundForProject(db, projectId)).toMatchObject({ id: refund.id, status: "requested" });
    expect(await findProjectRefundForProject(db, "missing")).toBeNull();
  });

  it("reuses a payment's part on retry, keeping its first amount", async () => {
    const { refund, deposit } = await seedRefund();
    const first = await upsertRefundPart(db, partFor(refund.id, deposit, 10_000));
    const retried = await upsertRefundPart(db, partFor(refund.id, deposit, 12_000));

    expect(retried).toMatchObject({ id: first.id, amountMinor: 10_000 });
    expect(await listRefundParts(db, refund.id)).toHaveLength(1);
  });

  it("refuses a PayPal refund id on two parts, non-positive amounts and unknown statuses", async () => {
    const { refund, deposit, topUp } = await seedRefund();
    const depositPart = await upsertRefundPart(db, partFor(refund.id, deposit, 10_000));
    const topUpPart = await upsertRefundPart(db, partFor(refund.id, topUp, 5_000));
    await setRefundPartPayPalRefund(db, depositPart.id, { paypalRefundId: "REF-1", status: "pending" });

    const duplicate = await setRefundPartPayPalRefund(db, topUpPart.id, { paypalRefundId: "REF-1", status: "pending" }).catch(
      (cause: unknown) => cause,
    );
    expect(duplicate).toMatchObject({ cause: { code: "23505", constraint_name: "project_refund_part_paypal_refund_id_key" } });

    const balance = await seedPayment(db, { projectId: refund.projectId, teamId: refund.teamId, kind: "balance" });
    const zeroPart = await upsertRefundPart(db, partFor(refund.id, balance, 0)).catch((cause: unknown) => cause);
    expect(zeroPart).toMatchObject({ cause: { code: "23514", constraint_name: "project_refund_part_amount_positive" } });

    const zeroRefund = await createProjectRefund(db, {
      id: "completion-zero",
      teamId: refund.teamId,
      projectId: refund.projectId,
      currency: "USD",
      amountMinor: 0,
    }).catch((cause: unknown) => cause);
    expect(zeroRefund).toMatchObject({ cause: { code: "23514", constraint_name: "project_refund_amount_positive" } });

    const badStatus = await db
      .execute(sql`update project_refund set status = 'sent' where id = ${refund.id}`)
      .catch((cause: unknown) => cause);
    expect(badStatus).toMatchObject({ cause: { code: "23514", constraint_name: "project_refund_status_check" } });

    const badPartStatus = await db
      .execute(sql`update project_refund_part set status = 'issuing' where id = ${depositPart.id}`)
      .catch((cause: unknown) => cause);
    expect(badPartStatus).toMatchObject({ cause: { code: "23514", constraint_name: "project_refund_part_status_check" } });
  });

  it("completes a part once and never moves a completed part back", async () => {
    const { refund, deposit } = await seedRefund();
    const part = await upsertRefundPart(db, partFor(refund.id, deposit, 10_000));
    await setRefundPartPayPalRefund(db, part.id, { paypalRefundId: "REF-1", status: "pending" });

    expect(await markRefundPartCompleted(db, part.id)).toBe(true);
    expect(await markRefundPartCompleted(db, part.id)).toBe(false);
    await markRefundPartFailed(db, part.id, "INSTRUMENT_DECLINED");
    await setRefundPartPayPalRefund(db, part.id, { paypalRefundId: "REF-2", status: "pending" });

    expect(await listRefundParts(db, refund.id)).toMatchObject([
      { id: part.id, status: "completed", paypalRefundId: "REF-1", failureMessage: null },
    ]);
  });

  it("completes the refund only once, when it has parts and all of them are completed", async () => {
    const { refund, deposit, topUp } = await seedRefund();
    const completedAt = new Date("2026-10-12T12:00:00Z");
    expect(await completeProjectRefundIfDone(db, refund.id, completedAt)).toBe(false);

    const depositPart = await upsertRefundPart(db, partFor(refund.id, deposit, 10_000));
    const topUpPart = await upsertRefundPart(db, partFor(refund.id, topUp, 5_000));
    await markRefundPartCompleted(db, depositPart.id);
    expect(await completeProjectRefundIfDone(db, refund.id, completedAt)).toBe(false);

    await markRefundPartCompleted(db, topUpPart.id);
    expect(await completeProjectRefundIfDone(db, refund.id, completedAt)).toBe(true);
    expect(await completeProjectRefundIfDone(db, refund.id, new Date())).toBe(false);
    expect(await findProjectRefundForProject(db, refund.projectId)).toMatchObject({ status: "completed", completedAt });
  });
});
