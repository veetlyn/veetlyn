import {
  estimatePayoutFeeMinor,
  ledgerAccounts,
  parseMajorAmount,
  payoutAmountProblem,
  payoutBatchOutcome,
  payoutFeeRecoveredTransfer,
  payoutFeesTransfer,
  payoutItemOutcome,
  payoutReleasedTransfer,
  payoutRequestedTransfer,
  type PayoutRequestStatus,
  payoutSentProblem,
  payoutSucceededTransfer,
  type ServicesTeamRecord,
  toPayPalValue,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import {
  getTeamPayoutCredentials,
  lockTeamPayoutCredentialsForSend,
  type TeamPayoutCredentialsRow,
} from "@jendal-workspace/db/repositories/payout-credentials";
import {
  getPayoutRequest,
  insertPayoutRequest,
  listTeamPayoutRequests,
  listUserPayoutRequests,
  lockPayoutRequest,
  type PayoutRequestRow,
  updatePayoutRequest,
} from "@jendal-workspace/db/repositories/payout-requests";
import { getPayoutDestination, listMemberEarnings, type MemberEarningsRow } from "@jendal-workspace/db/repositories/payouts";
import { getTeamPayPalCountry } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { findServicesTeamBySlug, getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import {
  type PayoutBatch,
  type PayoutItem,
  type PayPalBalances,
  type PayPalClient,
  PayPalError,
} from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";

import type { PayoutServices } from "../context";
import { credentialsMatchTeam, payoutClientFromCredentials } from "./payout-credentials";
import {
  isPayPalRequestInProgress,
  isSettledPayPalRefusal,
  payPalErrorLog,
  payPalRefusalMessage,
  payPalValueMinor,
  postIfNew,
} from "./paypal-amounts";

// tRPC has no transformer here, so dates are ISO strings.
export type PayoutRequestView = {
  id: string;
  userId: string;
  currency: "USD" | "EUR";
  amountMinor: number;
  status: PayoutRequestStatus;
  // True while PayPal's answer to a send is unknown; a retry sends the same batch again.
  uncertain: boolean;
  receiverPayerId: string;
  failureMessage: string | null;
  reviewReason: string | null;
  // PayPal's fee as estimated when the send was claimed, and what was sent: the amount less that estimate.
  feeEstimateMinor: number | null;
  sentMinor: number | null;
  // The fee PayPal reported once the payout succeeded.
  feeMinor: number | null;
  paypalBatchId: string | null;
  paypalItemStatus: string | null;
  createdAt: string;
  decidedAt: string | null;
  sentAt: string | null;
  settledAt: string | null;
};

export type TeamPayoutRequestView = PayoutRequestView & { memberName: string; memberEmail: string };
export type MemberPayoutRequestView = PayoutRequestView & { teamName: string; teamSlug: string };
// senderCountry and receiverCountry are the countries estimatePayoutFeeMinor takes for a payout from this team.
export type MemberEarningsView = Omit<MemberEarningsRow, "teamPayPalCountry"> & {
  senderCountry: string | null;
  receiverCountry: string | null;
};
export type MemberPayoutsView = { earnings: MemberEarningsView[]; requests: MemberPayoutRequestView[] };

export type PayoutTeam = Pick<ServicesTeamRecord, "id" | "name" | "paypalMerchantId">;
export type PayoutDeps = { db: Database; payouts: PayoutServices };

const NO_CREDENTIALS = "Turn on automatic payouts to pay requests.";
const OTHER_ACCOUNT =
  "Automatic payouts are on for another PayPal account than the one connected to this team. Turn them on again.";
const SEALED_SECRET_UNREADABLE = "The team's automatic payouts connection could not be read. Turn on automatic payouts again.";
const LOW_BALANCE = "The team's PayPal balance is too low. Add funds, then retry.";
const BALANCE_UNREADABLE = "We could not read the team's PayPal balance. Try again.";
const CREDENTIALS_REFUSED = "PayPal refused the team's automatic payouts connection. Turn on automatic payouts again.";
const UNCERTAIN = "We could not confirm the payout with PayPal. Try again; the member will not be paid twice.";
const DESTINATION_UNQUALIFIED = "The member's PayPal account no longer qualifies for payouts.";
const DESTINATION_CHANGED = "The member changed their PayPal account. Reject this request; they can request again.";
const MAX_FAILURE_MESSAGE = 500;
// A claim whose worker died before recording PayPal's answer stays `sending`; past this age a retry may take it over.
const STALE_SEND_MS = 5 * 60_000;
// PayPal refuses a sender_batch_id reused within 30 days but may pay a later reuse again, so a retry of an
// unconfirmed send stops well before that.
const MAX_UNCERTAIN_RETRY_MS = 25 * 86_400_000;

function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function payoutRequestView(row: PayoutRequestRow): PayoutRequestView {
  return {
    id: row.id,
    userId: row.userId,
    currency: row.currency,
    amountMinor: row.amountMinor,
    status: row.status,
    // A stale `sending` claim counts as unconfirmed too: its worker may have died before recording the answer.
    uncertain: row.uncertainAt !== null || (row.status === "sending" && row.updatedAt.getTime() < Date.now() - STALE_SEND_MS),
    receiverPayerId: row.receiverPayerId,
    failureMessage: row.failureMessage,
    reviewReason: row.reviewReason,
    feeEstimateMinor: row.feeEstimateMinor,
    sentMinor: row.sentMinor,
    feeMinor: row.feeMinor,
    paypalBatchId: row.paypalBatchId,
    paypalItemStatus: row.paypalItemStatus,
    createdAt: row.createdAt.toISOString(),
    decidedAt: isoOrNull(row.decidedAt),
    sentAt: isoOrNull(row.sentAt),
    settledAt: isoOrNull(row.settledAt),
  };
}

function postingFor(request: PayoutRequestRow) {
  return {
    currency: request.currency,
    payoutRequestId: request.id,
    freelancerId: request.userId,
    amountMinor: request.amountMinor,
  };
}

type SendAmounts = { feeEstimateMinor: number; sentMinor: number };

// PayPal's fee comes off the payout, estimated from the team's and the member's PayPal countries.
async function sendAmountsFor(db: DbExecutor, request: PayoutRequestRow): Promise<SendAmounts> {
  const senderCountry = await getTeamPayPalCountry(db, request.teamId);
  const destination = await getPayoutDestination(db, request.userId);
  const feeEstimateMinor = estimatePayoutFeeMinor({
    currency: request.currency,
    amountMinor: request.amountMinor,
    senderCountry,
    receiverCountry: destination?.paypalCountry ?? null,
  });
  return { feeEstimateMinor, sentMinor: request.amountMinor - feeEstimateMinor };
}

// A claimed send always stored both (the table's check keeps them together).
function claimedAmounts(request: PayoutRequestRow): SendAmounts {
  if (request.feeEstimateMinor === null || request.sentMinor === null) {
    throw new Error(`Payout request ${request.id} was sent without its fee estimate`);
  }
  return { feeEstimateMinor: request.feeEstimateMinor, sentMinor: request.sentMinor };
}

function notFound(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "Payout request not found." });
}

