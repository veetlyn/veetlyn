import { canSeeProject, type FileStore, sellerPlanFor } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { listDeliveryFiles } from "@jendal-workspace/db/repositories/files";
import { getPayoutDestination } from "@jendal-workspace/db/repositories/payouts";
import { getTeamPayPalCountry } from "@jendal-workspace/db/repositories/paypal-onboarding";
import {
  findProjectById,
  listProjectAmendments,
  listProjectDeliveries,
  listProjectPayments,
  listProjectQuotes,
  listTeamProjects,
} from "@jendal-workspace/db/repositories/projects";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";

import { type LinkSecretSource, linkSecret, signClientLink, signPayLink } from "../client-links";
import { getClientRefundView, getStaffRefundView } from "./client-refunds";
import { deliveryFileUrl, type ProjectActor } from "./projects";

// A project the caller may not see is reported exactly like a missing one.
async function requireVisibleProject(db: Database, viewer: ProjectActor, projectId: string) {
  const [settings, projects] = await Promise.all([
    getServicesTeamSettings(db, viewer.teamId),
    listTeamProjects(db, viewer.teamId),
  ]);
  const row = projects.find((p) => p.id === projectId);
  if (
    !row ||
    !canSeeProject({
      role: viewer.role,
      actorId: viewer.actorId,
      assignedFreelancerId: row.assignedFreelancerId,
      status: row.status,
      quotingMode: settings?.quotingMode ?? "assigned",
    })
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  }
  return { row, settings };
}

// The storage key stays server-side; pages get the name and size, and a signed link on request.
async function withDeliveryFiles<T extends { id: string }>(
  db: Database,
  deliveries: T[],
): Promise<(T & { file: { name: string; sizeBytes: number } | null })[]> {
  const files = await listDeliveryFiles(db, deliveries.map((d) => d.id));
  const byDelivery = new Map(files.map((f) => [f.deliveryId, { name: f.fileName, sizeBytes: f.sizeBytes }]));
  return deliveries.map((d) => ({ ...d, file: byDelivery.get(d.id) ?? null }));
}

export async function listVisibleProjects(db: Database, viewer: ProjectActor) {
  const settings = await getServicesTeamSettings(db, viewer.teamId);
  const rows = await listTeamProjects(db, viewer.teamId);
  return rows
    .filter((row) =>
      canSeeProject({
        role: viewer.role,
        actorId: viewer.actorId,
        assignedFreelancerId: row.assignedFreelancerId,
        status: row.status,
        quotingMode: settings?.quotingMode ?? "assigned",
      }),
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      currency: row.currency,
      clientEmail: row.clientEmail,
      clientDiscordId: row.clientDiscordId,
      createdAt: row.createdAt,
    }));
}

export async function getTeamProjectView(
  deps: { db: Database; auth: LinkSecretSource },
  viewer: ProjectActor,
  projectId: string,
) {
  const { db } = deps;
  const { row, settings } = await requireVisibleProject(db, viewer, projectId);
  // The quote calculator estimates the payout fee for the member who would be paid: the assigned one, or a
  // freelancer quoting for themselves. Only admins and the payee see the payee's PayPal country; others get the
  // international estimate.
  const payeeId = row.assignedFreelancerId ?? (viewer.role === "freelancer" ? viewer.actorId : null);
  const seesPayee = viewer.role === "admin" || payeeId === viewer.actorId;
  const [quotes, amendments, payments, deliveries, refund, senderCountry, payee] = await Promise.all([
    listProjectQuotes(db, row.id),
    listProjectAmendments(db, row.id),
    listProjectPayments(db, row.id),
    listProjectDeliveries(db, row.id),
    getStaffRefundView(db, row.id),
    getTeamPayPalCountry(db, viewer.teamId),
    payeeId && seesPayee ? getPayoutDestination(db, payeeId) : null,
  ]);
  const clientToken = await signClientLink(linkSecret(deps.auth), row.id);
  return {
    project: row,
    quotes,
    amendments,
    payments,
    deliveries: await withDeliveryFiles(db, deliveries),
    refund,
    clientPath: `/c/${clientToken}`,
    role: viewer.role,
    quotingMode: settings?.quotingMode ?? "assigned",
    solo: settings?.solo ?? false,
    viewerId: viewer.actorId,
    quoteCalculator: {
      platformFeeBps: sellerPlanFor({ id: viewer.teamId, solo: settings?.solo ?? false }).feeBps,
      senderCountry,
      receiverCountry: payee?.paypalCountry ?? null,
    },
  };
}

export async function teamDeliveryFileUrl(
  deps: { db: Database; files: FileStore },
  viewer: ProjectActor,
  input: { projectId: string; deliveryId: string },
): Promise<{ url: string }> {
  const { row } = await requireVisibleProject(deps.db, viewer, input.projectId);
  return deliveryFileUrl(deps.db, deps.files, { projectId: row.id, deliveryId: input.deliveryId });
}

// The client project page (services spec §5.2): signed link, no account. Internal user ids
// (freelancerId, authorId, proposedById) and the PayPal ids stay server-side; the link holder
// sees only what the page renders.
export async function getClientProjectView(deps: { db: Database; auth: LinkSecretSource }, projectId: string) {
  const { db } = deps;
  const row = await findProjectById(db, projectId);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  const [quotes, amendments, payments, deliveries, refund] = await Promise.all([
    listProjectQuotes(db, projectId),
    listProjectAmendments(db, projectId),
    listProjectPayments(db, projectId),
    listProjectDeliveries(db, projectId),
    getClientRefundView(db, projectId),
  ]);
  const secret = linkSecret(deps.auth);
  const paymentViews = await Promise.all(
    payments.map(async (p) => ({
      id: p.id,
      kind: p.kind,
      status: p.status,
      amountMinor: p.amountMinor,
      refundedMinor: p.refundedMinor,
      lines: p.lines,
      createdAt: p.createdAt,
      // PayPal holds a capture it has not finished; the id itself stays server-side.
      processing: p.status === "pending" && p.paypalCaptureId !== null,
      // Pending and failed payments can be paid; the pay link names the payment, never the amount (§5.4).
      payPath: p.status === "pending" || p.status === "failed" ? `/pay/${await signPayLink(secret, p.id)}` : null,
    })),
  );
  return {
    project: {
      id: row.id,
      title: row.title,
      brief: row.brief,
      status: row.status,
      currency: row.currency,
      managementFeeBps: row.managementFeeBps,
      finalPriceMinor: row.finalPriceMinor,
    },
    quotes: quotes.map((q) => ({
      id: q.id,
      version: q.version,
      status: q.status,
      amountMinor: q.amountMinor,
      deliveryDays: q.deliveryDays,
      createdAt: q.createdAt,
      acceptedAt: q.acceptedAt,
      items: q.items.map((item) => ({
        id: item.id,
        description: item.description,
        amountMinor: item.amountMinor,
        extraDays: item.extraDays,
      })),
    })),
    amendments: amendments.map((a) => ({
      id: a.id,
      status: a.status,
      note: a.note,
      addItems: a.addItems,
      deltaMinor: a.deltaMinor,
      newAmountMinor: a.newAmountMinor,
      extraDays: a.extraDays,
      createdAt: a.createdAt,
    })),
    payments: paymentViews,
    deliveries: await withDeliveryFiles(
      db,
      deliveries.map((d) => ({
        id: d.id,
        status: d.status,
        note: d.note,
        link: d.link,
        clientNote: d.clientNote,
        createdAt: d.createdAt,
        decidedAt: d.decidedAt,
      })),
    ),
    refund,
  };
}
