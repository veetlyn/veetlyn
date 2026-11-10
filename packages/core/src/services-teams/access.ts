import type { ProjectStatus } from "../projects/state-machine";
import { canServicesTeam } from "./permissions";
import type { ServicesTeamRole } from "./types";

// What an admin has set for one member beyond their role (calls design, Amendments 7). Limits only take away. The one
// thing that adds is reading Money, which never lets anyone approve, send or change anything.
export const HIDEABLE_AREAS = ["requests", "projects", "storefront"] as const;
export type HideableArea = (typeof HIDEABLE_AREAS)[number];

export type MemberAccess = { hidden: readonly HideableArea[]; hideProjectFinances: boolean; moneyViewer: boolean };

export const FULL_ACCESS: MemberAccess = { hidden: [], hideProjectFinances: false, moneyViewer: false };

// An admin can undo any limit, so limits never apply to one.
export function effectiveMemberAccess(role: ServicesTeamRole | null, stored: MemberAccess | null): MemberAccess {
  return role === "admin" || stored === null ? FULL_ACCESS : stored;
}

export function canReadMoney(role: ServicesTeamRole | null, access: MemberAccess): boolean {
  return role !== null && (access.moneyViewer || canServicesTeam(role, "approve_payouts"));
}

// A request is a project still being quoted.
export function projectArea(status: ProjectStatus): "requests" | "projects" {
  return status === "quoting" ? "requests" : "projects";
}

export function projectHidden(access: MemberAccess, status: ProjectStatus): boolean {
  return access.hidden.includes(projectArea(status));
}

// open: the role's own checks decide. record: follows the project's area. finance: a record action that moves or sets a
// price. Every action a team member can run is listed here; an unlisted one is refused to anyone with limits.
type ActionRule = "open" | HideableArea | "record" | "finance";

const rules = (rule: ActionRule, names: readonly string[]) => names.map((name) => [name, rule] as const);

const ACTION_RULES = new Map<string, ActionRule>([
  ...rules("open", [
    "project.list", // filtered row by row
    "member.departments",
    "team.members", // names and roles only, for assigning work
    // Admins only, or read through canReadMoney.
    "payment.list",
    "dispute.list",
    "payout.list",
    "payout.balances",
    "payout.rules.get",
    "payout.rules.save",
    "payout.rules.preset",
    "payout.credentials.get",
    "payout.credentials.remove",
    "payout.connect.start",
    "payout.connect.complete",
    "payout.approve",
    "payout.reject",
    "payout.retry",
    "payout.refresh",
    "payout.web.export",
    "payout.web.import",
    "payout.web.cancel",
  ]),
  ...rules("requests", ["request.list_open"]),
  ...rules("projects", ["project.start"]),
  ...rules("storefront", ["order.list"]),
  ...rules("record", [
    "project.get",
    "project.assign",
    "project.warning.record",
    "project.client.add",
    "project.client.remove",
    "project.client_link.email",
    "project.client_link.reissue",
    "project.client_preview",
    "delivery.upload_start",
    "delivery.submit",
    "delivery.file_url",
    "conversation.post",
    "conversation.answer",
    "request.decline",
    "request.shortlist",
  ]),
  ...rules("finance", [
    "quote.create",
    "amendment.propose",
    "amendment.offer_paid_revision",
    "project.refund_client",
    "project.late_refund.decide",
    "project.quality_refund.set",
  ]),
]);

export function isClassifiedAction(name: string): boolean {
  return ACTION_RULES.has(name);
}

export function isFinanceAction(name: string): boolean {
  return ACTION_RULES.get(name) === "finance";
}

export const hasNoLimits = (access: MemberAccess) => access.hidden.length === 0 && !access.hideProjectFinances;

// Whether this person's limits stop the action. With no project known, a record action is stopped only when both areas
// it could fall in are hidden.
export function accessRefuses(name: string, access: MemberAccess, status: ProjectStatus | null): boolean {
  if (hasNoLimits(access)) return false;
  const rule = ACTION_RULES.get(name);
  if (rule === undefined) return true;
  if (rule === "open") return false;
  if (rule === "requests" || rule === "projects" || rule === "storefront") return access.hidden.includes(rule);
  if (rule === "finance" && access.hideProjectFinances) return true;
  if (status !== null) return projectHidden(access, status);
  return access.hidden.includes("requests") && access.hidden.includes("projects");
}
