import type { PayoutRequestStatus } from "@jendal-workspace/core";

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

// A send PayPal never confirmed is retried with the same batch id, so PayPal pays it at most once. A `sending`
// request that is not uncertain has a PayPal call in flight and must be left alone.
export function payoutActions(request: PayoutState): readonly PayoutAction[] {
  switch (request.status) {
    case "requested":
      return ["approve", "reject"];
    case "queued":
      return ["retry"];
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
