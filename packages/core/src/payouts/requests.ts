import { assertAmount } from "../money/money";
import { defineMachine } from "../state-machines/machine";

export const PAYOUT_REQUEST_STATUSES = [
  "requested",
  "rejected",
  "queued",
  "sending",
  "sent",
  "succeeded",
  "failed",
  "exported",
] as const;

export type PayoutRequestStatus = (typeof PAYOUT_REQUEST_STATUSES)[number];

// Every status change of a payout request. Guards that need more than the status (an unconfirmed send, a stale claim,
// a review hold) stay with the use case; a move missing from this table is refused at the repository.
export const payoutRequestMachine = defineMachine({
  name: "payout_request",
  states: PAYOUT_REQUEST_STATUSES,
  initial: "requested",
  transitions: {
    approve: { from: ["requested"], to: "queued" },
    reject: { from: ["requested", "queued"], to: "rejected" },
    // An approver lost the authority the rules need, so the request goes back to the admins.
    withdraw_approval: { from: ["queued"], to: "requested" },
    // From `sending` only when the earlier claim went stale or unconfirmed: it is retried under the same amount.
    claim_send: { from: ["queued", "sending"], to: "sending" },
    hold_send: { from: ["sending"], to: "queued" },
    // A batch id is PayPal's word that it holds the payout, whichever attempt it answered.
    record_batch: { from: ["sending", "queued"], to: "sent" },
    refuse_send: { from: ["sending"], to: "failed" },
    export: { from: ["queued"], to: "exported" },
    cancel_export: { from: ["exported"], to: "queued" },
    // `queued` here is a cancelled export whose file PayPal may still have paid.
    settle_succeeded: { from: ["sent", "exported", "queued"], to: "succeeded" },
    settle_failed: { from: ["sent", "exported", "queued"], to: "failed" },
  },
});

export type PayoutRequestEvent = (typeof payoutRequestMachine.events)[number];

// A member has at most one open request per team.
export const OPEN_PAYOUT_REQUEST_STATUSES = ["requested", "queued", "sending", "sent", "exported"] as const satisfies readonly PayoutRequestStatus[];

export const MIN_PAYOUT_MINOR = 100;
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