async function lockTeamRequest(tx: Transaction, teamId: string, requestId: string): Promise<PayoutRequestRow> {
  const request = await lockPayoutRequest(tx, requestId);
  if (!request || request.teamId !== teamId) throw notFound();
  return request;
}

// Owed money is the authorization: the account key uses the caller's own user id, so a member removed from the
// team can still request what they are owed, and anyone else has nothing to request.
export async function requestPayout(
  db: Database,
  input: { userId: string; teamSlug: string; amount: string },
): Promise<MemberPayoutRequestView> {
  const { userId } = input;
  const team = await findServicesTeamBySlug(db, input.teamSlug);
  if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
  const settings = await getServicesTeamSettings(db, team.id);
  if (settings?.solo) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A solo seller has no payouts to send." });
  }
  const amountMinor = parseMajorAmount(input.amount);
  if (amountMinor === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an amount like 25.00." });
  const destination = await getPayoutDestination(db, userId);
  if (!destination) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect your PayPal account on this page first." });
  }
  if (!destination.ageConfirmedAt) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Confirm you are 18 or older first." });
  }
  const currency = settings?.currency ?? "USD";

  const row = await db.transaction(async (tx) => {
    // The insert takes the one-open-request slot first: a concurrent request waits for this transaction and then
    // finds the slot taken, so two requests never spend the same balance.
    const inserted = await insertPayoutRequest(tx, {
      id: crypto.randomUUID(),
      teamId: team.id,
      userId,
      currency,
      amountMinor,
      receiverPayerId: destination.paypalPayerId,
    });
    if (!inserted) {
      throw new TRPCError({ code: "CONFLICT", message: "You already have a payout in progress for this team." });
    }
    const ledger = createPostgresLedger(team.id, tx);
    const availableMinor = await ledger.balance(ledgerAccounts.owedAvailable(userId), currency);
    const problem = payoutAmountProblem({ amountMinor, availableMinor });
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
    await ledger.post([payoutRequestedTransfer(postingFor(inserted))]);
    return inserted;
  });
  return { ...payoutRequestView(row), teamName: team.name, teamSlug: team.slug };
}

