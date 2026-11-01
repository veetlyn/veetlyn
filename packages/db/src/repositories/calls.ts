import type { JsonObject } from "@jendal-workspace/core";
import { and, asc, count, desc, eq, gte, inArray } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { agentCall, agentCallEntry } from "../schema/calls";

export type AgentCallRow = typeof agentCall.$inferSelect;
export type AgentCallEntryRow = typeof agentCallEntry.$inferSelect;

export async function createAgentCall(
  db: DbExecutor,
  input: { teamId: string; userId: string; projectId: string | null; title: string },
): Promise<AgentCallRow> {
  const [row] = await db.insert(agentCall).values(input).returning();
  if (!row) throw new Error("Insert into agent_call returned no row");
  return row;
}

// A call belongs to the person who opened it, in one team; anyone else gets nothing.
export async function findOwnAgentCall(
  db: DbExecutor,
  input: { callId: string; teamId: string; userId: string },
): Promise<AgentCallRow | null> {
  const [row] = await db
    .select()
    .from(agentCall)
    .where(and(eq(agentCall.id, input.callId), eq(agentCall.teamId, input.teamId), eq(agentCall.userId, input.userId)))
    .limit(1);
  return row ?? null;
}

export async function listOwnAgentCalls(db: DbExecutor, input: { teamId: string; userId: string }): Promise<AgentCallRow[]> {
  return db
    .select()
    .from(agentCall)
    .where(and(eq(agentCall.teamId, input.teamId), eq(agentCall.userId, input.userId)))
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

// Claims a pending proposal of the person's own call for one decision: a second confirm or decline finds nothing.
export async function claimPendingProposal(
  db: DbExecutor,
  input: { entryId: string; teamId: string; userId: string; status: "done" | "declined" },
): Promise<AgentCallEntryRow | null> {
  const ownCalls = db
    .select({ id: agentCall.id })
    .from(agentCall)
    .where(and(eq(agentCall.teamId, input.teamId), eq(agentCall.userId, input.userId)));
  const [row] = await db
    .update(agentCallEntry)
    .set({ status: input.status, decidedAt: new Date() })
    .where(
      and(
        eq(agentCallEntry.id, input.entryId),
        eq(agentCallEntry.kind, "proposal"),
        eq(agentCallEntry.status, "pending"),
        inArray(agentCallEntry.callId, ownCalls),
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

// The assistant's answers in the team's calls since a time: what the daily cap counts.
export async function countAssistantTurnsSince(db: DbExecutor, input: { teamId: string; since: Date }): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(agentCallEntry)
    .innerJoin(agentCall, eq(agentCall.id, agentCallEntry.callId))
    .where(
      and(
        eq(agentCall.teamId, input.teamId),
        eq(agentCallEntry.author, "assistant"),
        eq(agentCallEntry.kind, "message"),
        gte(agentCallEntry.createdAt, input.since),
      ),
    );
  return row?.n ?? 0;
}
