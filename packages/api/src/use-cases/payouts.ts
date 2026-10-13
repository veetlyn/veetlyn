import {
  balanceHold,
  decidePayout,
  estimatePayoutFeeMinor,
  ledgerAccounts,
  MAX_PAYOUT_MINOR,
  parseMajorAmount,
  payoutAmountProblem,
  payoutBatchOutcome,
  type PayoutFacts,
  payoutFeeRecoveredTransfer,
  payoutFeesTransfer,
  payoutItemOutcome,
  payoutReleasedTransfer,
  payoutRequestedTransfer,
  type PayoutRequestStatus,
  type PayoutRules,
  payoutSentProblem,
  payoutSucceededTransfer,
  retryDelayMs,
  type ServicesTeamRecord,
  toPayPalValue,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import {
  getTeamPayoutCredentials,
  hasTeamPayoutCredentials,
  lockTeamPayoutCredentialsForSend,
  type TeamPayoutCredentialsRow,
} from "@jendal-workspace/db/repositories/payout-credentials";
import {
  type CompletedProjectWithoutPayout,
  earningsOnHoldMinor,
  getPayoutRequest,
  insertPayoutApproval,
  insertPayoutRequest,
  listCompletedProjectsWithoutPayout,
  listPayoutApproverIds,
  listTeamPayoutRequests,
  listUserPayoutRequests,
  lockPayoutRequest,
  type PayoutRequestPatch,
  type PayoutRequestRow,
  type TeamPayoutRequestRow,
  updatePayoutRequest,
} from "@jendal-workspace/db/repositories/payout-requests";
import { getPayoutRules, type StoredPayoutRules } from "@jendal-workspace/db/repositories/payout-rules";
import { getPayoutDestination, listMemberEarnings, type MemberEarningsRow } from "@jendal-workspace/db/repositories/payouts";
import { getTeamPayPalCountry } from "@jendal-workspace/db/repositories/paypal-onboarding";
import {
  findServicesTeamBySlug,
  getServicesTeamSettings,
  listServicesTeamMembers,
} from "@jendal-workspace/db/repositories/services-teams";
import { type PayoutBatch, type PayoutItem, type PayPalClient, PayPalError } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";

import type { PayoutServices } from "../context";
import { credentialsMatchTeam, payoutClientFromCredentials } from "./payout-credentials";
import { adminCountOf, type PayoutRulesTeam } from "./payout-rules";
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
  source: PayoutRequestRow["source"];
  projectId: string | null;
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
  // The payday an approved payout waits for, and the next try of one the send sweep holds back.
  sendAfter: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  settledAt: string | null;
};

export type TeamPayoutRequestView = PayoutRequestView & {
  memberName: string;
  memberEmail: string;
  projectTitle: string | null;
  approvals: number;
  approvalsNeeded: number;
};
// A completed project past its hold whose member cannot be paid yet (no verified PayPal destination or no 18+
// confirmation); the project sweep creates its payout once they can.
export type WaitingForDestinationView = {
  projectId: string;
  title: string;
  memberName: string;
  earningsMinor: number;
  currency: PayoutRequestRow["currency"];
};
export type TeamPayoutsView = {
  payouts: TeamPayoutRequestView[];
  adminCount: number;
  waitingForDestination: WaitingForDestinationView[];
};
// approvalsNeeded is 0 once the payout is approved.
export type PayoutApprovalView = PayoutRequestView & { approvalsNeeded: number };
export type MemberPayoutRequestView = PayoutRequestView & { teamName: string; teamSlug: string; projectTitle: string | null };
// senderCountry and receiverCountry are the countries estimatePayoutFeeMinor takes for a payout from this team.
export type MemberEarningsView = Omit<MemberEarningsRow, "teamPayPalCountry"> & {
  senderCountry: string | null;
  receiverCountry: string | null;
};
export type MemberPayoutsView = { earnings: MemberEarningsView[]; requests: MemberPayoutRequestView[] };

export type PayoutTeam = Pick<ServicesTeamRecord, "id" | "name" | "paypalMerchantId">;
export type PayoutDeps = { db: Database; payouts: PayoutServices; now?: () => Date };
// Without payout services a member can still request; an approved request then waits for the send sweep.
export type RequestPayoutDeps = Omit<PayoutDeps, "payouts"> & { payouts?: PayoutServices };

