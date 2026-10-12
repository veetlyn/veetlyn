import {
  canServicesTeam,
  errorName,
  type ProjectRefundPartStatus,
  type ProjectRefundStatus,
  splitProjectRefund,
  toPayPalValue,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import {
  failUnsentRefundParts,
  findProjectRefundForProject,
  listRefundParts,
  lockProjectRefund,
  markRefundPartFailed,
  markRefundPartUncertain,
  type ProjectRefundPartRow,
  type ProjectRefundRow,
  setProjectRefundStatus,
  resendFailedRefundParts,
  setRefundPartPayPalRefund,
  upsertRefundPart,
} from "@jendal-workspace/db/repositories/project-refunds";
import {
  findProjectById,
  listProjectPayments,
  listRefundablePayments,
} from "@jendal-workspace/db/repositories/projects";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import type { PayPalRefund } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";

import type { PayPalServices } from "../context";
import { applyCompletedPaymentRefund } from "./payment-refunds";
import { isPayPalRequestInProgress, isSettledPayPalRefusal, payPalRefusalMessage } from "./paypal-amounts";
import { fail, type ProjectActor } from "./projects";

export type ProjectRefundView = {
  amountMinor: number;
  currency: string;
  status: ProjectRefundStatus;
  completedAt: Date | null;
};

export type StaffProjectRefundView = ProjectRefundView & {
  // `sent` is false until PayPal answers with a refund id; a pending unsent part of an issuing refund was never
  // sent, or its request died before the answer was recorded, so the admin may send it again.
  parts: {
    paymentId: string;
    amountMinor: number;
    status: ProjectRefundPartStatus;
    sent: boolean;
    failureMessage: string | null;
  }[];
};

const MAX_FAILURE_MESSAGE = 500;
// PayPal replays a refund's request id for about 45 days; past 30 a retry might refund again.
const MAX_UNCERTAIN_RETRY_MS = 30 * 86_400_000;

function clientView(refund: ProjectRefundRow): ProjectRefundView {
  return {
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    status: refund.status,
    completedAt: refund.completedAt,
  };
}

export async function getClientRefundView(db: DbExecutor, projectId: string): Promise<ProjectRefundView | null> {
  const refund = await findProjectRefundForProject(db, projectId);
  return refund ? clientView(refund) : null;
}

// Parts are created together, so their creation time cannot order them; they follow the split, newest capture first.
async function partsInSplitOrder(db: DbExecutor, refund: ProjectRefundRow): Promise<ProjectRefundPartRow[]> {
  const [parts, payments] = await Promise.all([listRefundParts(db, refund.id), listProjectPayments(db, refund.projectId)]);
  const capturedAt = new Map(payments.map((p) => [p.id, p.capturedAt?.getTime() ?? 0]));
  return parts.toSorted(
    (a, b) =>
      (capturedAt.get(b.paymentId) ?? 0) - (capturedAt.get(a.paymentId) ?? 0) || b.paymentId.localeCompare(a.paymentId),
  );
}

export async function getStaffRefundView(db: DbExecutor, projectId: string): Promise<StaffProjectRefundView | null> {
  const refund = await findProjectRefundForProject(db, projectId);
  if (!refund) return null;
  const parts = await partsInSplitOrder(db, refund);
  return {
    ...clientView(refund),
    parts: parts.map((part) => ({
      paymentId: part.paymentId,
      amountMinor: part.amountMinor,
      status: part.status,
      sent: part.paypalRefundId !== null,
      failureMessage: part.failureMessage,
    })),
  };
}

// The PayPal-Request-Id of a part. It must not change between attempts: PayPal answers a repeated id with the
// refund it already made, so a retry or a double click never refunds twice.
function refundRequestId(projectRefundId: string, paymentId: string): string {
  return `project-refund:${projectRefundId}:${paymentId}`;
}

// Fixes the parts once, newest capture first; a retry keeps them, so each part's request id names the same amount.
async function prepareParts(tx: Transaction, projectRefundId: string): Promise<ProjectRefundPartRow[]> {
  const refund = await lockProjectRefund(tx, projectRefundId);
  if (!refund) throw new Error(`Project refund ${projectRefundId} disappeared`);
  if (refund.status === "completed") fail("BAD_REQUEST", "This refund was already sent.");
  const existing = await listRefundParts(tx, refund.id);
  // An issuing refund passes only when a part is uncertain (it has a message) or was never sent; otherwise a
  // send is in flight or PayPal's answer is pending, and the webhook finishes it.
  if (
    refund.status === "issuing" &&
    !existing.some((part) => part.failureMessage !== null || (part.status === "pending" && part.paypalRefundId === null))
  ) {
    fail("BAD_REQUEST", "This refund is being sent.");
  }
  if (existing.length === 0) {
    const payments = (await listRefundablePayments(tx, refund.projectId)).filter((p) => p.currency === refund.currency);
    const split = splitProjectRefund({
      amountMinor: refund.amountMinor,
      payments: payments.map((p) => ({ paymentId: p.id, refundableMinor: p.amountMinor - p.refundedMinor })),
    });
    if (!split) {
      fail("BAD_REQUEST", "The client's PayPal payments do not cover this refund. Contact support.");
    }
    const captureIds = new Map(payments.map((p) => [p.id, p.paypalCaptureId]));
    for (const part of split) {
      const captureId = captureIds.get(part.paymentId);
      if (!captureId) throw new Error(`Refundable payment ${part.paymentId} has no capture id`);
      await upsertRefundPart(tx, { projectRefundId: refund.id, paymentId: part.paymentId, captureId, amountMinor: part.amountMinor });
    }
  }
  await resendFailedRefundParts(tx, refund.id);
  const parts = await partsInSplitOrder(tx, refund);
  const oldest = Date.now() - MAX_UNCERTAIN_RETRY_MS;
  if (parts.some((part) => part.status !== "completed" && part.uncertainAt && part.uncertainAt.getTime() < oldest)) {
    fail("BAD_REQUEST", "This refund is too old to retry safely. Contact support.");
  }
  await setProjectRefundStatus(tx, refund.id, "issuing");
  return parts;
}

// A refund made in PayPal by hand cannot be matched to its part, so the messages never send the admin there.
const REFUSED_MESSAGE = "PayPal refused this refund. Contact support; do not refund the client in PayPal.";
const UNSENT_MESSAGE = "Not sent because an earlier part was refused.";
const UNCERTAIN_MESSAGE = "We could not confirm the refund with PayPal. Try again; the client will not be refunded twice.";

// Statuses of a refund PayPal created but will not send. The same request id answers it again, so a retry
// cannot help.
const REFUSED_REFUND_STATUSES = new Set(["FAILED", "CANCELLED"]);

// Every lock here follows the webhook's order (project refund, then payment, then part) so the two cannot deadlock.
async function recordAnswer(tx: Transaction, part: ProjectRefundPartRow, refund: PayPalRefund): Promise<void> {
  await lockProjectRefund(tx, part.projectRefundId);
  await setRefundPartPayPalRefund(tx, part.id, { paypalRefundId: refund.id, status: "pending" });
  if (refund.status === "COMPLETED") await applyCompletedPaymentRefund(tx, { paymentId: part.paymentId, refund });
}

// PayPal made no refund that will reach the client. A refund id PayPal did answer stays on the part. Sending
// stops here, so the parts after it are failed as unsent.
async function recordRefusal(
  db: Database,
  part: ProjectRefundPartRow,
  message: string,
  answered: PayPalRefund | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const refund = await lockProjectRefund(tx, part.projectRefundId);
    if (answered) await setRefundPartPayPalRefund(tx, part.id, { paypalRefundId: answered.id, status: "pending" });
    await markRefundPartFailed(tx, part.id, message);
    await failUnsentRefundParts(tx, part.projectRefundId, UNSENT_MESSAGE);
    if (refund && refund.status !== "completed") await setProjectRefundStatus(tx, refund.id, "failed");
  });
}