function alreadyDecided(): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: "This payout request was already decided." });
}

export async function rejectPayoutRequest(
  db: Database,
  input: { teamId: string; requestId: string; deciderId: string },
): Promise<PayoutRequestView> {
  const row = await db.transaction(async (tx) => {
    const request = await lockTeamRequest(tx, input.teamId, input.requestId);
    if (request.status !== "requested") throw alreadyDecided();
    const updated = await updatePayoutRequest(tx, request.id, {
      status: "rejected",
      decidedByUserId: input.deciderId,
      decidedAt: new Date(),
    });
    await postIfNew(tx, request.teamId, payoutReleasedTransfer(postingFor(request)));
    return updated;
  });
  return payoutRequestView(row);
}

// The approval stands even when the send that follows is held (no credentials, low balance) or refused: the
// returned request carries the status and the message.
export async function approvePayoutRequest(
  deps: PayoutDeps,
  input: { team: PayoutTeam; requestId: string; deciderId: string },
): Promise<PayoutRequestView> {
  await deps.db.transaction(async (tx) => {
    const request = await lockTeamRequest(tx, input.team.id, input.requestId);
    if (request.status !== "requested") throw alreadyDecided();
    const tooSmall = payoutSentProblem((await sendAmountsFor(tx, request)).sentMinor);
    if (tooSmall) throw new TRPCError({ code: "BAD_REQUEST", message: tooSmall });
    await updatePayoutRequest(tx, request.id, {
      status: "queued",
      decidedByUserId: input.deciderId,
      decidedAt: new Date(),
    });
  });
  return payoutRequestView(await sendPayout(deps, input.team, input.requestId));
}

export async function retryPayout(
  deps: PayoutDeps,
  input: { team: PayoutTeam; requestId: string },
): Promise<PayoutRequestView> {
  return payoutRequestView(await sendPayout(deps, input.team, input.requestId));
}

type SendClaim =
  | { kind: "held"; request: PayoutRequestRow }
  | { kind: "claimed"; request: PayoutRequestRow; credentials: TeamPayoutCredentialsRow };

