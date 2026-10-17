// Moves every project whose client still lives in the legacy project columns onto a client contact.
// Run it once per database after the client contact migration: DATABASE_URL=... bun scripts/a2-backfill-contacts.ts
// It is safe to run again: projects that already have a contact are skipped.
import { z } from "zod";

import { backfillLegacyProjects } from "../packages/api/src/migrations/backfill-contacts";
import { createDb } from "../packages/db/src/index";

const env = z.object({ DATABASE_URL: z.string().min(1, "Set DATABASE_URL to the database to backfill.") }).parse(process.env);
const db = createDb({ DATABASE_URL: env.DATABASE_URL });

try {
  const summary = await backfillLegacyProjects(db);
  console.log(`Projects moved onto contacts: ${summary.projects}`);
  console.log(`Contacts created: ${summary.contactsCreated}`);
  console.log(summary.conflicts.length === 0 ? "Conflicts: none" : `Conflicts (${summary.conflicts.length}):`);
  for (const conflict of summary.conflicts) console.log(`- ${conflict}`);
} finally {
  await db.$client.end();
}
