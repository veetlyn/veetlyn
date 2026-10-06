import { assertAmount, assertBps, bpsOf } from "../money/money";

export const PAYLEOR_FEE_BPS = 50;
export const PAYLEOR_FEE_FIXED_MINOR = 10;
export const DEPOSIT_BPS = 5_000;

// Services spec §3 goal 7: 0.5% + 0.10 in the team currency on each client payment, taken as PayPal platform_fees.
export function payleorFeeMinor(paymentMinor: number): number {
  assertAmount(paymentMinor, "payment");
  if (paymentMinor === 0) throw new RangeError("A client payment must be positive");
  return bpsOf(paymentMinor, PAYLEOR_FEE_BPS) + PAYLEOR_FEE_FIXED_MINOR;
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
