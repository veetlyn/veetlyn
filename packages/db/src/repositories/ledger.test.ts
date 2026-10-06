import { paymentCapturedTransfer, payoutRequestedTransfer, completionTransfer } from "@jendal-workspace/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "../testing/db";
import { ledgerBalance, ledgerEntry, ledgerTransfer } from "../schema/ledger";
import { createPostgresLedger, ledgerBalancesFromEntries } from "./ledger";

describe.skipIf(!hasTestDatabase)("postgres ledger", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("posts a transfer, its entries and the account balances", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    await db.transaction(async (tx) => {
      await createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 50_000, managementFeeMinor: 10_000 }),
      ]);
    });

    const transfers = await db.select().from(ledgerTransfer);
    expect(transfers).toEqual([
      expect.objectContaining({ teamId, kind: "payment_captured", reference: "payment_captured:pay1", projectId }),
    ]);
    const entries = await db.select().from(ledgerEntry);
    expect(entries).toHaveLength(3);
    expect(entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
    const balances = await db.select().from(ledgerBalance);
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: `client_held:${projectId}`, balanceMinor: 50_000 }),
        expect.objectContaining({ account: "team_revenue", balanceMinor: 10_000 }),
        expect.objectContaining({ account: "paypal_clearing", balanceMinor: -60_000 }),
      ]),
    );
    await db.transaction(async (tx) => {
      expect(await ledgerBalancesFromEntries(tx, teamId)).toEqual(
        (await tx.select().from(ledgerBalance)).map((b) => ({
          account: b.account,
          currency: b.currency,
          balanceMinor: b.balanceMinor,
        })),
      );
    });
  });

  it("rejects a reference the team already posted, like the memory ledger", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const transfer = paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 100, managementFeeMinor: 0 });

    await db.transaction((tx) => createPostgresLedger(teamId, tx).post([transfer]));
    await expect(db.transaction((tx) => createPostgresLedger(teamId, tx).post([transfer]))).rejects.toMatchObject({
      name: "LedgerError",
      code: "duplicate_reference",
    });

    // Nothing doubled: the balance still reflects the first posting only.
    expect(await db.select().from(ledgerTransfer)).toHaveLength(1);
    await db.transaction(async (tx) => {
      expect(await createPostgresLedger(teamId, tx).balance(`client_held:${projectId}`, "USD")).toBe(100);
    });
  });

  it("refuses earnings below zero and rolls the transfer back", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    await expect(
      db.transaction((tx) =>
        createPostgresLedger(teamId, tx).post([
          payoutRequestedTransfer({ currency: "USD", payoutRequestId: "po1", freelancerId: "f1", amountMinor: 5 }),
        ]),
      ),
    ).rejects.toMatchObject({ code: "negative_balance" });
    expect(await db.select().from(ledgerTransfer)).toHaveLength(0);
    expect(await db.select().from(ledgerBalance)).toHaveLength(0);
  });

  it("rejects updates and deletes of ledger rows", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    await db.transaction((tx) =>
      createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 100, managementFeeMinor: 0 }),
      ]),
    );
    // drizzle wraps Postgres errors; the trigger message is on the cause.
    const updated = await db.execute(sql`update ledger_entry set amount_minor = 1`).then(
      () => null,
      (error: unknown) => error,
    );
    const deleted = await db.execute(sql`delete from ledger_transfer`).then(
      () => null,
      (error: unknown) => error,
    );
    for (const error of [updated, deleted]) {
      expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(/immutable/);
    }
    // The failed statements rolled back; the rows are unchanged.
    expect(await db.select().from(ledgerEntry)).toHaveLength(2);
  });

  it("serializes concurrent posts to the same account", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    await db.transaction((tx) =>
      createPostgresLedger(teamId, tx).post([
        paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 100, managementFeeMinor: 0 }),
        completionTransfer({ currency: "USD", projectId, freelancerId: "f1", finalPriceMinor: 100, teamCutBps: 0 }),
      ]),
    );

    // Two connections race to reserve 60 of the 100 available; exactly one may succeed.
    const reserve = () =>
      createTestDb().transaction((tx) =>
        createPostgresLedger(teamId, tx).post([
          payoutRequestedTransfer({ currency: "USD", payoutRequestId: `po-${crypto.randomUUID()}`, freelancerId: "f1", amountMinor: 60 }),
        ]),
      );
    const results = await Promise.allSettled([reserve(), reserve()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await db.transaction(async (tx) => {
      expect(await createPostgresLedger(teamId, tx).balance("owed:f1:available", "USD")).toBe(40);
      expect(await createPostgresLedger(teamId, tx).balance("owed:f1:reserved", "USD")).toBe(60);
    });
  });
});
