import {
  accessRefuses,
  canServicesTeam,
  FULL_ACCESS,
  type JsonObject,
  type JsonValue,
  type MemberAccess,
  type ServicesTeamAction,
  type ServicesTeamRole,
} from "@jendal-workspace/core";
import type { SellerRole } from "@jendal-workspace/core/context/node";
import { z } from "zod";

import type { ActionDefinition, AnyActionDefinition } from "../actions/define";
import { type PerformRequest, perform } from "../actions/perform";
import { conversationPost, requestListOpen } from "../actions/conversations";
import { disputeList, paymentList } from "../actions/money";
import { payoutApprove, payoutBalances, payoutList, payoutMine, payoutReject, payoutRulesGet } from "../actions/payouts";
import { projectAssign, projectClientList, projectGet, projectList, teamMembers } from "../actions/projects";
import { orderList, productList, workspaceListMine, workspaceSummary } from "../actions/sellers";
import { amendmentPropose, quoteCreate } from "../actions/quotes";

// What the assistant may do with a registry action: read it now, as its person, or propose it for the person to
// confirm. Actions marked never for agents are not listed at all.
export type AgentToolMode = "read" | "propose";

// The nodes a tool serves: a services team and everything below it, a store and everything below it, a workspace, or
// the person's account.
export type ToolPlace = "services" | "store" | "workspace" | "account";

export type AgentTool = {
  name: string;
  mode: AgentToolMode;
  place: ToolPlace;
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

function read<Schema extends z.ZodType, Result>(definition: Typed<Schema, Result>, needs?: ServicesTeamAction, place: ToolPlace = "services"): AgentTool {
  return { name: toolName(definition), mode: "read", place, definition, needs, perform: performer(definition) };
}

function propose<Schema extends z.ZodType, Result>(definition: Typed<Schema, Result>, needs?: ServicesTeamAction): AgentTool {
  return { name: `propose_${toolName(definition)}`, mode: "propose", place: "services", definition, needs, perform: performer(definition) };
}

// The first slice (calls design §11, "scope of the work"): intake and money answers, and the decisions the demo
// touches, each confirmed by a person.
export const AGENT_TOOLS: readonly AgentTool[] = [
  read(projectList),
  read(projectGet),
  read(teamMembers),
  read(requestListOpen),
  read(payoutList, "approve_payouts"),
  read(payoutBalances, "approve_payouts"),
  read(payoutRulesGet, "approve_payouts"),
  read(paymentList, "approve_payouts"),
  read(disputeList, "resolve_cases"),
  propose(payoutApprove, "approve_payouts"),
  propose(payoutReject, "approve_payouts"),
  propose(quoteCreate),
  propose(projectAssign),
  propose(amendmentPropose),
  propose(conversationPost),
  read(productList, undefined, "store"),
  read(orderList, undefined, "store"),
  read(workspaceSummary, undefined, "workspace"),
  read(workspaceListMine, undefined, "account"),
  read(projectClientList, undefined, "account"),
  read(payoutMine, undefined, "account"),
];

// Where a resolved node puts the assistant: under a seller of either kind, in a workspace, or at the account.
export function toolPlaceOf(node: { seller: { role: SellerRole } | null; workspace: unknown }): ToolPlace {
  if (node.seller) return node.seller.role.product;
  return node.workspace ? "workspace" : "account";
}

// The tools at a node, for the person's role there. Services tools also need the role's permission; the action's own
// checks still run when it is performed.
export function toolsFor(node: { seller: { role: SellerRole; access?: MemberAccess } | null; workspace: unknown }): AgentTool[] {
  const place = toolPlaceOf(node);
  const role = node.seller?.role.product === "services" ? node.seller.role.role : null;
  const access = node.seller?.access ?? FULL_ACCESS;
  const roleAllows = (tool: AgentTool) =>
    !tool.needs ||
    canServicesTeam(role, tool.needs) ||
    (access.moneyViewer && tool.mode === "read" && (tool.needs === "approve_payouts" || tool.needs === "resolve_cases"));
  return AGENT_TOOLS.filter((tool) => tool.place === place && roleAllows(tool) && !accessRefuses(tool.definition.name, access, null));
}

// The propose tools a team has switched off for its agent.
export function allowedByTeam(tool: AgentTool, limits: { agentQuotes: boolean; agentMessages: boolean; agentPayouts: boolean } | null): boolean {
  if (!limits || tool.mode !== "propose") return true;
  if (tool.definition.name === quoteCreate.name) return limits.agentQuotes;
  if (tool.definition.name === conversationPost.name) return limits.agentMessages;
  return limits.agentPayouts;
}

// The actions `/` offers, in the words it writes into the message. Plain language reaches the same tools.
const SHORTCUTS = new Map<string, { label: string; phrase: string }>([
  [quoteCreate.name, { label: "Prepare a quote", phrase: "Prepare a quote for " }],
  [conversationPost.name, { label: "Draft a message to the client", phrase: "Draft a message to the client on " }],
  [payoutApprove.name, { label: "Approve a payout", phrase: "Approve the payout for " }],
  [payoutReject.name, { label: "Reject a payout", phrase: "Reject the payout for " }],
]);

// What this person can start from the composer at this node. A suggestion only: every action is checked again when it runs.
export function composerActions(
  node: Parameters<typeof toolsFor>[0],
  limits: Parameters<typeof allowedByTeam>[1],
): { label: string; phrase: string }[] {
  return toolsFor(node).flatMap((tool) => {
    const shortcut = tool.mode === "propose" && allowedByTeam(tool, limits) ? SHORTCUTS.get(tool.definition.name) : undefined;
    return shortcut ? [shortcut] : [];
  });
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

export function withheldAreas(role: ServicesTeamRole | null): string[] {
  if (role === null) return [];
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
