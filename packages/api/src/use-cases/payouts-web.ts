import {
  parsePayoutsWebLog,
  payoutReference,
  payoutSentProblem,
  PayoutsWebError,
  type PayoutsWebResult,
  type PayoutsWebRow,
  payoutsWebCsv,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { hasTeamPayoutCredentials } from "@jendal-workspace/db/repositories/payout-credentials";
import {
  lockPayoutRequestByOfflineReference,
  type PayoutRequestRow,
  updatePayoutRequest,
} from "@jendal-workspace/db/repositories/payout-requests";
import { TRPCError } from "@trpc/server";

import {
  applySettlement,
  destinationHold,
  lockTeamRequest,
  reviewHold,
  nowOf,
  paydayWait,
  type PayoutRequestView,
  payoutRequestView,
  type PayoutTeam,
  sendAmountsFor,
  WAITING_FOR_EXPORT,
} from "./payouts";

// PayPal Payouts Web is the route for teams without automatic payouts: an admin exports approved payouts as PayPal's
// upload CSV, sends them in PayPal, then imports the payout's CSV log to settle them like the API path does.

const AUTOMATIC_PAYOUTS_ON = "Automatic payouts send these for you.";
const NOT_APPROVED = "Only approved payouts can be exported.";
const MAYBE_WITH_PAYPAL = "PayPal may already have this payout. Turn on automatic payouts and retry it to find out.";
const NOT_EXPORTED = "Only a payout exported for PayPal Payouts Web can be cancelled.";
const LOG_MISMATCH = "PayPal's log shows another amount or currency for this payout.";
const CANCELLED_EXPORT_PENDING = "PayPal shows this cancelled export as pending. Check PayPal before paying it again.";
const PAID_TWICE = "PayPal paid this payout twice. Recover the extra payment in PayPal.";

export type PayoutsWebExport = { csv: string; filename: string; count: number };
export type PayoutsWebImport = {
  settled: number;
  failed: number;
  pending: number;
  unmatched: number;
  mismatched: number;
  paidTwice: number;
};

function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

function refusingBadFiles<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof PayoutsWebError) throw badRequest(error.message);
    throw error;
  }
}

function exportRefusal(request: PayoutRequestRow, now: Date): string | null {
  if (request.status !== "queued") return NOT_APPROVED;
  if (request.uncertainAt !== null) return MAYBE_WITH_PAYPAL;
  return reviewHold(request) ?? paydayWait(request, now);
}

// All or nothing: one payout that cannot be exported refuses the whole export.
export async function exportPayoutsWeb(
  deps: { db: Database; platformName: string; now?: () => Date },
  input: { team: PayoutTeam; requestIds: readonly string[] },
): Promise<PayoutsWebExport> {
  const now = nowOf(deps);
  if (await hasTeamPayoutCredentials(deps.db, input.team.id)) throw badRequest(AUTOMATIC_PAYOUTS_ON);
  const ids = [...new Set(input.requestIds)];
  const offlineBatchId = crypto.randomUUID();
  const note = `Payout from ${input.team.name} via ${deps.platformName}`;

  const csv = await deps.db.transaction(async (tx) => {
    // Locked in id order so two overlapping exports cannot deadlock; the file keeps the order the admin chose.
    const locked = new Map<string, PayoutRequestRow>();
    for (const id of [...ids].sort()) locked.set(id, await lockTeamRequest(tx, input.team.id, id));
    const rows: PayoutsWebRow[] = [];
    for (const request of ids.flatMap((id) => locked.get(id) ?? [])) {
      const refusal = exportRefusal(request, now) ?? (await destinationHold(tx, request));
      if (refusal) throw badRequest(refusal);
      const amounts = await sendAmountsFor(tx, request);
      const tooSmall = payoutSentProblem(amounts.sentMinor);
      if (tooSmall) throw badRequest(tooSmall);
      // A cancelled export keeps its reference, so the log of the cancelled file still matches this payout.
      const reference = request.offlineReference ?? payoutReference();
      await updatePayoutRequest(tx, request.id, {
        status: "exported",
        offlineReference: reference,
        offlineBatchId,
        ...amounts,
        sentAt: now,
        failureMessage: null,
        nextAttemptAt: null,
      });
      rows.push({
        receiverPayerId: request.receiverPayerId,
        sentMinor: amounts.sentMinor,
        currency: request.currency,
        reference,
        note,
      });
    }
    return refusingBadFiles(() => payoutsWebCsv(rows));
  });
  return { csv, filename: `payouts-${now.toISOString().slice(0, 10)}.csv`, count: ids.length };
}

