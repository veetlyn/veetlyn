import { and, eq, isNotNull, or } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { user } from "../schema/auth";
import { clientContact, clientIdentity, projectClient } from "../schema/contacts";

export type LinkedContact = { projectId: string; contactId: string; teamId: string };

// A client link is valid while its contact is attached to the project at the same link version. A link
// without a contact stands for the primary contact.
export async function findLinkedContact(
  tx: DbExecutor,
  claim: { projectId: string; contactId: string | null; version: number },
): Promise<LinkedContact | null> {
  const [row] = await tx
    .select({ projectId: projectClient.projectId, contactId: projectClient.contactId, teamId: clientContact.teamId })
    .from(projectClient)
    .innerJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .where(
      and(
        eq(projectClient.projectId, claim.projectId),
        claim.contactId === null ? eq(projectClient.isPrimary, true) : eq(projectClient.contactId, claim.contactId),
        eq(projectClient.linkVersion, claim.version),
      ),
    )
    .limit(1);
  return row ?? null;
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
