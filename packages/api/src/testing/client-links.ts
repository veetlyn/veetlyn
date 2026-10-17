import type { Database } from "@jendal-workspace/db";
import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";

import { signClientLink } from "../client-links";

// The link the project's primary contact was sent. A project without one gets a well-signed link that
// names no attached contact.
export async function clientTokenFor(db: Database, secret: string, projectId: string): Promise<string> {
  const primary = await primaryContactFor(db, projectId);
  return signClientLink(secret, {
    projectId,
    contactId: primary?.contactId ?? crypto.randomUUID(),
    version: primary?.linkVersion ?? 1,
  });
}
