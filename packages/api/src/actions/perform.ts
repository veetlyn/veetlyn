import type { FileStore, ServicesTeamRole } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import { insertActionLog } from "@jendal-workspace/db/repositories/action-log";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";

import type { LinkSecretSource } from "../client-links";
import type { EmailServices, PayoutServices, PayPalServices } from "../context";
import { type Actor, isClientActor, personOf, type RequestMeta, type Surface } from "./actors";
import { type ActionDefinition, agentPolicyOf, type Grant, type ScopeRequest } from "./define";
import { ActionError, type ActionErrorCode, toActionError } from "./errors";

export type ActionRuntime = {
  db: DbExecutor;
  onLogError?: (cause: unknown) => void;
};

export type ActionDeps = ActionRuntime & {
  db: Database;
  platformName: string;
  files: FileStore;
  auth: LinkSecretSource;
  paypal?: PayPalServices;
  payouts?: PayoutServices;
  email?: EmailServices;
  now?: () => Date;
};

export type Scope = { teamId: string | null; project: ProjectRow | null; role: ServicesTeamRole | null };

export type PerformRequest<Deps extends ActionRuntime = ActionDeps> = {
  deps: Deps;
  actor: Actor;
  surface: Surface;
  request: RequestMeta;
  // Resolved by an adapter from a team slug; must match the project's team.
  team?: { id: string };
};

const NOT_FOUND_PROJECT = "Project not found.";

async function loadScope(req: PerformRequest<ActionRuntime>, scopeRequest: ScopeRequest): Promise<Scope> {
  let project: ProjectRow | null = null;
  if (scopeRequest.teamId && req.team && scopeRequest.teamId !== req.team.id) {
    throw new ActionError("not_found", "Team not found.");
  }
  let teamId = scopeRequest.teamId ?? req.team?.id ?? null;
  if (scopeRequest.projectId) {
    project = await findProjectById(req.deps.db, scopeRequest.projectId);
    // A link holder learns only that the link does not work, as for a forged one.
    if (!project && isClientActor(req.actor)) throw new ActionError("not_found", "This link is not valid.");
    if (!project || (teamId && project.teamId !== teamId)) throw new ActionError("not_found", NOT_FOUND_PROJECT);
    teamId = project.teamId;
  }
  const person = personOf(req.actor);
  const role = teamId && person ? await servicesTeamRoleFor(req.deps.db, teamId, person) : null;
  return { teamId, project, role };
}

function passes(grant: Grant, actor: Actor, scope: Scope): boolean {
  switch (grant.grant) {
    case "member":
      return scope.role !== null;
    case "client":
      return isClientActor(actor) && scope.project !== null && actor.token.projectId === scope.project.id;
    case "signed_in":
      return personOf(actor) !== null;
    case "anyone":
      return true;
    case "system":
      return actor.kind === "system";
  }
}

// Someone with no relation to the team or project learns nothing about it; a client link relates to its own
// project only.
function refusal(actor: Actor, scope: Scope): ActionError {
  const related =
    scope.role !== null || (isClientActor(actor) && actor.token.projectId === scope.project?.id);
  if (!related && scope.project) return new ActionError("not_found", NOT_FOUND_PROJECT);
  if (!related && scope.teamId) return new ActionError("not_found", "Team not found.");
  return new ActionError("forbidden", "You cannot do this.");
}

function actorId(actor: Actor): string | null {
  switch (actor.kind) {
    case "user":
    case "client_account":
      return actor.userId;
    case "system":
      return actor.job;
    case "agent":
      return actor.agentId;
    case "client_link":
    case "anonymous":
      return null;
  }
}

async function writeLog(
  req: PerformRequest<ActionRuntime>,
  definition: Pick<ActionDefinition<never, never, never>, "name" | "kind">,
  scope: Scope,
  outcome: "ok" | ActionErrorCode,
  message: string | null,
  started: number,
): Promise<void> {
  if (definition.kind === "query" && req.surface === "web") return;
  try {
    await insertActionLog(req.deps.db, {
      requestId: req.request.requestId,
      action: definition.name,
      surface: req.surface,
      teamId: scope.teamId,
      projectId: scope.project?.id ?? null,
      actorKind: req.actor.kind,
      actorId: actorId(req.actor),
      onBehalfOf:
        req.actor.kind === "agent" ? { kind: req.actor.onBehalfOf.kind, id: actorId(req.actor.onBehalfOf) } : null,
      ip: req.request.ip,
      outcome,
      message,
      durationMs: Date.now() - started,
    });
  } catch (cause) {
    try {
      req.deps.onLogError?.(cause);
    } catch {
      // A failing error reporter must not fail an action that already ran.
    }
  }
}

// A refusal decided before the action runs (a team member holding a client link) is logged like one decided in it.
export async function logRefusal(
  req: PerformRequest,
  definition: Pick<ActionDefinition<never, never, never>, "name" | "kind">,
  projectId: string,
  message: string,
): Promise<void> {
  const project = (await findProjectById(req.deps.db, projectId)) ?? null;
  await writeLog(req, definition, { teamId: project?.teamId ?? null, project, role: null }, "forbidden", message, Date.now());
}

export async function perform<Input, Result, Raw, Deps extends ActionRuntime = ActionDeps>(
  req: PerformRequest<Deps>,
  definition: ActionDefinition<Input, Result, Raw, Deps>,
  rawInput: Raw,
): Promise<Result> {
  const started = Date.now();
  let scope: Scope = { teamId: req.team?.id ?? null, project: null, role: null };
  try {
    // An agent reads what its person may read. It proposes everything else, and a person confirms it as themselves.
    if (req.actor.kind === "agent") {
      const policy = agentPolicyOf(definition);
      if (policy === "never") throw new ActionError("forbidden", "Only a person can do this.");
      if (policy === "confirm") throw new ActionError("forbidden", "This needs a person's confirmation.");
      if (req.actor.onBehalfOf.kind !== "user") throw new ActionError("forbidden", "An agent works only for a signed-in person.");
    }
    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.map(String).join(".") || "input";
        (details[key] ??= []).push(issue.message);
      }
      throw new ActionError("invalid", "Check the highlighted fields.", { details });
    }
    scope = await loadScope(req, definition.scope(parsed.data));
    if (!definition.allow.some((grant) => passes(grant, req.actor, scope))) throw refusal(req.actor, scope);
    const result = await definition.run(
      { deps: req.deps, actor: req.actor, scope, surface: req.surface, request: req.request },
      parsed.data,
    );
    await writeLog(req, definition, scope, "ok", null, started);
    return result;
  } catch (thrown) {
    const error = toActionError(thrown);
    await writeLog(req, definition, scope, error.code, error.logMessage ?? error.message, started);
    throw error;
  }
}
