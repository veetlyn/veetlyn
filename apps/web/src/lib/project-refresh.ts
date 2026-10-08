// How often a project page checks for the other side's move while it waits on it.
export const PROJECT_REFRESH_MS = 15_000;

// The part of `project.get` and `project.clientGet` that says whose turn it is.
export type ProjectWaitView = {
  project: { status: string };
  quotes: { status: string }[];
  amendments: { status: string }[];
};

const CLIENT_TURN_STATUSES = new Set(["awaiting_deposit", "delivered", "awaiting_balance"]);

function hasProposedQuote(view: ProjectWaitView) {
  return view.quotes.some((q) => q.status === "proposed");
}

function hasPendingAmendment(view: ProjectWaitView) {
  return view.amendments.some((a) => a.status === "pending");
}

export function teamWaitsOnClient(view: ProjectWaitView): boolean {
  return CLIENT_TURN_STATUSES.has(view.project.status) || hasProposedQuote(view) || hasPendingAmendment(view);
}

export function clientWaitsOnTeam(view: ProjectWaitView): boolean {
  if (view.project.status === "quoting") return !hasProposedQuote(view);
  if (view.project.status === "in_progress") return !hasPendingAmendment(view);
  return false;
}
