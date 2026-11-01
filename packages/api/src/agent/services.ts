import Anthropic from "@anthropic-ai/sdk";

import type { AgentServices } from "../context";

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_DAILY_TURNS = 200;

// The assistant's model from the stage's settings. No key means no assistant. A base URL points the client at
// another Messages API provider (calls design §2), which may not take Anthropic's own parameters.
export function createAgentServices(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
  dailyTurns: string;
}): AgentServices | undefined {
  if (!config.apiKey) return undefined;
  const dailyTurns = Number.parseInt(config.dailyTurns, 10);
  return {
    client: new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl || undefined, maxRetries: 1 }),
    model: config.model || DEFAULT_MODEL,
    anthropicApi: !config.baseUrl,
    dailyTurns: Number.isSafeInteger(dailyTurns) && dailyTurns > 0 ? dailyTurns : DEFAULT_DAILY_TURNS,
  };
}
