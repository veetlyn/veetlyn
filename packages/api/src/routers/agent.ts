import { hasNoLimits, isFinanceAction, type ProjectStatus } from "@jendal-workspace/core";
import type { ContextNode } from "@jendal-workspace/core/context/node";
import {
  findOwnAgentCall,
  listAgentCallEntries,
  listOwnAgentCalls,
  listOwnPendingProposals,
} from "@jendal-workspace/db/repositories/calls";
import { getServicesTeamSettings, memberHistorySince, setAgentLimits } from "@jendal-workspace/db/repositories/services-teams";
import { findTeamIdBySlug } from "@jendal-workspace/db/repositories/teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { perform } from "../actions/perform";
import { projectList } from "../actions/projects";
import { depsOf, requestOf } from "../actions/trpc";
import { callsUnder, contextNodeInput, nodeOfCall, type ResolvedNode, resolveNode } from "../agent/node";
import { proposalCard } from "../agent/effects";
import { prepareNextDraft } from "../agent/prepare";
import { confirmProposal, declineProposal } from "../agent/proposals";
import { composerActions } from "../agent/tools";
import { openCall } from "../agent/turn";
import { type Context } from "../context";
import { protectedProcedure, router } from "../index";

const callId = z.string().min(1).max(64);
const entryInput = z.object({ entryId: z.string().min(1).max(64) });

type SignedIn = Context & { session: NonNullable<Context["session"]> };

const NOT_HERE = "Not found.";
const PENDING_ON_HOME = 5;
const MAX_COMPOSER_RECORDS = 200;
const isFinished = (status: ProjectStatus) => ["completed", "cancelled", "declined", "expired", "abandoned"].includes(status);

async function resolved(ctx: SignedIn, node: ContextNode): Promise<ResolvedNode> {
  const found = await resolveNode({ actions: depsOf(ctx), request: requestOf(ctx) }, ctx.session.user.id, node);
  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: NOT_HERE });
  return found;
}

// The person's call, at a node they may still open: access lost since the call was opened hides it too.
async function ownCall(ctx: SignedIn, id: string) {
  const call = await findOwnAgentCall(ctx.db, { callId: id, userId: ctx.session.user.id });
  const node = call ? nodeOfCall(call) : null;
  if (!call || !node) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
  const scope = await resolveNode({ actions: depsOf(ctx), request: requestOf(ctx) }, ctx.session.user.id, node);
  if (!scope) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
  if (!(await stillVisible(ctx, scope, call, null))) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
  return { call, scope };
}

const hiddenFinance = (scope: ResolvedNode, action: string) =>
  Boolean(scope.seller?.access.hideProjectFinances) && isFinanceAction(action);

// A proposal made before an admin set a limit stops showing, on the same terms as anything else the person asks for.
async function stillVisible(ctx: SignedIn, scope: ResolvedNode, call: { teamId: string | null; projectId: string | null; openedAt: Date }, action: string | null) {
  if (call.teamId) {
    const since = await memberHistorySince(ctx.db, { teamId: call.teamId, userId: ctx.session.user.id });
    if (since && call.openedAt <= since) return false;
  }
  if (action && hiddenFinance(scope, action)) return false;
  // Each check below reads the project as an agent read, so it runs only for someone an admin has limited.
  if (!call.teamId || !call.projectId || (scope.seller && hasNoLimits(scope.seller.access))) return true;
  const node = { kind: "record" as const, teamId: call.teamId, record: { type: "project" as const, id: call.projectId } };
  return (await resolveNode({ actions: depsOf(ctx), request: requestOf(ctx) }, ctx.session.user.id, node)) !== null;
}

