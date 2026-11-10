import { defineMachine } from "../state-machines/machine";

export const DISPUTE_STATUSES = ["open", "waiting_for_seller", "under_review", "resolved_buyer", "resolved_seller"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

// A PayPal case, as its webhooks report it. PayPal may deliver them out of order, so `open` is only where a case
// starts: a late "created" event never moves a case PayPal already updated back to open, and a resolved case is final.
export const disputeMachine = defineMachine({
  name: "dispute",
  states: DISPUTE_STATUSES,
  initial: "open",
  transitions: {
    wait_for_seller: { from: ["open", "waiting_for_seller", "under_review"], to: "waiting_for_seller" },
    review: { from: ["open", "waiting_for_seller", "under_review"], to: "under_review" },
    resolve_for_seller: { from: ["open", "waiting_for_seller", "under_review"], to: "resolved_seller" },
    resolve_for_buyer: { from: ["open", "waiting_for_seller", "under_review"], to: "resolved_buyer" },
  },
});
export type DisputeEvent = (typeof disputeMachine.events)[number];

// A case still open holds the timers and the payouts it touches.
export const OPEN_DISPUTE_STATUSES = DISPUTE_STATUSES.filter((status) => !disputeMachine.isTerminal(status));

// The status a case should hold after `event`: a case first seen through a later event starts at that event's status.
export function disputeStatusAfter(current: DisputeStatus | null, event: DisputeEvent | "created"): DisputeStatus {
  if (event === "created") return current ?? disputeMachine.initial;
  if (current === null) return disputeMachine.transitions[event].to;
  return disputeMachine.next(current, event) ?? current;
}
