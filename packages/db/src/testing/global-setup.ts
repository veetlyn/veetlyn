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
    // Better Auth's MCP plugin inserts its resource on every auth start when the row is missing, and parallel
    // test files racing on that insert fail it; so the row for the test auth URL (createTestAuth's
    // http://dash.localhost:3001) exists from the start and truncateAll keeps it.
    await client.unsafe(
      `insert into oauth_resource (id, identifier, name, policy_version, created_at, updated_at)
       values ('test-mcp-resource', 'https://api.localhost/mcp', 'https://api.localhost/mcp', 1, now(), now())`,
    );
  } finally {
    await client.end();
  }
}
