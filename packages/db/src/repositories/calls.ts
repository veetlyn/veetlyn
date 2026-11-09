import type { JsonObject } from "@jendal-workspace/core";
import type { NodeKind, Section } from "@jendal-workspace/core/context/node";
import { and, asc, count, desc, eq, gte, isNull, or, sql, type SQL } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { agentCall, agentCallEntry } from "../schema/calls";

export type AgentCallRow = typeof agentCall.$inferSelect;
export type AgentCallEntryRow = typeof agentCallEntry.$inferSelect;

// Where a call stands in the context tree, as stored. The API resolves it from a node the person may open.
export type CallPlace = {
  nodeKind: NodeKind;
  organizationId: string | null;
  teamId: string | null;
  section: Section | null;
  projectId: string | null;
};

export async function createAgentCall(db: DbExecutor, input: CallPlace & { userId: string; title: string }): Promise<AgentCallRow> {
  const [row] = await db.insert(agentCall).values(input).returning();
  if (!row) throw new Error("Insert into agent_call returned no row");
  return row;
}

// A call belongs to the person who opened it; anyone else gets nothing. The caller still checks that the person may
// open the call's place today, since access can be lost after a call was opened.
export async function findOwnAgentCall(db: DbExecutor, input: { callId: string; userId: string }): Promise<AgentCallRow | null> {
  const [row] = await db
    .select()
    .from(agentCall)
    .where(and(eq(agentCall.id, input.callId), eq(agentCall.userId, input.userId)))
    .limit(1);
  return row ?? null;
}

// The person's newest call at exactly this place with this title, for a retry of a first question that failed.
export async function findLatestOwnCallAt(db: DbExecutor, input: CallPlace & { userId: string; title: string }): Promise<AgentCallRow | null> {
  const [row] = await db
    .select()
    .from(agentCall)
    .where(
      and(
        eq(agentCall.userId, input.userId),
        eq(agentCall.title, input.title),
        eq(agentCall.nodeKind, input.nodeKind),
        sql`${agentCall.organizationId} is not distinct from ${input.organizationId}`,
        sql`${agentCall.teamId} is not distinct from ${input.teamId}`,
        sql`${agentCall.section} is not distinct from ${input.section}`,
        sql`${agentCall.projectId} is not distinct from ${input.projectId}`,
      ),
    )
    .orderBy(desc(agentCall.openedAt))
    .limit(1);
  return row ?? null;
}

// The places a list of calls covers: everything the person opened, in a workspace, at a seller, in a section, or on a
// project. A section holds its own calls and, for projects, the calls on each project.
export type CallsUnder =
  | { kind: "account" }
  | { kind: "workspace"; organizationId: string }
  | { kind: "seller"; teamId: string }
  | { kind: "section"; teamId: string; section: Section }
  | { kind: "record"; teamId: string; projectId: string };

function underClause(under: CallsUnder): SQL | undefined {
  switch (under.kind) {
    case "account":
      return undefined;
    case "workspace":
      return eq(agentCall.organizationId, under.organizationId);
    case "seller":
      return eq(agentCall.teamId, under.teamId);
    case "section":
      return and(
        eq(agentCall.teamId, under.teamId),
        under.section === "projects"
          ? or(eq(agentCall.section, under.section), eq(agentCall.nodeKind, "record"))
          : eq(agentCall.section, under.section),
      );
    case "record":
      return and(eq(agentCall.teamId, under.teamId), eq(agentCall.projectId, under.projectId));
  }
}

export async function listOwnAgentCalls(db: DbExecutor, input: { userId: string; under: CallsUnder }): Promise<AgentCallRow[]> {
  return db
    .select()
    .from(agentCall)
    .where(and(eq(agentCall.userId, input.userId), underClause(input.under)))
    .orderBy(desc(agentCall.openedAt), desc(agentCall.id))
    .limit(50);
}

