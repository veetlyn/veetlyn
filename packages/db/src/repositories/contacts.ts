import { OPEN_PROJECT_STATUSES } from "@jendal-workspace/core";
import { and, asc, countDistinct, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

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

export type LinkedContact = {
  projectId: string;
  contactId: string;
  teamId: string;
  // The address this link was emailed to, when the link names its contact (legacy links prove nothing).
  provedEmail: string | null;
};

// A client link is valid while its contact (or a contact merged into the one now attached) is attached to the
// project at the same link version; a link without a contact stands for the primary contact. The row is locked
// so a reissue or a removal cannot interleave with the resolution and the verification that follows it.
export async function findLinkedContact(
  tx: Transaction,
  claim: { projectId: string; contactId: string | null; version: number },
): Promise<LinkedContact | null> {
  const [row] = await tx
    .select({
      projectId: projectClient.projectId,
      contactId: projectClient.contactId,
      teamId: clientContact.teamId,
      linkEmail: projectClient.linkEmail,
    })
    .from(projectClient)
    .innerJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .innerJoin(project, and(eq(project.id, projectClient.projectId), eq(project.teamId, clientContact.teamId)))
    .where(
      and(
        eq(projectClient.projectId, claim.projectId),
        claim.contactId === null
          ? eq(projectClient.isPrimary, true)
          : or(
              eq(projectClient.contactId, claim.contactId),
              sql`${claim.contactId} = any(${projectClient.linkAliases})`,
            ),
        eq(projectClient.linkVersion, claim.version),
      ),
    )
    .limit(1)
    .for("update", { of: projectClient });
  if (!row) return null;
  return {
    projectId: row.projectId,
    contactId: row.contactId,
    teamId: row.teamId,
    provedEmail: claim.contactId === null ? null : row.linkEmail,
  };
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
  input: {
    projectId: string;
    contactId: string;
    isPrimary: boolean;
    addedById: string | null;
    // Set when the server emails this contact's link as part of attaching it.
    linkEmail?: string | null;
  },
): Promise<void> {
  await tx.insert(projectClient).values({ ...input, linkEmailedAt: input.linkEmail ? new Date() : null });
}

export type ProjectClientRow = typeof projectClient.$inferSelect;

// Locks the project's client rows; every change to who the clients are, and every link resolution, takes it.
export async function lockProjectClients(tx: Transaction, projectId: string): Promise<ProjectClientRow[]> {
  return tx
    .select()
    .from(projectClient)
    .where(eq(projectClient.projectId, projectId))
    .orderBy(asc(projectClient.addedAt), asc(projectClient.contactId))
    .for("update");
}

export async function detachContact(
  tx: Transaction,
  input: { projectId: string; contactId: string; newPrimaryId: string | null },
): Promise<void> {
  await tx
    .delete(projectClient)
    .where(and(eq(projectClient.projectId, input.projectId), eq(projectClient.contactId, input.contactId)));
  if (input.newPrimaryId) {
    await tx
      .update(projectClient)
      .set({ isPrimary: true })
      .where(and(eq(projectClient.projectId, input.projectId), eq(projectClient.contactId, input.newPrimaryId)));
  }
}

// A new link version revokes every link sent before, including those of contacts merged into this one.
export async function bumpLinkVersion(
  tx: Transaction,
  input: { projectId: string; contactId: string },
): Promise<number> {
  const [row] = await tx
    .update(projectClient)
    .set({ linkVersion: sql`${projectClient.linkVersion} + 1`, linkEmail: null, linkEmailedAt: null, linkAliases: [] })
    .where(and(eq(projectClient.projectId, input.projectId), eq(projectClient.contactId, input.contactId)))
    .returning({ linkVersion: projectClient.linkVersion });
  if (!row) throw new Error("The contact is not on the project");
  return row.linkVersion;
}

// Records where this link version was emailed. A version sent to two different addresses proves neither.
export async function recordLinkEmail(
  tx: Transaction,
  input: { projectId: string; contactId: string; email: string },
): Promise<void> {
  const where = and(eq(projectClient.projectId, input.projectId), eq(projectClient.contactId, input.contactId));
  const [row] = await tx
    .select({ linkEmail: projectClient.linkEmail, linkEmailedAt: projectClient.linkEmailedAt })
    .from(projectClient)
    .where(where)
    .limit(1);
  if (!row) throw new Error("The contact is not on the project");
  const linkEmail = row.linkEmailedAt === null || row.linkEmail === input.email ? input.email : null;
  await tx.update(projectClient).set({ linkEmail, linkEmailedAt: new Date() }).where(where);
}

export type ProjectContactView = {
  id: string;
  name: string;
  isPrimary: boolean;
  identities: { kind: ClientIdentityKind; value: string; verified: boolean }[];
};

// The primary contact first, then in the order they were added.
export async function listProjectContacts(tx: DbExecutor, projectId: string): Promise<ProjectContactView[]> {
  const rows = await tx
    .select({
      id: clientContact.id,
      name: clientContact.name,
      isPrimary: projectClient.isPrimary,
      kind: clientIdentity.kind,
      value: clientIdentity.value,
      verifiedAt: clientIdentity.verifiedAt,
    })
    .from(projectClient)
    .innerJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .leftJoin(clientIdentity, eq(clientIdentity.contactId, clientContact.id))
    .where(eq(projectClient.projectId, projectId))
    .orderBy(
      desc(projectClient.isPrimary),
      asc(projectClient.addedAt),
      asc(clientContact.id),
      asc(clientIdentity.kind),
      asc(clientIdentity.value),
    );
  const contacts = new Map<string, ProjectContactView>();
  for (const row of rows) {
    let contact = contacts.get(row.id);
    if (!contact) {
      contact = { id: row.id, name: row.name, isPrimary: row.isPrimary, identities: [] };
      contacts.set(row.id, contact);
    }
    if (row.kind && row.value !== null) {
      contact.identities.push({ kind: row.kind, value: row.value, verified: row.verifiedAt !== null });
    }
  }
  return [...contacts.values()];
}

// Each of the team's projects' primary contact name, by project id.
export async function primaryContactNames(tx: DbExecutor, teamId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ projectId: projectClient.projectId, name: clientContact.name })
    .from(projectClient)
    .innerJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .where(and(eq(clientContact.teamId, teamId), eq(projectClient.isPrimary, true)));
  return new Map(rows.map((r) => [r.projectId, r.name]));
}

