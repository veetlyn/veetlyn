import type { MoneyCurrency } from "../money/money";
import { freelancerEarningsMinor, teamCutMinor } from "../projects/pricing";
import { ledgerAccounts as a } from "./accounts";
import { type LedgerTransferDraft, transferFromMoves } from "./transfers";

// One builder per event of services spec §6.3. Each returns one balanced transfer.

type ProjectPosting = { currency: MoneyCurrency; projectId: string };

// The team bears PayPal's fee and Payleor's platform fee (services spec §5); both leave the team's PayPal
// balance at capture. Null when PayPal charged nothing.
export function paymentFeesTransfer(
  input: ProjectPosting & { paymentId: string; paypalFeeMinor: number; platformFeeMinor: number },
): LedgerTransferDraft | null {
  const moves = [
    { from: a.teamRevenue, to: a.paypalFees, amountMinor: input.paypalFeeMinor },
    { from: a.teamRevenue, to: a.payleorFees, amountMinor: input.platformFeeMinor },
  ].filter((move) => move.amountMinor > 0);
  if (moves.length === 0) return null;
  return transferFromMoves({
    kind: "payment_fees",
    reference: `payment_fees:${input.paymentId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves,
  });
}

type OrderPosting = { currency: MoneyCurrency; orderId: string };

// Sellers design §5.3: a store order is the team's revenue at capture; there is no client money to hold.
export function orderPaidTransfer(input: OrderPosting & { amountMinor: number }): LedgerTransferDraft {
  return transferFromMoves({
    kind: "order_paid",
    reference: `order_paid:${input.orderId}`,
    projectId: null,
    currency: input.currency,
    moves: [{ from: a.paypalClearing, to: a.teamRevenue, amountMinor: input.amountMinor }],
  });
}

export function orderFeesTransfer(
  input: OrderPosting & { paypalFeeMinor: number; platformFeeMinor: number },
): LedgerTransferDraft | null {
  const moves = [
    { from: a.teamRevenue, to: a.paypalFees, amountMinor: input.paypalFeeMinor },
    { from: a.teamRevenue, to: a.payleorFees, amountMinor: input.platformFeeMinor },
  ].filter((move) => move.amountMinor > 0);
  if (moves.length === 0) return null;
  return transferFromMoves({
    kind: "order_fees",
    reference: `order_fees:${input.orderId}`,
    projectId: null,
    currency: input.currency,
    moves,
  });
}

// refundKey names the PayPal fact: "refund:{refundId}" or "reversal:{captureId}", so each is posted once.
export function orderRefundedTransfer(
  input: OrderPosting & { refundKey: string; amountMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "order_refunded",
    reference: `order_refunded:${input.refundKey}`,
    projectId: null,
    currency: input.currency,
    moves: [{ from: a.teamRevenue, to: a.paypalClearing, amountMinor: input.amountMinor }],
  });
}

// The fees PayPal hands back with a refund, for store orders and services payments alike: they return to
// the team's revenue. Null when nothing was returned.
export function refundFeesTransfer(input: {
  currency: MoneyCurrency;
  projectId: string | null;
  refundId: string;
  paypalFeeMinor: number;
  platformFeeMinor: number;
}): LedgerTransferDraft | null {
  const moves = [
    { from: a.paypalFees, to: a.teamRevenue, amountMinor: input.paypalFeeMinor },
    { from: a.payleorFees, to: a.teamRevenue, amountMinor: input.platformFeeMinor },
  ].filter((move) => move.amountMinor > 0);
  if (moves.length === 0) return null;
  return transferFromMoves({
    kind: "refund_fees",
    reference: `refund_fees:${input.refundId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves,
  });
}

// An open project's money sits in client_held until completion releases it, so a refund the team did not
// request comes out of it first; taking it from team_revenue alone would let completion release money the
// client already got back.
export type ServicesRefundSplit = { fromClientHeldMinor: number; fromTeamRevenueMinor: number };

export function splitServicesRefund(input: { amountMinor: number; clientHeldMinor: number }): ServicesRefundSplit {
  const fromClientHeldMinor = Math.min(input.amountMinor, Math.max(input.clientHeldMinor, 0));
  return { fromClientHeldMinor, fromTeamRevenueMinor: input.amountMinor - fromClientHeldMinor };
}

// refundKey names the PayPal fact: "refund:{refundId}" or "reversal:{captureId}", so each is posted once.
export function paymentRefundedTransfer(
  input: ProjectPosting & ServicesRefundSplit & { refundKey: string },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payment_refunded",
    reference: `payment_refunded:${input.refundKey}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      { from: a.clientHeld(input.projectId), to: a.paypalClearing, amountMinor: input.fromClientHeldMinor },
      { from: a.teamRevenue, to: a.paypalClearing, amountMinor: input.fromTeamRevenueMinor },
    ],
  });
}

// Deposit, amendment top-up or balance captured.
export function paymentCapturedTransfer(
  input: ProjectPosting & { paymentId: string; quotePartMinor: number; managementFeeMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payment_captured",
    reference: `payment_captured:${input.paymentId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      { from: a.paypalClearing, to: a.clientHeld(input.projectId), amountMinor: input.quotePartMinor },
      { from: a.paypalClearing, to: a.teamRevenue, amountMinor: input.managementFeeMinor },
    ],
  });
}

