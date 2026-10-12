import type { ProjectRefundPartStatus, ProjectRefundStatus } from "@jendal-workspace/core";

import { formatMinor } from "./money";

type RefundSummary = { amountMinor: number; currency: string; status: ProjectRefundStatus; completedAt: Date | string | null };

// A failed refund still reads "on its way" for the client: the team retries it from the admin.
export function clientRefundLabel(refund: RefundSummary, formatDate: (date: Date) => string): string {
  const amount = formatMinor(refund.amountMinor, refund.currency);
  if (refund.status === "completed" && refund.completedAt !== null) {
    return `Refunded ${amount} on ${formatDate(new Date(refund.completedAt))}`;
  }
  return `Refund of ${amount}: on its way`;
}

export function paymentRefundLabel(
  payment: { status: string; amountMinor: number; refundedMinor: number },
  currency: string,
): string | null {
  if (payment.status === "refunded" || (payment.refundedMinor > 0 && payment.refundedMinor >= payment.amountMinor)) {
    return "Refunded";
  }
  if (payment.refundedMinor > 0) return `Partly refunded ${formatMinor(payment.refundedMinor, currency)}`;
  return null;
}

export function refundPartStatusLabel(status: ProjectRefundPartStatus): string {
  switch (status) {
    case "completed":
      return "Sent";
    case "pending":
      return "Waiting for PayPal";
    case "failed":
      return "Failed";
  }
}

// "retry" covers a part PayPal left uncertain (pending with a message) and a part of an issuing refund that was
// never sent (its request died first). Sending again with the same request id cannot refund twice.
export function staffRefundAction(refund: {
  status: ProjectRefundStatus;
  parts: { status: ProjectRefundPartStatus; sent: boolean; failureMessage: string | null }[];
}): "refund" | "retry" | null {
  if (refund.status === "completed") return null;
  if (refund.status === "failed" || refund.parts.some((part) => part.failureMessage !== null)) return "retry";
  if (refund.status === "issuing" && refund.parts.some((part) => part.status === "pending" && !part.sent)) return "retry";
  if (refund.status === "requested") return "refund";
  return null;
}
