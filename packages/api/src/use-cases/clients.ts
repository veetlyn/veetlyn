import type { Database } from "@jendal-workspace/db";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import { findLinkedContact, type LinkedContact, primaryContactFor } from "@jendal-workspace/db/repositories/contacts";

import { signClientLink, verifyClientLink } from "../client-links";

// The contact a client link speaks for, or null when the link is forged, revoked or names a removed contact.
export async function resolveClientLink(db: Database, secret: string, token: string): Promise<LinkedContact | null> {
  const claim = await verifyClientLink(secret, token);
  if (!claim) return null;
  return findLinkedContact(db, claim);
}

// The client page path for the project's primary contact, at its current link version.
export async function primaryClientPath(tx: DbExecutor, secret: string, projectId: string): Promise<string> {
  const primary = await primaryContactFor(tx, projectId);
  if (!primary) throw new Error(`Project ${projectId} has no primary contact`);
  const token = await signClientLink(secret, { projectId, contactId: primary.contactId, version: primary.linkVersion });
  return `/c/${token}`;
}
