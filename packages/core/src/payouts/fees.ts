import { assertAmount, type MoneyCurrency } from "../money/money";

// PayPal's Payouts API fees from its merchant fees page (https://www.paypal.com/us/webapps/mpp/merchant-fees,
// Payouts section): a flat fee per payout between two US accounts, otherwise 2% of the amount up to a cap. This
// is an estimate taken off the member's payout when it is sent; settling records the fee PayPal actually charged.
const DOMESTIC_FLAT_FEE_MINOR = { USD: 25, EUR: 22 } satisfies Record<MoneyCurrency, number>;
const INTERNATIONAL_FEE_PERCENT = 2;
const INTERNATIONAL_FEE_CAP_MINOR = { USD: 2_000, EUR: 1_600 } satisfies Record<MoneyCurrency, number>;

// A country PayPal did not report counts as international, the higher estimate.
export function estimatePayoutFeeMinor(input: {
  currency: MoneyCurrency;
  amountMinor: number;
  senderCountry: string | null;
  receiverCountry: string | null;
}): number {
  assertAmount(input.amountMinor, "payout amount");
  if (input.senderCountry === "US" && input.receiverCountry === "US") return DOMESTIC_FLAT_FEE_MINOR[input.currency];
  const percentMinor = Math.ceil((input.amountMinor * INTERNATIONAL_FEE_PERCENT) / 100);
  return Math.min(percentMinor, INTERNATIONAL_FEE_CAP_MINOR[input.currency]);
}
