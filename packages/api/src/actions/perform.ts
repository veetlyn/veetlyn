import type { FileStore, ServicesTeamRole } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { insertActionLog } from "@jendal-workspace/db/repositories/action-log";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";

import type { LinkSecretSource } from "../client-links";
import type { EmailServices, PayPalServices } from "../context";
import type { Actor, RequestMeta, Surface } from "./actors";
import type { ActionDefinition, Grant, ScopeRequest } from "./define";
import { ActionError, toActionError } from "./errors";

export type ActionDeps = {
  db: Database;
  files: FileStore;
  auth: LinkSecretSource;
  paypal?: PayPalServices;
  email?: EmailServices;
  now?: () => Date;
  onLogError?: (cause: unknown) => void;
};

export type Scope = { teamId: string | null; project: ProjectRow | null; role: ServicesTeamRole | null };

export type PerformRequest = {
  deps: ActionDeps;
  actor: Actor;
  surface: Surface;
  request: RequestMeta;
  // Resolved by an adapter from a team slug; must match the project's team.
  team?: { id: string };
};

const NOT_FOUND_PROJECT = "Project not found.";

async function loadScope(req: PerformRequest, scopeRequest: ScopeRequest): Promise<Scope> {
  let project: ProjectRow | null = null;
  if (scopeRequest.teamId && req.team && scopeRequest.teamId !== req.team.id) {
    throw new ActionError("not_found", "Team not found.");
  }
  let teamId = scopeRequest.teamId ?? req.team?.id ?? null;
  if (scopeRequest.projectId) {
    project = await findProjectById(req.deps.db, scopeRequest.projectId);
    if (!project || (teamId && project.teamId !== teamId)) throw new ActionError("not_found", NOT_FOUND_PROJECT);
    teamId = project.teamId;
  }
  const role =
    teamId && req.actor.kind === "user" ? await servicesTeamRoleFor(req.deps.db, teamId, req.actor.userId) : null;
  return { teamId, project, role };
}

function passes(grant: Grant, actor: Actor, scope: Scope): boolean {
  switch (grant.grant) {
    case "member":
      return scope.role !== null;
    case "client":
      return actor.kind === "client_link" && scope.project !== null && actor.token.projectId === scope.project.id;
    case "signed_in":
      return actor.kind === "user";
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
    scope.role !== null || (actor.kind === "client_link" && actor.token.projectId === scope.project?.id);
  if (!related && scope.project) return new ActionError("not_found", NOT_FOUND_PROJECT);
  if (!related && scope.teamId) return new ActionError("not_found", "Team not found.");
  return new ActionError("forbidden", "You cannot do this.");
}

function actorId(actor: Actor): string | null {
  switch (actor.kind) {
    case "user":
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
  req: PerformRequest,
  definition: Pick<ActionDefinition<never, never, never>, "name" | "kind">,
  scope: Scope,
  outcome: string,
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

export async function perform<Input, Result, Raw>(
  req: PerformRequest,
  definition: ActionDefinition<Input, Result, Raw>,
  rawInput: Raw,
): Promise<Result> {
  const started = Date.now();
  let scope: Scope = { teamId: req.team?.id ?? null, project: null, role: null };
  try {
    // Agents only propose once proposals exist; until then they are refused whatever the policy.
    if (req.actor.kind === "agent") throw new ActionError("forbidden", "Agents cannot do this yet.");
    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.map(String).join(".") || "input";
        (details[key] ??= []).push(issue.message);
      }
      throw new ActionError("invalid", "Check the highlighted fields.", { details, trpcCode: "BAD_REQUEST" });
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
    await writeLog(req, definition, scope, error.code, error.message, started);
    throw error;
  }
}