// Locks the request, then the credentials row (every claim takes them in this order), and commits `sending`
// before any PayPal call. Without usable credentials the request keeps its status and gets the reason.
async function claimSend(tx: Transaction, team: PayoutTeam, requestId: string): Promise<SendClaim> {
  const request = await lockTeamRequest(tx, team.id, requestId);
  const now = Date.now();
  const sending = request.status === "sending";
  const stale = sending && request.uncertainAt === null && request.updatedAt.getTime() < now - STALE_SEND_MS;
  if (sending && request.uncertainAt === null && !stale) {
    throw new TRPCError({ code: "CONFLICT", message: "This payout is being sent." });
  }
  if (request.status !== "queued" && !sending) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only an approved payout can be sent." });
  }
  // A stale claim may have reached PayPal before its worker died, so it is retried as unconfirmed.
  const uncertainAt = stale ? new Date(now) : request.uncertainAt;
  if (uncertainAt && uncertainAt.getTime() < now - MAX_UNCERTAIN_RETRY_MS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This payout is too old to retry safely. Contact support." });
  }
  // Only a fresh send re-checks the destination and estimates the fee: an uncertain retry may already have a batch
  // with PayPal, so it must go on with the same amount and record it.
  let amounts: SendAmounts | null = null;
  if (uncertainAt === null) {
    const destination = await getPayoutDestination(tx, request.userId);
    const destinationHold =
      !destination?.ageConfirmedAt
        ? DESTINATION_UNQUALIFIED
        : destination.paypalPayerId !== request.receiverPayerId
          ? DESTINATION_CHANGED
          : null;
    amounts = await sendAmountsFor(tx, request);
    const hold = destinationHold ?? payoutSentProblem(amounts.sentMinor);
    if (hold) {
      return { kind: "held", request: await updatePayoutRequest(tx, request.id, { failureMessage: hold }) };
    }
  }
  const credentials = await lockTeamPayoutCredentialsForSend(tx, team.id);
  const heldBecause = !credentials ? NO_CREDENTIALS : credentialsMatchTeam(credentials, team) ? null : OTHER_ACCOUNT;
  if (!credentials || heldBecause) {
    return { kind: "held", request: await updatePayoutRequest(tx, request.id, { uncertainAt, failureMessage: heldBecause }) };
  }
  // updated_at identifies this claim when its answer is recorded, so it must differ from every earlier claim's.
  const claimedAt = new Date(Math.max(now, request.updatedAt.getTime() + 1));
  const claimed = await updatePayoutRequest(tx, request.id, {
    status: "sending",
    uncertainAt,
    failureMessage: null,
    updatedAt: claimedAt,
    ...amounts,
  });
  return { kind: "claimed", request: claimed, credentials };
}

type SendOutcome =
  | { kind: "sent"; batchId: string }
  // PayPal made no payout: the request goes back to the queue.
  | { kind: "held"; message: string; cause: unknown }
  | { kind: "refused"; message: string; cause: unknown }
  | { kind: "uncertain"; cause: unknown };

function isInsufficientFunds(error: PayPalError): boolean {
  return error.name === "INSUFFICIENT_FUNDS" || error.details.some((detail) => detail.issue === "INSUFFICIENT_FUNDS");
}