type ImportCount = keyof PayoutsWebImport;

// A payout that PayPal paid through the API, or through another file than the one an earlier import settled, was paid
// again by this row. The same transaction is an earlier import's row read again.
function paidTwice(request: PayoutRequestRow, result: PayoutsWebResult): boolean {
  if (result.status !== "succeeded") return false;
  if (request.status === "sending" || request.status === "sent") return true;
  return (
    request.status === "succeeded" && (request.paypalBatchId !== null || result.transactionId !== request.paypalItemId)
  );
}

async function importResult(tx: Transaction, teamId: string, result: PayoutsWebResult): Promise<ImportCount> {
  const request = await lockPayoutRequestByOfflineReference(tx, { teamId, reference: result.reference });
  if (!request) return "unmatched";
  if (paidTwice(request, result)) {
    // Kept as it was: on a `sending` payout updated_at names the send claim in flight.
    await updatePayoutRequest(tx, request.id, { reviewReason: PAID_TWICE, updatedAt: request.updatedAt });
    return "paidTwice";
  }
  // A row an earlier import already recorded counts as what its payout became, and changes nothing.
  if (request.status === "succeeded") return "settled";
  if (request.status === "failed") return "failed";
  // A queued payout with a reference is a cancelled export: PayPal may still have paid the cancelled file.
  if (request.status !== "exported" && request.status !== "queued") return "unmatched";
  const sameCurrency = result.currency === null || result.currency === request.currency;
  const sameAmount = result.amountMinor === null || result.amountMinor === request.sentMinor;
  if (!sameCurrency || !sameAmount) {
    await updatePayoutRequest(tx, request.id, { reviewReason: LOG_MISMATCH });
    return "mismatched";
  }
  const itemStatus = result.paypalStatus || null;
  if (result.status === "pending") {
    await updatePayoutRequest(tx, request.id, {
      paypalItemId: result.transactionId ?? request.paypalItemId,
      paypalItemStatus: itemStatus,
      reviewReason: request.status === "queued" ? CANCELLED_EXPORT_PENDING : null,
    });
    return "pending";
  }
  if (result.status === "failed") {
    const said = `PayPal did not pay this payout (${result.paypalStatus})`;
    await applySettlement(tx, request, {
      kind: "failed",
      itemId: result.transactionId,
      itemStatus,
      message: result.reason ? `${said}: ${result.reason}` : `${said}.`,
    });
    return "failed";
  }
  await applySettlement(tx, request, {
    kind: "succeeded",
    itemId: result.transactionId,
    itemStatus,
    fee:
      result.feeMinor === null
        ? { feeMinor: null, reviewReason: "Payout fee missing" }
        : { feeMinor: result.feeMinor, reviewReason: null },
  });
  return "settled";
}

// Rows are matched by the Customer ID the export wrote, within the team. Each row settles in its own transaction, so
// importing the same log again changes nothing.
export async function importPayoutsWeb(db: Database, input: { teamId: string; csv: string }): Promise<PayoutsWebImport> {
  const results = refusingBadFiles(() => parsePayoutsWebLog(input.csv));
  const counts: PayoutsWebImport = { settled: 0, failed: 0, pending: 0, unmatched: 0, mismatched: 0, paidTwice: 0 };
  for (const result of results) {
    counts[await db.transaction((tx) => importResult(tx, input.teamId, result))]++;
  }
  return counts;
}

// Back to approved, for a payout the admin did not send in PayPal after all. The reference and the amounts stay, so
// importing the cancelled file's log still settles the payout if PayPal paid it.
export async function cancelPayoutsWebExport(
  db: Database,
  input: { teamId: string; requestId: string },
): Promise<PayoutRequestView> {
  const row = await db.transaction(async (tx) => {
    const request = await lockTeamRequest(tx, input.teamId, input.requestId);
    if (request.status !== "exported") throw badRequest(NOT_EXPORTED);
    const automatic = await hasTeamPayoutCredentials(tx, request.teamId);
    return updatePayoutRequest(tx, request.id, {
      status: "queued",
      offlineBatchId: null,
      sentAt: null,
      paypalItemId: null,
      paypalItemStatus: null,
      reviewReason: null,
      failureMessage: automatic ? null : WAITING_FOR_EXPORT,
    });
  });
  return payoutRequestView(row);
}
