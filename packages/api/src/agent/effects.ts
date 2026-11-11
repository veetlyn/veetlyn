import { depositDue, formatMoney, type JsonObject, money } from "@jendal-workspace/core";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import { userDisplayName } from "@jendal-workspace/db/repositories/conversations";
import { getPayoutRequest } from "@jendal-workspace/db/repositories/payout-requests";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";

import { computeUpfrontBps } from "@opmodel/engine-rules";

import { conversationPost } from "../actions/conversations";
import { payoutApprove, payoutReject } from "../actions/payouts";
import { projectAssign } from "../actions/projects";
import { amendmentPropose, quoteCreate } from "../actions/quotes";
import { pinnedRulebookRules } from "../use-cases/projects";

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

async function teamProject(db: DbExecutor, teamId: string, projectId: string) {
  const project = await findProjectById(db, projectId);
  return project && project.teamId === teamId ? project : null;
}

// Only someone on this team can be assigned its work; anyone else gets no card at all.
async function teamMemberName(db: DbExecutor, teamId: string, userId: string): Promise<string | null> {
  return (await servicesTeamRoleFor(db, teamId, userId)) ? userDisplayName(db, userId) : null;
}

async function teamPayout(db: DbExecutor, teamId: string, requestId: string) {
  const request = await getPayoutRequest(db, requestId);
  if (!request || request.teamId !== teamId) return null;
  return { amount: formatMoney(money(request.currency, request.amountMinor)), member: await userDisplayName(db, request.userId) };
}

// A proposal's facts for its card, read from the exact input that runs on confirm, never from the assistant's words.
// The button names the action, so the person always knows what pressing it does. Null when the input no longer fits.
export type ProposalCard =
  | {
      kind: "quote";
      title: string;
      cta: string;
      project: string;
      lines: { label: string; amount: string }[];
      total: string;
      delivery: string;
      freelancer: string | null;
      // What the client pays on accepting, as the acceptance will compute it.
      deposit: { percent: number; quotePart: string; managementFee: string | null; total: string };
    }
  | { kind: "payout"; title: string; cta: string; decision: "approve" | "reject"; member: string; amount: string }
  | { kind: "message"; title: string; cta: string; project: string; audience: string; body: string }
  | { kind: "assign"; title: string; cta: string; project: string; member: string }
  | {
      kind: "amendment";
      title: string;
      cta: string;
      project: string;
      adds: { label: string; amount: string }[];
      removes: number;
      note: string;
    };

export async function proposalCard(db: DbExecutor, teamId: string, action: string, input: JsonObject): Promise<ProposalCard | null> {
  switch (action) {
    case conversationPost.name: {
      const post = conversationPost.input.safeParse(input);
      if (!post.success) return null;
      const project = await teamProject(db, teamId, post.data.projectId);
      if (!project) return null;
      const audience = post.data.teamOnly ? "Team only" : post.data.space ? `${post.data.space} space` : "Client";
      return { kind: "message", title: `Message on ${project.title}`, cta: post.data.kind === "question" ? "Ask the client" : "Post message", project: project.title, audience, body: post.data.body };
    }
    case quoteCreate.name: {
      const quote = quoteCreate.input.safeParse(input);
      if (!quote.success) return null;
      const project = await teamProject(db, teamId, quote.data.projectId);
      if (!project) return null;
      const amount = (minor: number) => formatMoney(money(project.currency, minor));
      const totalMinor = quote.data.items.reduce((sum, item) => sum + item.amountMinor, 0);
      if (totalMinor === 0) return null;
      // The same rule acceptance applies, so the card and the pay page agree.
      const rules = await pinnedRulebookRules(db, project.rulebookId);
      const upfrontBps = rules ? computeUpfrontBps(rules, totalMinor) : project.upfrontBps;
      const deposit = depositDue(totalMinor, project.managementFeeBps, upfrontBps);
      return {
        kind: "quote",
        title: `Quote for ${project.title}`,
        cta: "Send quote",
        project: project.title,
        lines: quote.data.items.map((item) => ({ label: item.description, amount: amount(item.amountMinor) })),
        total: amount(totalMinor),
        delivery: days(quote.data.deliveryDays),
        freelancer: quote.data.freelancerId ? await userDisplayName(db, quote.data.freelancerId) : null,
        deposit: {
          percent: upfrontBps / 100,
          quotePart: amount(deposit.quotePartMinor),
          managementFee: deposit.managementFeeMinor > 0 ? amount(deposit.managementFeeMinor) : null,
          total: amount(deposit.totalMinor),
        },
      };
    }
    case payoutApprove.name:
    case payoutReject.name: {
      const parsed = payoutApprove.input.safeParse(input);
      if (!parsed.success) return null;
      const payout = await teamPayout(db, teamId, parsed.data.requestId);
      if (!payout) return null;
      const approve = action === payoutApprove.name;
      return { kind: "payout", title: `${approve ? "Approve" : "Reject"} payout to ${payout.member}`, cta: approve ? `Approve ${payout.amount}` : "Reject payout", decision: approve ? "approve" : "reject", ...payout };
    }
    case projectAssign.name: {
      const assign = projectAssign.input.safeParse(input);
      if (!assign.success) return null;
      const project = await teamProject(db, teamId, assign.data.projectId);
      const member = project && (await teamMemberName(db, teamId, assign.data.freelancerId));
      if (!project || !member) return null;
      return { kind: "assign", title: `Assign ${project.title}`, cta: `Assign to ${member}`, project: project.title, member };
    }
    case amendmentPropose.name: {
      const change = amendmentPropose.input.safeParse(input);
      if (!change.success) return null;
      const project = await teamProject(db, teamId, change.data.projectId);
      if (!project) return null;
      return {
        kind: "amendment",
        title: `Change the quote on ${project.title}`,
        cta: "Propose change",
        project: project.title,
        adds: change.data.add.map((item) => ({ label: item.description, amount: formatMoney(money(project.currency, item.amountMinor)) })),
        removes: change.data.removeItemIds.length,
        note: change.data.note,
      };
    }
    default:
      return null;
  }
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
    case projectAssign.name: {
      const assign = projectAssign.input.safeParse(input);
      if (!assign.success) return null;
      const project = await teamProject(db, teamId, assign.data.projectId);
      const member = project && (await teamMemberName(db, teamId, assign.data.freelancerId));
      if (!project || !member) return null;
      return `Assign “${project.title}” to ${member}`;
    }
    case amendmentPropose.name: {
      const change = amendmentPropose.input.safeParse(input);
      if (!change.success) return null;
      const project = await teamProject(db, teamId, change.data.projectId);
      if (!project) return null;
      const adds = change.data.add.map((item) => `${item.description} ${formatMoney(money(project.currency, item.amountMinor))}`);
      const removes = change.data.removeItemIds.length;
      const parts = [adds.length > 0 ? `add ${adds.join("; ")}` : null, removes > 0 ? `remove ${removes} ${removes === 1 ? "item" : "items"}` : null].filter(Boolean);
      return `Propose a change to the quote on “${project.title}”: ${parts.join(", and ") || "no line changes"}`;
    }
    default:
      return null;
  }
}