const BATCH_LINK = /^(?:https?:\/\/[^/]+)?\/v1\/payments\/payouts\/([^/?#]+)\/?(?:[?#]|$)/;

// PayPal refuses a sender_batch_id it already used with a link to the original batch.
function linkedBatchId(error: PayPalError): string | null {
  for (const link of error.links) {
    const batchId = BATCH_LINK.exec(link.href)?.[1];
    if (batchId) return decodeURIComponent(batchId);
  }
  return null;
}

// A link in an error body is only a claim: the batch is this request's when it carries an item for it.
async function linkedBatchOutcome(
  client: PayPalClient,
  request: PayoutRequestRow,
  batchId: string,
  refusal: PayPalError,
): Promise<SendOutcome> {
  try {
    const batch = await client.payouts.getBatch(batchId);
    return batch.items.some((item) => item.senderItemId === request.id)
      ? { kind: "sent", batchId }
      : { kind: "uncertain", cause: refusal };
  } catch (cause) {
    return { kind: "uncertain", cause };
  }
}

// A negative balance pays nothing.
function availableMinorIn(value: string): number | null {
  return value.trim().startsWith("-") ? 0 : payPalValueMinor(value);
}

async function balanceProblem(
  client: PayPalClient,
  request: PayoutRequestRow,
): Promise<{ message: string; cause: unknown } | null> {
  let balances: PayPalBalances;
  try {
    balances = await client.reporting.balances(request.currency);
  } catch (cause) {
    const refused = cause instanceof PayPalError && cause.status === 401;
    return { message: refused ? CREDENTIALS_REFUSED : BALANCE_UNREADABLE, cause };
  }
  const balance = balances.balances.find((entry) => entry.currency === request.currency);
  const availableMinor = balance ? availableMinorIn(balance.available) : 0;
  if (availableMinor === null) return { message: BALANCE_UNREADABLE, cause: null };
  // The team's balance pays what is sent and PayPal's fee on top: about the whole requested amount.
  return availableMinor < request.amountMinor ? { message: LOW_BALANCE, cause: null } : null;
}

// Every attempt with the same send_attempt names the same batch and PayPal-Request-Id, so PayPal pays it once.
async function attemptSend(
  deps: PayoutDeps,
  team: PayoutTeam,
  claim: { request: PayoutRequestRow; credentials: TeamPayoutCredentialsRow },
): Promise<SendOutcome> {
  const { request } = claim;
  const { sentMinor } = claimedAmounts(request);
  let client: PayPalClient;
  try {
    client = await payoutClientFromCredentials(deps.payouts, claim.credentials);
  } catch (cause) {
    return { kind: "held", message: SEALED_SECRET_UNREADABLE, cause };
  }
  // After an unknown outcome PayPal may already have paid from the balance, so it is not checked again.
  if (request.uncertainAt === null) {
    const problem = await balanceProblem(client, request);
    if (problem) return { kind: "held", ...problem };
  }
  try {
    const created = await client.payouts.create({
      senderBatchId: `${request.id}-${request.sendAttempt}`,
      requestId: `payout:${request.id}:${request.sendAttempt}`,
      emailSubject: `You have a payout from ${team.name}`,
      item: {
        receiverPayerId: request.receiverPayerId,
        amount: { value: toPayPalValue(sentMinor), currency: request.currency },
        note: `Payout from ${team.name} via Payleor`,
        senderItemId: request.id,
      },
    });
    return { kind: "sent", batchId: created.batchId };
  } catch (error) {
    const linked = error instanceof PayPalError ? linkedBatchId(error) : null;
    if (linked && error instanceof PayPalError) return linkedBatchOutcome(client, request, linked, error);
    if (!isSettledPayPalRefusal(error) || isPayPalRequestInProgress(error)) return { kind: "uncertain", cause: error };
    if (isInsufficientFunds(error)) return { kind: "held", message: LOW_BALANCE, cause: error };
    return { kind: "refused", message: payPalRefusalMessage(error).slice(0, MAX_FAILURE_MESSAGE), cause: error };
  }
}

async function underRequestLock(
  db: Database,
  requestId: string,
  apply: (tx: Transaction, locked: PayoutRequestRow) => Promise<PayoutRequestRow>,
): Promise<PayoutRequestRow> {
  return db.transaction(async (tx) => {
    const locked = await lockPayoutRequest(tx, requestId);
    if (!locked) throw new Error(`Payout request ${requestId} disappeared`);
    return apply(tx, locked);
  });
}

// A held, refused or unconfirmed answer speaks only for its own claim: once a retry has taken the request over,
// that retry's batch may be with PayPal, so the older answer changes nothing.
async function recordForClaim(
  db: Database,
  claimed: PayoutRequestRow,
  apply: (tx: Transaction, locked: PayoutRequestRow) => Promise<PayoutRequestRow>,
): Promise<PayoutRequestRow> {
  return underRequestLock(db, claimed.id, (tx, locked) =>
    locked.status === "sending" && locked.updatedAt.getTime() === claimed.updatedAt.getTime()
      ? apply(tx, locked)
      : Promise.resolve(locked),
  );
}

// A batch id is PayPal's word that it holds this payout, whichever attempt it answered.
async function recordBatch(db: Database, requestId: string, batchId: string): Promise<PayoutRequestRow> {
  return underRequestLock(db, requestId, (tx, locked) =>
    locked.status === "sending" || locked.status === "queued"
      ? updatePayoutRequest(tx, locked.id, {
          status: "sent",
          paypalBatchId: batchId,
          sentAt: new Date(),
          uncertainAt: null,
          failureMessage: null,
        })
      : Promise.resolve(locked),
  );
}

// No transaction or lock is held across PayPal's calls. Held and refused sends return the request with its
// status and message; an unknown outcome is recorded and thrown as BAD_GATEWAY.
async function sendPayout(deps: PayoutDeps, team: PayoutTeam, requestId: string): Promise<PayoutRequestRow> {
  const claim = await deps.db.transaction((tx) => claimSend(tx, team, requestId));
  if (claim.kind === "held") return claim.request;
  const { request } = claim;

  let outcome = await attemptSend(deps, team, claim);
  // After an unknown outcome PayPal may hold a batch for this request, so only an answer with that batch is final.
  if (request.uncertainAt !== null && outcome.kind !== "sent") outcome = { kind: "uncertain", cause: outcome.cause };
  if (outcome.kind === "sent") {
    try {
      return await recordBatch(deps.db, request.id, outcome.batchId);
    } catch (cause) {
      // PayPal made the batch; a retry gets it back under the same ids and records it.
      outcome = { kind: "uncertain", cause };
    }
  }

  log.warn({
    action: "payout.send",
    payoutRequest: { id: request.id, sendAttempt: request.sendAttempt },
    team: { id: team.id },
    outcome: outcome.kind,
    error: payPalErrorLog(outcome.cause),
  });
  if (outcome.kind === "held") {
    const message = outcome.message;
    // The next attempt gets fresh ids: PayPal made no payout under these, and might replay this refusal for them.
    return recordForClaim(deps.db, request, (tx, locked) =>
      updatePayoutRequest(tx, locked.id, { status: "queued", failureMessage: message, sendAttempt: locked.sendAttempt + 1 }),
    );
  }
  if (outcome.kind === "refused") {
    const message = outcome.message;
    return recordForClaim(deps.db, request, async (tx, locked) => {
      const failed = await updatePayoutRequest(tx, locked.id, {
        status: "failed",
        failureMessage: message,
        settledAt: new Date(),
      });
      await postIfNew(tx, locked.teamId, payoutReleasedTransfer(postingFor(locked)));
      return failed;
    });
  }
  try {
    await recordForClaim(deps.db, request, (tx, locked) =>
      updatePayoutRequest(tx, locked.id, { uncertainAt: locked.uncertainAt ?? new Date(), failureMessage: UNCERTAIN }),
    );
  } catch (recordError) {
    log.error({ action: "payout.send_record", payoutRequest: { id: request.id }, error: payPalErrorLog(recordError) });
  }
  throw new TRPCError({ code: "BAD_GATEWAY", message: UNCERTAIN, cause: outcome.cause ?? undefined });
}

type Settlement =
  | { kind: "succeeded"; item: PayoutItem }
  | { kind: "failed"; itemId: string | null; itemStatus: string | null; message: string }
  | { kind: "pending"; item: PayoutItem | undefined }
  | { kind: "unmatched" };

const NO_MATCHING_ITEM = "PayPal's batch has no item for this payout";

// An item whose sender_item_id PayPal left out is taken only when it is the batch's one item.
function itemFor(request: PayoutRequestRow, batch: PayoutBatch): PayoutItem | undefined {
  const [only] = batch.items;
  return (
    batch.items.find((entry) => entry.senderItemId === request.id) ??
    (batch.items.length === 1 && only?.senderItemId === undefined ? only : undefined)
  );
}

function settlementOf(request: PayoutRequestRow, batch: PayoutBatch): Settlement {
  const item = itemFor(request, batch);
  // Items that all belong to other payouts say nothing about this one, not even through the batch status.
  if (!item && batch.items.length > 0) return { kind: "unmatched" };
  const itemOutcome = payoutItemOutcome(item?.status);
  if (item && itemOutcome === "succeeded") return { kind: "succeeded", item };
  if (item && itemOutcome === "failed") {
    const message = item.error
      ? [item.error.name, item.error.message].filter(Boolean).join(": ")
      : `PayPal did not pay this payout (${item.status}).`;
    return { kind: "failed", itemId: item.itemId, itemStatus: item.status ?? null, message };
  }
  if (payoutBatchOutcome(batch.batchStatus) === "failed") {
    return {
      kind: "failed",
      itemId: item?.itemId ?? null,
      itemStatus: item?.status ?? null,
      message: `PayPal did not pay this payout (batch ${batch.batchStatus}).`,
    };
  }
  return { kind: "pending", item };
}

// A null fee when PayPal's fee cannot be posted; the review reason says why.
type PayoutFee = { feeMinor: number | null; reviewReason: string | null };

function payoutFee(request: PayoutRequestRow, item: PayoutItem): PayoutFee {
  if (!item.fee) return { feeMinor: null, reviewReason: "Payout fee missing" };
  if (item.fee.currency !== request.currency) {
    return { feeMinor: null, reviewReason: "Payout fee in another currency" };
  }
  const feeMinor = payPalValueMinor(item.fee.value);
  return feeMinor === null ? { feeMinor: null, reviewReason: "Payout fee unreadable" } : { feeMinor, reviewReason: null };
}

async function recordSettlement(tx: Transaction, request: PayoutRequestRow, settlement: Settlement): Promise<PayoutRequestRow> {
  if (settlement.kind === "unmatched") {
    log.warn({
      action: "payout.settle",
      payoutRequest: { id: request.id },
      paypal: { batchId: request.paypalBatchId },
      reviewReason: NO_MATCHING_ITEM,
    });
    return updatePayoutRequest(tx, request.id, { reviewReason: NO_MATCHING_ITEM });
  }
  if (settlement.kind === "pending") {
    return updatePayoutRequest(tx, request.id, {
      paypalItemId: settlement.item?.itemId ?? request.paypalItemId,
      paypalItemStatus: settlement.item?.status ?? null,
      reviewReason: null,
    });
  }
  if (settlement.kind === "failed") {
    const failed = await updatePayoutRequest(tx, request.id, {
      status: "failed",
      paypalItemId: settlement.itemId,
      paypalItemStatus: settlement.itemStatus,
      failureMessage: settlement.message.slice(0, MAX_FAILURE_MESSAGE),
      reviewReason: null,
      settledAt: new Date(),
    });
    await postIfNew(tx, request.teamId, payoutReleasedTransfer(postingFor(request)));
    return failed;
  }
  const { item } = settlement;
  const { feeMinor, reviewReason } = payoutFee(request, item);
  if (reviewReason) log.warn({ action: "payout.fee", payoutRequest: { id: request.id }, reviewReason });
  const { feeEstimateMinor, sentMinor } = claimedAmounts(request);
  const succeeded = await updatePayoutRequest(tx, request.id, {
    status: "succeeded",
    paypalItemId: item.itemId,
    paypalItemStatus: item.status ?? null,
    feeMinor,
    reviewReason,
    settledAt: new Date(),
  });
  // The team's balance paid PayPal's fee; the member bears it up to the estimate kept back from their payout. A
  // lower fee releases the rest of the estimate to them, and the team absorbs a higher one. Without a usable fee
  // the estimate stands in for it, and the review reason says so.
  const chargedMinor = feeMinor ?? feeEstimateMinor;
  const posting = postingFor(request);
  const transfers = [
    payoutSucceededTransfer({ ...posting, sentMinor }),
    payoutFeesTransfer({ currency: request.currency, payoutRequestId: request.id, feeMinor: chargedMinor }),
    payoutFeeRecoveredTransfer({ ...posting, amountMinor: Math.min(chargedMinor, feeEstimateMinor) }),
    chargedMinor < feeEstimateMinor
      ? payoutReleasedTransfer({ ...posting, amountMinor: feeEstimateMinor - chargedMinor })
      : null,
  ];
  for (const transfer of transfers) if (transfer) await postIfNew(tx, request.teamId, transfer);
  return succeeded;
}

// Reads the batch with the team's saved credentials and records what PayPal decided, once: only a request still
// `sent` under its lock moves and posts. Missing credentials or a PayPal failure leave the request `sent`.
export async function settlePayout(deps: PayoutDeps, request: PayoutRequestRow): Promise<PayoutRequestRow> {
  if (request.status !== "sent" || request.paypalBatchId === null) return request;
  const batchId = request.paypalBatchId;
  const credentials = await getTeamPayoutCredentials(deps.db, request.teamId);
  if (!credentials) {
    log.warn({ action: "payout.settle", payoutRequest: { id: request.id }, credentials: { saved: false } });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: NO_CREDENTIALS });
  }
  let client: PayPalClient;
  try {
    client = await payoutClientFromCredentials(deps.payouts, credentials);
  } catch (cause) {
    log.warn({ action: "payout.settle", payoutRequest: { id: request.id }, error: payPalErrorLog(cause) });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEALED_SECRET_UNREADABLE, cause });
  }
  let batch: PayoutBatch;
  try {
    batch = await client.payouts.getBatch(batchId);
  } catch (cause) {
    log.warn({ action: "payout.settle", payoutRequest: { id: request.id }, error: payPalErrorLog(cause) });
    throw new TRPCError({ code: "BAD_GATEWAY", message: "PayPal did not answer. Try again.", cause });
  }
  const settlement = settlementOf(request, batch);
  return deps.db.transaction(async (tx) => {
    const locked = await lockPayoutRequest(tx, request.id);
    if (!locked) throw new Error(`Payout request ${request.id} disappeared`);
    return locked.status === "sent" ? recordSettlement(tx, locked, settlement) : locked;
  });
}

