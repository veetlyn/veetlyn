import { and, desc, eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import { clientContact, projectClient } from "../schema/contacts";
import { dispute } from "../schema/operating-model";
import { payment, project } from "../schema/projects";

// The team's client payments, the latest captured first and the ones still waiting at the top, each with its
// project and the project's primary client.
export async function listTeamPayments(db: DbExecutor, teamId: string) {
  return db
    .select({
      id: payment.id,
      kind: payment.kind,
      status: payment.status,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      refundedMinor: payment.refundedMinor,
      paypalFeeMinor: payment.paypalFeeMinor,
      createdAt: payment.createdAt,
      capturedAt: payment.capturedAt,
      projectId: payment.projectId,
      projectTitle: project.title,
      clientName: clientContact.name,
    })
    .from(payment)
    .innerJoin(project, eq(project.id, payment.projectId))
    .leftJoin(projectClient, and(eq(projectClient.projectId, payment.projectId), eq(projectClient.isPrimary, true)))
    .leftJoin(clientContact, eq(clientContact.id, projectClient.contactId))
    .where(eq(payment.teamId, teamId))
    .orderBy(desc(sql`coalesce(${payment.capturedAt}, ${payment.createdAt})`), desc(payment.id));
}

// The team's PayPal cases, open ones first, then by when PayPal opened them.
export async function listTeamDisputes(db: DbExecutor, teamId: string) {
  const open = sql<boolean>`${dispute.resolvedAt} is null`;
  return db
    .select({
      id: dispute.id,
      paypalDisputeId: dispute.paypalDisputeId,
      reason: dispute.reason,
      status: dispute.status,
      outcome: dispute.outcome,
      amountMinor: dispute.amountMinor,
      currency: dispute.currency,
      openedAt: dispute.openedAt,
      resolvedAt: dispute.resolvedAt,
      projectId: dispute.projectId,
      projectTitle: project.title,
      orderId: dispute.orderId,
      open,
    })
    .from(dispute)
    .leftJoin(project, eq(project.id, dispute.projectId))
    .where(eq(dispute.teamId, teamId))
    .orderBy(desc(open), desc(dispute.openedAt), desc(dispute.id));
}
