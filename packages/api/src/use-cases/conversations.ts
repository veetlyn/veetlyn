import {
  type AccessFacts,
  clientMessageSpace,
  type ConversationAccess,
  type ConversationMessageKind,
  type ConversationSpace,
  type ConversationSurface,
  conversationAccess,
  isProjectStaff,
  MAX_DECLINE_REASON,
  MAX_MESSAGE_LENGTH,
  maskContactDetails,
  readableSpaces,
  transitionProject,
  transitionRefusalMessage,
  type Viewer,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import {
  type ConversationMessageWithAuthor,
  findMessage,
  getShortlist,
  insertEventMessage,
  insertMessage,
  listMessages,
  memberDepartmentIds,
  type NewConversationMessage,
  offeringDepartments,
  replaceMemberDepartments,
  replaceShortlist,
  shortlistsFor,
} from "@jendal-workspace/db/repositories/conversations";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { getServicesTeamSettings, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import type { UnitOfWork } from "@jendal-workspace/db/repositories/unit-of-work";
import { armProjectSchedule } from "./projects";
import { conversationMessage } from "@jendal-workspace/db/schema/conversations";
import { project } from "@jendal-workspace/db/schema/projects";
import { servicesOffering } from "@jendal-workspace/db/schema/services-catalog";
import { and, eq, sql } from "drizzle-orm";

import { fail, type ProjectActor, runProjectTransaction } from "./projects";

// Who posts: a team member acting in their team, or the project's client through one of their contacts.
export type ConversationAuthor = { kind: "member"; actor: ProjectActor } | { kind: "client"; contactId: string };
// Who reads: reading needs no contact, since every contact of the project reads the same conversation.
export type ConversationReader = { kind: "member"; actor: ProjectActor } | { kind: "client" };

const NOT_FOUND = "Project not found.";

async function offeringDepartment(db: DbExecutor, offeringId: string | null): Promise<string | null> {
  if (!offeringId) return null;
  const [row] = await db
    .select({ departmentId: servicesOffering.departmentId })
    .from(servicesOffering)
    .where(eq(servicesOffering.id, offeringId))
    .limit(1);
  return row?.departmentId ?? null;
}

// The audience facts of many projects of one team at once, for lists.
export async function accessFactsForRows(
  db: Database,
  teamId: string,
  rows: readonly ProjectRow[],
): Promise<Map<string, AccessFacts>> {
  const offeringIds = [...new Set(rows.flatMap((r) => (r.offeringId ? [r.offeringId] : [])))];
  const [settings, departments, shortlists] = await Promise.all([
    getServicesTeamSettings(db, teamId),
    offeringDepartments(db, offeringIds),
    shortlistsFor(db, rows.filter((r) => r.status === "quoting").map((r) => r.id)),
  ]);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        quotingMode: settings?.quotingMode ?? "assigned",
        departmentId: row.offeringId ? (departments.get(row.offeringId) ?? null) : null,
        shortlist: shortlists.get(row.id) ?? [],
        status: row.status,
        assignedFreelancerId: row.assignedFreelancerId,
      },
    ]),
  );
}

export async function accessFactsFor(db: DbExecutor, row: ProjectRow): Promise<AccessFacts> {
  const [settings, departmentId, shortlist] = await Promise.all([
    getServicesTeamSettings(db, row.teamId),
    offeringDepartment(db, row.offeringId),
    getShortlist(db, row.id),
  ]);
  return {
    quotingMode: settings?.quotingMode ?? "assigned",
    departmentId,
    shortlist,
    status: row.status,
    assignedFreelancerId: row.assignedFreelancerId,
  };
}

export async function viewerFor(db: Database, author: ConversationReader): Promise<Viewer> {
  if (author.kind === "client") return { kind: "client" };
  const { actor } = author;
  const departmentIds = await memberDepartmentIds(db, { teamId: actor.teamId, userId: actor.actorId });
  return { kind: "member", role: actor.role, userId: actor.actorId, departmentIds };
}

// The access a viewer has to one project; a member of another team is a stranger to it.
export async function accessTo(db: Database, author: ConversationReader, row: ProjectRow): Promise<ConversationAccess> {
  if (author.kind === "member" && author.actor.teamId !== row.teamId) return { read: [], write: [] };
  return conversationAccess(await viewerFor(db, author), await accessFactsFor(db, row));
}