const NO_CREDENTIALS = "Turn on automatic payouts to pay requests.";
export const WAITING_FOR_EXPORT = "Waiting for export or for automatic payouts.";
const OTHER_ACCOUNT =
  "Automatic payouts are on for another PayPal account than the one connected to this team. Turn them on again.";
const SEALED_SECRET_UNREADABLE = "The team's automatic payouts connection could not be read. Turn on automatic payouts again.";
const LOW_BALANCE = "The team's PayPal balance is too low. Add funds, then retry.";
const CREDENTIALS_REFUSED = "PayPal refused the team's automatic payouts connection. Turn on automatic payouts again.";
const PAYOUTS_NOT_ENABLED =
  "PayPal has not turned on Payouts for the team's PayPal account. Ask PayPal to turn it on, then retry.";
const UNCERTAIN = "We could not confirm the payout with PayPal. Try again; the member will not be paid twice.";
const DESTINATION_UNQUALIFIED = "The member's PayPal account no longer qualifies for payouts.";
const DESTINATION_CHANGED = "The member changed their PayPal account. Reject this request; they can request again.";
const MAX_FAILURE_MESSAGE = 500;
// A claim whose worker died before recording PayPal's answer stays `sending`; past this age a retry may take it over.
const STALE_SEND_MS = 5 * 60_000;
// PayPal refuses a sender_batch_id reused within 30 days but may pay a later reuse again, so a retry of an
// unconfirmed send stops well before that.
const MAX_UNCERTAIN_RETRY_MS = 25 * 86_400_000;
const PAYDAY_DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

export function nowOf(deps: { now?: () => Date }): Date {
  return deps.now?.() ?? new Date();
}

const DAY_MS = 86_400_000;

// Projects completed up to this time are past the team's hold.
export function holdEndsBefore(rules: Pick<PayoutRules, "holdDays">, now: Date): Date {
  return new Date(now.getTime() - rules.holdDays * DAY_MS);
}

function backoff(request: PayoutRequestRow, now: Date): PayoutRequestPatch {
  return { waitCount: request.waitCount + 1, nextAttemptAt: new Date(now.getTime() + retryDelayMs(request.waitCount)) };
}

type Decided = { row: PayoutRequestRow; sendNow: boolean };

// A team without automatic payouts never has its approved payouts sent by Payleor: they wait for a Payouts Web export
// (or for automatic payouts to be turned on).
async function markApproved(
  tx: DbExecutor,
  request: PayoutRequestRow,
  input: { now: Date; sendAfter: Date; decidedByUserId?: string },
): Promise<Decided> {
  const automatic = await hasTeamPayoutCredentials(tx, request.teamId);
  const row = await updatePayoutRequest(tx, request.id, {
    status: "queued",
    decidedByUserId: input.decidedByUserId,
    decidedAt: input.now,
    sendAfter: input.sendAfter,
    failureMessage: automatic ? null : WAITING_FOR_EXPORT,
  });
  return { row, sendNow: automatic && input.sendAfter.getTime() <= input.now.getTime() };
}

// A failed send leaves the payout approved and queued; the send sweep tries it again.
async function sendDecided(deps: RequestPayoutDeps, team: PayoutTeam, decided: Decided, now: Date): Promise<PayoutRequestRow> {
  if (!deps.payouts || !decided.sendNow) return decided.row;
  try {
    return await sendPayout({ ...deps, payouts: deps.payouts, now: () => now }, team, decided.row.id);
  } catch (error) {
    log.warn({ action: "payout.request_send", payoutRequest: { id: decided.row.id }, error: payPalErrorLog(error) });
    return (await getPayoutRequest(deps.db, decided.row.id)) ?? decided.row;
  }
}

