// URL comes from node:url because the global URL resolves to the Workers type, which fileURLToPath rejects.
import { fileURLToPath, URL } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;

  const databaseName = new URL(url).pathname.slice(1);
  if (!databaseName.includes("test")) {
    throw new Error(
      `Refusing to reset "${databaseName}": TEST_DATABASE_URL must point to a database whose name contains "test".`,
    );
  }

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(
      "drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;",
    );
    await migrate(drizzle({ client }), {
      migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    });
  } finally {
    await client.end();
  }
}
