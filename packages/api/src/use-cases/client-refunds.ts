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
  findProjectRefundForProject,
  listRefundParts,
  lockProjectRefund,
  markRefundPartFailed,
  type ProjectRefundPartRow,
  type ProjectRefundRow,
  setProjectRefundStatus,
  setRefundPartPayPalRefund,
  upsertRefundPart,
} from "@jendal-workspace/db/repositories/project-refunds";
import {
  findProjectById,
  listProjectPayments,
  listRefundablePayments,
} from "@jendal-workspace/db/repositories/projects";
import { findTeamById } from "@jendal-workspace/db/repositories/teams";
import { type PayPalRefund, PayPalError } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";

import type { PayPalServices } from "../context";
import { applyCompletedPaymentRefund } from "./payment-refunds";
import { fail, type ProjectActor } from "./projects";

export type ProjectRefundView = {
  amountMinor: number;
  currency: string;
  status: ProjectRefundStatus;
  completedAt: Date | null;
};

export type StaffProjectRefundView = ProjectRefundView & {
  parts: { paymentId: string; amountMinor: number; status: ProjectRefundPartStatus; failureMessage: string | null }[];
};

const MAX_FAILURE_MESSAGE = 500;

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
  if (existing.length === 0) {
    const payments = (await listRefundablePayments(tx, refund.projectId)).filter((p) => p.currency === refund.currency);
    const split = splitProjectRefund({
      amountMinor: refund.amountMinor,
      payments: payments.map((p) => ({ paymentId: p.id, refundableMinor: p.amountMinor - p.refundedMinor })),
    });
    if (!split) {
      fail("BAD_REQUEST", "The client's PayPal payments do not cover this refund. Refund the client in PayPal instead.");
    }
    const captureIds = new Map(payments.map((p) => [p.id, p.paypalCaptureId]));
    for (const part of split) {
      const captureId = captureIds.get(part.paymentId);
      if (!captureId) throw new Error(`Refundable payment ${part.paymentId} has no capture id`);
      await upsertRefundPart(tx, { projectRefundId: refund.id, paymentId: part.paymentId, captureId, amountMinor: part.amountMinor });
    }
  }
  await setProjectRefundStatus(tx, refund.id, "issuing");
  return partsInSplitOrder(tx, refund);
}

class UnexpectedRefundStatus extends Error {
  override name = "UnexpectedRefundStatus";
}

// Shown to the admin who retries: PayPal's error name and message, never request details or credentials.
function failureMessage(cause: unknown): string {
  const message =
    cause instanceof PayPalError || cause instanceof UnexpectedRefundStatus
      ? `${cause.name}: ${cause.message}`
      : "PayPal may have sent this refund, but Payleor could not record it. Try again.";
  return message.slice(0, MAX_FAILURE_MESSAGE);
}

// Every lock here follows the webhook's order (project refund, then payment, then part) so the two cannot deadlock.
async function recordAnswer(tx: Transaction, part: ProjectRefundPartRow, refund: PayPalRefund): Promise<void> {
  await lockProjectRefund(tx, part.projectRefundId);
  await setRefundPartPayPalRefund(tx, part.id, { paypalRefundId: refund.id, status: "pending" });
  if (refund.status === "COMPLETED") await applyCompletedPaymentRefund(tx, { paymentId: part.paymentId, refund });
}

// A refund id PayPal did answer is kept on the failed part: its webhook then confirms the part instead of
// posting it as a refund the team never asked for.
async function recordFailure(
  db: Database,
  part: ProjectRefundPartRow,
  message: string,
  answered: PayPalRefund | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const refund = await lockProjectRefund(tx, part.projectRefundId);
    if (answered) await setRefundPartPayPalRefund(tx, part.id, { paypalRefundId: answered.id, status: "pending" });
    await markRefundPartFailed(tx, part.id, message);
    if (refund && refund.status !== "completed") await setProjectRefundStatus(tx, refund.id, "failed");
  });
}

async function issuePart(
  deps: { db: Database; paypal: PayPalServices },
  input: { part: ProjectRefundPartRow; currency: string; merchantId: string },
): Promise<void> {
  const { part } = input;
  let answered: PayPalRefund | null = null;
  try {
    answered = await deps.paypal.client.payments.refundCapture({
      captureId: part.captureId,
      merchantId: input.merchantId,
      requestId: refundRequestId(part.projectRefundId, part.paymentId),
      amount: { currency_code: input.currency, value: toPayPalValue(part.amountMinor) },
    });
    if (answered.status !== "COMPLETED" && answered.status !== "PENDING") {
      throw new UnexpectedRefundStatus(`PayPal answered the refund with status ${answered.status}.`);
    }
    const refund = answered;
    await deps.db.transaction((tx) => recordAnswer(tx, part, refund));
  } catch (error) {
    const message = failureMessage(error);
    log.error({
      action: "project.refund",
      projectRefund: { id: part.projectRefundId },
      part: { id: part.id, paymentId: part.paymentId, paypalRefundId: answered?.id ?? null },
      error: { name: errorName(error), message },
    });
    try {
      await recordFailure(deps.db, part, message, answered);
    } catch (recordError) {
      log.error({ action: "project.refund_failure", part: { id: part.id }, error: { name: errorName(recordError) } });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `PayPal did not refund the client: ${message}`,
      cause: error,
    });
  }
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