function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function payoutRequestView(row: PayoutRequestRow): PayoutRequestView {
  return {
    id: row.id,
    userId: row.userId,
    currency: row.currency,
    amountMinor: row.amountMinor,
    source: row.source,
    projectId: row.projectId,
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
    sendAfter: isoOrNull(row.sendAfter),
    nextAttemptAt: isoOrNull(row.nextAttemptAt),
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
async function estimateSendAmounts(
  db: DbExecutor,
  payout: { teamId: string; currency: PayoutRequestRow["currency"]; amountMinor: number; receiverCountry: string | null },
): Promise<SendAmounts> {
  const feeEstimateMinor = estimatePayoutFeeMinor({
    currency: payout.currency,
    amountMinor: payout.amountMinor,
    senderCountry: await getTeamPayPalCountry(db, payout.teamId),
    receiverCountry: payout.receiverCountry,
  });
  return { feeEstimateMinor, sentMinor: payout.amountMinor - feeEstimateMinor };
}

export async function sendAmountsFor(db: DbExecutor, request: PayoutRequestRow): Promise<SendAmounts> {
  const destination = await getPayoutDestination(db, request.userId);
  return estimateSendAmounts(db, { ...request, receiverCountry: destination?.paypalCountry ?? null });
}

// Why an approved payout cannot go to the destination it was approved for, or null when it can.
export async function destinationHold(db: DbExecutor, request: PayoutRequestRow): Promise<string | null> {
  const destination = await getPayoutDestination(db, request.userId);
  if (!destination?.ageConfirmedAt) return DESTINATION_UNQUALIFIED;
  return destination.paypalPayerId === request.receiverPayerId ? null : DESTINATION_CHANGED;
}

// A queued payout flagged for review (a cancelled export PayPal shows as pending) is not sent or exported until a
// later log settles it or an admin rejects it.
export function reviewHold(request: PayoutRequestRow): string | null {
  return request.status === "queued" ? request.reviewReason : null;
}

export function paydayWait(request: PayoutRequestRow, now: Date): string | null {
  return request.sendAfter && request.sendAfter.getTime() > now.getTime()
    ? `This payout goes on payday, ${PAYDAY_DATE.format(request.sendAfter)}.`
    : null;
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

export async function lockTeamRequest(tx: Transaction, teamId: string, requestId: string): Promise<PayoutRequestRow> {
  const request = await lockPayoutRequest(tx, requestId);
  if (!request || request.teamId !== teamId) throw notFound();
  return request;
}

// The floor only decides auto-approval, so the balance is read only when an auto-approval rule would otherwise
// approve the payout.
async function balanceForAutoApproval(
  deps: RequestPayoutDeps,
  team: PayoutTeam,
  input: { rules: PayoutRules; facts: PayoutFacts; currency: PayoutRequestRow["currency"] },
): Promise<number | null> {
  if (input.rules.balanceFloorMinor === null || !deps.payouts) return null;
  const unlimited = decidePayout(input.rules, { ...input.facts, balanceMinor: Number.MAX_SAFE_INTEGER }, input.currency);
  if (unlimited.kind !== "approved") return null;
  return readTeamBalanceMinor({ ...deps, payouts: deps.payouts }, team, input.currency);
}

// Owed money is the authorization: the account key uses the caller's own user id, so a member removed from the
// team can still request what they are owed, and anyone else has nothing to request.
export async function requestPayout(
  deps: RequestPayoutDeps,
  input: { userId: string; teamSlug: string; amount: string },
): Promise<MemberPayoutRequestView> {
  const { db } = deps;
  const { userId } = input;
  const now = nowOf(deps);
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
  const rules = await getPayoutRules(db, team.id);
  const facts: PayoutFacts = { amountMinor, source: "member", memberId: userId, approverIds: [], balanceMinor: null, now };
  // Read before the transaction so no lock is held across PayPal's answer.
  const balanceMinor = await balanceForAutoApproval(deps, team, { rules, facts, currency });

  const decided = await db.transaction(async (tx) => {
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
    // Approving re-checks this with the countries known then; refusing here keeps an unpayable request off the queue.
    const { sentMinor } = await estimateSendAmounts(tx, {
      teamId: team.id,
      currency,
      amountMinor,
      receiverCountry: destination.paypalCountry,
    });
    const tooSmall = payoutSentProblem(sentMinor);
    if (tooSmall) throw new TRPCError({ code: "BAD_REQUEST", message: tooSmall });
    const decision = decidePayout(rules, { ...facts, balanceMinor }, currency);
    if (decision.kind === "refused") throw new TRPCError({ code: "BAD_REQUEST", message: decision.reason });
    await ledger.post([payoutRequestedTransfer(postingFor(inserted))]);
    if (decision.kind !== "approved") return { row: inserted, sendNow: false };
    return markApproved(tx, inserted, { now, sendAfter: decision.sendAfter });
  });

  const row = await sendDecided(deps, team, decided, now);
  return { ...payoutRequestView(row), teamName: team.name, teamSlug: team.slug, projectTitle: null };
}

// The payout of a completed project past its hold: the member's earnings from it, capped at what they have available
// now (an earlier request may have taken some) less their earnings from projects still inside the hold, which are
// not this project's to pay, and at PayPal's per-item maximum; the member requests any rest themselves. Null when nothing is created: the member cannot be paid yet, nothing is left, or the
// amount is under the team minimum or too small to cover PayPal's fee.
export async function createProjectPayout(
  deps: RequestPayoutDeps,
  input: { team: PayoutTeam; rules: PayoutRules; project: CompletedProjectWithoutPayout; now: Date },
): Promise<PayoutRequestRow | null> {
  const { team, rules, project, now } = input;
  const memberId = project.freelancerId;
  const destination = await getPayoutDestination(deps.db, memberId);
  if (!destination?.ageConfirmedAt) return null;
  // Read before the transaction so no lock is held across PayPal's answer; only a floor needs it.
  const balanceMinor =
    rules.balanceFloorMinor !== null && deps.payouts
      ? await readTeamBalanceMinor({ ...deps, payouts: deps.payouts }, team, project.currency)
      : null;

  const decided = await deps.db.transaction(async (tx): Promise<Decided | null> => {
    const ledger = createPostgresLedger(team.id, tx);
    const availableMinor = await ledger.balance(ledgerAccounts.owedAvailable(memberId), project.currency);
    const onHoldMinor = await earningsOnHoldMinor(tx, {
      teamId: team.id,
      memberId,
      currency: project.currency,
      completedAfter: holdEndsBefore(rules, now),
    });
    const amountMinor = Math.min(project.earningsMinor, availableMinor - onHoldMinor, MAX_PAYOUT_MINOR);
    if (amountMinor <= 0) return null;
    const { sentMinor } = await estimateSendAmounts(tx, {
      teamId: team.id,
      currency: project.currency,
      amountMinor,
      receiverCountry: destination.paypalCountry,
    });
    if (payoutSentProblem(sentMinor)) return null;
    const decision = decidePayout(
      rules,
      { amountMinor, source: "project", memberId, approverIds: [], balanceMinor, now },
      project.currency,
    );
    if (decision.kind === "refused") return null;
    const inserted = await insertPayoutRequest(tx, {
      id: crypto.randomUUID(),
      teamId: team.id,
      userId: memberId,
      currency: project.currency,
      amountMinor,
      receiverPayerId: destination.paypalPayerId,
      source: "project",
      projectId: project.projectId,
    });
    if (!inserted) throw new Error(`Payout for project ${project.projectId} was not inserted`);
    await ledger.post([payoutRequestedTransfer(postingFor(inserted))]);
    if (decision.kind !== "approved") return { row: inserted, sendNow: false };
    return markApproved(tx, inserted, { now, sendAfter: decision.sendAfter });
  });
  return decided && sendDecided(deps, team, decided, now);
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
    // A queued request was held before PayPal made any payout, unless an earlier send went unconfirmed.
    if (request.status === "queued" && request.uncertainAt !== null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "PayPal may already have this payout. Retry it to find out." });
    }
    if (request.status !== "requested" && request.status !== "queued") throw alreadyDecided();
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

// The approval stands even when the send that follows is held (low balance, floor) or refused: the returned request
// carries the status and the message. A payout approved before its payday is sent then, and one of a team without
// automatic payouts waits for an export.
export async function approvePayoutRequest(
  deps: PayoutDeps,
  input: { team: PayoutTeam; requestId: string; deciderId: string },
): Promise<PayoutApprovalView> {
  const now = nowOf(deps);
  const decided = await deps.db.transaction(async (tx) => {
    const request = await lockTeamRequest(tx, input.team.id, input.requestId);
    if (request.status !== "requested") throw alreadyDecided();
    if (request.userId === input.deciderId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot approve a payout to yourself." });
    }
    const tooSmall = payoutSentProblem((await sendAmountsFor(tx, request)).sentMinor);
    if (tooSmall) throw new TRPCError({ code: "BAD_REQUEST", message: tooSmall });
    if (!(await insertPayoutApproval(tx, { requestId: request.id, adminUserId: input.deciderId }))) {
      throw new TRPCError({ code: "CONFLICT", message: "You already approved this payout." });
    }
    // Enough admin approvals approve a payout whatever the balance; the floor is checked again before sending.
    const decision = decidePayout(
      await getPayoutRules(tx, request.teamId),
      {
        amountMinor: request.amountMinor,
        source: request.source,
        memberId: request.userId,
        approverIds: await listPayoutApproverIds(tx, request.id),
        balanceMinor: null,
        now,
      },
      request.currency,
    );
    if (decision.kind === "refused") throw new TRPCError({ code: "BAD_REQUEST", message: decision.reason });
    if (decision.kind === "needs_approval") {
      return { row: request, sendNow: false, approvalsNeeded: decision.approvalsNeeded };
    }
    const approved = await markApproved(tx, request, { now, sendAfter: decision.sendAfter, decidedByUserId: input.deciderId });
    return { ...approved, approvalsNeeded: 0 };
  });
  const row = decided.sendNow ? await sendPayout(deps, input.team, input.requestId) : decided.row;
  return { ...payoutRequestView(row), approvalsNeeded: decided.approvalsNeeded };
}

// Retry skips the backoff but not the payday.
export async function retryPayout(
  deps: PayoutDeps,
  input: { team: PayoutTeam; requestId: string },
): Promise<PayoutRequestView> {
  const request = await getPayoutRequest(deps.db, input.requestId);
  if (!request || request.teamId !== input.team.id) throw notFound();
  const wait = reviewHold(request) ?? paydayWait(request, nowOf(deps));
  if (wait) throw new TRPCError({ code: "BAD_REQUEST", message: wait });
  return payoutRequestView(await sendPayout(deps, input.team, input.requestId));
}

type SendClaim =
  | { kind: "held"; request: PayoutRequestRow }
  | { kind: "claimed"; request: PayoutRequestRow; credentials: TeamPayoutCredentialsRow };

// Locks the request, then the credentials row (every claim takes them in this order), and commits `sending`
// before any PayPal call. Without usable credentials the request keeps its status and gets the reason. Holds that
// need someone to act back off from `attemptAt`, except missing credentials: the send sweep never picks those up.
async function claimSend(tx: Transaction, team: PayoutTeam, requestId: string, attemptAt: Date): Promise<SendClaim> {
  const request = await lockTeamRequest(tx, team.id, requestId);
  // The claim's own times use the wall clock: they are compared with updated_at, which the database keeps.
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
    const unpayable = await destinationHold(tx, request);
    amounts = await sendAmountsFor(tx, request);
    const hold = unpayable ?? payoutSentProblem(amounts.sentMinor);
    if (hold) {
      return {
        kind: "held",
        request: await updatePayoutRequest(tx, request.id, { failureMessage: hold, ...backoff(request, attemptAt) }),
      };
    }
  }
  const credentials = await lockTeamPayoutCredentialsForSend(tx, team.id);
  if (!credentials) {
    return {
      kind: "held",
      request: await updatePayoutRequest(tx, request.id, { uncertainAt, failureMessage: NO_CREDENTIALS }),
    };
  }
  if (!credentialsMatchTeam(credentials, team)) {
    return {
      kind: "held",
      request: await updatePayoutRequest(tx, request.id, {
        uncertainAt,
        failureMessage: OTHER_ACCOUNT,
        ...backoff(request, attemptAt),
      }),
    };
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
    // The client already retried a 401 with a fresh token, so PayPal refused these credentials and made no payout.
    if (error instanceof PayPalError && error.status === 401) {
      return { kind: "held", message: CREDENTIALS_REFUSED, cause: error };
    }
    // The account lacks Payouts permission: PayPal made no payout, and the admin can fix that and retry.
    if (error instanceof PayPalError && error.status === 403) {
      return { kind: "held", message: PAYOUTS_NOT_ENABLED, cause: error };
    }
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
          waitCount: 0,
          nextAttemptAt: null,
        })
      : Promise.resolve(locked),
  );
}

