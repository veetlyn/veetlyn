import type { JsonObject } from "@jendal-workspace/core";
import { claimPendingProposal, findOwnProposal, recordProposalOutcome } from "@jendal-workspace/db/repositories/calls";
import { TRPCError } from "@trpc/server";

import type { RequestMeta } from "../actions/actors";
import { toActionError } from "../actions/errors";
import type { ActionDeps, PerformRequest } from "../actions/perform";
import { nodeOfCall, resolveNode } from "./node";
import { proposalTool } from "./tools";

type Deps = { actions: ActionDeps; request: RequestMeta };
type Owner = { teamId: string | null; userId: string };

export type ProposalOutcome = { status: "done" | "failed"; outcome: string };

const GONE = "This card was already answered, or it is not yours.";

// The person confirms a proposal: the action runs through the registry as them, with their current role, so a
// changed status, a hold or a lost role refuses it exactly as on the page.
async function runConfirmed(
  deps: { actions: ActionDeps; request: RequestMeta },
  owner: Owner,
  action: string | null,
  input: JsonObject,
): Promise<ProposalOutcome> {
  const tool = action ? proposalTool(action) : undefined;
  if (!tool) return { status: "failed", outcome: "This action can no longer be confirmed from a call." };
  try {
    const request: PerformRequest = { deps: deps.actions, actor: { kind: "user", userId: owner.userId }, surface: "agent", request: deps.request };
    // Above the sellers no team is named.
    if (owner.teamId) request.team = { id: owner.teamId };
    await tool.perform(request, input);
    return { status: "done", outcome: "Done." };
  } catch (error) {
    return { status: "failed", outcome: toActionError(error).message };
  }
}

// The person's pending card, in a call whose node they may still open; otherwise it is gone for them.
async function ownedCard(deps: Deps, userId: string, entryId: string) {
  const found = await findOwnProposal(deps.actions.db, { entryId, userId });
  const node = found ? nodeOfCall(found.call) : null;
  if (!found || !node || !(await resolveNode(deps, userId, node))) throw new TRPCError({ code: "CONFLICT", message: GONE });
  return found.call;
}

export async function confirmProposal(deps: Deps, userId: string, entryId: string): Promise<ProposalOutcome> {
  const call = await ownedCard(deps, userId, entryId);
  const entry = await claimPendingProposal(deps.actions.db, { entryId, callId: call.id, status: "done" });
  if (!entry) throw new TRPCError({ code: "CONFLICT", message: GONE });
  const result = await runConfirmed(deps, { teamId: call.teamId, userId }, entry.action, entry.input ?? {});
  await recordProposalOutcome(deps.actions.db, { entryId, ...result });
  return result;
}

export async function declineProposal(deps: Deps, userId: string, entryId: string): Promise<void> {
  const call = await ownedCard(deps, userId, entryId);
  const entry = await claimPendingProposal(deps.actions.db, { entryId, callId: call.id, status: "declined" });
  if (!entry) throw new TRPCError({ code: "CONFLICT", message: GONE });
}
