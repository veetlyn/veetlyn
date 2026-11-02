import type { JsonObject } from "@jendal-workspace/core";
import { claimPendingProposal, recordProposalOutcome } from "@jendal-workspace/db/repositories/calls";
import { TRPCError } from "@trpc/server";

import type { RequestMeta } from "../actions/actors";
import { toActionError } from "../actions/errors";
import type { ActionDeps } from "../actions/perform";
import { proposalTool } from "./tools";

type Owner = { teamId: string; userId: string };

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
    await tool.perform(
      { deps: deps.actions, actor: { kind: "user", userId: owner.userId }, surface: "agent", request: deps.request, team: { id: owner.teamId } },
      input,
    );
    return { status: "done", outcome: "Done." };
  } catch (error) {
    return { status: "failed", outcome: toActionError(error).message };
  }
}

export async function confirmProposal(
  deps: { actions: ActionDeps; request: RequestMeta },
  owner: Owner,
  entryId: string,
): Promise<ProposalOutcome> {
  const entry = await claimPendingProposal(deps.actions.db, { ...owner, entryId, status: "done" });
  if (!entry) throw new TRPCError({ code: "CONFLICT", message: GONE });
  const result = await runConfirmed(deps, owner, entry.action, entry.input ?? {});
  await recordProposalOutcome(deps.actions.db, { entryId, ...result });
  return result;
}

export async function declineProposal(db: ActionDeps["db"], owner: Owner, entryId: string): Promise<void> {
  const entry = await claimPendingProposal(db, { ...owner, entryId, status: "declined" });
  if (!entry) throw new TRPCError({ code: "CONFLICT", message: GONE });
}
