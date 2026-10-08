import type { FilePurpose } from "@jendal-workspace/core";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { fileUpload } from "../schema/files";
import { delivery } from "../schema/projects";

export type FileUploadRow = typeof fileUpload.$inferSelect;
export type NewFileUpload = typeof fileUpload.$inferInsert;
export type DeliveryFile = { deliveryId: string; fileName: string; sizeBytes: number; r2Key: string };

export async function insertFileUpload(tx: DbExecutor, values: NewFileUpload): Promise<FileUploadRow> {
  const [row] = await tx.insert(fileUpload).values(values).returning();
  if (!row) throw new Error("Insert into file_upload returned no row");
  return row;
}

export async function findFileUpload(tx: DbExecutor, id: string): Promise<FileUploadRow | null> {
  const [row] = await tx.select().from(fileUpload).where(eq(fileUpload.id, id)).limit(1);
  return row ?? null;
}

// Holds the row until the transaction ends so two requests cannot attach the same upload.
export async function lockFileUploadForAttach(
  tx: DbExecutor,
  input: { id: string; teamId: string; projectId: string; purpose: FilePurpose },
): Promise<FileUploadRow | null> {
  const [row] = await tx
    .select()
    .from(fileUpload)
    .where(
      and(
        eq(fileUpload.id, input.id),
        eq(fileUpload.teamId, input.teamId),
        eq(fileUpload.projectId, input.projectId),
        eq(fileUpload.purpose, input.purpose),
        isNull(fileUpload.attachedAt),
      ),
    )
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function markFileUploadAttached(tx: DbExecutor, id: string): Promise<void> {
  await tx
    .update(fileUpload)
    .set({ attachedAt: sql`now()` })
    .where(eq(fileUpload.id, id));
}

export async function listDeliveryFiles(tx: DbExecutor, deliveryIds: string[]): Promise<DeliveryFile[]> {
  if (deliveryIds.length === 0) return [];
  return tx
    .select({
      deliveryId: delivery.id,
      fileName: fileUpload.fileName,
      sizeBytes: fileUpload.sizeBytes,
      r2Key: fileUpload.r2Key,
    })
    .from(delivery)
    .innerJoin(fileUpload, eq(delivery.fileUploadId, fileUpload.id))
    .where(inArray(delivery.id, deliveryIds));
}

// Uploads never attached are leftovers (the browser stopped, or the delivery failed). Rows are locked with
// SKIP LOCKED so a delivery attaching one right now keeps it, and objects go first so a failure leaves both.
export async function sweepUnattachedUploads(
  db: DbExecutor,
  input: { createdBefore: Date; limit: number },
  deleteObjects: (keys: string[]) => Promise<void>,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: fileUpload.id, r2Key: fileUpload.r2Key })
      .from(fileUpload)
      .where(and(isNull(fileUpload.attachedAt), lt(fileUpload.createdAt, input.createdBefore)))
      .orderBy(asc(fileUpload.createdAt))
      .limit(input.limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return 0;
    await deleteObjects(rows.map((row) => row.r2Key));
    await tx.delete(fileUpload).where(inArray(fileUpload.id, rows.map((row) => row.id)));
    return rows.length;
  });
}