export async function listAgentCallEntries(db: DbExecutor, callId: string): Promise<AgentCallEntryRow[]> {
  return db
    .select()
    .from(agentCallEntry)
    .where(eq(agentCallEntry.callId, callId))
    .orderBy(asc(agentCallEntry.createdAt), asc(agentCallEntry.id));
}

export async function insertAgentCallEntry(
  db: DbExecutor,
  input: {
    callId: string;
    kind: AgentCallEntryRow["kind"];
    author: AgentCallEntryRow["author"];
    body: string;
    note?: string;
    action?: string;
    input?: JsonObject;
    status?: AgentCallEntryRow["status"];
  },
): Promise<AgentCallEntryRow> {
  // Entries of one turn are written in quick succession; distinct times keep their order on screen.
  const [row] = await db.insert(agentCallEntry).values({ ...input, createdAt: new Date() }).returning();
  if (!row) throw new Error("Insert into agent_call_entry returned no row");
  return row;
}

// The pending proposal and the call it sits in, for its person to decide on. The caller checks the call's place before
// claiming it.
export async function findOwnProposal(
  db: DbExecutor,
  input: { entryId: string; userId: string },
): Promise<{ entry: AgentCallEntryRow; call: AgentCallRow } | null> {
  const [row] = await db
    .select({ entry: agentCallEntry, call: agentCall })
    .from(agentCallEntry)
    .innerJoin(agentCall, eq(agentCall.id, agentCallEntry.callId))
    .where(and(eq(agentCallEntry.id, input.entryId), eq(agentCallEntry.kind, "proposal"), eq(agentCall.userId, input.userId)))
    .limit(1);
  return row ?? null;
}

// The decisions waiting on a person across a place, newest first, each with the call it sits in.
export async function listOwnPendingProposals(
  db: DbExecutor,
  input: { userId: string; under: CallsUnder; limit: number },
): Promise<{ entry: AgentCallEntryRow; call: AgentCallRow }[]> {
  return db
    .select({ entry: agentCallEntry, call: agentCall })
    .from(agentCallEntry)
    .innerJoin(agentCall, eq(agentCall.id, agentCallEntry.callId))
    .where(and(eq(agentCall.userId, input.userId), underClause(input.under), eq(agentCallEntry.kind, "proposal"), eq(agentCallEntry.status, "pending")))
    .orderBy(desc(agentCallEntry.createdAt))
    .limit(input.limit);
}

// Claims a pending proposal of the person's own call for one decision: a second confirm or decline finds nothing.
export async function claimPendingProposal(
  db: DbExecutor,
  input: { entryId: string; callId: string; status: "done" | "declined" },
): Promise<AgentCallEntryRow | null> {
  const [row] = await db
    .update(agentCallEntry)
    .set({ status: input.status, decidedAt: new Date() })
    .where(
      and(
        eq(agentCallEntry.id, input.entryId),
        eq(agentCallEntry.callId, input.callId),
        eq(agentCallEntry.kind, "proposal"),
        eq(agentCallEntry.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function recordProposalOutcome(
  db: DbExecutor,
  input: { entryId: string; status: "done" | "failed"; outcome: string },
): Promise<void> {
  await db.update(agentCallEntry).set({ status: input.status, outcome: input.outcome }).where(eq(agentCallEntry.id, input.entryId));
}

// The questions asked since a time in one workspace's calls, or in a person's account calls (no workspace): what the
// daily cap counts. A question is stored before the model runs, so a failed or concurrent turn counts too.
export async function countQuestionsSince(
  db: DbExecutor,
  input: { organizationId: string | null; userId: string; since: Date },
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(agentCallEntry)
    .innerJoin(agentCall, eq(agentCall.id, agentCallEntry.callId))
    .where(
      and(
        input.organizationId === null
          ? and(isNull(agentCall.organizationId), eq(agentCall.userId, input.userId))
          : eq(agentCall.organizationId, input.organizationId),
        eq(agentCallEntry.author, "person"),
        eq(agentCallEntry.kind, "message"),
        gte(agentCallEntry.createdAt, input.since),
      ),
    );
  return row?.n ?? 0;
}
