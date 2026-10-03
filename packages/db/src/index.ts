import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  const client = postgres(env.DATABASE_URL || "", { max: 1 });

  return drizzle({ client, relations });
}

export type Database = ReturnType<typeof createDb>;
