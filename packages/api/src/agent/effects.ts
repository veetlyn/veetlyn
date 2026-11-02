import { formatMoney, type JsonObject, money } from "@jendal-workspace/core";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import { userDisplayName } from "@jendal-workspace/db/repositories/conversations";
import { getPayoutRequest } from "@jendal-workspace/db/repositories/payout-requests";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";

import { conversationPost } from "../actions/conversations";
import { payoutApprove, payoutReject } from "../actions/payouts";
import { quoteCreate } from "../actions/quotes";

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

async function teamProject(db: DbExecutor, teamId: string, projectId: string) {
  const project = await findProjectById(db, projectId);
  return project && project.teamId === teamId ? project : null;
}

async function teamPayout(db: DbExecutor, teamId: string, requestId: string) {
  const request = await getPayoutRequest(db, requestId);
  if (!request || request.teamId !== teamId) return null;
  return { amount: formatMoney(money(request.currency, request.amountMinor)), member: await userDisplayName(db, request.userId) };
}

// What a proposal will do, written by the server from the exact input that runs on confirm, with the record it
// targets: the card shows this, so the person never confirms the assistant's description of an action. Null when the
// input does not fit its action or names a record outside the team.
export async function proposalEffect(db: DbExecutor, teamId: string, action: string, input: JsonObject): Promise<string | null> {
  switch (action) {
    case conversationPost.name: {
      const post = conversationPost.input.safeParse(input);
      if (!post.success) return null;
      const project = await teamProject(db, teamId, post.data.projectId);
      if (!project) return null;
      const what = post.data.kind === "question" ? "Ask the client" : "Post";
      const where = post.data.teamOnly ? " for the team only" : post.data.space ? ` in the ${post.data.space} space` : "";
      return `${what} on “${project.title}”${where}: “${post.data.body}”`;
    }
    case quoteCreate.name: {
      const quote = quoteCreate.input.safeParse(input);
      if (!quote.success) return null;
      const project = await teamProject(db, teamId, quote.data.projectId);
      if (!project) return null;
      const lines = quote.data.items.map((item) => `${item.description} ${formatMoney(money(project.currency, item.amountMinor))}`);
      const total = quote.data.items.reduce((sum, item) => sum + item.amountMinor, 0);
      const by = quote.data.freelancerId ? ` for ${await userDisplayName(db, quote.data.freelancerId)}` : "";
      return `Send a quote on “${project.title}”${by}: ${lines.join("; ")}. Total ${formatMoney(money(project.currency, total))}, delivered in ${days(quote.data.deliveryDays)}.`;
    }
    case payoutApprove.name:
    case payoutReject.name: {
      const decision = payoutApprove.input.safeParse(input);
      if (!decision.success) return null;
      const payout = await teamPayout(db, teamId, decision.data.requestId);
      if (!payout) return null;
      return action === payoutApprove.name
        ? `Approve the payout of ${payout.amount} to ${payout.member}`
        : `Reject ${payout.member}'s payout request of ${payout.amount}`;
    }
    default:
      return null;
  }
}
