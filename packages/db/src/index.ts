import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  // fetch_types is off because the schema uses no custom types; it saves a round trip per connection.
  const client = postgres(env.DATABASE_URL || "", { max: 1, fetch_types: false });

  return drizzle({ client, relations });
}

export type Database = ReturnType<typeof createDb>;