export async function contactWithIdentities(
  tx: DbExecutor,
  input: { teamId: string; contactId: string },
): Promise<{ id: string; name: string; identities: { kind: ClientIdentityKind; value: string; verified: boolean }[] } | null> {
  const [contact] = await tx
    .select({ id: clientContact.id, name: clientContact.name })
    .from(clientContact)
    .where(and(eq(clientContact.id, input.contactId), eq(clientContact.teamId, input.teamId)))
    .limit(1);
  if (!contact) return null;
  const identities = await tx
    .select({ kind: clientIdentity.kind, value: clientIdentity.value, verifiedAt: clientIdentity.verifiedAt })
    .from(clientIdentity)
    .where(eq(clientIdentity.contactId, contact.id))
    .orderBy(sql`${clientIdentity.verifiedAt} is null`, asc(clientIdentity.kind), asc(clientIdentity.value));
  return {
    ...contact,
    identities: identities.map((i) => ({ kind: i.kind, value: i.value, verified: i.verifiedAt !== null })),
  };
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
        eq(clientIdentity.value, input.email.trim().toLowerCase()),
      ),
    );
  return row?.count ?? 0;
}

// Serialises everything that matches, creates or verifies a contact by this email (or `discord:{id}`) in
// this team. The request form takes the same lock, so its open-request count cannot race either.
export async function lockClientIdentity(tx: DbExecutor, input: { teamId: string; key: string }): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.teamId} || ':' || ${input.key}))`);
}

// Opening a link proves the one address the server emailed it to (design §5.2), and nothing else: not the
// contact's other addresses, and nothing at all for a link the team could have seen. When another contact of
// the team already holds that address verified, this contact is the same client and merges into that one,
// which is returned.
export async function verifyContactEmail(tx: Transaction, linked: LinkedContact, now: Date = new Date()): Promise<string> {
  if (!linked.provedEmail) return linked.contactId;
  const email = linked.provedEmail;
  await lockClientIdentity(tx, { teamId: linked.teamId, key: email });
  const [own] = await tx
    .select({ id: clientIdentity.id, verifiedAt: clientIdentity.verifiedAt })
    .from(clientIdentity)
    .where(
      and(
        eq(clientIdentity.contactId, linked.contactId),
        eq(clientIdentity.kind, "email"),
        eq(clientIdentity.value, email),
      ),
    )
    .limit(1);
  if (!own || own.verifiedAt) return linked.contactId;
  const [holder] = await tx
    .select({ contactId: clientIdentity.contactId })
    .from(clientIdentity)
    .where(
      and(
        eq(clientIdentity.teamId, linked.teamId),
        eq(clientIdentity.kind, "email"),
        eq(clientIdentity.value, email),
        isNotNull(clientIdentity.verifiedAt),
        ne(clientIdentity.contactId, linked.contactId),
      ),
    )
    .limit(1);
  if (holder) {
    await mergeContacts(tx, { teamId: linked.teamId, fromId: linked.contactId, intoId: holder.contactId });
    return holder.contactId;
  }
  await tx.update(clientIdentity).set({ verifiedAt: now }).where(eq(clientIdentity.id, own.id));
  return linked.contactId;
}

// Moves a contact's projects and identities onto another contact of the same team, then deletes it. A moved
// project row remembers the merged contact, so links it was sent keep opening that project at that version;
// where the survivor was already on the project, the merged contact's links for it simply stop working.
async function mergeContacts(tx: Transaction, input: { teamId: string; fromId: string; intoId: string }): Promise<void> {
  const { fromId, intoId } = input;
  const [from, into] = await Promise.all(
    [fromId, intoId].map((id) =>
      tx
        .select({ teamId: clientContact.teamId })
        .from(clientContact)
        .where(eq(clientContact.id, id))
        .limit(1)
        .then((rows) => rows[0]),
    ),
  );
  if (from?.teamId !== input.teamId || into?.teamId !== input.teamId) {
    throw new Error("Contacts merge only within one team");
  }
  const rows = await tx.select().from(projectClient).where(eq(projectClient.contactId, fromId));
  for (const row of rows) {
    const [existing] = await tx
      .select({ isPrimary: projectClient.isPrimary })
      .from(projectClient)
      .where(and(eq(projectClient.projectId, row.projectId), eq(projectClient.contactId, intoId)))
      .limit(1);
    const fromRow = and(eq(projectClient.projectId, row.projectId), eq(projectClient.contactId, fromId));
    if (!existing) {
      await tx
        .update(projectClient)
        .set({ contactId: intoId, linkAliases: [...row.linkAliases, fromId] })
        .where(fromRow);
      continue;
    }
    await tx.delete(projectClient).where(fromRow);
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
  await tx.delete(clientContact).where(eq(clientContact.id, fromId));
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
