import {
  estimatePayoutFeeMinor,
  type MoneyCurrency,
  type PayoutRequestStatus,
  payoutSentProblem,
} from "@jendal-workspace/core";

type PayoutState = { status: PayoutRequestStatus; uncertain: boolean };

const STATUS_LABELS = {
  requested: "Waiting for approval",
  queued: "Approved, waiting to send",
  sending: "Sending",
  sent: "Sent, waiting for PayPal",
  succeeded: "Paid",
  failed: "Failed",
  rejected: "Rejected",
  exported: "Sent through PayPal Payouts Web",
} satisfies Record<PayoutRequestStatus, string>;

export function payoutStatusLabel(request: PayoutState): string {
  if (request.status === "sending" && request.uncertain) return "Not confirmed";
  return STATUS_LABELS[request.status];
}

// Members see no sending details: holds and retries are the admins' to handle.
export const MEMBER_STATUS_LABELS = {
  requested: "Waiting for approval",
  queued: "Approved, being sent",
  sending: "Approved, being sent",
  sent: "Approved, being sent",
  succeeded: "Paid",
  failed: "Failed",
  rejected: "Rejected",
  exported: "Approved, being sent",
} satisfies Record<PayoutRequestStatus, string>;

export type PayoutAction = "approve" | "reject" | "retry" | "refresh" | "cancel_export";

// A send PayPal never confirmed is retried with the same batch id, so PayPal pays it at most once, and cannot be
// rejected. A `sending` request that is not uncertain has a PayPal call in flight and must be left alone.
export function payoutActions(request: PayoutState): readonly PayoutAction[] {
  switch (request.status) {
    case "requested":
      return ["approve", "reject"];
    case "queued":
      return request.uncertain ? ["retry"] : ["reject", "retry"];
    case "sending":
      return request.uncertain ? ["retry"] : [];
    case "sent":
      return ["refresh"];
    case "exported":
      return ["cancel_export"];
    case "succeeded":
    case "failed":
    case "rejected":
      return [];
  }
}

const PAYDAY_DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

type WaitingPayout = { status: PayoutRequestStatus; sendAfter: string | null; nextAttemptAt: string | null };

// Paydays are UTC calendar days, as the server decides them; the next try shows in the admin's own time zone
// unless one is given.
export function waitingLine(request: WaitingPayout, now: Date, timeZone?: string): string | null {
  if (request.status !== "queued") return null;
  if (request.sendAfter !== null && Date.parse(request.sendAfter) > now.getTime()) {
    return `Goes on payday, ${PAYDAY_DATE.format(new Date(request.sendAfter))}`;
  }
  if (request.nextAttemptAt !== null && Date.parse(request.nextAttemptAt) > now.getTime()) {
    const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone });
    return `Next try ${time.format(new Date(request.nextAttemptAt))}`;
  }
  return null;
}

export type ApprovalState = { progress: string | null; note: string | null };

// eligibleApprovers are the admins who can still approve: an admin cannot approve their own payout or approve twice.
export function approvalState(request: {
  status: PayoutRequestStatus;
  approvals: number;
  approvalsNeeded: number;
  eligibleApprovers: number;
}): ApprovalState {
  if (request.status !== "requested" || request.approvalsNeeded === 0) return { progress: null, note: null };
  const required = request.approvals + request.approvalsNeeded;
  const progress = required > 1 ? `${request.approvals} of ${required} approvals` : null;
  if (request.approvalsNeeded > request.eligibleApprovers) {
    return { progress, note: "Add a second admin or lower the second-approver amount." };
  }
  return { progress, note: request.approvals > 0 ? "Waiting for a second admin" : null };
}

type PayoutAmounts = {
  status: PayoutRequestStatus;
  feeMinor: number | null;
  feeEstimateMinor: number | null;
};

// Before PayPal settles a payout there is only the estimate taken off it; afterwards the fee PayPal charged. A send
// that was held goes back to `queued` still carrying its estimate, though nothing was sent.
export function payoutFeeLine(request: PayoutAmounts): { label: string; feeMinor: number } | null {
  const estimate = request.feeEstimateMinor === null ? null : { label: "PayPal's fee (about)", feeMinor: request.feeEstimateMinor };
  switch (request.status) {
    case "sending":
    case "sent":
    case "exported":
      return estimate;
    case "succeeded":
      return request.feeMinor === null ? estimate : { label: "PayPal's fee", feeMinor: request.feeMinor };
    case "requested":
    case "queued":
    case "failed":
    case "rejected":
      return null;
  }
}

// The amount a send claimed stays on the request after it goes back to the queue or fails, when nothing was sent.
export function payoutSentMinor(request: { status: PayoutRequestStatus; sentMinor: number | null }): number | null {
  const sent =
    request.status === "sending" ||
    request.status === "sent" ||
    request.status === "exported" ||
    request.status === "succeeded";
  return sent ? request.sentMinor : null;
}

// The member bears PayPal's fee up to the estimate kept back from their payout; the team absorbs the rest. Without
// a usable fee from PayPal the estimate stood in for it.
export function memberPayoutFeeMinor(request: {
  status: PayoutRequestStatus;
  feeMinor: number | null;
  feeEstimateMinor: number | null;
}): number | null {
  if (request.status !== "succeeded" || request.feeEstimateMinor === null) return null;
  return Math.min(request.feeMinor ?? request.feeEstimateMinor, request.feeEstimateMinor);
}

// tooSmall is the reason the request would be refused when what is left falls below PayPal's minimum payout.
export type PayoutNet = { feeEstimateMinor: number; netMinor: number; tooSmall: string | null };

// What the member receives out of a requested amount once PayPal's fee estimate comes off it.
export function payoutNetMinor(input: {
  amountMinor: number;
  currency: MoneyCurrency;
  senderCountry: string | null;
  receiverCountry: string | null;
}): PayoutNet {
  const feeEstimateMinor = estimatePayoutFeeMinor(input);
  const sentMinor = input.amountMinor - feeEstimateMinor;
  return { feeEstimateMinor, netMinor: Math.max(0, sentMinor), tooSmall: payoutSentProblem(sentMinor) };
}

// Better Auth returns from Log in with PayPal to errorCallbackURL with its error code appended as a second `error`.
export function payPalConnectProblem(error: string | string[] | undefined): string | null {
  if (error === undefined) return null;
  const codes = Array.isArray(error) ? error : [error];
  if (codes.includes("account_already_linked_to_different_user")) {
    return "This PayPal account is already connected to another Payleor account. Log out of PayPal, then log in with a different PayPal account.";
  }
  // Better Auth's state cookie lasts 5 minutes; a slower PayPal sign-in comes back without it.
  if (codes.includes("state_mismatch")) {
    return "The PayPal sign-in took too long. Try again and finish within 5 minutes.";
  }
  return "PayPal did not confirm the connection. Try again.";
}
