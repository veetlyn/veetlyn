import { agentProposalMachine, type JsonObject } from "@jendal-workspace/core";
import type { NodeKind, Section } from "@jendal-workspace/core/context/node";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { startsFrom } from "../state-guard";
import { agentCall, agentCallEntry } from "../schema/calls";
import { outbox } from "../schema/outbox";

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

// Opens the call a quote is prepared in, or null if this person already has one for the request.
export async function startDraftCall(
  db: DbExecutor,
  input: CallPlace & { userId: string; title: string; now: Date },
): Promise<AgentCallRow | null> {
  const { now, ...place } = input;
  const [row] = await db.insert(agentCall).values({ ...place, draftStartedAt: now }).onConflictDoNothing().returning();
  return row ?? null;
}

// Takes over a draft call that holds nothing yet, if no one is working on it now.
export async function resumeDraftCall(
  db: DbExecutor,
  input: { callId: string; now: Date; startedBefore: Date },
): Promise<AgentCallRow | null> {
  const [row] = await db
    .update(agentCall)
    .set({ draftStartedAt: input.now })
    .where(
      and(
        eq(agentCall.id, input.callId),
        or(isNull(agentCall.draftStartedAt), lt(agentCall.draftStartedAt, input.startedBefore)),
      ),
    )
    .returning();
  return row ?? null;
}

// A draft that failed can be tried again at once.
export async function releaseDraftCall(db: DbExecutor, callId: string): Promise<void> {
  await db.update(agentCall).set({ draftStartedAt: null }).where(eq(agentCall.id, callId));
}

export async function countDraftsSince(db: DbExecutor, input: { teamId: string; since: Date }): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(agentCall)
    .where(and(eq(agentCall.teamId, input.teamId), gte(agentCall.draftStartedAt, input.since)));
  return row?.n ?? 0;
}

// Takes the newest arrivals nobody has picked up. One statement, so two sweeps never take the same event.
export async function claimArrivedRequests(
  db: DbExecutor,
  input: { since: Date; now: Date; limit: number },
): Promise<{ teamId: string; projectId: string | null }[]> {
  const due = db
    .select({ id: outbox.id })
    .from(outbox)
    .where(
      and(
        isNull(outbox.agentDraftsProcessedAt),
        inArray(outbox.type, ["project.created", "project.assigned"]),
        gte(outbox.createdAt, input.since),
      ),
    )
    .orderBy(outbox.createdAt, outbox.id)
    .limit(input.limit)
    .for("update", { skipLocked: true });
  return db
    .update(outbox)
    .set({ agentDraftsProcessedAt: input.now })
    .where(inArray(outbox.id, due))
    .returning({ teamId: outbox.teamId, projectId: outbox.projectId });
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
    ui?: JsonObject;
    status?: AgentCallEntryRow["status"];
  },
): Promise<AgentCallEntryRow> {
  // Entries of one turn are written in quick succession; distinct times keep their order on screen.
  const [row] = await db.insert(agentCallEntry).values({ ...input, createdAt: new Date() }).returning();
  if (!row) throw new Error("Insert into agent_call_entry returned no row");
  return row;
}

// Progressive answers: a draft entry is updated as the model writes, then finished (or removed on failure).
export async function updateAgentCallEntry(
  db: DbExecutor,
  input: { entryId: string; body: string; note?: string; ui?: JsonObject },
): Promise<void> {
  await db.update(agentCallEntry).set({ body: input.body, note: input.note, ui: input.ui }).where(eq(agentCallEntry.id, input.entryId));
}

export async function deleteAgentCallEntry(db: DbExecutor, entryId: string): Promise<void> {
  await db.delete(agentCallEntry).where(eq(agentCallEntry.id, entryId));
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
  const event = input.status === "done" ? "confirm" : "decline";
  const [row] = await db
    .update(agentCallEntry)
    .set({ status: agentProposalMachine.transitions[event].to, decidedAt: new Date() })
    .where(
      and(
        eq(agentCallEntry.id, input.entryId),
        eq(agentCallEntry.callId, input.callId),
        eq(agentCallEntry.kind, "proposal"),
        startsFrom(agentCallEntry.status, agentProposalMachine, event),
      ),
    )
    .returning();
  return row ?? null;
}

export async function recordProposalOutcome(
  db: DbExecutor,
  input: { entryId: string; status: "done" | "failed"; outcome: string },
): Promise<void> {
  // Only a confirmed card has an outcome: a declined or pending one is never run, so nothing here may overwrite it.
  const status = input.status === "failed" ? agentProposalMachine.transitions.fail.to : agentProposalMachine.transitions.confirm.to;
  await db
    .update(agentCallEntry)
    .set({ status, outcome: input.outcome })
    .where(and(eq(agentCallEntry.id, input.entryId), eq(agentCallEntry.kind, "proposal"), startsFrom(agentCallEntry.status, agentProposalMachine, "fail")));
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
