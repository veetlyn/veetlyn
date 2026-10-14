import type { z } from "zod";

import type { Actor, RequestMeta, Surface } from "./actors";
import type { ActionDeps, Scope } from "./perform";

export type Grant =
  | { grant: "member" }
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

// Keeps the schema's own type and the literal kind, so an adapter can reshape the input and pick a query or a
// mutation at the type level.
export function defineAction<Schema extends z.ZodType, Result, Kind extends ActionDefinition<never, never>["kind"]>(
  definition: ActionDefinition<z.output<Schema>, Result, z.input<Schema>> & { input: Schema; kind: Kind },
): ActionDefinition<z.output<Schema>, Result, z.input<Schema>> & { input: Schema; kind: Kind } {
  return definition;
}

export function agentPolicyOf(definition: Pick<ActionDefinition<never, never, never>, "kind" | "agent">): AgentPolicy {
  return definition.agent ?? (definition.kind === "query" ? "free" : "confirm");
}
