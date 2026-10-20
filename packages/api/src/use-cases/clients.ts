import { canStartProject } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import {
  attachContact,
  bumpLinkVersion,
  contactAccountIds,
  contactWithIdentities,
  detachContact,
  findClientContactForUser,
  findLinkedContact,
  lockProjectClients,
  matchOrCreateContact,
  primaryContactFor,
  type ProjectClientRow,
  projectContactLink,
  recordLinkEmail,
  verifyContactEmail,
} from "@jendal-workspace/db/repositories/contacts";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import type { UnitOfWork } from "@jendal-workspace/db/repositories/unit-of-work";
import { team as teamTable } from "@jendal-workspace/db/schema/organization";
import { clientLinkEmail } from "@jendal-workspace/email";
import { eq } from "drizzle-orm";

import type { Actor } from "../actions/actors";
import { ActionError } from "../actions/errors";
import { type LinkSecretSource, linkSecret, signClientLink, verifyClientLink } from "../client-links";
import type { EmailServices } from "../context";
import { contactName, fail, type ProjectActor, runProjectTransaction } from "./projects";

export type ClientHolder = { token: string; userId?: string } | { projectId: string; userId: string };

export type ClientResolution =
  | { ok: true; actor: Actor; contactId: string }
  | { ok: false; reason: "invalid_link" | "not_a_client" }
  | { ok: false; reason: "team_member"; projectId: string };

// Who is the client of a project (action catalog design §5.4): never a member of its team, whatever link or
// email they hold; otherwise the holder of a valid link, or a signed-in user who is an attached contact
// through a user identity or a verified email.
const TEAM_MEMBER = Symbol("team member");

async function namesTeamMember(tx: DbExecutor, teamId: string, contactId: string): Promise<boolean> {
  for (const userId of await contactAccountIds(tx, contactId)) {
    if ((await servicesTeamRoleFor(tx, teamId, userId)) !== null) return true;
  }
  return false;
}

export async function resolveClient(db: Database, secret: string, holder: ClientHolder): Promise<ClientResolution> {
  const claim = "token" in holder ? await verifyClientLink(secret, holder.token) : null;
  if ("token" in holder && !claim) return { ok: false, reason: "invalid_link" };
  const projectId = claim?.projectId ?? ("projectId" in holder ? holder.projectId : null);
  const project = projectId ? await findProjectById(db, projectId) : null;
  if (!project) return { ok: false, reason: claim ? "invalid_link" : "not_a_client" };
  if (holder.userId && (await servicesTeamRoleFor(db, project.teamId, holder.userId)) !== null) {
    return { ok: false, reason: "team_member", projectId: project.id };
  }
  if (claim) {
    // The client page runs on the site host, where the dashboard's session never arrives: a member holding a link
    // looks signed out, so a contact naming a member's account is refused before anything is verified.
    const contactId = await db.transaction(async (tx) => {
      const linked = await findLinkedContact(tx, claim);
      if (!linked) return null;
      if (await namesTeamMember(tx, project.teamId, linked.contactId)) return TEAM_MEMBER;
      return verifyContactEmail(tx, linked);
    });
    if (contactId === TEAM_MEMBER) return { ok: false, reason: "team_member", projectId: project.id };
    if (!contactId) return { ok: false, reason: "invalid_link" };
    return { ok: true, contactId, actor: { kind: "client_link", token: { projectId: project.id, contactId } } };
  }
  if (!holder.userId) return { ok: false, reason: "not_a_client" };
  const contactId = await findClientContactForUser(db, { projectId: project.id, userId: holder.userId });
  if (!contactId) return { ok: false, reason: "not_a_client" };
  return {
    ok: true,
    contactId,
    actor: { kind: "client_account", userId: holder.userId, token: { projectId: project.id, contactId } },
  };
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function requireClientManager(actor: ProjectActor): void {
  if (!canStartProject(actor.role)) fail("FORBIDDEN", "Only admins and managers change a project's clients.");
}

async function requireTeamProject(tx: DbExecutor, actor: ProjectActor, projectId: string): Promise<ProjectRow> {
  const row = await findProjectById(tx, projectId);
  // Another team's project is reported exactly like a missing one.
  if (!row || row.teamId !== actor.teamId) fail("NOT_FOUND", "Project not found.");
  return row;
}

function requireAttached(rows: ProjectClientRow[], contactId: string): ProjectClientRow {
  const row = rows.find((r) => r.contactId === contactId);
  if (!row) fail("NOT_FOUND", "That client is not on this project.");
  return row;
}

// Design §5.5: a new contact with an unverified email, matched or created under the (team, email) lock. Who the
// clients are is not a state change, so the version stays and quotes or deliveries in flight do not conflict.
export async function addProjectClient(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; email: string; name: string },
): Promise<{ contactId: string }> {
  requireClientManager(actor);
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail("BAD_REQUEST", "That email address does not look right.");
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    const attached = await lockProjectClients(tx, row.id);
    const name = contactName(input.name, email);
    const contactId = await matchOrCreateContact(tx, {
      teamId: row.teamId,
      email,
      discordId: null,
      name,
      source: "typed",
    });
    if (attached.some((r) => r.contactId === contactId)) fail("BAD_REQUEST", "That client is already on this project.");
    await attachContact(tx, { projectId: row.id, contactId, isPrimary: false, addedById: actor.actorId });
    await uow.appendEvents(row, [{ type: "project.client_added", data: { contactId, clientName: name } }]);
    return { contactId };
  });
}

