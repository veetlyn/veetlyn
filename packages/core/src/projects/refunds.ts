export type RefundablePayment = { paymentId: string; refundableMinor: number };
export type ProjectRefundSplit = { paymentId: string; amountMinor: number };

// Services spec: an overpayment goes back on the original captures. Taking the newest first leaves the deposit,
// the oldest and largest capture, whole when a later payment covers the refund. Payments come newest first.
// Null when the payments cannot cover the amount.
export function splitProjectRefund(input: {
  amountMinor: number;
  payments: readonly RefundablePayment[];
}): ProjectRefundSplit[] | null {
  let leftMinor = input.amountMinor;
  const parts: ProjectRefundSplit[] = [];
  for (const item of input.payments) {
    if (leftMinor <= 0) break;
    if (item.refundableMinor <= 0) continue;
    const amountMinor = Math.min(leftMinor, item.refundableMinor);
    parts.push({ paymentId: item.paymentId, amountMinor });
    leftMinor -= amountMinor;
  }
  return leftMinor === 0 ? parts : null;
}
