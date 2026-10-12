// The parts of PayPal's seller_receivable_breakdown that reveal a currency other than the capture's; PayPal's
// field names are kept so the decoded breakdown is passed as is.
export type CaptureCurrencyFacts = {
  paypal_fee?: { currency_code: string };
  platform_fees: readonly { amount: { currency_code: string } }[];
  receivable_amount?: { currency_code: string };
};

export type CaptureReviewReason = "converted_receivable" | "fee_currency";

// The ledger holds one currency per transfer, so converted funds or fees charged in another currency are
// flagged for a person to reconcile instead of being posted as if they were in the capture's currency.
export function captureReviewReason(breakdown: CaptureCurrencyFacts, captureCurrency: string): CaptureReviewReason | null {
  if (breakdown.receivable_amount && breakdown.receivable_amount.currency_code !== captureCurrency) {
    return "converted_receivable";
  }
  const feeCurrencies = [
    ...(breakdown.paypal_fee ? [breakdown.paypal_fee.currency_code] : []),
    ...breakdown.platform_fees.map((fee) => fee.amount.currency_code),
  ];
  if (feeCurrencies.some((currency) => currency !== captureCurrency)) return "fee_currency";
  return null;
}
