// Presentation helpers for a project's money and timing. They only read the stored payments and quote; the
// amounts themselves are computed server-side (packages/core/src/projects/pricing.ts).

type PaymentLike = {
  status: string;
  amountMinor: number;
  refundedMinor: number;
  lines: readonly { kind: string; amountMinor: number }[];
};

export type PaidSummary = {
  // Everything PayPal captured, before refunds: the sum of the client's receipts.
  paidMinor: number;
  // The management-fee lines inside those receipts.
  feePaidMinor: number;
  refundedMinor: number;
  pendingMinor: number;
};

export function paidSummary(payments: readonly PaymentLike[]): PaidSummary {
  const summary: PaidSummary = { paidMinor: 0, feePaidMinor: 0, refundedMinor: 0, pendingMinor: 0 };
  for (const payment of payments) {
    if (payment.status === "pending") summary.pendingMinor += payment.amountMinor;
    // A refunded payment was captured first; its refund is reported on its own line.
    if (payment.status !== "captured" && payment.status !== "refunded") continue;
    summary.paidMinor += payment.amountMinor;
    for (const line of payment.lines) if (line.kind === "management_fee") summary.feePaidMinor += line.amountMinor;
    summary.refundedMinor += payment.status === "refunded" ? Math.max(payment.refundedMinor, payment.amountMinor) : payment.refundedMinor;
  }
  return summary;
}

// The fee is a share of the quote (managementFeeMinor), not of the payment it is collected with.
export function managementFeeLabel(managementFeeBps: number): string {
  return `Management fee (${managementFeeBps / 100}% of the quote)`;
}

// The deadline starts when the first payment is captured (payments.ts sets deadlineAt then), not on a calendar date.
export function deliveryTimingLabel(deliveryDays: number, upfrontBps: number): string {
  const days = deliveryDays === 1 ? "1 day" : `${deliveryDays} days`;
  return `${days} after the ${upfrontBps === 10_000 ? "upfront payment" : "deposit"}`;
}

// Record times without seconds: the exact instant belongs to the audit trail, not the page.
export function formatWhen(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDay(date: Date | string): string {
  return new Date(date).toLocaleDateString(undefined, { dateStyle: "medium" });
}