// Amendment decrease: the overpaid management fee now counts toward the project's balance.
export function managementFeeCreditTransfer(
  input: ProjectPosting & { amendmentId: string; creditMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "management_fee_credit",
    reference: `management_fee_credit:${input.amendmentId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [{ from: a.teamRevenue, to: a.clientHeld(input.projectId), amountMinor: input.creditMinor }],
  });
}

// Completion: the team cut and the freelancer's earnings, both from the final price.
export function completionTransfer(
  input: ProjectPosting & { freelancerId: string; finalPriceMinor: number; teamCutBps: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "completion",
    reference: `completion:${input.projectId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      {
        from: a.clientHeld(input.projectId),
        to: a.teamRevenue,
        amountMinor: teamCutMinor(input.finalPriceMinor, input.teamCutBps),
      },
      {
        from: a.clientHeld(input.projectId),
        to: a.owedAvailable(input.freelancerId),
        amountMinor: freelancerEarningsMinor(input.finalPriceMinor, input.teamCutBps),
      },
    ],
  });
}

// Refund on completion or cancel, recorded when Payleor asks PayPal for it.
export function refundRequestedTransfer(
  input: ProjectPosting & { refundId: string; quotePartMinor: number; managementFeeMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "refund_requested",
    reference: `refund_requested:${input.refundId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      { from: a.clientHeld(input.projectId), to: a.clientRefunds, amountMinor: input.quotePartMinor },
      { from: a.teamRevenue, to: a.clientRefunds, amountMinor: input.managementFeeMinor },
    ],
  });
}

// PayPal confirmed the refund.
export function refundConfirmedTransfer(
  input: ProjectPosting & { refundId: string; amountMinor: number },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "refund_confirmed",
    reference: `refund_confirmed:${input.refundId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [{ from: a.clientRefunds, to: a.paypalClearing, amountMinor: input.amountMinor }],
  });
}

type PayoutPosting = { currency: MoneyCurrency; payoutRequestId: string; freelancerId: string; amountMinor: number };

export function payoutRequestedTransfer(input: PayoutPosting): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payout_requested",
    reference: `payout_requested:${input.payoutRequestId}`,
    projectId: null,
    currency: input.currency,
    moves: [
      { from: a.owedAvailable(input.freelancerId), to: a.owedReserved(input.freelancerId), amountMinor: input.amountMinor },
    ],
  });
}