// PayPal may have refunded. The part keeps its status and the refund stays issuing, so the webhook waits for the
// admin's retry, whose request id gets the same refund back and confirms it once. A refund id PayPal did answer
// is kept so its webhook confirms the part directly.
async function recordUncertain(db: Database, part: ProjectRefundPartRow, answered: PayPalRefund | null): Promise<void> {
  await db.transaction(async (tx) => {
    await lockProjectRefund(tx, part.projectRefundId);
    await markRefundPartUncertain(tx, part.id, {
      at: new Date(),
      failureMessage: UNCERTAIN_MESSAGE,
      paypalRefundId: answered?.id ?? null,
    });
  });
}

type PartOutcome = { kind: "refused"; message: string; cause: unknown } | { kind: "uncertain"; cause: unknown };

async function sendPart(
  deps: { db: Database; paypal: PayPalServices },
  input: { part: ProjectRefundPartRow; currency: string; merchantId: string },
): Promise<{ answered: PayPalRefund | null; outcome: PartOutcome | null }> {
  const { part } = input;
  let answered: PayPalRefund;
  try {
    answered = await deps.paypal.client.payments.refundCapture({
      captureId: part.captureId,
      merchantId: input.merchantId,
      requestId: refundRequestId(part.projectRefundId, part.paymentId),
      amount: { currency_code: input.currency, value: toPayPalValue(part.amountMinor) },
    });
  } catch (error) {
    // After an attempt with an unknown outcome PayPal may hold a refund for this part, so no refusal is final.
    if (isSettledPayPalRefusal(error) && !isPayPalRequestInProgress(error) && part.uncertainAt === null) {
      return { answered: null, outcome: { kind: "refused", message: payPalRefusalMessage(error), cause: error } };
    }
    return { answered: null, outcome: { kind: "uncertain", cause: error } };
  }
  if (REFUSED_REFUND_STATUSES.has(answered.status)) {
    if (part.uncertainAt !== null) return { answered, outcome: { kind: "uncertain", cause: null } };
    return { answered, outcome: { kind: "refused", message: REFUSED_MESSAGE, cause: null } };
  }
  if (answered.status !== "COMPLETED" && answered.status !== "PENDING") {
    return { answered, outcome: { kind: "uncertain", cause: null } };
  }
  const refund = answered;
  try {
    await deps.db.transaction((tx) => recordAnswer(tx, part, refund));
  } catch (error) {
    return { answered, outcome: { kind: "uncertain", cause: error } };
  }
  return { answered, outcome: null };
}

