import { findOwnAgentCall, listAgentCallEntries, listOwnAgentCalls } from "@jendal-workspace/db/repositories/calls";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { depsOf, requestOf } from "../actions/trpc";
import { confirmProposal, declineProposal } from "../agent/proposals";
import { openCall } from "../agent/turn";
import { router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";

const entryInput = z.object({ entryId: z.string().min(1).max(64) });

// The dash's assistant (calls design §5): calls a person opens, private to them, in one team.
export const agentRouter = router({
  calls: servicesTeamProcedure.query(async ({ ctx }) => ({
    available: ctx.calls !== undefined,
    calls: await listOwnAgentCalls(ctx.db, { teamId: ctx.servicesTeam.id, userId: ctx.session.user.id }),
  })),

  thread: servicesTeamProcedure.input(z.object({ callId: z.string().min(1).max(64) })).query(async ({ ctx, input }) => {
    const call = await findOwnAgentCall(ctx.db, { callId: input.callId, teamId: ctx.servicesTeam.id, userId: ctx.session.user.id });
    if (!call) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
    const entries = await listAgentCallEntries(ctx.db, call.id);
    // The stored action input stays server-side; the card shows the assistant's sentence and the outcome.
    return { call, entries: entries.map(({ input: _input, ...entry }) => entry) };
  }),

  ask: servicesTeamProcedure
    .input(
      z.object({
        callId: z.string().min(1).max(64).optional(),
        projectId: z.string().min(1).max(64).optional(),
        message: z.string().trim().min(1).max(4_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const calls = ctx.calls;
      if (!calls) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The assistant is not set up on this server." });
      const scope = { team: ctx.servicesTeam, userId: ctx.session.user.id, role: ctx.servicesTeamRole };
      const request = requestOf(ctx);
      const call = await openCall({ actions: depsOf(ctx), request, dailyTurns: calls.dailyTurns }, scope, input);
      const outcome = await calls.run({ callId: call.id, scope: { ...scope, team: { id: scope.team.id, name: scope.team.name } }, message: input.message, request });
      if (!outcome.ok) throw new TRPCError({ code: outcome.code, message: outcome.message });
      return { callId: call.id };
    }),

  confirm: servicesTeamProcedure.input(entryInput).mutation(({ ctx, input }) =>
    confirmProposal(
      { actions: depsOf(ctx), request: requestOf(ctx) },
      { teamId: ctx.servicesTeam.id, userId: ctx.session.user.id },
      input.entryId,
    ),
  ),

  decline: servicesTeamProcedure.input(entryInput).mutation(({ ctx, input }) =>
    declineProposal(ctx.db, { teamId: ctx.servicesTeam.id, userId: ctx.session.user.id }, input.entryId),
  ),
});
