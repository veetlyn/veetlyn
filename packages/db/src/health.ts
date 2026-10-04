import { sql } from "drizzle-orm";

import type { Database } from "./index";

export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
