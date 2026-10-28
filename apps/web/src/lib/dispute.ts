export type DisputeStatus = "open" | "waiting_for_seller" | "under_review" | "resolved_buyer" | "resolved_seller";

export const DISPUTE_STATUS_LABELS = {
  open: "Open",
  waiting_for_seller: "Waiting for the team's answer",
  under_review: "Under review by PayPal",
  resolved_buyer: "Closed in the client's favour",
  resolved_seller: "Closed in the team's favour",
} as const satisfies Record<DisputeStatus, string>;

// PayPal's reason and outcome codes; an unknown one shows as sent.
export const DISPUTE_REASON_LABELS: ReadonlyMap<string, string> = new Map([
  ["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "Not received"],
  ["MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", "Not as described"],
  ["UNAUTHORISED", "Unauthorised payment"],
  ["CREDIT_NOT_PROCESSED", "Refund not processed"],
  ["DUPLICATE_TRANSACTION", "Duplicate payment"],
  ["INCORRECT_AMOUNT", "Incorrect amount"],
  ["PAYMENT_BY_OTHER_MEANS", "Paid by other means"],
  ["CANCELED_RECURRING_BILLING", "Cancelled recurring billing"],
  ["PROBLEM_WITH_REMITTANCE", "Problem with remittance"],
  ["OTHER", "Other"],
]);

export const DISPUTE_OUTCOME_LABELS: ReadonlyMap<string, string> = new Map([
  ["RESOLVED_SELLER_FAVOUR", "PayPal decided for the team"],
  ["CANCELED_BY_BUYER", "The client cancelled the case"],
  ["RESOLVED_BUYER_FAVOUR", "PayPal decided for the client"],
  ["RESOLVED_WITH_PAYOUT", "PayPal paid the client"],
  ["ACCEPTED", "The team accepted the claim"],
  ["DENIED", "PayPal denied the claim"],
]);

export function disputeIsOpen(status: DisputeStatus): boolean {
  return status === "open" || status === "waiting_for_seller" || status === "under_review";
}

// What the case does to the project, in the words the team needs.
export function disputeEffect(status: DisputeStatus): string {
  if (disputeIsOpen(status)) return "Timers and payouts are paused until PayPal closes the case.";
  if (status === "resolved_seller") return "Timers and payouts resumed.";
  return "The project's timers stopped. PayPal returns the disputed amount to the client.";
}

// The case page in PayPal's Resolution Center, on the host the deployment's PayPal environment uses.
export function disputeCaseUrl(environment: string | undefined, paypalDisputeId: string): string {
  const host = environment === "live" ? "www.paypal.com" : "www.sandbox.paypal.com";
  return `https://${host}/resolutioncenter/view/${encodeURIComponent(paypalDisputeId)}`;
}
