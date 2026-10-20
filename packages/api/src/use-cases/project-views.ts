import {
  canSeeProject,
  type FileStore,
  isProjectStaff,
  maskContactDetails,
    sellerPlanFor,
} from "@jendal-workspace/core";
import { memberDepartmentIds } from "@jendal-workspace/db/repositories/conversations";
import type { ProjectRow } from "@jendal-workspace/db/repositories/projects";
import type { Database } from "@jendal-workspace/db";
import { listDeliveryFiles } from "@jendal-workspace/db/repositories/files";
import { listProjectContacts, primaryContactNames } from "@jendal-workspace/db/repositories/contacts";
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
import { listServicesDepartments } from "@jendal-workspace/db/repositories/services-catalog";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";

import { type LinkSecretSource, linkSecret, signPayLink } from "../client-links";
import { getClientRefundView, getStaffRefundView } from "./client-refunds";
import { accessFactsForRows, conversationFor } from "./conversations";
import { deliveryFileUrl, type ProjectActor } from "./projects";

// The team's projects the viewer may see: staff see all, freelancers what is assigned to them and the requests
// the conversation audience rule opens to them.
async function visibleProjects(db: Database, viewer: ProjectActor, rows: ProjectRow[]): Promise<ProjectRow[]> {
  if (isProjectStaff(viewer.role)) return rows;
  const [facts, departmentIds] = await Promise.all([
    accessFactsForRows(db, viewer.teamId, rows),
    memberDepartmentIds(db, { teamId: viewer.teamId, userId: viewer.actorId }),
  ]);
  return rows.filter((row) => {
    const rowFacts = facts.get(row.id);
    return rowFacts !== undefined && canSeeProject({ role: viewer.role, actorId: viewer.actorId, departmentIds, facts: rowFacts });
  });
}

// A project the caller may not see is reported exactly like a missing one.
async function requireVisibleProject(db: Database, viewer: ProjectActor, projectId: string) {
  const [settings, projects] = await Promise.all([
    getServicesTeamSettings(db, viewer.teamId),
    listTeamProjects(db, viewer.teamId),
  ]);
  const own = projects.filter((p) => p.id === projectId);
  const [row] = await visibleProjects(db, viewer, own);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  return { row, settings };
}

// Before a quote is accepted, a freelancer looking at a request sees the brief with contact details hidden and
// none of the client's addresses (conversations design §6).
function seesRequestOnly(viewer: ProjectActor, row: ProjectRow): boolean {
  return !isProjectStaff(viewer.role) && row.status === "quoting" && row.assignedFreelancerId !== viewer.actorId;
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
  const [rows, clientNames] = await Promise.all([
    listTeamProjects(db, viewer.teamId),
    primaryContactNames(db, viewer.teamId),
  ]);
  return (await visibleProjects(db, viewer, rows)).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      currency: row.currency,
      clientName: clientNames.get(row.id) ?? null,
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
  const [contacts, quotes, amendments, payments, deliveries, refund, senderCountry, payee] = await Promise.all([
    listProjectContacts(db, row.id),
    listProjectQuotes(db, row.id),
    listProjectAmendments(db, row.id),
    listProjectPayments(db, row.id),
    listProjectDeliveries(db, row.id),
    getStaffRefundView(db, row.id),
    getTeamPayPalCountry(db, viewer.teamId),
    payeeId && seesPayee ? getPayoutDestination(db, payeeId) : null,
  ]);
  // The legacy client columns stay server-side: the contacts say who the client is.
  const { clientEmail: _email, clientName: _name, clientDiscordId: _discord, ...project } = row;
  const requestOnly = seesRequestOnly(viewer, row);
  const conversation = await conversationFor(db, { kind: "member", actor: viewer }, row);
  return {
    project: requestOnly
      ? {
          ...project,
          brief: maskContactDetails(project.brief).shown,
          requestAnswers: project.requestAnswers.map((a) => ({ ...a, answer: maskContactDetails(a.answer).shown })),
        }
      : project,
    contacts: requestOnly ? [] : contacts,
    conversation,
    quotes,
    amendments,
    payments,
    deliveries: await withDeliveryFiles(db, deliveries),
    refund,
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

export const RESPONSE_WINDOW_MS = 48 * 3_600_000;

// The Open requests board (conversations design §7): the quoting requests the viewer may answer, newest first,
// with the 48-hour window shown (the reminder and the expiry run elsewhere).
export async function listOpenRequests(db: Database, viewer: ProjectActor) {
  const [rows, departments] = await Promise.all([
    listTeamProjects(db, viewer.teamId),
    listServicesDepartments(db, viewer.teamId),
  ]);
  const quoting = rows.filter((row) => row.status === "quoting");
  const visible = await visibleProjects(db, viewer, quoting);
  const facts = await accessFactsForRows(db, viewer.teamId, visible);
  const names = new Map(departments.map((d) => [d.id, d.name]));
  return visible.map((row) => {
    const departmentId = facts.get(row.id)?.departmentId ?? null;
    return {
      id: row.id,
      title: row.title,
      brief: seesRequestOnly(viewer, row) ? maskContactDetails(row.brief).shown : row.brief,
      departmentName: departmentId ? (names.get(departmentId) ?? null) : null,
      createdAt: row.createdAt,
      respondBy: new Date(row.createdAt.getTime() + RESPONSE_WINDOW_MS),
    };
  });
}

// "Preview as client" (design §5.3): what the client page shows, read-only, with no link to act through.
export async function getClientPreview(
  deps: { db: Database; auth: LinkSecretSource },
  viewer: ProjectActor,
  projectId: string,
) {
  const { row } = await requireVisibleProject(deps.db, viewer, projectId);
  const view = await getClientProjectView(deps, row.id);
  // Pay links stay with the client: the preview only says a payment can be paid (`payable`).
  return { ...view, payments: view.payments.map((p) => ({ ...p, payPath: null })) };
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
      payable: p.status === "pending" || p.status === "failed",
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
