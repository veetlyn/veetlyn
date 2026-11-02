import { TRPCError } from "@trpc/server";

import type { ActionDeps } from "../actions/perform";
import type { AgentServices } from "../context";
import { runCallTurn, type TurnRequest } from "./turn";

// A turn's result as plain data: it comes back across a Durable Object call, where a thrown error would lose its code.
export type TurnOutcome = { ok: true } | { ok: false; code: "NOT_FOUND" | "BAD_GATEWAY"; message: string };

// Where turns run: one at a time per call. The api Worker sends them to the call's own Agent (a Durable Object);
// tests run them in this process.
export type CallRuntime = {
  dailyTurns: number;
  run(turn: TurnRequest): Promise<TurnOutcome>;
};

export async function turnOutcome(deps: Parameters<typeof runCallTurn>[0], turn: TurnRequest): Promise<TurnOutcome> {
  try {
    await runCallTurn(deps, turn);
    return { ok: true };
  } catch (error) {
    if (error instanceof TRPCError && (error.code === "NOT_FOUND" || error.code === "BAD_GATEWAY")) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

export function inProcessCallRuntime(actions: ActionDeps, agent: AgentServices): CallRuntime {
  const running = new Map<string, Promise<unknown>>();
  return {
    dailyTurns: agent.dailyTurns,
    run(turn) {
      const previous = running.get(turn.callId) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(() => turnOutcome({ actions, agent, request: turn.request }, turn));
      running.set(turn.callId, next);
      return next;
    },
  };
}
