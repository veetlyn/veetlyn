import type { ProjectActor } from "../use-cases/projects";
import type { Actor } from "./actors";
import { ActionError } from "./errors";
import type { Scope } from "./perform";

// The member grant already guarantees a signed-in user with a role; reaching the throw means a definition is
// missing that grant.
export function teamActorOf(context: { actor: Actor; scope: Scope }): ProjectActor {
  const { actor, scope } = context;
  if (actor.kind !== "user" || scope.teamId === null || scope.role === null) {
    throw new ActionError("internal", "A team action ran without a team member.");
  }
  return { teamId: scope.teamId, role: scope.role, actorId: actor.userId };
}
