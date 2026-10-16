import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import type { DbExecutor, Transaction } from "../executor";
import { user } from "../schema/auth";
import { clientContact, clientIdentity, projectClient } from "../schema/contacts";

export type LinkedContact = { projectId: string; contactId: string; teamId: string };

// A client link is valid while its contact is attached to the project at the same link version. A link
// without a contact stands for the primary contact.
export async function findLinkedContact(
  tx: DbExecutor,
  claim: { projectId: string; contactId: string | null; version: number },
): Promise<LinkedContact | null> {
  const contactId = claim.contactId === null ? null : await survivingContactId(tx, claim.contactId);
  const [row] = await tx
    .select({ projectId: projectClient.projectId, contactId: projectClient.contactId, teamId: clientContact.teamId })
    .from(projectClient)
    .innerJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .where(
      and(
        eq(projectClient.projectId, claim.projectId),
        contactId === null ? eq(projectClient.isPrimary, true) : eq(projectClient.contactId, contactId),
        eq(projectClient.linkVersion, claim.version),
      ),
    )
    .limit(1);
  return row ?? null;
}

const MAX_MERGE_HOPS = 8;

// A merged contact's links speak for the contact it was merged into.
async function survivingContactId(tx: DbExecutor, contactId: string): Promise<string> {
  let current = contactId;
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop += 1) {
    const [row] = await tx
      .select({ mergedIntoId: clientContact.mergedIntoId })
      .from(clientContact)
      .where(eq(clientContact.id, current))
      .limit(1);
    if (!row?.mergedIntoId) return current;
    current = row.mergedIntoId;
  }
  return current;
}

// Serialises everything that matches, creates or verifies a contact by this email in this team.
export async function lockContactEmail(tx: DbExecutor, input: { teamId: string; email: string }): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.teamId} || ':' || ${input.email}))`);
}

// Opening a link emailed to the contact proves its email addresses (design §5.2). When another contact of the
// team already holds one of them verified, this contact is the same client: it merges into that one, which
// is returned.
export async function verifyContactEmail(
  tx: Transaction,
  contact: { contactId: string; teamId: string },
  now: Date = new Date(),
): Promise<string> {
  const unverified = await tx
    .select({ id: clientIdentity.id, value: clientIdentity.value })
    .from(clientIdentity)
    .where(
      and(
        eq(clientIdentity.contactId, contact.contactId),
        eq(clientIdentity.kind, "email"),
        isNull(clientIdentity.verifiedAt),
      ),
    );
  for (const identity of unverified) {
    await lockContactEmail(tx, { teamId: contact.teamId, email: identity.value });
    const [holder] = await tx
      .select({ contactId: clientIdentity.contactId })
      .from(clientIdentity)
      .where(
        and(
          eq(clientIdentity.teamId, contact.teamId),
          eq(clientIdentity.kind, "email"),
          eq(clientIdentity.value, identity.value),
          isNotNull(clientIdentity.verifiedAt),
          ne(clientIdentity.contactId, contact.contactId),
        ),
      )
      .limit(1);
    if (holder) {
      await mergeContacts(tx, { fromId: contact.contactId, intoId: holder.contactId });
      return holder.contactId;
    }
    await tx.update(clientIdentity).set({ verifiedAt: now }).where(eq(clientIdentity.id, identity.id));
  }
  return contact.contactId;
}

// Moves the contact's projects and identities onto another contact of the same team and leaves an alias
// behind, so links already sent keep working.
export async function mergeContacts(tx: Transaction, input: { fromId: string; intoId: string }): Promise<void> {
  const { fromId, intoId } = input;
  const rows = await tx.select().from(projectClient).where(eq(projectClient.contactId, fromId));
  for (const row of rows) {
    const [existing] = await tx
      .select({ isPrimary: projectClient.isPrimary })
      .from(projectClient)
      .where(and(eq(projectClient.projectId, row.projectId), eq(projectClient.contactId, intoId)))
      .limit(1);
    if (!existing) {
      await tx
        .update(projectClient)
        .set({ contactId: intoId })
        .where(and(eq(projectClient.projectId, row.projectId), eq(projectClient.contactId, fromId)));
      continue;
    }
    await tx
      .delete(projectClient)
      .where(and(eq(projectClient.projectId, row.projectId), eq(projectClient.contactId, fromId)));
    if (row.isPrimary) {
      await tx
        .update(projectClient)
        .set({ isPrimary: true })
        .where(and(eq(projectClient.projectId, row.projectId), eq(projectClient.contactId, intoId)));
    }
  }
  const held = await tx
    .select({ kind: clientIdentity.kind, value: clientIdentity.value })
    .from(clientIdentity)
    .where(eq(clientIdentity.contactId, intoId));
  const identities = await tx.select().from(clientIdentity).where(eq(clientIdentity.contactId, fromId));
  for (const identity of identities) {
    const duplicate = held.some((h) => h.kind === identity.kind && h.value === identity.value);
    await (duplicate
      ? tx.delete(clientIdentity).where(eq(clientIdentity.id, identity.id))
      : tx.update(clientIdentity).set({ contactId: intoId }).where(eq(clientIdentity.id, identity.id)));
  }
  await tx.update(clientContact).set({ mergedIntoId: intoId }).where(eq(clientContact.id, fromId));
}

// The attached contact a signed-in user is: through a user identity, or through a verified email identity
// equal to the user's own verified email.
export async function findClientContactForUser(
  tx: DbExecutor,
  input: { projectId: string; userId: string },
): Promise<string | null> {
  const [account] = await tx
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!account) return null;
  const byUser = and(eq(clientIdentity.kind, "user"), eq(clientIdentity.value, input.userId));
  const byEmail = account.emailVerified
    ? and(
        eq(clientIdentity.kind, "email"),
        eq(clientIdentity.value, account.email.toLowerCase()),
        isNotNull(clientIdentity.verifiedAt),
      )
    : undefined;
  const [row] = await tx
    .select({ contactId: projectClient.contactId })
    .from(projectClient)
    .innerJoin(clientIdentity, eq(clientIdentity.contactId, projectClient.contactId))
    .where(and(eq(projectClient.projectId, input.projectId), byEmail ? or(byUser, byEmail) : byUser))
    .limit(1);
  return row?.contactId ?? null;
}

export async function primaryContactFor(
  tx: DbExecutor,
  projectId: string,
): Promise<{ contactId: string; name: string; linkVersion: number } | null> {
  const [row] = await tx
    .select({ contactId: projectClient.contactId, name: clientContact.name, linkVersion: projectClient.linkVersion })
    .from(projectClient)
    .innerJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .where(and(eq(projectClient.projectId, projectId), eq(projectClient.isPrimary, true)))
    .limit(1);
  return row ?? null;
}

export async function projectContactLink(
  tx: DbExecutor,
  input: { projectId: string; contactId: string },
): Promise<{ linkVersion: number } | null> {
  const [row] = await tx
    .select({ linkVersion: projectClient.linkVersion })
    .from(projectClient)
    .where(and(eq(projectClient.projectId, input.projectId), eq(projectClient.contactId, input.contactId)))
    .limit(1);
  return row ?? null;
}
