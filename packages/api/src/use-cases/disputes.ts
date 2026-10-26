import type { JsonObject } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import {
  findOpenDisputeForProject,
  pauseScheduleItemsForSubject,
  resumeScheduleItemsForSubject,
  teamHasOpenDispute,
  projectHasOpenDispute,
  upsertDispute,
  upsertPendingScheduleItems,
} from "@jendal-workspace/db/repositories/operating-model";
import { lockTeamPayoutCredentials } from "@jendal-workspace/db/repositories/payout-credentials";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { orders } from "@jendal-workspace/db/schema/orders";
import { project as projectTable } from "@jendal-workspace/db/schema/projects";
import { payment } from "@jendal-workspace/db/schema/projects";
import { team } from "@jendal-workspace/db/schema/organization";
import { dispute as disputeTable } from "@jendal-workspace/db/schema/operating-model";
import type { PayPalDisputeWebhook } from "@jendal-workspace/paypal";
import { and, eq, inArray } from "drizzle-orm";

import { fanOutOutboxEvents } from "./outbox-dispatcher";

// PayPal dispute steps (AGT-54). A dispute is matched to the team's money through the seller
// transaction (the capture id) PayPal names; an open case pauses the project's timers and the
// team's payouts until it resolves. No money moves here: a person answers PayPal's case.

export type DisputeNoticeDeps = {
  db: DbExecutor;
  // Where dispute alerts land, e.g. disputes@{platform domain}.
  alertEmail: string;
  dashOrigin: string;
};

const SELLER_FAVOURABLE_OUTCOMES = new Set(["RESOLVED_SELLER_FAVOUR", "CANCELED_BY_BUYER"]);

export async function handlePayPalDisputeWebhook(deps: DisputeNoticeDeps, dispute: PayPalDisputeWebhook): Promise<string> {
  return deps.db.transaction((tx) => applyDispute({ ...deps, db: tx }, dispute));
}