// Checked before every fresh send, before the claim so no lock is held while PayPal answers. An unconfirmed send
// skips it: PayPal may already have paid that payout, and only the retry finds out. Without usable credentials the
// claim gives the reason instead.
async function holdForBalance(
  deps: PayoutDeps,
  team: PayoutTeam,
  requestId: string,
  now: Date,
): Promise<PayoutRequestRow | null> {
  const request = await getPayoutRequest(deps.db, requestId);
  if (!request || request.teamId !== team.id || request.status !== "queued" || request.uncertainAt !== null) return null;
  const credentials = await getTeamPayoutCredentials(deps.db, team.id);
  if (!credentials || !credentialsMatchTeam(credentials, team)) return null;
  const hold = balanceHold(await getPayoutRules(deps.db, team.id), {
    amountMinor: request.amountMinor,
    balanceMinor: await readTeamBalanceMinor(deps, team, request.currency),
    currency: request.currency,
  });
  if (!hold) return null;
  return deps.db.transaction(async (tx) => {
    const locked = await lockPayoutRequest(tx, requestId);
    if (locked?.status !== "queued" || locked.uncertainAt !== null) return null;
    return updatePayoutRequest(tx, locked.id, { failureMessage: hold, ...backoff(locked, now) });
  });
}

// No transaction or lock is held across PayPal's calls. Held and refused sends return the request with its
// status and message; an unknown outcome is recorded and thrown as BAD_GATEWAY. A held payout waits for its next
// try: 15 minutes, 1 hour, 6 hours, then daily.
export async function sendPayout(deps: PayoutDeps, team: PayoutTeam, requestId: string): Promise<PayoutRequestRow> {
  const now = nowOf(deps);
  const heldForBalance = await holdForBalance(deps, team, requestId, now);
  if (heldForBalance) return heldForBalance;
  const claim = await deps.db.transaction((tx) => claimSend(tx, team, requestId, now));
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
      updatePayoutRequest(tx, locked.id, {
        status: "queued",
        failureMessage: message,
        sendAttempt: locked.sendAttempt + 1,
        ...backoff(locked, now),
      }),
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
export type PayoutFee = { feeMinor: number | null; reviewReason: string | null };

// What PayPal decided for a payout, from its API or from a Payouts Web log; itemId is PayPal's item or transaction id.
export type SettledOutcome =
  | { kind: "succeeded"; itemId: string | null; itemStatus: string | null; fee: PayoutFee }
  | { kind: "failed"; itemId: string | null; itemStatus: string | null; message: string };

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
  if (settlement.kind === "failed") return applySettlement(tx, request, settlement);
  const { item } = settlement;
  return applySettlement(tx, request, {
    kind: "succeeded",
    itemId: item.itemId,
    itemStatus: item.status ?? null,
    fee: payoutFee(request, item),
  });
}

