import { assertAmount } from "../money/money";

// requested → rejected | queued; queued → rejected | sending; sending → sent | queued | failed; sent → succeeded | failed.
export const PAYOUT_REQUEST_STATUSES = [
  "requested",
  "rejected",
  "queued",
  "sending",
  "sent",
  "succeeded",
  "failed",
] as const;

export type PayoutRequestStatus = (typeof PAYOUT_REQUEST_STATUSES)[number];

// A member has at most one open request per team.
export const OPEN_PAYOUT_REQUEST_STATUSES = ["requested", "queued", "sending", "sent"] as const satisfies readonly PayoutRequestStatus[];

const MIN_PAYOUT_MINOR = 100;
// PayPal's per-item maximum for Payouts.
export const MAX_PAYOUT_MINOR = 2_000_000;

const amountFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function payoutAmountProblem(input: { amountMinor: number; availableMinor: number }): string | null {
  assertAmount(input.amountMinor, "payout amount");
  if (input.amountMinor < MIN_PAYOUT_MINOR) return "Enter at least 1.00.";
  if (input.amountMinor > input.availableMinor) {
    return `You can request up to ${amountFormatter.format(Math.max(input.availableMinor, 0) / 100)}.`;
  }
  if (input.amountMinor > MAX_PAYOUT_MINOR) return "PayPal pays at most 20,000.00 at a time.";
  return null;
}

// PayPal's fee comes off the payout, so what is sent must still be a payout PayPal accepts.
export function payoutSentProblem(sentMinor: number): string | null {
  return sentMinor < MIN_PAYOUT_MINOR ? "This payout is too small to cover PayPal's fee." : null;
}

// Enough of a team's PayPal merchant id for an admin to recognise the account.
export function maskedPayPalAccountId(accountId: string): string {
  return `••••${accountId.slice(-4)}`;
}

export type PayoutOutcome = "succeeded" | "failed" | "pending";

const FAILED_ITEM_STATUSES: ReadonlySet<string> = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]);

// PENDING, ONHOLD, UNCLAIMED, a missing status and any status PayPal adds later all read as still pending.
export function payoutItemOutcome(status: string | undefined): PayoutOutcome {
  if (status === "SUCCESS") return "succeeded";
  if (status !== undefined && FAILED_ITEM_STATUSES.has(status)) return "failed";
  return "pending";
}

// A batch never decides success on its own: a SUCCESS batch only means PayPal processed its items.
export function payoutBatchOutcome(batchStatus: string): Exclude<PayoutOutcome, "succeeded"> {
  return batchStatus === "DENIED" || batchStatus === "CANCELED" ? "failed" : "pending";
}
