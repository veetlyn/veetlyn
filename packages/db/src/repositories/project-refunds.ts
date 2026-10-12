import type { ProjectRefundPartStatus, ProjectRefundStatus } from "@jendal-workspace/core";
import { and, asc, desc, eq, exists, isNull, ne, notExists, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

import type { DbExecutor, Transaction } from "../executor";
import { projectRefund, projectRefundPart } from "../schema/project-refunds";

export type ProjectRefundRow = typeof projectRefund.$inferSelect;
export type ProjectRefundPartRow = typeof projectRefundPart.$inferSelect;
export type NewProjectRefund = Pick<
  typeof projectRefund.$inferInsert,
  "id" | "teamId" | "projectId" | "currency" | "amountMinor"
>;
export type NewProjectRefundPart = Pick<
  typeof projectRefundPart.$inferInsert,
  "projectRefundId" | "paymentId" | "captureId" | "amountMinor"
>;

export async function createProjectRefund(tx: DbExecutor, values: NewProjectRefund): Promise<ProjectRefundRow> {
  const [row] = await tx.insert(projectRefund).values(values).returning();
  if (!row) throw new Error("Insert into project_refund returned no row");
  return row;
}

export async function findProjectRefundForProject(tx: DbExecutor, projectId: string): Promise<ProjectRefundRow | null> {
  const [row] = await tx
    .select()
    .from(projectRefund)
    .where(eq(projectRefund.projectId, projectId))
    .orderBy(desc(projectRefund.createdAt), desc(projectRefund.id))
    .limit(1);
  return row ?? null;
}

// Holds the refund until the transaction ends, so two admin clicks cannot issue the same parts twice.
export async function lockProjectRefund(tx: Transaction, id: string): Promise<ProjectRefundRow | null> {
  const [row] = await tx.select().from(projectRefund).where(eq(projectRefund.id, id)).limit(1).for("update");
  return row ?? null;
}

export async function setProjectRefundStatus(
  tx: DbExecutor,
  id: string,
  status: Exclude<ProjectRefundStatus, "completed">,
): Promise<void> {
  await tx.update(projectRefund).set({ status }).where(eq(projectRefund.id, id));
}

// Returns whether this call completed the refund: it has parts and every one is completed, and it was not
// completed already (the capture answer and the webhook may both confirm the last part).
export async function completeProjectRefundIfDone(tx: DbExecutor, id: string, completedAt: Date): Promise<boolean> {
  const rows = await tx
    .update(projectRefund)
    .set({ status: "completed", completedAt })
    .where(
      and(
        eq(projectRefund.id, id),
        ne(projectRefund.status, "completed"),
        exists(tx.select({ id: projectRefundPart.id }).from(projectRefundPart).where(eq(projectRefundPart.projectRefundId, id))),
        notExists(
          tx
            .select({ id: projectRefundPart.id })
            .from(projectRefundPart)
            .where(and(eq(projectRefundPart.projectRefundId, id), ne(projectRefundPart.status, "completed"))),
        ),
      ),
    )
    .returning({ id: projectRefund.id });
  return rows.length > 0;
}

export async function listRefundParts(tx: DbExecutor, projectRefundId: string): Promise<ProjectRefundPartRow[]> {
  return tx
    .select()
    .from(projectRefundPart)
    .where(eq(projectRefundPart.projectRefundId, projectRefundId))
    .orderBy(asc(projectRefundPart.createdAt), asc(projectRefundPart.id));
}

// A retry reuses the part already created for the payment, with its original amount, so its PayPal request id
// (and therefore PayPal's idempotency) stays the same.
export async function upsertRefundPart(tx: DbExecutor, values: NewProjectRefundPart): Promise<ProjectRefundPartRow> {
  await tx
    .insert(projectRefundPart)
    .values(values)
    .onConflictDoNothing({ target: [projectRefundPart.projectRefundId, projectRefundPart.paymentId] });
  const [row] = await tx
    .select()
    .from(projectRefundPart)
    .where(
      and(eq(projectRefundPart.projectRefundId, values.projectRefundId), eq(projectRefundPart.paymentId, values.paymentId)),
    )
    .limit(1);
  if (!row) throw new Error("Upsert into project_refund_part returned no row");
  return row;
}

export async function findRefundPartByPayPalRefundId(
  tx: DbExecutor,
  paypalRefundId: string,
): Promise<ProjectRefundPartRow | null> {
  const [row] = await tx
    .select()
    .from(projectRefundPart)
    .where(eq(projectRefundPart.paypalRefundId, paypalRefundId))
    .limit(1);
  return row ?? null;
}

// Records PayPal's answer to the capture refund call. A completed part is never moved back.
export async function setRefundPartPayPalRefund(
  tx: DbExecutor,
  partId: string,
  input: { paypalRefundId: string; status: Exclude<ProjectRefundPartStatus, "failed"> },
): Promise<void> {
  await tx
    .update(projectRefundPart)
    .set({ paypalRefundId: input.paypalRefundId, status: input.status, failureMessage: null })
    .where(and(eq(projectRefundPart.id, partId), ne(projectRefundPart.status, "completed")));
}

// Returns whether this call completed the part; the capture answer and the webhook may both report it.
export async function markRefundPartCompleted(tx: DbExecutor, partId: string): Promise<boolean> {
  const rows = await tx
    .update(projectRefundPart)
    .set({ status: "completed", failureMessage: null })
    .where(and(eq(projectRefundPart.id, partId), ne(projectRefundPart.status, "completed")))
    .returning({ id: projectRefundPart.id });
  return rows.length > 0;
}

// A retry sends every part that is not completed again, so the failed ones are back in flight. A part with an
// uncertain attempt is never failed, and stays as it is.
export async function resendFailedRefundParts(tx: DbExecutor, projectRefundId: string): Promise<void> {
  await tx
    .update(projectRefundPart)
    .set({ status: "pending", failureMessage: null })
    .where(
      and(
        eq(projectRefundPart.projectRefundId, projectRefundId),
        eq(projectRefundPart.status, "failed"),
        isNull(projectRefundPart.uncertainAt),
      ),
    );
}

// PayPal's outcome is unknown: the part keeps its status, and the first uncertain time is kept, since PayPal
// replays a request id only for a limited time from the first attempt.
export async function markRefundPartUncertain(
  tx: DbExecutor,
  partId: string,
  input: { at: Date; failureMessage: string; paypalRefundId: string | null },
): Promise<void> {
  const set: PgUpdateSetSource<typeof projectRefundPart> = {
    uncertainAt: sql`coalesce(${projectRefundPart.uncertainAt}, ${input.at.toISOString()}::timestamptz)`,
    failureMessage: input.failureMessage,
  };
  if (input.paypalRefundId !== null) set.paypalRefundId = input.paypalRefundId;
  await tx
    .update(projectRefundPart)
    .set(set)
    .where(and(eq(projectRefundPart.id, partId), ne(projectRefundPart.status, "completed")));
}

// Parts never sent (no PayPal refund id, no uncertain attempt) cannot be refunds PayPal holds, so they need not
// hold the webhook back once sending stopped; a retry resends them.
export async function failUnsentRefundParts(tx: DbExecutor, projectRefundId: string, failureMessage: string): Promise<void> {
  await tx
    .update(projectRefundPart)
    .set({ status: "failed", failureMessage })
    .where(
      and(
        eq(projectRefundPart.projectRefundId, projectRefundId),
        eq(projectRefundPart.status, "pending"),
        isNull(projectRefundPart.paypalRefundId),
        isNull(projectRefundPart.uncertainAt),
      ),
    );
}

export async function markRefundPartFailed(tx: DbExecutor, partId: string, failureMessage: string): Promise<void> {
  await tx
    .update(projectRefundPart)
    .set({ status: "failed", failureMessage })
    .where(and(eq(projectRefundPart.id, partId), ne(projectRefundPart.status, "completed")));
}
