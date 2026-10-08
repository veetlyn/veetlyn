import type { QuotingMode, ServicesTeamRole } from "../services-teams/types";
import type { ProjectStatus } from "./state-machine";

export function isProjectStaff(role: ServicesTeamRole): boolean {
  return role === "admin" || role === "manager";
}

// Services spec §4.1: managers (and admins) start projects and assign freelancers.
export function canStartProject(role: ServicesTeamRole): boolean {
  return isProjectStaff(role);
}

export function canAssignFreelancer(role: ServicesTeamRole): boolean {
  return isProjectStaff(role);
}

export type QuoteAuthorRefusal = "not_allowed" | "not_assigned" | "freelancer_required";
export type QuoteAuthorResult = { ok: true; freelancerId: string } | { ok: false; reason: QuoteAuthorRefusal };

// Services spec §4.3: in `open` any freelancer quotes for their own work and staff quote for a named
// freelancer; in `assigned` only the assigned freelancer quotes; in `team` staff quote, naming the freelancer.
export function quoteAuthor(input: {
  role: ServicesTeamRole;
  actorId: string;
  quotingMode: QuotingMode;
  assignedFreelancerId: string | null;
  freelancerId?: string | null;
  solo?: boolean;
}): QuoteAuthorResult {
  const staff = isProjectStaff(input.role);
  // Sellers design §3.1: a solo seller is the freelancer, so there is no assignment step (backlog, run 3).
  if (input.solo && staff) return { ok: true, freelancerId: input.actorId };
  const named = input.freelancerId ?? null;
  switch (input.quotingMode) {
    case "open":
      if (!staff) {
        return named === null || named === input.actorId
          ? { ok: true, freelancerId: input.actorId }
          : { ok: false, reason: "not_allowed" };
      }
      return named ? { ok: true, freelancerId: named } : { ok: false, reason: "freelancer_required" };
    case "assigned":
      if (!input.assignedFreelancerId) return { ok: false, reason: "not_assigned" };
      return input.actorId === input.assignedFreelancerId
        ? { ok: true, freelancerId: input.assignedFreelancerId }
        : { ok: false, reason: "not_allowed" };
    case "team":
      if (!staff) return { ok: false, reason: "not_allowed" };
      return named ? { ok: true, freelancerId: named } : { ok: false, reason: "freelancer_required" };
  }
}

export function quoteAuthorRefusalMessage(reason: QuoteAuthorRefusal): string {
  switch (reason) {
    case "not_allowed":
      return "Your role cannot quote on this project in this team's quoting mode.";
    case "not_assigned":
      return "Assign a freelancer first; in this team the assigned freelancer quotes.";
    case "freelancer_required":
      return "Choose the freelancer who will do the work.";
  }
}

// Services spec §5.5: the assigned freelancer or a manager proposes amendments.
export function canProposeAmendment(input: {
  role: ServicesTeamRole;
  actorId: string;
  assignedFreelancerId: string | null;
}): boolean {
  return isProjectStaff(input.role) || input.actorId === input.assignedFreelancerId;
}

// Services spec §5.2 step 5: the assigned freelancer submits the delivery; staff can submit it for them.
export function canSubmitDelivery(input: {
  role: ServicesTeamRole;
  actorId: string;
  assignedFreelancerId: string | null;
}): boolean {
  return isProjectStaff(input.role) || input.actorId === input.assignedFreelancerId;
}

// Freelancers see the projects assigned to them, and quoting projects when anyone in the team may quote.
export function canSeeProject(input: {
  role: ServicesTeamRole;
  actorId: string;
  assignedFreelancerId: string | null;
  status: ProjectStatus;
  quotingMode: QuotingMode;
}): boolean {
  if (isProjectStaff(input.role) || input.actorId === input.assignedFreelancerId) return true;
  return input.quotingMode === "open" && input.status === "quoting";
}
