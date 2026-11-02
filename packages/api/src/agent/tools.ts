import { canServicesTeam, type JsonObject, type JsonValue, type ServicesTeamAction, type ServicesTeamRole } from "@jendal-workspace/core";
import { z } from "zod";

import type { ActionDefinition, AnyActionDefinition } from "../actions/define";
import { type PerformRequest, perform } from "../actions/perform";
import { conversationPost, requestListOpen } from "../actions/conversations";
import { disputeList, paymentList } from "../actions/money";
import { payoutApprove, payoutList, payoutReject, payoutRulesGet } from "../actions/payouts";
import { projectGet, projectList } from "../actions/projects";
import { quoteCreate } from "../actions/quotes";

// What the assistant may do with a registry action: read it now, as its person, or propose it for the person to
// confirm. Actions marked never for agents are not listed at all.
export type AgentToolMode = "read" | "propose";

export type AgentTool = {
  name: string;
  mode: AgentToolMode;
  definition: AnyActionDefinition;
  // Offered only to roles that hold this; the action's own checks still run when it is performed.
  needs?: ServicesTeamAction;
  // Runs the action and returns its result as JSON text, for the model or for nothing.
  perform: (request: PerformRequest, input: JsonObject) => Promise<string>;
};

type Typed<Schema extends z.ZodType, Result> = ActionDefinition<z.output<Schema>, Result, z.input<Schema>> & { input: Schema };

function performer<Schema extends z.ZodType, Result>(definition: Typed<Schema, Result>) {
  return async (request: PerformRequest, input: JsonObject): Promise<string> => {
    // SAFETY: perform parses the input with this definition's own schema before anything else runs.
    const result = await perform(request, definition, input as z.input<Schema>);
    return JSON.stringify(result ?? null);
  };
}

// Tool names allow letters, digits, _ and -; registry names use dots.
const toolName = (definition: { name: string }) => definition.name.replaceAll(".", "_");

function read<Schema extends z.ZodType, Result>(definition: Typed<Schema, Result>, needs?: ServicesTeamAction): AgentTool {
  return { name: toolName(definition), mode: "read", definition, needs, perform: performer(definition) };
}

function propose<Schema extends z.ZodType, Result>(definition: Typed<Schema, Result>, needs?: ServicesTeamAction): AgentTool {
  return { name: `propose_${toolName(definition)}`, mode: "propose", definition, needs, perform: performer(definition) };
}

// The first slice (calls design §11, "scope of the work"): intake and money answers, and the decisions the demo
// touches, each confirmed by a person.
export const AGENT_TOOLS: readonly AgentTool[] = [
  read(projectList),
  read(projectGet),
  read(requestListOpen),
  read(payoutList, "approve_payouts"),
  read(payoutRulesGet, "approve_payouts"),
  read(paymentList, "approve_payouts"),
  read(disputeList, "resolve_cases"),
  propose(payoutApprove, "approve_payouts"),
  propose(payoutReject, "approve_payouts"),
  propose(quoteCreate),
  propose(conversationPost),
];

export function toolsFor(role: ServicesTeamRole): AgentTool[] {
  return AGENT_TOOLS.filter((tool) => !tool.needs || canServicesTeam(role, tool.needs));
}

// What the withheld tools cover, in the person's words: a missing tool gives the model no refusal to repeat.
function withheldArea(action: ServicesTeamAction): string {
  switch (action) {
    case "approve_payouts":
      return "the team's payouts, payout rules and client payments";
    case "resolve_cases":
      return "PayPal cases";
    default:
      return action.replaceAll("_", " ");
  }
}

export function withheldAreas(role: ServicesTeamRole): string[] {
  const missing = new Set(AGENT_TOOLS.flatMap((tool) => (tool.needs && !canServicesTeam(role, tool.needs) ? [tool.needs] : [])));
  return [...missing].map(withheldArea);
}

// The tool that proposes a registry action, to run it once the person confirms.
export function proposalTool(action: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.mode === "propose" && tool.definition.name === action);
}

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

// A tool call's input as the model sent it: a JSON object, before the action's own schema reads it.
export const toolInput = z.record(z.string(), jsonValue);

export const proposalInput = z.object({
  card: z.string().trim().min(1).max(400),
  input: toolInput,
});

// The tool's input as the model sees it: the action's own schema, or for a proposal that schema beside a short note.
export function toolSchema(tool: AgentTool) {
  if (tool.mode === "read") return tool.definition.input;
  return z.object({
    card: z.string().trim().min(1).max(400).describe("One sentence for the person: why you propose this."),
    input: tool.definition.input,
  });
}

export function toolDescription(tool: AgentTool): string {
  return tool.mode === "read"
    ? tool.definition.summary
    : `Propose to the person, who confirms or declines it on a card: ${tool.definition.summary} Nothing happens until they confirm.`;
}
