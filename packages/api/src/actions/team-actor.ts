import type { ProjectActor } from "../use-cases/projects";
import type { Actor } from "./actors";
import { ActionError } from "./errors";
import type { Scope } from "./perform";

// The member grant already guarantees a signed-in user with a role; this narrows the types to match.
export function teamActorOf(context: { actor: Actor; scope: Scope }): ProjectActor {
  const { actor, scope } = context;
  if (actor.kind !== "user" || scope.teamId === null || scope.role === null) {
    throw new ActionError("forbidden", "You cannot do this.");
  }
  return { teamId: scope.teamId, role: scope.role, actorId: actor.userId };
}
