import type { TurnOutcome } from "@jendal-workspace/api/agent/runtime";
import { turnOutcome } from "@jendal-workspace/api/agent/runtime";
import { createAgentServices } from "@jendal-workspace/api/agent/services";
import type { TurnRequest } from "@jendal-workspace/api/agent/turn";
import { Agent } from "agents";

import { ENV } from "../env.server";
import { getDb } from "../services";
import { agentActionDeps } from "./action-deps";

export type CallAgentState = { turning: boolean };

// One Agent per call, named by the call's id (agentic dash design §6.4, Agents SDK). Postgres holds the call and its
// thread; the Agent runs the call's turns one at a time and is where scheduled and event-driven turns will run. It is
// reached only through the api Worker's binding, after the Worker has resolved the person, their role and the call.
export class CallAgent extends Agent<Env, CallAgentState> {
  initialState: CallAgentState = { turning: false };
  private lastTurn: Promise<unknown> = Promise.resolve();

  runTurn(turn: TurnRequest): Promise<TurnOutcome> {
    const next = this.lastTurn.catch(() => undefined).then(() => this.turn(turn));
    this.lastTurn = next;
    return next;
  }

  private async turn(turn: TurnRequest): Promise<TurnOutcome> {
    const agent = createAgentServices({
      apiKey: ENV.AGENT_API_KEY,
      baseUrl: ENV.AGENT_BASE_URL,
      model: ENV.AGENT_MODEL,
      dailyTurns: ENV.AGENT_DAILY_TURNS,
    });
    if (!agent) return { ok: false, code: "BAD_GATEWAY", message: "The assistant is not set up on this server." };
    const db = getDb();
    this.setState({ turning: true });
    try {
      const actions = await agentActionDeps(db, { waitUntil: (promise) => this.ctx.waitUntil(promise) });
      return await turnOutcome({ actions, agent, request: turn.request }, turn);
    } finally {
      this.setState({ turning: false });
      this.ctx.waitUntil(db.$client.end());
    }
  }
}
