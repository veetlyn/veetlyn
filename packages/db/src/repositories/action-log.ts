import { lt } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { actionLog } from "../schema/action-log";

export type ActionLogRow = typeof actionLog.$inferInsert;

export async function insertActionLog(db: DbExecutor, row: ActionLogRow): Promise<void> {
  await db.insert(actionLog).values(row);
}

export async function deleteActionLogBefore(db: DbExecutor, before: Date): Promise<number> {
  const rows = await db.delete(actionLog).where(lt(actionLog.createdAt, before)).returning({ id: actionLog.id });
  return rows.length;
}