async function issuePart(
  deps: { db: Database; paypal: PayPalServices },
  input: { part: ProjectRefundPartRow; currency: string; merchantId: string },
): Promise<void> {
  const { part } = input;
  const { answered, outcome } = await sendPart(deps, input);
  if (!outcome) return;
  const message = outcome.kind === "refused" ? outcome.message.slice(0, MAX_FAILURE_MESSAGE) : UNCERTAIN_MESSAGE;
  log.error({
    action: "project.refund",
    projectRefund: { id: part.projectRefundId },
    part: { id: part.id, paymentId: part.paymentId, paypalRefundId: answered?.id ?? null, status: answered?.status ?? null },
    outcome: outcome.kind,
    error: { name: outcome.cause === null ? "none" : errorName(outcome.cause), message },
  });
  try {
    if (outcome.kind === "refused") await recordRefusal(deps.db, part, message, answered);
    else await recordUncertain(deps.db, part, answered);
  } catch (recordError) {
    log.error({ action: "project.refund_record", part: { id: part.id }, error: { name: errorName(recordError) } });
  }
  throw new TRPCError({
    code: "BAD_GATEWAY",
    message: outcome.kind === "refused" ? `PayPal did not refund the client: ${message}` : UNCERTAIN_MESSAGE,
    cause: outcome.cause ?? undefined,
  });
}

// Services spec: an admin confirms every refund; the click is the confirmation. No transaction or lock is held
// across PayPal's calls: the parts are fixed first, then each is sent and its answer recorded on its own.
export async function refundClient(
  deps: { db: Database; paypal: PayPalServices | undefined },
  actor: ProjectActor,
  input: { projectId: string },
): Promise<StaffProjectRefundView> {
  if (!canServicesTeam(actor.role, "resolve_cases")) fail("FORBIDDEN", "Only an admin can refund the client.");
  const project = await findProjectById(deps.db, input.projectId);
  if (!project || project.teamId !== actor.teamId) fail("NOT_FOUND", "Project not found.");
  const refund = await findProjectRefundForProject(deps.db, project.id);
  if (!refund) fail("BAD_REQUEST", "This project has nothing to refund.");
  const team = await findTeamById(deps.db, project.teamId);
  if (!team?.paypalMerchantId) fail("BAD_REQUEST", "Connect PayPal before refunding the client.");
  const merchantId = team.paypalMerchantId;
  const { paypal } = deps;
  if (!paypal) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PayPal is not configured on this server." });

  const parts = await deps.db.transaction((tx) => prepareParts(tx, refund.id));
  for (const part of parts) {
    if (part.status === "completed") continue;
    await issuePart({ db: deps.db, paypal }, { part, currency: refund.currency, merchantId });
  }
  const view = await getStaffRefundView(deps.db, project.id);
  if (!view) throw new Error(`Project refund ${refund.id} disappeared`);
  return view;
}
