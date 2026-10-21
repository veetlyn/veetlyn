import { isProjectStaff } from "../projects/permissions";
import type { ProjectStatus } from "../projects/state-machine";
import type { QuotingMode, ServicesTeamRole } from "../services-teams/types";
import type { ConversationSpace } from "./types";

// The client is resolved before this rule runs: a team member is never the project's client (A2 §5.4).
export type Viewer =
  | { kind: "member"; role: ServicesTeamRole; userId: string; departmentIds: readonly string[] }
  | { kind: "client" }
  | { kind: "stranger" };

export type AccessFacts = {
  quotingMode: QuotingMode;
  // The offering's department; null for "Something else" or an ungrouped offering.
  departmentId: string | null;
  // Staff's shortlist for this request; empty means the department rule applies.
  shortlist: readonly string[];
  status: ProjectStatus;
  // Before acceptance, who staff assigned; from acceptance on, the accepted quote's freelancer.
  assignedFreelancerId: string | null;
};

export type ConversationAccess = { read: ConversationSpace[]; write: ConversationSpace[] };

// A project in one of these takes no new messages; what was said stays readable.
const CLOSED: readonly ProjectStatus[] = ["completed", "cancelled", "declined", "expired"];

function inRequestAudience(viewer: Extract<Viewer, { kind: "member" }>, facts: AccessFacts): boolean {
  if (viewer.userId === facts.assignedFreelancerId) return true;
  // Assigned mode keeps the request to staff and the assignee, as project visibility did before conversations.
  if (facts.quotingMode === "assigned") return false;
  if (facts.shortlist.length > 0) return facts.shortlist.includes(viewer.userId);
  return facts.departmentId === null || viewer.departmentIds.includes(facts.departmentId);
}

// Conversations design §4 and §5: the spaces a viewer reads and writes. The request space is open while the
// project is quoting; the project space holds the client and staff from the start and the accepted freelancer
// from acceptance.
export function conversationAccess(viewer: Viewer, facts: AccessFacts): ConversationAccess {
  const quoting = facts.status === "quoting";
  const open = !CLOSED.includes(facts.status);
  const only = (allowed: boolean, space: ConversationSpace): ConversationSpace[] => (allowed ? [space] : []);
  switch (viewer.kind) {
    case "stranger":
      return { read: [], write: [] };
    case "client":
      return { read: ["project"], write: only(open, "project") };
    case "member": {
      if (isProjectStaff(viewer.role)) {
        return { read: ["request", "project"], write: [...only(quoting, "request"), ...only(open, "project")] };
      }
      if (quoting) return inRequestAudience(viewer, facts) ? { read: ["request"], write: ["request"] } : { read: [], write: [] };
      const winner = facts.assignedFreelancerId === viewer.userId && facts.status !== "declined" && facts.status !== "expired";
      return winner ? { read: ["project"], write: only(open, "project") } : { read: [], write: [] };
    }
  }
}

// Request-space activity is relayed into the project space (design §2), so whoever reads the project space
// also reads the request space's messages, as shown (masked) to everyone.
export function readableSpaces(access: ConversationAccess): ConversationSpace[] {
  return access.read.includes("project") ? ["project", "request"] : access.read;
}

// The client writes once and Payleor places the message (design §4): before acceptance a reply reaches the
// freelancers looking at the request unless it is for the team only; afterwards everything is the project's.
export function clientMessageSpace(status: ProjectStatus, teamOnly: boolean): ConversationSpace {
  return status === "quoting" && !teamOnly ? "request" : "project";
}

// Freelancers see the projects assigned to them, and the requests the conversation audience rule opens to them
// (conversations design §4): their departments, a shortlist, or every freelancer when the request has neither.
export function canSeeProject(input: {
  role: ServicesTeamRole;
  actorId: string;
  departmentIds: readonly string[];
  facts: AccessFacts;
}): boolean {
  if (isProjectStaff(input.role) || input.actorId === input.facts.assignedFreelancerId) return true;
  const viewer = { kind: "member", role: input.role, userId: input.actorId, departmentIds: input.departmentIds } as const;
  return conversationAccess(viewer, input.facts).read.length > 0;
}
