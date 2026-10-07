import { sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { requestLimit } from "../schema/limits";

// One atomic upsert: a hit either opens a new window or adds to the current one, so concurrent hits
// from different isolates cannot both slip under the limit.
export async function hitRequestLimit(
  db: DbExecutor,
  input: { key: string; windowMs: number; max: number; now?: number },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const expired = sql`${requestLimit.windowStart} <= ${now - input.windowMs}`;
  const [row] = await db
    .insert(requestLimit)
    .values({ key: input.key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: requestLimit.key,
      set: {
        windowStart: sql`case when ${expired} then ${now} else ${requestLimit.windowStart} end`,
        count: sql`case when ${expired} then 1 else ${requestLimit.count} + 1 end`,
      },
    })
    .returning({ count: requestLimit.count });
  if (!row) throw new Error("Upsert into request_limit returned no row");
  return row.count <= input.max;
}
