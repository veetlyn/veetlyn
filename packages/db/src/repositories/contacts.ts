import { OPEN_PROJECT_STATUSES } from "@jendal-workspace/core";
import { and, countDistinct, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import type { DbExecutor, Transaction } from "../executor";
import { user } from "../schema/auth";
import {
  type ClientIdentityKind,
  type ClientIdentitySource,
  clientContact,
  clientIdentity,
  projectClient,
} from "../schema/contacts";
import { project } from "../schema/projects";

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

// Matches the team's contact by email, else by Discord id, or creates one; the identities it lacks are added
// unverified. A request from the public form never joins a contact whose matching identity is verified: the
// requester has proved nothing, so they get a contact of their own (merged later if the address proves out).
export async function matchOrCreateContact(
  tx: Transaction,
  input: {
    teamId: string;
    email: string | null;
    discordId: string | null;
    name: string;
    source: ClientIdentitySource;
  },
): Promise<string> {
  const email = input.email?.trim().toLowerCase() || null;
  const discordId = input.discordId?.trim() || null;
  if (!email && !discordId) throw new Error("A contact needs an email or a Discord id");
  if (email) await lockClientIdentity(tx, { teamId: input.teamId, key: email });
  if (discordId) await lockClientIdentity(tx, { teamId: input.teamId, key: `discord:${discordId}` });
  const match = async (kind: ClientIdentityKind, value: string) => {
    const [row] = await tx
      .select({ contactId: clientIdentity.contactId })
      .from(clientIdentity)
      .where(
        and(
          eq(clientIdentity.teamId, input.teamId),
          eq(clientIdentity.kind, kind),
          eq(clientIdentity.value, value),
          input.source === "request" ? isNull(clientIdentity.verifiedAt) : undefined,
        ),
      )
      .orderBy(sql`${clientIdentity.verifiedAt} is null`)
      .limit(1);
    return row?.contactId ?? null;
  };
  let contactId = (email && (await match("email", email))) || (discordId && (await match("discord", discordId))) || null;
  if (!contactId) {
    const [created] = await tx
      .insert(clientContact)
      .values({ teamId: input.teamId, name: input.name })
      .returning({ id: clientContact.id });
    if (!created) throw new Error("Insert into client_contact returned no row");
    contactId = created.id;
  }
  const held = await tx
    .select({ kind: clientIdentity.kind, value: clientIdentity.value })
    .from(clientIdentity)
    .where(eq(clientIdentity.contactId, contactId));
  const wanted: [ClientIdentityKind, string | null][] = [
    ["email", email],
    ["discord", discordId],
  ];
  for (const [kind, value] of wanted) {
    if (!value || held.some((h) => h.kind === kind && h.value === value)) continue;
    await tx.insert(clientIdentity).values({ contactId, teamId: input.teamId, kind, value, source: input.source });
  }
  return contactId;
}

export async function attachContact(
  tx: DbExecutor,
  input: { projectId: string; contactId: string; isPrimary: boolean; addedById: string | null },
): Promise<void> {
  await tx.insert(projectClient).values(input);
}

// The "three open requests per email per team" limit (sellers design §4.2), through the projects' contacts.
export async function countOpenRequestsForEmail(
  tx: DbExecutor,
  input: { teamId: string; email: string },
): Promise<number> {
  const [row] = await tx
    .select({ count: countDistinct(project.id) })
    .from(project)
    .innerJoin(projectClient, eq(projectClient.projectId, project.id))
    .innerJoin(clientIdentity, eq(clientIdentity.contactId, projectClient.contactId))
    .where(
      and(
        eq(project.teamId, input.teamId),
        eq(project.source, "web"),
        inArray(project.status, OPEN_PROJECT_STATUSES),
        eq(clientIdentity.kind, "email"),
        eq(clientIdentity.value, input.email),
      ),
    );
  return row?.count ?? 0;
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

// Serialises everything that matches, creates or verifies a contact by this email (or `discord:{id}`) in
// this team. The request form takes the same lock, so its open-request count cannot race either.
export async function lockClientIdentity(tx: DbExecutor, input: { teamId: string; key: string }): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.teamId} || ':' || ${input.key}))`);
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
    await lockClientIdentity(tx, { teamId: contact.teamId, key: identity.value });
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
