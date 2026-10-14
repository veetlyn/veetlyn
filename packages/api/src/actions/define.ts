import type { ServicesTeamAction } from "@jendal-workspace/core";
import type { z } from "zod";

import type { Actor, RequestMeta, Surface } from "./actors";
import type { ActionDeps, Scope } from "./perform";

export type Grant =
  | { grant: "member"; permission?: ServicesTeamAction; message?: string }
  | { grant: "client" }
  | { grant: "signed_in" }
  | { grant: "anyone" }
  | { grant: "system" };

export type AgentPolicy = "free" | "confirm" | "never";

export type ScopeRequest = { projectId?: string; teamId?: string };

export type ActionDefinition<Input, Result, Raw = Input> = {
  name: string;
  kind: "action" | "query";
  summary: string;
  input: z.ZodType<Input, Raw>;
  // Wire format (dates as ISO strings); null only for web-only queries.
  output: z.ZodType | null;
  surfaces?: readonly Surface[];
  scope: (input: Input) => ScopeRequest;
  allow: readonly Grant[];
  agent?: AgentPolicy;
  run: (
    context: { deps: ActionDeps; actor: Actor; scope: Scope; surface: Surface; request: RequestMeta },
    input: Input,
  ) => Promise<Result>;
};

// The shape every definition shares, for lists of definitions with different inputs and results.
export type AnyActionDefinition = Omit<ActionDefinition<never, unknown, unknown>, "input"> & { input: z.ZodType };

export function defineAction<Input, Result, Raw>(
  definition: ActionDefinition<Input, Result, Raw>,
): ActionDefinition<Input, Result, Raw> {
  return definition;
}

export function agentPolicyOf(definition: Pick<ActionDefinition<never, never, never>, "kind" | "agent">): AgentPolicy {
  return definition.agent ?? (definition.kind === "query" ? "free" : "confirm");
}
