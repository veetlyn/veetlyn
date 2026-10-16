import type { Database } from "@jendal-workspace/db";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import {
  findClientContactForUser,
  findLinkedContact,
  primaryContactFor,
} from "@jendal-workspace/db/repositories/contacts";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";

import type { Actor } from "../actions/actors";
import { signClientLink, verifyClientLink } from "../client-links";

export type ClientHolder = { token: string; userId?: string } | { projectId: string; userId: string };

export type ClientResolution =
  | { ok: true; actor: Actor; contactId: string }
  | { ok: false; reason: "invalid_link" | "not_a_client" | "team_member" };

// Who is the client of a project (action catalog design §5.4): never a member of its team, whatever link or
// email they hold; otherwise the holder of a valid link, or a signed-in user who is an attached contact
// through a user identity or a verified email.
export async function resolveClient(db: Database, secret: string, holder: ClientHolder): Promise<ClientResolution> {
  const claim = "token" in holder ? await verifyClientLink(secret, holder.token) : null;
  if ("token" in holder && !claim) return { ok: false, reason: "invalid_link" };
  const projectId = claim?.projectId ?? ("projectId" in holder ? holder.projectId : null);
  const project = projectId ? await findProjectById(db, projectId) : null;
  if (!project) return { ok: false, reason: claim ? "invalid_link" : "not_a_client" };
  if (holder.userId && (await servicesTeamRoleFor(db, project.teamId, holder.userId)) !== null) {
    return { ok: false, reason: "team_member" };
  }
  if (claim) {
    const linked = await findLinkedContact(db, claim);
    if (!linked) return { ok: false, reason: "invalid_link" };
    const token = { projectId: linked.projectId, contactId: linked.contactId };
    return { ok: true, contactId: linked.contactId, actor: { kind: "client_link", token } };
  }
  if (!holder.userId) return { ok: false, reason: "not_a_client" };
  const contactId = await findClientContactForUser(db, { projectId: project.id, userId: holder.userId });
  if (!contactId) return { ok: false, reason: "not_a_client" };
  return { ok: true, contactId, actor: { kind: "user", userId: holder.userId } };
}

// The client page path for the project's primary contact, at its current link version.
export async function primaryClientPath(tx: DbExecutor, secret: string, projectId: string): Promise<string> {
  const primary = await primaryContactFor(tx, projectId);
  if (!primary) throw new Error(`Project ${projectId} has no primary contact`);
  const token = await signClientLink(secret, { projectId, contactId: primary.contactId, version: primary.linkVersion });
  return `/c/${token}`;
}
