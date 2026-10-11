import { log } from "evlog";

type TeamRef = { id: string; slug: string };

// Runs after the write is committed, so a failure must not fail the request: the cached lookups
// expire within 300 seconds anyway (apps/server/src/services.ts).
export async function dropCachedLookups(
  invalidate: ((team: TeamRef) => void | Promise<void>) | undefined,
  team: TeamRef,
): Promise<void> {
  try {
    await invalidate?.(team);
  } catch (error) {
    log.error({
      action: "seller.cache_invalidate",
      team: { id: team.id },
      error: { name: error instanceof Error ? error.name : "unknown" },
    });
  }
}
