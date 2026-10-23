import type { ConversationSpace } from "@jendal-workspace/core";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { user } from "../schema/auth";
import { clientContact } from "../schema/contacts";
import { conversationMessage, memberDepartment, requestShortlist } from "../schema/conversations";
import { servicesDepartment, servicesOffering } from "../schema/services-catalog";

export type ConversationMessageRow = typeof conversationMessage.$inferSelect;
export type NewConversationMessage = typeof conversationMessage.$inferInsert;

export async function insertMessage(tx: DbExecutor, row: NewConversationMessage): Promise<ConversationMessageRow> {
  const [created] = await tx.insert(conversationMessage).values(row).returning();
  if (!created) throw new Error("Insert into conversation_message returned no row");
  return created;
}

// The platform's own line on the timeline, written in the transaction of the change it reports.
export async function insertEventMessage(
  tx: DbExecutor,
  input: { projectId: string; space: ConversationSpace; body: string; refType: string; refId: string },
): Promise<void> {
  await insertMessage(tx, {
    projectId: input.projectId,
    space: input.space,
    authorKind: "system",
    kind: "event",
    body: input.body,
    shownBody: input.body,
    refType: input.refType,
    refId: input.refId,
    surface: null,
  });
}

export async function userDisplayName(tx: DbExecutor, userId: string): Promise<string> {
  const [row] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name ?? "A team member";
}

export async function findMessage(
  tx: DbExecutor,
  input: { projectId: string; messageId: string },
): Promise<ConversationMessageRow | null> {
  const [row] = await tx
    .select()
    .from(conversationMessage)
    .where(and(eq(conversationMessage.id, input.messageId), eq(conversationMessage.projectId, input.projectId)))
    .limit(1);
  return row ?? null;
}

export type ConversationMessageWithAuthor = ConversationMessageRow & {
  authorUserName: string | null;
  authorContactName: string | null;
};

// Oldest first; ties keep insertion order through the id only within one transaction, so callers that write
// several messages at once give them distinct times.
export async function listMessages(
  db: DbExecutor,
  input: { projectId: string; spaces: readonly ConversationSpace[] },
): Promise<ConversationMessageWithAuthor[]> {
  if (input.spaces.length === 0) return [];
  const rows = await db
    .select({ message: conversationMessage, authorUserName: user.name, authorContactName: clientContact.name })
    .from(conversationMessage)
    .leftJoin(user, eq(user.id, conversationMessage.authorUserId))
    .leftJoin(clientContact, eq(clientContact.id, conversationMessage.authorContactId))
    .where(and(eq(conversationMessage.projectId, input.projectId), inArray(conversationMessage.space, [...input.spaces])))
    .orderBy(asc(conversationMessage.createdAt), asc(conversationMessage.id));
  return rows.map((r) => ({ ...r.message, authorUserName: r.authorUserName, authorContactName: r.authorContactName }));
}

export async function memberDepartmentIds(db: DbExecutor, input: { teamId: string; userId: string }): Promise<string[]> {
  const rows = await db
    .select({ departmentId: memberDepartment.departmentId })
    .from(memberDepartment)
    .where(and(eq(memberDepartment.teamId, input.teamId), eq(memberDepartment.userId, input.userId)));
  return rows.map((r) => r.departmentId);
}

export async function listMemberDepartments(
  db: DbExecutor,
  teamId: string,
): Promise<{ userId: string; departmentId: string }[]> {
  return db
    .select({ userId: memberDepartment.userId, departmentId: memberDepartment.departmentId })
    .from(memberDepartment)
    .where(eq(memberDepartment.teamId, teamId));
}

// Replaces the member's departments; ids from another team are left out.
export async function replaceMemberDepartments(
  tx: DbExecutor,
  input: { teamId: string; userId: string; departmentIds: readonly string[] },
): Promise<string[]> {
  await tx
    .delete(memberDepartment)
    .where(and(eq(memberDepartment.teamId, input.teamId), eq(memberDepartment.userId, input.userId)));
  if (input.departmentIds.length === 0) return [];
  const owned = await tx
    .select({ id: servicesDepartment.id })
    .from(servicesDepartment)
    .where(and(eq(servicesDepartment.teamId, input.teamId), inArray(servicesDepartment.id, [...input.departmentIds])));
  if (owned.length === 0) return [];
  await tx
    .insert(memberDepartment)
    .values(owned.map((d) => ({ teamId: input.teamId, userId: input.userId, departmentId: d.id })));
  return owned.map((d) => d.id);
}

export async function getShortlist(db: DbExecutor, projectId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: requestShortlist.userId })
    .from(requestShortlist)
    .where(eq(requestShortlist.projectId, projectId));
  return rows.map((r) => r.userId);
}

export async function replaceShortlist(
  tx: DbExecutor,
  input: { projectId: string; userIds: readonly string[] },
): Promise<void> {
  await tx.delete(requestShortlist).where(eq(requestShortlist.projectId, input.projectId));
  if (input.userIds.length === 0) return;
  await tx.insert(requestShortlist).values(input.userIds.map((userId) => ({ projectId: input.projectId, userId })));
}

export async function shortlistsFor(db: DbExecutor, projectIds: readonly string[]): Promise<Map<string, string[]>> {
  const lists = new Map<string, string[]>();
  if (projectIds.length === 0) return lists;
  const rows = await db
    .select({ projectId: requestShortlist.projectId, userId: requestShortlist.userId })
    .from(requestShortlist)
    .where(inArray(requestShortlist.projectId, [...projectIds]));
  for (const row of rows) lists.set(row.projectId, [...(lists.get(row.projectId) ?? []), row.userId]);
  return lists;
}

export async function offeringDepartments(db: DbExecutor, offeringIds: readonly string[]): Promise<Map<string, string | null>> {
  if (offeringIds.length === 0) return new Map();
  const rows = await db
    .select({ id: servicesOffering.id, departmentId: servicesOffering.departmentId })
    .from(servicesOffering)
    .where(inArray(servicesOffering.id, [...offeringIds]));
  return new Map(rows.map((r) => [r.id, r.departmentId]));
}
