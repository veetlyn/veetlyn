import { assertAmount } from "../money/money";

// requested → paid | rejected.
export const PAYOUT_REQUEST_STATUSES = ["requested", "paid", "rejected"] as const;

export type PayoutRequestStatus = (typeof PAYOUT_REQUEST_STATUSES)[number];

// A member has at most one open request per team.
export const OPEN_PAYOUT_REQUEST_STATUSES = ["requested"] as const satisfies readonly PayoutRequestStatus[];

const MIN_PAYOUT_MINOR = 100;

const amountFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function payoutAmountProblem(input: { amountMinor: number; availableMinor: number }): string | null {
  assertAmount(input.amountMinor, "payout amount");
  if (input.amountMinor < MIN_PAYOUT_MINOR) return "Enter at least 1.00.";
  if (input.amountMinor > input.availableMinor) {
    return `You can request up to ${amountFormatter.format(Math.max(input.availableMinor, 0) / 100)}.`;
  }
  return null;
}

// The owner records what reached the member; PayPal's receiving fee is the difference. More than was sent is a typo.
export function payoutReceivedProblem(input: { receivedMinor: number; amountMinor: number }): string | null {
  assertAmount(input.receivedMinor, "received amount");
  if (input.receivedMinor <= 0) return "Enter the amount the member received.";
  if (input.receivedMinor > input.amountMinor) {
    return `Enter at most ${amountFormatter.format(input.amountMinor / 100)}, the amount requested.`;
  }
  return null;
}