export async function removeProjectClient(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; contactId: string },
): Promise<null> {
  requireClientManager(actor);
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    const attached = await lockProjectClients(tx, row.id);
    const removed = requireAttached(attached, input.contactId);
    const rest = attached.filter((r) => r.contactId !== input.contactId);
    const next = rest[0];
    if (!next) fail("BAD_REQUEST", "A project keeps at least one client.");
    await detachContact(tx, {
      projectId: row.id,
      contactId: input.contactId,
      newPrimaryId: removed.isPrimary ? next.contactId : null,
    });
    await uow.appendEvents(row, [{ type: "project.client_removed", data: { contactId: input.contactId } }]);
  });
  return null;
}

type LinkDeps = { db: Database; auth: LinkSecretSource; email?: EmailServices };

// Signs the contact's current link, records where it goes and sends it; the sending happens after the commit.
async function sendClientLink(
  deps: LinkDeps,
  actor: ProjectActor,
  input: { projectId: string; contactId: string; email?: string },
  change: (tx: Transaction, uow: UnitOfWork, project: ProjectRow) => Promise<void>,
): Promise<{ sentTo: string }> {
  requireClientManager(actor);
  const emailServices = deps.email;
  if (!emailServices) fail("BAD_REQUEST", "Email is not available right now.");
  const secret = linkSecret(deps.auth);
  const prepared = await runProjectTransaction(deps.db, async (tx, uow) => {
    const project = await requireTeamProject(tx, actor, input.projectId);
    requireAttached(await lockProjectClients(tx, project.id), input.contactId);
    const contact = await contactWithIdentities(tx, { teamId: project.teamId, contactId: input.contactId });
    if (!contact) fail("NOT_FOUND", "That client is not on this project.");
    const emails = contact.identities.filter((i) => i.kind === "email").map((i) => i.value);
    const wanted = input.email?.trim().toLowerCase();
    const to = wanted ? emails.find((e) => e === wanted) : emails[0];
    if (!to) fail("BAD_REQUEST", "This client has no email address to send the link to.");
    await change(tx, uow, project);
    const link = await projectContactLink(tx, { projectId: project.id, contactId: contact.id });
    if (!link) throw new Error("The contact left the project inside its own lock");
    await recordLinkEmail(tx, { projectId: project.id, contactId: contact.id, email: to });
    await uow.appendEvents(project, [
      { type: "project.client_link_sent", data: { contactId: contact.id, linkVersion: link.linkVersion } },
    ]);
    const [team] = await tx.select({ name: teamTable.name }).from(teamTable).where(eq(teamTable.id, project.teamId));
    const token = await signClientLink(secret, { projectId: project.id, contactId: contact.id, version: link.linkVersion });
    return { to, token, clientName: contact.name, teamName: team?.name ?? "", projectTitle: project.title };
  });
  const content = clientLinkEmail({
    clientName: prepared.clientName,
    teamName: prepared.teamName,
    projectTitle: prepared.projectTitle,
    url: `${emailServices.siteOrigin}/c/${prepared.token}`,
  });
  try {
    await emailServices.mailer.send({
      sender: "invoices",
      onBehalfOf: prepared.teamName,
      tag: "client-link",
      to: prepared.to,
      ...content,
    });
  } catch (error) {
    await emailServices.onError?.(error, { kind: "client-link", to: prepared.to });
    throw new ActionError("internal", "We could not send the email. Try again in a moment.", { expose: true });
  }
  return { sentTo: prepared.to };
}

// "Email the client link": the team never sees the link itself (design §5.3).
export function emailClientLink(
  deps: LinkDeps,
  actor: ProjectActor,
  input: { projectId: string; contactId: string; email?: string },
): Promise<{ sentTo: string }> {
  return sendClientLink(deps, actor, input, async () => {});
}

// A new link version revokes every link the contact was sent for this project, then the new one is emailed.
export function reissueClientLink(
  deps: LinkDeps,
  actor: ProjectActor,
  input: { projectId: string; contactId: string; email?: string },
): Promise<{ sentTo: string }> {
  return sendClientLink(deps, actor, input, async (tx, uow, project) => {
    const version = await bumpLinkVersion(tx, { projectId: project.id, contactId: input.contactId });
    await uow.appendEvents(project, [
      { type: "project.client_link_reissued", data: { contactId: input.contactId, linkVersion: version } },
    ]);
  });
}

// The client page path for the project's primary contact, at its current link version.
export async function primaryClientPath(tx: DbExecutor, secret: string, projectId: string): Promise<string> {
  const primary = await primaryContactFor(tx, projectId);
  if (!primary) throw new Error(`Project ${projectId} has no primary contact`);
  const token = await signClientLink(secret, { projectId, contactId: primary.contactId, version: primary.linkVersion });
  return `/c/${token}`;
}