// The dash's assistant (calls design §5): calls a person opens at any node of their context tree, private to them.
export const agentRouter = router({
  // The node as the person may open it: what the frame shows around a call and what the assistant knows there.
  node: protectedProcedure.input(z.object({ node: contextNodeInput })).query(async ({ ctx, input }) => {
    const scope = await resolved(ctx, input.node);
    return { available: ctx.calls !== undefined, scope };
  }),

  // A seller's node from its slug, as the dash frame addresses it: its sections for the person's plan and role.
  seller: protectedProcedure.input(z.object({ slug: z.string().min(1).max(63) })).query(async ({ ctx, input }) => {
    const teamId = await findTeamIdBySlug(ctx.db, input.slug);
    if (!teamId) throw new TRPCError({ code: "NOT_FOUND", message: NOT_HERE });
    return { available: ctx.calls !== undefined, scope: await resolved(ctx, { kind: "seller", teamId }) };
  }),

  calls: protectedProcedure.input(z.object({ node: contextNodeInput })).query(async ({ ctx, input }) => {
    const scope = await resolved(ctx, input.node);
    const rows = await listOwnAgentCalls(ctx.db, { userId: ctx.session.user.id, under: callsUnder(input.node) });
    const shown = await Promise.all(rows.map(async (call) => (await stillVisible(ctx, scope, call, null)) ? call : null));
    return {
      available: ctx.calls !== undefined,
      calls: shown.filter((call) => call !== null),
    };
  }),

  thread: protectedProcedure.input(z.object({ callId })).query(async ({ ctx, input }) => {
    const { call, scope } = await ownCall(ctx, input.callId);
    const entries = await listAgentCallEntries(ctx.db, call.id);
    // The stored action input stays server-side; the card shows the facts the server read from it.
    return {
      call,
      scope,
      entries: await Promise.all(
        entries.map(async ({ input: stored, ...entry }) => ({
          ...entry,
          card: entry.kind === "proposal" && call.teamId && entry.action && !hiddenFinance(scope, entry.action) ? await proposalCard(ctx.db, call.teamId, entry.action, stored ?? {}) : null,
        })),
      ),
    };
  }),

  // The decisions the assistant has prepared for this person at a node, for the home page's Needs you.
  pending: protectedProcedure.input(z.object({ node: contextNodeInput })).query(async ({ ctx, input }) => {
    const scope = await resolved(ctx, input.node);
    const rows = await listOwnPendingProposals(ctx.db, { userId: ctx.session.user.id, under: callsUnder(input.node), limit: PENDING_ON_HOME });
    const cards = await Promise.all(
      rows.map(async ({ entry, call }) => {
        if (!(await stillVisible(ctx, scope, call, entry.action))) return null;
        const card = call.teamId && entry.action ? await proposalCard(ctx.db, call.teamId, entry.action, entry.input ?? {}) : null;
        return card ? { id: entry.id, callId: call.id, note: entry.note, card } : null;
      }),
    );
    return { pending: cards.filter((card) => card !== null) };
  }),

  // What the composer suggests after @ and /, for this person here. Suggestions only: everything is checked on send.
  composer: protectedProcedure.input(z.object({ node: contextNodeInput })).query(async ({ ctx, input }) => {
    const scope = await resolved(ctx, input.node);
    const seller = scope.seller;
    if (!seller || seller.role.product !== "services") return { records: [], actions: [] };
    const [limits, projects] = await Promise.all([
      getServicesTeamSettings(ctx.db, seller.id),
      perform(
        { deps: depsOf(ctx), actor: { kind: "user", userId: ctx.session.user.id }, surface: "web", request: requestOf(ctx), team: { id: seller.id } },
        projectList,
        {},
      ),
    ]);
    return {
      // Open work first, then the newest: what someone is likely to be talking about.
      records: projects
        .toSorted((a, b) => Number(isFinished(a.status)) - Number(isFinished(b.status)) || b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, MAX_COMPOSER_RECORDS)
        .map(({ id, title, status, clientName }) => ({ id, title, status, clientName })),
      actions: composerActions(scope, limits),
    };
  }),

  // What this team's agent may prepare, set by an admin. Everything it prepares still waits for a person.
  setLimits: protectedProcedure
    .input(z.object({ teamId: z.string().min(1).max(64), agentQuotes: z.boolean(), agentMessages: z.boolean(), agentPayouts: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const scope = await resolved(ctx, { kind: "seller", teamId: input.teamId });
      if (scope.seller?.role.product !== "services" || scope.seller.role.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only an admin can change what the agent may prepare." });
      }
      await setAgentLimits(ctx.db, input);
    }),

  // Prepares the next unanswered request's quote for this person; the page asks again until nothing is left.
  prepareDrafts: protectedProcedure.input(z.object({ teamId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => {
    if (!ctx.calls) return { drafted: null };
    const scope = await resolved(ctx, { kind: "seller", teamId: input.teamId });
    return { drafted: await prepareNextDraft({ actions: depsOf(ctx), request: requestOf(ctx), calls: ctx.calls }, scope) };
  }),

  // A new call at the node, or the next turn of one of the person's calls (which keeps the node it was opened at).
  ask: protectedProcedure
    .input(z.object({ node: contextNodeInput, callId: callId.optional(), message: z.string().trim().min(1).max(4_000) }))
    .mutation(async ({ ctx, input }) => {
      const calls = ctx.calls;
      if (!calls) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The assistant is not set up on this server." });
      const scope = input.callId ? (await ownCall(ctx, input.callId)).scope : await resolved(ctx, input.node);
      const request = requestOf(ctx);
      const call = await openCall({ actions: depsOf(ctx), request, dailyTurns: calls.dailyTurns }, scope, input);
      const outcome = await calls.run({ callId: call.id, scope, message: input.message, request });
      if (!outcome.ok) throw new TRPCError({ code: outcome.code, message: outcome.message });
      return { callId: call.id };
    }),

  confirm: protectedProcedure.input(entryInput).mutation(({ ctx, input }) =>
    confirmProposal({ actions: depsOf(ctx), request: requestOf(ctx) }, ctx.session.user.id, input.entryId),
  ),

  decline: protectedProcedure.input(entryInput).mutation(({ ctx, input }) =>
    declineProposal({ actions: depsOf(ctx), request: requestOf(ctx) }, ctx.session.user.id, input.entryId),
  ),
});
