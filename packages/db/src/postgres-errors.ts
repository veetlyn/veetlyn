import { z } from "zod";

const postgresErrorSchema = z.object({
  code: z.string(),
  constraint_name: z.string().optional().catch(undefined),
});

export type PostgresErrorFields = z.infer<typeof postgresErrorSchema>;

// Drizzle wraps the postgres.js error in `cause`, and only that wrapped error carries the SQLSTATE fields.
const drizzleErrorSchema = z.object({ cause: postgresErrorSchema });

export function postgresError(cause: unknown): PostgresErrorFields | null {
  const parsed = drizzleErrorSchema.safeParse(cause);
  return parsed.success ? parsed.data.cause : null;
}
