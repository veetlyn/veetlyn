import {
  ledgerAccounts,
  parseMajorAmount,
  payoutAmountProblem,
  payoutReceivedProblem,
  payoutReleasedTransfer,
  payoutRequestedTransfer,
  type PayoutRequestStatus,
  payoutSucceededTransfer,
  type TenantEnvironment,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { createPostgresLedger } from "@jendal-workspace/db/repositories/ledger";
import {
  insertPayoutRequest,
  listTeamPayoutRequests,
  listUserPayoutRequests,
  lockPayoutRequest,
  type PayoutRequestRow,
  updatePayoutRequest,
} from "@jendal-workspace/db/repositories/payout-requests";
import { getPayoutDestination, listMemberEarnings, type MemberEarningsRow } from "@jendal-workspace/db/repositories/payouts";
import { findServicesTeamBySlug, getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";

import { postIfNew } from "./paypal-amounts";

// tRPC has no transformer here, so dates are ISO strings.
export type PayoutRequestView = {
  id: string;
  userId: string;
  currency: "USD" | "EUR";
  amountMinor: number;
  status: PayoutRequestStatus;
  receiverEmail: string;
  receivedMinor: number | null;
  paypalTransactionId: string | null;
  createdAt: string;
  decidedAt: string | null;
  paidAt: string | null;
};

export type TeamPayoutRequestView = PayoutRequestView & { memberName: string; memberEmail: string };
export type TeamPayoutsView = { sendMoneyUrl: string; requests: TeamPayoutRequestView[] };
export type MemberPayoutRequestView = PayoutRequestView & { teamName: string; teamSlug: string };
export type MemberPayoutsView = { earnings: MemberEarningsRow[]; requests: MemberPayoutRequestView[] };

export function payPalSendMoneyUrl(environment: TenantEnvironment): string {
  const host = environment === "sandbox" ? "www.sandbox.paypal.com" : "www.paypal.com";
  return `https://${host}/myaccount/transfer/homepage/pay`;
}

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
    receiverEmail: row.receiverEmail,
    receivedMinor: row.receivedMinor,
    paypalTransactionId: row.paypalTransactionId,
    createdAt: row.createdAt.toISOString(),
    decidedAt: isoOrNull(row.decidedAt),
    paidAt: isoOrNull(row.paidAt),
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
  const receiverEmail = destination.paypalEmail;
  if (!receiverEmail) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "PayPal did not share your email. Connect your PayPal account again on this page.",
    });
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
      receiverEmail,
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

// The received amount is only a record: PayPal took its fee on the member's side, so the ledger pays out the full
// requested amount.
export async function markPayoutPaid(
  db: Database,
  input: { teamId: string; requestId: string; deciderId: string; received: string | null; paypalTransactionId: string | null },
): Promise<PayoutRequestView> {
  const row = await db.transaction(async (tx) => {
    const request = await lockTeamRequest(tx, input.teamId, input.requestId);
    if (request.status !== "requested") throw alreadyDecided();
    const receivedMinor = input.received === null ? request.amountMinor : parseMajorAmount(input.received);
    if (receivedMinor === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an amount like 25.00." });
    const problem = payoutReceivedProblem({ receivedMinor, amountMinor: request.amountMinor });
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
    const now = new Date();
    const updated = await updatePayoutRequest(tx, request.id, {
      status: "paid",
      decidedByUserId: input.deciderId,
      decidedAt: now,
      paidAt: now,
      receivedMinor,
      paypalTransactionId: input.paypalTransactionId,
    });
    await postIfNew(tx, request.teamId, payoutSucceededTransfer(postingFor(request)));
    return updated;
  });
  return payoutRequestView(row);
}

export async function listTeamPayouts(
  db: Database,
  input: { teamId: string; environment: TenantEnvironment },
): Promise<TeamPayoutsView> {
  const rows = await listTeamPayoutRequests(db, input.teamId);
  return {
    sendMoneyUrl: payPalSendMoneyUrl(input.environment),
    requests: rows.map((row) => ({ ...payoutRequestView(row), memberName: row.memberName, memberEmail: row.memberEmail })),
  };
}

export async function getMemberPayouts(db: Database, userId: string): Promise<MemberPayoutsView> {
  const [earnings, requests] = await Promise.all([listMemberEarnings(db, userId), listUserPayoutRequests(db, userId)]);
  return {
    earnings,
    requests: requests.map((row) => ({ ...payoutRequestView(row), teamName: row.teamName, teamSlug: row.teamSlug })),
  };
}