function closedReason(row: ProjectRow, space: ConversationSpace): string {
  if (row.status === "declined") return "The team declined this request, so it takes no new messages.";
  if (row.status === "expired") return "This request expired, so it takes no new messages.";
  if (space === "request" && row.status !== "quoting") {
    return "The request closed when a quote was accepted; write in the project instead.";
  }
  return "This project is closed to new messages.";
}

// Messages posted while quoting are shown masked to everyone, in both spaces and from every surface, and stay
// masked afterwards (design §6). Events are the platform's own words and are never masked.
function messageBodies(row: Pick<ProjectRow, "status">, body: string): Pick<NewConversationMessage, "body" | "shownBody"> {
  if (row.status !== "quoting") return { body, shownBody: body };
  return { body, shownBody: maskContactDetails(body).shown };
}

// Placement and masking were decided from the status read before the transaction; a quote accepted meanwhile
// would put the message in a closed space, so the row is locked and the status checked again.
async function requireUnchangedStatus(tx: Transaction, row: ProjectRow): Promise<void> {
  const [locked] = await tx.select({ status: project.status }).from(project).where(eq(project.id, row.id)).for("update");
  if (locked?.status !== row.status) fail("BAD_REQUEST", "The project changed while you wrote. Reload and send it again.");
}

async function postInTransaction(
  tx: Transaction,
  uow: UnitOfWork,
  row: ProjectRow,
  message: Omit<NewConversationMessage, "projectId" | "body" | "shownBody"> & { body: string },
): Promise<{ messageId: string; space: ConversationSpace }> {
  const created = await insertMessage(tx, { ...message, projectId: row.id, ...messageBodies(row, message.body) });
  // The delivery pipeline sends it on to email, webhooks and Discord.
  await uow.appendEvents(row, [
    { type: "message.posted", data: { messageId: created.id, space: created.space, kind: created.kind } },
  ]);
  if (message.authorKind === "member" && (row.status === "quoting" || row.status === "in_progress")) {
    await armProjectSchedule(tx, row, new Date(), { memberActivityAt: new Date() });
  }
  if (message.authorKind === "client" && row.status === "delivered") {
    await armProjectSchedule(tx, row, new Date(), { clientActivity: true });
  }
  return { messageId: created.id, space: created.space };
}

function cleanBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) fail("BAD_REQUEST", "Write a message first.");
  if (trimmed.length > MAX_MESSAGE_LENGTH) fail("BAD_REQUEST", `Keep messages under ${MAX_MESSAGE_LENGTH} characters.`);
  return trimmed;
}

const MESSAGE_RATE_LIMIT = 10;
const MESSAGE_RATE_WINDOW_MS = 60_000;

// One author's flood, whichever surface it arrives from, stops here instead of being relayed.
// Only people's messages count (surface is set); the platform's event rows never do.
async function requireWithinMessageRate(db: Database, author: ConversationAuthor, projectId: string): Promise<void> {
  const since = new Date(Date.now() - MESSAGE_RATE_WINDOW_MS).toISOString();
  const byAuthor =
    author.kind === "client" ? eq(conversationMessage.authorContactId, author.contactId) : eq(conversationMessage.authorUserId, author.actor.actorId);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(conversationMessage)
    .where(
      and(
        eq(conversationMessage.projectId, projectId),
        byAuthor,
        sql`${conversationMessage.createdAt} >= ${since}`,
        sql`${conversationMessage.surface} is not null`,
      ),
    );
  if ((row?.count ?? 0) >= MESSAGE_RATE_LIMIT) {
    fail("TOO_MANY_REQUESTS", "You are sending messages too quickly. Wait a moment and try again.");
  }
}

async function requireReadable(db: Database, author: ConversationAuthor, projectId: string) {
  const row = await findProjectById(db, projectId);
  if (!row) fail("NOT_FOUND", NOT_FOUND);
  const access = await accessTo(db, author, row);
  if (access.read.length === 0) fail("NOT_FOUND", NOT_FOUND);
  return { row, access };
}

