import { hasStoreWideRole } from "../tenancy/access";
import type { ServicesTeamRole } from "./types";

// Services spec §4.1. Quoting also depends on the team's quoting mode, which the quote use case checks.
export type ServicesTeamAction =
  | "view_team"
  | "view_members"
  | "manage_members"
  | "manage_settings"
  | "manage_connections"
  | "manage_developers"
  | "approve_payouts"
  | "resolve_cases"
  | "start_project"
  | "quote_for_team"
  | "assign_freelancers"
  | "quote"
  | "deliver"
  | "request_payout"
  | "file_case";

const MANAGER_ACTIONS: readonly ServicesTeamAction[] = [
  "view_team",
  "view_members",
  "start_project",
  "quote_for_team",
  "assign_freelancers",
  "file_case",
];

const ADMIN_ONLY_ACTIONS: readonly ServicesTeamAction[] = [
  "manage_members",
  "manage_settings",
  "manage_connections",
  "manage_developers",
  "approve_payouts",
  "resolve_cases",
];

const FREELANCER_ACTIONS: readonly ServicesTeamAction[] = ["view_team", "quote", "deliver", "request_payout", "file_case"];

const ACTIONS_BY_ROLE = {
  admin: new Set([...MANAGER_ACTIONS, ...ADMIN_ONLY_ACTIONS]),
  manager: new Set(MANAGER_ACTIONS),
  freelancer: new Set(FREELANCER_ACTIONS),
} satisfies Record<ServicesTeamRole, ReadonlySet<ServicesTeamAction>>;

export function canServicesTeam(role: ServicesTeamRole | null, action: ServicesTeamAction): boolean {
  return role !== null && ACTIONS_BY_ROLE[role].has(action);
}

// `workspaceRole` is the Better Auth member role in the team's organization (comma-separated when several).
export function effectiveServicesTeamRole(
  workspaceRole: string,
  teamRole: ServicesTeamRole | null,
): ServicesTeamRole | null {
  return hasStoreWideRole(workspaceRole) ? "admin" : teamRole;
}