export async function refreshPayout(
  deps: PayoutDeps,
  input: { teamId: string; requestId: string },
): Promise<PayoutRequestView> {
  const request = await getPayoutRequest(deps.db, input.requestId);
  if (!request || request.teamId !== input.teamId) throw notFound();
  return payoutRequestView(await settlePayout(deps, request));
}

export async function listTeamPayouts(db: Database, teamId: string): Promise<TeamPayoutRequestView[]> {
  const rows = await listTeamPayoutRequests(db, teamId);
  return rows.map((row) => ({ ...payoutRequestView(row), memberName: row.memberName, memberEmail: row.memberEmail }));
}

export async function getMemberPayouts(db: Database, userId: string): Promise<MemberPayoutsView> {
  const [earnings, requests, destination] = await Promise.all([
    listMemberEarnings(db, userId),
    listUserPayoutRequests(db, userId),
    getPayoutDestination(db, userId),
  ]);
  return {
    earnings: earnings.map(({ teamPayPalCountry, ...row }) => ({
      ...row,
      senderCountry: teamPayPalCountry,
      receiverCountry: destination?.paypalCountry ?? null,
    })),
    requests: requests.map((row) => ({ ...payoutRequestView(row), teamName: row.teamName, teamSlug: row.teamSlug })),
  };
}
