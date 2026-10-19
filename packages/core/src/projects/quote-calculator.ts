import type { MoneyCurrency } from "../money/money";
import { estimateCheckoutFeeMinor } from "../payouts/checkout-fees";
import { estimatePayoutFeeMinor } from "../payouts/fees";
import { freelancerEarningsMinor, managementFeeMinor, platformFeeMinor, teamCutMinor } from "./pricing";

export type QuoteCalculatorInput = {
  targetNetMinor: number;
  teamCutBps: number;
  managementFeeBps: number;
  platformFeeBps: number;
  currency: MoneyCurrency;
  senderCountry: string | null;
  receiverCountry: string | null;
};

export type QuoteBreakdown = {
  quoteMinor: number;
  clientPaysMinor: number;
  checkoutFeeMinor: number;
  platformFeeMinor: number;
  teamKeepsMinor: number;
  payoutFeeMinor: number;
  memberReceivesMinor: number;
};

const MAX_STEPS = 10_000;

// What each party ends up with when the team quotes quoteMinor: the client's payment, PayPal's and Payleor's fees,
// what the team keeps and what the member receives after the payout fee.
export function quoteBreakdown(input: Omit<QuoteCalculatorInput, "targetNetMinor">, quoteMinor: number): QuoteBreakdown {
  const earnings = freelancerEarningsMinor(quoteMinor, input.teamCutBps);
  const payoutFeeMinor = estimatePayoutFeeMinor({
    currency: input.currency,
    amountMinor: earnings,
    senderCountry: input.senderCountry,
    receiverCountry: input.receiverCountry,
  });
  const clientPaysMinor = quoteMinor + managementFeeMinor(quoteMinor, input.managementFeeBps);
  const checkoutFeeMinor = estimateCheckoutFeeMinor({
    currency: input.currency,
    amountMinor: clientPaysMinor,
    international: false,
  });
  // Payleor's fee is charged on each client payment, so it is taken on what the client pays.
  const platform = platformFeeMinor(clientPaysMinor, input.platformFeeBps);
  return {
    quoteMinor,
    clientPaysMinor,
    checkoutFeeMinor,
    platformFeeMinor: platform,
    teamKeepsMinor:
      teamCutMinor(quoteMinor, input.teamCutBps) + (clientPaysMinor - quoteMinor) - checkoutFeeMinor - platform,
    payoutFeeMinor,
    memberReceivesMinor: earnings - payoutFeeMinor,
  };
}

// Works backwards from what the member should receive; rounding makes the inverse inexact, so it walks up from a
// close lower estimate to the first quote that reaches the target.
export function quoteForMemberTarget(input: QuoteCalculatorInput): QuoteBreakdown {
  if (!Number.isInteger(input.targetNetMinor) || input.targetNetMinor <= 0) {
    throw new Error("Enter what the member should receive.");
  }
  const share = 1 - input.teamCutBps / 10_000;
  let quote = Math.max(1, Math.floor(input.targetNetMinor / share) - 2);
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const result = quoteBreakdown(input, quote);
    if (result.memberReceivesMinor >= input.targetNetMinor) return result;
    quote += 1;
  }
  throw new Error("Could not find a quote for this amount.");
}
