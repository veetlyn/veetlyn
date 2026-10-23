import { assertAmount, assertBps, bpsOf } from "../money/money";

export const DEPOSIT_BPS = 5_000;

// The platform's fee on one client payment or store order, at the seller plan's rate (pricing proposal §4).
// A tiny payment can round to zero; the order then carries no platform_fees.
export function platformFeeMinor(paymentMinor: number, feeBps: number): number {
  assertAmount(paymentMinor, "payment");
  if (paymentMinor === 0) throw new RangeError("A client payment must be positive");
  assertBps(feeBps, "platform fee");
  return bpsOf(paymentMinor, feeBps);
}

// Services spec §5.3: from the current quote, never reduced by penalties.
export function managementFeeMinor(quoteMinor: number, managementFeeBps: number): number {
  assertBps(managementFeeBps, "management fee");
  return bpsOf(quoteMinor, managementFeeBps);
}

export function teamCutMinor(finalPriceMinor: number, teamCutBps: number): number {
  assertBps(teamCutBps, "team cut");
  return bpsOf(finalPriceMinor, teamCutBps);
}

// The remainder, so the team cut and the earnings always add up to the final price.
export function freelancerEarningsMinor(finalPriceMinor: number, teamCutBps: number): number {
  return finalPriceMinor - teamCutMinor(finalPriceMinor, teamCutBps);
}

export function finalPriceMinor(quoteMinor: number, penaltyMinor: number): number {
  assertAmount(quoteMinor, "quote");
  assertAmount(penaltyMinor, "penalty");
  return Math.max(0, quoteMinor - penaltyMinor);
}

export type PaymentSplit = { quotePartMinor: number; managementFeeMinor: number; totalMinor: number };

// Services spec §5.2 step 3: 50% of the quote plus the management fee on the full quote.
export function depositDue(quoteMinor: number, managementFeeBps: number): PaymentSplit {
  assertAmount(quoteMinor, "quote");
  if (quoteMinor === 0) throw new RangeError("A quote must be positive");
  const quotePartMinor = bpsOf(quoteMinor, DEPOSIT_BPS);
  const fee = managementFeeMinor(quoteMinor, managementFeeBps);
  return { quotePartMinor, managementFeeMinor: fee, totalMinor: quotePartMinor + fee };
}

// What the client has paid toward a project, split the way the ledger holds it (services spec §6.3).
export type ProjectPaid = {
  // Captured quote parts of the deposit, top-ups and balance (client_held).
  paidQuoteMinor: number;
  // Captured management fee lines (team_revenue).
  paidManagementFeeMinor: number;
  // Management fee moved back to client_held by amendment decreases.
  managementFeeCreditedMinor: number;
};

// Refunds the team did not request leave client_held first and team_revenue for the rest (payment_refunded), so
// what the client still has paid is read from that split: paidQuoteMinor + managementFeeCreditedMinor stays equal
// to client_held, and paidManagementFeeMinor − managementFeeCreditedMinor to the fee the team keeps. A refund
// that drew the credited fee out of client_held moves that credit back to the fee, so no part goes negative.
export function paidAfterRefunds(
  captured: ProjectPaid & { refundedFromClientHeldMinor: number; refundedFromTeamRevenueMinor: number },
): ProjectPaid {
  for (const [label, value] of Object.entries(captured)) assertAmount(value, label);
  const quote = captured.paidQuoteMinor - captured.refundedFromClientHeldMinor;
  const fee = captured.paidManagementFeeMinor - captured.refundedFromTeamRevenueMinor;
  const drawnFromCredit = Math.min(0, quote);
  // Below zero only once the project completed and its money left client_held; nothing reads paid totals then.
  return {
    paidQuoteMinor: quote - drawnFromCredit,
    paidManagementFeeMinor: Math.max(0, fee + drawnFromCredit),
    managementFeeCreditedMinor: Math.max(0, captured.managementFeeCreditedMinor + drawnFromCredit),
  };
}

export type BalanceInput = ProjectPaid & {
  quoteMinor: number;
  managementFeeBps: number;
  finalPriceMinor: number;
};

export type Balance = {
  dueMinor: number;
  quotePartMinor: number;
  managementFeePartMinor: number;
  refundMinor: number;
  refundQuoteMinor: number;
  refundManagementFeeMinor: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Services spec §5.5: final price + management fee on the current quote − everything already paid.
// A negative result is refunded and there is no balance payment (§5.3).
export function balanceDue(input: BalanceInput): Balance {
  for (const [label, value] of Object.entries(input)) assertAmount(value, label);
  const fee = managementFeeMinor(input.quoteMinor, input.managementFeeBps);
  const paid = input.paidQuoteMinor + input.paidManagementFeeMinor;
  const net = input.finalPriceMinor + fee - paid;
  const feeKept = input.paidManagementFeeMinor - input.managementFeeCreditedMinor;
  if (net >= 0) {
    const managementFeePartMinor = clamp(fee - feeKept, 0, net);
    return {
      dueMinor: net,
      quotePartMinor: net - managementFeePartMinor,
      managementFeePartMinor,
      refundMinor: 0,
      refundQuoteMinor: 0,
      refundManagementFeeMinor: 0,
    };
  }
  const refundMinor = -net;
  const refundManagementFeeMinor = clamp(feeKept - fee, 0, refundMinor);
  return {
    dueMinor: 0,
    quotePartMinor: 0,
    managementFeePartMinor: 0,
    refundMinor,
    refundQuoteMinor: refundMinor - refundManagementFeeMinor,
    refundManagementFeeMinor,
  };
}