// What PayPal delivered: the requested amount less the fee estimate kept back when it was sent.
export function payoutSucceededTransfer(input: Omit<PayoutPosting, "amountMinor"> & { sentMinor: number }): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payout_succeeded",
    reference: `payout_succeeded:${input.payoutRequestId}`,
    projectId: null,
    currency: input.currency,
    moves: [{ from: a.owedReserved(input.freelancerId), to: a.paidOut(input.freelancerId), amountMinor: input.sentMinor }],
  });
}

// PayPal's payout fee leaves the team's balance (payout_fees); the member's share of it, up to the estimate kept
// back from the payout, comes from their reserved earnings to the team. Null when there is nothing to recover.
export function payoutFeeRecoveredTransfer(input: PayoutPosting): LedgerTransferDraft | null {
  if (input.amountMinor === 0) return null;
  return transferFromMoves({
    kind: "payout_fee_recovered",
    reference: `payout_fee_recovered:${input.payoutRequestId}`,
    projectId: null,
    currency: input.currency,
    moves: [{ from: a.owedReserved(input.freelancerId), to: a.teamRevenue, amountMinor: input.amountMinor }],
  });
}

// Payout failed, returned, blocked or rejected: the reserved earnings become available again.
export function payoutReleasedTransfer(input: PayoutPosting): LedgerTransferDraft {
  return transferFromMoves({
    kind: "payout_released",
    reference: `payout_released:${input.payoutRequestId}`,
    projectId: null,
    currency: input.currency,
    moves: [
      { from: a.owedReserved(input.freelancerId), to: a.owedAvailable(input.freelancerId), amountMinor: input.amountMinor },
    ],
  });
}

// The team bears PayPal's fee on a successful payout item. Null when PayPal charged nothing.
export function payoutFeesTransfer(input: {
  currency: MoneyCurrency;
  payoutRequestId: string;
  feeMinor: number;
}): LedgerTransferDraft | null {
  if (input.feeMinor === 0) return null;
  return transferFromMoves({
    kind: "payout_fees",
    reference: `payout_fees:${input.payoutRequestId}`,
    projectId: null,
    currency: input.currency,
    moves: [{ from: a.teamRevenue, to: a.paypalFees, amountMinor: input.feeMinor }],
  });
}

// Case outcome after completion: earnings move to the team, or to client refunds when the client is refunded.
export function penaltyAfterCompletionTransfer(
  input: ProjectPosting & {
    caseId: string;
    freelancerId: string;
    amountMinor: number;
    destination: "team_revenue" | "client_refunds";
  },
): LedgerTransferDraft {
  return transferFromMoves({
    kind: "penalty_after_completion",
    reference: `penalty_after_completion:${input.caseId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves: [
      {
        from: a.owedAvailable(input.freelancerId),
        to: input.destination === "team_revenue" ? a.teamRevenue : a.clientRefunds,
        amountMinor: input.amountMinor,
      },
    ],
  });
}

// Reverses a capture's entries. After completion the client money has already become the team cut and
// earnings, so team_revenue absorbs the whole amount; changing earnings needs a case outcome.
export function chargebackTransfer(
  input: ProjectPosting & {
    chargebackId: string;
    quotePartMinor: number;
    managementFeeMinor: number;
    projectCompleted: boolean;
  },
): LedgerTransferDraft {
  const moves = input.projectCompleted
    ? [{ from: a.teamRevenue, to: a.paypalClearing, amountMinor: input.quotePartMinor + input.managementFeeMinor }]
    : [
        { from: a.clientHeld(input.projectId), to: a.paypalClearing, amountMinor: input.quotePartMinor },
        { from: a.teamRevenue, to: a.paypalClearing, amountMinor: input.managementFeeMinor },
      ];
  return transferFromMoves({
    kind: "chargeback",
    reference: `chargeback:${input.chargebackId}`,
    projectId: input.projectId,
    currency: input.currency,
    moves,
  });
}
