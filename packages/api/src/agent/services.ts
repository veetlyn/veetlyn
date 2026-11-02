import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { AgentServices } from "../context";

const DEFAULT_DAILY_TURNS = 200;

// The assistant's model from the stage's settings: an OpenAI-compatible chat endpoint (Muse Spark on Modal, decisions
// log 2026-10-28). Without a key, endpoint and model there is no assistant.
export function createAgentServices(
  config: { apiKey: string; baseUrl: string; model: string; dailyTurns: string },
  fetch?: typeof globalThis.fetch,
): AgentServices | undefined {
  if (!config.apiKey || !config.baseUrl || !config.model) return undefined;
  const provider = createOpenAICompatible({ name: "agent", baseURL: config.baseUrl, apiKey: config.apiKey, fetch });
  const dailyTurns = Number.parseInt(config.dailyTurns, 10);
  return {
    model: provider.chatModel(config.model),
    dailyTurns: Number.isSafeInteger(dailyTurns) && dailyTurns > 0 ? dailyTurns : DEFAULT_DAILY_TURNS,
  };
}
