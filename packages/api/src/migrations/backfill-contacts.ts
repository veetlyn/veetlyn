import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { lockClientIdentity } from "@jendal-workspace/db/repositories/contacts";
import {
  type ClientIdentityKind,
  clientContact,
  clientIdentity,
  projectClient,
} from "@jendal-workspace/db/schema/contacts";
import { project } from "@jendal-workspace/db/schema/projects";
import { and, asc, eq, notExists, sql } from "drizzle-orm";

import { contactName } from "../use-cases/projects";

// A project's client as the columns held it before client contacts.
export type LegacyClient = {
  projectId: string;
  teamId: string;
  clientEmail: string | null;
  clientDiscordId: string | null;
  clientName: string | null;
};

export type BackfillResult = { contactId: string; created: boolean; conflicts: string[] };

// Moves one project onto a client contact (action catalog design §5.6). Run it in one transaction per project.
// Migrated identities are unverified; the primary row gets link version 0 so links sent before keep working.
export async function backfillProjectContact(tx: Transaction, legacy: LegacyClient): Promise<BackfillResult> {
  const email = legacy.clientEmail?.trim().toLowerCase() || null;
  const discordId = legacy.clientDiscordId?.trim() || null;
  const conflicts: string[] = [];
  if (email) await lockClientIdentity(tx, { teamId: legacy.teamId, key: email });
  if (discordId) await lockClientIdentity(tx, { teamId: legacy.teamId, key: `discord:${discordId}` });

  const migratedHolder = async (kind: ClientIdentityKind, value: string) => {
    const [row] = await tx
      .select({ contactId: clientIdentity.contactId })
      .from(clientIdentity)
      .where(
        and(
          eq(clientIdentity.teamId, legacy.teamId),
          eq(clientIdentity.kind, kind),
          eq(clientIdentity.value, value),
          eq(clientIdentity.source, "migration"),
        ),
      )
      .limit(1);
    return row?.contactId ?? null;
  };
  const addIdentity = (contactId: string, kind: ClientIdentityKind, value: string) =>
    tx.insert(clientIdentity).values({ contactId, teamId: legacy.teamId, kind, value, source: "migration" });

  const [primaryKind, primaryValue] = email ? (["email", email] as const) : (["discord", discordId] as const);
  let contactId = primaryValue ? await migratedHolder(primaryKind, primaryValue) : null;
  const created = contactId === null;
  if (!contactId) {
    const [row] = await tx
      .insert(clientContact)
      .values({ teamId: legacy.teamId, name: contactName(legacy.clientName ?? undefined, email) })
      .returning({ id: clientContact.id });
    if (!row) throw new Error("Insert into client_contact returned no row");
    contactId = row.id;
    if (primaryValue) await addIdentity(contactId, primaryKind, primaryValue);
    else conflicts.push(`project ${legacy.projectId}: no client email or Discord id`);
  }

  if (email && discordId) {
    const holders = await tx
      .select({ contactId: clientIdentity.contactId })
      .from(clientIdentity)
      .where(
        and(
          eq(clientIdentity.teamId, legacy.teamId),
          eq(clientIdentity.kind, "discord"),
          eq(clientIdentity.value, discordId),
        ),
      );
    const heldHere = holders.some((h) => h.contactId === contactId);
    const heldElsewhere = holders.some((h) => h.contactId !== contactId);
    if (heldElsewhere && !heldHere) {
      conflicts.push(`project ${legacy.projectId}: Discord ${discordId} belongs to another contact; contacts kept apart`);
    } else if (!heldHere) {
      await addIdentity(contactId, "discord", discordId);
    }
  }

  await tx.insert(projectClient).values({ projectId: legacy.projectId, contactId, isPrimary: true, linkVersion: 0 });
  return { contactId, created, conflicts };
}

export type BackfillSummary = { projects: number; contactsCreated: number; conflicts: string[] };

// Every project without a contact yet, oldest first, each in its own transaction; running it again does nothing.
export async function backfillLegacyProjects(db: Database): Promise<BackfillSummary> {
  const legacy = await db
    .select({
      projectId: project.id,
      teamId: project.teamId,
      clientEmail: project.clientEmail,
      clientDiscordId: project.clientDiscordId,
      clientName: project.clientName,
    })
    .from(project)
    .where(notExists(db.select({ one: sql`1` }).from(projectClient).where(eq(projectClient.projectId, project.id))))
    .orderBy(asc(project.createdAt), asc(project.id));
  const summary: BackfillSummary = { projects: 0, contactsCreated: 0, conflicts: [] };
  for (const row of legacy) {
    const result = await db.transaction((tx) => backfillProjectContact(tx, row));
    summary.projects += 1;
    if (result.created) summary.contactsCreated += 1;
    summary.conflicts.push(...result.conflicts);
  }
  return summary;
}
