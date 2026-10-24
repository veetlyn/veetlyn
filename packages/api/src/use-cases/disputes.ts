import type { JsonObject } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  findOpenDisputeForProject,
  pauseScheduleItemsForSubject,
  resumeScheduleItemsForSubject,
  teamHasOpenDispute,
  upsertDispute,
  upsertPendingScheduleItems,
} from "@jendal-workspace/db/repositories/operating-model";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { orders } from "@jendal-workspace/db/schema/orders";
import { project as projectTable } from "@jendal-workspace/db/schema/projects";
import { payment } from "@jendal-workspace/db/schema/projects";
import { team } from "@jendal-workspace/db/schema/organization";
import type { PayPalDisputeWebhook } from "@jendal-workspace/paypal";
import { and, eq, inArray } from "drizzle-orm";

import { fanOutOutboxEvents } from "./outbox-dispatcher";

// PayPal dispute steps (AGT-54). A dispute is matched to the team's money through the seller
// transaction (the capture id) PayPal names; an open case pauses the project's timers and the
// team's payouts until it resolves. No money moves here: a person answers PayPal's case.

export type DisputeNoticeDeps = {
  db: Database;
  // Where dispute alerts land, e.g. disputes@{platform domain}.
  alertEmail: string;
  dashOrigin: string;
};

const SELLER_FAVOURABLE_OUTCOMES = new Set(["RESOLVED_SELLER_FAVOUR", "CANCELED_BY_BUYER"]);

export async function handlePayPalDisputeWebhook(deps: DisputeNoticeDeps, dispute: PayPalDisputeWebhook): Promise<string> {
  const captureIds = dispute.sellerTransactionIds;
  const [projectPayment] =
    captureIds.length > 0
      ? await deps.db
          .select({ projectId: payment.projectId, teamId: payment.teamId, captureId: payment.paypalCaptureId })
          .from(payment)
          .where(and(inArray(payment.paypalCaptureId, captureIds), eq(payment.status, "captured")))
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
  if (!projectPayment && !storeOrder) return "dispute does not name this platform's money";

  const teamId = projectPayment?.teamId ?? storeOrder!.teamId;
  const projectId = projectPayment?.projectId ?? null;
  const [teamRow] = await deps.db.select({ slug: team.slug, name: team.name }).from(team).where(eq(team.id, teamId)).limit(1);
  const [projectRow] = projectId
    ? await deps.db.select({ title: projectTable.title }).from(projectTable).where(eq(projectTable.id, projectId)).limit(1)
    : [];
  const amount = dispute.currency && dispute.amountMinor !== null ? `${dispute.currency} ${(dispute.amountMinor / 100).toFixed(2)}` : "unknown amount";
  const url = projectId ? `${deps.dashOrigin}/${teamRow?.slug ?? ""}/projects/${projectId}` : `${deps.dashOrigin}/orders/${storeOrder?.orderId ?? ""}`;

  if (dispute.eventType === "CUSTOMER.DISPUTE.CREATED") {
    await upsertDispute(deps.db, {
      teamId,
      projectId,
      orderId: storeOrder?.orderId ?? null,
      paypalDisputeId: dispute.disputeId,
      paypalCaptureId: captureIds[0] ?? null,
      reason: dispute.reason ?? "unknown",
      status: "open",
      amountMinor: dispute.amountMinor ?? 0,
      currency: dispute.currency ?? "USD",
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

  if (dispute.eventType === "CUSTOMER.DISPUTE.UPDATED") {
    const status = dispute.status === "UNDER_REVIEW" ? "under_review" : "waiting_for_seller";
    await upsertDispute(deps.db, {
      teamId,
      projectId,
      paypalDisputeId: dispute.disputeId,
      reason: dispute.reason ?? "unknown",
      status,
      amountMinor: dispute.amountMinor ?? 0,
      currency: dispute.currency ?? "USD",
    });
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
    paypalDisputeId: dispute.disputeId,
    reason: dispute.reason ?? "unknown",
    status,
    outcome: dispute.outcomeCode,
    amountMinor: dispute.amountMinor ?? 0,
    currency: dispute.currency ?? "USD",
    resolvedAt: new Date(),
  });
  if (projectId) {
    if (sellerFavour) {
      await resumeScheduleItemsForSubject(deps.db, projectId);
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