// Conversations design §4: freelancers write in the request space, staff in either, the accepted freelancer in
// the project space; the client writes once and the platform places the message.
export async function postConversationMessage(
  db: Database,
  author: ConversationAuthor,
  input: { projectId: string; kind: "text" | "question"; body: string; space?: ConversationSpace; teamOnly?: boolean },
  surface: ConversationSurface,
): Promise<{ messageId: string; space: ConversationSpace }> {
  const body = cleanBody(input.body);
  const { row, access } = await requireReadable(db, author, input.projectId);
  if (author.kind === "client" && input.kind === "question") fail("BAD_REQUEST", "Questions come from the team.");
  const space: ConversationSpace =
    author.kind === "client"
      ? clientMessageSpace(row.status, input.teamOnly ?? false)
      : (input.space ?? (access.write.includes("request") ? "request" : "project"));
  // The client's request-space reply is a relay: the client writes the project space and the freelancers read it.
  const writable = author.kind === "client" ? access.write.includes("project") : access.write.includes(space);
  if (!writable) fail("BAD_REQUEST", closedReason(row, space));
  // Backlog row 43: at most 10 messages per author per minute, whichever surface they come from.
  await requireWithinMessageRate(db, author, input.projectId);
  const posted = await runProjectTransaction(db, async (tx, uow) => {
    await requireUnchangedStatus(tx, row);
    return postInTransaction(tx, uow, row, {
      space,
      kind: input.kind,
      body,
      surface,
      ...(author.kind === "client"
        ? { authorKind: "client", authorContactId: author.contactId }
        : { authorKind: "member", authorUserId: author.actor.actorId }),
    });
  });
  return posted;
}

// The client's answer sits next to its question: in the request space while the team is still quoting a
// request-space question, else in the project space.
export async function answerQuestion(
  db: Database,
  client: { contactId: string },
  input: { projectId: string; questionId: string; body: string },
  surface: ConversationSurface,
): Promise<{ messageId: string; space: ConversationSpace }> {
  const body = cleanBody(input.body);
  const author: ConversationAuthor = { kind: "client", contactId: client.contactId };
  const { row, access } = await requireReadable(db, author, input.projectId);
  const question = await findMessage(db, { projectId: row.id, messageId: input.questionId });
  if (!question || question.kind !== "question") fail("BAD_REQUEST", "That question is not on this project.");
  if (!access.write.includes("project")) fail("BAD_REQUEST", closedReason(row, "project"));
  const space = question.space === "project" ? "project" : clientMessageSpace(row.status, false);
  return runProjectTransaction(db, async (tx, uow) => {
    await requireUnchangedStatus(tx, row);
    return postInTransaction(tx, uow, row, {
      space,
      kind: "answer",
      body,
      replyToId: question.id,
      surface,
      authorKind: "client",
      authorContactId: client.contactId,
    });
  });
}

// Conversations design §5: staff decline a request they will not quote, with a reason the client reads.
export async function declineRequest(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; reason: string },
): Promise<null> {
  if (!isProjectStaff(actor.role)) fail("FORBIDDEN", "Only admins and managers decline requests.");
  const reason = input.reason.trim();
  if (!reason) fail("BAD_REQUEST", "Say why you are declining; the client reads it.");
  if (reason.length > MAX_DECLINE_REASON) fail("BAD_REQUEST", `Keep the reason under ${MAX_DECLINE_REASON} characters.`);
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await findProjectById(tx, input.projectId);
    if (!row || row.teamId !== actor.teamId) fail("NOT_FOUND", NOT_FOUND);
    const result = transitionProject(row.status, "decline");
    if (!result.ok) fail("BAD_REQUEST", "Only a request that is still being quoted can be declined.");
    await uow.apply({
      project: row,
      set: { status: result.to, declinedReason: reason, declinedAt: new Date() },
      events: [{ type: "project.declined", data: { reason } }],
    });
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: `The team declined this request: ${reason}`,
      refType: "decline",
      refId: row.id,
    });
    await armProjectSchedule(tx, { ...row, status: result.to }, new Date());
  });
  return null;
}

async function requireStaffProject(db: Database, actor: ProjectActor, projectId: string): Promise<ProjectRow> {
  if (!isProjectStaff(actor.role)) fail("FORBIDDEN", "Only admins and managers choose who sees a request.");
  const row = await findProjectById(db, projectId);
  if (!row || row.teamId !== actor.teamId) fail("NOT_FOUND", NOT_FOUND);
  return row;
}

