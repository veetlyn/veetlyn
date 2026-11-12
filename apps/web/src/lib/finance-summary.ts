import type { PayoutRequestStatus } from "@jendal-workspace/core";

import { payoutSentMinor } from "./payouts";

export type FinancePayment = { status: string; amountMinor: number; paypalFeeMinor: number | null; refundedMinor: number; currency: string };
export type FinancePayout = { status: PayoutRequestStatus; amountMinor: number; sentMinor: number | null; currency: string };
type Dispute = { open: boolean; amountMinor: number | null; currency: string | null };

export type FinanceSummary = {
  currency: string;
  receivedMinor: number;
  feesMinor: number;
  feesUnreported: number;
  refundedMinor: number;
  netMinor: number;
  pendingInMinor: number;
  paidOutMinor: number;
  inFlightMinor: number;
  awaitingApprovalMinor: number;
  awaitingApprovalCount: number;
  openDisputes: number;
  disputedMinor: number;
};

const IN_FLIGHT: ReadonlySet<PayoutRequestStatus> = new Set(["queued", "sending", "sent", "exported"]);

// The team's finances per currency, never summed across currencies. Money in is what clients paid (captured), less
// PayPal's fees and refunds; a fee PayPal has not reported yet is counted, not guessed. Paid out is what reached
// members (succeeded payouts, by the amount sent).
export function financeSummary(payments: readonly FinancePayment[], payouts: readonly FinancePayout[], disputes: readonly Dispute[]): FinanceSummary[] {
  const byCurrency = new Map<string, FinanceSummary>();
  const of = (currency: string) => {
    let entry = byCurrency.get(currency);
    if (!entry) {
      entry = { currency, receivedMinor: 0, feesMinor: 0, feesUnreported: 0, refundedMinor: 0, netMinor: 0, pendingInMinor: 0, paidOutMinor: 0, inFlightMinor: 0, awaitingApprovalMinor: 0, awaitingApprovalCount: 0, openDisputes: 0, disputedMinor: 0 };
      byCurrency.set(currency, entry);
    }
    return entry;
  };
  for (const payment of payments) {
    const entry = of(payment.currency);
    if (payment.status === "pending") entry.pendingInMinor += payment.amountMinor;
    if (payment.status !== "captured" && payment.status !== "refunded") continue;
    entry.receivedMinor += payment.amountMinor;
    entry.refundedMinor += payment.refundedMinor;
    if (payment.paypalFeeMinor === null) entry.feesUnreported += 1;
    else entry.feesMinor += payment.paypalFeeMinor;
  }
  for (const payout of payouts) {
    const entry = of(payout.currency);
    if (payout.status === "succeeded") entry.paidOutMinor += payoutSentMinor(payout) ?? 0;
    else if (IN_FLIGHT.has(payout.status)) entry.inFlightMinor += payout.amountMinor;
    else if (payout.status === "requested") {
      entry.awaitingApprovalMinor += payout.amountMinor;
      entry.awaitingApprovalCount += 1;
    }
  }
  for (const dispute of disputes) {
    if (!dispute.open || !dispute.currency) continue;
    const entry = of(dispute.currency);
    entry.openDisputes += 1;
    entry.disputedMinor += dispute.amountMinor ?? 0;
  }
  for (const entry of byCurrency.values()) entry.netMinor = entry.receivedMinor - entry.feesMinor - entry.refundedMinor;
  return [...byCurrency.values()];
}
