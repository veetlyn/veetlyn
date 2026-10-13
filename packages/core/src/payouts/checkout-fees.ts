import type { MoneyCurrency } from "../money/money";

// PayPal Checkout standard rates (https://www.paypal.com/us/business/paypal-business-fees, US): a percentage plus
// a fixed fee per currency, with an extra percentage for international payers.
const CHECKOUT_PERCENT_BPS = 349;
const INTERNATIONAL_EXTRA_BPS = 150;
const CHECKOUT_FIXED_MINOR = { USD: 49, EUR: 39 } satisfies Record<MoneyCurrency, number>;

// PayPal Checkout's standard rate, as an estimate: the team's real rate can differ by country and volume.
export function estimateCheckoutFeeMinor(input: {
  currency: MoneyCurrency;
  amountMinor: number;
  international: boolean;
}): number {
  const bps = CHECKOUT_PERCENT_BPS + (input.international ? INTERNATIONAL_EXTRA_BPS : 0);
  return Math.ceil((input.amountMinor * bps) / 10_000) + CHECKOUT_FIXED_MINOR[input.currency];
}