// Records PayPal's final answer on a locked request PayPal had (sent, exported, or a cancelled export) and posts it
// once by reference: a failure releases the reservation; a success pays the member and settles PayPal's fee against
// the estimate.
export async function applySettlement(
  tx: Transaction,
  request: PayoutRequestRow,
  outcome: SettledOutcome,
): Promise<PayoutRequestRow> {
  if (outcome.kind === "failed") {
    const failed = await updatePayoutRequest(tx, request.id, {
      status: "failed",
      paypalItemId: outcome.itemId,
      paypalItemStatus: outcome.itemStatus,
      failureMessage: outcome.message.slice(0, MAX_FAILURE_MESSAGE),
      reviewReason: null,
      settledAt: new Date(),
    });
    await postIfNew(tx, request.teamId, payoutReleasedTransfer(postingFor(request)));
    return failed;
  }
  const { feeMinor, reviewReason } = outcome.fee;
  if (reviewReason) log.warn({ action: "payout.fee", payoutRequest: { id: request.id }, reviewReason });
  const { feeEstimateMinor, sentMinor } = claimedAmounts(request);
  const succeeded = await updatePayoutRequest(tx, request.id, {
    status: "succeeded",
    paypalItemId: outcome.itemId,
    paypalItemStatus: outcome.itemStatus,
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

// The team's available PayPal balance in `currency`, or null when it cannot be read: no credentials, credentials of
// another account or without the reporting scope, or PayPal refusing or failing. An overdrawn balance reads 0.
export async function readTeamBalanceMinor(
  deps: PayoutDeps,
  team: Pick<PayoutTeam, "id" | "paypalMerchantId">,
  currency: PayoutRequestRow["currency"],
): Promise<number | null> {
  const credentials = await getTeamPayoutCredentials(deps.db, team.id);
  if (!credentials?.canReadBalance || !credentialsMatchTeam(credentials, team)) return null;
  try {
    const client = await payoutClientFromCredentials(deps.payouts, credentials);
    const { balances } = await client.reporting.balances(currency);
    const balance = balances.find((entry) => entry.currency === currency);
    return Math.max(0, balance?.availableMinor ?? 0);
  } catch (cause) {
    log.warn({ action: "payout.balance", team: { id: team.id }, error: payPalErrorLog(cause) });
    return null;
  }
}

export async function refreshPayout(
  deps: PayoutDeps,
  input: { teamId: string; requestId: string },
): Promise<PayoutRequestView> {
  const request = await getPayoutRequest(deps.db, input.requestId);
  if (!request || request.teamId !== input.teamId) throw notFound();
  return payoutRequestView(await settlePayout(deps, request));
}

// Approvals a requested payout still needs under the current rules. Auto-approval had its chance when the payout
// was made, and the minimum is checked again on approval, so neither counts here.
function approvalsStillNeeded(rules: PayoutRules, row: TeamPayoutRequestRow): number {
  if (row.status !== "requested") return 0;
  const decision = decidePayout(
    { ...rules, autoApproveUpToMinor: null, trustedMemberIds: [], minimumPayoutMinor: 0 },
    {
      amountMinor: row.amountMinor,
      source: row.source,
      memberId: row.userId,
      approverIds: row.approverIds,
      balanceMinor: null,
      now: new Date(),
    },
    row.currency,
  );
  return decision.kind === "needs_approval" ? decision.approvalsNeeded : 0;
}

const WAITING_FOR_DESTINATION_LIMIT = 100;

async function listWaitingForDestination(db: Database, teamId: string, rules: StoredPayoutRules, now: Date) {
  if (!rules.payCompletedProjectsSince) return [];
  const projects = await listCompletedProjectsWithoutPayout(db, {
    teamId,
    completedSince: rules.payCompletedProjectsSince,
    completedBefore: holdEndsBefore(rules, now),
    minAmountMinor: rules.minimumPayoutMinor,
    destination: "missing",
    limit: WAITING_FOR_DESTINATION_LIMIT,
  });
  return projects.map(({ projectId, title, memberName, earningsMinor, currency }) => ({
    projectId,
    title,
    memberName,
    earningsMinor,
    currency,
  }));
}

export async function listTeamPayouts(
  deps: { db: Database; now?: () => Date },
  team: PayoutRulesTeam,
): Promise<TeamPayoutsView> {
  const { db } = deps;
  const [rows, rules, members] = await Promise.all([
    listTeamPayoutRequests(db, team.id),
    getPayoutRules(db, team.id),
    listServicesTeamMembers(db, team),
  ]);
  return {
    adminCount: adminCountOf(members),
    waitingForDestination: await listWaitingForDestination(db, team.id, rules, nowOf(deps)),
    payouts: rows.map((row) => ({
      ...payoutRequestView(row),
      memberName: row.memberName,
      memberEmail: row.memberEmail,
      projectTitle: row.projectTitle,
      approvals: row.approverIds.length,
      approvalsNeeded: approvalsStillNeeded(rules, row),
    })),
  };
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
    requests: requests.map((row) => ({
      ...payoutRequestView(row),
      teamName: row.teamName,
      teamSlug: row.teamSlug,
      projectTitle: row.projectTitle,
    })),
  };
}
