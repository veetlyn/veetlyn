import { depositDue, getSellerPlan, quoteBreakdown } from "@jendal-workspace/core";

// The example team every landing figure uses: a Team plan, a 15% team cut and a 10% management fee, paying a
// freelancer in the US. Every amount on the page comes from the app's own rules with these settings.
export const EXAMPLE_TEAM = {
  teamCutBps: 1_500,
  managementFeeBps: 1_000,
  platformFeeBps: getSellerPlan("team").feeBps,
  currency: "USD",
  senderCountry: "US",
  receiverCountry: "US",
} as const;

export function splitFor(quoteMinor: number) {
  const b = quoteBreakdown(EXAMPLE_TEAM, quoteMinor);
  return {
    ...b,
    paypalFeesMinor: b.checkoutFeeMinor + b.payoutFeeMinor,
    deposit: depositDue(quoteMinor, EXAMPLE_TEAM.managementFeeBps),
  };
}

export function usd(minor: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}
