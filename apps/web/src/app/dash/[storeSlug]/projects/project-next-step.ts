import type { ProjectStatus } from "@jendal-workspace/core";

// The list only carries status, so each phrase says what that status alone guarantees. "quoting" cannot tell a draft
// from a sent quote here, so it names the goal, not a specific document. Closed projects have no next step.
export const TEAM_PROJECT_NEXT_STEP = {
  quoting: "Agree a quote with the client",
  awaiting_deposit: "Waiting for the client’s deposit",
  in_progress: "Work underway — deliver when ready",
  delivered: "Waiting for the client to review the delivery",
  awaiting_balance: "Waiting for the client’s final payment",
  completed: null,
  cancelled: null,
  declined: null,
  expired: null,
  abandoned: null,
} as const satisfies Record<ProjectStatus, string | null>;
