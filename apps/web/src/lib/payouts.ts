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
} satisfies Record<PayoutRequestStatus, string>;

export type PayoutAction = "approve" | "reject" | "retry" | "refresh";

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
    case "succeeded":
    case "failed":
    case "rejected":
      return [];
  }
}

type PayoutAmounts = {
  status: PayoutRequestStatus;
  feeMinor: number | null;
  feeEstimateMinor: number | null;
  sentMinor: number | null;
};

// Before PayPal settles a payout there is only the estimate taken off it; afterwards the fee PayPal charged.
export function payoutFeeLine(request: PayoutAmounts): { label: string; feeMinor: number } | null {
  if (request.feeMinor !== null) return { label: "PayPal's fee", feeMinor: request.feeMinor };
  if (request.feeEstimateMinor !== null && request.status !== "failed" && request.status !== "rejected") {
    return { label: "PayPal's fee (about)", feeMinor: request.feeEstimateMinor };
  }
  return null;
}

// The amount a send claimed stays on the request after it goes back to the queue or fails, when nothing was sent.
export function payoutSentMinor(request: { status: PayoutRequestStatus; sentMinor: number | null }): number | null {
  const sent = request.status === "sending" || request.status === "sent" || request.status === "succeeded";
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
  return "PayPal did not confirm the connection. Try again.";
}