async function requireMembers(db: Database, teamId: string, userIds: readonly string[]): Promise<void> {
  for (const userId of userIds) {
    if ((await servicesTeamRoleFor(db, teamId, userId)) === null) {
      fail("BAD_REQUEST", "Everyone on the shortlist must be a member of this team.");
    }
  }
}

// A shortlist replaces the department rule while the request is open; an empty one restores the rule.
export async function setRequestShortlist(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; userIds: string[] },
): Promise<null> {
  const row = await requireStaffProject(db, actor, input.projectId);
  if (row.status !== "quoting") fail("BAD_REQUEST", transitionRefusalMessage("not_allowed_in_status"));
  const userIds = [...new Set(input.userIds)];
  await requireMembers(db, actor.teamId, userIds);
  await db.transaction((tx) => replaceShortlist(tx, { projectId: row.id, userIds }));
  return null;
}

// Team admins say which departments a member answers requests for; removing one takes the member off its open
// requests at once, and their earlier messages stay (design §8).
export async function setMemberDepartments(
  db: Database,
  actor: ProjectActor,
  input: { userId: string; departmentIds: string[] },
): Promise<{ departmentIds: string[] }> {
  if (actor.role !== "admin") fail("FORBIDDEN", "Only team admins set members' departments.");
  if ((await servicesTeamRoleFor(db, actor.teamId, input.userId)) === null) {
    fail("BAD_REQUEST", "That person is not a member of this team.");
  }
  const wanted = [...new Set(input.departmentIds)];
  const departmentIds = await db.transaction((tx) =>
    replaceMemberDepartments(tx, { teamId: actor.teamId, userId: input.userId, departmentIds: wanted }),
  );
  if (departmentIds.length !== wanted.length) fail("BAD_REQUEST", "One of those departments is not in this team.");
  return { departmentIds };
}

export type ConversationMessageView = {
  id: string;
  space: ConversationSpace;
  kind: ConversationMessageKind;
  authorKind: "client" | "member" | "system";
  authorName: string;
  // The member who wrote it. Client-facing views map messages field by field and never send it.
  authorUserId: string | null;
  body: string;
  // The text as written when masking changed it; team admins only.
  originalBody: string | null;
  replyToId: string | null;
  refType: string | null;
  refId: string | null;
  surface: ConversationSurface | null;
  createdAt: Date;
};

// Freelancers read the client's replies relayed as "Client" (design §4); staff see the contact's name.
function authorNameFor(m: ConversationMessageWithAuthor, viewer: Viewer, platformName: string): string {
  switch (m.authorKind) {
    case "system":
      return platformName;
    case "member":
      return m.authorUserName ?? "Team member";
    case "client":
      return viewer.kind === "member" && isProjectStaff(viewer.role) ? (m.authorContactName ?? "Client") : "Client";
  }
}

function viewOf(m: ConversationMessageWithAuthor, viewer: Viewer, platformName: string): ConversationMessageView {
  const member = viewer.kind === "member";
  const authorName = authorNameFor(m, viewer, platformName);
  return {
    id: m.id,
    space: m.space,
    kind: m.kind,
    authorKind: m.authorKind,
    authorName,
    authorUserId: m.authorUserId,
    body: m.shownBody,
    originalBody: member && viewer.role === "admin" && m.body !== m.shownBody ? m.body : null,
    replyToId: m.replyToId,
    refType: m.refType,
    refId: m.refId,
    surface: m.surface,
    createdAt: m.createdAt,
  };
}

// Everything the viewer may read on one project, oldest first, with what they may write.
export async function conversationFor(
  db: Database,
  author: ConversationReader,
  row: ProjectRow,
  platformName: string,
): Promise<{ access: ConversationAccess; messages: ConversationMessageView[] }> {
  const viewer = await viewerFor(db, author);
  const access =
    author.kind === "member" && author.actor.teamId !== row.teamId
      ? { read: [], write: [] }
      : conversationAccess(viewer, await accessFactsFor(db, row));
  const messages = await listMessages(db, { projectId: row.id, spaces: readableSpaces(access) });
  return { access, messages: messages.map((m) => viewOf(m, viewer, platformName)) };
}
