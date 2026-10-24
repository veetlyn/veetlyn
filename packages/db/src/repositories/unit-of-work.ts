import type { JsonObject, LedgerTransferDraft, OutboxEventType, ProjectStatus } from "@jendal-workspace/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { ProjectRelations, Transaction } from "../executor";
import { createPostgresLedger } from "./ledger";
import { outbox } from "../schema/outbox";
import { project } from "../schema/projects";

export class ProjectConflictError extends Error {
  constructor() {
    super("The project changed; refresh and try again.");
    this.name = "ProjectConflictError";
  }
}

export class ProjectStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectStateError";
  }
}

export type OutboxEventInput = { type: OutboxEventType; data: JsonObject };
export type OutboxRow = typeof outbox.$inferSelect;

export type ProjectRef = { id: string; teamId: string; version: number; status: ProjectStatus };

export type ProjectStateChange = {
  // The row read in this transaction; the compare-and-set matches its version and status.
  project: ProjectRef;
  set: Partial<typeof project.$inferInsert>;
  transfers?: readonly LedgerTransferDraft[];
  events: readonly OutboxEventInput[];
};

export type UnitOfWork = {
  // One §6.1 state change: status+version compare-and-set, ledger writes, outbox events, all or nothing.
  // Returns the inserted outbox rows so the caller can fan out deliveries and enqueue them.
  apply(change: ProjectStateChange): Promise<OutboxRow[]>;
  // Events about the project that are not a state change (who its clients are): the row lock orders them
  // against concurrent work, but the version stays, so quotes and deliveries in flight do not conflict.
  appendEvents(project: Pick<ProjectRef, "id" | "teamId">, events: readonly OutboxEventInput[]): Promise<OutboxRow[]>;
  // Team-scoped events with no project (payouts, disputes, store orders): numbered per team so
  // subscribers can still order them. Returns the inserted rows for delivery fan-out.
  appendTeamOutbox(team: Pick<ProjectRef, "teamId">, events: readonly OutboxEventInput[]): Promise<OutboxRow[]>;
};

// Services spec §6.1: one database transaction per state change. The callback receives the transaction
// for its own reads and writes and the unit of work for the compare-and-set + ledger + outbox part.
// Throwing (or tx.rollback()) rolls back everything.
export async function runInTransaction<T>(
  db: PostgresJsDatabase<ProjectRelations>,
  run: (tx: Transaction, uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    let applied = 0;
    const uow: UnitOfWork = {
      async apply({ project: ref, set, transfers = [], events }) {
        const [updated] = await tx
          .update(project)
          .set({ ...set, version: ref.version + 1, updatedAt: new Date() })
          .where(and(eq(project.id, ref.id), eq(project.version, ref.version), eq(project.status, ref.status)))
          .returning({ id: project.id });
        if (!updated) throw new ProjectConflictError();
        applied += 1;
        if (transfers.length > 0) await createPostgresLedger(ref.teamId, tx).post(transfers);
        return appendOutbox(tx, ref, events);
      },
      async appendEvents(ref, events) {
        const [locked] = await tx.select({ id: project.id }).from(project).where(eq(project.id, ref.id)).for("update");
        if (!locked) throw new ProjectStateError("The project does not exist");
        applied += 1;
        return appendOutbox(tx, ref, events);
      },
      async appendTeamOutbox(ref, events) {
        applied += 1;
        return appendTeamOutboxRows(tx, ref, events);
      },
    };
    const result = await run(tx, uow);
    if (applied === 0) throw new ProjectStateError("The transaction applied no change to a project");
    return result;
  });
}

async function appendOutbox(
  tx: Transaction,
  ref: Pick<ProjectRef, "id" | "teamId">,
  events: readonly OutboxEventInput[],
): Promise<OutboxRow[]> {
  const inserted: OutboxRow[] = [];
  for (const event of events) {
    const [row] = await tx
      .select({ next: sql<number>`coalesce(max(${outbox.sequence}), 0) + 1`.mapWith(Number) })
      .from(outbox)
      .where(eq(outbox.projectId, ref.id));
    const [written] = await tx
      .insert(outbox)
      .values({
        teamId: ref.teamId,
        type: event.type,
        projectId: ref.id,
        sequence: row?.next ?? 1,
        data: event.data,
      })
      .returning();
    if (written) inserted.push(written);
  }
  return inserted;
}

async function appendTeamOutboxRows(
  tx: Transaction,
  ref: Pick<ProjectRef, "teamId">,
  events: readonly OutboxEventInput[],
): Promise<OutboxRow[]> {
  const inserted: OutboxRow[] = [];
  for (const event of events) {
    const [row] = await tx
      .select({ next: sql<number>`coalesce(max(${outbox.sequence}), 0) + 1`.mapWith(Number) })
      .from(outbox)
      .where(and(eq(outbox.teamId, ref.teamId), isNull(outbox.projectId)));
    const [written] = await tx
      .insert(outbox)
      .values({ teamId: ref.teamId, type: event.type, projectId: null, sequence: row?.next ?? 1, data: event.data })
      .returning();
    if (written) inserted.push(written);
  }
  return inserted;
}
