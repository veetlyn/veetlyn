import { assertAmount, bpsOf } from "../money/money";
import { DEPOSIT_BPS, managementFeeMinor, type PaymentSplit } from "./pricing";

export type AmendmentEffect =
  | { kind: "increase"; deltaMinor: number; topUp: PaymentSplit; addedToBalanceMinor: number }
  | { kind: "decrease"; deltaMinor: number; managementFeeCreditMinor: number; depositCreditMinor: number }
  | { kind: "unchanged"; deltaMinor: 0 };

// Services spec §5.5. Each amount is a difference of rounded totals, not a rounded difference, so the
// deposit, top-ups and credits always add up to exactly what the current quote version requires. upfrontBps is the
// share the project's rules took up front, so a top-up keeps the same share of the new price paid.
export function amendmentEffect(input: {
  previousQuoteMinor: number;
  newQuoteMinor: number;
  managementFeeBps: number;
  upfrontBps?: number;
}): AmendmentEffect {
  assertAmount(input.previousQuoteMinor, "previous quote");
  assertAmount(input.newQuoteMinor, "new quote");
  if (input.newQuoteMinor === 0) throw new RangeError("An amendment cannot remove the whole quote");
  const deltaMinor = input.newQuoteMinor - input.previousQuoteMinor;
  const upfront = (quote: number) => bpsOf(quote, input.upfrontBps ?? DEPOSIT_BPS);
  const fee = (quote: number) => managementFeeMinor(quote, input.managementFeeBps);
  if (deltaMinor > 0) {
    const quotePartMinor = upfront(input.newQuoteMinor) - upfront(input.previousQuoteMinor);
    const managementFee = fee(input.newQuoteMinor) - fee(input.previousQuoteMinor);
    return {
      kind: "increase",
      deltaMinor,
      topUp: { quotePartMinor, managementFeeMinor: managementFee, totalMinor: quotePartMinor + managementFee },
      addedToBalanceMinor: deltaMinor - quotePartMinor,
    };
  }
  if (deltaMinor < 0) {
    return {
      kind: "decrease",
      deltaMinor,
      managementFeeCreditMinor: fee(input.previousQuoteMinor) - fee(input.newQuoteMinor),
      depositCreditMinor: upfront(input.previousQuoteMinor) - upfront(input.newQuoteMinor),
    };
  }
  return { kind: "unchanged", deltaMinor: 0 };
}
