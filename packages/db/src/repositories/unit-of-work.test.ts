import { paymentCapturedTransfer } from "@jendal-workspace/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { outbox } from "../schema/outbox";
import { project } from "../schema/projects";
import { ledgerEntry, ledgerTransfer } from "../schema/ledger";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "../testing/db";
import { ProjectConflictError, ProjectStateError, runInTransaction } from "./unit-of-work";
import { findProjectById } from "./projects";

describe.skipIf(!hasTestDatabase)("project unit of work", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("applies the compare-and-set, the ledger and the outbox in one transaction", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    await runInTransaction(db, async (tx, uow) => {
      const row = await findProjectById(tx, projectId);
      if (!row) throw new Error("missing project");
      await uow.apply({
        project: row,
        set: { status: "awaiting_deposit" },
        transfers: [
          paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 500, managementFeeMinor: 100 }),
        ],
        events: [
          { type: "quote.accepted", data: { quoteId: "q1" } },
          { type: "payment.created", data: { paymentId: "pay1" } },
        ],
      });
    });

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ status: "awaiting_deposit", version: 1 });
    expect(await db.select().from(ledgerTransfer)).toHaveLength(1);
    expect(await db.select().from(ledgerEntry)).toHaveLength(3);
    const events = await db.select().from(outbox);
    expect(events.map((e) => [e.type, e.sequence])).toEqual([
      ["quote.accepted", 1],
      ["payment.created", 2],
    ]);
    expect(events[0]).toMatchObject({ teamId, projectId, data: { quoteId: "q1" } });
  });

  it("rejects a stale version and writes nothing", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    await db.update(project).set({ status: "cancelled", version: 7 }).where(eq(project.id, projectId));

    await expect(
      runInTransaction(db, async (_tx, uow) => {
        // Read at version 0, then someone else changed the row before apply runs.
        const row = { id: projectId, teamId, version: 0, status: "quoting" as const };
        await uow.apply({ project: row, set: { status: "awaiting_deposit" }, events: [{ type: "quote.accepted", data: {} }] });
      }),
    ).rejects.toBeInstanceOf(ProjectConflictError);

    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ status: "cancelled", version: 7 });
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("rolls everything back when any step fails", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    await expect(
      runInTransaction(db, async (tx, uow) => {
        const row = await findProjectById(tx, projectId);
        if (!row) throw new Error("missing project");
        await uow.apply({
          project: row,
          set: { status: "awaiting_deposit" },
          transfers: [
            paymentCapturedTransfer({ currency: "USD", projectId, paymentId: "pay1", quotePartMinor: 500, managementFeeMinor: 0 }),
          ],
          events: [{ type: "payment.created", data: {} }],
        });
        // A later statement fails: the status change, the transfer and the event must all disappear.
        await tx.execute("select * from no_such_table");
      }),
    ).rejects.toThrow();

    expect(await findProjectById(db, projectId)).toMatchObject({ status: "quoting", version: 0 });
    expect(await db.select().from(ledgerTransfer)).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("appends events without bumping the version, so a concurrent change read earlier still applies", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const before = await findProjectById(db, projectId);
    if (!before) throw new Error("missing project");

    await runInTransaction(db, async (_tx, uow) => {
      await uow.apply({ project: before, set: {}, events: [{ type: "project.created", data: {} }] });
    });
    const read = await findProjectById(db, projectId);
    if (!read) throw new Error("missing project");

    await runInTransaction(db, async (_tx, uow) => {
      await uow.appendEvents(read, [{ type: "project.client_added", data: { contactId: "c1" } }]);
    });
    await runInTransaction(db, async (_tx, uow) => {
      await uow.apply({ project: read, set: { status: "awaiting_deposit" }, events: [{ type: "quote.accepted", data: {} }] });
    });

    expect(await findProjectById(db, projectId)).toMatchObject({ status: "awaiting_deposit", version: 2 });
    const events = (await db.select().from(outbox)).sort((a, b) => a.sequence - b.sequence);
    expect(events.map((e) => [e.type, e.sequence])).toEqual([
      ["project.created", 1],
      ["project.client_added", 2],
      ["quote.accepted", 3],
    ]);
  });

  it("refuses to append events to a project that does not exist", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    await expect(
      runInTransaction(db, async (_tx, uow) => {
        await uow.appendEvents({ id: "missing", teamId }, [{ type: "project.client_added", data: {} }]);
      }),
    ).rejects.toBeInstanceOf(ProjectStateError);
  });

  it("requires at least one applied change", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    await seedProject(db, { teamId });
    await expect(runInTransaction(db, async () => "done")).rejects.toBeInstanceOf(ProjectStateError);
  });

  it("numbers outbox events per project without gaps", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const first = await seedProject(db, { teamId, title: "One" });
    const second = await seedProject(db, { teamId, title: "Two" });

    for (const [projectId, types] of [
      [first, ["project.created", "quote.created"]],
      [second, ["project.created"]],
      [first, ["quote.accepted"]],
    ] as const) {
      await runInTransaction(db, async (tx, uow) => {
        const row = await findProjectById(tx, projectId);
        if (!row) throw new Error("missing project");
        await uow.apply({ project: row, set: {}, events: types.map((type) => ({ type, data: {} })) });
      });
    }

    const events = (await db.select().from(outbox)).sort((a, b) =>
      a.projectId === b.projectId ? a.sequence - b.sequence : a.projectId === first ? -1 : 1,
    );
    expect(events.map((e) => [e.projectId === first ? "first" : "second", e.sequence])).toEqual([
      ["first", 1],
      ["first", 2],
      ["first", 3],
      ["second", 1],
    ]);
  });
});