async function applyDispute(deps: DisputeNoticeDeps & { db: Transaction }, dispute: PayPalDisputeWebhook): Promise<string> {
  const captureIds = dispute.sellerTransactionIds;
  const [projectPayment] =
    captureIds.length > 0
      ? await deps.db
          .select({ projectId: payment.projectId, teamId: payment.teamId, captureId: payment.paypalCaptureId })
          .from(payment)
          .where(and(inArray(payment.paypalCaptureId, captureIds), inArray(payment.status, ["captured", "refunded"])))
          .limit(1)
      : [];
  const [storeOrder] =
    captureIds.length > 0 && !projectPayment
      ? await deps.db
          .select({ orderId: orders.id, teamId: orders.teamId })
          .from(orders)
          .where(inArray(orders.paypalCaptureId, captureIds))
          .limit(1)
      : [];
  const [knownCase] = !projectPayment && !storeOrder
    ? await deps.db.select().from(disputeTable).where(eq(disputeTable.paypalDisputeId, dispute.disputeId)).limit(1)
    : [];
  const teamId = projectPayment?.teamId ?? storeOrder?.teamId ?? knownCase?.teamId;
  if (!teamId) return "dispute does not name this platform's money";
  const projectId = projectPayment?.projectId ?? knownCase?.projectId ?? null;
  const orderId = storeOrder?.orderId ?? knownCase?.orderId ?? null;
  const captureId = projectPayment?.captureId ?? knownCase?.paypalCaptureId ?? captureIds[0] ?? null;
  if (projectId) {
    const [owner] = await deps.db.select({ id: projectTable.id }).from(projectTable).where(and(eq(projectTable.id, projectId), eq(projectTable.teamId, teamId))).for("update");
    if (!owner) throw new Error("Dispute project does not match its payment team");
  } else if (orderId) {
    await deps.db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.teamId, teamId))).for("update");
  }
  // A payout send claim shares this row, so a claim either commits before the case opens or sees it.
  await lockTeamPayoutCredentials(deps.db, teamId);
  const [existing] = await deps.db.select().from(disputeTable).where(eq(disputeTable.paypalDisputeId, dispute.disputeId)).limit(1).for("update");
  if (existing && (existing.teamId !== teamId || existing.projectId !== projectId || existing.orderId !== orderId)) throw new Error("Dispute ownership changed");
  if (existing?.status === "resolved_seller" || existing?.status === "resolved_buyer") {
    await deps.db.update(disputeTable).set({
      amountMinor: existing.amountMinor ?? dispute.amountMinor,
      currency: existing.currency ?? dispute.currency,
    }).where(and(eq(disputeTable.id, existing.id), eq(disputeTable.teamId, teamId)));
    return "dispute already resolved";
  }
  const [teamRow] = await deps.db.select({ slug: team.slug, name: team.name }).from(team).where(eq(team.id, teamId)).limit(1);
  const [projectRow] = projectId
    ? await deps.db.select({ title: projectTable.title }).from(projectTable).where(eq(projectTable.id, projectId)).limit(1)
    : [];
  const amount = dispute.currency && dispute.amountMinor !== null ? `${dispute.currency} ${(dispute.amountMinor / 100).toFixed(2)}` : "unknown amount";
  const url = projectId ? `${deps.dashOrigin}/${teamRow?.slug ?? ""}/projects/${projectId}` : `${deps.dashOrigin}/${teamRow?.slug ?? ""}/orders`;

  if (dispute.eventType === "CUSTOMER.DISPUTE.CREATED") {
    await upsertDispute(deps.db, {
      teamId,
      projectId,
      orderId,
      paypalDisputeId: dispute.disputeId,
      paypalCaptureId: captureId,
      reason: dispute.reason ?? "unknown",
      status: "open",
      amountMinor: dispute.amountMinor,
      currency: dispute.currency,
      rawPayload: dispute,
    });
    if (projectId) await pauseScheduleItemsForSubject(deps.db, projectId);
    await emitDisputeEvent(deps, teamId, "dispute.opened", {
      alertEmail: deps.alertEmail,
      url,
      disputeId: dispute.disputeId,
      reason: dispute.reason ?? "unknown",
      amount,
      projectTitle: projectRow?.title ?? "a store order",
      teamName: teamRow?.name ?? "the team",
    });
    return "dispute opened: timers paused, team alerted";
  }

  const unconfirmedResolution = dispute.eventType === "CUSTOMER.DISPUTE.RESOLVED"
    && !SELLER_FAVOURABLE_OUTCOMES.has(dispute.outcomeCode ?? "")
    && dispute.outcomeCode !== "RESOLVED_BUYER_FAVOUR";
  if (dispute.eventType === "CUSTOMER.DISPUTE.UPDATED" || unconfirmedResolution) {
    const status = unconfirmedResolution || dispute.status === "UNDER_REVIEW" ? "under_review" : "waiting_for_seller";
    await upsertDispute(deps.db, {
      teamId,
      projectId,
      orderId,
      paypalCaptureId: captureId,
      paypalDisputeId: dispute.disputeId,
      reason: dispute.reason ?? "unknown",
      status,
      amountMinor: dispute.amountMinor,
      currency: dispute.currency,
    });
    if (projectId) await pauseScheduleItemsForSubject(deps.db, projectId);
    await emitDisputeEvent(deps, teamId, "dispute.updated", {
      alertEmail: deps.alertEmail,
      url,
      disputeId: dispute.disputeId,
      reason: dispute.reason ?? "unknown",
      amount,
      projectTitle: projectRow?.title ?? "a store order",
      teamName: teamRow?.name ?? "the team",
    });
    return `dispute ${status}`;
  }

  // RESOLVED: seller-favourable cases release the hold; buyer-favourable ones end the ladder.
  const sellerFavour = dispute.outcomeCode !== null && SELLER_FAVOURABLE_OUTCOMES.has(dispute.outcomeCode);
  const status = sellerFavour ? "resolved_seller" : "resolved_buyer";
  await upsertDispute(deps.db, {
    teamId,
    projectId,
    orderId,
    paypalCaptureId: captureId,
    paypalDisputeId: dispute.disputeId,
    reason: dispute.reason ?? "unknown",
    status,
    outcome: dispute.outcomeCode,
    amountMinor: dispute.amountMinor,
    currency: dispute.currency,
    resolvedAt: new Date(),
  });
  if (projectId) {
    if (sellerFavour) {
      if (!(await projectHasOpenDispute(deps.db, { teamId, projectId }))) await resumeScheduleItemsForSubject(deps.db, projectId);
    } else {
      await upsertPendingScheduleItems(deps.db, {
        teamId,
        subjectId: projectId,
        schedule: [],
        cancel: [
          "request.remind",
          "request.expire",
          "member.updateRemind",
          "member.updateLate",
          "client.reviewRemind1",
          "client.reviewRemind2",
          "project.autoComplete",
          "project.abandon",
        ],
      });
    }
  }
  await emitDisputeEvent(deps, teamId, "dispute.resolved", {
    alertEmail: deps.alertEmail,
    url,
    disputeId: dispute.disputeId,
    reason: dispute.reason ?? "unknown",
    amount,
    projectTitle: projectRow?.title ?? "a store order",
    teamName: teamRow?.name ?? "the team",
  });
  return `dispute ${status}`;
}

async function emitDisputeEvent(
  deps: DisputeNoticeDeps,
  teamId: string,
  type: "dispute.opened" | "dispute.updated" | "dispute.resolved",
  data: JsonObject,
): Promise<void> {
  const events = await runInTransaction(deps.db, (_tx, uow) => uow.appendTeamOutbox({ teamId }, [{ type, data }]));
  await fanOutOutboxEvents({ db: deps.db }, events);
}

// Payouts wait while a team has an open case: PayPal can claw the money back out of them.
export async function payoutsHeldForDispute(db: Database, teamId: string): Promise<boolean> {
  return teamHasOpenDispute(db, teamId);
}

export async function openDisputeForProject(db: Database, projectId: string) {
  return findOpenDisputeForProject(db, projectId);
}
