import { LedgerError, type LedgerTransferDraft, parseMajorAmount } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import {
  type PayPalCapture,
  type PayPalCaptureBreakdown,
  PayPalError,
  type PayPalMoney,
  type PayPalOrder,
  type PayPalRefundBreakdown,
} from "@jendal-workspace/paypal";
import { captureSchema, parsedItems } from "@jendal-workspace/paypal/schemas";

// Money facts PayPal reports for store orders and services payments alike, read the same way for both.

// PayPal answers that can change on retry: an expired token, a timeout, rate limiting.
const RETRIED_PAYPAL_STATUSES = new Set([401, 408, 429]);

// A 4xx PayPal refusal that will not change on retry (gone, forbidden, invalid): PayPal did not act on the
// request. 5xx, the retried statuses and unreadable answers leave PayPal's outcome unknown.
export function isSettledPayPalRefusal(cause: unknown): cause is PayPalError {
  return (
    cause instanceof PayPalError &&
    cause.status >= 400 &&
    cause.status < 500 &&
    !RETRIED_PAYPAL_STATUSES.has(cause.status)
  );
}

export type CaptureFees = { paypalFeeMinor: number | null; platformFeeMinor: number | null };
export type ReturnedFees = { paypalFeeMinor: number; platformFeeMinor: number };

export function minorIn(currency: string | null, money: PayPalMoney | undefined): number | null {
  return money && money.currency_code === currency ? parseMajorAmount(money.value) : null;
}

const ZERO_AMOUNT = /^0+(?:\.0{1,2})?$/;

// parseMajorAmount refuses zero, but PayPal reports a fee it did not return as "0.00".
function feeMinorIn(currency: string, fee: PayPalMoney): number | null {
  if (fee.currency_code !== currency) return null;
  return ZERO_AMOUNT.test(fee.value.trim()) ? 0 : parseMajorAmount(fee.value);
}

// A fee in another currency (a converted receivable) posts no fees at all, since posting the others alone would
// misstate the team's balance; the order or payment is flagged for review instead.
export function captureFees(currency: string | null, breakdown: PayPalCaptureBreakdown): CaptureFees {
  const platformFee = breakdown.platform_fees[0]?.amount;
  const platformFeeMinor = platformFee ? (currency ? feeMinorIn(currency, platformFee) : null) : 0;
  if (platformFeeMinor === null) return { paypalFeeMinor: null, platformFeeMinor: null };
  return { paypalFeeMinor: minorIn(currency, breakdown.paypal_fee), platformFeeMinor };
}

// Null unless every returned fee is readable and in the payment's currency: posting part of them would misstate
// the team's balance.
export function returnedFees(currency: string, breakdown: PayPalRefundBreakdown | undefined): ReturnedFees | null {
  if (!breakdown) return null;
  // An absent paypal_fee means PayPal returned none of its fee.
  const paypalFeeMinor = breakdown.paypal_fee ? feeMinorIn(currency, breakdown.paypal_fee) : 0;
  if (paypalFeeMinor === null) return null;
  let platformFeeMinor = 0;
  for (const fee of breakdown.platform_fees) {
    const minor = feeMinorIn(currency, fee.amount);
    if (minor === null) return null;
    platformFeeMinor += minor;
  }
  return { paypalFeeMinor, platformFeeMinor };
}

const REFUNDED_CAPTURE_STATUSES = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"]);

export function isRefundedCaptureStatus(status: string): boolean {
  return REFUNDED_CAPTURE_STATUSES.has(status);
}

// Captures that cannot be read are skipped, as captureFromOrder does.
export function capturesIn(paypalOrder: PayPalOrder): PayPalCapture[] {
  return parsedItems(captureSchema, paypalOrder.purchase_units?.[0]?.payments?.captures ?? []);
}

// Returns false when the reference was already posted. post() checks references with a read before it writes, so
// the transaction stays usable after a duplicate.
export async function postIfNew(tx: Transaction, teamId: string, transfer: LedgerTransferDraft): Promise<boolean> {
  try {
    await createPostgresLedger(teamId, tx).post([transfer]);
    return true;
  } catch (error) {
    if (error instanceof LedgerError && error.code === "duplicate_reference") return false;
    throw error;
  }
}

export async function postOnce(db: Database, teamId: string, transfer: LedgerTransferDraft): Promise<void> {
  await db.transaction((tx) => postIfNew(tx, teamId, transfer));
}
