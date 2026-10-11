export const PROJECT_STATUSES = [
  "quoting",
  "awaiting_deposit",
  "in_progress",
  "delivered",
  "awaiting_balance",
  "completed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Where a project came from: the admin, or a request from the seller page (sellers design §4.2, run 3b).
export const PROJECT_SOURCES = ["admin", "web"] as const;
export type ProjectSource = (typeof PROJECT_SOURCES)[number];

export const PROJECT_EVENTS = [
  "add_quote",
  "assign_freelancer",
  "accept_quote",
  "deposit_captured",
  "submit_delivery",
  "request_changes",
  "propose_amendment",
  "accept_amendment",
  "decline_amendment",
  "accept_delivery",
  "balance_captured",
  "cancel",
] as const;

export type ProjectEvent = (typeof PROJECT_EVENTS)[number];

// What the guards need to know beyond the status. Callers read these in the same transaction as the change.
export type ProjectFacts = {
  pendingAmendment: boolean;
  unpaidTopUp: boolean;
  balanceDueMinor: number;
};

export type TransitionRefusal = "not_allowed_in_status" | "pending_amendment" | "unpaid_top_up" | "no_pending_amendment";

export type TransitionResult = { ok: true; to: ProjectStatus } | { ok: false; reason: TransitionRefusal };

type TransitionRule = {
  from: readonly ProjectStatus[];
  to: (facts: ProjectFacts) => ProjectStatus | "unchanged";
  guard?: (facts: ProjectFacts) => TransitionRefusal | null;
};

// The statuses where a project is still open: it can take a quote, a delivery, or a cancellation.
export const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = [
  "quoting",
  "awaiting_deposit",
  "in_progress",
  "delivered",
  "awaiting_balance",
];
const WORKING: readonly ProjectStatus[] = ["in_progress", "delivered"];

// The extra work of an increase starts when its top-up is captured (services spec §5.5), so nothing
// that builds on the current quote may run while a top-up is unpaid.
function noOpenAmendmentMoney(facts: ProjectFacts): TransitionRefusal | null {
  if (facts.pendingAmendment) return "pending_amendment";
  if (facts.unpaidTopUp) return "unpaid_top_up";
  return null;
}

function hasPendingAmendment(facts: ProjectFacts): TransitionRefusal | null {
  return facts.pendingAmendment ? null : "no_pending_amendment";
}

// Services spec §5.1 and §5.2. Any move not listed here is rejected.
export const PROJECT_TRANSITIONS = {
  add_quote: { from: ["quoting"], to: () => "unchanged" },
  assign_freelancer: { from: ["quoting"], to: () => "unchanged" },
  accept_quote: { from: ["quoting"], to: () => "awaiting_deposit" },
  deposit_captured: { from: ["awaiting_deposit"], to: () => "in_progress" },
  submit_delivery: { from: ["in_progress"], to: () => "delivered" },
  request_changes: { from: ["delivered"], to: () => "in_progress" },
  propose_amendment: { from: WORKING, to: () => "unchanged", guard: noOpenAmendmentMoney },
  accept_amendment: { from: WORKING, to: () => "unchanged", guard: hasPendingAmendment },
  decline_amendment: { from: WORKING, to: () => "unchanged", guard: hasPendingAmendment },
  // With nothing left to pay (penalties or decreases), the project completes without a balance payment (§5.3).
  accept_delivery: {
    from: ["delivered"],
    to: (facts) => (facts.balanceDueMinor > 0 ? "awaiting_balance" : "completed"),
    guard: noOpenAmendmentMoney,
  },
  balance_captured: { from: ["awaiting_balance"], to: () => "completed" },
  cancel: { from: OPEN_PROJECT_STATUSES, to: () => "cancelled" },
} satisfies Readonly<Record<ProjectEvent, TransitionRule>>;

const NO_FACTS: ProjectFacts = { pendingAmendment: false, unpaidTopUp: false, balanceDueMinor: 0 };

export function transitionProject(
  from: ProjectStatus,
  event: ProjectEvent,
  facts: Partial<ProjectFacts> = {},
): TransitionResult {
  const rule: TransitionRule = PROJECT_TRANSITIONS[event];
  if (!rule.from.includes(from)) return { ok: false, reason: "not_allowed_in_status" };
  const all = { ...NO_FACTS, ...facts };
  const refusal = rule.guard?.(all) ?? null;
  if (refusal) return { ok: false, reason: refusal };
  const to = rule.to(all);
  return { ok: true, to: to === "unchanged" ? from : to };
}

export function allowedProjectEvents(from: ProjectStatus, facts: Partial<ProjectFacts> = {}): ProjectEvent[] {
  return PROJECT_EVENTS.filter((event) => transitionProject(from, event, facts).ok);
}

export function transitionRefusalMessage(reason: TransitionRefusal): string {
  switch (reason) {
    case "not_allowed_in_status":
      return "This action is not available at this stage of the project.";
    case "pending_amendment":
      return "An amendment is waiting for the client's answer.";
    case "unpaid_top_up":
      return "The top-up for the last amendment is not paid yet.";
    case "no_pending_amendment":
      return "There is no amendment waiting for an answer.";
  }
}

export const PROJECT_STATUS_LABELS = {
  quoting: "Quoting",
  awaiting_deposit: "Awaiting deposit",
  in_progress: "In progress",
  delivered: "Delivered",
  awaiting_balance: "Awaiting balance",
  completed: "Completed",
  cancelled: "Cancelled",
} satisfies Record<ProjectStatus, string>;

export function projectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_LABELS[status];
}
